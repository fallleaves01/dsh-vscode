import { describe, expect, it } from 'vitest'
import { agentTeamOf, agentTeamSummaryOf } from '../src/agent-team-state.js'

type Wire = Record<string, unknown>

function memberWire(overrides: Wire = {}): Wire {
  return { id: 's-lead', name: 'lead', role: 'lead', phase: 'active', ...overrides }
}

function taskWire(overrides: Wire = {}): Wire {
  return {
    id: 'task-1', revision: 1, subject: 'Subject', description: '',
    status: 'pending', blockedBy: [], writeScopes: [], ready: false, writeScopeWarnings: [],
    ...overrides,
  }
}

describe('agent team projection view', () => {
  it('normalizes a valid projection into the sorted view', () => {
    const view = agentTeamOf({
      agentTeam: {
        members: [
          { id: 's-impl', name: 'impl', role: 'teammate', phase: 'active' },
          { id: 's-lead', name: 'lead', role: 'lead', phase: 'active' },
          { id: 's-arch', name: 'arch-review', role: 'teammate', phase: 'failed', error: 'provisioning failed' },
        ],
        tasks: [
          {
            id: 'task-10', revision: 2, subject: 'Panel tests', description: 'cover the strip',
            status: 'completed', blockedBy: [], writeScopes: [], ready: false, writeScopeWarnings: [],
          },
          {
            id: 'task-2', revision: 1, subject: 'Render team strip', description: '',
            status: 'pending', blockedBy: ['task-1'], writeScopes: [], ready: false,
            writeScopeWarnings: ['write scopes overlap with task-9'],
          },
          {
            id: 'task-1', revision: 1, subject: 'Wire view model', description: 'parse projection',
            status: 'in_progress', blockedBy: [], writeScopes: ['src/extension.ts'], ownerName: 'impl',
            ready: false, writeScopeWarnings: [],
          },
          {
            id: 'task-3', revision: 1, subject: 'Deleted task', description: '',
            status: 'deleted', blockedBy: [], writeScopes: [], ready: false, writeScopeWarnings: [],
          },
        ],
      },
    })
    expect(view).toEqual({
      members: [
        { id: 's-lead', name: 'lead', role: 'lead', phase: 'active' },
        { id: 's-arch', name: 'arch-review', role: 'teammate', phase: 'failed', error: 'provisioning failed' },
        { id: 's-impl', name: 'impl', role: 'teammate', phase: 'active' },
      ],
      tasks: [
        {
          id: 'task-1', revision: 1, subject: 'Wire view model', description: 'parse projection',
          status: 'in_progress', blockedBy: [], writeScopes: ['src/extension.ts'], ownerName: 'impl',
          ready: false, writeScopeWarnings: [], blocked: false,
        },
        {
          id: 'task-2', revision: 1, subject: 'Render team strip', description: '',
          status: 'pending', blockedBy: ['task-1'], writeScopes: [], ready: false,
          writeScopeWarnings: ['write scopes overlap with task-9'], blocked: true,
        },
        {
          id: 'task-10', revision: 2, subject: 'Panel tests', description: 'cover the strip',
          status: 'completed', blockedBy: [], writeScopes: [], ready: false,
          writeScopeWarnings: [], blocked: false,
        },
      ],
      completedCount: 1,
      totalCount: 3,
    })
  })

  it('derives readiness and blocking from the visible board when ready is missing', () => {
    const view = agentTeamOf({
      agentTeam: {
        members: [memberWire()],
        tasks: [
          taskWire({ id: 'task-1', status: 'completed', ready: undefined }),
          taskWire({ id: 'task-2', blockedBy: ['task-1'], ready: undefined }),
          taskWire({ id: 'task-3', blockedBy: ['task-2'], ready: undefined }),
          taskWire({ id: 'task-4', ready: undefined }),
          taskWire({ id: 'task-5', status: 'in_progress', blockedBy: ['task-1'], ready: undefined }),
          taskWire({ id: 'task-6', status: 'completed', blockedBy: ['task-2'], ready: undefined }),
          taskWire({ id: 'task-7', ready: false }),
        ],
      },
    })
    expect(view).toBeDefined()
    const byId = new Map(view!.tasks.map(task => [task.id, { ready: task.ready, blocked: task.blocked }]))
    // A completed blocker makes a pending task ready even without a host flag.
    expect(byId.get('task-2')).toEqual({ ready: true, blocked: false })
    // An incomplete blocker makes the task blocked and not ready.
    expect(byId.get('task-3')).toEqual({ ready: false, blocked: true })
    expect(byId.get('task-4')).toEqual({ ready: true, blocked: false })
    // Only pending tasks can become ready; in-progress work is never "ready".
    expect(byId.get('task-5')).toEqual({ ready: false, blocked: false })
    // A completed task is never reported as blocked, even with stale blockers.
    expect(byId.get('task-6')).toEqual({ ready: false, blocked: false })
    // An explicit host flag wins over the local derivation.
    expect(byId.get('task-7')).toEqual({ ready: false, blocked: false })
  })

  it('treats an absent, non-object, or empty projection as no team', () => {
    const inputs: unknown[] = [
      undefined, null, 'agentTeam', 42, [], {},
      { agentTeam: null },
      { agentTeam: 42 },
      { agentTeam: [] },
      { agentTeam: {} },
      { agentTeam: { members: [], tasks: [] } },
      { agentTeam: { members: 'none', tasks: 7, failure: 42 } },
      // A bare projection is not a projections-values map; the key is the contract.
      { members: [memberWire()], tasks: [taskWire()] },
    ]
    for (const input of inputs) expect(agentTeamOf(input)).toBeUndefined()
  })

  it('drops malformed member rows and keeps the readable ones', () => {
    const view = agentTeamOf({
      agentTeam: {
        members: [
          null, 'lead', 7, [],
          memberWire({ id: '' }),
          memberWire({ id: 's-1', role: undefined }),
          memberWire({ id: 's-2', role: 'owner' }),
          memberWire({ id: 's-3', name: 'bad phase', phase: 'idle' }),
          memberWire({ id: 's-4', name: 42 }),
          memberWire({ id: 's-5', name: 'kept', role: 'teammate', phase: 'provisioning', error: 42 }),
          memberWire({ id: 's-5', name: 'duplicate', role: 'teammate', phase: 'active' }),
        ],
        tasks: [],
      },
    })
    expect(view?.members).toEqual([
      { id: 's-5', name: 'kept', role: 'teammate', phase: 'provisioning' },
    ])
  })

  it('drops malformed task rows and normalizes wrong collection shapes', () => {
    const view = agentTeamOf({
      agentTeam: {
        members: [memberWire()],
        tasks: [
          null, {}, 'task',
          taskWire({ id: '' }),
          taskWire({ id: 'task-1', revision: 0 }),
          taskWire({ id: 'task-2', revision: 1.5 }),
          taskWire({ id: 'task-3', revision: '1' }),
          taskWire({ id: 'task-4', subject: 7 }),
          taskWire({ id: 'task-5', description: undefined }),
          taskWire({ id: 'task-6', status: 'unknown' }),
          taskWire({
            id: 'task-7', blockedBy: 'task-1', writeScopes: ['src/a.ts', 4],
            writeScopeWarnings: 'warn', ready: 'yes', ownerName: '  ',
          }),
        ],
      },
    })
    expect(view?.tasks).toEqual([
      {
        id: 'task-7', revision: 1, subject: 'Subject', description: '',
        status: 'pending', blockedBy: [], writeScopes: ['src/a.ts'],
        ready: true, writeScopeWarnings: [], blocked: false,
      },
    ])
  })

  it('filters deleted tasks and counts only the visible board', () => {
    const view = agentTeamOf({
      agentTeam: {
        members: [memberWire()],
        tasks: [
          taskWire({ id: 'task-1', status: 'completed' }),
          taskWire({ id: 'task-2', status: 'deleted' }),
          taskWire({ id: 'task-3', blockedBy: ['task-2'] }),
          taskWire({ id: 'task-4', status: 'completed' }),
        ],
      },
    })
    expect(view!.tasks.map(task => task.id)).toEqual(['task-3', 'task-1', 'task-4'])
    expect(view!.totalCount).toBe(3)
    expect(view!.completedCount).toBe(2)
    // A blocker hidden as deleted no longer counts as completed.
    expect(view!.tasks[0]).toMatchObject({ id: 'task-3', blocked: true, ready: false })
    expect(agentTeamSummaryOf(view)).toBe('1 member · 2/3 tasks done')
    // A board of deleted tasks alone carries nothing to render.
    expect(agentTeamOf({
      agentTeam: {
        members: [],
        tasks: [taskWire({ id: 'task-1', status: 'deleted' })],
      },
    })).toBeUndefined()
  })

  it('orders tasks by status and then by task number', () => {
    const view = agentTeamOf({
      agentTeam: {
        members: [memberWire()],
        tasks: [
          taskWire({ id: 'task-10' }),
          taskWire({ id: 'task-2' }),
          taskWire({ id: 'task-1', status: 'completed' }),
          taskWire({ id: 'task-3', status: 'in_progress' }),
        ],
      },
    })
    expect(view!.tasks.map(task => task.id)).toEqual(['task-3', 'task-2', 'task-10', 'task-1'])
  })

  it('preserves the failure of the first rejected record', () => {
    const failure = 'persisted Agent Teams team/task payload is invalid'
    const view = agentTeamOf({
      agentTeam: {
        members: [memberWire({ id: 's-failed', name: 'failed-peer', role: 'teammate', phase: 'failed' })],
        tasks: [taskWire({ id: 'task-1' })],
        failure,
      },
    })
    expect(view?.failure).toBe(failure)
    expect(view?.members).toHaveLength(1)
    expect(view?.tasks).toHaveLength(1)
    // Even a projection with nothing else parsed must surface the failure.
    const empty = agentTeamOf({ agentTeam: { members: [], tasks: [], failure } })
    expect(empty).toEqual({ members: [], tasks: [], failure, completedCount: 0, totalCount: 0 })
  })

  it('summarizes members and progress for a collapsed task panel', () => {
    const view = agentTeamOf({
      agentTeam: {
        members: [
          memberWire(),
          memberWire({ id: 's-1', name: 'one', role: 'teammate' }),
        ],
        tasks: [
          taskWire({ id: 'task-1', status: 'completed' }),
          taskWire({ id: 'task-2', status: 'completed' }),
          taskWire({ id: 'task-3', status: 'completed' }),
          taskWire({ id: 'task-4' }),
          taskWire({ id: 'task-5' }),
        ],
      },
    })
    expect(agentTeamSummaryOf(view)).toBe('2 members · 3/5 tasks done')
    expect(agentTeamSummaryOf(undefined)).toBe('')
    expect(agentTeamSummaryOf(agentTeamOf({
      agentTeam: { members: [memberWire()], tasks: [taskWire()] },
    }))).toBe('1 member · 0/1 tasks done')
    expect(agentTeamSummaryOf(agentTeamOf({
      agentTeam: { members: [memberWire()], tasks: [] },
    }))).toBe('1 member')
    expect(agentTeamSummaryOf(agentTeamOf({
      agentTeam: { members: [], tasks: [taskWire()] },
    }))).toBe('0 members · 0/1 tasks done')
  })

  it('does not mutate the projection it parses', () => {
    const members = [
      memberWire({ id: 's-2', name: 'zeta', role: 'teammate' }),
      memberWire({ id: 's-1', name: 'alpha', role: 'lead' }),
    ]
    const tasks = [
      taskWire({ id: 'task-2', status: 'completed' }),
      taskWire({ id: 'task-1', status: 'pending' }),
    ]
    const projection = { members, tasks }
    const snapshot = JSON.stringify(projection)
    agentTeamOf({ agentTeam: projection })
    expect(JSON.stringify(projection)).toBe(snapshot)
  })
  it('bounds a hostile projection before it reaches the DOM', () => {
    const members = Array.from({ length: 80 }, (_, index) => ({ id: `member-${String(index)}`, name: `Member ${String(index)}`, role: 'teammate', phase: 'active' }))
    const tasks = Array.from({ length: 260 }, (_, index) => ({
      id: `task-${String(index + 1)}`, revision: 1, subject: 's'.repeat(2000), description: 'd'.repeat(5000),
      status: 'pending', blockedBy: ['missing'], writeScopes: ['w'.repeat(1000)], ownerName: 'o'.repeat(2000),
      ready: false, writeScopeWarnings: ['x'.repeat(2000)],
    }))
    const view = agentTeamOf({ agentTeam: { members, tasks } })
    expect(view?.members).toHaveLength(50)
    expect(view?.tasks).toHaveLength(200)
    const first = view!.tasks[0]!
    expect(first.subject.length).toBe(301)
    expect(first.subject.endsWith('…')).toBe(true)
    expect(first.description.length).toBe(1001)
    expect(first.ownerName!.length).toBe(301)
    expect(first.writeScopes).toHaveLength(1)
    expect(first.writeScopes[0]!.length).toBe(301)
    expect(first.writeScopeWarnings[0]!.length).toBe(301)
    expect(first.blockedBy).toEqual(['missing'])
  })
})
