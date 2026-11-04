import type { DshEvent } from './conversation.js'
import { wireRecord } from './dsh-streams.js'

export interface GoalView {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  maxGoalRounds: number
  roundsStarted: number
  activation?: 'armed' | 'disarmed'
  blockedReason?: { code: string; message: string }
}
export interface GoalState { available: boolean; loading: boolean; busy: boolean; value: GoalView | null; error?: string }
/** Task states DSH alpha.3 reports; alpha.2's `inactive` is normalized to `paused`. */
export type ScheduleStatus = 'active' | 'paused' | 'ended'
/** Delivery destination as DSH alpha.3 reports it (alpha.2 named a session directly). */
export type ScheduleTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'new_once'; sessionId?: string }
  | { kind: 'new' }
export interface ScheduleDelivery {
  scheduledAt: string; deliveredAt: string; messageId: string; targetSessionId?: string
}
export interface ScheduleEntry {
  id: string; title: string; prompt: string; kind: string; scheduledAt: string
  status: ScheduleStatus
  /** Conversation that receives the next delivery, when the target names one. */
  sessionId?: string
  /** alpha.3 destination; absent on alpha.2 entries, which only carry `sessionId`. */
  target?: ScheduleTarget
  involvedSessionIds?: string[]
  /** Stored revision that an edit sends back as `expectedUpdatedAt`. */
  updatedAt?: string
  /** A delivery of this task is queued or running in its reused target conversation. */
  executionActive?: boolean
  lastDelivery?: ScheduleDelivery
}
export interface ScheduleHistory {
  id: string
  /** Present for alpha.2 histories, whose request is conversation-scoped. */
  sessionId?: string
  records: Array<{ scheduledAt: string; deliveredAt: string; messageId: string; prompt?: string }>
  earlierRecordsUnavailable?: boolean; earlierRecordsPruned?: boolean; nextBefore?: string; error?: string; loading?: boolean
  retention?: { days: number; records: number }
}
export interface ScheduleState { available: boolean; loading: boolean; items: ScheduleEntry[]; history?: ScheduleHistory; error?: string }
export interface HistorySearchState { query: string; loading: boolean; items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean; error?: string }
export interface WorkflowMember { seq: number; label: string; childId: string; phase?: string; outcome?: string }
export interface WorkflowRun { id: string; name: string; members: WorkflowMember[]; stopReason?: string; partial?: boolean }
export const emptyGoalState = (): GoalState => ({ available: false, loading: false, busy: false, value: null })
export const emptyScheduleState = (): ScheduleState => ({ available: false, loading: false, items: [] })
export const emptySearchState = (): HistorySearchState => ({ query: '', loading: false, items: [], hasMore: false })

export function goalOf(value: unknown): GoalView | null {
  if (!wireRecord(value)) return null
  const goal = wireRecord(value.goal) ? { ...value, ...value.goal } : value
  if (typeof goal.id !== 'string' || typeof goal.objective !== 'string' || !Number.isSafeInteger(goal.revision)
    || !['active', 'paused', 'blocked', 'complete'].includes(String(goal.phase))
    || typeof goal.maxGoalRounds !== 'number' || typeof goal.roundsStarted !== 'number') return null
  return { id: goal.id, revision: goal.revision as number, objective: goal.objective, phase: goal.phase as GoalView['phase'],
    maxGoalRounds: goal.maxGoalRounds, roundsStarted: goal.roundsStarted,
    ...(goal.activation === 'armed' || goal.activation === 'disarmed' ? { activation: goal.activation } : {}),
    ...(wireRecord(goal.blockedReason) && typeof goal.blockedReason.message === 'string' && typeof goal.blockedReason.code === 'string'
      ? { blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message } } : {}) }
}

/** One last-delivery receipt, preserving the target conversation alpha.3 adds. */
function scheduleDeliveryOf(value: unknown): ScheduleDelivery | undefined {
  if (!wireRecord(value) || typeof value.scheduledAt !== 'string'
    || typeof value.deliveredAt !== 'string' || typeof value.messageId !== 'string') return undefined
  return { scheduledAt: value.scheduledAt, deliveredAt: value.deliveredAt, messageId: value.messageId,
    ...(typeof value.targetSessionId === 'string' ? { targetSessionId: value.targetSessionId } : {}) }
}

