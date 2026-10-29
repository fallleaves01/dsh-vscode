import { describe, expect, it, vi } from 'vitest'
import type { DshClient, SessionSummary } from '../src/dsh-client.js'
import { TaskFeatureController } from '../src/task-feature-controller.js'
const goal = { id: 'g', revision: 2, objective: 'Fix tasks', phase: 'paused' as const, maxGoalRounds: 8, roundsStarted: 3, activation: 'disarmed' as const }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function harness() {
  const client = { goal: vi.fn(async () => goal), schedules: vi.fn(async () => []), changeGoal: vi.fn(async () => {}), searchHistory: vi.fn(async () => ({ items: [], hasMore: false })), scheduleHistory: vi.fn(async () => ({ records: [] })) }
  const summaries = [{ sessionId: 's' }, { sessionId: 'archived' }] as SessionSummary[]
  const controller = new TaskFeatureController(vi.fn(), () => summaries)
  controller.bind(client as unknown as DshClient)
  return { client, controller }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
describe('task reads and edits across runtime/selection changes', () => {
  it('drops a goal result from a previous selection', async () => {
    const { client, controller } = harness(), read = deferred<typeof goal>()
    client.goal.mockReturnValueOnce(read.promise)
    controller.select('s', {}); controller.select('other', {})
    await flush(); read.resolve({ ...goal, objective: 'Old read' }); await flush()
    expect(controller.state.goal.value?.objective).toBe('Fix tasks')
  })
  it('seeds the goal from the opening projection without a read', async () => {
    const { client, controller } = harness()
    controller.select('s', { goal }); await flush()
    expect(client.goal).not.toHaveBeenCalled()
    expect(controller.state.goal.value).toEqual(goal)
    expect(controller.state.goal.loading).toBe(false)
    // Buttons are enabled from `available`: a seeded goal is actionable.
    expect(controller.state.goal.available).toBe(true)
  })
  it('reads the goal when the projection has none and keeps the failure visible', async () => {
    const { client, controller } = harness()
    client.goal.mockRejectedValueOnce(new Error('endpoint not found'))
    controller.select('s', {}); await flush()
    expect(controller.state.goal.available).toBe(false)
    expect(controller.state.goal.error).toContain('endpoint not found')
  })
  it('requires current Goal identity/revision and serializes edits', async () => {
    const { client, controller } = harness(), write = deferred<void>()
    controller.select('s', {}); await flush()
    await expect(controller.changeGoal('s', 'pause', { id: 'g', revision: 1 })).rejects.toThrow('changed')
    client.changeGoal.mockReturnValueOnce(write.promise)
    const pending = controller.changeGoal('s', 'resume', { id: 'g', revision: 2 })
    await expect(controller.changeGoal('s', 'clear', { id: 'g', revision: 2 })).rejects.toThrow('previous')
    expect(client.changeGoal).toHaveBeenCalledTimes(1)
    write.resolve(); await pending
    expect(controller.state.goal.busy).toBe(false)
  })
  it('rejects an invalid objective or fractional round budget before calling DSH', async () => {
    const { client, controller } = harness(); controller.select('s', {}); await flush()
    await expect(controller.changeGoal('s', 'create', undefined, { objective: '   ', maxGoalRounds: 2 })).rejects.toThrow('objective')
    await expect(controller.changeGoal('s', 'create', undefined, { objective: 'Fix', maxGoalRounds: 1.5 })).rejects.toThrow('whole')
    expect(client.changeGoal).not.toHaveBeenCalled()
  })
  it('drops late search responses, filters other projects and keeps archived hits', async () => {
    const { client, controller } = harness(), old = deferred<any>()
    client.searchHistory.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [{ sessionId: 'archived', snippet: 'Body match' }, { sessionId: 'foreign', snippet: 'No leak' }] as any, hasMore: true })
    const pending = controller.search('old'); await controller.search('new')
    old.resolve({ items: [{ sessionId: 's', snippet: 'Old' }], hasMore: false }); await pending
    expect(controller.state.historySearch).toEqual({ query: 'new', loading: false, items: [{ sessionId: 'archived', snippet: 'Body match' }], hasMore: true })
  })
  it('clears searches on runtime replacement without accepting old results', async () => {
    const { client, controller } = harness(), read = deferred<any>()
    client.searchHistory.mockReturnValueOnce(read.promise)
    const pending = controller.search('needle'); controller.bind(undefined)
    read.resolve({ items: [{ sessionId: 's', snippet: 'Late' }], hasMore: false }); await pending
    expect(controller.state.historySearch.query).toBe('')
    expect(controller.state.historySearch.items).toEqual([])
  })
  it('merges reminder delivery pages by message id and retains loss flags', async () => {
    const { client, controller } = harness()
    const entry = { id: 'r', sessionId: 's', title: 'Check', prompt: 'Review', kind: 'daily', status: 'active', scheduledAt: 'tomorrow' }
    client.schedules.mockResolvedValue([entry] as any); await controller.refreshSchedules()
    const one = { scheduledAt: 'one', deliveredAt: 'one', messageId: '1' }, two = { scheduledAt: 'two', deliveredAt: 'two', messageId: '2' }
    client.scheduleHistory.mockResolvedValueOnce({ records: [two], nextBefore: '2' } as any).mockResolvedValueOnce({ records: [two, one], earlierRecordsPruned: true } as any)
    await controller.showScheduleHistory('s', 'r'); await controller.showScheduleHistory('s', 'r', '2')
    expect(controller.state.schedules.history?.records).toEqual([two, one])
    expect(controller.state.schedules.history?.earlierRecordsPruned).toBe(true)
    expect(controller.state.schedules.history?.nextBefore).toBeUndefined()
  })
  it('reports an invalid history cursor and discards a response after navigation', async () => {
    const { client, controller } = harness(), late = deferred<any>()
    client.schedules.mockResolvedValue([{ id: 'r', sessionId: 's' }] as any); await controller.refreshSchedules()
    client.scheduleHistory.mockResolvedValueOnce({ code: 'delivery_cursor_not_found' } as any)
    await controller.showScheduleHistory('s', 'r', 'lost')
    expect(controller.state.schedules.history?.error).toBe('delivery_cursor_not_found')
    client.scheduleHistory.mockReturnValueOnce(late.promise)
    const pending = controller.showScheduleHistory('s', 'r'); controller.select('other', {})
    late.resolve({ records: [{ scheduledAt: 'x', deliveredAt: 'x', messageId: 'x' }] }); await pending
    expect(controller.state.schedules.history).toBeUndefined()
  })
})
