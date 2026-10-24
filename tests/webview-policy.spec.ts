// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * The control above the composer belongs to the permission preset: it is the
 * safety-relevant choice, and DSH's own `/permission` command changes exactly
 * this. Plan mode is a slash command in DSH, so it does not get a menu of its
 * own here either — the sidebar only shows that plan mode is on.
 */

const live: Harness[] = []
afterEach(() => {
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})

function open(): Harness {
  const instance = harness()
  live.push(instance)
  return instance
}

const PERMISSIONS = [
  { value: 'read-only', label: 'Read Only', description: 'Read files only.', selected: false },
  { value: 'workspace-write', label: 'Workspace', description: 'Edit this project.', selected: true },
  { value: 'danger-full-access', label: 'Full Access', description: 'No sandbox.', selected: false },
]

function typeIntoPrompt(h: Harness, text: string): void {
  const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
  prompt.value = text
  prompt.dispatchEvent(new Event('input', { bubbles: true }))
}

async function show(h: Harness, overrides: Record<string, unknown> = {}): Promise<void> {
  h.sendState({ sessionId: 'session-a', permissions: PERMISSIONS, ...overrides })
  await h.settle()
}

describe('the permission control', () => {
  it('shows the current preset and offers the others', async () => {
    const h = open()
    await show(h)
    const trigger = h.document.getElementById('policyTrigger')!
    expect(trigger.classList.contains('hidden')).toBe(false)
    expect(trigger.getAttribute('title')).toBe('Permissions: Workspace')

    h.click('#policyTrigger')
    const menu = h.document.getElementById('policyMenu')!
    expect(menu.textContent).toContain('Permissions')
    for (const label of ['Read Only', 'Workspace', 'Full Access']) expect(menu.textContent).toContain(label)
  })

  it('does not offer plan mode as a switch', async () => {
    const h = open()
    // Plan is available in the session, and the menu still must not switch it:
    // entering or leaving plan mode is the `/plan` command's job.
    await show(h, { plan: { available: true, active: false, pending: false } })
    h.click('#policyTrigger')
    const menu = h.document.getElementById('policyMenu')!
    expect(menu.textContent).not.toContain('Normal')
    expect(menu.textContent).not.toContain('Plan')
  })

  it('sends the chosen preset through the permission command', async () => {
    const h = open()
    await show(h)
    h.click('#policyTrigger')
    h.posts.length = 0
    const readOnly = [...h.document.querySelectorAll('#policyMenu button')]
      .find(button => (button.textContent ?? '').includes('Read Only'))!
    readOnly.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'select-permission', permission: 'read-only' })
  })

  it('stays hidden when the runtime reports no presets', async () => {
    const h = open()
    await show(h, { permissions: [] })
    expect(h.document.getElementById('policyTrigger')!.classList.contains('hidden')).toBe(true)
  })

  it('marks the experimental preset with a badge and its description', async () => {
    const h = open()
    await show(h, {
      permissions: [
        { value: 'workspace-write', label: 'Workspace', description: 'Edit this project.', selected: true },
        {
          value: 'auto', label: 'Auto review',
          description: 'Auto review: the current model reviews each tool call (experimental).',
          experimental: true, selected: false,
        },
      ],
    })
    h.click('#policyTrigger')
    const menu = h.document.getElementById('policyMenu')!
    const auto = [...menu.querySelectorAll('button')]
      .find(button => (button.textContent ?? '').includes('Auto review'))!
    // The badge is its own element: the label ellipsises first in a narrow
    // sidebar instead of pushing the marker out of the row.
    expect(auto.querySelector('.command-option-badge')?.textContent).toBe('EXP')
    expect(auto.textContent).toContain('Auto review: the current model reviews each tool call (experimental).')
    expect(auto.getAttribute('title')).toBe('Auto review: the current model reviews each tool call (experimental).')
    // Clicking still goes through the host, which owns the risk confirmation.
    h.posts.length = 0
    auto.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'select-permission', permission: 'auto' })
  })

  it('keeps the badge off stable presets', async () => {
    const h = open()
    await show(h)
    h.click('#policyTrigger')
    expect(h.document.querySelector('#policyMenu .command-option-badge')).toBeNull()
  })

  it('marks plan mode as on without offering it as a choice', async () => {
    const h = open()
    await show(h, { plan: { available: true, active: true, pending: false } })
    const chips = h.document.getElementById('modeChips')!
    expect(chips.textContent).toContain('Plan')
    h.click('#policyTrigger')
    expect(h.document.getElementById('policyMenu')!.textContent).not.toContain('Normal')
  })
})

