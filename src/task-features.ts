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
/** Timing rule kinds DSH alpha.3 accepts for `schedule/create` and `schedule/edit`. */
export type ScheduleKind = 'after' | 'at' | 'every' | 'daily' | 'weekly' | 'cron' | 'rrule'
export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['after', 'at', 'every', 'daily', 'weekly', 'cron', 'rrule']
/** Authoritative timing selector for the DSH schedule management endpoints. */
export type ScheduleTiming =
  | { kind: 'after'; after_seconds: number }
  | { kind: 'at'; at: { date: string; time: string; time_zone: string } }
  | { kind: 'every'; every_seconds: number }
  | { kind: 'daily'; daily: { time: string; time_zone: string } }
  | { kind: 'weekly'; weekly: { time: string; time_zone: string; weekdays: number[] } }
  | { kind: 'cron'; cron: { expression: string; time_zone: string } }
  | { kind: 'rrule'; rrule: string }
/** Raw text collected from native dialogs before it becomes a {@link ScheduleTiming}. */
export type ScheduleTimingInput =
  | { kind: 'after'; duration: string }
  | { kind: 'at'; date: string; time: string; timeZone?: string }
  | { kind: 'every'; duration: string }
  | { kind: 'daily'; time: string; timeZone?: string }
  | { kind: 'weekly'; time: string; weekdays: string; timeZone?: string }
  | { kind: 'cron'; expression: string; timeZone?: string }
  | { kind: 'rrule'; rrule: string }
/** Stored rule detail of one catalog row, used to prefill an edit dialog. */
export type ScheduleTimingDetail =
  | { kind: 'after'; afterSeconds: number }
  | { kind: 'at' }
  | { kind: 'every'; everySeconds: number }
  | { kind: 'daily'; time: string; timeZone: string }
  | { kind: 'weekly'; time: string; timeZone: string; weekdays: number[] }
  | { kind: 'cron'; expression: string; timeZone: string }
  | { kind: 'rrule'; rrule: string }
/** Delivery destination a create or edit request names. */
export type ScheduleTargetRequest =
  | { kind: 'session'; sessionId: string }
  | { kind: 'new_once' }
  | { kind: 'new' }
/** Body of DSH alpha.3 `schedule/create`; an omitted target reuses one created conversation. */
export interface ScheduleCreateRequest { title: string; prompt: string; timing: ScheduleTiming; target?: ScheduleTargetRequest }
/** Fields the alpha.3 `schedule/edit` update action may change. */
export interface ScheduleUpdatePatch { title?: string; prompt?: string; timing?: ScheduleTiming; active?: boolean }
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
  /** Stored rule detail from the catalog, used to prefill an edit. */
  timingDetail?: ScheduleTimingDetail
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

/** The user's IANA time zone, used as the default for local wall-clock rules. */
export function localTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** Trimmed reminder title; DSH requires one of at most 120 characters. */
export function scheduleTitleOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter a reminder title.')
  const title = value.trim()
  if (title.length > 120) throw new Error('The title must be at most 120 characters.')
  return title
}

/** Trimmed reminder instruction; DSH requires a non-empty prompt. */
export function schedulePromptOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter the instruction to send when the reminder fires.')
  return value.trim()
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/** Normalize a wall-clock time to `HH:mm:ss`; DSH accepts optional seconds. */
export function scheduleClockOf(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a time as HH:mm or HH:mm:ss.')
  const match = CLOCK_TIME.exec(value.trim())
  if (match === null) throw new Error('Enter a time as HH:mm or HH:mm:ss (24-hour).')
  return `${match[1] ?? '00'}:${match[2] ?? '00'}:${match[3] ?? '00'}`
}

/**
 * Convert one duration text to seconds.
 *
 * A bare number is minutes (`10` is ten minutes), an explicit `s`, `m` or `h`
 * suffix overrides that. DSH wants seconds for both one-shot delays and fixed
 * intervals; `every` additionally requires at least one minute.
 */
export function scheduleDurationOf(value: unknown, minimumSeconds: number): number {
  if (typeof value !== 'string') throw new Error('Enter a duration such as 10m, 90s or 1h.')
  const match = /^(\d{1,9})\s*(s|m|h)?$/i.exec(value.trim())
  if (match === null) throw new Error('Enter a duration such as 10m, 90s or 1h.')
  const amount = Number(match[1])
  const unit = (match[2] ?? 'm').toLowerCase()
  const seconds = amount * (unit === 's' ? 1 : unit === 'm' ? 60 : 3600)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('Enter a positive duration such as 10m, 90s or 1h.')
  if (seconds < minimumSeconds) throw new Error(`The interval must be at least ${formatDurationSeconds(minimumSeconds)}.`)
  return seconds
}

