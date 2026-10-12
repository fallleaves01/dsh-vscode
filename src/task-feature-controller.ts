import type { DshClient, DshFrame, SessionSummary } from './dsh-client.js'
import { wireRecord } from './dsh-streams.js'
import { emptyGoalState, emptyScheduleState, emptySearchState, goalOf, type GoalState, type ScheduleState, type ScheduleHistory, type HistorySearchState } from './task-features.js'

export interface TaskFeatureState { goal: GoalState; schedules: ScheduleState; historySearch: HistorySearchState }
export type GoalAction = 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'clear'
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Async feature reads belong to a runtime and selection, never to whichever view finishes last. */
export class TaskFeatureController {
  state: TaskFeatureState = { goal: emptyGoalState(), schedules: emptyScheduleState(), historySearch: emptySearchState() }
  private client: DshClient | undefined
  private sessionId = ''
  private epoch = 0
  private goalRead = 0
  private scheduleRead = 0
  private historyRead = 0
  private searchRead = 0
  constructor(private readonly publish: (patch: Partial<TaskFeatureState>) => void, private readonly sessions: () => readonly SessionSummary[]) {}
  private update(patch: Partial<TaskFeatureState>): void { this.state = { ...this.state, ...patch }; this.publish(patch) }
  bind(client: DshClient | undefined): void {
    this.client = client; this.sessionId = ''; this.epoch++; this.searchRead++; this.historyRead++
    this.update({ goal: emptyGoalState(), schedules: emptyScheduleState(), historySearch: emptySearchState() })
  }
  select(sessionId: string, projections: Record<string, unknown>): void {
    this.sessionId = sessionId; this.epoch++; this.historyRead++
    const { history: _history, ...schedules } = this.state.schedules
    this.update({ goal: { ...emptyGoalState(), value: goalOf(projections.goal), loading: true },
      schedules })
    void this.refreshGoal(); void this.refreshSchedules()
  }
  async refreshGoal(): Promise<void> {
    const client = this.client; const sessionId = this.sessionId; const epoch = this.epoch; const revision = ++this.goalRead
    if (!client || !sessionId) return
    this.update({ goal: { ...this.state.goal, loading: true } })
    try {
      const value = await client.goal(sessionId)
      if (client !== this.client || epoch !== this.epoch || revision !== this.goalRead) return
      this.update({ goal: { available: true, loading: false, busy: this.state.goal.busy, value } })
    } catch (error) {
      if (client !== this.client || epoch !== this.epoch || revision !== this.goalRead) return
      this.update({ goal: { available: false, loading: false, busy: this.state.goal.busy, value: this.state.goal.value,
        error: `Goal controls are unavailable: ${errorText(error)}` } })
    }
  }
  async refreshSchedules(): Promise<void> {
    const client = this.client; const revision = ++this.scheduleRead
    if (!client) return
    this.update({ schedules: { ...this.state.schedules, loading: true } })
    try {
      const items = await client.schedules()
      if (client !== this.client || revision !== this.scheduleRead) return
      const ids = new Set(this.sessions().map(item => item.sessionId))
      const { error: _error, ...previous } = this.state.schedules
      this.update({ schedules: { ...previous, available: true, loading: false, items: items.filter(item => ids.has(item.sessionId)) } })
    } catch (error) {
      if (client !== this.client || revision !== this.scheduleRead) return
      const detail = errorText(error)
      this.update({ schedules: { ...this.state.schedules, available: false, loading: false, error: /HTTP 404|gateway\/not-found/.test(detail)
        ? 'This runtime does not expose Schedule. Enable Schedule in task service settings for a standard managed Web profile, then restart DSH. Configure an external runtime separately.'
        : `Reminders are unavailable: ${detail}` } })
    }
  }
  projection(sessionId: string, key: string, value: unknown): void {
    if (key !== 'goal' || sessionId !== this.sessionId) return
    this.update({ goal: { ...this.state.goal, value: goalOf(value) } })
    void this.refreshGoal()
  }
  frame(frame: DshFrame): void {
    if (frame.payload.type === 'host/schedules-changed') void this.refreshSchedules()
    if (frame.payload.type === 'host/goal-activation-changed' && (!wireRecord(frame.payload.value) || frame.payload.value.sessionId === this.sessionId)) void this.refreshGoal()
  }
  async changeGoal(sessionId: string, action: GoalAction, ref?: { id: string; revision: number }, request?: { objective?: string; maxGoalRounds?: number }): Promise<void> {
    const client = this.client; const epoch = this.epoch; const current = this.state.goal.value
    if (!client || sessionId !== this.sessionId) throw new Error('The conversation changed. Reopen goal controls.')
    if (this.state.goal.busy) throw new Error('Wait for the previous goal change to finish.')
    if (action !== 'create' && (!ref || ref.id !== current?.id || ref.revision !== current.revision)) throw new Error('This goal changed. Refresh it before trying again.')
    if ((action === 'create' || action === 'edit') && (!request?.objective?.trim() || !Number.isSafeInteger(request.maxGoalRounds) || request.maxGoalRounds! < 1)) {
      throw new Error('A goal needs an objective and a positive whole number of rounds.')
    }
    this.update({ goal: { ...this.state.goal, busy: true } })
    try { await client.changeGoal(sessionId, action, ref, request) }
    finally {
      if (client === this.client && epoch === this.epoch) {
        this.update({ goal: { ...this.state.goal, busy: false } }); await this.refreshGoal()
      }
    }
  }
  async showScheduleHistory(sessionId: string, id: string, before?: string): Promise<void> {
    const client = this.client; const epoch = this.epoch; const revision = ++this.historyRead
    const task = this.state.schedules.items.find(item => item.id === id && item.sessionId === sessionId)
    if (!client || !task) throw new Error('This reminder is no longer in the project catalog.')
    const previous = this.state.schedules.history
    const records = before && previous?.id === id && previous.sessionId === sessionId ? previous.records : []
    this.update({ schedules: { ...this.state.schedules, history: { sessionId, id, records, loading: true } } })
    try {
      const value = await client.scheduleHistory(sessionId, id, before)
      if (client !== this.client || epoch !== this.epoch || revision !== this.historyRead) return
      if (!wireRecord(value) || !Array.isArray(value.records)) throw new Error(wireRecord(value) && typeof value.code === 'string' ? value.code : 'Invalid reminder history.')
      const history: ScheduleHistory = { sessionId, id, records: [...records], loading: false,
        earlierRecordsUnavailable: value.earlierRecordsUnavailable === true, earlierRecordsPruned: value.earlierRecordsPruned === true,
        ...(wireRecord(value.retention) && typeof value.retention.days === 'number' && typeof value.retention.records === 'number' ? { retention: { days: value.retention.days, records: value.retention.records } } : {}),
        ...(typeof value.nextBefore === 'string' ? { nextBefore: value.nextBefore } : {}) }
      const seen = new Set(records.map(record => record.messageId))
      for (const item of value.records) if (wireRecord(item) && typeof item.scheduledAt === 'string' && typeof item.deliveredAt === 'string' && typeof item.messageId === 'string' && !seen.has(item.messageId)) {
        seen.add(item.messageId); history.records.push({ scheduledAt: item.scheduledAt, deliveredAt: item.deliveredAt, messageId: item.messageId,
          ...(typeof item.prompt === 'string' ? { prompt: item.prompt } : {}) })
      }
      this.update({ schedules: { ...this.state.schedules, history } })
    } catch (error) {
      if (client === this.client && epoch === this.epoch && revision === this.historyRead) this.update({ schedules: { ...this.state.schedules,
        history: { sessionId, id, records, loading: false, error: errorText(error) } } })
    }
  }
  async search(query: string): Promise<void> {
    const client = this.client; const revision = ++this.searchRead; query = query.trim()
    this.update({ historySearch: { query, loading: Boolean(client) && query !== '', items: [], hasMore: false } })
    if (!client || query === '') return
    try {
      const value = await client.searchHistory(query)
      if (client !== this.client || revision !== this.searchRead) return
      if (!wireRecord(value) || !Array.isArray(value.items)) throw new Error('Invalid conversation search result.')
      const ids = new Set(this.sessions().map(item => item.sessionId))
      const items = value.items.filter(item => wireRecord(item) && typeof item.sessionId === 'string' && typeof item.snippet === 'string' && ids.has(item.sessionId))
      this.update({ historySearch: { query, loading: false, items, hasMore: value.hasMore === true } })
    } catch (error) {
      if (client === this.client && revision === this.searchRead) {
        const detail = errorText(error)
        this.update({ historySearch: { query, loading: false, items: [], hasMore: false, error: /search.*(?:unavailable|disabled)|SESSION_QUERY_SEARCH_DISABLED/i.test(detail)
          ? 'Message history search is disabled in this runtime. Enable History Search in task service settings for a standard managed Web profile, then restart DSH. The search index opens only on first search.' : detail } })
      }
    }
  }
}
