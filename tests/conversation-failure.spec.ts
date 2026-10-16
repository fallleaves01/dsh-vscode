import { describe, expect, it } from 'vitest'
import { ConversationProjector, type DshEvent } from '../src/conversation.js'

const event = (type: string, seq: number, data: unknown): DshEvent => ({ type, seq, time: seq * 1000, data })
const chunk = (value: Record<string, unknown>) => ({ type: 'chunk', time: 1000, chunk: value })
const attempt = (seq: number, turn = 1, step = 1, text = 'Received answer'): DshEvent => event('assistant/attempt', seq, {
  turn, step, stream: [
    { type: 'reasoning-chunks', index: 0, time0: 1000, texts: ['Checking'], dt: [] },
    { type: 'text-chunks', index: 1, time0: 1000, texts: [text], dt: [] },
    chunk({ type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Checking' } }),
    chunk({ type: 'block-end', index: 1, block: { type: 'text', text } }),
  ],
})
const end = (seq: number, turn = 1, message = 'Provider finish_reason: content_filter', code = 'PI_AI_ERROR'): DshEvent => event('turn/end', seq, {
  turn, reason: { kind: 'error', error: { message, code } },
})

describe('failed assistant output', () => {
  it('replaces the live prefix with the durable failed text and restores the exact error on reload', () => {
    const p = new ConversationProjector()
    p.apply(event('turn/start', 1, { turn: 1 }))
    p.applyStream({ kind: 'start', attemptId: 'live', turn: 1, step: 1 })
    p.applyStream({ kind: 'chunk', attemptId: 'live', chunk: { type: 'text-delta', index: 1, text: 'Received' } })
    p.apply(attempt(3)); p.apply(end(4))
    const expected = [{ id: 'assistant-attempt:3', role: 'assistant', text: 'Received answer', reasoning: 'Checking', streaming: false, failed: true,
      detail: 'PI_AI_ERROR: Provider finish_reason: content_filter' }]
    expect(p.messages()).toEqual(expected)
    p.reset([event('turn/start', 1, { turn: 1 }), attempt(3), end(4)])
    expect(p.messages()).toEqual(expected)
    expect(p.messageMeta().get('assistant-attempt:3')).toEqual({ seq: 3, time: 4000, turn: 1, step: 1 })
  })

  it('recovers unfinished blocks and images while excluding tool arguments', () => {
    const p = new ConversationProjector()
    p.apply(event('assistant/attempt', 2, { turn: 1, step: 1, stream: [
      chunk({ type: 'text-delta', index: 2, text: 'Later' }),
      { type: 'tool-call-chunks', index: 1, time0: 1000, id: 'call', name: 'bash', args: ['do not display'], dt: [] },
      chunk({ type: 'reasoning-delta', index: 0, text: 'Partial analysis' }),
      chunk({ type: 'text-delta', index: 1, text: 'First ' }),
      chunk({ type: 'text-delta', index: 1, text: 'answer' }),
      chunk({ type: 'block-end', index: 3, block: { type: 'image', attachment: { attachmentId: 'img', mediaType: 'image/png', width: 10, height: 20 } } }),
    ] }))
    expect(p.messages()).toMatchObject([{ text: 'First answer\nLater', reasoning: 'Partial analysis', failed: true, images: [{ attachmentId: 'img' }] }])
    expect(JSON.stringify(p.messages())).not.toContain('do not display')
  })

  it('retains distinct failed retries and their own reasons when the step later succeeds', () => {
    const p = new ConversationProjector()
    p.reset([
      attempt(2), event('llm/retry', 3, { turn: 1, step: 1, failure: { code: 'TIMEOUT', message: 'First failure' } }),
      attempt(4, 1, 1, 'Second attempt'), event('llm/retry', 5, { turn: 1, step: 1, failure: { code: 'TRANSPORT', message: 'Second failure' } }),
      event('assistant/message', 6, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Successful answer' }] } }),
      event('turn/end', 7, { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(p.messages()).toMatchObject([
      { id: 'assistant-attempt:2', text: 'Received answer', failed: true, detail: 'TIMEOUT: First failure' },
      { id: 'assistant-attempt:4', text: 'Second attempt', failed: true, detail: 'TRANSPORT: Second failure' },
      { id: 'assistant:1:1', text: 'Successful answer' },
    ])
    expect(p.messages()[2]?.failed).toBeUndefined()
  })

  it('does not attribute a new step failure to an earlier failed retry', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), event('llm/retry', 3, { turn: 1, step: 1, failure: { message: 'Earlier failure' } }),
      event('step/start', 4, { turn: 1, step: 2 }), end(5)])
    expect(p.messages()).toMatchObject([
      { id: 'assistant-attempt:2', detail: 'Earlier failure' },
      { id: 'assistant-error:5', text: '', failed: true, detail: 'PI_AI_ERROR: Provider finish_reason: content_filter' },
    ])
  })

  it('shows an error without output and merges it into the attempt when earlier history is loaded', () => {
    const p = new ConversationProjector()
    p.reset([end(4)])
    expect(p.messages()).toMatchObject([{ id: 'assistant-error:4', text: '', failed: true, detail: expect.stringContaining('content_filter') }])
    p.reset([attempt(3), end(4)])
    expect(p.messages()).toHaveLength(1)
    expect(p.messages()[0]).toMatchObject({ id: 'assistant-attempt:3', text: 'Received answer', detail: expect.stringContaining('content_filter') })
  })

  it('keeps legacy durable chunks when their turn fails', () => {
    const p = new ConversationProjector()
    p.reset([event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'Legacy prefix' } }), end(4)])
    expect(p.messages()).toMatchObject([{ id: 'assistant:1:1', text: 'Legacy prefix', streaming: false, failed: true, detail: expect.stringContaining('PI_AI_ERROR') }])
  })

  it('retains a live prefix if a terminal error arrives without a settled attempt', () => {
    const p = new ConversationProjector()
    p.applyStream({ kind: 'start', attemptId: 'live', turn: 1, step: 1 })
    p.applyStream({ kind: 'chunk', attemptId: 'live', chunk: { type: 'text-delta', index: 0, text: 'Visible output' } })
    p.apply(end(4))
    expect(p.messages()).toMatchObject([{ id: 'assistant-live:live', text: 'Visible output', streaming: false, failed: true, detail: expect.stringContaining('content_filter') }])
  })

  it('shows a fallback error for empty or malformed recorded streams', () => {
    const p = new ConversationProjector()
    p.reset([event('assistant/attempt', 2, { turn: 1, step: 1, stream: [null, {}, { type: 'text-chunks', index: 1, texts: null }] })])
    expect(p.messages()).toMatchObject([{ text: '', failed: true, detail: expect.stringContaining('not available') }])
  })

  it('clears failure state when the conversation changes', () => {
    const p = new ConversationProjector(); p.reset([attempt(2), end(3)])
    p.reset([event('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Other session' }] } })])
    expect(p.messages()).toEqual([{ id: 'assistant:1:1', role: 'assistant', text: 'Other session' }])
  })

  it('redacts credentials from failure details while preserving the reason', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), end(3, 1, 'Request rejected\nAuthorization: Bearer fixture-private-key', 'AUTH')])
    expect(p.messages()[0]?.detail).toBe('AUTH: Request rejected\nAuthorization: [redacted]')
    expect(p.messages()[0]?.detail).not.toContain('fixture-private-key')
  })

  it('redacts URL user credentials from provider diagnostics', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), end(3, 1, 'Cannot connect to https://fixture-user:fixture-password@example.invalid/v1', 'AUTH')])
    expect(p.messages()[0]?.detail).toBe('AUTH: Cannot connect to https://[redacted]@example.invalid/v1')
  })
})
