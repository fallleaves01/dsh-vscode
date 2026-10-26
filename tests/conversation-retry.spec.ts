import { describe, expect, it } from 'vitest'
import { ConversationProjector, type DshEvent } from '../src/conversation.js'

const event = (type: string, seq: number, data: unknown): DshEvent => ({ type, seq, time: seq * 1000, data })
const attempt = (seq: number, text = ''): DshEvent => event('assistant/attempt', seq, {
  turn: 1, step: 1, stream: text === '' ? [] : [{ type: 'text-chunks', index: 0, time0: 1000, texts: [text], dt: [] }],
})
const retry = (seq: number, data: Record<string, unknown> = {}): DshEvent => event('llm/retry', seq, {
  retryId: 'chain-1', turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k',
  retry: 1, maxRetries: 3, delayMs: 400, failure: { code: 'TIMEOUT', message: 'First failure' }, ...data,
})
const retryStarted = (seq: number, data: Record<string, unknown> = {}): DshEvent => event('llm/retry-started', seq, {
  retryId: 'chain-1', turn: 1, step: 1, retry: 1, ...data,
})
const end = (seq: number, reason: Record<string, unknown>): DshEvent => event('turn/end', seq, { turn: 1, reason })

describe('model retry process rows', () => {
  it('collapses one retry chain into a single row showing the newest attempt', () => {
    const p = new ConversationProjector()
    p.reset([
      attempt(2),
      retry(3, { retry: 1, delayMs: 400, failure: { code: 'TIMEOUT', message: 'First failure' } }),
      attempt(4),
      retry(5, {
        retry: 2, delayMs: 1_500,
        failure: { code: 'SERVER', message: '{"error":{"message":"Internal Server Error","code":500}}' },
      }),
    ])
    // Both attempts carried no visible output, so only the retry row remains.
    expect(p.messages()).toEqual([{
      id: 'retry:chain-1', role: 'retry', text: '',
      retry: {
        retryId: 'chain-1', retry: 2, maxRetries: 3, mode: 'normal', delayMs: 1_500,
        state: 'scheduled', detail: 'Internal Server Error (HTTP 500)', failureCode: 'SERVER',
      },
    }])
    expect(p.messageMeta().get('retry:chain-1')).toEqual({ seq: 5, time: 5_000, turn: 1, step: 1 })
  })

  it('marks the matching attempt started and ignores a stale retry number', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), retry(3, { retry: 1 })])
    p.apply(retryStarted(4, { retry: 9 }))
    expect(p.messages()[0]?.retry?.state).toBe('scheduled')
    p.apply(retryStarted(5, { retry: 1 }))
    expect(p.messages()).toHaveLength(1)
    expect(p.messages()[0]?.retry?.state).toBe('started')
  })

  it('cancels a retry that is still scheduled when its turn closes', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), retry(3)])
    p.apply(end(4, { kind: 'completed' }))
    expect(p.messages()[0]?.retry?.state).toBe('cancelled')
  })

  it('ignores a start without a matching retry number or after cancellation', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), retry(3, { retry: 1 })])
    // A frame without a usable retry number must not mark the attempt started.
    p.apply(retryStarted(4, { retry: undefined }))
    expect(p.messages()[0]?.retry?.state).toBe('scheduled')
    p.apply(end(5, { kind: 'error', error: { code: 'SERVER', message: 'Upstream failed' } }))
    expect(p.messages().find(message => message.role === 'retry')?.retry?.state).toBe('cancelled')
    // A late frame cannot reopen a chain the closed turn already cancelled.
    p.apply(retryStarted(6, { retry: 1 }))
    expect(p.messages().find(message => message.role === 'retry')?.retry?.state).toBe('cancelled')
  })

  it('keeps a retry row when the next attempt produced visible output, in order', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), retry(3), attempt(4, 'Partial answer')])
    expect(p.messages().map(message => message.role)).toEqual(['retry', 'assistant'])
    expect(p.messages()[1]).toMatchObject({ id: 'assistant-attempt:4', text: 'Partial answer', failed: true })
  })

  it('attaches the terminal error to the last attempt and not to a deleted retry attempt', () => {
    const p = new ConversationProjector()
    p.reset([
      attempt(2),
      retry(3, { failure: { code: 'TIMEOUT', message: 'Gateway timeout' } }),
      attempt(4),
      end(5, { kind: 'error', error: { code: 'SERVER', message: 'Upstream failed' } }),
    ])
    expect(p.messages().map(message => message.id)).toEqual(['retry:chain-1', 'assistant-attempt:4'])
    expect(p.messages()[0]?.retry?.state).toBe('cancelled')
    expect(p.messages()[1]).toMatchObject({
      id: 'assistant-attempt:4', role: 'assistant', text: '', failed: true, streaming: false,
      detail: 'Upstream failed', failureCode: 'SERVER',
    })
  })

  it('handles an unbounded retry policy without a numeric maximum', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), retry(3, { mode: 'always', maxRetries: undefined, retry: 4 })])
    expect(p.messages()[0]?.retry).toMatchObject({ mode: 'always', maxRetries: 0, retry: 4 })
  })

  it('keeps the legacy reason inheritance for a retry event without a retryId', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2), event('llm/retry', 3, { turn: 1, step: 1, failure: { code: 'TIMEOUT', message: 'Legacy reason' } })])
    expect(p.messages()).toHaveLength(1)
    expect(p.messages()[0]).toMatchObject({ id: 'assistant-attempt:2', detail: 'Legacy reason', failureCode: 'TIMEOUT' })
  })

  it('replays the same history identically after a reset', () => {
    const events = [
      attempt(2),
      retry(3),
      attempt(4),
      retry(5, { retry: 2, delayMs: 900 }),
      end(6, { kind: 'completed' }),
    ]
    const p = new ConversationProjector()
    p.reset(events)
    const first = p.messages()
    p.reset(events)
    expect(p.messages()).toEqual(first)
  })
})

describe('output token limit notice', () => {
  it('adds one limit row for a max-tokens turn end and cancels a pending retry', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2, 'Cut-off answer'), retry(3)])
    p.apply(end(5, { kind: 'max-tokens' }))
    expect(p.messages().map(message => message.role)).toEqual(['assistant', 'retry', 'limit'])
    expect(p.messages()[1]?.retry?.state).toBe('cancelled')
    expect(p.messages()[2]).toEqual({ id: 'limit:1', role: 'limit', text: '' })
    expect(p.messageMeta().get('limit:1')).toEqual({ seq: 5, time: 5_000, turn: 1 })
  })

  it('does not add a limit row for other turn endings', () => {
    const p = new ConversationProjector()
    p.reset([attempt(2, 'Done'), end(3, { kind: 'completed' })])
    expect(p.messages().some(message => message.role === 'limit')).toBe(false)
  })

  it('replays the limit row identically after a reset', () => {
    const events = [attempt(2, 'Partial answer'), end(3, { kind: 'max-tokens' })]
    const p = new ConversationProjector()
    p.reset(events)
    expect(p.messages().map(message => message.role)).toEqual(['assistant', 'limit'])
    p.reset(events)
    expect(p.messages().map(message => message.role)).toEqual(['assistant', 'limit'])
  })
})