describe('leaving a subagent conversation', () => {
  it('names the owning conversation and goes back to it', async () => {
    const h = open()
    await show(h, {
      parentSessionId: 'parent',
      sessions: [{ id: 'parent', title: 'Fix the renderer', childCount: 0, running: false, blank: false, unread: false }],
    })
    const bar = h.document.getElementById('subagentBar')!
    expect(bar.classList.contains('hidden')).toBe(false)
    expect(bar.textContent).toContain('Subagent of')
    expect(bar.textContent).toContain('Fix the renderer')

    h.posts.length = 0
    bar.querySelector('button')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'select-session', sessionId: 'parent' })
  })

  it('follows the owner being titled after the subagent was opened', async () => {
    const h = open()
    const owner = (title: string) => ({ id: 'parent', title, childCount: 0, running: false, blank: false, unread: false })
    await show(h, { parentSessionId: 'parent', sessions: [owner('New conversation')] })
    expect(h.document.getElementById('subagentBar')!.textContent).toContain('New conversation')

    // The owner is titled later; the id is unchanged, so only the label moves.
    await show(h, { parentSessionId: 'parent', sessions: [owner('Fix the parser')] })
    expect(h.document.getElementById('subagentBar')!.textContent).toContain('Fix the parser')
  })

  it('falls back once the owner leaves the list', async () => {
    const h = open()
    await show(h, {
      parentSessionId: 'parent',
      sessions: [{ id: 'parent', title: 'Fix the parser', childCount: 0, running: false, blank: false, unread: false }],
    })
    await show(h, { parentSessionId: 'parent', sessions: [] })
    expect(h.document.getElementById('subagentBar')!.textContent).toContain('Owning conversation')
  })

  it('stays usable when the owner is not in the list', async () => {
    const h = open()
    // The parent can be filtered out of the picker; the way back must survive.
    await show(h, { parentSessionId: 'gone', sessions: [] })
    const bar = h.document.getElementById('subagentBar')!
    expect(bar.classList.contains('hidden')).toBe(false)
    expect(bar.textContent).toContain('Owning conversation')
    h.posts.length = 0
    bar.querySelector('button')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'select-session', sessionId: 'gone' })
  })

  it('disappears in an ordinary conversation', async () => {
    const h = open()
    await show(h, { parentSessionId: null })
    expect(h.document.getElementById('subagentBar')!.classList.contains('hidden')).toBe(true)
  })
})


describe('the experimental preset in the slash-command menu', () => {
  const AUTO = {
    value: 'auto', label: 'Auto review',
    description: 'Auto review: the current model reviews each tool call (experimental).',
    experimental: true, selected: false,
  }

  it('marks the experimental preset with a badge and keeps the stable rows bare', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true,
      permissions: [
        { value: 'workspace-write', label: 'Workspace', description: 'Edit this project.', selected: true },
        AUTO,
      ],
    })
    await h.settle()
    typeIntoPrompt(h, '/permission ')
    await h.settle()

    const options = [...h.document.querySelectorAll('#commandMenu .command-option')]
    const auto = options.find(option => (option.textContent ?? '').includes('Auto review'))
    expect(auto).toBeDefined()
    expect(auto!.querySelector('.command-option-badge')?.textContent).toBe('EXP')
    expect(auto!.querySelector('.command-option-description')?.textContent)
      .toBe('Auto review: the current model reviews each tool call (experimental).')

    const stable = options.find(option => (option.textContent ?? '').includes('Workspace'))
    expect(stable).toBeDefined()
    expect(stable!.querySelector('.command-option-badge')).toBeNull()

    h.posts.length = 0
    auto!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(h.posts.filter(post => post.type === 'send')).toContainEqual(
      expect.objectContaining({ type: 'send', sessionId: 'session-a', text: '/permission auto' }))
  })
})
