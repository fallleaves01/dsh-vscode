import type { DshClient, DshFrame, SessionSummary } from './dsh-client.js'
import { wireRecord } from './dsh-streams.js'
import { emptyGoalState, emptyScheduleState, emptySearchState, goalOf, scheduleRefusal, type GoalState, type ScheduleEntry, type ScheduleState, type ScheduleHistory, type HistorySearchState } from './task-features.js'

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
  /** The connection whose reminder catalog was already read. */
  private schedulesClient: DshClient | undefined
  private historyRead = 0
  private searchRead = 0
  constructor(private readonly publish: (patch: Partial<TaskFeatureState>) => void, private readonly sessions: () => readonly SessionSummary[]) {}
  private update(patch: Partial<TaskFeatureState>): void { this.state = { ...this.state, ...patch }; this.publish(patch) }
  bind(client: DshClient | undefined): void {
    this.client = client; this.sessionId = ''; this.epoch++; this.searchRead++; this.historyRead++
    this.schedulesClient = undefined
    this.update({ goal: emptyGoalState(), schedules: emptyScheduleState(), historySearch: emptySearchState() })
  }
  select(sessionId: string, projections: Record<string, unknown>): void {
    this.sessionId = sessionId; this.epoch++; this.historyRead++
    const { history: _history, ...schedules } = this.state.schedules
    // The follow snapshot already carries the current goal projection, so only a
    // conversation without one needs the extra read.
    const seededGoal = projections.goal
    const hasGoal = seededGoal !== undefined && seededGoal !== null
    // A runtime that reported the projection serves the goal endpoints: the
    // seeded state must be actionable, not merely readable.
    this.update({ goal: { ...emptyGoalState(), available: hasGoal, value: goalOf(seededGoal), loading: !hasGoal }, schedules })
    if (!hasGoal) void this.refreshGoal()
    void this.refreshSchedules()
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
  async refreshSchedules(force = false): Promise<void> {
    const client = this.client; const revision = ++this.scheduleRead
    if (!client) return
    // Reminders are a runtime-wide catalog: switching conversations reuses it
    // until a host event invalidates it.
    if (!force && this.schedulesClient === client && this.state.schedules.available && !this.state.schedules.error) return
    this.update({ schedules: { ...this.state.schedules, loading: true } })
    try {
      const items = await client.schedules()
      if (client !== this.client || revision !== this.scheduleRead) return
      const ids = new Set(this.sessions().map(item => item.sessionId))
      const { error: _error, ...previous } = this.state.schedules
      this.schedulesClient = client
      // alpha.3 catalogs are runtime-wide and name their destination through
      // `target`. A `new` or `new_once` target names no current conversation
      // (the latter may name a reserved one), so filtering on a session id would
      // drop every reminder. Only a legacy alpha.2 row, which names its owning
      // conversation directly, keeps the per-project filter.
      this.update({ schedules: { ...previous, available: true, loading: false,
        items: items.filter(item => item.target !== undefined || item.sessionId === undefined || ids.has(item.sessionId)) } })
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
    if (frame.payload.type === 'host/schedules-changed') void this.refreshSchedules(true)
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
    const task = this.state.schedules.items.find(item => item.id === id)
    if (!client || !task) throw new Error('This reminder is no longer in the project catalog.')
    // alpha.3 pages a task by id alone; alpha.2 needs the owning conversation,
    // which only a legacy entry (or the caller) can supply.
    const owner = task.sessionId ?? (sessionId === '' ? undefined : sessionId)
    const previous = this.state.schedules.history
    const records = before !== undefined && previous?.id === id ? previous.records : []
    this.update({ schedules: { ...this.state.schedules, history: { id, ...(owner === undefined ? {} : { sessionId: owner }), records, loading: true } } })
    try {
      const value = await client.scheduleHistory(owner, id, before)
      if (client !== this.client || epoch !== this.epoch || revision !== this.historyRead) return
      if (!wireRecord(value) || !Array.isArray(value.records)) throw new Error(wireRecord(value) && typeof value.code === 'string' ? value.code : 'Invalid reminder history.')
      const history: ScheduleHistory = { id, ...(owner === undefined ? {} : { sessionId: owner }), records: [...records], loading: false,
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
        history: { id, ...(owner === undefined ? {} : { sessionId: owner }), records, loading: false, error: errorText(error) } } })
    }
  }

  /** The reminder row one action addresses, or a readable error when it is gone. */
  private scheduleEntry(id: string): ScheduleEntry {
    const item = this.state.schedules.items.find(candidate => candidate.id === id)
    if (item === undefined) throw new Error('This reminder is no longer in the project catalog.')
    return item
  }

  /**
   * Keep one failed reminder action visible in the panel and to the caller.
   *
   * The host also reports the rejection as a chat notice; without either surface
   * the click would merely do nothing, which is the failure mode this panel is
   * meant to prevent.
   */
  private failSchedule(action: string, error: unknown): never {
    this.update({ schedules: { ...this.state.schedules, error: `${action}: ${errorText(error)}` } })
    throw error
  }

  /** Run one reminder now without consuming its next occurrence. */
  async runSchedule(id: string): Promise<void> {
    const client = this.client
    if (client === undefined) throw new Error('DSH is not connected.')
    this.scheduleEntry(id)
    try {
      const refusal = scheduleRefusal(await client.scheduleRun(id))
      if (refusal !== null) throw new Error(refusal)
    } catch (error) {
      if (client === this.client) this.failSchedule('Could not run the reminder', error)
      throw error
    }
    if (client === this.client) await this.refreshSchedules(true)
  }

  /** Pause or resume one reminder through the alpha.3 closed edit operation. */
  async setScheduleActive(id: string, active: boolean): Promise<void> {
    const client = this.client
    if (client === undefined) throw new Error('DSH is not connected.')
    const item = this.scheduleEntry(id)
    try {
      const refusal = scheduleRefusal(await client.scheduleEdit(id, { action: 'update', patch: { active },
        ...(item.updatedAt === undefined ? {} : { expectedUpdatedAt: item.updatedAt }) }))
      if (refusal !== null) throw new Error(refusal)
    } catch (error) {
      if (client === this.client) this.failSchedule(active ? 'Could not resume the reminder' : 'Could not pause the reminder', error)
      throw error
    }
    if (client === this.client) await this.refreshSchedules(true)
  }

  /** Delete one reminder and its saved deliveries. */
  async deleteSchedule(id: string): Promise<void> {
    const client = this.client
    if (client === undefined) throw new Error('DSH is not connected.')
    const item = this.scheduleEntry(id)
    try {
      const value = await client.scheduleEdit(id, { action: 'delete',
        ...(item.updatedAt === undefined ? {} : { expectedUpdatedAt: item.updatedAt }) })
      const refusal = scheduleRefusal(value)
      if (refusal !== null) throw new Error(refusal)
      if (!wireRecord(value) || value.deleted !== true) throw new Error('DSH did not delete the reminder.')
    } catch (error) {
      if (client === this.client) this.failSchedule('Could not delete the reminder', error)
      throw error
    }
    if (client === this.client) await this.refreshSchedules(true)
  }

  /** Remove every ended reminder and answer how many rows went away. */
  async deleteEndedSchedules(): Promise<number> {
    const client = this.client
    if (client === undefined) throw new Error('DSH is not connected.')
    let deleted = 0
    try {
      const value = await client.scheduleDeleteInactive()
      if (!wireRecord(value) || !Number.isSafeInteger(value.deleted)) throw new Error('Invalid reminder cleanup result.')
      deleted = value.deleted as number
    } catch (error) {
      if (client === this.client) this.failSchedule('Could not delete ended reminders', error)
      throw error
    }
    if (client === this.client) await this.refreshSchedules(true)
    return deleted
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
