// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * Hover/accessibility audit for every Webview button.
 *
 * The sidebar is an icon-heavy surface: a control without a title is an
 * unexplained icon, and one without an aria-label has no accessible name at
 * all. This suite walks the rendered DOM, including open menus, and refuses any
 * button that lacks either.
 */

const live: Harness[] = []
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})
function open(): Harness { const instance = harness(); live.push(instance); return instance }

/** Every button must carry both a hover title and an accessible name. */
function unnamedButtons(h: Harness): string[] {
  return [...h.document.querySelectorAll<HTMLButtonElement>('button')].flatMap(button => {
    const name = (button.getAttribute('aria-label') ?? '').trim()
    const title = (button.title ?? '').trim()
    if (name !== '' && title !== '') return []
    return [`${button.id === '' ? button.className : '#' + button.id} text=${JSON.stringify(button.textContent?.slice(0, 40))} title=${JSON.stringify(button.title)} aria=${JSON.stringify(button.getAttribute('aria-label'))}`]
  })
}

const base = () => ({
  phase: 'ready',
  sessions: [
    { id: 'session-a', title: 'First conversation', updatedAt: Date.now() },
    { id: 'session-b', title: 'Second conversation', updatedAt: Date.now() - 60_000 },
    { id: 'child-1', title: 'Research', parentId: 'session-a', running: true, updatedAt: Date.now(), activity: { totalTokens: 12, elapsedMs: 1000 } },
  ],
  sessionId: 'session-a',
  messages: [
    { id: 'm1', role: 'assistant', text: 'Hello', meta: { time: Date.now(), forkAtSeq: 3, forkable: true } },
    { id: 'm2', role: 'user', text: 'Reply', meta: { time: Date.now() } },
  ],
  jobs: [
    { id: 'job-1', kind: 'shell', label: 'Build', status: 'running', startedAt: Date.now() },
    { id: 'job-2', kind: 'shell', label: 'Finished work', status: 'completed', startedAt: Date.now() - 10_000, finishedAt: Date.now() },
  ],
  todos: [{ id: 'todo-1', text: 'Run the checks', status: 'in_progress' }],
  queue: [{ id: 'queue-1', placement: 'queued', preview: 'Queued request', text: 'Queued request' }],
  account: { available: true, signedIn: true, phase: 'ready' },
  agentPreset: { available: true, locked: false, busy: false, current: 'standard',
    options: [{ id: 'standard', label: 'Standard', trust: 'system' }] },
  permissions: [{ value: 'workspace-write', name: 'Workspace', disabled: false, selected: true }],
  models: [{ label: 'Model One', model: 'model-1', provider: 'provider', selected: true }],
  changedFiles: [{ turn: 1, files: [{ path: 'src/a.ts', additions: 1, deletions: 2, status: 'modified' }] }],
  plan: { available: true, active: true, pending: false },
})

