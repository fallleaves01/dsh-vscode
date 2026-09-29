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

  const catalog = [
    model('deepseek-official', 'DeepSeek Official', 'v3', 'DeepSeek V3', true),
    model('gateway', 'Local gateway', 'flash', 'Flash'),
    model('gateway', 'Local gateway', 'pro', 'Pro'),
  ]
  const openPicker = async (models = catalog) => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models })
    await h.settle()
    h.click('#modelTrigger')
    await h.settle()
    return h
  }

  it('groups the menu by provider instead of listing the models flat', async () => {
    const h = await openPicker()
    const groups = [...h.document.querySelectorAll('.model-group-label')].map(node => node.textContent)
    expect(groups).toEqual(['DeepSeek Official', 'Local gateway'])
    const options = [...h.document.querySelectorAll('.model-option')]
    expect(options.map(option => option.querySelector('.model-option-label')!.textContent)).toEqual(['DeepSeek V3', 'Flash', 'Pro'])
    // The selection stays on the model it belongs to, inside its group.
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    expect(options[0]!.querySelector('.model-option-current')!.textContent).toBe('Current')
  })

  it('names the provider in the control and keeps only the model on it', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      model('gateway', 'Local gateway', 'flash', 'Flash', true),
    ] })
    await h.settle()
    // Only the model name fits in the control, so the provider goes in the tooltip.
    expect(h.document.getElementById('modelTriggerLabel')!.textContent).toBe('Flash')
    expect(h.document.getElementById('modelTrigger')!.getAttribute('title')).toBe('Model: Flash — Local gateway')
    expect(h.document.getElementById('modelTrigger')!.getAttribute('aria-label')).toContain('Local gateway')
  })

  it('falls back to the provider id when the runtime names no provider', async () => {
    const h = await openPicker([model('gateway', '', 'flash', 'Flash', true)])
    expect([...h.document.querySelectorAll('.model-group-label')].map(node => node.textContent)).toEqual(['gateway'])
  })
})

