import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '../src/dsh-client.js'
import { archivedSessionItems, filterSessionItems, parentIdOf, sessionItems, sessionTitle } from '../src/session-center.js'

function summary(overrides: Partial<SessionSummary> & Pick<SessionSummary, 'sessionId'>): SessionSummary {
  return {
    updatedAt: 0,
    running: false,
    blank: false,
    ...overrides,
  }
}

describe('session center state', () => {
  it('keeps a blank conversation visible while it needs a response, but respects archiving', () => {
    const pending = { approvals: 1, questions: 2 }
    const items = sessionItems([
      summary({ sessionId: 'waiting', blank: true }), summary({ sessionId: 'archived', blank: true }),
    ], new Set(['archived']), 'other', new Set(), new Map([['waiting', pending], ['archived', pending]]))
    expect(items).toEqual([expect.objectContaining({ id: 'waiting', attention: pending })])
  })

  it('uses the official title projection with a friendly blank fallback', () => {
    expect(sessionTitle(summary({ sessionId: 'one', projections: { values: { title: '  Fix login  ' } } }))).toBe('Fix login')
    expect(sessionTitle(summary({ sessionId: 'two', projections: { values: { title: '   ' } } }))).toBe('New conversation')
  })

  it('hides archived and unrelated blank sessions while preserving status metadata', () => {
    const items = sessionItems([
      summary({ sessionId: 'older', updatedAt: 10, running: true }),
      summary({ sessionId: 'newer', updatedAt: 30, projections: { values: { title: 'Latest work' } } }),
      summary({ sessionId: 'blank-selected', updatedAt: 20, blank: true }),
      summary({ sessionId: 'blank-hidden', updatedAt: 40, blank: true }),
      summary({ sessionId: 'archived', updatedAt: 50 }),
    ], new Set(['archived']), 'blank-selected', new Set(['newer']))

    expect(items).toEqual([
      expect.objectContaining({ id: 'newer', title: 'Latest work', unread: true }),
      expect.objectContaining({ id: 'blank-selected', blank: true }),
      expect.objectContaining({ id: 'older', running: true }),
    ])
  })

  it('searches titles case-insensitively without changing recency order', () => {
    const items = sessionItems([
      summary({ sessionId: 'one', updatedAt: 20, projections: { values: { title: 'Fix Windows paths' } } }),
      summary({ sessionId: 'two', updatedAt: 10, projections: { values: { title: 'Review PATH handling' } } }),
      summary({ sessionId: 'three', updatedAt: 30, projections: { values: { title: 'Write docs' } } }),
    ], new Set(), undefined, new Set())

    expect(filterSessionItems(items, 'path').map(item => item.id)).toEqual(['one', 'two'])
  })

  it('lists only archived conversations, newest first, so they can be restored', () => {
    const archived = archivedSessionItems([
      summary({ sessionId: 'active', updatedAt: 90 }),
      summary({ sessionId: 'older', updatedAt: 10, projections: { values: { title: 'Older work' } } }),
      summary({ sessionId: 'newer', updatedAt: 40, projections: { values: { title: 'Newer work' } } }),
      summary({ sessionId: 'blank-archived', updatedAt: 99, blank: true }),
    ], new Set(['older', 'newer', 'blank-archived']), new Set(['older']))

    expect(archived).toEqual([
      expect.objectContaining({ id: 'newer', title: 'Newer work' }),
      expect.objectContaining({ id: 'older', title: 'Older work', unread: true }),
    ])
  })

  it('reports nothing archived when no conversation is archived', () => {
    expect(archivedSessionItems([summary({ sessionId: 'one' })], new Set(), new Set())).toEqual([])
  })
})

