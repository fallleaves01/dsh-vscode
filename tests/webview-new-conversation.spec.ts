// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness, type Posted } from './webview-harness.js'

const live: Harness[] = []
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  live.splice(0).forEach(instance => instance.dispose())
  document.body.replaceChildren()
})
const parent = { id: 'parent', title: 'Existing task', blank: false }
const created = { id: 'created', title: 'New conversation', blank: true }
const controls = {
  models: [{ provider: 'deepseek', model: 'flash', label: 'DeepSeek Flash', selected: true, reasoningEffort: 'high', reasoningEfforts: [{ id: 'low', label: 'Low', selected: false }, { id: 'high', label: 'High', selected: true }] }],
  permissions: [{ value: 'read-only', label: 'Read Only', selected: false }, { value: 'workspace-write', label: 'Workspace', selected: true }],
  agentPreset: { available: true, locked: false, busy: false, current: 'coding', options: [{ id: 'coding', label: 'Coding' }, { id: 'minimal', label: 'Minimal' }] },
  plan: { available: true, active: true, pending: false },
}
function open(): Harness { const h = harness(); live.push(h); h.sendState({ sessionId: 'parent', sessions: [parent], ...controls }); return h }
function request(h: Harness): Posted {
  h.click('#newSession')
  const pending = h.posts.findLast(item => item.type === 'create-conversation')
  expect(pending).toMatchObject({ cwd: '/workspace', sessionId: 'parent' })
  return pending!
}
function receipt(h: Harness, pending: Posted, result: Record<string, unknown> = { sessionId: 'created' }) {
  h.send({ type: 'conversation-created', requestId: pending.requestId, cwd: pending.cwd, ...result })
}
function prompt(h: Harness, text: string) {
  const input = h.document.getElementById('prompt') as HTMLTextAreaElement
  input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }))
  return input
}

