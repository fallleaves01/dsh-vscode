// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mountSettingsPage } from '../src/settings-page.mjs'
import { settingsPageHtml } from '../src/settings-page-html.js'
import { bundlePageState, experimentalPageState, pageState, searchPageState } from './settings-page.fixture.js'
import type { SettingsPageState } from '../src/settings-page-state.js'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren() })
function harness(overrides: Partial<SettingsPageState> = {}) {
  const html = settingsPageHtml({ cspSource: 'vscode-webview:' } as any, { toString: () => 'settings-page.js' } as any)
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  const posts: Record<string, any>[] = []
  const page = mountSettingsPage(document, { postMessage: value => posts.push(value as any) }); dispose = () => page.dispose()
  let state = { ...pageState(), ...overrides }
  const send = (data: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', { data }))
  const update = (patch: Partial<SettingsPageState>) => { state = { ...state, ...patch }; send({ type: 'state', state }) }
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!
  const click = (label: string) => {
    if (!button(label) && ['Shell', 'Agent loop', 'Subagents', 'Web search', 'Reasoning translation', 'Voice input', 'Plugin market'].includes(label)) button('Built-in plugins').click()
    expect(button(label), label).toBeDefined(); button(label).click()
  }
  const input = (key: string, value: string) => {
    const control = [...document.querySelectorAll<HTMLInputElement>('input')].find(item => item.dataset.focusKey === key)!
    expect(control, key).toBeDefined(); control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); return control
  }
  const select = (key: string, value: string) => {
    const control = [...document.querySelectorAll<HTMLSelectElement>('select')].find(item => item.dataset.focusKey === key)!
    expect(control, key).toBeDefined(); control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); return control
  }
  const textarea = (key: string, value: string) => {
    const control = [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].find(item => item.dataset.focusKey === key)!
    expect(control, key).toBeDefined(); control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); return control
  }
  const result = (value: Record<string, unknown> = { ok: true }) => send({ type: 'result', requestId: posts.at(-1)?.requestId, ...value })
  update({})
  return { posts, send, update, click, input, select, textarea, result, button, state: () => state }
}