/** Render seconds back as the shortest `s`/`m`/`h` duration text. */
export function formatDurationSeconds(seconds: number): string {
  if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`
  return `${String(seconds)}s`
}

/** Validate one explicit UTC or IANA time zone, as DSH stores it. */
export function scheduleTimeZoneOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter UTC or an IANA time zone such as Asia/Shanghai.')
  const zone = value.trim()
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }) }
  catch { throw new Error(`"${zone}" is not a known time zone. Enter UTC or an IANA zone such as Asia/Shanghai.`) }
  return zone
}

/** Validate one local calendar date (`YYYY-MM-DD`). */
export function scheduleDateOf(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) throw new Error('Enter a date as YYYY-MM-DD.')
  const date = value.trim()
  const [year, month, day] = date.split('-').map(part => Number(part))
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== (month ?? 1) - 1 || parsed.getUTCDate() !== day) {
    throw new Error('Enter a real calendar date as YYYY-MM-DD.')
  }
  return date
}

/** Parse an ISO weekday list (Monday 1 through Sunday 7) into unique ascending numbers. */
export function scheduleWeekdaysOf(value: unknown): number[] {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter weekdays 1-7 (1 = Monday), separated by commas.')
  const days: number[] = []
  for (const part of value.split(',').map(entry => entry.trim()).filter(entry => entry !== '')) {
    if (!/^[1-7]$/.test(part)) throw new Error('Enter weekdays 1-7 (1 = Monday), separated by commas.')
    const day = Number(part)
    if (!days.includes(day)) days.push(day)
  }
  if (days.length === 0) throw new Error('Enter at least one weekday from 1 (Monday) through 7 (Sunday).')
  return days.sort((left, right) => left - right)
}

/** Validate a five-field Vixie cron expression. */
export function scheduleCronOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter a five-field cron expression, for example */5 * * * *.')
  const expression = value.trim()
  if (expression.split(/\s+/).length !== 5) throw new Error('A cron expression needs exactly five fields: minute hour day-of-month month day-of-week.')
  return expression
}

/** Validate the two-line RFC 5545 form DSH normalizes: one DTSTART line and one RRULE line. */
export function scheduleRRuleOf(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Provide a DTSTART line followed by an RRULE line.')
  const lines = value.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (lines.length !== 2 || !lines[0]!.startsWith('DTSTART') || !lines[1]!.startsWith('RRULE')) {
    throw new Error('Provide a DTSTART line followed by an RRULE line (one line each).')
  }
  return lines.join('\n')
}

/**
 * Build one DSH timing selector from the native dialog answers.
 *
 * Time zones default to the editor's local IANA zone; every field is validated
 * with a message the dialog can show, so an invalid answer never reaches DSH.
 */
export function scheduleTimingOf(input: ScheduleTimingInput): ScheduleTiming {
  switch (input.kind) {
    case 'after': return { kind: 'after', after_seconds: scheduleDurationOf(input.duration, 1) }
    case 'every': return { kind: 'every', every_seconds: scheduleDurationOf(input.duration, 60) }
    case 'at': return { kind: 'at', at: { date: scheduleDateOf(input.date), time: scheduleClockOf(input.time),
      time_zone: scheduleTimeZoneOf(input.timeZone ?? localTimeZone()) } }
    case 'daily': return { kind: 'daily', daily: { time: scheduleClockOf(input.time),
      time_zone: scheduleTimeZoneOf(input.timeZone ?? localTimeZone()) } }
    case 'weekly': return { kind: 'weekly', weekly: { time: scheduleClockOf(input.time),
      time_zone: scheduleTimeZoneOf(input.timeZone ?? localTimeZone()), weekdays: scheduleWeekdaysOf(input.weekdays) } }
    case 'cron': return { kind: 'cron', cron: { expression: scheduleCronOf(input.expression),
      time_zone: scheduleTimeZoneOf(input.timeZone ?? localTimeZone()) } }
    case 'rrule': return { kind: 'rrule', rrule: scheduleRRuleOf(input.rrule) }
  }
}

/** Stored rule detail of one catalog row, when the row carries enough to prefill an edit. */
function scheduleTimingDetailOf(item: Record<string, unknown>): ScheduleTimingDetail | undefined {
  if (item.kind === 'after') {
    return typeof item.afterSeconds === 'number' && Number.isSafeInteger(item.afterSeconds) && item.afterSeconds > 0
      ? { kind: 'after', afterSeconds: item.afterSeconds } : undefined
  }
  if (item.kind === 'every') {
    return typeof item.everySeconds === 'number' && Number.isSafeInteger(item.everySeconds) && item.everySeconds > 0
      ? { kind: 'every', everySeconds: item.everySeconds } : undefined
  }
  if (item.kind === 'at') return { kind: 'at' }
  if (item.kind === 'daily') {
    return typeof item.time === 'string' && typeof item.timeZone === 'string'
      ? { kind: 'daily', time: item.time, timeZone: item.timeZone } : undefined
  }
  if (item.kind === 'weekly') {
    const weekdays = Array.isArray(item.weekdays)
      ? item.weekdays.filter(day => Number.isSafeInteger(day) && (day as number) >= 1 && (day as number) <= 7) as number[]
      : undefined
    return typeof item.time === 'string' && typeof item.timeZone === 'string' && weekdays !== undefined && weekdays.length > 0
      ? { kind: 'weekly', time: item.time, timeZone: item.timeZone, weekdays } : undefined
  }
  if (item.kind === 'cron') {
    return typeof item.expression === 'string' && typeof item.timeZone === 'string'
      ? { kind: 'cron', expression: item.expression, timeZone: item.timeZone } : undefined
  }
  if (item.kind === 'rrule') return typeof item.rrule === 'string' ? { kind: 'rrule', rrule: item.rrule } : undefined
  return undefined
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
    const timingDetail = scheduleTimingDetailOf(item)
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
        ...(timingDetail === undefined ? {} : { timingDetail }),
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