describe('new conversations use the full chat composer', () => {
  it('keeps the directory limited to search, lists and conversation management', async () => {
    const h = open(); await h.settle(); h.click('#conversationHome')
    expect(h.document.querySelector('#conversationHomeView textarea')).toBeNull()
    expect(h.document.querySelector('#conversationHomeView form')).toBeNull()
    expect(h.document.querySelector('#conversationHomeView select')).toBeNull()
    expect(h.document.activeElement?.id).toBe('homeSessionSearch')
    expect(h.document.querySelectorAll('#homeSessionList .session-row')).toHaveLength(1)
  })

  it('opens a blank conversation in chat with model, effort, composition and permissions', async () => {
    const h = open(); h.sendState({ sessionId: 'created', sessions: [created], ...controls }); await h.settle()
    expect(h.document.getElementById('composerFooter')!.classList.contains('hidden')).toBe(false)
    expect(h.document.getElementById('conversationHomeView')!.classList.contains('hidden')).toBe(true)
    expect((h.document.getElementById('modelTrigger') as HTMLButtonElement).disabled).toBe(false)
    expect((h.document.getElementById('efforts') as HTMLSelectElement).value).toBe('high')
    h.click('#policyTrigger')
    expect(h.document.getElementById('policyMenu')!.textContent).toContain('Read Only')
    expect(h.document.getElementById('policyMenu')!.textContent).toContain('Minimal')
    expect(h.document.getElementById('modeChips')!.textContent).toContain('Plan')
  })

  it('creates once from the directory and waits for both ready state and a matching receipt', async () => {
    const h = open(); await h.settle(); h.click('#conversationHome'); const pending = request(h)
    h.click('#newSession')
    expect(h.posts.filter(item => item.type === 'create-conversation')).toHaveLength(1)
    receipt(h, pending)
    expect(h.document.getElementById('conversationHomeView')!.classList.contains('hidden')).toBe(false)
    h.sendState({ sessionId: 'created', sessions: [parent, created], ...controls }); await h.settle()
    expect(h.document.getElementById('composerFooter')!.classList.contains('hidden')).toBe(false)
    expect(h.document.activeElement?.id).toBe('prompt')
    expect((h.document.getElementById('policyTrigger') as HTMLButtonElement).disabled).toBe(false)
    expect((h.document.getElementById('efforts') as HTMLSelectElement).disabled).toBe(false)
    expect((h.document.getElementById('modelTrigger') as HTMLButtonElement).disabled).toBe(false)
    expect(h.posts.some(item => item.type === 'send' || item.type === 'select-model')).toBe(false)
  })

  it('holds Enter and attachments until the creation receipt, then permits explicit sending', async () => {
    const h = open(); await h.settle(); const pending = request(h)
    h.sendState({ sessionId: 'created', sessions: [parent, created], ...controls }); await h.settle()
    h.enter('New task with all options')
    h.drop({ types: ['resourceurls'], data: { resourceurls: '["file:///workspace/src/app.ts"]' } })
    expect(h.posts.some(item => item.type === 'send' || item.type === 'attach-resources')).toBe(false)
    receipt(h, pending)
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('New task with all options')
    expect(h.posts.some(item => item.type === 'send')).toBe(false)
    h.enter('New task with all options')
    expect(h.posts.at(-1)).toMatchObject({ type: 'send', sessionId: 'created', text: 'New task with all options' })
  })

  it('preserves the earlier conversation draft and does not copy it into the new conversation', async () => {
    const h = open(); await h.settle(); prompt(h, 'Previous conversation draft'); h.click('#conversationHome')
    const pending = request(h)
    h.sendState({ sessionId: 'created', sessions: [parent, created], ...controls }); await h.settle(); receipt(h, pending)
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('')
    prompt(h, 'Separate new draft')
    h.sendState({ sessionId: 'parent', sessions: [parent, created], ...controls }); await h.settle()
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('Previous conversation draft')
    h.sendState({ sessionId: 'created', sessions: [parent, created], ...controls }); await h.settle()
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('Separate new draft')
  })

  it('rejects unrelated receipts without opening or submitting another conversation', async () => {
    const h = open(); await h.settle(); h.click('#conversationHome'); const pending = request(h)
    h.send({ type: 'conversation-created', requestId: 'other-view', cwd: '/workspace', sessionId: 'created' })
    h.send({ type: 'conversation-created', requestId: pending.requestId, cwd: '/other-project', sessionId: 'created' })
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(true)
    expect(h.posts.some(item => item.type === 'send')).toBe(false)
    receipt(h, pending, { error: 'Opening failed' })
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(false)
    expect(h.document.getElementById('homeError')!.textContent).toContain('Opening failed')
  })

  it('preserves the original draft on failure and allows a new explicit attempt', async () => {
    const h = open(); await h.settle(); prompt(h, 'Keep this text'); const pending = request(h)
    receipt(h, pending, { error: 'Runtime unavailable' })
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('Keep this text')
    expect(h.document.getElementById('conversationCreationError')!.textContent).toContain('Runtime unavailable')
    request(h)
    expect(h.posts.filter(item => item.type === 'create-conversation')).toHaveLength(2)
    expect(h.posts.some(item => item.type === 'send')).toBe(false)
  })

  it('cancels an old project request and ignores its late receipt', async () => {
    const h = open(); await h.settle(); const pending = request(h)
    h.sendState({ cwd: '/other-project', sessionId: 'other', sessions: [{ id: 'other', title: 'Other project' }], ...controls }); await h.settle()
    receipt(h, pending)
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(false)
    h.enter('Other project message')
    expect(h.posts.at(-1)).toMatchObject({ type: 'send', sessionId: 'other', text: 'Other project message' })
  })

  it('does not create or attach anything when a resource is dropped on the directory', async () => {
    const h = open(); await h.settle(); h.click('#conversationHome'); h.posts.length = 0
    h.drop({ types: ['resourceurls'], data: { resourceurls: '["file:///workspace/src/app.ts"]' } })
    expect(h.posts).toEqual([])
  })

  it('keeps directory switching usable while creating and ignores the abandoned receipt', async () => {
    const other = { id: 'other', title: 'Other task', blank: false }
    const h = open(); h.sendState({ sessionId: 'parent', sessions: [parent, other], ...controls }); await h.settle()
    h.click('#conversationHome'); const pending = request(h)
    // Creating a conversation must not lock the list: switching abandons it.
    const rows = [...h.document.querySelectorAll<HTMLButtonElement>('#homeSessionList .session-main')]
    expect(rows.every(row => !row.disabled)).toBe(true)
    const otherRow = rows.find(row => row.closest('.session-row')!.getAttribute('data-session-id') === 'other')!
    otherRow.click()
    expect(h.posts.at(-1)).toEqual({ type: 'select-session', sessionId: 'other' })
    // The abandoned request no longer owns the new-conversation control.
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(false)
    receipt(h, pending, { error: 'Cancelled' })
    expect(h.posts.some(item => item.type === 'select-session' && item.sessionId === 'created')).toBe(false)
    expect(h.document.getElementById('homeError')!.textContent).toBe('')
  })

  it('re-enables the composer when selecting the current conversation after a directory update', async () => {
    const h = open(); await h.settle(); h.click('#conversationHome')
    h.sendState({ sessionId: 'parent', sessions: [parent], ...controls }); await h.settle()
    h.click('#homeSessionList .session-main')
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(false)
    h.enter('Continue the existing conversation')
    expect(h.posts.at(-1)).toMatchObject({ type: 'send', sessionId: 'parent' })
  })

  it('does not open a creation receipt after another view selects a different conversation', async () => {
    const h = open(); await h.settle(); h.click('#conversationHome'); const pending = request(h)
    h.sendState({ sessionId: 'other', sessions: [parent, created, { id: 'other', title: 'Selected elsewhere' }], ...controls }); await h.settle()
    receipt(h, pending)
    expect(h.document.getElementById('conversationHomeView')!.classList.contains('hidden')).toBe(false)
    expect((h.document.getElementById('newSession') as HTMLButtonElement).disabled).toBe(false)
    expect(h.posts.some(item => item.type === 'send')).toBe(false)
  })

  it('returns to the chat composer on an explicit focus request without creating a conversation', async () => {
    const h = open(); await h.settle(); prompt(h, 'Existing draft'); h.click('#conversationHome')
    h.send({ type: 'focus-prompt' })
    expect(h.document.getElementById('composerFooter')!.classList.contains('hidden')).toBe(false)
    expect(h.document.activeElement?.id).toBe('prompt')
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).value).toBe('Existing draft')
    expect(h.posts.some(item => item.type === 'create-conversation')).toBe(false)
  })

  it.each(['set-prompt', 'ide-context'] as const)('re-enables the full composer after %s leaves an updated directory', async type => {
    const h = open(); await h.settle(); h.click('#conversationHome')
    h.sendState({ sessionId: 'parent', sessions: [parent], ...controls }); await h.settle()
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(true)
    h.send(type === 'set-prompt' ? { type, text: 'Inspect this selection' }
      : { type, state: { sessionId: 'parent', pinned: [{ id: 'pin', kind: 'file', path: 'src/app.ts' }] } })
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(false)
    expect((h.document.getElementById('efforts') as HTMLSelectElement).disabled).toBe(false)
    h.enter('Continue with editor context')
    expect(h.posts.at(-1)).toMatchObject({ type: 'send', sessionId: 'parent' })
  })
})
