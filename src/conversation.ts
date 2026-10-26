import { withoutIdeContext } from './ide-context.js'
import { tokenUsageOf, turnUsageOf, type TokenUsage, type TurnTokenUsage } from './token-usage.js'
import type { ImageMediaType } from './dsh-client.js'
import { presentSubagentReferences, presentToolCall, presentToolResult } from './tool-presentation.js'
import type { AssistantAttempt, AssistantStreamUpdate } from './dsh-assistant-stream.js'
import { redactDshSecrets } from './runtime-output.js'

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
  /**
   * Wall time the turn took, in milliseconds, from the `turn/start` event that
   * opened it to the reply that closed it.
   *
   * Absent when no `turn/start` is in the loaded window, because DSH shows no
   * duration rather than a wrong one. Measuring from the first assistant message
   * would do exactly that: it drops the prompt latency and the first step's model
   * time, and on a single-step turn it measures zero.
   */
  turnDurationMs?: number
}

/**
 * Decide which message carries a turn's action row, and what the turn cost.
 *
 * DSH renders the row once per *completed* turn on that turn's closing assistant
 * message and shows the turn's aggregate usage there, so the fold belongs here
 * rather than on each step. A turn with any step still streaming has no row: a
 * row shown mid-turn would move, and its duration would change under the reader.
 * A stopped turn still closes, because the runtime settles an interrupted step
 * with its own `assistant/message`.
 *
 * `turnStarts` is the projector's record of `turn/start` times by turn number,
 * which is the only event that says when the turn actually began.
 */
