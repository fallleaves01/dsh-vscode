import type { DshConnection } from './dsh-connection.js'
import type { DshFrame, HistoryEntry, RpcReceipt, SessionSummary, SessionProjectionRead } from './dsh-client.js'
import { decodeHistory } from './dsh-history.js'
import { DshStreams, wireRecord } from './dsh-streams.js'
import { DshAssistantStream } from './dsh-assistant-stream.js'

interface Projection { seq: number; value: unknown }
interface PendingQuestion { sessionId: string; event: string; request: Record<string, unknown> }
/** Rate limit for reporting unrecognized top-level frame types, per stream. */
interface UnknownFrameBudget { readonly types: Set<string>; overflow: boolean }

/** Distinct unknown frame types reported per stream before the diagnostic is capped. */
const UNKNOWN_FRAME_TYPE_LIMIT = 16

/**
 * Safe label for an untrusted wire `type`.
 *
 * The frame type comes from the runtime, so it is never echoed verbatim into a
 * log: control characters are masked and the length is capped. A missing value
 * is named by its JavaScript type rather than by `String(value)`, which would
 * turn `null` and an empty string into indistinguishable labels.
 */
function frameTypeLabel(value: unknown): string {
  if (typeof value !== 'string') return `(${value === undefined ? 'missing' : typeof value})`
  const printable = value.replace(/[^\x20-\x7e]/gu, '?')
  return printable.length > 64 ? `${printable.slice(0, 64)}…` : printable
}

/** Durable address of one conversation, as DSH's `SessionAddress` union defines it. */
type SessionAddress =
  | { kind: 'session'; sessionId: string }
  | { kind: 'subagent'; parentSessionId: string; childSessionId: string; mode: 'unknown' }

/**
 * Address a conversation the way DSH expects.
 *
 * A subagent child is not addressable as an ordinary session: DSH refuses that
 * with `session/agent-busy` ("subagent Sessions require their durable parent
 * address"), so opening a child — or paging its history — needs the subagent
 * variant. The `mode` field is a discriminator that the validator does not
 * inspect, so the caller does not have to know it.
 */
export function sessionAddress(sessionId: string, parentSessionId: string | undefined): SessionAddress {
  return parentSessionId === undefined
    ? { kind: 'session', sessionId }
    : { kind: 'subagent', parentSessionId, childSessionId: sessionId, mode: 'unknown' }
}

interface Follow {
  sessionId: string
  address: SessionAddress
  cursor: number
  lastSeq: number
  active: boolean
  pending: DshFrame[]
  committedMessages: Set<string>
  cancel: () => void
  reject: (error: Error) => void
}
export interface SessionOpening {
  asOfSeq?: number
  events: HistoryEntry[]
  hasMore: boolean
  projections: Record<string, unknown>
  /** Install the snapshot in the UI before releasing events buffered behind it. */
  activate: () => void
  isCurrent: () => boolean
}

/**
 * Project one DSH 0.1.7 `inbox` array into the sidebar's queue item shape.
 *
 * The 0.1.7 `inbox` projection groups messages by delivery target instead of
 * tagging each item with a `placement`, so the target becomes the placement and
 * the message's own id becomes the item id the UI mutates against.
 * Never throws: this runs inside the shared frame handler, where a throw would
 * tear down every stream.
 */
function inboxItems(value: unknown, placement: 'queued' | 'steering'): unknown[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(message => wireRecord(message) && typeof message.id === 'string'
    ? [{ id: message.id, placement, message }]
    : [])
}

/** Adapts the 0.1.2 streams to the sidebar's internal (not wire) event vocabulary. */
export class DshSessionFeed {
  private readonly streams: DshStreams
  private startup: Promise<void> | undefined
  private clientId: string | undefined
  private follow: Follow | undefined
  private archived: string[] = []
  private readonly projections = new Map<string, Map<string, Projection>>()
  private readonly projectionFloors = new Map<string, number>()
  private readonly queues = new Map<string, unknown[]>()
  private readonly jobs = new Map<string, unknown[]>()
  /** Per-session `job/list` subscriptions (DSH 0.1.7 moved jobs out of the control baseline). */
  private readonly jobStreams = new Map<string, () => void>()
  private readonly pendingJobBaselines = new Set<string>()
  private readonly monitoredJobs = new Set<string>()
  private readonly scannedJobs = new Set<string>()
  private readonly queuedJobBaselines = new Set<string>()
  private pumpingJobs = false
  private readonly running = new Map<string, boolean>()
  private readonly available = new Map<string, boolean>()
  private readonly questions = new Map<string, PendingQuestion>()
  private readonly displayedQuestions = new Map<string, string>()
  private readonly requestSessions = new Set<string>()
  private readonly subagentParents = new Map<string, string>()
  private readonly catalogParents = new Map<string, string>()
  private readonly addedSessions = new Map<string, { revision: number; summary: SessionSummary }>()
  private addedRevision = 0
  private readonly activity = new Map<string, number>()
  private readonly nonBlankSessions = new Set<string>()
  /** Unknown top-level frame types already reported, keyed by stream endpoint. */
  private readonly ignoredFrameTypes = new Map<string, UnknownFrameBudget>()