/** One alpha.3 delivery destination, or undefined when the value names none this client knows. */
function scheduleTargetOf(value: unknown): ScheduleTarget | undefined {
  if (!wireRecord(value) || typeof value.kind !== 'string') return undefined
  if (value.kind === 'session') return typeof value.sessionId === 'string' ? { kind: 'session', sessionId: value.sessionId } : undefined
  if (value.kind === 'new_once') return { kind: 'new_once', ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}) }
  if (value.kind === 'new') return { kind: 'new' }
  return undefined
}

/**
 * Actionable text for one non-mutating Schedule refusal, or null when the value
 * is not a refusal.
 *
 * DSH answers `schedule/run`, `schedule/edit` and `schedule/history` with a
 * `code` instead of an error for a missing task, a stale revision, an
 * already-running delivery or an unknown history cursor. Leaving those on the
 * wire would render an invisible no-op, so callers surface this text instead.
 */
export function scheduleRefusal(value: unknown): string | null {
  if (!wireRecord(value) || typeof value.code !== 'string') return null
  if (value.code === 'schedule_not_found') return 'This reminder no longer exists. Refresh the reminders panel.'
  if (value.code === 'schedule_conflict') return 'This reminder changed in another window. Refresh the reminders panel and try again.'
  if (value.code === 'schedule_execution_pending') return 'This reminder is already running. Wait for that delivery to finish.'
  if (value.code === 'delivery_cursor_not_found') return 'That delivery page is no longer available. Refresh the history.'
  return `DSH refused the reminder request (${value.code}).`
}

/**
 * Parse the runtime-wide reminder catalog.
 *
 * DSH alpha.2 sent one shape per row: a top-level `sessionId` and
 * `active`/`inactive`. alpha.3 moved the destination into `target` (a `new`
 * target names no conversation at all), reports `active`/`paused`/`ended`, and
 * adds `involvedSessionIds`, `updatedAt`, `executionActive` and a delivery
 * receipt with `targetSessionId`. Both shapes are accepted so a sidebar update
 * does not lose reminders against either runtime; an entry that matches neither
 * is dropped, and a non-array catalog is still an error.
 */
export function schedulesOf(value: unknown): ScheduleEntry[] {
  if (!Array.isArray(value)) throw new Error('Invalid reminder catalog returned by DSH.')
  return value.flatMap((item): ScheduleEntry[] => {
    if (!wireRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string'
      || typeof item.prompt !== 'string' || typeof item.scheduledAt !== 'string' || typeof item.kind !== 'string') return []
    const lastDelivery = scheduleDeliveryOf(item.lastDelivery)
    const target = scheduleTargetOf(item.target)
    // A `target` key (even one this client cannot classify) and the two new
    // states identify the alpha.3 shape; `new` rows must never be dropped for
    // lacking a session.
    if ('target' in item || item.status === 'paused' || item.status === 'ended') {
      if (item.status !== 'active' && item.status !== 'paused' && item.status !== 'ended') return []
      const sessionId = target?.kind === 'session' || target?.kind === 'new_once' ? target.sessionId : undefined
      const involved = Array.isArray(item.involvedSessionIds) ? item.involvedSessionIds.filter(id => typeof id === 'string') : undefined
      return [{ id: item.id, title: item.title, prompt: item.prompt, kind: item.kind, scheduledAt: item.scheduledAt,
        status: item.status, ...(target === undefined ? {} : { target }),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(involved === undefined ? {} : { involvedSessionIds: involved }),
        ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}),
        ...(item.executionActive === true ? { executionActive: true } : {}),
        ...(lastDelivery === undefined ? {} : { lastDelivery }) }]
    }
    // alpha.2 named the owning conversation directly and had no `target`.
    if (typeof item.sessionId !== 'string' || (item.status !== 'active' && item.status !== 'inactive')) return []
    return [{ id: item.id, sessionId: item.sessionId, title: item.title, prompt: item.prompt, kind: item.kind,
      scheduledAt: item.scheduledAt, status: item.status === 'active' ? 'active' : 'paused',
      ...(lastDelivery === undefined ? {} : { lastDelivery }) }]
  })
}

