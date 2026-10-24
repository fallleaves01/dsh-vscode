/**
 * Pure view model for the Agent Teams `agentTeam` Session projection.
 *
 * DSH 0.2.1-rc.3 publishes the durable Team roster, the non-deleted task board,
 * and the first rejected persistent Team record as one sequenced projection on
 * the Lead Session. The host already validates the value it writes, but the
 * value crosses a process and a package-version boundary, so this module
 * re-validates it defensively and derives the small, sorted view a narrow
 * sidebar renders. Every export is pure: no `vscode` import, no I/O, no
 * mutation of the parsed input, and no function throws.
 */

export type AgentTeamMemberRole = 'lead' | 'teammate'

export type AgentTeamMemberPhase = 'provisioning' | 'active' | 'failed'

export type AgentTeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Statuses a rendered task can carry; the projection drops `deleted` tasks. */
export type AgentTeamVisibleTaskStatus = Exclude<AgentTeamTaskStatus, 'deleted'>

export interface AgentTeamMember {
  id: string
  name: string
  role: AgentTeamMemberRole
  /** Durable lifecycle. Turn activity is a Session status, not this field. */
  phase: AgentTeamMemberPhase
  error?: string
}

export interface AgentTeamTask {
  id: string
  revision: number
  subject: string
  description: string
  status: AgentTeamVisibleTaskStatus
  blockedBy: string[]
  writeScopes: string[]
  ownerName?: string
  /** Host-derived readiness of a pending task: every blocker completed. */
  ready: boolean
  writeScopeWarnings: string[]
  /** Derived here: the task is not completed and at least one blocker is not completed. */
  blocked: boolean
}

export interface AgentTeamView {
  /** The Lead row first, then teammates by name. */
  members: AgentTeamMember[]
  /** In progress, then pending, then completed; ties by task id. */
  tasks: AgentTeamTask[]
  /** First rejected persistent Team record, preserved verbatim for display. */
  failure?: string
  completedCount: number
  totalCount: number
}

/**
 * Validate one `agentTeam` projection value and normalize it for rendering.
 *
 * @param projectionsValues - a Session's `projections.values` map, as carried by
 *   the session summary or built from one `session/projection` frame. A bare
 *   projection object is not accepted: the key is part of the contract.
 * @returns the normalized view, or `undefined` when the projection is absent,
 *   not an object, or carries neither members, tasks, nor a failure.
 */
export function agentTeamOf(projectionsValues: unknown): AgentTeamView | undefined {
  const values = recordOf(projectionsValues)
  if (values === undefined) return undefined
  const projection = recordOf(values.agentTeam)
  if (projection === undefined) return undefined
  const members = membersOf(projection.members)
  const tasks = tasksOf(projection.tasks)
  const failure = textOf(projection.failure)
  // A present projection with nothing to show is treated as absent so the
  // sidebar can hide the panel instead of rendering an empty shell.
  if (members.length === 0 && tasks.length === 0 && failure === undefined) return undefined
  return {
    members,
    tasks,
    ...(failure === undefined ? {} : { failure }),
    completedCount: tasks.filter(task => task.status === 'completed').length,
    totalCount: tasks.length,
  }
}

/**
 * One line for a collapsed task panel, e.g. `2 members · 3/5 tasks done`.
 *
 * @param view - a view from {@link agentTeamOf}.
 * @returns the summary, or an empty string when there is no team to show.
 */
export function agentTeamSummaryOf(view: AgentTeamView | undefined): string {
  if (view === undefined) return ''
  const members = `${view.members.length} ${view.members.length === 1 ? 'member' : 'members'}`
  if (view.totalCount === 0) return members
  return `${members} · ${view.completedCount}/${view.totalCount} tasks done`
}

const MEMBER_ROLE_ORDER: Readonly<Record<AgentTeamMemberRole, number>> = { lead: 0, teammate: 1 }

const TASK_STATUS_ORDER: Readonly<Record<AgentTeamVisibleTaskStatus, number>> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
}