describe('dedicated DSH settings surface', () => {
  it('keeps keyboard focus on the active settings navigation button after rendering', () => {
    const h = harness(); h.click('Built-in plugins'); const nav = document.querySelector<HTMLButtonElement>('[data-section="subagents"]')!
    nav.focus(); nav.click(); expect((document.activeElement as HTMLElement).dataset.section).toBe('subagents')
    h.update({}); expect((document.activeElement as HTMLElement).dataset.section).toBe('subagents')
  })
  it('does not retain a cleared key target when explicitly choosing another search mode', () => {
    const state = searchPageState(); state.search!.profiles = state.search!.profiles.map(profile => ({ ...profile, credential: { configured: true, writable: true } }))
    const h = harness(state); h.click('Web search'); h.input('api-key', 'first-fixture'); h.input('api-key', '')
    document.querySelector<HTMLInputElement>('[data-focus-key="search-api-mode"]')!.click(); h.input('api-key', 'second-fixture'); h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ keyNamespace: 'web-deepseek-api', apiKey: 'second-fixture' })
  })
  it('keeps the guide accessible in read-only search settings and blocks clearing a stale target', () => {
    const state = searchPageState(); state.search!.profiles = state.search!.profiles.map(profile => ({ ...profile, credential: { configured: true, writable: true } }))
    const h = harness(state); h.click('Web search'); h.input('api-key', 'fixture-key')
    h.update({ search: { ...state.search!, selection: { ...state.search!.selection!, revision: 2 } } })
    expect(h.button('Clear key').disabled).toBe(true)
    h.update({ writable: false }); h.click('Search API guide ↗'); expect(h.posts.at(-1)).toMatchObject({ action: 'search-guide' })
  })
  it('keeps Search / Fetch mode drafts, endpoints and limits separate until an explicit Save', () => {
    const h = harness(searchPageState()); h.click('Web search')
    h.input('web-search-deepseek:maxUses', '8')
    document.querySelector<HTMLInputElement>('[data-focus-key="search-api-mode"]')!.click()
    expect(h.posts).toEqual([{ type: 'ready' }])
    expect(document.querySelector('[data-focus-key="web-search-deepseek:maxUses"]')).toBeNull()
    h.input('web-deepseek-api:count', '25'); h.input('api-key', 'fixture-search-key')
    h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-search', selectionRevision: 1, selection: { enabled: true }, changes: [
      { ns: 'web-search-deepseek', revision: 1, values: { maxUses: 8 } }, { ns: 'web-deepseek-api', revision: 1, values: { count: 25 } },
    ], keyNamespace: 'web-deepseek-api', keyRevision: 1, apiKey: 'fixture-search-key' })
  })
  it('blocks stale search selection and key drafts while retaining the entered values', () => {
    const state = searchPageState(), h = harness(state); h.click('Web search')
    document.querySelector<HTMLInputElement>('[data-focus-key="search-api-mode"]')!.click(); h.input('api-key', 'fixture-search-key')
    h.update({ search: { ...state.search!, selection: { ...state.search!.selection!, revision: 2 } } })
    expect(h.button('Save changes').disabled).toBe(true)
    expect(document.querySelector<HTMLInputElement>('[data-focus-key="api-key"]')!.value).toBe('fixture-search-key')
    h.click('Discard'); expect(document.querySelector<HTMLInputElement>('[data-focus-key="api-key"]')!.value).toBe('')
  })
  it('retains search mode and key after a partial failure and retries with the confirmed profile revision', () => {
    const state = searchPageState(), h = harness(state); h.click('Web search')
    document.querySelector<HTMLInputElement>('[data-focus-key="search-api-mode"]')!.click()
    h.input('web-deepseek-api:count', '22'); h.input('api-key', 'fixture-search-key'); h.click('Save changes')
    h.update({ forms: state.forms.map(form => form.ns === 'web-deepseek-api' ? { ...form, revision: 2 } : form), search: { ...state.search!, profiles: state.search!.profiles.map(profile => profile.ns === 'web-deepseek-api' ? { ...profile, revision: 2 } : profile) } })
    h.result({ ok: false, results: [{ ns: 'web-deepseek-api', ok: true, revision: 2 }], keySaved: false, selectionSaved: false, error: 'Credential store unavailable' })
    expect(h.button('Save changes').disabled).toBe(false); h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-search', changes: [], keyRevision: 2, apiKey: 'fixture-search-key', selection: { enabled: true } })
  })
  it('enforces result count bounds locally and offers only the fixed official guide action', () => {
    const h = harness(searchPageState()); h.click('Web search'); h.click('Search API guide ↗')
    expect(h.posts.at(-1)).toMatchObject({ type: 'native-action', action: 'search-guide' })
    document.querySelector<HTMLInputElement>('[data-focus-key="search-api-mode"]')!.click()
    h.input('web-deepseek-api:count', '51'); h.click('Save changes')
    expect(h.posts.some(post => post.type === 'save-search')).toBe(false); expect(document.body.textContent).toContain('maximum 50')
  })
  it('uses the official reasoning level table and sends only explicitly edited mappings', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    const enable = document.querySelector<HTMLInputElement>('[data-focus-key="reasoning:0:enabled"]')!
    enable.click(); expect(document.querySelectorAll('.reasoning-row select')).toHaveLength(4)
    expect(document.querySelector<HTMLInputElement>('[aria-label="off API value"]')!.disabled).toBe(true)
    h.input('reasoning:0:3:value', 'adaptive'); h.click('+ Add level')
    h.click('Save changes')
    expect(h.posts.at(-1)!.fields.models[0].reasoningEfforts).toEqual({ off: null, low: 'low', medium: 'medium', high: 'adaptive', xhigh: 'xhigh' })
  })
  it('prevents an Off-only reasoning map and restores automatic mapping when disabled', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    document.querySelector<HTMLInputElement>('[data-focus-key="reasoning:0:enabled"]')!.click()
    for (const level of ['low', 'medium', 'high']) document.querySelector<HTMLButtonElement>(`[aria-label="Delete level ${level}"]`)!.click()
    expect(h.button('Save changes').disabled).toBe(true); expect(document.body.textContent).toContain('at least one level')
    document.querySelector<HTMLInputElement>('[data-focus-key="reasoning:0:enabled"]')!.click(); h.click('Save changes')
    expect(h.posts.at(-1)!.fields.models[0].reasoningEfforts).toBeNull()
  })
  it('hides custom reasoning controls when the adapter schema does not declare them', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="deepseek-official"]')!.click()
    expect(document.querySelector('.model-reasoning')).toBeNull()
  })
  it('reveals only a typed API key on explicit request and masks it again on remount', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    h.input('api-key', 'fixture-key'); document.querySelector<HTMLButtonElement>('[aria-label="Show API key"]')!.click()
    expect(document.querySelector<HTMLInputElement>('[data-focus-key="api-key"]')!.type).toBe('text')
    h.click('Shell'); h.click('Models')
    expect(document.querySelector<HTMLInputElement>('[data-focus-key="api-key"]')!.type).toBe('password')
  })
  it('uses direct settings navigation and only offers capabilities supplied by the runtime', () => {
    const h = harness()
    expect([...document.querySelectorAll('nav [data-section]')].map(item => (item as HTMLElement).dataset.section)).toEqual(['general', 'models', 'plugins'])
    h.update({ forms: [], allowedModels: undefined, inventory: [] })
    expect([...document.querySelectorAll('nav [data-section]')].map(item => (item as HTMLElement).dataset.section)).toEqual(['general', 'models'])
  })
  it('saves shell changes only on Save and keeps restoration as an unset operation', () => {
    const h = harness(); h.click('Shell'); h.input('bash-sandbox:timeoutMs', '120000')
    expect(h.posts).toEqual([{ type: 'ready' }])
    h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-fields', scope: 'runtime-a', changes: [{ ns: 'bash-sandbox', revision: 1, values: { timeoutMs: 120000 } }] })
    h.result({ ok: true, results: [{ ns: 'bash-sandbox', ok: true }] })
    expect(h.button('Save changes').disabled).toBe(true)
  })
  it('retains invalid numeric drafts without submitting or silently converting them to zero', () => {
    const h = harness(); h.click('Agent loop'); h.input('agent-loop:maxParallelToolCalls', '1.5'); h.click('Save changes')
    expect(h.posts).toEqual([{ type: 'ready' }])
    expect(document.querySelector('.error')!.textContent).toContain('integer')
    expect((document.querySelector('[data-focus-key="agent-loop:maxParallelToolCalls"]') as HTMLInputElement).value).toBe('1.5')
  })
  it('retains drafts and focus across an external revision update, and blocks stale saving', () => {
    const h = harness(); h.click('Shell'); const control = h.input('bash-sandbox:timeoutMs', '90000'); control.focus(); control.setSelectionRange(2, 4)
    const forms = h.state().forms.map(form => form.ns === 'bash-sandbox' ? { ...form, revision: 2 } : form)
    h.update({ forms })
    expect((document.activeElement as HTMLInputElement).value).toBe('90000')
    expect((document.activeElement as HTMLInputElement).selectionStart).toBe(2)
    expect(h.button('Save changes').disabled).toBe(true)
    h.click('Discard')
    expect((document.querySelector('[data-focus-key="bash-sandbox:timeoutMs"]') as HTMLInputElement).value).toBe('60000')
  })
  it('does not erase an in-progress draft or focus while refreshing the same runtime', () => {
    const h = harness(); h.click('Shell'); h.input('bash-sandbox:timeoutMs', '80000').focus()
    h.update({ loading: true }); h.update({ loading: false })
    expect((document.activeElement as HTMLInputElement).value).toBe('80000')
    expect(h.button('Save changes').disabled).toBe(false)
  })
  it('applies the session-log privacy switch explicitly and exposes native appearance actions', () => {
    const h = harness(); document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-fields', changes: [{ ns: 'session-log-deepseek', revision: 1, values: { enabled: false } }] })
    h.result({ ok: true, results: [{ ns: 'session-log-deepseek', ok: true }] }); h.click('Color theme')
    expect(h.posts.at(-1)).toMatchObject({ type: 'native-action', action: 'theme' })
  })
  it('keeps API keys blank on load and does not return a secret through state or saved messages', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    const key = document.querySelector<HTMLInputElement>('input[type="password"]')!
    expect(key.value).toBe(''); expect(key.autocomplete).toBe('new-password')
    h.input('api-key', 'fixture-key'); h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-provider', provider: 'anthropic', apiKey: 'fixture-key', fields: {} })
    h.result({ ok: true }); expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
    expect(document.body.textContent).not.toContain('fixture-key')
  })
  it('uses the provider credential capability for read-only keys', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="deepseek-official"]')!.click()
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.disabled).toBe(true)
    expect(h.button('Clear key').disabled).toBe(true)
    h.click('Configure extension API key…')
    expect(h.posts.at(-1)).toMatchObject({ type: 'native-action', action: 'extension-key', scope: 'runtime-a' })
  })
  it('queries and selects models without saving before Add selected and Save', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    h.click('Get available models')
    expect(h.posts.at(-1)).toMatchObject({ type: 'discover-models', ns: 'llm-pi-ai', provider: 'anthropic' })
    h.result({ ok: true, models: [{ id: '<img src=x onerror=bad()>', name: 'Candidate' }, { id: 'new-model', contextWindow: 20000 }] })
    expect(document.querySelector('.choices img')).toBeNull()
    h.input('model-search', 'new-model'); h.click('Select visible'); h.click('Add selected')
    expect(h.posts.filter(item => item.type === 'save-provider')).toHaveLength(0)
    h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ fields: { models: expect.arrayContaining([{ id: 'new-model', contextWindow: 20000 }]) } })
  })
  it('enables model lookup after entering a custom provider ID without requiring a manual model', () => {
    const h = harness(); h.click('Models'); h.click('Add model provider')
    const source = document.querySelector<HTMLSelectElement>('select[aria-label="Provider source"]')!; source.value = 'custom'; source.dispatchEvent(new Event('change'))
    expect(h.button('Get available models').disabled).toBe(true)
    h.input('provider-id', 'custom-api')
    expect(h.button('Get available models').disabled).toBe(false)
    expect(document.querySelector<HTMLSelectElement>('[aria-label="API protocol"]')!.value).toBe('openai-completions')
  })
  it('shows existing read-only credentials when adopting a dormant catalog provider', () => {
    const h = harness({ availableProviders: [{ id: 'openai', name: 'OpenAI', credential: { configured: true, writable: false } }] })
    h.click('Models'); h.click('Add model provider')
    const choose = document.querySelector<HTMLSelectElement>('select[aria-label="Choose provider"]')!; choose.value = 'openai'; choose.dispatchEvent(new Event('change'))
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.disabled).toBe(true)
    expect(document.body.textContent).toContain('Configured by a read-only source')
  })
  it('retains both add-provider mode drafts and clears them when the card is discarded', () => {
    const h = harness(); h.click('Models'); h.click('Add model provider')
    const switchMode = (mode: string) => { const select = document.querySelector<HTMLSelectElement>('select[aria-label="Provider source"]')!; select.value = mode; select.dispatchEvent(new Event('change')) }
    switchMode('custom'); h.input('provider-id', 'gateway'); h.input('provider-endpoint', 'https://gateway.example/v1'); h.input('api-key', 'fixture-key')
    switchMode('catalog'); switchMode('custom')
    expect(document.querySelector<HTMLInputElement>('[data-focus-key="provider-id"]')!.value).toBe('gateway')
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('fixture-key')
    h.click('Discard'); h.click('Add model provider'); switchMode('custom')
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
  })
  it('does not confuse an existing provider called new with the add-provider card', () => {
    const state = pageState(); state.providers.push({ ...state.providers[1]!, id: 'new', name: 'Existing New' })
    const h = harness(state); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="new"]')!.click()
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1)
    expect(document.querySelector('select[aria-label="Provider source"]')).toBeNull()
  })
  it('saves General resets immediately and leaves an explicit retry after a failure', () => {
    const state = pageState(); state.forms = state.forms.map(form => form.section === 'general' ? { ...form, fields: form.fields.map(field => ({ ...field, overridden: true, value: false })) } : form)
    const h = harness(state); h.click('Reset')
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-fields', changes: [{ ns: 'session-log-deepseek', revision: 1, values: { enabled: null } }] })
    h.result({ ok: false, error: 'Try again', results: [{ ns: 'session-log-deepseek', ok: false }] })
    expect(h.button('Save changes').disabled).toBe(false)
    h.click('Save changes'); expect(h.posts.filter(post => post.type === 'save-fields')).toHaveLength(2)
  })
  it('keeps API key drafts after a partial provider save and retries only the credential phase', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    h.input('provider-endpoint', 'https://changed.example/v1'); h.input('api-key', 'fixture-key'); h.click('Save changes')
    h.update({ providers: h.state().providers.map(row => row.id === 'anthropic' ? { ...row, revision: 2, baseURL: 'https://changed.example/v1' } : row) })
    h.result({ ok: false, settingsSaved: true, error: 'Credential source unavailable' })
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('fixture-key')
    h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ revision: 2, fields: {}, apiKey: 'fixture-key' })
  })
  it('keeps saved unavailable subagent routes removable and requires at least one when enabling', () => {
    const h = harness(); h.click('Subagents')
    expect(document.body.textContent).toContain('old / saved (saved, unavailable)')
    document.querySelector<HTMLInputElement>('input[data-focus-key="allow-model-selection"]')!.click()
    document.querySelector<HTMLInputElement>('.choices input')!.click()
    // The available row was added; removing the saved row leaves a valid explicit route.
    const saved = [...document.querySelectorAll<HTMLLabelElement>('.choices label')].find(row => row.textContent?.includes('old / saved'))!
    saved.querySelector<HTMLInputElement>('input')!.click(); h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-allowed-models', enabled: true, routes: [{ provider: 'anthropic', model: 'current' }] })
  })
  it('clears secrets and drafts when the runtime scope changes and ignores old replies', () => {
    const h = harness(); h.click('Models'); document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    h.input('api-key', 'fixture-key'); h.click('Save changes'); const old = h.posts.at(-1)!
    h.update({ scope: 'runtime-b' }); h.send({ type: 'result', requestId: old.requestId, ok: true })
    expect(document.body.textContent).not.toContain('Saved.')
    expect(document.querySelector('input[type="password"]')).toBeNull()
    document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
  })
  it('disables mutation controls for an external runtime while keeping native settings reachable', () => {
    const h = harness({ writable: false, reason: 'External runtime is attach-only.' }); h.click('Shell')
    expect(document.querySelector('fieldset')!.disabled).toBe(true)
    h.input('bash-sandbox:timeoutMs', '1234'); h.click('Save changes')
    expect(h.posts).toEqual([{ type: 'ready' }])
    h.click('General'); h.click('Keyboard shortcuts')
    expect(h.posts.at(-1)).toMatchObject({ type: 'native-action', action: 'shortcuts' })
  })

  it('renders optional bundles on the plugins page and sends a confirmed enable request', () => {
    const h = harness(bundlePageState()); h.click('Built-in plugins')
    expect(document.body.textContent).toContain('Experimental bundles')
    expect(document.body.textContent).toContain('Machine translation of reasoning')
    const toggle = document.querySelector<HTMLInputElement>('[data-focus-key="bundle:@deepseek-ai/dsh-experimental-cot-translation-bundle"]')!
    expect(toggle.checked).toBe(false); toggle.click()
    expect(h.posts.at(-1)).toMatchObject({ type: 'set-bundle', name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', enabled: true })
    h.result({ ok: true, application: 'restart-required', restartRequired: true })
    expect(document.body.textContent).toContain('Restart the DeepSeek Harness runtime')
  })
  it('hides bundle toggles on an attach-only runtime and explains why', () => {
    const state = bundlePageState(); state.writable = false; state.reason = 'This external runtime is attach-only. Its settings are available for inspection.'
    const h = harness(state); h.click('Built-in plugins')
    expect(document.querySelector('[data-focus-key^="bundle:"]')).toBeNull()
    expect(document.body.textContent).toContain('attach-only')
  })
  it('renders and saves the three experimental settings sections', () => {
    const h = harness(experimentalPageState()); h.click('Built-in plugins')
    h.click('Reasoning translation')
    expect(document.querySelector('select[data-focus-key="cot-translation:provider"]')).not.toBeNull()
    h.select('cot-translation:provider', 'google'); h.click('Save changes')
    expect(h.posts.at(-1)).toMatchObject({ type: 'save-fields', changes: [{ ns: 'cot-translation', revision: 1, values: { provider: 'google' } }] })
    h.result({ ok: true, results: [{ ns: 'cot-translation', ok: true }] })
    h.click('Voice input'); h.input('speech-to-text:defaultProvider', 'whisper-local'); h.input('speech-to-text:language', 'zh-CN'); h.click('Save changes')
    expect(h.posts.at(-1)!.changes[0]).toMatchObject({ ns: 'speech-to-text', values: { defaultProvider: 'whisper-local', language: 'zh-CN' } })
    h.result({ ok: true, results: [{ ns: 'speech-to-text', ok: true }] })
    h.click('Plugin market'); h.textarea('plugin-market:indexes', 'https://one.example/index.json\nhttps://two.example/index.json'); h.click('Save changes')
    expect(h.posts.at(-1)!.changes[0]).toMatchObject({ ns: 'plugin-market', values: { indexes: ['https://one.example/index.json', 'https://two.example/index.json'] } })
  })
})
