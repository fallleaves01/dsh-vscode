/** The session-owned `todos` projection, replaced as a whole by DSH. */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export function todosOf(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): TodoItem[] => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as Record<string, unknown>
    if (typeof row.content !== 'string' || row.content.trim() === ''
      || (row.status !== 'pending' && row.status !== 'in_progress' && row.status !== 'completed')) return []
    return [{ content: row.content, status: row.status }]
  })
}
