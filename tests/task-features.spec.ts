import { describe, expect, it } from 'vitest'
import { goalOf, JobOutputTail, schedulesOf, workflowsOf } from '../src/task-features.js'
import type { DshEvent } from '../src/conversation.js'
const event = (type: string, data: Record<string, unknown>, seq = 1): DshEvent => ({ type, data, seq, time: 0 })
const goal = { id: 'g', revision: 2, objective: 'Fix tasks', phase: 'active', maxGoalRounds: 8, roundsStarted: 3 }

describe('published task feature projections', () => {
  it('reads durable goals without inventing process-local activation', () => {
    expect(goalOf({ goal, roundsStarted: 4 })).toEqual(goal)
    expect(goalOf({ ...goal, activation: 'disarmed' })?.activation).toBe('disarmed')
    expect(goalOf(null)).toBeNull()
    expect(goalOf({ objective: 'Missing identity' })).toBeNull()
  })
  it('joins workflow members and outcomes by run and sequence', () => {
    const runs = workflowsOf([
      event('tool-workflow/run-start', { runId: 'r', name: 'Review' }),
      event('tool-workflow/agent-start', { runId: 'r', seq: 2, childId: 'child', label: 'Audit', phase: 'Inspect' }),
      event('tool-workflow/agent-end', { runId: 'r', seq: 2, outcome: 'success' }),
      event('tool-workflow/run-end', { runId: 'r', stopReason: 'finished' }),
      event('tool-workflow/run-start', { runId: 'other', name: 'Unrelated' }),
    ])
    expect(runs[0]).toEqual({ id: 'r', name: 'Review', members: [{ seq: 2, childId: 'child', label: 'Audit', phase: 'Inspect', outcome: 'success' }], stopReason: 'finished' })
    expect(runs[1]?.stopReason).toBeUndefined()
  })
  it('marks truncated workflow history and unmatched outcomes as partial', () => {
    const runs = workflowsOf([event('tool-workflow/agent-start', { runId: 'r', seq: 1, childId: 'c' }), event('tool-workflow/agent-end', { runId: 'r', seq: 99, outcome: 'error' })])
    expect(runs[0]?.partial).toBe(true)
    expect(runs[0]?.stopReason).toBeUndefined()
  })
  it('filters malformed reminder records and preserves last delivery', () => {
    const row = { id: 's', sessionId: 'owner', title: 'Review', prompt: 'Check PR', kind: 'daily', status: 'active', scheduledAt: '2026-10-05T08:00:00Z', lastDelivery: { scheduledAt: 'yesterday', deliveredAt: 'yesterday', messageId: 'm' } }
    expect(schedulesOf([null, {}, row])).toEqual([row])
    expect(() => schedulesOf({})).toThrow('Invalid reminder catalog')
  })
})
describe('non-consuming bounded background output', () => {
  it('retains channels, timestamps and the absolute resume cursor', () => {
    const tail = new JobOutputTail(12)
    tail.opened(10)
    tail.output({ chunks: [{ at: 123456, text: 'abc', channel: 'stderr' }, { at: 123457, text: 'def', channel: 'log' }], next: 16 })
    expect(tail.next).toBe(16)
    expect(tail.chunks.map(chunk => chunk.channel)).toEqual(['stderr', 'log'])
    expect(tail.chunks[0]?.at).toBe(123456)
    expect(tail.gap).toBe(true)
  })
  it('evicts old chunks and handles a single oversized unicode chunk safely', () => {
    const tail = new JobOutputTail(8)
    tail.output({ chunks: [{ at: 1, text: 'first' }, { at: 2, text: 'second' }], next: 11 })
    expect(tail.chunks.map(chunk => chunk.text).join('')).toBe('second')
    tail.output({ chunks: [{ at: 3, text: '你你你好好' }], next: 26 })
    expect(tail.chunks.map(chunk => chunk.text).join('')).toBe('好好')
    expect(tail.gap).toBe(true)
    expect(Buffer.byteLength(tail.chunks.map(chunk => chunk.text).join(''))).toBeLessThanOrEqual(8)
  })
  it('marks runtime retention gaps and clears overlapping replay', () => {
    const tail = new JobOutputTail()
    tail.output({ chunks: [{ at: 1, text: 'before' }], next: 6 })
    tail.opened(0)
    expect(tail.chunks).toEqual([])
    tail.output({ chunks: [{ at: 2, text: 'after', gapBefore: true }], next: 10, lossy: true })
    expect(tail.gap).toBe(true)
    tail.opened(10)
    expect(tail.chunks.map(chunk => chunk.text)).toEqual(['after'])
  })
  it('rejects corrupt chunks and regressing cursors', () => {
    const tail = new JobOutputTail()
    tail.opened(20)
    expect(() => tail.output({ next: 19, chunks: [] })).toThrow()
    expect(() => tail.output({ next: 25, chunks: [{ at: 1, text: null }] })).toThrow()
  })
})

it('bounds chunk count as well as bytes and ignores empty output', () => {
  const tail = new JobOutputTail()
  tail.output({ chunks: Array.from({ length: 10000 }, (_, at) => ({ at, text: at % 2 ? 'x' : '' })), next: 5000 })
  expect(tail.chunks).toHaveLength(1024)
  expect(tail.gap).toBe(true)
})
