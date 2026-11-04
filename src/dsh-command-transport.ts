import type { CommandExecution, PromptAttachment } from './dsh-client.js'

type Format = 'submittedAttachments' | 'images'
type Call = <T>(endpoint: string, args: Record<string, unknown>, timeoutMs?: number) => Promise<T>

/**
 * alpha.3 `CommandSubmitAttachment[]`: image bytes inline, staged files by the
 * receipt the upload call already returned.
 */
function submittedAttachmentsOf(attachments: readonly PromptAttachment[]): Record<string, unknown>[] {
  return attachments.map(attachment => attachment.type === 'file'
    ? { type: 'file', receiptId: attachment.receiptId }
    : {
      type: 'image',
      mediaType: attachment.mediaType,
      data: attachment.data,
      ...(attachment.name === undefined ? {} : { name: attachment.name }),
    })
}

/**
 * alpha.2 `images` carries image bytes only.
 *
 * A staged file must not be silently dropped: submitting the command without
 * the attachment the user chose would run something else than what the card
 * shows. The error names no receipt, so it is safe to show and to log.
 */
function legacyImagesOf(attachments: readonly PromptAttachment[]): Record<string, unknown>[] {
  return attachments.map(attachment => {
    if (attachment.type === 'file') {
      throw new Error('This DeepSeek runtime does not support file attachments on commands; update the runtime, or remove the file and send it as a prompt attachment.')
    }
    return {
      mediaType: attachment.mediaType,
      data: attachment.data,
      ...(attachment.name === undefined ? {} : { name: attachment.name }),
    }
  })
}

/** Negotiate with an empty, non-executing line; never retry the user's command. */
export class DshCommandTransport {
  private format: Promise<Format> | undefined

  constructor(private readonly call: Call) {}

  async execute(sessionId: string, line: string, attachments: readonly PromptAttachment[] = []): Promise<CommandExecution | undefined> {
    const format = await this.resolveFormat(sessionId)
    const payload = format === 'submittedAttachments' ? submittedAttachmentsOf(attachments) : legacyImagesOf(attachments)
    return this.call('commands/execute', { agentId: sessionId, line, [format]: payload }, 300_000)
  }

  private resolveFormat(sessionId: string): Promise<Format> {
    this.format ??= this.probe(sessionId).catch(error => { this.format = undefined; throw error })
    return this.format
  }

  private async probe(sessionId: string): Promise<Format> {
    try {
      // Official execute() parses the line before minting a commandId, emitting
      // lifecycle events, admitting attachments or invoking a command handler.
      const result = await this.call('commands/execute', { agentId: sessionId, line: '', submittedAttachments: [] }, 10_000)
      if (result !== undefined) throw new Error('DSH returned an unexpected command capability response.')
      return 'submittedAttachments'
    } catch (error) {
      // This exact gateway rejection occurs before entering execute(). Other
      // validation, authentication, timeout and transport errors must surface.
      if (error instanceof Error && 'code' in error && error.code === 'gateway/arguments-invalid'
        && error.message.includes('commands/execute: args fields do not match the descriptor:')
        && error.message.includes('missing "images"') && error.message.includes('unexpected "submittedAttachments"')) return 'images'
      throw error
    }
  }
}
