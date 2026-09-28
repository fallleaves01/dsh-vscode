// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

const live: Harness[] = []
afterEach(async () => {
  // Let the scheduled render frame drain before the document goes away.
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

function open(): Harness {
  const instance = harness()
  live.push(instance)
  return instance
}

const catalogParent = {
  id: 'parent', title: 'Main task', updatedAt: 10, childCount: 1,
}
const child = {
  id: 'kid', title: 'Research notes', updatedAt: 20, parentId: 'parent',
  subagent: { mode: 'continuable', label: 'Research' },
}

describe('webview subagent picker', () => {
  it('renders a child nested under its parent instead of as a top-level row', () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [catalogParent, child] })
    h.click('#sessionTrigger')
    const rows = [...h.document.querySelectorAll('.session-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Main task')
    expect(rows[1]?.classList.contains('session-child')).toBe(true)
    expect(rows[1]?.textContent).toContain('Research')
  })

  it('shows subagents by default and collapses only on request', () => {
    const h = open()
    h.sendState({ sessionId: 'other', sessions: [
      { id: 'other', title: 'Other', updatedAt: 30 },
      catalogParent, child,
    ] })
    h.click('#sessionTrigger')
    expect(h.document.querySelectorAll('.session-child')).toHaveLength(1)

    h.click('.session-expander')
    expect(h.document.querySelectorAll('.session-child')).toHaveLength(0)
    h.click('.session-expander')
    expect(h.document.querySelectorAll('.session-child')).toHaveLength(1)
  })

  it('keeps a collapsed parent open while its child is waiting on the user', () => {
    const h = open()
    h.sendState({ sessionId: 'other', sessions: [
      { id: 'other', title: 'Other', updatedAt: 30 },
      catalogParent,
      { ...child, attention: { approvals: 1, questions: 0 } },
    ] })
    h.click('#sessionTrigger')
    h.click('.session-expander')
    expect(h.document.querySelectorAll('.session-child')).toHaveLength(1)
  })

  it('opens automatically while its own child is the active conversation', () => {
    const h = open()
    h.sendState({ sessionId: 'kid', parentSessionId: 'parent', sessions: [catalogParent, child] })
    h.click('#sessionTrigger')
    expect(h.document.querySelectorAll('.session-child')).toHaveLength(1)
    expect(h.document.querySelector('.session-row.session-child')?.classList.contains('active')).toBe(true)
  })

  it('offers a way back from a subagent to its owning conversation', () => {
    const h = open()
    h.sendState({ sessionId: 'kid', parentSessionId: 'parent', sessions: [catalogParent, child] })
    h.click('#sessionTrigger')
    const ancestor = h.document.querySelector('.session-row.session-ancestor')
    expect(ancestor?.textContent).toContain('Main task')

    h.posts.length = 0
    h.click('.session-row.session-ancestor .session-main')
    expect(h.posts).toContainEqual({ type: 'select-session', sessionId: 'parent' })
  })

  it('finds a matching subagent by its label while the parent does not match', () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [catalogParent, child] })
    h.click('#sessionTrigger')
    const search = h.document.getElementById('sessionSearch') as HTMLInputElement
    search.value = 'research'
    search.dispatchEvent(new Event('input', { bubbles: true }))

    const rows = [...h.document.querySelectorAll('.session-row')]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('Research')
  })

  it('offers no disclosure when a parent has no subagent rows to reveal', () => {
    const h = open()
    h.sendState({ sessionId: 'parent', sessions: [{ ...catalogParent, childCount: 0 }] })
    h.click('#sessionTrigger')
    expect(h.document.querySelectorAll('.session-child')).toHaveLength(0)
    expect(h.document.querySelectorAll('.session-expander')).toHaveLength(0)
  })
})

describe('webview delegation depth', () => {
  it('nests a three-level delegation chain with growing indentation', () => {
    const h = open()
    h.sendState({ sessionId: 'root', sessions: [
      { id: 'root', title: 'Root task', updatedAt: 10, childCount: 1 },
      { id: 'mid', title: 'Mid', updatedAt: 20, parentId: 'root', childCount: 1, subagent: { mode: 'continuable', label: 'Mid' } },
      { id: 'leaf', title: 'Leaf', updatedAt: 30, parentId: 'mid', childCount: 0, subagent: { mode: 'one-shot', label: 'Leaf' } },
    ] })
    h.click('#sessionTrigger')

    const rows = [...h.document.querySelectorAll('.session-row')]
    expect(rows).toHaveLength(3)
    expect(rows.map(row => row.classList.contains('session-child'))).toEqual([false, true, true])
    expect(rows[0]?.textContent).toContain('Root task')
    expect(rows[1]?.textContent).toContain('Mid')
    expect(rows[2]?.textContent).toContain('Leaf')
  })

  it('marks the disclosure inert when a running subagent pins it open', () => {
    const h = open()
    h.sendState({ sessionId: 'other', sessions: [
      { id: 'other', title: 'Other', updatedAt: 30 },
      { id: 'parent', title: 'Main', updatedAt: 10, childCount: 1 },
      { id: 'kid', title: 'Child', updatedAt: 20, parentId: 'parent', running: true, subagent: { mode: 'continuable', label: 'Child' } },
    ] })
    h.click('#sessionTrigger')

    const toggle = h.document.querySelector('.session-expander') as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.title).toContain('stays visible')
  })

  it('flattens every matching row, however deep, while searching', () => {
    const h = open()
    h.sendState({ sessionId: 'root', sessions: [
      { id: 'root', title: 'Root task', updatedAt: 10, childCount: 1 },
      { id: 'mid', title: 'Mid', updatedAt: 20, parentId: 'root', childCount: 1, subagent: { mode: 'continuable', label: 'Mid' } },
      { id: 'leaf', title: 'Leaf', updatedAt: 30, parentId: 'mid', childCount: 0, subagent: { mode: 'one-shot', label: 'Nested find' } },
    ] })
    h.click('#sessionTrigger')
    const search = h.document.getElementById('sessionSearch') as HTMLInputElement
    search.value = 'nested'
    search.dispatchEvent(new Event('input', { bubbles: true }))

    const rows = [...h.document.querySelectorAll('.session-row')]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('Nested find')
  })
})