describe('subagent sessions', () => {
  const catalog = (entries: Array<{ id: string; mode: string; label?: string }>) => ({
    values: { subagentCatalog: entries.map(entry => ({ createdAt: 1, ...entry })) },
  })

  it('nests a child directly after the parent that owns it', () => {
    const items = sessionItems([
      summary({ sessionId: 'parent', updatedAt: 50, projections: catalog([{ id: 'kid', mode: 'continuable', label: 'Research' }]) }),
      summary({ sessionId: 'kid', updatedAt: 40, origin: 'subagent', parentSessionId: 'parent' }),
      summary({ sessionId: 'other', updatedAt: 60 }),
    ], new Set(), 'parent', new Set())

    expect(items.map(item => item.id)).toEqual(['other', 'parent', 'kid'])
    expect(items.find(item => item.id === 'parent')?.childCount).toBe(1)
    expect(items.find(item => item.id === 'kid')).toMatchObject({
      parentId: 'parent',
      subagent: { mode: 'continuable', label: 'Research' },
    })
  })

  it('prefers the child\'s own identity projection over the parent catalog label', () => {
    const items = sessionItems([
      summary({ sessionId: 'parent', updatedAt: 50, projections: catalog([{ id: 'kid', mode: 'one-shot', label: 'From parent' }]) }),
      summary({ sessionId: 'kid', updatedAt: 40, origin: 'subagent', parentSessionId: 'parent',
        projections: { values: { subagent: { mode: 'continuable', label: 'Own label', seq: 4 } } } }),
    ], new Set(), 'parent', new Set())

    expect(items.find(item => item.id === 'kid')?.subagent).toEqual({ mode: 'continuable', label: 'Own label' })
  })

  it('keeps a completed one-shot child collapsed but still lists live or selected work', () => {
    const build = (kid: Partial<SessionSummary>) => sessionItems([
      summary({ sessionId: 'parent', updatedAt: 50, projections: catalog([{ id: 'kid', mode: 'one-shot', label: 'Audit' }]) }),
      summary({ sessionId: 'kid', updatedAt: 40, origin: 'subagent', parentSessionId: 'parent', ...kid }),
    ], new Set(), 'parent', new Set())

    expect(build({ blank: true }).map(item => item.id)).toEqual(['parent'])
    expect(build({ blank: true, running: true }).map(item => item.id)).toEqual(['parent', 'kid'])
    expect(build({ blank: false }).map(item => item.id)).toEqual(['parent', 'kid'])

    const selected = sessionItems([
      summary({ sessionId: 'parent', updatedAt: 50, projections: catalog([{ id: 'kid', mode: 'one-shot' }]) }),
      summary({ sessionId: 'kid', updatedAt: 40, origin: 'subagent', parentSessionId: 'parent', blank: true }),
    ], new Set(), 'kid', new Set())
    expect(selected.map(item => item.id)).toEqual(['parent', 'kid'])
  })

  it('leaves a subagent out of the picker when its owner is not in this project', () => {
    const items = sessionItems([
      summary({ sessionId: 'mine', updatedAt: 10 }),
      summary({ sessionId: 'orphan', updatedAt: 20, origin: 'subagent', parentSessionId: 'elsewhere' }),
      summary({ sessionId: 'unowned', updatedAt: 30, origin: 'subagent' }),
    ], new Set(), 'mine', new Set())

    expect(items.map(item => item.id)).toEqual(['mine'])
  })

  it('drops an archived subagent from the active list so it cannot read as live', () => {
    const summaries = [
      summary({ sessionId: 'parent', updatedAt: 50, projections: catalog([{ id: 'kid', mode: 'continuable', label: 'R' }]) }),
      summary({ sessionId: 'kid', updatedAt: 40, origin: 'subagent', parentSessionId: 'parent' }),
    ]
    const items = sessionItems(summaries, new Set(['kid']), 'parent', new Set())
    expect(items.map(item => item.id)).toEqual(['parent'])
    // ...and it stays recoverable, because the Archived section is the only way back.
    expect(archivedSessionItems(summaries, new Set(['kid']), new Set()).map(item => item.id)).toEqual(['kid'])
  })

  it('resolves the owning conversation for the ancestor breadcrumb', () => {
    const summaries = [
      summary({ sessionId: 'parent', updatedAt: 50, projections: catalog([{ id: 'kid', mode: 'continuable', label: 'R' }]) }),
      summary({ sessionId: 'kid', updatedAt: 40, origin: 'subagent' }),
      summary({ sessionId: 'declared', updatedAt: 30, origin: 'subagent', parentSessionId: 'parent' }),
    ]
    expect(parentIdOf(summaries, 'kid')).toBe('parent')
    expect(parentIdOf(summaries, 'declared')).toBe('parent')
    expect(parentIdOf(summaries, 'parent')).toBeUndefined()
  })
})

