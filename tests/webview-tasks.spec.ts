// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from './webview-harness.js'
const instances: Harness[] = []
function open() { const h = harness(); instances.push(h); return h }
afterEach(async () => {
  for (const h of instances) { h.sendState({ phase: 'error' }); await h.settle() }
  await new Promise(resolve => setTimeout(resolve, 0))
  instances.splice(0).forEach(h => h.dispose())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
const parent = { id: 'parent', title: 'Main task', childCount: 1 }
const child = { id: 'child', title: 'Research details', parentId: 'parent', running: false,
  subagent: { mode: 'continuable', label: 'Research' }, activity: { status: 'completed', elapsedMs: 65000, totalTokens: 1250 } }

describe('direct task details navigation', () => {
  it('shows external executions as informational rows without local session actions or fabricated status', async () => {
    const h = open(), external = { id: 'external:parent:execution', title: 'Remote review', parentId: 'parent', agentAvailable: false, running: false, subagent: { mode: 'external', executionId: 'execution', label: 'Remote review' } }
    h.sendState({ sessionId: 'parent', sessions: [parent, child, external] }); await h.settle()
    const row = h.document.querySelector<HTMLButtonElement>('[data-session-id="external:parent:execution"]')!
    expect(row.textContent).toContain('Remote review'); expect(row.textContent).toContain('External task')
    expect(row.textContent).not.toMatch(/Idle|Completed|Running/)
    expect(row.getAttribute('aria-disabled')).toBe('true'); expect(row.tabIndex).toBe(-1)
    row.click(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(h.posts.some(post => post.type === 'open-task-details' || post.type === 'select-session')).toBe(false)
  })
  it('shows subagent status, duration and tokens without opening the session picker', async () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent, child] })
    await h.settle()
    expect(h.document.querySelector('#taskPanel')?.classList.contains('hidden')).toBe(false)
    const row = h.document.querySelector('.task-child')
    expect(row?.textContent).toContain('Research')
    expect(row?.textContent).toContain('Completed')
    expect(row?.textContent).toContain('1m 5s')
    expect(row?.textContent).toContain('tokens')
    expect(h.document.querySelector('#sessionMenu')?.classList.contains('hidden')).toBe(true)
    h.click('.task-child')
    expect(h.posts.at(-1)).toEqual({ type: 'select-session', sessionId: 'child' })
    h.click('.task-open')
    expect(h.posts).toContainEqual({ type: 'open-task-details', kind: 'subagent', sessionId: 'child' })
  })
  it('opens a nested child by its exact id and only lists descendants of the current conversation', async () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent, child,
      { ...child, id: 'grandchild', parentId: 'child', subagent: { mode: 'one-shot', label: 'Nested' } },
      { ...child, id: 'stranger', parentId: 'other' }] })
    await h.settle()
    expect(h.document.querySelectorAll('.task-child')).toHaveLength(2)
    expect((h.document.querySelector('.task-child[data-session-id="child"]') as HTMLElement).style.paddingLeft).toBe('8px')
    expect((h.document.querySelector('.task-child[data-session-id="grandchild"]') as HTMLElement).style.paddingLeft).toBe('20px')
    h.click('.task-child[data-session-id="grandchild"]')
    expect(h.posts.at(-1)).toEqual({ type: 'select-session', sessionId: 'grandchild' })
  })
  it('shows an actionable pending approval and updates it when the child completes', async () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent, { ...child, running: true, attention: { approvals: 1, questions: 0 } }] })
    await h.settle()
    expect(h.document.querySelector('.task-child')?.textContent).toContain('Needs approval')
    h.sendState({ sessionId: 'parent', sessions: [parent, child] })
    await h.settle()
    expect(h.document.querySelector('.task-child')?.textContent).toContain('Completed')
    expect(h.document.querySelector('#taskToggle')?.textContent).not.toContain('need you')
  })
  it('keeps an interrupted child duration bounded by its own projection cut', async () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent, { ...child,
      activity: { status: 'idle', elapsedMs: 1000, activeSince: 2000, activeThrough: 5000 } }] })
    await h.settle()
    expect(h.document.querySelector('.task-duration')?.textContent).toBe('4s')
    expect(h.document.querySelector('.task-child')?.textContent).toContain('Idle')
  })
  it('keeps elapsed time finite when an idle projection has no active end time', async () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [parent, { ...child, activity: { status: 'idle', elapsedMs: 3000, activeSince: 2000 } }] })
    await h.settle()
    expect(h.document.querySelector('.task-duration')?.textContent).toBe('3s')
  })
  it('shows and replaces the plan without carrying it across conversations', async () => {
    const h = open()
    h.sendState({ todos: [{ content: '<b>Inspect</b>', status: 'completed' }, { content: 'Fix', status: 'in_progress' }] })
    await h.settle()
    expect(h.document.querySelectorAll('.task-todo')).toHaveLength(2)
    expect(h.document.querySelector('.task-todo b')).toBeNull()
    expect(h.document.querySelector('#taskToggle')?.textContent).toContain('1/2 steps done')
    h.sendState({ sessionId: 'other', todos: [] })
    await h.settle()
    expect(h.document.querySelector('#taskPanel')?.classList.contains('hidden')).toBe(true)
    expect(h.document.querySelectorAll('.task-todo')).toHaveLength(0)
  })
  it.each(['one-shot', 'unknown'])('makes a %s child read-only and retains the way back and Stop', async mode => {
    const h = open()
    h.sendState({ sessionId: 'child', parentSessionId: 'parent', running: true, sessions: [parent, { ...child, subagent: { mode } }] })
    await h.settle()
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(true)
    expect(h.document.getElementById('subagentBar')?.textContent).toContain('Read-only')
    h.enter('Must not send')
    expect(h.posts.some(p => p.type === 'send')).toBe(false)
    expect((h.document.getElementById('cancel') as HTMLButtonElement).disabled).toBe(false)
    h.click('.subagent-bar-back')
    expect(h.posts.at(-1)).toEqual({ type: 'select-session', sessionId: 'parent' })
  })
  it('allows follow-ups to a continuable child while it is running', async () => {
    const h = open()
    h.sendState({ sessionId: 'child', parentSessionId: 'parent', running: true, sessions: [parent, child] })
    await h.settle()
    h.enter('Check the second file')
    expect(h.posts).toContainEqual(expect.objectContaining({ type: 'send', sessionId: 'child', mode: 'queue' }))
  })
})