  constructor(private readonly connection: DshConnection, private readonly emit: (frame: DshFrame) => void,
    private readonly error: (error: Error) => void,
    /**
     * Non-fatal protocol diagnostics. The extension host console is the only log
     * this module can reach without depending on `vscode`; callers that own an
     * OutputChannel may pass their own writer. Messages carry a sanitized frame
     * type label and no payload, so runtime text cannot forge log lines.
     */
    private readonly diagnostic: (message: string) => void = message => { console.warn(`[dsh] ${message}`) }) {
    this.streams = new DshStreams(connection, failure => {
      this.closeFollow(failure)
      for (const id of this.questions.keys()) this.dismissQuestion(id)
      this.error(failure)
    })
  }

  start(): Promise<void> {
    this.startup ??= Promise.all([
      this.baseline('$events', frame => {
        if (frame.type === 'ready') {
          if (typeof frame.clientId !== 'string') throw new Error('Invalid event identity.')
          this.clientId = frame.clientId
          return true
        }
        this.remoteEvent(frame)
        return false
      }),
      this.baseline('session/control', frame => { this.control(frame); return frame.type === 'baseline' }),
      this.baseline('workspace/follow', frame => {
        const value = frame.type === 'baseline' || frame.type === 'replace' ? frame.value : frame
        if (frame.type === 'baseline' || frame.type === 'replace' || frame.type === 'archived') {
          if (!wireRecord(value) || !Array.isArray(value.archivedSessionIds) || !value.archivedSessionIds.every(id => typeof id === 'string')) {
            throw new Error('Invalid workspace baseline.')
          }
          this.archived = value.archivedSessionIds
          if (frame.type !== 'baseline') this.host({ type: 'host/archived-sessions-changed', archivedSessionIds: this.archived })
        }
        return frame.type === 'baseline'
      }),
    ]).then(() => undefined)
    return this.startup
  }

  async listWorkspaces(): Promise<{ archivedSessionIds: string[] }> {
    await this.start()
    return { archivedSessionIds: [...this.archived] }
  }

  /** Register before dispatch: a task can ask for approval before its RPC returns. */
  handleRequestsFor(sessionId: string): void { this.requestSessions.add(sessionId) }

  get handledSessionIds(): string[] {
    return [...new Set([...this.requestSessions, ...(this.follow === undefined ? [] : [this.follow.sessionId])])]
  }

  get listRevision(): number { return this.addedRevision }

  pendingRequests(sessionId: string): Array<{ rpcId: string; event: string; request: Record<string, unknown> }> {
    return [...this.questions].filter(([, pending]) => pending.sessionId === sessionId)
      .map(([rpcId, pending]) => ({ rpcId, event: pending.event, request: pending.request }))
  }

  monitorJobs(sessionIds: readonly string[], refresh = false): void {
    this.monitoredJobs.clear()
    for (const id of sessionIds) {
      this.monitoredJobs.add(id)
      if (refresh) this.scannedJobs.delete(id)
      if (!this.scannedJobs.has(id) && !this.jobStreams.has(id)) this.queuedJobBaselines.add(id)
    }
    for (const id of this.queuedJobBaselines) if (!this.monitoredJobs.has(id)) this.queuedJobBaselines.delete(id)
    for (const id of this.jobStreams.keys()) if (!this.monitoredJobs.has(id) && this.follow?.sessionId !== id) {
      this.jobStreams.get(id)?.(); this.jobStreams.delete(id); this.pendingJobBaselines.delete(id)
    }
    this.pumpJobBaselines()
  }

  private pumpJobBaselines(): void {
    if (this.pumpingJobs) return
    this.pumpingJobs = true
    try {
      for (const id of this.queuedJobBaselines) {
        if (this.pendingJobBaselines.size >= 8) break
        this.queuedJobBaselines.delete(id)
        this.subscribeJobs(id)
      }
    } finally { this.pumpingJobs = false }
  }

  observeJob(sessionId: string, jobId: string, from: number, item: (frame: Record<string, unknown>) => void, fail: (error: Error) => void): () => void {
    return this.streams.open('job/follow', { request: { sessionId, jobId, from } }, raw => {
      if (!wireRecord(raw)) throw new Error('Invalid background output frame.')
      item(raw)
    }, fail, true)
  }

  summaries(items: SessionSummary[], sinceRevision: number): SessionSummary[] {
    const summaries = new Map(items.map(summary => [summary.sessionId, summary]))
    // Do not lose a new conversation when its notification races session/list.
    for (const [id, added] of this.addedSessions) {
      if (added.revision > sinceRevision && !summaries.has(id)) summaries.set(id, added.summary)
    }
    return [...summaries.values()].map(summary => this.summary(summary))
  }

