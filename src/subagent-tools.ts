export interface SubagentToolReference {
  id: string
  label?: string
  /**
   * Team member name when the tool could only name its target.
   *
   * DSH 0.2.1-rc.3 Team tools expose member names (`target`) rather than Session
   * ids: `modelMember` strips the id before the result reaches the model. The
   * renderer resolves {@link id} provisionally from this name against the
   * `agentTeam` projection, and drops the reference when the name is unknown so
   * a generic tool card is shown instead of a dead link.
   */
  memberName?: string
}
const record = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const idOf = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/\s/.test(value) ? value : undefined

/** Static adapters for official delegation results; never execute a presenter. */
export function subagentToolReferences(name: string, raw: unknown, text = '', meta?: unknown, failed = false): SubagentToolReference[] {
  let args = record(raw)
  if (typeof raw === 'string') { try { args = record(JSON.parse(raw)) } catch { /* An incomplete streaming argument is not an address. */ } }
  if (name === 'send_message' || name === 'interrupt_agent') {
    // rc.1 addresses a child by Session id; rc.2 names it (`agent`), and the
    // rc.3 Team variant used `target`. An id is already a link; a name needs the
    // projection resolution the renderer performs.
    const id = idOf(args?.agent_id)
    if (id !== undefined) return [{ id }]
    const agent = idOf(args?.agent)
    if (agent !== undefined) return [{ id: agent, memberName: agent }]
    const target = idOf(args?.target)
    return target === undefined ? [] : [{ id: target, memberName: target }]
  }
  if (name === 'spawn_teammate') {
    if (failed) return []
    const target = spawnedMemberTargetOf(text) ?? idOf(args?.name)
    if (target === undefined) return []
    const label = typeof args?.description === 'string' ? args.description.slice(0, 300) : undefined
    return [{ id: target, memberName: target, ...(label === undefined ? {} : { label }) }]
  }
  if (name === 'list_agents') {
    if (failed) return []
    return listedMemberTargetsOf(text)
  }
  // rc.2 Team tools act on the shared board, and `wait_agent` reports waiting;
  // neither names a subagent conversation that a card could link to.
  if (name === 'wait_agent' || name.startsWith('team_task_')) return []
  if (failed) return []
  const delegation = name === 'subagent' || name === 'spawn_agent' || name === 'fork_agent'
    || (typeof args?.prompt === 'string' && typeof args.description === 'string')
  const code = name === 'run_code'
  if (!delegation && !code) return []
  const label = delegation && typeof args?.description === 'string' ? args.description.slice(0, 300) : undefined
  const ids = new Set<string>()
  const names = new Set<string>()
  const collect = (value: unknown): void => {
    const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
    const seen = new Set<object>()
    let visited = 0
    while (pending.length && ids.size + names.size < 100 && visited++ < 1000) {
      const entry = pending.pop()!
      if (entry.depth > 6 || typeof entry.value !== 'object' || entry.value === null || seen.has(entry.value)) continue
      seen.add(entry.value)
      const source = record(entry.value)
      if (source?.kind === 'activation') {
        // rc.1 activates a Session (`subagentId`); rc.2 activates a named agent
        // (`name`). Only the former is a ready link; the latter resolves through
        // the Team roster or the subagent catalog.
        const id = idOf(source.subagentId)
        if (id !== undefined) ids.add(id)
        const name = idOf(source.name)
        if (name !== undefined) names.add(name)
      }
      if (entry.depth === 6) continue
      for (const key in entry.value) {
        if (pending.length >= 1000) break
        if (Object.hasOwn(entry.value, key)) pending.push({ value: (entry.value as Record<string, unknown>)[key], depth: entry.depth + 1 })
      }
    }
  }
  collect(meta)
  if (text.length <= 1_000_000 && (text.includes('"subagentId"') || text.includes('"activation"'))) {
    try { collect(JSON.parse(text)) } catch {
      if (code) for (const line of text.split(/\r?\n/, 1000)) {
        if (!line.trimStart().startsWith('{') || !(line.includes('"subagentId"') || line.includes('"activation"'))) continue
        try { collect(JSON.parse(line)) } catch { /* Non-JSON stdout stays ordinary output. */ }
      }
    }
  }
  if (delegation) {
    // A requested rc.2 name is already known before the result lands, and the
    // rendered line repeats that name rather than a Session id.
    const requested = idOf(args?.name)
    if (requested !== undefined) names.add(requested)
  }
  // This is DSH's exact rendered result, including code-mode stdout lines. The
  // token is a Session id on rc.1 and the agent's name on rc.2; a token already
  // collected as a name is not repeated as a raw id.
  for (const match of text.matchAll(/(?:^|\n)started subagent ([^\s]+)(?=\r?$|\n)/gm)) {
    if (ids.size + names.size >= 100) break
    const token = idOf(match[1])
    if (token === undefined || names.has(token)) continue
    ids.add(token)
  }
  return [
    ...[...ids].map(id => ({ id, ...(label === undefined ? {} : { label }) })),
    ...[...names].filter(name => !ids.has(name)).map(name => ({ id: name, memberName: name, ...(label === undefined ? {} : { label }) })),
  ]
}

