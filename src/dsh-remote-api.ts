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

  prompt(sessionId: string, text: string, attachments: readonly PromptAttachment[] = [], mode: PromptMode = 'queue'): Promise<{ accepted: true }> {
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
    return this.call('session/prompt', {
      request: {
        requestId: randomUUID(), sessionId, mode, content,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    })
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
