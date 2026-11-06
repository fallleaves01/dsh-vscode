// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mountSettingsPage } from '../src/settings-page.mjs'
import { settingsPageHtml } from '../src/settings-page-html.js'
import { bundlePageState, experimentalPageState, pageState, searchPageState, updatableBundlePageState } from './settings-page.fixture.js'
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
  it('repeats an operation failure in an alert toast above the scrolling body', () => {
    const state = pageState(); state.forms = state.forms.map(form => form.section === 'general' ? { ...form, fields: form.fields.map(field => ({ ...field, overridden: true, value: false })) } : form)
    const h = harness(state); h.click('Reset')
    h.result({ ok: false, error: 'Try again', results: [{ ns: 'session-log-deepseek', ok: false }] })
    const toast = document.querySelector<HTMLElement>('#settings-toast')!
    // The inline error still exists for context; the toast keeps it visible.
    expect(toast.hidden).toBe(false)
    expect(toast.getAttribute('role')).toBe('alert')
    expect(toast.className).toContain('error')
    expect(toast.textContent).toContain('Try again')
    document.querySelector<HTMLButtonElement>('#settings-toast-close')!.click()
    expect(toast.hidden).toBe(true)
    // A later render must not resurrect a dismissed message.
    h.update({})
    expect(toast.hidden).toBe(true)
  })
  it('confirms a successful save in a dismissible success toast', () => {
    const state = pageState(); state.forms = state.forms.map(form => form.section === 'general' ? { ...form, fields: form.fields.map(field => ({ ...field, overridden: true, value: false })) } : form)
    const h = harness(state); h.click('Reset')
    h.result({ ok: true, results: [{ ns: 'session-log-deepseek', ok: true }] })
    const toast = document.querySelector<HTMLElement>('#settings-toast')!
    expect(toast.hidden).toBe(false)
    expect(toast.className).toContain('success')
    expect(toast.textContent).toContain('Saved.')
    document.querySelector<HTMLButtonElement>('#settings-toast-close')!.click()
    expect(toast.hidden).toBe(true)
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
  it('offers the market and official install entries on the plugins page', () => {
    const h = harness(bundlePageState()); h.click('Built-in plugins')
    h.click('Discover plugins…')
    expect(h.posts.at(-1)).toMatchObject({ type: 'native-action', action: 'discover-plugins' })
    h.click('Install official plugin…')
    expect(h.posts.at(-1)).toMatchObject({ type: 'native-action', action: 'install-official-plugin' })
    expect(document.body.textContent).toContain('shared DSH web profile')
  })
  it('keeps the install entries visible on a read-only runtime so the command can explain ownership', () => {
    const h = harness({ ...bundlePageState(), writable: false });
    h.click('Built-in plugins')
    expect(h.button('Discover plugins…').disabled).toBe(false)
    h.click('Discover plugins…')
    expect(h.posts.at(-1)).toMatchObject({ type: 'native-action', action: 'discover-plugins' })
  })
  it('keeps switches for bundles the Host does not list by default', () => {
    const state = bundlePageState()
    state.bundles = [...state.bundles,
      { name: '@deepseek-ai/dsh-ralph-bundle', official: true, availability: 'installation', version: '0.2.2-alpha.2', title: 'Ralph loop', enabled: false, installed: true, optional: true, removable: false, listedByDefault: false, updatable: false },
      { name: '@deepseek-ai/dsh-experimental-liveshare-bundle', official: true, availability: 'installation', version: '0.2.2-alpha.2', title: 'Live share', enabled: false, installed: true, optional: true, removable: false, listedByDefault: false, updatable: false },
      { name: '@deepseek-ai/dsh-bundle-session-search', official: true, availability: 'installation', version: '0.2.2-alpha.2', title: 'Session search', enabled: false, installed: true, optional: true, removable: false, listedByDefault: false, updatable: false },
      { name: '@deepseek-ai/dsh-cua-bundle', official: true, availability: 'installation', version: '0.2.2-alpha.2', title: 'Computer use', enabled: false, installed: true, optional: true, removable: false, listedByDefault: false, updatable: false, errorCode: 'unsupported-platform' },
      { name: '@deepseek-ai/dsh-subagent-codex', official: true, availability: 'missing', version: '0.2.2-alpha.2', title: 'Codex subagent', enabled: false, installed: false, optional: true, removable: false, updatable: false },
      { name: '@deepseek-ai/dsh-hidden-enabled', official: true, availability: 'installation', title: 'Hidden but on', enabled: true, installed: true, optional: true, removable: false, listedByDefault: false, updatable: false },
    ]
    const h = harness(state); h.click('Built-in plugins')
    // setBundleEnabled accepts hidden-from-DSH bundles; this page is their switch.
    for (const name of ['ralph-bundle', 'experimental-liveshare-bundle', 'bundle-session-search', 'cua-bundle']) {
      const toggle = document.querySelector<HTMLInputElement>(`[data-focus-key="bundle:@deepseek-ai/dsh-${name}"]`)
      expect(toggle, name).not.toBeNull()
    }
    // Only an on-demand bundle that is not installed has no switch.
    expect(document.querySelector('[data-focus-key="bundle:@deepseek-ai/dsh-subagent-codex"]')).toBeNull()
    expect(document.body.textContent).toContain('Not listed by default')
    // A hidden bundle that is already on keeps its switch so it can be turned off.
    expect(document.querySelector<HTMLInputElement>('[data-focus-key="bundle:@deepseek-ai/dsh-hidden-enabled"]')!.checked).toBe(true)
    // The platform limitation stays visible; its failure is reported by the change result.
    expect(document.body.textContent).toContain('Unsupported on this platform')
    // No dead-end pointer to the DSH plugin manager for a bundle this page can switch.
    expect(document.body.textContent).not.toContain('Enable it from the DSH plugin manager')
  })
  it('offers the update path only for installed updatable bundles and never a stale verified version', () => {
    const state = bundlePageState()
    state.bundles = [...state.bundles,
      { name: '@acme/dsh-updatable-bundle', official: false, availability: 'profile', version: '0.2.2-alpha.2', title: 'Update-capable', enabled: true, installed: true, optional: false, removable: false, listedByDefault: true, updatable: true },
      { name: '@acme/dsh-uninstalled-bundle', official: false, availability: 'profile', version: '0.2.2-alpha.2', title: 'Not-installed update candidate', enabled: false, installed: false, optional: false, removable: false, listedByDefault: true, updatable: true },
      { name: '@acme/dsh-static-bundle', official: false, availability: 'profile', version: '0.2.2-alpha.2', title: 'Not-updatable third-party', enabled: true, installed: true, optional: false, removable: false, listedByDefault: true, updatable: false },
    ]
    const h = harness(state); h.click('Built-in plugins')
    const text = document.body.textContent!
    expect(text).toContain('Optional runtime capabilities shipped with DSH')
    expect(text).not.toContain('0.2.1-rc.3')
    // The dedicated block replaces the obsolete unverified pointer: only a
    // bundle that is both installed and updatable gets the real update entry.
    expect(text).toContain('Third-party bundles')
    expect(text).toContain('Update-capable')
    expect(text).toContain('Check for updates')
    expect(text).not.toContain('Not-installed update candidate')
    expect(text).not.toContain('Not-updatable third-party')
  })
  it('hides bundle toggles on an attach-only runtime and explains why', () => {
    const state = bundlePageState(); state.writable = false; state.reason = 'This external runtime is attach-only. Its settings are available for inspection.'
    const h = harness(state); h.click('Built-in plugins')
    expect(document.querySelector('[data-focus-key^="bundle:"]')).toBeNull()
    expect(document.body.textContent).toContain('attach-only')
  })
  it('lists only installed third-party bundles and places the update block after the experimental bundles', () => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins')
    const text = document.body.textContent!
    expect(text).toContain('Acme Notes')
    expect(text).not.toContain('Legacy third-party plugin')
    expect(text).not.toContain('Queued third-party plugin')
    expect(document.body.textContent).toContain('v0.3.0')
    expect(h.button('Check for updates').disabled).toBe(false)
  })
  it('places the third-party update block after the experimental bundles', () => {
    const combined = bundlePageState()
    combined.bundles = [...combined.bundles!, ...updatableBundlePageState().bundles!]
    const h = harness(combined); h.click('Built-in plugins')
    const text = document.body.textContent!
    expect(text).toContain('Experimental bundles')
    expect(text.indexOf('Experimental bundles')).toBeLessThan(text.indexOf('Third-party bundles'))
  })
  it('checks a third-party bundle and renders every listed version fact as text', () => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins')
    h.click('Check for updates')
    expect(h.posts.at(-1)).toMatchObject({ type: 'check-bundle-versions', name: '@acme/dsh-notes-bundle', scope: 'runtime-a' })
    expect(h.button('Checking for updates…').disabled).toBe(true)
    h.result({ ok: true, installed: '0.3.0', omitted: 2, versions: [
      { version: '0.4.0', publishedAt: '2026-02-01T00:00:00.000Z', prerelease: false, bundle: true },
      { version: '0.5.0-rc.1', publishedAt: '2026-03-01T00:00:00Z', prerelease: true, deprecated: 'Use 0.5.0', bundle: true,
        incompatible: { name: '@acme/dsh-notes-bundle', version: '0.5.0-rc.1', runtimeVersion: '0.2.1', requirements: { 'engines.dsh': '>=0.3.0' } } },
      { version: '<img src=x onerror=bad()>', prerelease: false, bundle: true },
    ] })
    const text = document.body.textContent!
    for (const expected of ['0.4.0', '2026-02-01', '0.5.0-rc.1', 'Prerelease', 'Deprecated', 'Incompatible', '2 more versions are not shown.']) {
      expect(text).toContain(expected)
    }
    // The single-object contract is rendered as one marker naming the runtime it needs.
    const incompatible = [...document.querySelectorAll<HTMLElement>('.bundle-version span')].find(marker => marker.title.startsWith('@acme/dsh-notes-bundle@0.5.0-rc.1'))
    expect(incompatible?.title).toBe('@acme/dsh-notes-bundle@0.5.0-rc.1 requires runtime 0.2.1')
    // Version rows are text, never parsed markup.
    expect(document.querySelector('.choices img')).toBeNull()
    expect(text).toContain('<img src=x onerror=bad()>')
    // Every update control keeps a hover and accessible name.
    for (const control of [...document.querySelectorAll<HTMLButtonElement>('.bundle-version')]) {
      expect(control.title).toContain('Update to version ')
      expect(control.getAttribute('aria-label')).toBe(control.title)
    }
    const row = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === 'Update to version 0.4.0')
    expect(row).toBeDefined(); row!.click()
    expect(h.posts.at(-1)).toMatchObject({ type: 'update-bundle', name: '@acme/dsh-notes-bundle', version: '0.4.0' })
    expect(document.body.textContent).toContain('Updating to 0.4.0…')
    expect(h.button('Check for updates').disabled).toBe(true)
  })
  it('reports a refused version check in the bundle card', () => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins')
    h.click('Check for updates')
    h.result({ ok: false, error: 'The plugin registry could not be reached. Check the network connection and try again.' })
    expect(document.body.textContent).toContain('plugin registry could not be reached')
    expect(h.button('Check for updates').disabled).toBe(false)
  })
  it.each([
    [{ ok: true, outcome: 'updated', step: 'install', from: '0.3.0', to: '0.4.0' }, 'Updated 0.3.0 → 0.4.0.'],
    [{ ok: true, outcome: 'restart-required', step: 'install', from: '0.3.0', to: '0.4.0' }, 'Restart the DeepSeek Harness runtime to apply the change.'],
    [{ ok: false, outcome: 'restored', step: 'install', from: '0.3.0', to: '0.4.0', restoreApplication: 'applied', error: 'The runtime could not change this bundle.' }, 'previous version 0.3.0 was reinstalled'],
    [{ ok: false, outcome: 'unrestored', step: 'install', from: '0.3.0', to: '0.4.0', error: 'The runtime could not change this bundle.' }, 'could not be restored'],
  ])('renders update outcome %# inside the bundle card', (result, expected) => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: true }], omitted: 0 })
    document.querySelector<HTMLButtonElement>('[aria-label="Update to version 0.4.0"]')!.click()
    h.result(result)
    expect(document.body.textContent).toContain(expected)
  })
  it.each([
    ['no-hmr', 'This runtime has hot module replacement disabled'],
    ['package-moved', 'resolves to another directory'],
    ['host-module', 'modules the runtime itself loaded'],
    ['unmanaged-plugin', 'running outside the plugin list'],
    ['module-comparison', 'could not compare the loaded plugins'],
  ])('explains restart reason %s from the closed runtime set', (restartReason, expected) => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: true }], omitted: 0 })
    document.querySelector<HTMLButtonElement>('[aria-label="Update to version 0.4.0"]')!.click()
    h.result({ ok: true, outcome: 'restart-required', step: 'install', from: '0.3.0', to: '0.4.0', restartReason })
    const text = document.body.textContent!
    expect(text).toContain('Restart the DeepSeek Harness runtime to apply the change.')
    expect(text).toContain(expected)
  })
  it.each(['invented-reason', '<img src=x onerror=bad()>'])('falls back to the generic restart sentence for reason %s', restartReason => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: true }], omitted: 0 })
    document.querySelector<HTMLButtonElement>('[aria-label="Update to version 0.4.0"]')!.click()
    h.result({ ok: true, outcome: 'restart-required', step: 'install', from: '0.3.0', to: '0.4.0', restartReason })
    const text = document.body.textContent!
    expect(text).toContain('Restart the DeepSeek Harness runtime to apply the change.')
    expect(text).not.toContain(restartReason)
    expect(document.querySelector('.bundle-card img')).toBeNull()
  })
  it.each(['check', 'remove', 'install'])('uses a neutral unchanged sentence when the %s target has no version', step => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: true }], omitted: 0 })
    document.querySelector<HTMLButtonElement>('[aria-label="Update to version 0.4.0"]')!.click()
    h.result({ ok: false, outcome: 'unchanged', step, from: '', to: '0.4.0', error: 'The runtime refused the bundle change (invalid-spec).' })
    const text = document.body.textContent!
    expect(text).toContain('the installed bundle is unchanged')
    expect(text).not.toContain('remains installed')
    expect(text).not.toContain('was not removed')
    expect(text).not.toContain('could not be restored')
  })
  it('clears the previous update result when a new version check succeeds', () => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: true }], omitted: 0 })
    document.querySelector<HTMLButtonElement>('[aria-label="Update to version 0.4.0"]')!.click()
    h.result({ ok: false, outcome: 'restored', step: 'install', from: '0.3.0', to: '0.4.0', restoreApplication: 'applied', error: 'The runtime could not change this bundle.' })
    expect(document.body.textContent).toContain('was reinstalled')
    h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.5.0', prerelease: false, bundle: true }], omitted: 0 })
    const text = document.body.textContent!
    expect(text).not.toContain('was reinstalled')
    expect(text).toContain('0.5.0')
  })
  it.each([
    ['check', 'This bundle is not compatible with the running DSH version.', 'was not accepted'],
    ['remove', 'The runtime could not change this bundle.', 'did not start'],
    ['install', 'The runtime could not change this bundle.', 'remains installed'],
  ])('does not claim a failed restore for a %s step that left the bundle unchanged', (step, error, expected) => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: true }], omitted: 0 })
    document.querySelector<HTMLButtonElement>('[aria-label="Update to version 0.4.0"]')!.click()
    h.result({ ok: false, outcome: 'unchanged', step, from: step === 'check' && error.includes('not compatible') ? '' : '0.3.0', to: '0.4.0', error })
    const text = document.body.textContent!
    expect(text).toContain(expected)
    expect(text).toContain(error)
    expect(text).not.toContain('could not be restored')
    expect(text).not.toContain('was reinstalled')
  })
  it('disables a listed version that declares no bundle and explains why', () => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: false }], omitted: 0 })
    const row = [...document.querySelectorAll<HTMLButtonElement>('.bundle-version')].find(item => item.textContent?.includes('0.4.0'))!
    expect(row.disabled).toBe(true)
    expect(row.title).toBe('Version 0.4.0 does not declare a plugin bundle, so it cannot replace this bundle.')
    expect(row.getAttribute('aria-label')).toBe(row.title)
    row.click()
    expect(h.posts.some(post => post.type === 'update-bundle')).toBe(false)
  })
  it('leaves no result behind when the update confirmation is dismissed', () => {
    const h = harness(updatableBundlePageState()); h.click('Built-in plugins'); h.click('Check for updates')
    h.result({ ok: true, installed: '0.3.0', versions: [{ version: '0.4.0', prerelease: false, bundle: true }], omitted: 0 })
    document.querySelector<HTMLButtonElement>('[aria-label="Update to version 0.4.0"]')!.click()
    h.result({ ok: false, cancelled: true })
    const text = document.body.textContent!
    expect(text).not.toContain('was reinstalled')
    expect(text).not.toContain('Updated 0.3.0')
    expect(h.button('Check for updates').disabled).toBe(false)
  })
  it('disables the third-party update controls on a read-only runtime', () => {
    const h = harness({ ...updatableBundlePageState(), writable: false, reason: 'This external runtime is attach-only. Its settings are available for inspection.' })
    h.click('Built-in plugins')
    expect(document.body.textContent).toContain('Third-party bundles')
    expect(document.body.textContent).toContain('attach-only')
    expect(h.button('Check for updates').disabled).toBe(true)
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
  function generalWithReset() {
    const state = pageState()
    state.forms = state.forms.map(form => form.section === 'general' ? { ...form, fields: form.fields.map(field => ({ ...field, overridden: true, value: false })) } : form)
    return state
  }
  it('shows the same failure again when a retry produces it again', () => {
    const h = harness(generalWithReset()); h.click('Reset')
    const toast = () => document.querySelector<HTMLElement>('#settings-toast')!
    h.result({ ok: false, error: 'Try again', results: [{ ns: 'session-log-deepseek', ok: false }] })
    expect(toast().hidden).toBe(false)
    document.querySelector<HTMLButtonElement>('#settings-toast-close')!.click()
    expect(toast().hidden).toBe(true)
    // A new attempt with the same outcome is new information, not a repeat.
    h.click('Save changes')
    h.result({ ok: false, error: 'Try again', results: [{ ns: 'session-log-deepseek', ok: false }] })
    expect(toast().hidden).toBe(false)
    expect(toast().textContent).toContain('Try again')
  })
  it('does not replay an already seen failure after switching sections', () => {
    const h = harness(generalWithReset()); h.click('Reset')
    const toast = () => document.querySelector<HTMLElement>('#settings-toast')!
    h.result({ ok: false, error: 'Try again', results: [{ ns: 'session-log-deepseek', ok: false }] })
    expect(toast().hidden).toBe(false)
    h.click('Models'); expect(toast().hidden).toBe(true)
    h.click('General'); expect(toast().hidden).toBe(true)
  })
  it('shows the requested bundle state while the change is pending', () => {
    const h = harness(bundlePageState()); h.click('Built-in plugins')
    const toggle = document.querySelector<HTMLInputElement>('[data-focus-key="bundle:@deepseek-ai/dsh-experimental-cot-translation-bundle"]')!
    expect(toggle.checked).toBe(false); toggle.click()
    const pending = document.querySelector<HTMLInputElement>('[data-focus-key="bundle:@deepseek-ai/dsh-experimental-cot-translation-bundle"]')!
    expect(pending.checked).toBe(true)
    expect(document.body.textContent).toContain('Applying…')
    h.result({ ok: true, application: 'restart-required', restartRequired: true })
    expect(document.body.textContent).toContain('Restart the DeepSeek Harness runtime')
  })
})