  private summary(summary: SessionSummary): SessionSummary {
    if (!this.running.has(summary.sessionId)) this.running.set(summary.sessionId, summary.running)
    if (summary.origin === 'subagent' && typeof summary.parentSessionId === 'string') {
      this.subagentParents.set(summary.sessionId, summary.parentSessionId)
    }
    const values = { ...summary.projections?.values }
    const watermark = summary.projections?.asOfSeq ?? -1
    for (const [key, projection] of this.projections.get(summary.sessionId) ?? []) {
      if (projection.seq >= watermark) values[key] = projection.value
    }
    this.trackCatalog(summary.sessionId, values.subagentCatalog)
    const activity = this.activity.get(summary.sessionId)
    if (!summary.blank || summary.running) this.nonBlankSessions.add(summary.sessionId)
    return { ...summary, updatedAt: Math.max(summary.updatedAt, activity ?? 0),
      blank: !this.nonBlankSessions.has(summary.sessionId),
      running: this.running.get(summary.sessionId) ?? summary.running,
      ...(this.available.has(summary.sessionId) ? { agentAvailable: this.available.get(summary.sessionId)! } : {}),
      projections: { values }, ...(typeof values.agentPreset === 'string' ? { agentPreset: values.agentPreset } : {}) }
  }

  projectionValues(sessionId: string): Record<string, unknown> {
    return Object.fromEntries([...this.projections.get(sessionId) ?? []].map(([key, projection]) => [key, projection.value]))
  }

  adoptProjections(sessionId: string, seq: number, values: Record<string, unknown>): Record<string, unknown> {
    this.installProjections(sessionId, seq, values)
    return this.projectionValues(sessionId)
  }

  async readProjections(sessionId: string, signal?: AbortSignal): Promise<SessionProjectionRead> {
    const value = await this.connection.call<unknown>('session/projections', { request: { sessionId } }, 10_000, signal)
    if (value === null) return null
    if (!wireRecord(value) || !wireRecord(value.values)) throw new Error('Invalid DSH session projections.')
    if (value.kind === 'migration-required') return { kind: 'migration-required', values: { ...value.values, ...this.projectionValues(sessionId) } }
    if (value.kind !== 'sequenced' || !Number.isSafeInteger(value.asOfSeq) || (value.asOfSeq as number) < -1) throw new Error('Invalid DSH session projection sequence.')
    return { kind: 'sequenced', asOfSeq: value.asOfSeq as number,
      values: this.adoptProjections(sessionId, value.asOfSeq as number, value.values) }
  }

  open(sessionId: string, parentSessionId?: string): Promise<SessionOpening> {
    if (parentSessionId !== undefined) this.subagentParents.set(sessionId, parentSessionId)
    this.closeFollow()
    const address = sessionAddress(sessionId, parentSessionId)
    return new Promise((resolve, reject) => {
      const state: Follow = { sessionId, address, cursor: -1, lastSeq: -1, active: false, pending: [], committedMessages: new Set(), cancel: () => {}, reject }
      this.follow = state
      this.subscribeJobs(sessionId)
      const assistant = new DshAssistantStream(
        update => this.mux({ type: 'session/assistant-stream', sessionId, update }),
        entry => this.mux({ type: 'session/event', sessionId, event: entry.event }),
      )
      let opened = false
      const timer = setTimeout(() => {
        if (this.follow === state) this.closeFollow(new Error('DSH session snapshot timed out.'))
      }, 30_000)
      state.reject = error => { clearTimeout(timer); reject(error) }
      state.cancel = this.streams.open('session/follow', { request: { address, maxMessages: 100, assistantStream: true } }, raw => {
        if (this.follow !== state) return
        if (!wireRecord(raw)) throw new Error('Invalid session frame.')
        if (!opened) {
          if (raw.type !== 'snapshot' || !Number.isSafeInteger(raw.cursor) || !wireRecord(raw.header)
            || raw.header.id !== sessionId || !wireRecord(raw.projections) || !wireRecord(raw.projections.values)
            || raw.projections.asOfSeq !== raw.cursor || typeof raw.hasMore !== 'boolean') throw new Error('Invalid session snapshot.')
          state.cursor = state.lastSeq = raw.cursor as number
          const events = decodeHistory(raw.records)
          const latest = events.at(-1)?.event.seq
          if (latest !== undefined && latest > state.cursor) throw new Error('History exceeds snapshot cursor.')
          for (const entry of events) this.acceptQueuedMessage(state, entry)
          this.installProjections(sessionId, state.cursor, raw.projections.values)
          assistant.open(raw.assistantStream, state.cursor, events)
          opened = true
          clearTimeout(timer)
          resolve({ events, hasMore: raw.hasMore, asOfSeq: state.cursor, projections: this.projectionValues(sessionId), isCurrent: () => this.follow === state, activate: () => {
            if (this.follow !== state || state.active) return
            state.active = true
            this.requestSessions.add(sessionId)
            this.mux({ type: 'session/queue', sessionId, items: this.queueItems(sessionId) })
            this.mux({ type: 'session/jobs', sessionId, jobs: this.jobs.get(sessionId) ?? [] })
            for (const [key, projection] of this.projections.get(sessionId) ?? []) {
              this.mux({ type: 'session/projection', sessionId, key, value: projection.value })
            }
            for (const frame of state.pending.splice(0)) this.emit(frame)
            this.presentQuestions()
          } })
        } else {
          if (raw.type === 'assistant-stream') { assistant.frame(raw.frame, state.lastSeq); return }
          if (raw.type !== 'event') throw new Error('Unexpected session snapshot.')
          const entry = decodeHistory([raw])[0]
          if (entry === undefined || entry.event.seq !== state.lastSeq + 1) throw new Error('Non-contiguous DSH session events.')
          state.lastSeq = entry.event.seq
          this.acceptQueuedMessage(state, entry)
          assistant.durable(entry)
        }
      // A conversation-scoped subscription must not take the runtime feed with it:
      // a conversation archived elsewhere, or a subagent whose parent is gone,
      // fails this stream alone. Its code is what the sidebar explains.
      }, (error, cause) => {
        // Before the snapshot the open is still pending, so the failure is the
        // opener's to report. After it, this stream was the only thing updating the
        // transcript: closing it silently left the sidebar showing a conversation
        // that had stopped moving, with no notice and no way back. A carrier abort
        // is reported once, by the carrier itself.
        if (!opened) { state.reject(error); return }
        if (this.follow !== state) return
        this.closeFollow(error)
        if (cause === 'stream') this.error(error)
      }, true)
    })
  }

