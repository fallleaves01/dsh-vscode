import type { SessionSummary } from './dsh-client.js'

export interface SessionAttention { approvals: number; questions: number }

export interface SessionItem {
  id: string
  title: string
  updatedAt: number
  running: boolean
  blank: boolean
  unread: boolean
  attention?: SessionAttention
}

export function sessionTitle(summary: SessionSummary): string {
  const value = summary.projections?.values?.title
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'New conversation'
}

function toSessionItem(
  summary: SessionSummary,
  unreadSessionIds: ReadonlySet<string>,
  attention: ReadonlyMap<string, SessionAttention>,
): SessionItem {
  const waiting = attention.get(summary.sessionId)
  return {
    id: summary.sessionId,
    title: sessionTitle(summary),
    updatedAt: summary.updatedAt,
    running: summary.running,
    blank: summary.blank,
    unread: unreadSessionIds.has(summary.sessionId),
    ...(waiting === undefined ? {} : { attention: waiting }),
  }
}

export function sessionItems(
  summaries: readonly SessionSummary[],
  archivedSessionIds: ReadonlySet<string>,
  selectedId: string | undefined,
  unreadSessionIds: ReadonlySet<string>,
  attention: ReadonlyMap<string, SessionAttention> = new Map(),
): SessionItem[] {
  return summaries
    .filter(summary => !archivedSessionIds.has(summary.sessionId))
    .filter(summary => !summary.blank || summary.sessionId === selectedId || attention.has(summary.sessionId))
    .map(summary => toSessionItem(summary, unreadSessionIds, attention))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

/**
 * Archived conversations, newest first, so the sidebar can offer a way back.
 * Blank archived sessions stay hidden: there is nothing to recover from them.
 */
export function archivedSessionItems(
  summaries: readonly SessionSummary[],
  archivedSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
  attention: ReadonlyMap<string, SessionAttention> = new Map(),
): SessionItem[] {
  return summaries
    .filter(summary => archivedSessionIds.has(summary.sessionId) && !summary.blank)
    .map(summary => toSessionItem(summary, unreadSessionIds, attention))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function filterSessionItems(items: readonly SessionItem[], query: string): SessionItem[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return [...items]
  return items.filter(item => item.title.toLocaleLowerCase().includes(normalized))
}
