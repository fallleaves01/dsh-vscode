import { withoutIdeContext } from './ide-context.js'
import { tokenUsageOf, turnUsageOf, type TokenUsage, type TurnTokenUsage } from './token-usage.js'
import type { ImageMediaType } from './dsh-client.js'
import { presentToolCall, presentToolResult } from './tool-presentation.js'
import type { AssistantAttempt, AssistantStreamUpdate } from './dsh-assistant-stream.js'

export type ConversationRole = 'user' | 'assistant' | 'tool' | 'command' | 'notice'

/** What the action row shows under a message; never part of the message text. */
export interface MessageMeta {
  seq: number
  /** Unix epoch milliseconds, as every DSH event carries it. */
  time: number
  turn?: number
  step?: number
  usage?: TokenUsage
}

/** The row DSH shows once per completed turn, anchored to that turn's closing reply. */
export interface TurnFooter {
  turnEnd: true
  turnUsage?: TurnTokenUsage
}

/**
 * Decide which message carries a turn's action row, and what the turn cost.
 *
 * DSH renders the row once per *completed* turn on that turn's closing assistant
 * message and shows the turn's aggregate usage there, so the fold belongs here
 * rather than on each step. A turn whose last reply is still streaming has no row.
 */
export function turnFooters(
  messages: readonly ConversationMessage[],
  meta: ReadonlyMap<string, MessageMeta>,
): Map<string, TurnFooter> {
  const turns = new Map<number, ConversationMessage[]>()
  for (const message of messages) {
    const turn = meta.get(message.id)?.turn
    if (turn === undefined || message.role !== 'assistant') continue
    const group = turns.get(turn)
    if (group === undefined) turns.set(turn, [message])
    else group.push(message)
  }
  const footers = new Map<string, TurnFooter>()
  for (const group of turns.values()) {
    const closing = [...group].reverse().find(message => message.streaming !== true)
    if (closing === undefined) continue
    const usages = group.map(message => meta.get(message.id)?.usage)
    // No routes: attributing a turn to a provider needs the model that served
    // each call, which the projection does not carry. Naming the message id here
    // would put a nonsense first line in the usage panel, and the panel omits the
    // line when there is no route.
    const turnUsage = turnUsageOf(usages, [])
    footers.set(closing.id, { turnEnd: true, ...(turnUsage === undefined ? {} : { turnUsage }) })
  }
  return footers
}

export interface ConversationMessage {
  id: string
  role: ConversationRole
  text: string
  /** Model thinking for this turn, shown collapsed above the answer. */
  reasoning?: string
  detail?: string
  streaming?: boolean
  failed?: boolean
  callView?: unknown
  resultView?: unknown
  rawInput?: string
  rawResult?: string
  images?: ConversationImage[]
  deferredBody?: boolean
  deferredBodyRevision?: string
  bodyLength?: number
}

interface AssistantStreamNode {
  previous?: AssistantStreamNode
  text: string
}

const assistantStreams = new WeakMap<ConversationMessage, AssistantStreamNode>()

function inheritAssistantStream(source: ConversationMessage | undefined, target: ConversationMessage): void {
  const stream = source === undefined ? undefined : assistantStreams.get(source)
  if (stream !== undefined) assistantStreams.set(target, stream)
}

function appendAssistantStream(source: ConversationMessage | undefined, target: ConversationMessage, text: string): void {
  const previous = source === undefined ? undefined : assistantStreams.get(source)
  assistantStreams.set(target, { ...(previous === undefined ? {} : { previous }), text })
}

/** Returns the exact append represented by two projector snapshots without rescanning their accumulated text. */
export function assistantStreamAppend(left: ConversationMessage, right: ConversationMessage): string | undefined {
  const target = assistantStreams.get(left)
  let current = assistantStreams.get(right)
  if (current === undefined) return undefined
  if (current === target) return left.text.length === right.text.length ? '' : undefined
  const chunks: string[] = []
  while (current !== undefined && current !== target) {
    chunks.push(current.text)
    current = current.previous
  }
  if (current !== target) return undefined
  return chunks.reverse().join('')
}