  async page(sessionId: string, beforeSeq: number): Promise<{ events: HistoryEntry[]; hasMore: boolean }> {
    const state = this.follow
    if (state?.sessionId !== sessionId || state.cursor < 0) throw new Error('Open the session before loading older history.')
    // `throughSeq` is the snapshot cursor on purpose: 0.2.0 rejects a value past
    // the session's cursor with `gateway/bad-request`, so paging must walk
    // backwards from a real one.
    const result = await this.connection.call<{ records: unknown; hasMore: boolean }>('session/page', {
      request: { address: state.address, throughSeq: state.cursor, beforeSeq, maxMessages: 100 },
    })
    if (this.follow !== state) throw new Error('The conversation changed while loading history.')
    if (typeof result.hasMore !== 'boolean') throw new Error('Invalid history page.')
    return { events: decodeHistory(result.records), hasMore: result.hasMore }
  }

  async respond(id: string, value: unknown): Promise<RpcReceipt> {
    const pending = this.questions.get(id)
    if (pending === undefined || !wireRecord(value) || value.sessionId !== pending.sessionId) {
      throw new Error('This request is no longer pending.')
    }
    const answer = pending.event === 'approval/request' ? value.outcome : value.answer
    if (pending.event === 'approval/request' && answer !== 'allowed-once' && answer !== 'rejected') throw new Error('Invalid approval outcome.')
    if (pending.event === 'user-questions/request' && (!wireRecord(answer) || !Array.isArray(answer.answers))) throw new Error('Invalid question answer.')
    await this.result(id, { kind: 'result', value: answer })
    this.dismissQuestion(id)
    return { accepted: true }
  }

  dispose(): void {
    this.closeFollow()
    for (const cancel of this.jobStreams.values()) cancel()
    this.jobStreams.clear()
    this.pendingJobBaselines.clear()
    this.monitoredJobs.clear()
    this.scannedJobs.clear()
    this.queuedJobBaselines.clear()
    this.available.clear()
    this.questions.clear()
    this.requestSessions.clear()
    this.subagentParents.clear()
    this.catalogParents.clear()
    this.streams.dispose()
  }

  private closeFollow(error = new Error('The conversation subscription changed.')): void {
    const previous = this.follow
    this.follow = undefined
    this.displayedQuestions.clear()
    if (previous === undefined) return
    this.releaseIdleJobStream(previous.sessionId)
    previous.cancel()
    previous.reject(error)
  }