describe('icon button hover and accessible names', () => {
  it('names every button before any state arrives', async () => {
    const h = open()
    expect(unnamedButtons(h)).toEqual([])
  })

  it('names every button in a populated conversation, menus closed', async () => {
    const h = open()
    h.sendState(base())
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])
  })

  it('names every button inside each header menu', async () => {
    const h = open()
    h.sendState(base())
    await h.settle()
    for (const [name, selector] of [
      ['session menu', '#sessionTrigger'], ['jobs menu', '#jobsTrigger'], ['account menu', '#accountTrigger'],
      ['attach menu', '#attach'], ['conversation settings', '#policyTrigger'], ['model menu', '#modelTrigger'],
    ] as const) {
      const trigger = h.document.querySelector<HTMLElement>(selector)
      expect(trigger, name).not.toBeNull()
      trigger!.click()
      await h.settle()
      expect(unnamedButtons(h), name).toEqual([])
      trigger!.click()
      await h.settle()
    }
  })

  it('names every button in rendered tool cards', async () => {
    const h = open()
    h.sendState({ ...base(), messages: [
      { id: 'tool-diff', role: 'tool', text: 'Write', rawResult: 'ok',
        callView: { card: 'diff', title: 'Write', diffs: [{ path: 'src/a.ts', oldText: null, newText: 'export const a = 1' }] },
        resultView: { card: 'diff', title: 'Write', diffs: [{ path: 'src/a.ts', oldText: 'old', newText: 'new' }] } },
      { id: 'tool-terminal', role: 'tool', text: 'bash', rawResult: 'done',
        callView: { card: 'terminal', title: 'bash', command: 'ls' },
        resultView: { card: 'terminal', title: 'bash', output: 'a.ts' } },
      { id: 'tool-output', role: 'tool', text: 'Read', rawResult: 'line one',
        callView: { card: 'read', title: 'Read', path: 'src/a.ts', offset: 1, lines: [{ number: 1, text: 'line one' }] },
        resultView: { card: 'read', title: 'Read', path: 'src/a.ts', offset: 1, lines: [{ number: 1, text: 'line one' }] } },
    ] })
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])
    const expanded = [...h.document.querySelectorAll<HTMLElement>('.tool summary, .tool-toggle')]
    for (const trigger of expanded) { trigger.click(); await h.settle(); expect(unnamedButtons(h)).toEqual([]) }
  })

  it('names every button on the directory and archive views', async () => {
    const h = open()
    h.sendState(base())
    await h.settle()
    h.click('#conversationHome')
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])
    h.click('#homeArchiveToggle')
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])
  })

  it('names every button when changes, approval, questions and errors are on screen', async () => {
    const h = open()
    h.sendState(base())
    await h.settle()
    h.document.querySelector<HTMLElement>('.changed-files-toggle')!.click()
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])

    h.sendState({ ...base(), approval: { rpcId: 'rpc', approvalId: 'approval', toolName: 'bash', reason: 'Needs a command' } })
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])

    h.sendState({ ...base(), question: { rpcId: 'rpc', requestId: 'question', questions: [
      { id: 'q1', header: 'Mode', question: 'Which mode?', options: [{ label: 'Fast' }], multiSelect: false },
    ] } })
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])

    h.sendState({ ...base(), phase: 'error', statusText: 'The runtime failed.', canReconnect: true })
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])

    h.sendState({ phase: 'idle', statusText: 'Connect to DSH to open your conversations.' })
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])

    h.sendState({ phase: 'loading', statusText: 'Connecting to DSH…' })
    await h.settle()
    expect(unnamedButtons(h)).toEqual([])
  })

  it('names buttons in nested session, change, job and queue actions', async () => {
    const h = open()
    h.sendState(base())
    await h.settle()

    const sessionMore = h.document.querySelector<HTMLButtonElement>('.session-row .session-more')
    expect(sessionMore, 'session actions trigger').not.toBeNull()
    sessionMore!.click()
    await h.settle()
    expect(unnamedButtons(h), 'session actions').toEqual([])
    sessionMore!.click()
    await h.settle()

    h.document.querySelector<HTMLElement>('.changed-files-toggle')!.click()
    await h.settle()
    const changeMore = h.document.querySelector<HTMLButtonElement>('.changed-files .changed-more')
    expect(changeMore, 'change actions trigger').not.toBeNull()
    changeMore!.click()
    await h.settle()
    expect(unnamedButtons(h), 'change actions').toEqual([])
    changeMore!.click()
    await h.settle()

    h.document.querySelector<HTMLElement>('#jobsTrigger')!.click()
    await h.settle()
    h.document.querySelector<HTMLButtonElement>('.job-chevron')!.click()
    await h.settle()
    expect(unnamedButtons(h), 'expanded job output').toEqual([])

    const edit = [...h.document.querySelectorAll<HTMLButtonElement>('.queue-action')].find(button => button.textContent === 'Edit')
    expect(edit, 'queue edit').toBeDefined()
    edit!.click()
    await h.settle()
    expect(unnamedButtons(h), 'queue editor').toEqual([])

    h.document.querySelector<HTMLElement>('#taskToggle')!.click()
    await h.settle()
    expect(unnamedButtons(h), 'task panel').toEqual([])

    h.sendState({ ...base(), occupancyNotice: 'This conversation is held by another DSH instance.' })
    await h.settle()
    expect(unnamedButtons(h), 'held notice').toEqual([])
  })

  it('updates dynamic button names when their state changes', async () => {
    const h = open()
    h.sendState(base())
    await h.settle()
    const title = (selector: string): string => h.document.querySelector<HTMLElement>(selector)!.getAttribute('title') ?? ''
    const label = (selector: string): string => h.document.querySelector<HTMLElement>(selector)!.getAttribute('aria-label') ?? ''

    // Tasks: count in the title, then the expanded state on click.
    expect(title('#taskToggle')).toContain('1 subagents')
    expect(title('#taskToggle')).toBe(label('#taskToggle'))
    h.document.querySelector<HTMLElement>('#taskToggle')!.click()
    await h.settle()
    expect(h.document.querySelector('#taskToggle')!.getAttribute('aria-expanded')).toBe('false')

    // Jobs: the trigger reports what the badge counts.
    expect(title('#jobsTrigger')).toBe(label('#jobsTrigger'))
    expect(title('#jobsTrigger')).toContain('1 background job running')
    h.sendState({ ...base(), jobs: [{ id: 'job-2', kind: 'shell', label: 'Finished work', status: 'completed' }] })
    await h.settle()
    expect(title('#jobsTrigger')).toContain('1 background job')

    // Usage: percentage is in the hover text and the accessible name.
    h.sendState({ ...base(), usage: { available: true, percent: 42, usedTokens: 42_000, contextWindow: 100_000 } })
    await h.settle()
    expect(title('#usageTrigger')).toContain('42%')
    expect(label('#usageTrigger')).toBe(title('#usageTrigger'))

    // Account: signed out and signed in are distinguishable.
    h.sendState({ ...base(), account: { available: true, signedIn: false, phase: 'ready' } })
    await h.settle()
    expect(title('#accountTrigger')).toContain('Sign in')
    h.sendState(base())
    await h.settle()
    expect(title('#accountTrigger')).toContain('DeepSeek account')

    // Model: the trigger names the selected model and provider.
    expect(title('#modelTrigger')).toContain('Model One')
    expect(label('#modelTrigger')).toBe(title('#modelTrigger'))

    // Send: queue/steer copy appears while a turn runs, then returns to Send.
    h.sendState({ ...base(), running: true })
    await h.settle()
    expect(title('#send')).toContain('Queue message')
    expect(label('#send')).toBe(title('#send'))
    h.sendState(base())
    await h.settle()
    expect(title('#send')).toContain('Send (Enter)')

    // Conversation directory toggle: the trigger describes where the click goes.
    expect(title('#conversationHome')).toBe('All conversations')
    expect(label('#conversationHome')).toBe('All conversations')
    h.document.querySelector<HTMLElement>('#conversationHome')!.click()
    await h.settle()
    expect(title('#conversationHome')).toBe('Return to current conversation')
    expect(label('#conversationHome')).toBe(title('#conversationHome'))
    h.document.querySelector<HTMLElement>('#conversationHome')!.click()
    await h.settle()

    // Session trigger: the selected conversation title is the tooltip.    // Session trigger: the selected conversation title is the tooltip.
    h.sendState({ ...base(), sessionId: 'session-b' })
    await h.settle()
    expect(title('#sessionTrigger')).toContain('Second conversation')
    expect(label('#sessionTrigger')).not.toBe('')
  })

  it('exposes menu semantics on the icon triggers', async () => {
    const h = open()
    h.sendState(base())
    await h.settle()
    const attribute = (selector: string, name: string): string | null =>
      h.document.querySelector<HTMLElement>(selector)!.getAttribute(name)
    expect(attribute('#sessionTrigger', 'aria-haspopup')).toBe('dialog')
    expect(attribute('#jobsTrigger', 'aria-haspopup')).toBe('menu')
    expect(attribute('#accountTrigger', 'aria-haspopup')).toBe('menu')
    expect(attribute('#attach', 'aria-haspopup')).toBe('dialog')
    expect(attribute('#policyTrigger', 'aria-haspopup')).toBe('menu')
    expect(attribute('#usageTrigger', 'aria-haspopup')).toBe('dialog')
    expect(attribute('#modelTrigger', 'aria-haspopup')).toBe('listbox')
    expect(attribute('#runtimeConnection', 'aria-haspopup')).toBe('dialog')
    expect(attribute('#openSettings', 'aria-haspopup')).toBe('dialog')

    h.document.querySelector<HTMLElement>('#jobsTrigger')!.click()
    await h.settle()
    expect(attribute('#jobsTrigger', 'aria-expanded')).toBe('true')
    h.document.querySelector<HTMLElement>('#jobsTrigger')!.click()
    await h.settle()
    expect(attribute('#jobsTrigger', 'aria-expanded')).toBe('false')

    h.document.querySelector<HTMLElement>('#accountTrigger')!.click()
    await h.settle()
    expect(attribute('#accountTrigger', 'aria-expanded')).toBe('true')
  })
})