describe('the model picker is searchable and driven by the keyboard', () => {
  const model = (provider: string, providerLabel: string, id: string, label: string, selected = false) =>
    ({ provider, providerLabel, model: id, label, selected, reasoningEfforts: [] })
  const catalog = [
    model('gateway', 'Local gateway', 'flash', 'Flash', true),
    model('gateway', 'Local gateway', 'pro', 'Pro'),
    model('gateway', 'Local gateway', 'mini', 'Mini'),
    model('deepseek-official', 'DeepSeek Official', 'v3', 'DeepSeek V3'),
  ]

  const openPicker = async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: catalog })
    await h.settle()
    h.click('#modelTrigger')
    await h.settle()
    return h
  }
  const search = (h: Harness) => h.document.getElementById('modelSearch') as HTMLInputElement
  const type = async (h: Harness, text: string) => {
    search(h).value = text
    search(h).dispatchEvent(new Event('input', { bubbles: true }))
    await h.settle()
  }
  const press = (h: Harness, key: string) => {
    search(h).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }
  const labels = (h: Harness) => [...h.document.querySelectorAll('.model-option-label')].map(node => node.textContent)
  /** Click the option whose label reads like this; nth-of-type counts buttons. */
  const choose = async (h: Harness, text: string) => {
    const option = [...h.document.querySelectorAll('.model-option')].find(node => node.textContent?.includes(text))
    if (option === undefined) throw new Error(`no model option ${text}`)
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await h.settle()
  }

  it('opens on the search box with every model listed', async () => {
    const h = await openPicker()
    expect(search(h).value).toBe('')
    expect(labels(h)).toEqual(['Flash', 'Pro', 'Mini', 'DeepSeek V3'])
  })

  it('matches a subsequence, not just a prefix', async () => {
    const h = await openPicker()
    await type(h, 'fsh')
    // Every character in order, so an abbreviated query finds the model no
    // prefix search would.
    expect(labels(h)).toEqual(['Flash'])

    await type(h, 'deep')
    expect(labels(h)).toEqual(['DeepSeek V3'])

    await type(h, 'hsf')
    // Order still matters, or the query would match almost anything.
    expect(labels(h)).toEqual([])

    await type(h, 'nothing here')
    expect(labels(h)).toEqual([])
    expect(h.document.querySelector('.model-empty')!.textContent).toBe('No model matches')
  })

  it('filters by provider as well as by model', async () => {
    const h = await openPicker()
    await type(h, 'gateway')
    expect(labels(h)).toEqual(['Flash', 'Pro', 'Mini'])
  })

  it('selects the highlighted model with the arrow keys and Enter', async () => {
    const h = await openPicker()
    await type(h, 'gateway')
    press(h, 'ArrowDown')
    press(h, 'Enter')
    await h.settle()
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([
      { type: 'select-model', selection: { provider: 'gateway', model: 'pro' } },
    ])
    expect(h.document.getElementById('modelMenu')!.classList.contains('hidden')).toBe(true)
  })

  it('lets an input method commit its own composition with Enter', async () => {
    const h = await openPicker()
    await type(h, 'gateway')
    // Move off the current model, so a wrong commit would be visible as a post.
    press(h, 'ArrowDown')
    await h.settle()
    // An Enter that commits an IME candidate belongs to the input method. Acting
    // on it chose the highlighted model and closed the menu, so a search typed in
    // Chinese, Japanese or with dead keys switched the model by itself.
    search(h).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    await h.settle()
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([])
    expect(h.document.getElementById('modelMenu')!.classList.contains('hidden')).toBe(false)

    // The same key once the composition is over still chooses.
    press(h, 'Enter')
    await h.settle()
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([
      { type: 'select-model', selection: { provider: 'gateway', model: 'pro' } },
    ])
  })

  it('wraps the keyboard selection in both directions', async () => {
    const h = await openPicker()
    await type(h, 'gateway')
    press(h, 'ArrowUp')
    press(h, 'Enter')
    await h.settle()
    // Up from the first entry is the last one, not nothing.
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([
      { type: 'select-model', selection: { provider: 'gateway', model: 'mini' } },
    ])
  })

  it('names the highlighted model for a screen reader', async () => {
    const h = await openPicker()
    const highlighted = () => h.document.getElementById('modelSearch')!.getAttribute('aria-activedescendant')
    // Focus never leaves the search box, so the arrow keys have to say where
    // they are by naming the option.
    expect(highlighted()).toBe('model-option-0')
    press(h, 'ArrowDown')
    expect(highlighted()).toBe('model-option-1')
    expect(h.document.getElementById(highlighted()!)!.textContent).toContain('Pro')

    await type(h, 'nothing here')
    expect(highlighted()).toBeNull()
  })

  it('keeps the arrows working after one Tab, and never tabs into an option', async () => {
    const h = await openPicker()
    const options = [...h.document.querySelectorAll('.model-option')] as HTMLElement[]
    // The search box owns the focus and names the highlight, so no option may be
    // a tab stop: one Tab would land on an option and the arrows would go dead.
    expect(options.every(option => option.tabIndex === -1)).toBe(true)
    press(h, 'ArrowDown')
    expect(h.document.activeElement?.id).toBe('modelSearch')
    expect(h.document.getElementById('modelSearch')!.getAttribute('aria-activedescendant')).toBe('model-option-1')
  })

  it('closes on a click inside itself only because the guard knows the menu', async () => {
    const h = await openPicker()
    // The menu is not inside #modelControl, so the outside-click guard has to
    // accept the menu too rather than rely on a stopPropagation listener.
    h.document.getElementById('modelList')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await h.settle()
    expect(h.document.getElementById('modelMenu')!.classList.contains('hidden')).toBe(false)
  })

  it('moves the focus out of a picker that became unusable', async () => {
    const h = await openPicker()
    expect(h.document.activeElement?.id).toBe('modelSearch')
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: false, models: [] })
    await h.settle()
    expect(h.document.getElementById('modelMenu')!.classList.contains('hidden')).toBe(true)
    expect((h.document.getElementById('modelTrigger') as HTMLButtonElement).disabled).toBe(true)
    expect(h.document.activeElement?.id).not.toBe('modelSearch')
  })

  it('does not leave the command menu open behind it', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: catalog,
      commands: [{ name: 'plan', description: 'Plan mode' }] })
    await h.settle()
    const prompt = h.document.getElementById('prompt') as HTMLTextAreaElement
    prompt.value = '/'
    prompt.dispatchEvent(new Event('input', { bubbles: true }))
    await h.settle()
    expect(h.document.getElementById('commandMenu')!.classList.contains('hidden')).toBe(false)
    h.click('#modelTrigger')
    await h.settle()
    // Two panels above one composer is one too many.
    expect(h.document.getElementById('commandMenu')!.classList.contains('hidden')).toBe(true)
    expect(h.document.getElementById('modelMenu')!.classList.contains('hidden')).toBe(false)
  })

  it('closes on Escape and gives the focus back to the control', async () => {
    const h = await openPicker()
    press(h, 'Escape')
    await h.settle()
    expect(h.document.getElementById('modelMenu')!.classList.contains('hidden')).toBe(true)
    expect(h.document.activeElement?.id).toBe('modelTrigger')
    expect(h.posts.filter(post => post.type === 'select-model')).toHaveLength(0)
  })

  it('carries the chosen model’s reasoning effort into the selection', async () => {
    const h = open()
    const efforts = [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High', selected: true }]
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'flash', label: 'Flash', selected: true, reasoningEfforts: [] },
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'pro', label: 'Pro', selected: false, reasoningEfforts: efforts, defaultReasoningEffort: 'high' },
    ] })
    await h.settle()
    h.click('#modelTrigger'); await h.settle()
    await choose(h, 'Pro')
    // The model is not the whole choice: the runtime also needs the effort, and
    // the picker is what has to supply the new model's default.
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([
      { type: 'select-model', selection: { provider: 'gateway', model: 'pro', reasoningEffort: 'high' } },
    ])
    const select = h.document.getElementById('efforts') as HTMLSelectElement
    expect(select.disabled).toBe(false)
    expect(select.value).toBe('high')
  })

  it('sends no effort for a model that has none, and disables the effort control', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'flash', label: 'Flash', selected: true, reasoningEfforts: [{ id: 'low', label: 'Low' }] },
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'plain', label: 'Plain', selected: false, reasoningEfforts: [] },
    ] })
    await h.settle()
    h.click('#modelTrigger'); await h.settle()
    await choose(h, 'Plain')
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([
      { type: 'select-model', selection: { provider: 'gateway', model: 'plain' } },
    ])
    const select = h.document.getElementById('efforts') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.options[0]!.textContent).toBe('Default')
  })

  it('re-sends the current model when only the effort changes', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'flash', label: 'Flash', selected: true,
        reasoningEfforts: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }], defaultReasoningEffort: 'low' },
    ] })
    await h.settle()
    const select = h.document.getElementById('efforts') as HTMLSelectElement
    select.value = 'high'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await h.settle()
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([
      { type: 'select-model', selection: { provider: 'gateway', model: 'flash', reasoningEffort: 'high' } },
    ])
  })

  it('keeps the chosen model when only the effort changes next', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'flash', label: 'Flash', selected: true, reasoningEfforts: [] },
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'pro', label: 'Pro', selected: false,
        reasoningEfforts: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }], defaultReasoningEffort: 'low' },
    ] })
    await h.settle()
    h.click('#modelTrigger'); await h.settle()
    await choose(h, 'Pro')
    const select = h.document.getElementById('efforts') as HTMLSelectElement
    select.value = 'high'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await h.settle()
    // The effort control reads the picker's value, so the menu's choice must be
    // recorded there or this second post would name the model it replaced.
    expect(h.posts.filter(post => post.type === 'select-model')).toEqual([
      { type: 'select-model', selection: { provider: 'gateway', model: 'pro', reasoningEffort: 'low' } },
      { type: 'select-model', selection: { provider: 'gateway', model: 'pro', reasoningEffort: 'high' } },
    ])
  })

  it('leaves an effort alone when the model it belongs to is picked again', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true, models: [
      { provider: 'gateway', providerLabel: 'Local gateway', model: 'pro', label: 'Pro', selected: true,
        reasoningEfforts: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }], defaultReasoningEffort: 'low' },
    ] })
    await h.settle()
    const select = h.document.getElementById('efforts') as HTMLSelectElement
    select.value = 'high'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await h.settle()
    h.click('#modelTrigger'); await h.settle()
    await choose(h, 'Pro')
    expect(select.value).toBe('high')
    // One post for the effort change, and nothing for re-picking the same model.
    expect(h.posts.filter(post => post.type === 'select-model')).toHaveLength(1)
  })

  it('closes when the click lands anywhere else', async () => {
    const h = await openPicker()
    h.document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await h.settle()
    expect(h.document.getElementById('modelMenu')!.classList.contains('hidden')).toBe(true)
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
    expect((h.document.getElementById('modelTrigger') as HTMLButtonElement).disabled).toBe(false)
    expect(h.document.getElementById('routableNotice')!.textContent).toContain('Choose another model')
  })

  it('disables it when no provider can route at all', async () => {
    const h = open()
    h.sendState(state(false))
    await h.settle()
    expect((h.document.getElementById('models') as HTMLButtonElement).disabled).toBe(true)
    expect((h.document.getElementById('modelTrigger') as HTMLButtonElement).disabled).toBe(true)
    expect((h.document.getElementById('prompt') as HTMLTextAreaElement).disabled).toBe(true)
  })
})

