// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
const all: Harness[] = []
function open() { const h = harness(); all.push(h); return h }
afterEach(async () => { for (const h of all) { h.sendState({ phase: 'error' }); await h.settle(); h.dispose() } all.length = 0; document.body.replaceChildren() })
const goal = { available: true, loading: false, busy: false, value: { id: 'g', revision: 3, objective: '<b>Finish repair</b>', phase: 'active', maxGoalRounds: 20, roundsStarted: 5, activation: 'armed' } }
describe('Goal, reminders, workflows, search and background output UI', () => {
  it('hides an unavailable empty task control and reveals it when its service becomes available', async () => {
    const h = open(); h.sendState({ goal: undefined, schedules: undefined }); await h.settle()
    expect(h.document.getElementById('taskFeatures')?.classList.contains('hidden')).toBe(true)
    h.sendState({ goal: { available: true, loading: false, busy: false } }); await h.settle()
    expect(h.document.getElementById('taskFeatures')?.classList.contains('hidden')).toBe(false)
    expect(h.document.getElementById('goalPanel')?.textContent).toContain('New goal')
  })
  it('shows activation/round budget and sends captured CAS identity', async () => {
    const h = open(); h.sendState({ goal }); await h.settle()
    expect(h.document.querySelector('#goalPanel')?.textContent).toContain('5/20 rounds')
    expect(h.document.querySelector('#goalPanel b')).toBeNull()
    const pause = [...h.document.querySelectorAll<HTMLButtonElement>('#goalPanel button')].find(button => button.textContent === 'Pause')!; pause.click()
    expect(h.posts.at(-1)).toEqual({ type: 'goal-action', action: 'pause', sessionId: 'session-a', id: 'g', revision: 3 })
  })
  it('shows blocked recovery and disables unavailable or read-only Goal actions', async () => {
    const h = open(); h.sendState({ goal: { ...goal, available: false, value: { ...goal.value, phase: 'blocked', blockedReason: { code: 'limit', message: 'Round limit reached' } } } }); await h.settle()
    expect(h.document.querySelector('#goalPanel')?.textContent).toContain('Round limit reached')
    expect([...h.document.querySelectorAll<HTMLButtonElement>('#goalPanel button')].every(button => button.disabled)).toBe(true)
    h.sendState({ goal, childReadOnlyReason: 'Resume the parent first' }); await h.settle()
    expect([...h.document.querySelectorAll<HTMLButtonElement>('#goalPanel button')].every(button => button.disabled)).toBe(true)
  })
  it('shows reminder catalog and paginated delivery history with retention loss', async () => {
    const h = open(); h.sendState({ schedules: { items: [{ id: 'r', sessionId: 'other', title: 'Morning review', prompt: 'Check jobs', status: 'active', kind: 'daily', scheduledAt: '2026-10-05T01:00:00Z' }], history: { id: 'r', sessionId: 'other', records: [], nextBefore: 'm', earlierRecordsPruned: true } } }); await h.settle()
    expect(h.document.querySelector('#schedulePanel')?.textContent).toContain('daily')
    expect(h.document.querySelector('#schedulePanel')?.textContent).toContain('pruned')
    const buttons = h.document.querySelectorAll<HTMLButtonElement>('#schedulePanel button'); buttons[0]!.click()
    expect(h.posts.at(-1)).toEqual({ type: 'schedule-history', sessionId: 'other', id: 'r' })
    buttons[1]!.click(); expect(h.posts.at(-1)).toEqual({ type: 'schedule-history', sessionId: 'other', id: 'r', before: 'm' })
  })
  it('opens a workflow member independently and exposes workflow logs', async () => {
    const h = open(); h.sendState({ workflows: [{ id: 'w', name: 'Audit', members: [{ childId: 'c', seq: 1, label: 'Verify', phase: 'Testing', outcome: 'success' }], stopReason: 'finished' }] }); await h.settle()
    expect(h.document.querySelector('#taskList')?.textContent).toContain('Testing')
    expect(h.document.querySelector('#taskList')?.textContent).toContain('finished')
    h.click('.workflow-member'); expect(h.posts.at(-1)).toEqual({ type: 'open-task-details', kind: 'subagent', sessionId: 'c' })
  })
  it('routes project jobs to their owner for output and the confirmed Stop action', async () => {
    const h = open(); h.sendState({ projectJobs: [{ id: 'j', sessionId: 'owner', sessionTitle: 'Other conversation', kind: 'process', label: 'Build', status: 'running', startedAt: Date.now() }], jobsStatus: 'Status may be stale' }); await h.settle()
    h.click('#jobsTrigger'); h.click('.job-row .feature-action')
    expect(h.posts.at(-1)).toEqual({ type: 'open-task-details', kind: 'job', sessionId: 'owner', jobId: 'j' })
    h.click('.job-stop'); h.click('.job-stop'); expect(h.posts.at(-1)).toEqual({ type: 'kill-job', sessionId: 'owner', jobId: 'j' })
    expect(h.document.querySelector('#jobsMenu')?.textContent).toContain('Status may be stale')
  })
  it('shows body-only and archived search hits safely with the global result limit', async () => {
    const h = open(); h.sendState({ sessions: [{ id: 's', title: 'Does not match query' }], archivedSessions: [{ id: 'a', title: 'Archived work' }], historySearch: { query: 'needle', loading: false, items: [{ sessionId: 's', snippet: '<script>needle</script>' }, { sessionId: 'a', snippet: 'needle from history' }], hasMore: true } }); await h.settle()
    h.click('#sessionTrigger'); const input = h.document.querySelector<HTMLInputElement>('#sessionSearch')!; input.value = 'needle'; input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(h.document.querySelectorAll('.search-hit')).toHaveLength(2)
    expect(h.document.querySelector('.search-hit script')).toBeNull()
    expect(h.document.querySelector('#sessionList')?.textContent).toContain('up to 20')
    h.document.querySelectorAll<HTMLButtonElement>('.search-hit')[1]!.click(); expect(h.posts.at(-1)).toEqual({ type: 'unarchive-session', sessionId: 'a' })
  })
  it('reacts to parent availability without requiring a new session list reference', async () => {
    const h = open(), sessions = [{ id: 'p', title: 'Parent' }, { id: 'c', parentId: 'p', title: 'Child', subagent: { mode: 'continuable' } }]
    h.sendState({ sessionId: 'c', parentSessionId: 'p', sessions, childReadOnlyReason: 'Parent unavailable. Resume its conversation.' }); await h.settle()
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(true)
    expect(h.document.getElementById('subagentBar')?.textContent).toContain('Resume its conversation')
    h.sendState({ sessionId: 'c', parentSessionId: 'p', sessions, childReadOnlyReason: null }); await h.settle()
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(false)
  })
})