export function turnFooters(
  messages: readonly ConversationMessage[],
  meta: ReadonlyMap<string, MessageMeta>,
  turnStarts: ReadonlyMap<number, number>,
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
  for (const [turn, group] of turns) {
    if (group.some(message => message.streaming === true)) continue
    const closing = group[group.length - 1]
    if (closing === undefined) continue
    const usages = group.map(message => meta.get(message.id)?.usage)
    // No routes: attributing a turn to a provider needs the model that served
    // each call, which the projection does not carry. Naming the message id here
    // would put a nonsense first line in the usage panel, and the panel omits the
    // line when there is no route.
    const turnUsage = turnUsageOf(usages, [])
    const startedAt = turnStarts.get(turn)
    const closedAt = meta.get(closing.id)?.time
    const turnDurationMs = startedAt === undefined || closedAt === undefined || !Number.isFinite(closedAt)
      ? undefined
      : closedAt - startedAt
    footers.set(closing.id, {
      turnEnd: true,
      ...(turnUsage === undefined ? {} : { turnUsage }),
      ...(turnDurationMs === undefined || turnDurationMs <= 0 ? {} : { turnDurationMs }),
    })
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
  /**
   * Original runtime failure code (`AUTH`, `SERVER`, `INTERRUPTED`, …).
   *
   * Kept beside the message rather than prefixed into {@link detail}: the
   * sidebar renders it as its own code element, the way DSH's own client does.
   */
  failureCode?: string
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

const missingFailureReason = 'Error details are not available in this part of the conversation history.'

/** Longest decoded provider message rendered inline. */
const FAILURE_DETAIL_LIMIT = 2_000

/** One recorded failure, split into what the sidebar shows and the runtime's code. */
export interface ConversationFailure {
  /** Human-readable reason, redacted and without the runtime code prefix. */
  detail: string
  /** Original runtime code when it supplied one; absent for live-stream failures. */
  code?: string
}

/**
 * Read the provider error body many model gateways return in the failure text.
 *
 * A gateway HTTP 500 arrives as a JSON document, e.g.
 * `{"error":{"message":"Internal Server Error","code":500}}`. The raw document
 * is correct on the wire and useless in the sidebar, so the visible reason is
 * the provider's own message with the numeric HTTP status appended. Anything
 * that does not parse — or does not have the `error.message` shape — is kept
 * verbatim, because a provider can also report a plain sentence.
 */
function decodedFailureDetail(raw: string): string {
  if (raw.length > 1_000_000) return raw
  let value: unknown
  try { value = JSON.parse(raw) } catch { return raw }
  const error = record(record(value)?.error)
  if (error === undefined) return raw
  const message = typeof error.message === 'string' && error.message.trim() !== '' ? error.message : undefined
  if (message === undefined) return raw
  const httpStatus = typeof error.code === 'number' && Number.isFinite(error.code) ? error.code
    : typeof error.status === 'number' && Number.isFinite(error.status) ? error.status
      : undefined
  return httpStatus === undefined ? message : `${message} (HTTP ${String(httpStatus)})`
}

function truncatedFailureDetail(value: string): string {
  return value.length <= FAILURE_DETAIL_LIMIT ? value : `${value.slice(0, FAILURE_DETAIL_LIMIT)}…`
}

function failureOf(value: unknown): ConversationFailure {
  const failure = record(value)
  const message = typeof failure?.message === 'string' && failure.message !== '' ? failure.message
    : typeof value === 'string' && value !== '' ? value : missingFailureReason
  const code = typeof failure?.code === 'string' && failure.code !== '' ? failure.code : undefined
  return {
    detail: redactDshSecrets(truncatedFailureDetail(decodedFailureDetail(message))),
    ...(code === undefined ? {} : { code }),
  }
}

/** Apply one failure to a message, clearing a stale code when the newer one has none. */
function withFailure(message: ConversationMessage, failure: ConversationFailure): ConversationMessage {
  const next: ConversationMessage = { ...message, failed: true, detail: failure.detail }
  if (failure.code === undefined) delete next.failureCode
  else next.failureCode = failure.code
  return next
}

/** Recover the durable failed stream without treating tool arguments as reply text. */
function attemptedContent(value: unknown): Pick<ConversationMessage, 'text' | 'reasoning' | 'images'> {
  const blocks = new Map<number, { type: 'text' | 'reasoning'; parts: string[] }>()
  const images: ConversationImage[] = []
  const append = (index: number, type: 'text' | 'reasoning', parts: string[]): void => {
    const current = blocks.get(index)
    if (current?.type === type) {
      for (const part of parts) current.parts.push(part)
    } else blocks.set(index, { type, parts })
  }
  for (const raw of Array.isArray(value) ? value : []) {
    const run = record(raw)
    if (run === undefined) continue
    if ((run.type === 'text-chunks' || run.type === 'reasoning-chunks') && typeof run.index === 'number'
      && Number.isSafeInteger(run.index) && run.index >= 0 && Array.isArray(run.texts)) {
      append(run.index, run.type === 'text-chunks' ? 'text' : 'reasoning', run.texts.filter((text): text is string => typeof text === 'string'))
      continue
    }
    const chunk = run.type === 'chunk' ? record(run.chunk) : undefined
    if (chunk === undefined || typeof chunk.index !== 'number' || !Number.isSafeInteger(chunk.index) || chunk.index < 0) continue
    if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && typeof chunk.text === 'string') {
      append(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning', [chunk.text])
    } else if (chunk.type === 'block-end') {
      const block = record(chunk.block)
      // A completed block replaces its deltas; appending it would duplicate the answer.
      if ((block?.type === 'text' || block?.type === 'reasoning') && typeof block.text === 'string') {
        blocks.set(chunk.index, { type: block.type, parts: [block.text] })
      }
      images.push(...imageContent(block))
    }
  }
  const ordered = [...blocks].sort(([left], [right]) => left - right).map(([, block]) => block)
  const text = ordered.filter(block => block.type === 'text').map(block => block.parts.join('')).join('\n')
  const reasoning = ordered.filter(block => block.type === 'reasoning').map(block => block.parts.join('')).join('\n')
  return { text, ...(reasoning === '' ? {} : { reasoning }), ...(images.length === 0 ? {} : { images: mergeImages(undefined, images) }) }
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
  /** When each turn opened, from its `turn/start` event: the only start there is. */
  private readonly turnStarts = new Map<number, number>()
  private readonly turnSteps = new Map<number, { step: number; assistantId?: string }>()
  /** A terminal event can reach the view before the live stream releases its settlement. */
  private readonly turnFailures = new Map<number, { id: string; seq: number; time: number; step?: number; failure: ConversationFailure }>()
  private readonly pendingRetryFailures = new Map<string, { seq: number; failure: ConversationFailure }>()
  private readonly hiddenCommandIds = new Set<string>()
  private liveAttempt: (AssistantAttempt & { message?: ConversationMessage }) | undefined

  reset(entries: readonly (DshEvent | { event: DshEvent; view?: unknown })[], preserveLive = false): void {
    const live = preserveLive ? this.liveAttempt : undefined
    this.liveAttempt = undefined
    this.orderedIds.length = 0
    this.byId.clear()
    this.meta.clear()
    this.turnStarts.clear()
    this.turnSteps.clear()
    this.turnFailures.clear()
    this.pendingRetryFailures.clear()
    this.hiddenCommandIds.clear()
    for (const entry of entries) {
      if ('event' in entry) this.apply(entry.event, entry.view)
      else this.apply(entry)
    }
    this.liveAttempt = live
    if (live !== undefined) this.turnSteps.set(live.turn, { step: live.step, assistantId: `assistant-live:${live.attemptId}` })
  }

  /** Live text is replaced by its durable settlement, including failed attempts. */
  applyStream(update: AssistantStreamUpdate): void {
    if (update.kind === 'start') {
      this.liveAttempt = { ...update }
      this.turnSteps.set(update.turn, { step: update.step, assistantId: `assistant-live:${update.attemptId}` })
      return
    }
    const active = this.liveAttempt
    if (active?.attemptId !== update.attemptId) return
    if (update.kind === 'end') {
      // A live stream has no runtime code to show: this is the client noticing
      // that the response never settled, not a Host-reported failure.
      if (active.message !== undefined) this.set(active.message.id, withFailure({ ...active.message, streaming: false }, {
        detail: 'The response ended before it could be saved. The received output is retained in this view only.',
      }))
      this.liveAttempt = undefined
      return
    }
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
    // The turn's own start is the durable record of when the user's wait began:
    // neither the prompt nor an assistant message carries it.
    if (event.type === 'turn/start') {
      if (typeof data.turn === 'number' && Number.isFinite(event.time)) this.turnStarts.set(data.turn, event.time)
      return
    }
    if ((event.type === 'assistant/message' || event.type === 'assistant/attempt')
      && this.liveAttempt?.turn === data.turn && this.liveAttempt?.step === data.step
      && (event.type === 'assistant/attempt' || event.surfaceOp === 'append')) this.liveAttempt = undefined

    if (event.type === 'step/start' && typeof data.turn === 'number' && typeof data.step === 'number') {
      this.turnSteps.set(data.turn, { step: data.step })
      return
    }

    if (event.type === 'assistant/attempt' && typeof data.turn === 'number' && typeof data.step === 'number') {
      // Every attempt has its own durable sequence, even when the next retry uses the same step.
      const id = `assistant-attempt:${String(event.seq)}`
      const ended = this.turnFailures.get(data.turn)
      const terminal = ended !== undefined && event.seq < ended.seq && (ended.step === undefined || ended.step === data.step) ? ended : undefined
      const retryKey = `${data.turn}:${data.step}`
      const queuedRetry = this.pendingRetryFailures.get(retryKey)
      const retry = queuedRetry !== undefined && event.seq < queuedRetry.seq ? queuedRetry : undefined
      this.pendingRetryFailures.delete(retryKey)
      if (terminal !== undefined && terminal.id !== id && (terminal.id.startsWith('assistant-live:') || terminal.id.startsWith('assistant-error:'))) {
        this.byId.delete(terminal.id); this.meta.delete(terminal.id)
        const index = this.orderedIds.indexOf(terminal.id)
        if (index >= 0) this.orderedIds.splice(index, 1)
        terminal.id = id
      }
      // The terminal reason and a queued retry each carry the code beside the
      // detail; terminal wins over retry, and both win over earlier attempts.
      const inherited = terminal?.failure ?? retry?.failure
      const existing = this.byId.get(id)
      const failure = inherited ?? {
        detail: existing?.detail ?? missingFailureReason,
        ...(existing?.failureCode === undefined ? {} : { code: existing.failureCode }),
      }
      this.set(id, withFailure({
        id, role: 'assistant', ...attemptedContent(data.stream),
        ...(terminal === undefined ? {} : { streaming: false }),
      }, failure))
      this.meta.set(id, { seq: event.seq, time: terminal?.time ?? event.time, turn: data.turn, step: data.step })
      this.turnSteps.set(data.turn, { step: data.step, assistantId: id })
      return
    }

    if (event.type === 'llm/retry' && typeof data.turn === 'number' && typeof data.step === 'number') {
      const step = this.turnSteps.get(data.turn)
      const current = step?.assistantId === undefined ? undefined : this.byId.get(step.assistantId)
      const failure = failureOf(data.failure)
      if (step?.step === data.step && current?.failed === true) this.set(current.id, withFailure(current, failure))
      else this.pendingRetryFailures.set(`${data.turn}:${data.step}`, { seq: event.seq, failure })
      return
    }

    if (event.type === 'turn/end' && typeof data.turn === 'number') {
      const reason = record(data.reason)
      if (reason?.kind !== 'error') return
      const step = this.turnSteps.get(data.turn)
      const saved = step?.assistantId === undefined ? undefined : this.byId.get(step.assistantId)
      const live = this.liveAttempt?.turn === data.turn ? this.liveAttempt.message : undefined
      const current = live ?? (saved?.failed === true || saved?.streaming === true ? saved : undefined)
      const id = current?.id ?? `assistant-error:${String(event.seq)}`
      const failure = failureOf(reason.error)
      this.set(id, withFailure({ ...(current ?? { id, role: 'assistant', text: '' }), streaming: false }, failure))
      this.turnFailures.set(data.turn, { id, seq: event.seq, time: event.time, ...(step === undefined ? {} : { step: step.step }), failure })
      this.meta.set(id, { seq: this.meta.get(id)?.seq ?? event.seq, time: event.time, turn: data.turn, ...(step === undefined ? {} : { step: step.step }) })
      if (this.liveAttempt?.turn === data.turn) this.liveAttempt = undefined
      return
    }

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
      if (typeof data.turn === 'number' && typeof data.step === 'number') this.turnSteps.set(data.turn, { step: data.step, assistantId: id })
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
        this.noteStreaming(id, event, data)
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
      this.noteStreaming(id, event, data)
      return
    }

    if (event.type === 'assistant/message') {
      const message = record(data.message)
      const id = `assistant:${String(data.turn)}:${String(data.step)}`
      if (typeof data.turn === 'number' && typeof data.step === 'number') this.turnSteps.set(data.turn, { step: data.step, assistantId: id })
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
        callView: presentSubagentReferences(toolView(view, 'call') ?? presentToolCall(name, data.arguments), name, data.arguments),
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
        resultView: presentSubagentReferences(toolView(view, 'result') ?? presentToolResult(current?.text ?? '', current?.rawInput, event, failed),
          current?.text ?? '', current?.rawInput, rawResult, data.meta, failed),
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

  /**
   * Note a step that is still being written.
   *
   * The turn fold needs to see it: leaving streaming steps out of the meta made
   * a multi-step turn look finished after its first step, so its action row
   * appeared mid-turn and its duration then changed. The settled
   * `assistant/message` that follows replaces this entry, usage and all.
   *
   * An entry that already carries usage is left alone: a chunk that arrives after
   * its step settled — a late block-end, for instance — must not erase the tokens
   * the turn's bill is computed from.
   */
  private noteStreaming(id: string, event: DshEvent, data: Record<string, unknown>): void {
    if (this.meta.get(id)?.usage !== undefined) return
    this.meta.set(id, {
      seq: event.seq, time: event.time,
      ...(typeof data.turn === 'number' ? { turn: data.turn } : {}),
      ...(typeof data.step === 'number' ? { step: data.step } : {}),
    })
  }

  /** The sidecar facts for the messages currently held, keyed by message id. */
  messageMeta(): Map<string, MessageMeta> {
    return new Map(this.meta)
  }

  /** When each held turn opened, in epoch ms, keyed by turn number. */
  turnStartTimes(): Map<number, number> {
    return new Map(this.turnStarts)
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