describe('the row under a completed turn', () => {
  /**
   * Today at a fixed wall-clock time.
   *
   * An absolute date made these tests pass only on the day they were written:
   * the clock shows a bare time for today and a date for anything older, so the
   * assertion broke the next morning.
   */
  const todayAt = (hours: number, minutes: number): number => {
    const at = new Date()
    at.setHours(hours, minutes, 0, 0)
    return at.getTime()
  }
  const state = (meta: unknown[]) => ({
    sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true,
    messages: [{ id: 'm1', role: 'assistant', text: 'the answer' }],
    messageMeta: meta,
  })

  it('offers copy, the turn usage and the clock', async () => {
    const h = open()
    h.sendState(state([{ id: 'm1', time: todayAt(14, 39), turnEnd: true,
      turnUsage: { uncachedInputTokens: 12_000, outputTokens: 300, totalTokens: 12_300, routes: [] } }]))
    await h.settle()
    const row = h.document.querySelector('.message-actions')
    expect(row).not.toBeNull()
    expect(row!.querySelector('.message-copy')!.getAttribute('aria-label')).toBe('Copy')
    // DSH's own wording, and its database mark on the pill.
    expect(row!.querySelector('.usage-pill')!.textContent).toBe('12.3K tok')
    expect(row!.querySelector('.usage-pill svg')).not.toBeNull()
    // The pill names the fields DSH's panel names, in its order.
    const detail = row!.querySelector('.usage-pill')!.getAttribute('aria-label')!
    expect(detail).toContain('Uncached input: 12,000')
    expect(detail).toContain('Output: 300')
    expect(row!.querySelector('.message-clock')!.textContent).toMatch(/^\d{2}:\d{2}$/)
  })

  it('reports the cache share the way DSH reports it', async () => {
    const h = open()
    h.sendState(state([{ id: 'm1', time: todayAt(14, 39), turnEnd: true,
      turnUsage: { uncachedInputTokens: 1_000, cacheReadTokens: 9_000, outputTokens: 300, totalTokens: 10_300, routes: [] } }]))
    await h.settle()
    const label = h.document.querySelector('.usage-pill .stat-label')!
    expect(label.textContent).toBe('10.3K tok·Cache hit 90%')
    expect([...label.querySelectorAll('.usage-pill-sep')].map(node => node.textContent)).toEqual(['·'])
  })

  it('groups the turn bill and its clock after the marks, as DSH does', async () => {
    const h = open()
    h.sendState(state([{ id: 'm1', time: todayAt(14, 39), turnEnd: true, turnDurationMs: 65_000,
      turnUsage: { uncachedInputTokens: 12_000, outputTokens: 300, totalTokens: 12_300, routes: [] } }]))
    await h.settle()
    const row = h.document.querySelector('.message-actions')!
    const end = row.querySelector('.message-end')!
    expect(end).not.toBeNull()
    // The order of the whole row: marks first, then the bill and the clock.
    expect([...row.children].map(child => child.className)).toEqual([
      'message-action message-icon message-copy',
      'message-action message-icon message-positive',
      'message-action message-icon message-negative',
      'message-action message-icon message-branch',
      'message-end',
    ])
    expect([...end.children].map(child => child.className)).toEqual(['message-action usage-pill', 'message-duration', 'message-clock'])
    // DSH sets the wait apart in the code face with tabular figures.
    const number = end.querySelector('.duration-number')!
    expect(number.textContent).toBe('1m 5s')
    expect(end.querySelector('.message-duration')!.textContent).toBe('Completed in 1m 5s')
  })

  it('draws its buttons with DSH’s own marks instead of emoji', async () => {
    const h = open()
    h.sendState(state([{ id: 'm1', time: todayAt(14, 39), turnEnd: true }]))
    await h.settle()
    const row = h.document.querySelector('.message-actions')!
    for (const selector of ['.message-copy', '.message-positive', '.message-negative', '.message-branch']) {
      const button = row.querySelector(selector)!
      expect(button.querySelector('svg'), selector).not.toBeNull()
      expect(button.textContent?.trim(), selector).toBe('')
      expect(button.classList.contains('message-icon')).toBe(true)
    }
    // Outline while unchosen: the mark is drawn, not filled.
    expect(row.querySelector('.message-positive path')!.getAttribute('fill')).toBe('none')
    expect(row.querySelector('.message-positive path')!.getAttribute('stroke')).toBe('currentColor')
  })

  it('fills the mark of the rating that is recorded', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      messages: [{ id: 'm1', role: 'assistant', text: 'the answer' }],
      messageMeta: [{ id: 'm1', seq: 42, time: Date.now(), turnEnd: true }],
      messageFeedback: [{ messageId: 'm1', rating: 'negative', version: 1 }],
    })
    await h.settle()
    // DSH swaps the artwork rather than tinting the button: filled means chosen.
    expect(h.document.querySelector('.message-negative path')!.getAttribute('fill')).toBe('currentColor')
    expect(h.document.querySelector('.message-positive path')!.getAttribute('fill')).toBe('none')
  })

  it('confirms a copy without losing the mark it replaces', async () => {
    const h = open()
    h.sendState(state([{ id: 'm1', time: todayAt(14, 39), turnEnd: true }]))
    await h.settle()
    const copy = h.document.querySelector('.message-copy') as HTMLButtonElement
    copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // The check is drawn by the stylesheet, so the icon has to survive the swap.
    expect(copy.classList.contains('copied')).toBe(true)
    expect(copy.querySelector('svg')).not.toBeNull()
    expect(copy.getAttribute('aria-label')).toBe('Copied')
  })

  it('reports how long the turn took, and stays quiet about a sub-second one', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      messages: [{ id: 'm1', role: 'assistant', text: 'first answer' }, { id: 'm2', role: 'assistant', text: 'second answer' }],
      messageMeta: [
        { id: 'm1', time: todayAt(14, 39), turnEnd: true, turnDurationMs: 65_000 },
        { id: 'm2', time: todayAt(14, 40), turnEnd: true, turnDurationMs: 400 },
      ],
    })
    await h.settle()
    const rows = [...h.document.querySelectorAll('.message-actions')]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('.message-duration')!.textContent).toBe('Completed in 1m 5s')
    // Under a second the label would be noise rather than information.
    expect(rows[1]!.querySelector('.message-duration')).toBeNull()
  })

  it('shows the row on the newest turn and hides it elsewhere', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      messages: [{ id: 'm1', role: 'assistant', text: 'first' }, { id: 'm2', role: 'user', text: 'again' }, { id: 'm3', role: 'assistant', text: 'second' }],
      messageMeta: [{ id: 'm1', time: 1, turnEnd: true }, { id: 'm3', time: 2, turnEnd: true }],
    })
    await h.settle()
    const rows = [...h.document.querySelectorAll('.message-actions')]
    expect(rows).toHaveLength(2)
    // Only the newest stays visible without hovering.
    expect(rows[0]!.classList.contains('always')).toBe(false)
    expect(rows[1]!.classList.contains('always')).toBe(true)
  })

  it('offers a rating, marks the one recorded, and offers a branch', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      messages: [{ id: 'm1', role: 'assistant', text: 'the answer' }],
      messageMeta: [{ id: 'm1', seq: 42, time: Date.now(), turnEnd: true }],
      messageFeedback: [{ messageId: 'm1', rating: 'positive', version: 3 }],
    })
    await h.settle()
    const like = h.document.querySelector('.message-positive')!
    const dislike = h.document.querySelector('.message-negative')!
    // The recorded rating says what clicking it does, and is announced as pressed.
    expect(like.getAttribute('aria-label')).toBe('Remove rating')
    expect(like.getAttribute('aria-pressed')).toBe('true')
    expect(like.classList.contains('active')).toBe(true)
    expect(dislike.getAttribute('aria-label')).toBe('Bad response')
    expect(dislike.getAttribute('aria-pressed')).toBe('false')

    h.posts.length = 0
    dislike.dispatchEvent(new Event('click', { bubbles: true }))
    expect(h.posts).toContainEqual({ type: 'message-feedback', sessionId: 'session-a', messageId: 'm1', rating: 'negative' })

    h.posts.length = 0
    h.document.querySelector('.message-branch')!.dispatchEvent(new Event('click', { bubbles: true }))
    // The branch forks at this turn's own event, which is where it closes.
    expect(h.posts[0]).toMatchObject({ type: 'fork-conversation', sessionId: 'session-a', atSeq: 42 })
  })

  it('gives the user’s own message a clock and a copy, and nothing else', async () => {
    const h = open()
    h.sendState({
      sessionId: 'session-a', phase: 'ready',
      messages: [{ id: 'u1', role: 'user', text: 'my question' }],
      messageMeta: [{ id: 'u1', seq: 1, time: Date.now() }],
    })
    await h.settle()
    const row = h.document.querySelector('.message-actions.user-actions')
    expect(row).not.toBeNull()
    expect(row!.querySelector('.message-clock')).not.toBeNull()
    expect(row!.querySelector('.message-copy')).not.toBeNull()
    // A user message is not rated or branched.
    expect(row!.querySelector('.message-positive')).toBeNull()
    expect(row!.querySelector('.message-branch')).toBeNull()
    // The clock comes first, as DSH orders a user row.
    expect(row!.children[0]!.classList.contains('message-clock')).toBe(true)
  })

  it('renders no row while the turn is still open', async () => {
    const h = open()
    h.sendState(state([{ id: 'm1', time: 1 }]))
    await h.settle()
    expect(h.document.querySelector('.message-actions')).toBeNull()
  })
})

describe('picking a command from the menu', () => {
  it('sends it with the session and request the extension requires', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true,
      commands: [{ name: 'compact', description: 'Compact the conversation' }], skills: [] })
    await h.settle()
    type(h, '/comp')
    await h.settle()

    h.posts.length = 0
    // The menu acts on mousedown, as its options do.
    h.document.querySelector('#commandMenu .command-option')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const sent = h.posts.filter(post => post.type === 'send')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'send', sessionId: 'session-a', text: '/compact' })
    // Without an id the extension drops the message silently: every command from
    // the menu looked dead.
    expect(typeof sent[0]?.requestId).toBe('number')
  })

  it('sends a permission preset the same way', async () => {
    const h = open()
    h.sendState({ sessionId: 'session-a', phase: 'ready', routable: true, anyRoutable: true,
      permissions: [{ value: 'read-only', label: 'Read Only', description: 'Read only.', selected: true }] })
    await h.settle()
    type(h, '/permission ')
    await h.settle()
    h.posts.length = 0
    const option = h.document.querySelector('#commandMenu .command-option')!
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const sent = h.posts.filter(post => post.type === 'send')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ sessionId: 'session-a', text: '/permission read-only' })
    expect(typeof sent[0]?.requestId).toBe('number')
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
