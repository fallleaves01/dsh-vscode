import { randomUUID } from 'node:crypto'
import type { DshConnection } from './dsh-connection.js'
import type { PromptAttachment, PromptMode, QueueAction, SessionSummary } from './dsh-client.js'

/** Named-argument contracts of the 0.1.2 Session Remotes, independent of the UI. */
export class DshRemoteApi {
  constructor(private readonly connection: DshConnection, private readonly signal?: AbortSignal) {}

  listSessions(): Promise<{ items: SessionSummary[] }> {
    return this.call('session/list', { _request: {} })
  }

  createSession(cwd: string): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.call('session/create', { request: { cwd } })
  }

  renameSession(sessionId: string, title: string): Promise<{ title: string; seq?: number }> {
    return this.call('session/rename', { request: { sessionId, title } })
  }

  /**
   * Deliver one user message.
   * @param parentSessionId - owning conversation when the target is a subagent
   *   child, which DSH refuses to prompt as an ordinary session.
   */
  async prompt(
    sessionId: string,
    text: string,
    attachments: readonly PromptAttachment[] = [],
    mode: PromptMode = 'queue',
    parentSessionId?: string,
  ): Promise<{ accepted: true }> {
    // Image bytes ride the prompt; files ride the receipt minted by
    // `fileUploads/upload`. Both are the shapes the Host accepts on the wire.
    const content: Array<PromptAttachment | { type: 'text'; text: string }> = attachments.map(attachment => (
      attachment.type === 'image'
        ? {
            type: 'image' as const,
            mediaType: attachment.mediaType,
            data: attachment.data,
            ...(attachment.name === undefined ? {} : { name: attachment.name }),
          }
        : { type: 'file' as const, receiptId: attachment.receiptId }
    ))
    if (text !== '') content.push({ type: 'text', text })
    const requestId = randomUUID()
    const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (parentSessionId !== undefined) {
      // A child is driven through subagent delivery. Its content cannot carry a
      // durable file reference: the Host admits and persists what it can verify
      // itself, so a receipt minted for the parent would be unverifiable. Refuse
      // here, while the composer still holds the text, rather than let the Host
      // reject the whole message with an opaque code.
      if (attachments.some(attachment => attachment.type === 'file')) {
        throw new Error('A subagent conversation cannot receive file attachments. Remove them, or send them in the conversation that started it.')
      }
      return this.call('subagents/prompt', {
        request: {
          requestId, parentSessionId, childSessionId: sessionId, mode: 'continuable',
          delivery: mode, content, clientTimeZone,
        },
      })
    }
    return this.call('session/prompt', { request: { requestId, sessionId, mode, content, clientTimeZone } })
  }

  cancel(sessionId: string): Promise<{ accepted: true }> {
    return this.call('session/cancel', { request: { sessionId } })
  }

  updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<{ accepted: true }> {
    return this.call('session/updateQueue', { request: { sessionId, itemId, action } })
  }

  private call<T>(endpoint: string, args: Record<string, unknown>): Promise<T> {
    return this.connection.call(endpoint, args, 30_000, this.signal)
  }
}