  private baseline(endpoint: string, item: (value: Record<string, unknown>) => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let cancel = (): void => {}
      const timer = setTimeout(() => { cancel(); reject(new Error(`DSH ${endpoint} baseline timed out.`)) }, 30_000)
      cancel = this.streams.open(endpoint, {}, raw => {
        if (!wireRecord(raw)) throw new Error('Invalid DSH baseline.')
        if (item(raw)) { clearTimeout(timer); resolve() }
      }, error => { clearTimeout(timer); reject(error) })
    })
  }

  /**
   * DSH 0.1.7 moved jobs out of the `session/control` baseline into a per-session
   * `job/list` stream emitting `{ type: 'rows', jobs }`.
   *
   * The stream is optional, and its item handler never throws: a runtime that does
   * not serve `job/list` (DSH <= 0.1.5) must degrade to an empty job list rather
   * than fail the shared stream carrier.
   */
  private subscribeJobs(sessionId: string): void {
    if (this.jobStreams.has(sessionId)) return
    this.scannedJobs.add(sessionId)
    this.pendingJobBaselines.add(sessionId)
    let failed = false
    let timer: NodeJS.Timeout | undefined
    const failure = (error: Error): void => {
      failed = true
      if (timer !== undefined) clearTimeout(timer)
      this.pendingJobBaselines.delete(sessionId); this.jobStreams.delete(sessionId)
      this.mux({ type: 'session/jobs-status', sessionId, error: `Background task status may be stale: ${error.message}` })
      this.pumpJobBaselines()
    }
    const close = this.streams.open('job/list', { request: { sessionId } }, raw => {
      if (!wireRecord(raw) || raw.type !== 'rows' || !Array.isArray(raw.jobs)) return
      if (timer !== undefined) clearTimeout(timer)
      this.pendingJobBaselines.delete(sessionId)
      this.jobs.set(sessionId, raw.jobs)
      this.publishJobs(sessionId, raw.jobs)
      this.mux({ type: 'session/jobs-status', sessionId, error: null })
      this.releaseIdleJobStream(sessionId)
      this.pumpJobBaselines()
    }, failure, true)
    if (!failed) {
      const cancel = (): void => { if (timer !== undefined) clearTimeout(timer); close() }
      this.jobStreams.set(sessionId, cancel)
      if (this.pendingJobBaselines.has(sessionId)) timer = setTimeout(() => {
        cancel(); failure(new Error('Task status timed out. Refresh tasks to retry.'))
      }, 10_000)
    }
  }

  /** Keep watching work after navigation, until its last live job settles. */
  private releaseIdleJobStream(sessionId: string): void {
    if (this.follow?.sessionId === sessionId) return
    if (this.monitoredJobs.has(sessionId) && this.running.get(sessionId) === true) return
    const jobs = this.jobs.get(sessionId)
    // A baseline still in flight must get a chance to report live work.
    if (this.pendingJobBaselines.has(sessionId) || jobs === undefined
      || jobs.some(job => wireRecord(job) && (job.status === 'running' || job.status === 'stopping'))) return
    this.jobStreams.get(sessionId)?.()
    this.jobStreams.delete(sessionId)
  }

  private trackCatalog(parentId: string, value: unknown): void {
    if (!Array.isArray(value)) return
    for (const [child, parent] of this.catalogParents) if (parent === parentId) this.catalogParents.delete(child)
    for (const entry of value) if (wireRecord(entry) && entry.mode !== 'external' && typeof entry.id === 'string' && entry.id !== parentId) {
      this.catalogParents.set(entry.id, parentId)
    }
  }

  /** A delegated child can need an answer before anybody opens its transcript. */
  private handlesRequestsFor(sessionId: string): boolean {
    const seen = new Set<string>()
    for (let current: string | undefined = sessionId; current !== undefined && !seen.has(current);
      current = this.subagentParents.get(current) ?? this.catalogParents.get(current)) {
      if (current === this.follow?.sessionId || this.requestSessions.has(current)) return true
      seen.add(current)
    }
    return false
  }

  /**
   * DSH 0.1.7 replaced the control baseline's `queues` map with an `inbox`
   * projection shaped `{ 'next-turn': [...], 'next-step': [...] }`.
   *
   * `next-turn` holds messages waiting for the next turn, which are the ones the
   * sidebar can still steer; `next-step` holds messages already destined for the
   * running turn's next step. Never throws (see {@link inboxItems}).
   */
  private applyInbox(sessionId: string, value: unknown): void {
    if (!wireRecord(value)) return
    const items = [
      ...inboxItems(value['next-turn'], 'queued'),
      ...inboxItems(value['next-step'], 'steering'),
    ]
    this.queues.set(sessionId, items)
    if (this.follow?.active) this.mux({ type: 'session/queue', sessionId, items: this.queueItems(sessionId) })
  }

  private installProjections(sessionId: string, seq: number, values: Record<string, unknown>): void {
    const previous = this.projections.get(sessionId)
    const next = new Map<string, Projection>()
    for (const [key, value] of Object.entries(values)) next.set(key, { seq, value })
    // The control stream can already be ahead of the history snapshot.
    for (const [key, projection] of previous ?? []) if (projection.seq > seq) next.set(key, projection)
    this.projections.set(sessionId, next)
    this.projectionFloors.set(sessionId, Math.max(seq, this.projectionFloors.get(sessionId) ?? -1))
    // DSH 0.1.7 carries the message queue in the `inbox` projection, so seed the
    // queue model from the merged snapshot rather than only from live frames.
    const inbox = next.get('inbox')
    if (inbox !== undefined) this.applyInbox(sessionId, inbox.value)
    this.trackCatalog(sessionId, next.get('subagentCatalog')?.value)
  }

  private control(frame: Record<string, unknown>): void {
    if (frame.type === 'baseline') {
      // DSH 0.1.7 answers with `{ type: 'baseline', value: { projections } }`:
      // the payload moved under `value`, and `queues`/`jobs` were dropped from
      // the baseline entirely (their incremental frame types are gone too).
      // DSH <= 0.1.5 carried all three inline on the frame, so read whichever
      // shape actually arrived and treat queues/jobs as optional.
      const value = wireRecord(frame.value) ? frame.value : frame
      if (!wireRecord(value) || !wireRecord(value.projections)) throw new Error('Invalid control baseline.')
      if (wireRecord(value.queues)) for (const [id, items] of Object.entries(value.queues)) this.control({ type: 'queue', sessionId: id, items })
      if (wireRecord(value.jobs)) for (const [id, jobs] of Object.entries(value.jobs)) this.control({ type: 'jobs', sessionId: id, jobs })
      for (const [id, projection] of Object.entries(value.projections)) {
        if (!wireRecord(projection) || !wireRecord(projection.values) || !Number.isSafeInteger(projection.asOfSeq)) throw new Error('Invalid projection baseline.')
        this.installProjections(id, projection.asOfSeq as number, projection.values)
      }
      return
    }
    // `baseline` is consumed above; these three are the only incremental types
    // this client understands. The control carrier is non-optional and shared
    // with every other stream, so throwing on a future type aborted them all and
    // forced a reconnect loop, exactly like `$events` before it was hardened.
    if (frame.type !== 'queue' && frame.type !== 'jobs' && frame.type !== 'projection') {
      this.ignoreUnknownFrame('session/control', frame.type)
      return
    }
    const id = frame.sessionId
    if (typeof id !== 'string') throw new Error('Invalid control session.')
    if (frame.type === 'queue' && Array.isArray(frame.items)) {
      this.queues.set(id, frame.items)
      if (this.follow?.active) this.mux({ type: 'session/queue', sessionId: id, items: this.queueItems(id) })
    } else if (frame.type === 'jobs' && Array.isArray(frame.jobs)) {
      this.jobs.set(id, frame.jobs)
      this.publishJobs(id, frame.jobs)
    } else if (frame.type === 'projection' && typeof frame.key === 'string' && Number.isSafeInteger(frame.seq)) {
      if ((frame.seq as number) < (this.projectionFloors.get(id) ?? -1)) return
      const map = this.projections.get(id) ?? new Map<string, Projection>()
      if ((map.get(frame.key)?.seq ?? -1) > (frame.seq as number)) return
      map.set(frame.key, { seq: frame.seq as number, value: frame.value })
      this.projections.set(id, map)
      // DSH 0.1.7 delivers the message queue as the `inbox` projection.
      if (frame.key === 'inbox') this.applyInbox(id, frame.value)
      if (frame.key === 'subagentCatalog') this.trackCatalog(id, frame.value)
      // Replayed from the newest cached value on activation, never from stale buffered values.
      if (this.follow?.sessionId !== id || this.follow.active) this.mux({ type: 'session/projection', sessionId: id, key: frame.key, value: frame.value })
    } else throw new Error('Invalid control update.')
  }

  private queueItems(sessionId: string): unknown[] {
    const items = this.queues.get(sessionId) ?? []
    const state = this.follow
    if (state?.sessionId !== sessionId || state.committedMessages.size === 0) return items
    // Follow and control are independent streams. A late full queue snapshot
    // must not resurrect a steering row already committed to this conversation.
    return items.filter(item => !(wireRecord(item) && item.placement === 'steering'
      && wireRecord(item.message) && typeof item.message.id === 'string' && state.committedMessages.has(item.message.id)))
  }

  private acceptQueuedMessage(state: Follow, entry: HistoryEntry): void {
    const { type, data } = entry.event
    if (type !== 'user/message' || !wireRecord(data) || typeof data.id !== 'string') return
    const before = this.queueItems(state.sessionId)
    state.committedMessages.add(data.id)
    const items = this.queueItems(state.sessionId)
    if (state.active && before.length !== items.length) this.mux({ type: 'session/queue', sessionId: state.sessionId, items })
  }

  private remoteEvent(frame: Record<string, unknown>): void {
    // `ready` is consumed and validated by the `$events` baseline itself; these
    // three are the only other top-level types this client understands. A future
    // runtime may add one, and the carrier is shared with every other stream, so
    // throwing here aborted all of them and forced a reconnect loop. Unknown
    // types are therefore ignored and reported once per type instead.
    if (frame.type !== 'emit' && frame.type !== 'cancel' && frame.type !== 'waterfall') {
      this.ignoreUnknownFrame('$events', frame.type)
      return
    }
    if (frame.type === 'emit' && (frame.event === 'schedule/changed' || frame.event === 'goal/activation-changed')) {
      this.host({ type: frame.event === 'schedule/changed' ? 'host/schedules-changed' : 'host/goal-activation-changed', value: Array.isArray(frame.args) ? frame.args[0] : undefined })
    }
    if (frame.type === 'cancel' && typeof frame.eventId === 'string') { this.dismissQuestion(frame.eventId); return }
    if (frame.type === 'waterfall' && typeof frame.eventId === 'string' && typeof frame.agentId === 'string'
      && typeof frame.event === 'string' && wireRecord(frame.request)) {
      if (!this.handlesRequestsFor(frame.agentId)
        || (frame.event !== 'approval/request' && frame.event !== 'user-questions/request')) {
        void this.result(frame.eventId, { kind: 'next' }).catch(this.error)
        return
      }
      const question = { sessionId: frame.agentId, event: frame.event, request: frame.request }
      this.questions.set(frame.eventId, question)
      this.publishAttention(frame.agentId)
      this.presentQuestions()
      return
    }
    // The top-level type is known to be `emit` here; its payload stays strict.
    if (typeof frame.event !== 'string' || !Array.isArray(frame.args)) throw new Error('Invalid remote event.')
    const [id, value] = frame.args
    if (frame.event === 'deepseek-account/signed-out' || frame.event === 'deepseek-account/session-expired'
      || frame.event === 'deepseek-account/model-sign-in-required' || frame.event === 'credentials/record-updated') {
      // Account state is runtime-wide, so these carry no session identity.
      this.host({ type: 'host/account-changed' })
    } else if (frame.event === 'commands/change' && frame.args.length === 0) {
      this.host({ type: 'host/commands-changed' })
    } else if (frame.event === 'llm/adapters-updated' && frame.args.length === 0) {
      this.host({ type: 'host/models-changed' })
    } else if (frame.event === 'credentials/reference-updated' && typeof id === 'string') {
      // A credential reference is only an invalidation hint; never expose it to the Webview.
      this.host({ type: 'host/credentials-changed' })
    } else if (frame.event === 'settings/document-updated' && typeof id === 'string'
      && Number.isSafeInteger(value) && (value as number) >= 0) {
      this.host({ type: 'host/settings-changed', ns: id, revision: value })
    } else if (frame.event === 'agent-preset/selected' && typeof id === 'string' && typeof value === 'string') {
      // Selection itself comes from the sequenced projection, not this unsequenced hint.
      this.host({ type: 'host/session-composition-changed', sessionId: id })
    } else if (frame.event === 'plugin-manager/changed') {
      // The settings surface re-reads bundle and inventory state; the payload
      // only classifies the operation and never carries display facts.
      this.host({ type: 'host/plugins-changed' })
    } else if (frame.event === 'permission-presets/catalog-changed') {
      // The experimental `auto` preset can appear or disappear with a bundle.
      this.host({ type: 'host/permission-catalog-changed' })
    }
    if (frame.event === 'api-session/added' && wireRecord(id) && typeof id.sessionId === 'string'
      && typeof id.updatedAt === 'number' && Number.isFinite(id.updatedAt)
      && typeof id.running === 'boolean' && typeof id.blank === 'boolean') {
      const summary = id as unknown as SessionSummary
      this.addedSessions.set(summary.sessionId, { revision: ++this.addedRevision, summary })
      this.running.set(summary.sessionId, summary.running)
      if (typeof summary.agentAvailable === 'boolean') this.available.set(summary.sessionId, summary.agentAvailable)
      this.host({ ...this.summary(summary), type: 'host/session-added' })
    }
    else if (typeof id === 'string') {
      if (frame.event === 'api-session/status' && typeof value === 'boolean') {
        this.running.set(id, value)
        this.available.set(id, true)
        if (value && this.monitoredJobs.has(id)) { this.queuedJobBaselines.add(id); this.pumpJobBaselines() }
        else this.releaseIdleJobStream(id)
        if (value) this.nonBlankSessions.add(id)
        this.host({ type: 'host/session-status', sessionId: id, running: value, agentAvailable: true })
      } else if (frame.event === 'api-session/activity' && typeof value === 'number' && Number.isFinite(value)) {
        const updatedAt = Math.max(this.activity.get(id) ?? 0, value)
        this.activity.set(id, updatedAt)
        this.nonBlankSessions.add(id)
        this.host({ type: 'host/session-activity', sessionId: id, updatedAt })
      } else if (frame.event === 'api-session/removed') {
        // A disposed live instance is not a deletion of its persisted history.
        this.running.set(id, false)
        this.available.set(id, false)
        this.requestSessions.delete(id)
        this.queues.delete(id)
        this.jobs.delete(id)
        this.jobStreams.get(id)?.()
        this.jobStreams.delete(id)
        this.pendingJobBaselines.delete(id)
        this.pumpJobBaselines()
        this.projections.delete(id)
        this.projectionFloors.delete(id)
        // Everything below is derived from events, so the durable session list
        // and any later event restore it. Without this each session ever made
        // live stayed in memory for the life of the window — `addedSessions`
        // holding a full summary each.
        this.addedSessions.delete(id)
        this.activity.delete(id)
        this.nonBlankSessions.delete(id)
        for (const [eventId, question] of this.questions) if (question.sessionId === id) this.dismissQuestion(eventId)
        this.mux({ type: 'session/queue', sessionId: id, items: [] })
        this.publishJobs(id, [])
        this.host({ type: 'host/session-removed', sessionId: id })
      } else if (frame.event === 'api-session/error') this.host({ type: 'host/agent-error', sessionId: id, message: value })
    }
  }

  /**
   * Report one unrecognized top-level frame type for a stream, once.
   *
   * Rate limiting matters in both directions: a runtime that repeats the same
   * unknown frame must not flood the log, and a runtime that fabricates endless
   * novel types must not grow the per-stream budget without bound or defeat the
   * limiter. Each stream owns its budget, so a noisy one cannot silence another.
   */
  private ignoreUnknownFrame(endpoint: string, type: unknown): void {
    let budget = this.ignoredFrameTypes.get(endpoint)
    if (budget === undefined) {
      budget = { types: new Set<string>(), overflow: false }
      this.ignoredFrameTypes.set(endpoint, budget)
    }
    const label = frameTypeLabel(type)
    if (budget.types.has(label)) return
    if (budget.types.size >= UNKNOWN_FRAME_TYPE_LIMIT) {
      if (budget.overflow) return
      budget.overflow = true
      this.diagnostic(`${endpoint}: further unknown frame types are suppressed for this connection (after ${String(UNKNOWN_FRAME_TYPE_LIMIT)})`)
      return
    }
    budget.types.add(label)
    this.diagnostic(`${endpoint}: ignored unknown frame type "${label}"`)
  }

  private presentQuestion(id: string, pending: PendingQuestion): void {
    const approval = pending.event === 'approval/request'
    this.emit({ channel: 'mux', rpcId: id, payload: { ...pending.request, sessionId: pending.sessionId,
      type: approval ? 'approval/requested' : 'question/requested', ...(approval ? { approvalId: id } : {}) } })
  }

  private presentQuestions(): void {
    if (this.follow?.active !== true) return
    // The sidebar has one approval panel and one question panel. Keep parallel
    // tool approvals queued instead of overwriting an unanswered request.
    const shown = new Set<string>()
    for (const [id, pending] of this.questions) {
      if (pending.sessionId !== this.follow.sessionId || shown.has(pending.event)) continue
      shown.add(pending.event)
      if (this.displayedQuestions.get(pending.event) !== id) {
        this.displayedQuestions.set(pending.event, id)
        this.presentQuestion(id, pending)
      }
    }
  }

  private dismissQuestion(id: string): void {
    const pending = this.questions.get(id)
    if (pending === undefined) return
    this.questions.delete(id)
    this.publishAttention(pending.sessionId)
    if (this.displayedQuestions.get(pending.event) === id) this.displayedQuestions.delete(pending.event)
    this.mux({ type: pending.event === 'approval/request' ? 'approval/resolved' : 'question/resolved',
      sessionId: pending.sessionId, approvalId: id, questionRpcId: id })
    this.presentQuestions()
  }

  private publishAttention(sessionId: string): void {
    const pending = [...this.questions.values()].filter(question => question.sessionId === sessionId)
    this.host({ type: 'host/session-attention', sessionId,
      approvals: pending.filter(question => question.event === 'approval/request').length,
      questions: pending.filter(question => question.event === 'user-questions/request').length })
  }

  private result(eventId: string, outcome: unknown): Promise<void> {
    if (this.clientId === undefined) return Promise.reject(new Error('DSH event stream is not ready.'))
    return this.connection.call('$events/result', { clientId: this.clientId, eventId, outcome })
  }

  private publishJobs(sessionId: string, jobs: unknown[]): void {
    // Runtime-wide control state must arrive even before any session is opened.
    // Do not journal-buffer it: activation would replay old jobs after the latest snapshot.
    this.emit({ channel: 'mux', rpcId: '', payload: { type: 'session/jobs', sessionId, jobs } })
  }

  private mux(payload: Record<string, unknown>): void {
    const frame: DshFrame = { channel: 'mux', rpcId: '', payload }
    const state = this.follow
    if (state !== undefined && !state.active && payload.sessionId === state.sessionId) state.pending.push(frame)
    else this.emit(frame)
  }

  private host(payload: Record<string, unknown>): void { this.emit({ channel: 'host', rpcId: '', payload }) }
}