describe('subagent edge cases', () => {
  const catalog = (entries: Array<{ id: string; mode: string; label?: string }>) => ({
    values: { subagentCatalog: entries.map(entry => ({ createdAt: 1, ...entry })) },
  })

  it('treats a self-parent as no owner rather than making the session its own child', () => {
    // Consistent with any other unresolvable owner: it stays out of the picker
    // instead of nesting under itself.
    const items = sessionItems([
      summary({ sessionId: 'loop', origin: 'subagent', parentSessionId: 'loop' }),
    ], new Set(), undefined, new Set())
    expect(items).toEqual([])
  })

  it('keeps a blank parent visible while its child is the open conversation', () => {
    const items = sessionItems([
      summary({ sessionId: 'parent', updatedAt: 10, blank: true, projections: catalog([{ id: 'kid', mode: 'continuable', label: 'R' }]) }),
      summary({ sessionId: 'kid', updatedAt: 20, origin: 'subagent', parentSessionId: 'parent' }),
    ], new Set(), 'kid', new Set())
    expect(items.map(item => item.id)).toEqual(['parent', 'kid'])
  })
})

describe('lineage that must not be treated as delegation', () => {
  const catalog = (entries: Array<{ id: string; mode: string; label?: string }>) => ({
    values: { subagentCatalog: entries.map(entry => ({ createdAt: 1, ...entry })) },
  })

  it('keeps a fork at top level, because a fork sets parentSession but no origin', () => {
    // DSH records parentSession for seed lineage too (session/fork); only a
    // subagent child sets origin, and a fork is an independent conversation.
    const fork = summary({ sessionId: 'fork', updatedAt: 40, parentSessionId: 'source' })
    const items = sessionItems([summary({ sessionId: 'source', updatedAt: 10 }), fork], new Set(), undefined, new Set())

    expect(items.map(item => item.id)).toEqual(['fork', 'source'])
    expect(items.find(item => item.id === 'fork')?.subagent).toBeUndefined()
    expect(items.find(item => item.id === 'fork')?.parentId).toBeUndefined()
  })

  it('keeps a fork reachable when its source is archived', () => {
    const fork = summary({ sessionId: 'fork', updatedAt: 40, parentSessionId: 'source' })
    const items = sessionItems([summary({ sessionId: 'source', updatedAt: 10 }), fork], new Set(['source']), undefined, new Set())
    expect(items.map(item => item.id)).toEqual(['fork'])
  })

  it('nests a delegation chain three deep', () => {
    const summaries = [
      summary({ sessionId: 'root', updatedAt: 10, projections: catalog([{ id: 'mid', mode: 'continuable', label: 'Mid' }]) }),
      summary({ sessionId: 'mid', updatedAt: 20, origin: 'subagent', parentSessionId: 'root',
        projections: catalog([{ id: 'leaf', mode: 'one-shot', label: 'Leaf' }]) }),
      summary({ sessionId: 'leaf', updatedAt: 30, origin: 'subagent', parentSessionId: 'mid' }),
    ]
    const items = sessionItems(summaries, new Set(), 'root', new Set())
    expect(items.map(item => item.id)).toEqual(['root', 'mid', 'leaf'])
    expect(items.map(item => item.parentId)).toEqual([undefined, 'root', 'mid'])
    expect(items.find(item => item.id === 'root')?.childCount).toBe(1)
    expect(items.find(item => item.id === 'mid')?.childCount).toBe(1)
  })

  it('promotes the whole ancestor chain so the open session is never orphaned', () => {
    const summaries = [
      summary({ sessionId: 'root', updatedAt: 10, blank: true, projections: catalog([{ id: 'mid', mode: 'continuable', label: 'Mid' }]) }),
      summary({ sessionId: 'mid', updatedAt: 20, blank: true, origin: 'subagent', parentSessionId: 'root',
        projections: catalog([{ id: 'leaf', mode: 'one-shot', label: 'Leaf' }]) }),
      summary({ sessionId: 'leaf', updatedAt: 30, origin: 'subagent', parentSessionId: 'mid' }),
    ]
    expect(sessionItems(summaries, new Set(), 'leaf', new Set()).map(item => item.id)).toEqual(['root', 'mid', 'leaf'])
  })

  it('terminates on a parent cycle instead of recursing forever', () => {
    const summaries = [
      summary({ sessionId: 'a', updatedAt: 10, origin: 'subagent', parentSessionId: 'b' }),
      summary({ sessionId: 'b', updatedAt: 20, origin: 'subagent', parentSessionId: 'a' }),
      summary({ sessionId: 'solo', updatedAt: 30 }),
    ]
    // Selecting a session OUTSIDE the cycle only exercises the recursion guard.
    expect(sessionItems(summaries, new Set(), 'solo', new Set()).map(item => item.id)).toEqual(['solo'])
  })

  // The cycle case where the selection is *inside* the cycle is covered by
  // tests/session-center-cycle.spec.ts, in a child process: an in-process
  // regression there would hang the run instead of failing it.
})