describe('Agent Teams panel', () => {
  const team = {
    members: [
      { id: 'lead-session', name: 'lead', role: 'lead', phase: 'active' },
      { id: 'mate-session', name: 'reviewer', role: 'teammate', phase: 'failed', error: 'Creation was denied' },
    ],
    tasks: [
      {
        id: 'task-2', revision: 2, subject: 'Verify the permission selector', description: 'Full acceptance details.',
        status: 'in_progress', blockedBy: [], writeScopes: ['src/collaboration-state.ts'], ownerName: 'reviewer',
        ready: false, writeScopeWarnings: ['Overlaps task-1'], blocked: false,
      },
      {
        id: 'task-1', revision: 1, subject: 'Map the contracts', description: '',
        status: 'completed', blockedBy: [], writeScopes: [], ready: false, writeScopeWarnings: [], blocked: false,
      },
    ],
    failure: 'Persistent member update rejected',
    completedCount: 1,
    totalCount: 2,
  }

  it('renders no task panel when the team projection is absent or empty', async () => {
    const h = open()
    h.sendState({ team: null }); await h.settle()
    expect(h.document.getElementById('taskPanel')!.classList.contains('hidden')).toBe(true)
    h.sendState({ team: { members: [], tasks: [], completedCount: 0, totalCount: 0 } }); await h.settle()
    expect(h.document.getElementById('taskPanel')!.classList.contains('hidden')).toBe(true)
  })

  it('renders the Team roster and the shared task board', async () => {
    const h = open()
    // The projection arrives after the conversation is open; the panel must
    // appear from the state patch alone, without a new conversation list.
    h.sendState({ team: null }); await h.settle()
    expect(h.document.getElementById('taskPanel')!.classList.contains('hidden')).toBe(true)
    h.sendState({ team }); await h.settle()
    const panel = h.document.getElementById('taskPanel')!
    expect(panel.classList.contains('hidden')).toBe(false)
    const list = h.document.getElementById('taskList')!
    expect(list.textContent).toContain('Team')
    expect(list.textContent).toContain('lead')
    expect(list.textContent).toContain('Lead')
    expect(list.textContent).toContain('reviewer')
    expect(list.textContent).toContain('Failed')
    expect(list.textContent).toContain('Creation was denied')
    expect(list.textContent).toContain('Shared tasks')
    expect(list.textContent).toContain('Verify the permission selector')
    expect(list.textContent).toContain('In progress')
    expect(list.textContent).toContain('Owner: reviewer')
    expect(list.textContent).toContain('Writes: src/collaboration-state.ts')
    expect(list.textContent).toContain('Warning: Overlaps task-1')
    expect(list.textContent).toContain('Map the contracts')
    expect(list.textContent).toContain('Team: Persistent member update rejected')
    expect(h.document.getElementById('taskToggle')!.textContent).toContain('2 team members')
    expect(h.document.getElementById('taskToggle')!.textContent).toContain('1/2 tasks')
  })

  it('opens a teammate conversation when a member row is clicked', async () => {
    const h = open()
    h.sendState({ team }); await h.settle()
    h.posts.length = 0
    h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="mate-session"]')!
      .dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'select-session', sessionId: 'mate-session' })
  })

  it('does not make a member without a session id clickable', async () => {
    const h = open()
    h.sendState({ team: { ...team, members: [{ id: '', name: 'ghost', role: 'teammate', phase: 'active' }] } }); await h.settle()
    const row = h.document.querySelector<HTMLButtonElement>('#taskList .task-child')!
    expect(row.dataset.sessionId).toBeUndefined()
    expect(row.getAttribute('aria-disabled')).toBe('true')
    h.posts.length = 0
    row.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts.some(post => post.type === 'select-session')).toBe(false)
  })

  it('shows an idle Lead as Inactive instead of Active', async () => {
    const h = open()
    // The Lead row addresses the Lead's own Session; its durable phase is
    // `active`, but no turn is running, so the row must not claim activity.
    h.sendState({ team, sessions: [{ id: 'lead-session', title: 'Lead' }, { id: 'mate-session', title: 'Reviewer' }] }); await h.settle()
    const lead = h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="lead-session"]')!
    expect(lead.textContent).toContain('Inactive')
    expect(lead.textContent).not.toContain('Active')
    expect(lead.querySelector('.task-status')!.classList.contains('idle')).toBe(true)
    expect(lead.querySelector('.task-status')!.classList.contains('running')).toBe(false)
    expect(lead.querySelector('.task-glyph')!.classList.contains('running')).toBe(false)
    expect(lead.getAttribute('aria-label')).toBe('Open teammate lead, Inactive')
    expect(lead.getAttribute('title')).toContain('Inactive')
    // A failed member keeps its durable failure label while idle.
    const failed = h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="mate-session"]')!
    expect(failed.textContent).toContain('Failed')
    expect(failed.querySelector('.task-status')!.classList.contains('waiting')).toBe(true)
  })

  it('shows a running member as Running and counts running members', async () => {
    const h = open()
    const runningTeam = {
      members: [
        { id: 'lead-session', name: 'lead', role: 'lead', phase: 'active' },
        { id: 'mate-session', name: 'reviewer', role: 'teammate', phase: 'active' },
      ],
      tasks: [], completedCount: 0, totalCount: 0,
    }
    h.sendState({ team: runningTeam, sessions: [{ id: 'lead-session', title: 'Lead' }, { id: 'mate-session', title: 'Reviewer', running: true }] }); await h.settle()
    const lead = h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="lead-session"]')!
    const member = h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="mate-session"]')!
    expect(lead.textContent).toContain('Inactive')
    expect(member.textContent).toContain('Running')
    expect(member.querySelector('.task-status')!.classList.contains('running')).toBe(true)
    expect(member.querySelector('.task-glyph')!.classList.contains('running')).toBe(true)
    expect(member.getAttribute('aria-label')).toBe('Open teammate reviewer, Running')
    expect(h.document.getElementById('taskToggle')!.textContent).toContain('2 team members')
    expect(h.document.getElementById('taskToggle')!.textContent).toContain('1 running')
  })

  it('keeps failed and provisioning labels for sessions that are not running', async () => {
    const h = open()
    const mixed = {
      members: [
        { id: 'lead-session', name: 'lead', role: 'lead', phase: 'active' },
        { id: 'failed-session', name: 'failed-member', role: 'teammate', phase: 'failed', error: 'Creation was denied' },
        { id: 'prov-session', name: 'new-member', role: 'teammate', phase: 'provisioning' },
      ],
      tasks: [], completedCount: 0, totalCount: 0,
    }
    h.sendState({ team: mixed, sessions: [
      { id: 'lead-session', title: 'Lead' },
      { id: 'failed-session', title: 'Failed member' },
      { id: 'prov-session', title: 'New member' },
    ] }); await h.settle()
    const status = (id: string) => h.document.querySelector<HTMLButtonElement>(`#taskList [data-session-id="${id}"] .task-status`)!
    expect(status('failed-session').textContent).toBe('Failed')
    expect(status('prov-session').textContent).toBe('Provisioning')
    expect(status('lead-session').textContent).toBe('Inactive')
    expect(h.document.getElementById('taskToggle')!.textContent).not.toContain('running')
  })

  it('keeps session activity correct when the team projection arrives late', async () => {
    const h = open()
    const runningTeam = {
      members: [
        { id: 'lead-session', name: 'lead', role: 'lead', phase: 'active' },
        { id: 'mate-session', name: 'reviewer', role: 'teammate', phase: 'active' },
      ],
      tasks: [], completedCount: 0, totalCount: 0,
    }
    h.sendState({ team: null, sessions: [{ id: 'lead-session', title: 'Lead' }, { id: 'mate-session', title: 'Reviewer', running: true }] }); await h.settle()
    expect(h.document.getElementById('taskPanel')!.classList.contains('hidden')).toBe(true)
    h.sendState({ team: runningTeam, sessions: [{ id: 'lead-session', title: 'Lead' }, { id: 'mate-session', title: 'Reviewer', running: true }] }); await h.settle()
    const member = h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="mate-session"]')!
    expect(member.textContent).toContain('Running')
    // A later idle status repaints the row without rebuilding the projection.
    h.sendState({ team: runningTeam, sessions: [{ id: 'lead-session', title: 'Lead' }, { id: 'mate-session', title: 'Reviewer', running: false }] }); await h.settle()
    expect(h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="mate-session"]')!.textContent).toContain('Inactive')
    expect(h.document.getElementById('taskToggle')!.textContent).not.toContain('running')
  })

  it('reads the Lead row activity from the open conversation when the list lacks it', async () => {
    const h = open()
    const leadTeam = { members: [{ id: 'session-a', name: 'lead', role: 'lead', phase: 'active' }], tasks: [], completedCount: 0, totalCount: 0 }
    h.sendState({ team: leadTeam, sessionId: 'session-a', sessions: [], running: true }); await h.settle()
    const lead = () => h.document.querySelector<HTMLButtonElement>('#taskList [data-session-id="session-a"]')!
    expect(lead().textContent).toContain('Running')
    h.sendState({ team: leadTeam, sessionId: 'session-a', sessions: [], running: false }); await h.settle()
    expect(lead().textContent).toContain('Inactive')
    expect(lead().textContent).not.toContain('Running')
  })
})
