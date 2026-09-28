import type { SessionSummary } from './dsh-client.js'

export interface SessionAttention { approvals: number; questions: number }

/** How a parent can talk to one of its subagent sessions. */
export interface SubagentIdentity {
  mode: 'one-shot' | 'continuable' | 'unknown'
  label?: string
}

export interface SessionItem {
  id: string
  title: string
  updatedAt: number
  running: boolean
  blank: boolean
  unread: boolean
  attention?: SessionAttention
  /** Set when this row is a subagent session, naming its owning conversation. */
  parentId?: string
  /** Present on subagent rows; a `one-shot` child is finished work, not a chat. */
  subagent?: SubagentIdentity
  /** Direct subagent children this row can reveal. */
  childCount: number
}

export function sessionTitle(summary: SessionSummary): string {
  const value = summary.projections?.values?.title
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'New conversation'
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function labelOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Read the `subagent` identity projection a child session folds for itself. */
function identityOf(summary: SessionSummary): SubagentIdentity | undefined {
  const identity = recordOf(summary.projections?.values?.subagent)
  if (identity === undefined) return undefined
  const mode = identity.mode
  if (mode !== 'one-shot' && mode !== 'continuable' && mode !== 'unknown') return undefined
  const label = labelOf(identity.label)
  return { mode, ...(label === undefined ? {} : { label }) }
}

/** Read the parent-owned `subagentCatalog` entries: `{ id, createdAt, mode, label? }`. */
function catalogOf(summary: SessionSummary | undefined): Map<string, SubagentIdentity> {
  const catalog = new Map<string, SubagentIdentity>()
  const entries = summary?.projections?.values?.subagentCatalog
  if (!Array.isArray(entries)) return catalog
  for (const value of entries) {
    const entry = recordOf(value)
    if (entry === undefined || typeof entry.id !== 'string') continue
    const mode = entry.mode === 'one-shot' || entry.mode === 'continuable' ? entry.mode : 'unknown'
    const label = labelOf(entry.label)
    catalog.set(entry.id, { mode, ...(label === undefined ? {} : { label }) })
  }
  return catalog
}

interface Forest {
  roots: SessionSummary[]
  /** Children keyed by their direct parent, in the order the parent catalog lists them. */
  children: Map<string, SessionSummary[]>
  /** Direct parent of every owned child. */
  parentOf: Map<string, string>
  identity: Map<string, SubagentIdentity>
}

/**
 * Split conversations into the forest the picker walks.
 *
 * A subagent is the only session kind that belongs under a parent. DSH also
 * records `parentSession` for a fork, but a fork sets no `origin`, and a fork
 * is an independent conversation: nesting it would hide its rename and archive
 * actions and would make it vanish when its source is archived.
 *
 * A subagent whose owner is not in this project is neither a root nor placed
 * under a stranger, so it stays out of the picker until its owner is visible.
 * It is still carried in the host model, so its work keeps counting.
 */
function partition(summaries: readonly SessionSummary[]): Forest {
  const byId = new Map(summaries.map(summary => [summary.sessionId, summary]))
  const catalogOwner = new Map<string, string>()
  for (const summary of summaries) {
    for (const id of catalogOf(summary).keys()) catalogOwner.set(id, summary.sessionId)
  }
  const roots: SessionSummary[] = []
  const children = new Map<string, SessionSummary[]>()
  const parentOf = new Map<string, string>()
  const identity = new Map<string, SubagentIdentity>()
  for (const summary of summaries) {
    // Only a declared subagent owns a lineage link; a fork's link is seed
    // lineage, and the catalog only ever names subagent children.
    const declared = summary.origin === 'subagent' ? summary.parentSessionId : undefined
    const owner = catalogOwner.get(summary.sessionId)
    const parentId = declared !== undefined && declared !== summary.sessionId && byId.has(declared)
      ? declared
      : owner !== undefined && owner !== summary.sessionId ? owner : undefined
    if (parentId === undefined) {
      if (summary.origin !== 'subagent') roots.push(summary)
      continue
    }
    parentOf.set(summary.sessionId, parentId)
    const bucket = children.get(parentId)
    if (bucket === undefined) children.set(parentId, [summary])
    else bucket.push(summary)
  }
  for (const [parentId, bucket] of children) {
    const parentCatalog = catalogOf(byId.get(parentId))
    for (const child of bucket) {
      const merged = identityOf(child) ?? parentCatalog.get(child.sessionId)
      if (merged !== undefined) identity.set(child.sessionId, merged)
    }
  }
  return { roots, children, parentOf, identity }
}

function toSessionItem(
  summary: SessionSummary,
  unreadSessionIds: ReadonlySet<string>,
  attention: ReadonlyMap<string, SessionAttention>,
  parentId: string | undefined,
  subagent: SubagentIdentity | undefined,
  childCount: number,
): SessionItem {
  const waiting = attention.get(summary.sessionId)
  return {
    id: summary.sessionId,
    title: sessionTitle(summary),
    updatedAt: summary.updatedAt,
    running: summary.running,
    blank: summary.blank,
    unread: unreadSessionIds.has(summary.sessionId),
    childCount,
    ...(parentId === undefined ? {} : { parentId }),
    ...(subagent === undefined ? {} : { subagent }),
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
  const forest = partition(summaries)
  const { children, parentOf, identity } = forest
  /** A session earns a row by being open, working, waiting, or named by its owner. */
  const earns = (summary: SessionSummary): boolean => !archivedSessionIds.has(summary.sessionId)
    && (!summary.blank || summary.sessionId === selectedId || summary.running || attention.has(summary.sessionId))

  // The picker must always be able to show where the open conversation sits,
  // so every ancestor of the selection stays visible even when otherwise blank.
  const keep = new Set<string>()
  for (let cursor = selectedId === undefined ? undefined : parentOf.get(selectedId);
    cursor !== undefined;
    cursor = parentOf.get(cursor)) {
    keep.add(cursor)
  }

  const visibleRoots = forest.roots
    .filter(summary => !archivedSessionIds.has(summary.sessionId))
    .filter(summary => earns(summary) || keep.has(summary.sessionId))
    .sort((left, right) => right.updatedAt - left.updatedAt)

  const items: SessionItem[] = []
  const emit = (
    summary: SessionSummary,
    parentId: string | undefined,
    subagent: SubagentIdentity | undefined,
    ancestors: ReadonlySet<string>,
  ): void => {
    // Delegation can nest, so the walk is recursive; a cycle in malformed data
    // stops at the repeat instead of recursing forever.
    const next = new Set(ancestors).add(summary.sessionId)
    const kids = (children.get(summary.sessionId) ?? [])
      .filter(kid => !next.has(kid.sessionId) && (earns(kid) || keep.has(kid.sessionId)))
      .sort((left, right) => left.updatedAt - right.updatedAt)
    // The count must match what expanding reveals, or the disclosure would
    // promise rows that are not there.
    items.push(toSessionItem(summary, unreadSessionIds, attention, parentId, subagent, kids.length))
    for (const kid of kids) emit(kid, summary.sessionId, identity.get(kid.sessionId) ?? { mode: 'unknown' }, next)
  }
  for (const root of visibleRoots) emit(root, undefined, undefined, new Set())
  return items
}

/** The direct owner of one subagent session, for the ancestor breadcrumb. */
export function parentIdOf(summaries: readonly SessionSummary[], sessionId: string): string | undefined {
  return partition(summaries).parentOf.get(sessionId)
}

/**
 * Archived conversations, newest first, so the sidebar can offer a way back.
 * Blank archived sessions stay hidden: there is nothing to recover from them.
 * A subagent archived with its parent is listed here like any other, because
 * the active list drops it and this is the only way back.
 */
export function archivedSessionItems(
  summaries: readonly SessionSummary[],
  archivedSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
  attention: ReadonlyMap<string, SessionAttention> = new Map(),
): SessionItem[] {
  return summaries
    .filter(summary => archivedSessionIds.has(summary.sessionId) && !summary.blank)
    .map(summary => toSessionItem(summary, unreadSessionIds, attention, undefined, undefined, 0))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function filterSessionItems(items: readonly SessionItem[], query: string): SessionItem[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return [...items]
  return items.filter(item => item.title.toLocaleLowerCase().includes(normalized))
}
