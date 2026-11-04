import { describe, expect, it } from 'vitest'
import { goalOf, JobOutputTail, scheduleRefusal, schedulesOf, workflowsOf } from '../src/task-features.js'
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
  it('maps the alpha.3 target, status and delivery receipt without losing a row', () => {
    const catalog = [{
      id: 'r1', kind: 'daily', title: 'Morning review', prompt: 'Check jobs', scheduledAt: '2026-11-05T01:00:00Z',
      time: '09:00:00.000', timeZone: 'Asia/Shanghai',
      target: { kind: 'session', sessionId: 's' }, involvedSessionIds: ['s', 'other'],
      status: 'active', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
      lastDelivery: { scheduledAt: '2026-11-04T01:00:00Z', deliveredAt: '2026-11-04T01:00:01Z', messageId: 'm', targetSessionId: 's' },
    }]
    expect(schedulesOf(catalog)).toEqual([{
      id: 'r1', title: 'Morning review', prompt: 'Check jobs', kind: 'daily', scheduledAt: '2026-11-05T01:00:00Z',
      status: 'active', target: { kind: 'session', sessionId: 's' }, sessionId: 's', involvedSessionIds: ['s', 'other'],
      updatedAt: '2026-11-03T00:00:00Z',
      lastDelivery: { scheduledAt: '2026-11-04T01:00:00Z', deliveredAt: '2026-11-04T01:00:01Z', messageId: 'm', targetSessionId: 's' },
    }])
  })
  it('keeps alpha.3 rows whose target creates conversations and reports paused/ended', () => {
    const base = { kind: 'every', title: 'Standup', prompt: 'Post status', scheduledAt: '2026-11-06T09:00:00Z', involvedSessionIds: [] }
    const parsed = schedulesOf([
      { ...base, id: 'fresh', target: { kind: 'new', create: { cwd: '/workspace' } }, status: 'active' },
      { ...base, id: 'reserved', target: { kind: 'new_once', sessionId: 'reserved-session', create: {} }, status: 'paused' },
      { ...base, id: 'ended', target: { kind: 'session', sessionId: 's' }, status: 'ended' },
    ])
    expect(parsed.map(item => [item.id, item.status, item.sessionId, item.target])).toEqual([
      ['fresh', 'active', undefined, { kind: 'new' }],
      ['reserved', 'paused', 'reserved-session', { kind: 'new_once', sessionId: 'reserved-session' }],
      ['ended', 'ended', 's', { kind: 'session', sessionId: 's' }],
    ])
    expect(parsed[0]?.involvedSessionIds).toEqual([])
  })
  it('normalizes alpha.2 inactive rows and drops entries matching neither shape', () => {
    const legacy = { id: 'old', sessionId: 's', title: 'Legacy', prompt: 'P', kind: 'after', scheduledAt: '2026-11-06T09:00:00Z', status: 'inactive' }
    expect(schedulesOf([
      legacy,
      { id: 'paused-no-target', sessionId: 's', title: 'T', prompt: 'P', kind: 'after', scheduledAt: 'x', status: 'paused' },
      { id: 'bad-alpha3', title: 'T', prompt: 'P', kind: 'after', scheduledAt: 'x', target: { kind: 'session', sessionId: 's' }, status: 'inactive' },
      { id: 'no-title', sessionId: 's', prompt: 'P', kind: 'after', scheduledAt: 'x', status: 'active' },
    ])).toEqual([
      { ...legacy, status: 'paused' },
      // A paused row without a target is still a new-state row: show it, just
      // without a destination this client can name.
      { id: 'paused-no-target', title: 'T', prompt: 'P', kind: 'after', scheduledAt: 'x', status: 'paused' },
    ])
    // A future target family is not a reason to lose the reminder.
    const future = { id: 'future', title: 'T', prompt: 'P', kind: 'after', scheduledAt: 'x', target: { kind: 'channel' }, status: 'active' }
    expect(schedulesOf([future])).toEqual([{ id: 'future', title: 'T', prompt: 'P', kind: 'after', scheduledAt: 'x', status: 'active' }])
  })
  it('turns non-mutating schedule refusals into actionable text', () => {
    expect(scheduleRefusal({ code: 'schedule_not_found' })).toContain('no longer exists')
    expect(scheduleRefusal({ code: 'schedule_conflict' })).toContain('changed in another window')
    expect(scheduleRefusal({ code: 'schedule_execution_pending' })).toContain('already running')
    expect(scheduleRefusal({ code: 'delivery_cursor_not_found' })).toContain('delivery page')
    expect(scheduleRefusal({ code: 'future/refusal' })).toContain('future/refusal')
    expect(scheduleRefusal({ id: 'r', records: [] })).toBeNull()
    expect(scheduleRefusal(null)).toBeNull()
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