describe('settings page document hardening', () => {
  it('closes base/form navigation and escapes the script URI', () => {
    const html = settingsPageHtml({ cspSource: 'vscode-webview:' } as any,
      { toString: () => 'settings-page.js" onload="alert(1)\'<&>' } as any)
    expect(html).toContain("base-uri 'none';")
    expect(html).toContain("form-action 'none';")
    expect(html).toContain('settings-page.js&quot; onload=&quot;alert(1)&#39;&lt;&amp;&gt;')
    expect(html).not.toContain('onload="alert(1)')
    // The nonce stays cryptographic and shared by the document's script tag.
    expect(html).toMatch(/script-src 'nonce-[0-9a-f]{32}';/)
  })
})

describe('settings button hover and accessible names', () => {
  const unnamed = (): string[] => [...document.querySelectorAll<HTMLButtonElement>('button')].flatMap(button => {
    const title = (button.title || '').trim(), label = (button.getAttribute('aria-label') || '').trim()
    return title !== '' && label !== '' ? [] : [`${button.className} text=${JSON.stringify(button.textContent?.slice(0, 40))}`]
  })

  it('names every button on the general, plugins and provider pages', () => {
    const h = harness()
    expect(unnamed()).toEqual([])
    h.click('Built-in plugins')
    expect(unnamed()).toEqual([])
    expect(document.querySelector<HTMLButtonElement>('[data-section="inventory"]')?.title).toBe('Plugins')
    h.click('Models')
    expect(unnamed()).toEqual([])
    document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!.click()
    expect(unnamed()).toEqual([])
  })

  it('names every button on the search, bundle and read-only pages', () => {
    const search = harness(searchPageState())
    expect(unnamed()).toEqual([])
    search.click('Web search')
    expect(unnamed()).toEqual([])
    search.update({ writable: false })
    expect(unnamed()).toEqual([])

    const bundles = harness(bundlePageState())
    bundles.click('Built-in plugins')
    expect(unnamed()).toEqual([])
    for (const tab of [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]) tab.click()
    expect(unnamed()).toEqual([])
  })

  it('keeps the reveal, provider and reasoning controls in sync with their state', () => {
    const h = harness(); h.click('Models')
    const row = document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!
    expect(row.title).toBe('Show settings for Anthropic')
    expect(row.getAttribute('aria-label')).toBe(row.title)
    row.click()
    const expanded = document.querySelector<HTMLButtonElement>('[data-provider="anthropic"]')!
    expect(expanded.getAttribute('aria-expanded')).toBe('true')
    expect(expanded.title).toBe('Hide settings for Anthropic')
    expect(expanded.getAttribute('aria-label')).toBe(expanded.title)

    const reveal = document.querySelector<HTMLButtonElement>('[aria-label="Show API key"]')!
    expect(reveal.title).toBe('Show API key')
    reveal.click()
    expect(reveal.title).toBe('Hide API key')
    expect(reveal.getAttribute('aria-label')).toBe('Hide API key')
    expect(reveal.getAttribute('aria-pressed')).toBe('true')
    reveal.click()
    expect(reveal.title).toBe('Show API key')
    expect(reveal.getAttribute('aria-label')).toBe('Show API key')

    document.querySelector<HTMLInputElement>('[data-focus-key="reasoning:0:enabled"]')!.click()
    const levels = [...document.querySelectorAll<HTMLButtonElement>('.reasoning-row button')]
    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(level.title).toMatch(/^Delete level /)
      expect(level.getAttribute('aria-label')).toBe(level.title)
    }
  })
})
