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
export interface ScheduleEntry {
  id: string; sessionId: string; title: string; prompt: string; kind: string
  scheduledAt: string; status: 'active' | 'inactive'; lastDelivery?: { scheduledAt: string; deliveredAt: string; messageId: string }
}
export interface ScheduleHistory {
  sessionId: string; id: string; records: Array<{ scheduledAt: string; deliveredAt: string; messageId: string; prompt?: string }>
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

export function schedulesOf(value: unknown): ScheduleEntry[] {
  if (!Array.isArray(value)) throw new Error('Invalid reminder catalog returned by DSH.')
  return value.flatMap((item): ScheduleEntry[] => {
    if (!wireRecord(item) || typeof item.id !== 'string' || typeof item.sessionId !== 'string' || typeof item.title !== 'string'
      || typeof item.prompt !== 'string' || typeof item.scheduledAt !== 'string' || typeof item.kind !== 'string'
      || (item.status !== 'active' && item.status !== 'inactive')) return []
    const last = item.lastDelivery
    return [{ id: item.id, sessionId: item.sessionId, title: item.title, prompt: item.prompt, kind: item.kind,
      scheduledAt: item.scheduledAt, status: item.status,
      ...(wireRecord(last) && typeof last.scheduledAt === 'string' && typeof last.deliveredAt === 'string' && typeof last.messageId === 'string'
        ? { lastDelivery: { scheduledAt: last.scheduledAt, deliveredAt: last.deliveredAt, messageId: last.messageId } } : {}) }]
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