function membersOf(value: unknown): AgentTeamMember[] {
  if (!Array.isArray(value)) return []
  const members: AgentTeamMember[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const member = memberOf(entry)
    if (member === undefined || seen.has(member.id)) continue
    seen.add(member.id)
    members.push(member)
  }
  return members.sort((left, right) => MEMBER_ROLE_ORDER[left.role] - MEMBER_ROLE_ORDER[right.role]
    || compareText(left.name, right.name) || compareText(left.id, right.id))
}

function memberOf(value: unknown): AgentTeamMember | undefined {
  const row = recordOf(value)
  if (row === undefined) return undefined
  const id = textOf(row.id)
  const role = roleOf(row.role)
  const phase = phaseOf(row.phase)
  if (id === undefined || role === undefined || phase === undefined || typeof row.name !== 'string') return undefined
  const error = textOf(row.error)
  return { id, name: row.name, role, phase, ...(error === undefined ? {} : { error }) }
}

/** A parsed task before readiness and blocking are derived from its siblings. */
interface ParsedTask {
  id: string
  revision: number
  subject: string
  description: string
  status: AgentTeamVisibleTaskStatus
  blockedBy: string[]
  writeScopes: string[]
  ownerName?: string
  ready: boolean | undefined
  writeScopeWarnings: string[]
}

function tasksOf(value: unknown): AgentTeamTask[] {
  if (!Array.isArray(value)) return []
  const parsed: ParsedTask[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const task = parsedTaskOf(entry)
    if (task === undefined || seen.has(task.id)) continue
    seen.add(task.id)
    parsed.push(task)
  }
  const completed = new Set(parsed.filter(task => task.status === 'completed').map(task => task.id))
  return parsed.map(({ ready, ...task }): AgentTeamTask => ({
    ...task,
    ready: ready ?? (task.status === 'pending' && task.blockedBy.every(id => completed.has(id))),
    blocked: task.status !== 'completed' && task.blockedBy.some(id => !completed.has(id)),
  })).sort((left, right) => TASK_STATUS_ORDER[left.status] - TASK_STATUS_ORDER[right.status]
    || compareTaskIds(left.id, right.id))
}

function parsedTaskOf(value: unknown): ParsedTask | undefined {
  const row = recordOf(value)
  if (row === undefined) return undefined
  const id = textOf(row.id)
  const revision = row.revision
  const status = taskStatusOf(row.status)
  if (id === undefined || status === undefined || status === 'deleted') return undefined
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return undefined
  if (typeof row.subject !== 'string' || typeof row.description !== 'string') return undefined
  const ownerName = textOf(row.ownerName)
  return {
    id,
    revision,
    subject: row.subject,
    description: row.description,
    status,
    blockedBy: stringsOf(row.blockedBy),
    writeScopes: stringsOf(row.writeScopes),
    ...(ownerName === undefined ? {} : { ownerName }),
    ready: typeof row.ready === 'boolean' ? row.ready : undefined,
    writeScopeWarnings: stringsOf(row.writeScopeWarnings),
  }
}

function roleOf(value: unknown): AgentTeamMemberRole | undefined {
  return value === 'lead' || value === 'teammate' ? value : undefined
}

function phaseOf(value: unknown): AgentTeamMemberPhase | undefined {
  return value === 'provisioning' || value === 'active' || value === 'failed' ? value : undefined
}

function taskStatusOf(value: unknown): AgentTeamTaskStatus | undefined {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted'
    ? value
    : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Keep a wire string verbatim; only an absent or blank value counts as absent. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Normalize a wire collection to its string entries, tolerating a wrong shape. */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Order DSH's `task-N` ids by number instead of code unit, so `task-2` precedes
 * `task-10`; any other id shape falls back to deterministic code-unit order.
 */
function compareTaskIds(left: string, right: string): number {
  const leftNumber = trailingNumber(left)
  const rightNumber = trailingNumber(right)
  if (leftNumber !== undefined && rightNumber !== undefined && leftNumber.prefix === rightNumber.prefix) {
    const order = leftNumber.number - rightNumber.number
    if (order !== 0) return order
  }
  return compareText(left, right)
}

function trailingNumber(value: string): { prefix: string; number: number } | undefined {
  const match = /^(.*?)(\d+)$/u.exec(value)
  if (match === null) return undefined
  const [, prefix = '', digits = ''] = match
  return { prefix, number: Number(digits) }
}
