// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from './webview-harness.js'

/**
 * The composer has two independent gates: what the runtime can route (a
 * conversation with no available model accepts nothing) and what the Webview is
 * still waiting for (an upload, an attachment). The button and Enter share them,
 * and both must follow a conversation change.
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

function type(h: Harness, text: string): HTMLTextAreaElement {
  const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
  prompt.value = text
  prompt.dispatchEvent(new Event('input', { bubbles: true }))
  return prompt
}

const sendButton = (h: Harness) => h.document.getElementById('send') as HTMLButtonElement

describe('the composer refuses what the runtime cannot route', () => {
  it('disables Send for a draft typed before routing was lost', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', routable: true, sessions: [] })
    await h.settle()
    type(h, 'hello')
    await h.settle()
    expect(sendButton(h).disabled).toBe(false)

    // The provider catalog went empty while the draft sat in the box.
    h.sendState({ routable: false, routableNotice: 'No model is available.' })
    await h.settle()
    const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
    expect(prompt.disabled).toBe(true)
    expect(sendButton(h).disabled).toBe(true)
  })

  it('refuses Enter for the same draft', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', routable: true, sessions: [] })
    await h.settle()
    type(h, 'hello')
    h.sendState({ routable: false })
    await h.settle()
    h.posts.length = 0
    const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
    prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(h.posts.filter(post => post.type === 'send')).toHaveLength(0)
  })

  it('sends normally when a provider is routable', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', routable: true, sessions: [] })
    await h.settle()
    type(h, 'hello')
    await h.settle()
    h.posts.length = 0
    sendButton(h).dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts.filter(post => post.type === 'send')).toHaveLength(1)
  })
})

describe('the composer waits for anything still being staged', () => {
  it('keeps the gate closed until the last upload finishes', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', routable: true, sessions: [] })
    await h.settle()
    type(h, 'see attached')
    await h.settle()
    expect(sendButton(h).disabled).toBe(false)

    h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ name: 'a.txt' }], uploads: 1 })
    await h.settle()
    expect(sendButton(h).disabled).toBe(true)

    h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ name: 'a.txt' }], uploads: 0 })
    await h.settle()
    expect(sendButton(h).disabled).toBe(false)
  })

  it('does not let two concurrent drops release each other', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', routable: true, sessions: [] })
    await h.settle()
    type(h, 'two files')
    await h.settle()
    h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ name: 'a.txt' }], uploads: 2 })
    await h.settle()
    // The extension's count is authoritative: one drop finishing leaves one
    // outstanding, so the gate stays closed.
    h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ name: 'a.txt' }, { name: 'b.txt' }], uploads: 1 })
    await h.settle()
    expect(sendButton(h).disabled).toBe(true)
    h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ name: 'a.txt' }, { name: 'b.txt' }], uploads: 0 })
    await h.settle()
    expect(sendButton(h).disabled).toBe(false)
  })

  it('refuses Enter while an upload is outstanding', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', routable: true, sessions: [] })
    await h.settle()
    type(h, 'see attached')
    h.send({ type: 'draft-files', sessionId: 'session-a', files: [{ name: 'a.txt' }], uploads: 1 })
    await h.settle()
    h.posts.length = 0
    const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
    prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(h.posts.filter(post => post.type === 'send')).toHaveLength(0)
  })
})

describe('the model picker names the provider', () => {
  const model = (provider: string, providerLabel: string, id: string, label: string, selected = false) =>
    ({ provider, providerLabel, model: id, label, selected, reasoningEfforts: [] })

  it('groups the models by provider instead of listing them flat', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      model('deepseek-official', 'DeepSeek Official', 'v3', 'DeepSeek V3', true),
      model('gateway', 'Local gateway', 'flash', 'Flash'),
      model('gateway', 'Local gateway', 'pro', 'Pro'),
    ] })
    await h.settle()
    const select = h.document.getElementById('models') as HTMLSelectElement
    const groups = [...select.querySelectorAll('optgroup')]
    expect(groups.map(group => group.label)).toEqual(['DeepSeek Official', 'Local gateway'])
    expect([...groups[1]!.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Flash', 'Pro'])
    // The selection stays on the model it belongs to, inside its group.
    expect(select.value).toBe(JSON.stringify({ provider: 'deepseek-official', model: 'v3' }))
  })

  it('names the provider in the closed picker too', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      model('gateway', 'Local gateway', 'flash', 'Flash', true),
    ] })
    await h.settle()
    const select = h.document.getElementById('models') as HTMLSelectElement
    // Only the model name fits in the control, so the provider goes in the tooltip.
    expect(select.title).toBe('Model: Flash — Local gateway')
    expect(select.getAttribute('aria-label')).toContain('Local gateway')
  })

  it('falls back to the provider id when the runtime names no provider', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      model('gateway', '', 'flash', 'Flash', true),
    ] })
    await h.settle()
    const select = h.document.getElementById('models') as HTMLSelectElement
    expect([...select.querySelectorAll('optgroup')].map(group => group.label)).toEqual(['gateway'])
  })
})

describe('a dead selected model still leaves a way out', () => {
  const state = (anyRoutable: boolean) => ({
    sessionId: 'session-a', phase: 'ready', routable: false, anyRoutable,
    models: [{ provider: 'p', model: 'm', label: 'M', selected: true }],
    routableNotice: anyRoutable ? 'The selected model is not available on this runtime. Choose another model to continue.' : 'No model.',
  })

  it('keeps the model picker usable while another provider can route', async () => {
    const h = open()
    h.sendState(state(true))
    await h.settle()
    // Sending genuinely cannot work, so the composer stays closed…
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(true)
    // …but the picker is how the user recovers, so it must not be.
    expect((h.document.getElementById('models') as HTMLButtonElement).disabled).toBe(false)
    expect(h.document.getElementById('routableNotice')!.textContent).toContain('Choose another model')
  })

  it('disables it when no provider can route at all', async () => {
    const h = open()
    h.sendState(state(false))
    await h.settle()
    expect((h.document.getElementById('models') as HTMLButtonElement).disabled).toBe(true)
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(true)
  })
})

describe('candidate lists belong to the prompt that asked for them', () => {
  it('closes a stale mention listbox when the conversation changes', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', sessions: [] })
    await h.settle()
    type(h, '@src')
    const request = h.posts.filter(post => post.type === 'request-mentions').at(-1)!
    h.send({ type: 'mention-suggestions', requestId: request.requestId, query: 'src', candidates: [{ path: 'src/index.ts', kind: 'file' }] })
    await h.settle()
    expect(h.document.getElementById('mentionMenu')!.classList.contains('hidden')).toBe(false)

    h.sendState({ phase: 'ready', sessionId: 'session-b', sessions: [] })
    await h.settle()
    expect(h.document.getElementById('mentionMenu')!.classList.contains('hidden')).toBe(true)
  })

  it('does not let the stale list swallow Enter in the new conversation', async () => {
    const h = open()
    h.sendState({ phase: 'ready', sessionId: 'session-a', routable: true, sessions: [] })
    await h.settle()
    type(h, '@src')
    const request = h.posts.filter(post => post.type === 'request-mentions').at(-1)!
    h.send({ type: 'mention-suggestions', requestId: request.requestId, query: 'src', candidates: [{ path: 'src/index.ts', kind: 'file' }] })
    await h.settle()
    h.sendState({ sessionId: 'session-b' })
    await h.settle()
    type(h, 'unrelated message')
    h.posts.length = 0
    const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
    prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    // The message is sent as typed: before the list was cleared, Enter was
    // consumed by a candidate from the previous conversation and nothing left.
    const sent = h.posts.filter(post => post.type === 'send')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('unrelated message')
  })
})
