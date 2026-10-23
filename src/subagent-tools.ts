export interface SubagentToolReference { id: string; label?: string }
const record = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const idOf = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/\s/.test(value) ? value : undefined

/** Static adapters for official delegation results; never execute a presenter. */
export function subagentToolReferences(name: string, raw: unknown, text = '', meta?: unknown, failed = false): SubagentToolReference[] {
  let args = record(raw)
  if (typeof raw === 'string') { try { args = record(JSON.parse(raw)) } catch { /* An incomplete streaming argument is not an address. */ } }
  if (name === 'send_message' || name === 'interrupt_agent') {
    const id = idOf(args?.agent_id)
    return id === undefined ? [] : [{ id }]
  }
  if (failed) return []
  const delegation = name === 'subagent' || name === 'spawn_agent' || name === 'fork_agent'
    || (typeof args?.prompt === 'string' && typeof args.description === 'string')
  const code = name === 'run_code'
  if (!delegation && !code) return []
  const label = delegation && typeof args?.description === 'string' ? args.description.slice(0, 300) : undefined
  const ids = new Set<string>()
  const collect = (value: unknown): void => {
    const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
    const seen = new Set<object>()
    let visited = 0
    while (pending.length && ids.size < 100 && visited++ < 1000) {
      const entry = pending.pop()!
      if (entry.depth > 6 || typeof entry.value !== 'object' || entry.value === null || seen.has(entry.value)) continue
      seen.add(entry.value)
      const source = record(entry.value)
      if (source?.kind === 'activation') {
        const id = idOf(source.subagentId)
        if (id !== undefined) ids.add(id)
      }
      if (entry.depth === 6) continue
      for (const key in entry.value) {
        if (pending.length >= 1000) break
        if (Object.hasOwn(entry.value, key)) pending.push({ value: (entry.value as Record<string, unknown>)[key], depth: entry.depth + 1 })
      }
    }
  }
  collect(meta)
  if (text.length <= 1_000_000 && text.includes('"subagentId"')) {
    try { collect(JSON.parse(text)) } catch {
      if (code) for (const line of text.split(/\r?\n/, 1000)) {
        if (!line.trimStart().startsWith('{') || !line.includes('"subagentId"')) continue
        try { collect(JSON.parse(line)) } catch { /* Non-JSON stdout stays ordinary output. */ }
      }
    }
  }
  // This is DSH's exact rendered result, including code-mode stdout lines.
  for (const match of text.matchAll(/(?:^|\n)started subagent ([^\s]+)(?=\r?$|\n)/gm)) {
    if (ids.size >= 100) break
    const id = idOf(match[1]); if (id !== undefined) ids.add(id)
  }
  return [...ids].map(id => ({ id, ...(label === undefined ? {} : { label }) }))
}

export function subagentToolLabel(name: string, raw: unknown): string | undefined {
  let args = record(raw)
  if (typeof raw === 'string') { try { args = record(JSON.parse(raw)) } catch { return undefined } }
  if ((name === 'subagent' || name === 'spawn_agent' || name === 'fork_agent'
    || (typeof args?.prompt === 'string' && typeof args.description === 'string')) && typeof args?.description === 'string') return args.description.slice(0, 300)
  return undefined
}