/** Fold published workflow records; never label a truncated history as complete. */
export function workflowsOf(events: readonly DshEvent[]): WorkflowRun[] {
  const runs = new Map<string, WorkflowRun>()
  for (const event of events) {
    if (!event.type.startsWith('tool-workflow/') || !wireRecord(event.data) || typeof event.data.runId !== 'string') continue
    const data = event.data
    let run = runs.get(data.runId as string)
    if (event.type === 'tool-workflow/run-start') {
      run = { id: data.runId as string, name: typeof data.name === 'string' ? data.name : 'Workflow', members: [] }
      runs.set(run.id, run)
    }
    if (run === undefined) {
      run = { id: data.runId as string, name: 'Workflow', members: [], partial: true }
      runs.set(run.id, run)
    }
    if (event.type === 'tool-workflow/agent-start' && Number.isSafeInteger(data.seq) && typeof data.childId === 'string') {
      const index = run.members.findIndex(member => member.seq === data.seq)
      const member: WorkflowMember = { seq: data.seq as number, childId: data.childId, label: typeof data.label === 'string' ? data.label : 'Subagent',
        ...(typeof data.phase === 'string' ? { phase: data.phase } : {}), ...(run.members[index]?.outcome === undefined ? {} : { outcome: run.members[index]!.outcome! }) }
      if (index < 0) run.members.push(member)
      else run.members[index] = member
    } else if (event.type === 'tool-workflow/agent-end' && Number.isSafeInteger(data.seq) && typeof data.outcome === 'string') {
      const member = run.members.find(member => member.seq === data.seq)
      if (member) member.outcome = data.outcome
      else run.partial = true
    } else if (event.type === 'tool-workflow/run-end' && typeof data.stopReason === 'string') run.stopReason = data.stopReason
  }
  return [...runs.values()]
}

export interface JobChunk { at: number; text: string; channel?: 'stdout' | 'stderr' | 'log'; gapBefore?: true }
export class JobOutputTail {
  chunks: JobChunk[] = []
  next = 0
  gap = false
  private bytes = 0
  constructor(private readonly maxBytes = 128 * 1024) {}
  opened(from: number): void {
    if (from < this.next) { this.chunks = []; this.bytes = 0 }
    if (from > this.next) this.gap = true
    this.next = from
  }
  output(value: unknown): void {
    if (!wireRecord(value) || !Array.isArray(value.chunks) || !Number.isSafeInteger(value.next) || (value.next as number) < this.next) {
      throw new Error('Invalid background output frame returned by DSH.')
    }
    if (value.lossy === true) this.gap = true
    for (const raw of value.chunks) {
      if (!wireRecord(raw) || typeof raw.text !== 'string' || typeof raw.at !== 'number') throw new Error('Invalid background output chunk.')
      let text = raw.text
      const size = Buffer.byteLength(text)
      if (size > this.maxBytes) {
        const buffer = Buffer.from(text); let start = size - this.maxBytes
        while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++
        text = buffer.subarray(start).toString('utf8'); this.gap = true
      }
      const chunk: JobChunk = { at: raw.at, text, ...(raw.channel === 'stdout' || raw.channel === 'stderr' || raw.channel === 'log' ? { channel: raw.channel } : {}),
        ...(raw.gapBefore === true ? { gapBefore: true } : {}) }
      if (chunk.gapBefore) this.gap = true
      if (text === '') continue
      this.chunks.push(chunk); this.bytes += Buffer.byteLength(text)
      while ((this.bytes > this.maxBytes || this.chunks.length > 1024) && this.chunks.length) { this.bytes -= Buffer.byteLength(this.chunks.shift()!.text); this.gap = true }
    }
    this.next = value.next as number
  }
}
