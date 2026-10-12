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