export interface ConversationImage {
  attachmentId: string
  mediaType: ImageMediaType
  width: number
  height: number
  name?: string
  data?: string
  error?: string
}

export interface DshEvent {
  type: string
  seq: number
  time: number
  data: unknown
  surfaceOp?: unknown
}

interface EventData {
  [key: string]: unknown
}

function record(value: unknown): EventData | undefined {
  return typeof value === 'object' && value !== null ? value as EventData : undefined
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((part) => {
    const item = record(part)
    return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  }).join('\n')
}

/**
 * DSH persists model thinking as `{ type: 'reasoning' }` content parts alongside
 * the answer's `{ type: 'text' }` parts. Without this the sidebar silently drops
 * every thought, which is why thinking only appeared in the browser UI.
 */
function reasoningContent(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((part) => {
    const item = record(part)
    return item?.type === 'reasoning' && typeof item.text === 'string' ? [item.text] : []
  }).join('\n')
}

function imageMediaType(value: unknown): ImageMediaType | undefined {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
    ? value
    : undefined
}

/** Finds durable DSH image references, including images nested inside tool results. */
function imageContent(value: unknown): ConversationImage[] {
  const found = new Map<string, ConversationImage>()
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    const item = record(candidate)
    if (item === undefined) return
    if (item.type === 'image') {
      const attachment = record(item.attachment)
      const mediaType = imageMediaType(attachment?.mediaType)
      if (attachment !== undefined
        && typeof attachment.attachmentId === 'string'
        && mediaType !== undefined
        && typeof attachment.width === 'number'
        && typeof attachment.height === 'number') {
        found.set(attachment.attachmentId, {
          attachmentId: attachment.attachmentId,
          mediaType,
          width: attachment.width,
          height: attachment.height,
          ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
        })
      }
    }
    if (Array.isArray(item.content)) visit(item.content)
  }
  visit(value)
  return [...found.values()]
}

function resultContent(value: unknown): string {
  const item = record(value)
  if (item === undefined) return ''
  if (typeof item.text === 'string') return item.text
  if (Array.isArray(item.content)) return textContent(item.content)
  if (typeof item.content === 'string') return item.content
  return ''
}

function toolView(value: unknown, expected: 'call' | 'result'): unknown {
  const wrapper = record(value)
  return wrapper?.for === expected ? wrapper.view : undefined
}

/** Projects the official append-only DSH event log into the small chat surface. */
export class ConversationProjector {
  private readonly orderedIds: string[] = []
  private readonly byId = new Map<string, ConversationMessage>()
  /**
   * Per-message facts the action row needs, kept beside the content rather than
   * on it: the message shape is a contract that consumers and tests pin, and a
   * footer needs timing and cost, not content.
   */
  private readonly meta = new Map<string, MessageMeta>()
  private readonly hiddenCommandIds = new Set<string>()
  private liveAttempt: (AssistantAttempt & { message?: ConversationMessage }) | undefined

  reset(entries: readonly (DshEvent | { event: DshEvent; view?: unknown })[], preserveLive = false): void {
    const live = preserveLive ? this.liveAttempt : undefined
    this.liveAttempt = undefined
    this.orderedIds.length = 0
    this.byId.clear()
    this.meta.clear()
    this.hiddenCommandIds.clear()
    for (const entry of entries) {
      if ('event' in entry) this.apply(entry.event, entry.view)
      else this.apply(entry)
    }
    this.liveAttempt = live
  }

  /** A process-local prefix is not history; retry/abandonment must be able to discard it. */
  applyStream(update: AssistantStreamUpdate): void {
    if (update.kind === 'start') { this.liveAttempt = { ...update }; return }
    const active = this.liveAttempt
    if (active?.attemptId !== update.attemptId) return
    if (update.kind === 'end') { this.liveAttempt = undefined; return }
    const chunk = update.chunk
    const current = active.message
    const images = chunk.type === 'block-end' ? imageContent(chunk.block) : []
    const text = chunk.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : ''
    const reasoning = chunk.type === 'reasoning-delta' && typeof chunk.text === 'string' ? chunk.text : ''
    if (text === '' && images.length === 0 && reasoning === '') return
    const accumulated = `${current?.reasoning ?? ''}${reasoning}`
    const next: ConversationMessage = {
      id: `assistant-live:${active.attemptId}`, role: 'assistant', streaming: true,
      text: `${current?.text ?? ''}${text}`,
      ...(accumulated === '' ? {} : { reasoning: accumulated }),
      ...(current?.images === undefined && images.length === 0 ? {} : { images: mergeImages(current?.images, images) }),
    }
    if (text !== '') appendAssistantStream(current, next, text)
    else inheritAssistantStream(current, next)
    active.message = next
  }

