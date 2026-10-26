import { describe, expect, it } from 'vitest'
import { ConversationProjector, type DshEvent } from '../src/conversation.js'

const event = (type: string, seq: number, data: unknown): DshEvent => ({ type, seq, time: seq * 1_000, data })

const call = (seq: number, callId = 'call-1', name = 'bash'): DshEvent => event('tool/call', seq, {
  turn: 1, step: 1, callId, name, arguments: '{"command":"rm -rf build"}',
})

/** A settled tool result in DSH's wire shape; `extra` carries an optional error. */
const result = (seq: number, extra: Record<string, unknown> = {}, callId = 'call-1'): DshEvent => event('tool/result', seq, {
  turn: 1, step: 1,
  message: {
    source: { kind: 'tool', callId },
    content: [{ type: 'tool-result', toolCallId: callId, isError: true, content: [{ type: 'text', text: 'denied content' }] }],
  },
  ...extra,
})

const denial = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'AutoReviewDeniedError', code: 'AUTO_REVIEW_DENIED', ...overrides,
})

describe('Auto review denials', () => {
  it('projects a denial as its own fact with the collapsed DSH label', () => {
    const projector = new ConversationProjector()
    projector.reset([
      call(1),
      result(2, { error: denial({ reason: 'The command deletes build output the turn still needs.' }) }),
    ])
    expect(projector.messages()).toEqual([expect.objectContaining({
      id: 'tool:call-1',
      role: 'tool',
      text: 'bash',
      detail: 'Rejected by Auto review',
      failed: true,
      autoReviewDenied: { reason: 'The command deletes build output the turn still needs.' },
      // The original tool content stays available for diagnostics.
      rawResult: 'denied content',
    })])
    expect(projector.messages()[0]?.resultView).toBeDefined()
  })

  it.each([
    ['missing reason', denial()],
    ['non-string reason', denial({ reason: 42 })],
    ['blank reason', denial({ reason: '   \n  ' })],
  ])('stores a null reason for a %s', (_name, error) => {
    const projector = new ConversationProjector()
    projector.reset([call(1), result(2, { error })])
    expect(projector.messages()[0]).toMatchObject({
      detail: 'Rejected by Auto review', failed: true, autoReviewDenied: { reason: null },
    })
  })

  it('keeps the reviewer reason verbatim, including surrounding spaces', () => {
    const projector = new ConversationProjector()
    projector.reset([call(1), result(2, { error: denial({ reason: '  needs approval  ' }) })])
    expect(projector.messages()[0]?.autoReviewDenied).toEqual({ reason: '  needs approval  ' })
  })

  it.each([
    ['a different error name', { name: 'ToolExecutionError', code: 'AUTO_REVIEW_DENIED', reason: 'x' }],
    ['a different error code', { name: 'AutoReviewDeniedError', code: 'TOOL_FAILED', reason: 'x' }],
    ['no error at all', undefined],
    ['an error that is not a record', 'denied'],
  ])('keeps ordinary tool failure semantics for %s', (_name, error) => {
    const projector = new ConversationProjector()
    projector.reset([call(1), result(2, error === undefined ? {} : { error })])
    expect(projector.messages()[0]).toMatchObject({ detail: 'Failed', failed: true })
    expect(projector.messages()[0]?.autoReviewDenied).toBeUndefined()
  })

  it('does not confuse a successful call with a denial', () => {
    const projector = new ConversationProjector()
    projector.reset([call(1), event('tool/result', 2, {
      turn: 1, step: 1,
      message: { source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false }] },
    })])
    expect(projector.messages()[0]).toMatchObject({ id: 'tool:call-1', role: 'tool', text: 'bash', detail: 'Completed', failed: false })
    expect(projector.messages()[0]?.autoReviewDenied).toBeUndefined()
  })

  it('does not attach a denial to a call whose result merely flags isError', () => {
    const projector = new ConversationProjector()
    projector.reset([call(1), event('tool/result', 2, {
      turn: 1, step: 1,
      message: {
        source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'tool-result', toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'boom' }] }],
      },
    })])
    expect(projector.messages()[0]).toMatchObject({ detail: 'Failed', failed: true, rawResult: 'boom' })
    expect(projector.messages()[0]?.autoReviewDenied).toBeUndefined()
  })

  it('replays the same denial facts after a reset', () => {
    const events = [call(1), result(2, { error: denial({ reason: 'Reviewer refused the delete.' }) })]
    const projector = new ConversationProjector()
    projector.reset(events)
    const first = projector.messages()
    projector.reset(events)
    expect(projector.messages()).toEqual(first)
  })

  it('replaces a running call with the denied result in place', () => {
    const projector = new ConversationProjector()
    projector.apply(call(1))
    expect(projector.messages()).toEqual([expect.objectContaining({ id: 'tool:call-1', detail: 'Running…', streaming: true })])
    projector.apply(result(2, { error: denial({ reason: 'No.' }) }))
    expect(projector.messages()[0]).toMatchObject({
      id: 'tool:call-1', detail: 'Rejected by Auto review', autoReviewDenied: { reason: 'No.' },
    })
    expect(projector.messages()[0]?.streaming).toBeUndefined()
  })
})