/**
 * The teammate a `spawn_teammate` result created, as its model-facing name.
 *
 * The result is `{ member: { target, ... } }`; `target` is the member name
 * (`modelMember` deliberately omits the Session id). A streaming or legacy
 * result may not parse yet, so the requested name is an equally valid address.
 */
function spawnedMemberTargetOf(text: string): string | undefined {
  if (text.length > 1_000_000) return undefined
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  const member = record(record(value)?.member)
  return idOf(member?.target) ?? idOf(member?.name)
}

/**
 * The roster a `list_agents` result returned, as model-facing member names.
 *
 * rc.2 returns an array of `{name, status, description}` rows; the earlier Team
 * variant returned `{target}` rows, optionally under `members`. Both name an
 * agent rather than a Session id, so the renderer resolves each row through the
 * catalog. `status` and `description` are presentation data and never become
 * addresses.
 */
function listedMemberTargetsOf(text: string): SubagentToolReference[] {
  if (text.length > 1_000_000) return []
  let value: unknown
  try { value = JSON.parse(text) } catch { return listedMemberTargetsFromText(text) }
  const result = record(value)
  const rows = Array.isArray(value) ? value : result !== undefined && Array.isArray(result.members) ? result.members : []
  const references: SubagentToolReference[] = []
  for (const row of rows) {
    if (references.length >= 100) break
    const entry = record(row)
    const target = idOf(entry?.name) ?? idOf(entry?.target)
    if (target === undefined || references.some(reference => reference.memberName === target)) continue
    references.push({ id: target, memberName: target })
  }
  return references
}

/** `list_agents` rendered rows: `name [status] — description`. */
function listedMemberTargetsFromText(text: string): SubagentToolReference[] {
  const references: SubagentToolReference[] = []
  for (const line of text.split(/\r?\n/, 200)) {
    if (references.length >= 100) break
    const match = /^([^\s\[\]]+) \[(?:running|inactive|corrupt|unsupported|unavailable)\](?: — .*)?$/.exec(line)
    const target = idOf(match?.[1])
    if (target === undefined || references.some(reference => reference.memberName === target)) continue
    references.push({ id: target, memberName: target })
  }
  return references
}

export function subagentToolLabel(name: string, raw: unknown): string | undefined {
  let args = record(raw)
  if (typeof raw === 'string') { try { args = record(JSON.parse(raw)) } catch { return undefined } }
  if ((name === 'subagent' || name === 'spawn_agent' || name === 'fork_agent'
    || (typeof args?.prompt === 'string' && typeof args.description === 'string')) && typeof args?.description === 'string') return args.description.slice(0, 300)
  return undefined
}
