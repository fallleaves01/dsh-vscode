import { describe, expect, it } from 'vitest'
import { diffConversationMessages, messageForWebview, messagesPatchForWebview } from '../src/chat-state-patch.js'
import { ConversationProjector, type ConversationMessage, type DshEvent } from '../src/conversation.js'

function message(id: string, text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id, role: 'assistant', text, ...extra }
}

describe('diffConversationMessages', () => {
  it('uses projector deltas across batched chunks', () => {
    const projector = new ConversationProjector()
    const chunk = (seq: number, text: string): DshEvent => ({
      type: 'assistant/chunk', seq, time: seq,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', text } },
    })
    projector.apply(chunk(1, 'A'.repeat(50_000)))
    const previous = projector.messages()
    projector.apply(chunk(2, 'second'))
    projector.apply(chunk(3, ' third'))

    expect(diffConversationMessages(previous, projector.messages())).toEqual({
      appends: [{ id: 'assistant:1:1', text: 'second third', streaming: true }],
    })
  })

  it('sends only the streaming message that changed', () => {
    const previous = [message('tool:1', 'Tool', { role: 'tool', rawResult: 'large output' }), message('assistant:1', 'Hel', { streaming: true })]
    const next = [message('tool:1', 'Tool', { role: 'tool', rawResult: 'large output' }), message('assistant:1', 'Hello', { streaming: true })]

    expect(diffConversationMessages(previous, next)).toEqual({
      appends: [{ id: 'assistant:1', text: 'lo', streaming: true }],
    })
  })

  it('appends new messages without resetting existing output', () => {
    const previous = [message('assistant:1', 'Done')]
    const next = [...previous, message('assistant:2', 'Next', { streaming: true })]

    expect(diffConversationMessages(previous, next)).toEqual({ upserts: [next[1]] })
  })

  it('finishes a streaming message without resending its full text', () => {
    const previous = [message('assistant:1', 'Complete response', { streaming: true })]
    const next = [message('assistant:1', 'Complete response')]

    expect(diffConversationMessages(previous, next)).toEqual({
      appends: [{ id: 'assistant:1', text: '', streaming: false }],
    })
  })

  it('streams thinking as a reasoning append beside the answer text', () => {
    const previous = [message('assistant:1', '', { streaming: true, reasoning: 'Think' })]
    const next = [message('assistant:1', '', { streaming: true, reasoning: 'Thinking' })]

    expect(diffConversationMessages(previous, next)).toEqual({
      appends: [{ id: 'assistant:1', text: '', streaming: true, reasoning: 'ing' }],
    })
  })

  it('falls back to an upsert when settled thinking is rewritten', () => {
    const previous = [message('assistant:1', 'Answer', { streaming: true, reasoning: 'Draft' })]
    const next = [message('assistant:1', 'Answer', { reasoning: 'A rewritten thought' })]

    expect(diffConversationMessages(previous, next)).toEqual({ upserts: next })
  })

  it('falls back to an upsert when streamed text is rewritten', () => {
    const previous = [message('assistant:1', 'Original', { streaming: true })]
    const next = [message('assistant:1', 'Replacement', { streaming: true })]

    expect(diffConversationMessages(previous, next)).toEqual({ upserts: next })
  })

  it('treats equivalent image projections as unchanged', () => {
    const images = [{ attachmentId: 'image-1', mediaType: 'image/png' as const, width: 20, height: 10, data: 'abc' }]
    const previous = [message('assistant:1', '', { images })]
    const next = [message('assistant:1', '', { images: images.map(image => ({ ...image })) })]

    expect(diffConversationMessages(previous, next)).toBeUndefined()
  })

  it('resets when history is inserted before existing messages', () => {
    const previous = [message('assistant:2', 'Current')]
    const next = [message('assistant:1', 'Earlier'), ...previous]

    expect(diffConversationMessages(previous, next)).toEqual({ reset: next })
  })

  it('defers completed tool bodies while preserving their summary', () => {
    const tool = message('tool:large', 'mcp_router_status', {
      role: 'tool',
      detail: 'Completed',
      rawInput: '{"verbose":true}',
      rawResult: 'x'.repeat(100_000),
      callView: { card: 'generic', title: 'Router status', rawInput: 'large input' },
      resultView: { card: 'generic', title: 'Router status', content: 'large output' },
    })

    expect(messageForWebview(tool)).toEqual({
      id: 'tool:large',
      role: 'tool',
      text: 'mcp_router_status',
      detail: 'Completed',
      callView: { card: 'generic', title: 'Router status' },
      resultView: { card: 'generic', title: 'Router status' },
      deferredBody: true,
      deferredBodyRevision: 'settled:17:0:16:100000:',
      bodyLength: 100_000,
    })
  })

  it('defers tool bodies inside resets and upserts', () => {
    const tool = message('tool:large', 'Tool', { role: 'tool', rawResult: 'large output' })
    const patch = messagesPatchForWebview({ reset: [tool], upserts: [tool] })

    expect(patch.reset?.[0]?.deferredBody).toBe(true)
    expect(patch.upserts?.[0]?.deferredBody).toBe(true)
  })

  it('defers streaming tools, large commands, and completed long responses', () => {
    expect(messageForWebview(message('tool:running', 'Write', {
      role: 'tool', streaming: true, rawInput: 'x'.repeat(50_000), callView: { card: 'diff', title: 'Write' },
    })).deferredBody).toBe(true)

    expect(messageForWebview(message('command:1', '/compact', {
      role: 'command', rawResult: 'x'.repeat(50_000),
    })).deferredBody).toBe(true)

    const assistant = messageForWebview(message('assistant:large', 'x'.repeat(50_000)))
    expect(assistant).toMatchObject({ role: 'assistant', text: '', deferredBody: true, bodyLength: 50_000 })
  })

  it('keeps the streaming flag on a deferred running tool', () => {
    const tool = messageForWebview(message('tool:running', 'Write', {
      role: 'tool', streaming: true, detail: 'Running…', callView: { card: 'diff', title: 'Write' },
    }))
    expect(tool.deferredBody).toBe(true)
    expect(tool.streaming).toBe(true)
  })

  it('keeps a short assistant answer with hydrated images inline', () => {
    const answer = message('assistant:1', 'Here it is.', {
      images: [{ attachmentId: 'image', mediaType: 'image/png', width: 10, height: 10, data: 'abc' }],
    })
    expect(messageForWebview(answer)).toBe(answer)
  })

  it('changes the deferred revision when an image finishes hydrating', () => {
    const base = message('tool:image', 'Image', {
      role: 'tool', images: [{ attachmentId: 'image', mediaType: 'image/png', width: 10, height: 10 }],
    })
    const hydrated = messageForWebview({ ...base, images: base.images?.map(image => ({ ...image, data: 'abc' })) })
    expect(hydrated.deferredBodyRevision).not.toBe(messageForWebview(base).deferredBodyRevision)
  })

  it('keeps the failure code on a deferred failed response', () => {
    const deferred = messageForWebview(message('assistant:failed', 'x'.repeat(50_000), {
      failed: true, detail: 'Internal Server Error (HTTP 500)', failureCode: 'SERVER',
    }))
    expect(deferred.deferredBody).toBe(true)
    expect(deferred.failureCode).toBe('SERVER')
    expect(deferred.detail).toBe('Internal Server Error (HTTP 500)')
  })

  it('treats a changed failure code as a real update', () => {
    const failed = message('assistant:1', '', { failed: true, detail: 'Server error' })
    const coded = { ...failed, failureCode: 'SERVER' }
    expect(diffConversationMessages([failed], [coded])).toEqual({ upserts: [coded] })
    // Identical failure facts produce no patch at all.
    expect(diffConversationMessages([coded], [{ ...failed, failureCode: 'SERVER' }])).toBeUndefined()
    // A code change can never be folded into a streaming append: that path
    // carries text only, so the update would be lost.
    const streaming = message('assistant:2', 'Hello', { streaming: true, failed: true, detail: 'Failed' })
    const retried = { ...streaming, failureCode: 'AUTH' }
    expect(diffConversationMessages([streaming], [retried])).toEqual({ upserts: [retried] })
  })

  it('keeps retry rows and limit notices replaceable as values', () => {
    const retryMessage: ConversationMessage = {
      id: 'retry:chain', role: 'retry', text: '',
      retry: { retryId: 'chain', retry: 1, maxRetries: 3, mode: 'normal', delayMs: 400, state: 'scheduled', detail: 'First', failureCode: 'TIMEOUT' },
    }
    // A retry row has no body to compact, so it is sent unchanged.
    expect(messageForWebview(retryMessage)).toBe(retryMessage)
    // The started frame repeats the retry number and changes only the state; the
    // row must still be re-sent, or the assistant stays "Retrying" forever.
    const sameAttempt: ConversationMessage = { ...retryMessage, retry: { ...retryMessage.retry!, state: 'started' } }
    expect(diffConversationMessages([retryMessage], [sameAttempt])).toEqual({ upserts: [sameAttempt] })
    const started: ConversationMessage = { ...retryMessage, retry: { ...retryMessage.retry!, state: 'started', retry: 2 } }
    expect(diffConversationMessages([retryMessage], [started])).toEqual({ upserts: [started] })
    // Identical retry values are not re-sent.
    expect(diffConversationMessages([started], [{ ...started, retry: { ...started.retry! } }])).toBeUndefined()

    const limit: ConversationMessage = { id: 'limit:1', role: 'limit', text: '' }
    expect(messageForWebview(limit)).toBe(limit)
    expect(diffConversationMessages([limit], [{ ...limit, detail: 'changed' }])).toEqual({ upserts: [{ ...limit, detail: 'changed' }] })
  })
})