  apply(event: DshEvent, view?: unknown): void {
    const data = record(event.data)
    if (data === undefined) return
    if ((event.type === 'assistant/message' || event.type === 'assistant/attempt')
      && this.liveAttempt?.turn === data.turn && this.liveAttempt?.step === data.step
      && (event.type === 'assistant/attempt' || event.surfaceOp === 'append')) this.liveAttempt = undefined

    if (event.type === 'user/message') {
      const source = record(data.source)
      if (source?.kind !== 'user') return
      const id = typeof data.id === 'string' ? data.id : `user:${String(event.seq)}`
      const text = withoutIdeContext(textContent(data.content))
      const images = imageContent(data.content)
      if (text !== '' || images.length > 0) {
        this.set(id, { id, role: 'user', text, ...(images.length > 0 ? { images } : {}) })
        this.meta.set(id, { seq: event.seq, time: event.time, ...(typeof data.turn === 'number' ? { turn: data.turn } : {}) })
      }
      return
    }

    if (event.type === 'assistant/chunk') {
      const chunk = record(data.chunk)
      const id = `assistant:${String(data.turn)}:${String(data.step)}`
      const current = this.byId.get(id)
      if (chunk?.type === 'block-end') {
        const images = imageContent(chunk.block)
        if (images.length === 0) return
        const next: ConversationMessage = {
          id,
          role: 'assistant',
          text: current?.text ?? '',
          images: mergeImages(current?.images, images),
          streaming: true,
        }
        inheritAssistantStream(current, next)
        this.set(id, next)
        return
      }
      if ((chunk?.type !== 'text-delta' && chunk?.type !== 'reasoning-delta') || typeof chunk.text !== 'string') return
      const reasoning = chunk.type === 'reasoning-delta' ? chunk.text : ''
      const accumulated = `${current?.reasoning ?? ''}${reasoning}`
      const next: ConversationMessage = {
        id,
        role: 'assistant',
        text: reasoning === '' ? `${current?.text ?? ''}${chunk.text}` : (current?.text ?? ''),
        ...(accumulated === '' ? {} : { reasoning: accumulated }),
        streaming: true,
      }
      if (reasoning === '') appendAssistantStream(current, next, chunk.text)
      else inheritAssistantStream(current, next)
      this.set(id, next)
      return
    }

    if (event.type === 'assistant/message') {
      const message = record(data.message)
      const id = `assistant:${String(data.turn)}:${String(data.step)}`
      const current = this.byId.get(id)
      const text = textContent(message?.content)
      const reasoning = reasoningContent(message?.content)
      const images = imageContent(message?.content)
      if (text !== '' || images.length > 0 || reasoning !== '') {
        const next: ConversationMessage = {
          id, role: 'assistant', text,
          ...(reasoning === '' ? {} : { reasoning }),
          ...(images.length > 0 ? { images } : {}),
        }
        if (current !== undefined && text === current.text) inheritAssistantStream(current, next)
        this.set(id, next)
        const usage = tokenUsageOf(data.usage)
        this.meta.set(id, {
          seq: event.seq, time: event.time,
          ...(typeof data.turn === 'number' ? { turn: data.turn } : {}),
          ...(typeof data.step === 'number' ? { step: data.step } : {}),
          ...(usage === undefined ? {} : { usage }),
        })
      }
      return
    }

    if (event.type === 'tool/call') {
      const callId = typeof data.callId === 'string' ? data.callId : String(event.seq)
      const name = typeof data.name === 'string' ? data.name : 'Tool'
      this.set(`tool:${callId}`, {
        id: `tool:${callId}`,
        role: 'tool',
        text: name,
        detail: 'Running…',
        streaming: true,
        callView: toolView(view, 'call') ?? presentToolCall(name, data.arguments),
        ...(typeof data.arguments === 'string' ? { rawInput: data.arguments } : {}),
      })
      return
    }

    if (event.type === 'tool/result') {
      const message = record(data.message)
      const source = record(message?.source)
      const firstBlock = Array.isArray(message?.content) ? record(message.content[0]) : undefined
      const callId = typeof source?.callId === 'string'
        ? source.callId
        : typeof firstBlock?.toolCallId === 'string'
          ? firstBlock.toolCallId
          : String(event.seq)
      const id = `tool:${callId}`
      const current = this.byId.get(id)
      const failed = data.error !== undefined || firstBlock?.isError === true
      const rawResult = resultContent(firstBlock)
      const images = imageContent(message?.content)
      this.set(id, {
        id,
        role: 'tool',
        text: current?.text ?? 'Tool',
        detail: failed ? 'Failed' : 'Completed',
        failed,
        ...(current?.callView === undefined ? {} : { callView: current.callView }),
        ...(current?.rawInput === undefined ? {} : { rawInput: current.rawInput }),
        resultView: toolView(view, 'result') ?? presentToolResult(current?.text ?? '', current?.rawInput, event, failed),
        ...(rawResult === '' ? {} : { rawResult }),
        ...(images.length > 0 ? { images } : {}),
      })
      return
    }

    if (event.type === 'command/run') {
      if (typeof data.commandId !== 'string' || typeof data.name !== 'string') return
      // Plan entry/exit is a composer control transition as well as a slash
      // command. Keep its durable DSH events for the projection, but do not
      // turn a Shield click into a synthetic chat card.
      const planArgs = typeof data.args === 'string' ? data.args.trim() : ''
      if (data.name === 'plan'
        && (planArgs === '' || planArgs === 'on' || planArgs === 'off')) {
        this.hiddenCommandIds.add(data.commandId)
        return
      }
      const id = `command:${data.commandId}`
      this.set(id, {
        id,
        role: 'command',
        text: `/${data.name}${typeof data.args === 'string' ? data.args : ''}`,
        detail: 'Running…',
        streaming: true,
      })
      return
    }

    if (event.type === 'command/done') {
      if (typeof data.commandId !== 'string') return
      if (this.hiddenCommandIds.has(data.commandId)) return
      const id = `command:${data.commandId}`
      const current = this.byId.get(id)
      const failed = data.kind === 'error'
      this.set(id, {
        id,
        role: 'command',
        text: current?.text ?? 'DeepSeek command',
        detail: failed ? 'Failed' : 'Completed',
        failed,
        ...(typeof data.text === 'string' && data.text !== '' ? { rawResult: data.text } : {}),
      })
    }
  }

  notice(id: string, text: string, failed = false): void {
    this.set(id, { id, role: 'notice', text, failed })
  }

  /** The sidecar facts for the messages currently held, keyed by message id. */
  messageMeta(): Map<string, MessageMeta> {
    return new Map(this.meta)
  }

  messages(): ConversationMessage[] {
    const messages = this.orderedIds.flatMap(id => {
      const value = this.byId.get(id)
      if (value === undefined) return []
      const copy = { ...value }
      inheritAssistantStream(value, copy)
      return [copy]
    })
    const live = this.liveAttempt?.message
    if (live !== undefined) {
      const copy = { ...live }
      inheritAssistantStream(live, copy)
      messages.push(copy)
    }
    return messages
  }

  private set(id: string, message: ConversationMessage): void {
    if (!this.byId.has(id)) this.orderedIds.push(id)
    this.byId.set(id, message)
  }
}

function mergeImages(current: readonly ConversationImage[] | undefined, next: readonly ConversationImage[]): ConversationImage[] {
  const images = new Map((current ?? []).map(image => [image.attachmentId, image]))
  for (const image of next) images.set(image.attachmentId, image)
  return [...images.values()]
}