describe('auto review denial patches', () => {
  const denied = (reason: string | null): ConversationMessage => ({
    id: 'tool:call-1', role: 'tool', text: 'bash', detail: 'Rejected by Auto review', failed: true,
    rawResult: 'denied content',
    resultView: { card: 'terminal', title: 'bash', output: 'denied content' },
    autoReviewDenied: { reason },
  })

  it('passes the denial through compacted tool bodies', () => {
    const compact = messageForWebview(denied('Not allowed.'))
    expect(compact.deferredBody).toBe(true)
    expect(compact.autoReviewDenied).toEqual({ reason: 'Not allowed.' })
    // The reason is part of the row's value, not a body byte count.
    expect(messageForWebview({ ...denied(null), rawResult: undefined, resultView: undefined })).toMatchObject({
      autoReviewDenied: { reason: null },
    })
  })

  it('re-sends a denial when its reason changes and keeps identical values quiet', () => {
    const before = denied('First reason.')
    const after = denied('Second reason.')
    expect(diffConversationMessages([before], [after])).toEqual({ upserts: [after] })
    // The same projected object (the normal delta path) compares quiet.
    expect(diffConversationMessages([after], [after])).toBeUndefined()
  })

  it('re-sends a denial when the reason appears or disappears', () => {
    const withReason = denied('Because.')
    const withoutReason = denied(null)
    expect(diffConversationMessages([withReason], [withoutReason])).toEqual({ upserts: [withoutReason] })
    expect(diffConversationMessages([withoutReason], [withReason])).toEqual({ upserts: [withReason] })
    const generic: ConversationMessage = { ...withoutReason, detail: 'Failed', autoReviewDenied: undefined }
    expect(diffConversationMessages([withoutReason], [generic])).toEqual({ upserts: [generic] })
  })

  it('compares the denial of an already deferred body', () => {
    const deferred = (reason: string | null): ConversationMessage => ({
      ...denied(reason), deferredBody: true, deferredBodyRevision: 'rev:1', bodyLength: 14,
    })
    const first = deferred('First.')
    const second = deferred('Second.')
    // Deferred bodies are sent as-is, and the value still drives the patch.
    expect(messageForWebview(first)).toBe(first)
    expect(diffConversationMessages([first], [second])).toEqual({ upserts: [second] })
    expect(diffConversationMessages([second], [second])).toBeUndefined()
  })
})
