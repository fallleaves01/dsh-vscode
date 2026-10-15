import type { ModelDraft, ProviderView, SettingsFieldView, SettingsFormView, SettingsPageState, DiscoveredModel } from './settings-page-state.js'

interface Api { postMessage(value: unknown): void }
declare function acquireVsCodeApi(): Api
interface FieldsDraft { revision: number; values: Record<string, unknown> }
interface EditableModel { id: string; originalId?: string; name: string; context: string; output: string; input?: string[] }
interface ProviderDraft {
  id: string; revision: number; ns: string; creating: boolean; custom: boolean
  baseURL: string; api: string; displayName: string; apiKey: string
  models: EditableModel[]; inheritModels: boolean; touched: Set<string>
}
type Message = Record<string, unknown>

/** Settings drafts live only in this Webview's memory. Secrets are never persisted. */
export function mountSettingsPage(document: Document, api: Api): { dispose(): void } {
  const content = document.getElementById('content')!, navigation = document.getElementById('navigation')!
  const banner = document.getElementById('banner')!, refresh = document.getElementById('refresh') as HTMLButtonElement
  const NEW_PROVIDER = Symbol('new-provider'), CATALOG_DRAFT = Symbol('catalog-draft'), CUSTOM_DRAFT = Symbol('custom-draft')
  let state: SettingsPageState | undefined, section = 'general', selectedProvider: string | typeof NEW_PROVIDER | undefined, serial = 0
  const fields = new Map<string, FieldsDraft>(), providerDrafts = new Map<string | symbol, ProviderDraft>(), errors = new Map<string, string>()
  let searchKey = '', searchKeyRevision: number | undefined
  let allowed: { revision: number; enabled: boolean; routes: { provider: string; model: string }[]; reset?: boolean } | undefined
  let pending: { id: string; scope: string; type: string; provider?: string; section: string } | undefined
  let queue: Message[] = [], candidates: DiscoveredModel[] = [], selectedModels = new Set<string>(), modelSearch = '', allowSearch = ''
  let message = ''
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag); element.className = className; if (text) element.textContent = text; return element
  }
  const locked = (): boolean => !!pending || !state?.writable
  const button = (label: string, action: () => void, className = '', disabled = false): HTMLButtonElement => {
    const control = el('button', className, label); control.type = 'button'; control.disabled = disabled
    control.addEventListener('click', () => { if (!control.disabled) action() }); return control
  }
  const input = (value: string, key: string, update: (value: string) => void, type = 'text'): HTMLInputElement => {
    const control = el('input'); control.type = type; control.value = value; control.dataset.focusKey = key
    control.autocomplete = type === 'password' ? 'new-password' : 'off'
    control.addEventListener('input', () => { update(control.value); updateSaveButtons() }); return control
  }
  const check = (label: string, checked: boolean, update: (value: boolean) => void, key = ''): HTMLLabelElement => {
    const row = el('label', 'check'), control = el('input'); control.type = 'checkbox'; control.checked = checked; control.dataset.focusKey = key
    control.addEventListener('change', () => { update(control.checked); updateSaveButtons() }); row.append(control, el('span', 'choice-label', label)); return row
  }
  const native = (action: string): void => api.postMessage({ type: 'native-action', action, scope: state?.scope })
  const formDraft = (form: SettingsFormView): FieldsDraft => {
    let draft = fields.get(form.ns)
    if (!draft) { draft = { revision: form.revision, values: {} }; fields.set(form.ns, draft) }
    return draft
  }
  const activeForms = (): SettingsFormView[] => state?.forms.filter(form => form.section === section) ?? []
  const conflict = (revision: number, latest: number): boolean => !pending && revision !== latest
  const start = (body: Message): void => {
    if (!state || pending) return
    const id = 'settings-' + (++serial)
    pending = { id, scope: state.scope, type: String(body.type), section, ...(typeof body.provider === 'string' ? { provider: body.provider } : {}) }
    message = ''; api.postMessage({ ...body, requestId: id, scope: state.scope }); render()
  }
  const next = (): void => { const body = queue.shift(); if (body) start(body) }
  const positive = (value: string, label: string): number | undefined => {
    if (!value.trim()) return undefined
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`)
    return number
  }
  const editable = (model: ModelDraft): EditableModel => ({ id: model.id, ...(model.originalId ? { originalId: model.originalId } : {}), name: model.name ?? '',
    context: model.contextWindow === undefined ? '' : String(model.contextWindow), output: model.maxTokens === undefined ? '' : String(model.maxTokens), ...(model.input ? { input: [...model.input] } : {}) })
  const newDraft = (): ProviderDraft => ({ id: '', revision: state?.piRevision ?? 0, ns: 'llm-pi-ai', creating: true, custom: false, baseURL: '', api: '', displayName: '', apiKey: '', models: [], inheritModels: true, touched: new Set() })
  const getProviderDraft = (): ProviderDraft | undefined => {
    if (!selectedProvider || !state) return
    let draft = providerDrafts.get(selectedProvider)
    if (!draft) {
      const provider = state.providers.find(item => item.id === selectedProvider)
      if (!provider) return
      draft = { id: provider.id, ns: provider.ns, revision: provider.revision, creating: false, custom: provider.declared,
        baseURL: provider.baseURL, api: provider.api, displayName: provider.name, apiKey: '', models: provider.models.map(editable), inheritModels: false, touched: new Set() }
      providerDrafts.set(selectedProvider, draft)
    }
    return draft
  }
  const dirtyProvider = (): boolean => {
    const draft = getProviderDraft(); return !!draft && (draft.creating || draft.touched.size > 0 || !!draft.apiKey.trim())
  }
  const dirtySection = (): boolean => activeForms().some(form => Object.keys(fields.get(form.ns)?.values ?? {}).length > 0)
    || (section === 'search' && !!searchKey.trim()) || (section === 'subagents' && !!allowed)
  function updateSaveButtons(): void {
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-save]')) {
      const dirty = control.dataset.save === 'provider' ? dirtyProvider() : dirtySection()
      control.disabled = locked() || !dirty || control.dataset.conflicted === 'true'
    }
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-discover]')) control.disabled = locked() || !getProviderDraft()?.id
  }
  const parsedFields = (form: SettingsFormView, values: Record<string, unknown>): Record<string, unknown> => {
    return Object.fromEntries(Object.entries(values).map(([key, raw]) => {
      const field = form.fields.find(item => item.key === key)!
      if (raw === null || raw === '') return [key, null]
      if (field.type !== 'number') return [key, raw]
      const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw)
      if (!Number.isFinite(value) || (field.integer && !Number.isSafeInteger(value))) throw new Error(`${field.label}: enter a valid ${field.integer ? 'integer' : 'number'}.`)
      if (field.min !== undefined && value < field.min) throw new Error(`${field.label}: minimum ${field.min}.`)
      if (field.max !== undefined && value > field.max) throw new Error(`${field.label}: maximum ${field.max}.`)
      return [key, value]
    }))
  }
  const saveSection = (): void => {
    if (!state || locked()) return
    try {
      const changes = activeForms().flatMap(form => {
        const draft = fields.get(form.ns)
        if (!draft && !(section === 'search' && searchKey)) return []
        if (draft && draft.revision !== form.revision) throw new Error('These settings changed elsewhere. Discard the draft first.')
        return [{ ns: form.ns, revision: draft?.revision ?? searchKeyRevision ?? form.revision, values: parsedFields(form, draft?.values ?? {}) }]
      })
      queue = []
      if (changes.length) queue.push({ type: 'save-fields', changes, ...(section === 'search' && searchKey ? { apiKey: searchKey } : {}) })
      if (section === 'subagents' && allowed) {
        if (allowed.revision !== state.allowedModels?.revision) throw new Error('The allowed models changed elsewhere. Discard the draft first.')
        if (allowed.enabled && !allowed.routes.length && !allowed.reset) throw new Error('Select at least one model before enabling subagent model selection.')
        queue.push({ type: 'save-allowed-models', ...allowed })
      }
      next()
    } catch (cause) { queue = []; errors.set(section, String((cause as Error).message)); render() }
  }
  const discardSection = (): void => {
    activeForms().forEach(form => fields.delete(form.ns)); if (section === 'search') { searchKey = ''; searchKeyRevision = undefined }
    if (section === 'subagents') allowed = undefined
    errors.delete(section); message = ''; render()
  }
  const fieldControl = (form: SettingsFormView, field: SettingsFieldView): HTMLElement => {
    const row = el('div', 'field'), copy = el('div', 'field-copy'), draft = fields.get(form.ns)
    const touched = !!draft && Object.hasOwn(draft.values, field.key)
    const value = touched ? draft.values[field.key] : field.value
    copy.append(el('span', 'field-name', field.label), el('span', 'hint', touched && value === null ? 'Use inherited value on save' : touched || field.overridden ? 'Customized' : 'Inherited'))
    if (field.description) copy.append(el('span', 'hint', field.description))
    row.append(copy)
    if (field.type === 'boolean') row.append(check('Enabled', (value === null ? field.inherited : value) === true, checked => {
      formDraft(form).values[field.key] = checked
      if (form.section === 'general') saveSection()
    }, form.ns + ':' + field.key))
    else {
      const control = input(value === undefined || value === null ? '' : String(value), form.ns + ':' + field.key, raw => { formDraft(form).values[field.key] = raw })
      control.setAttribute('aria-label', field.label)
      if (field.type === 'number') control.inputMode = field.integer ? 'numeric' : 'decimal'
      if (field.inherited !== undefined) control.placeholder = 'Default: ' + String(field.inherited)
      row.append(control)
    }
    row.append(button('Reset', () => { formDraft(form).values[field.key] = null; if (form.section === 'general') saveSection(); else render() }, 'quiet', locked() || (!touched && !field.overridden)))
    return row
  }
  const keyControl = (value: string, update: (value: string) => void, capability: { configured: boolean; writable: boolean } | undefined, extensionKey: boolean, clear: () => void): HTMLElement => {
    const box = el('div'), row = el('div', 'field'), copy = el('div', 'field-copy')
    copy.append(el('span', 'field-name', 'API key'), el('span', 'hint', !capability ? 'Credential status unavailable' : capability.configured ? capability.writable ? 'Configured; leave blank to keep it' : 'Configured by a read-only source' : 'Not configured; optional for native provider authentication'))
    const control = input(value, 'api-key', update, 'password'); control.setAttribute('aria-label', 'API key'); control.disabled = locked() || capability?.writable === false || !capability
    row.append(copy, control, button('Clear key', clear, 'quiet danger', locked() || !capability?.writable || !capability.configured)); box.append(row)
    if (extensionKey) box.append(button('Configure extension API key…', () => native('extension-key'), 'quiet', locked()))
    return box
  }
  const footer = (provider = false, stale = false): HTMLElement => {
    const box = el('div', 'actions section-save')
    box.append(el('span', 'hint', pending ? 'Saving…' : stale ? 'Changed elsewhere. Discard to reload.' : 'Changes apply when saved.'))
    const save = button('Save changes', provider ? saveProvider : saveSection, 'primary'); save.dataset.save = provider ? 'provider' : 'section'; save.dataset.conflicted = String(stale)
    box.append(button('Discard', provider ? () => { if (selectedProvider) providerDrafts.delete(selectedProvider); if (selectedProvider === NEW_PROVIDER) { providerDrafts.delete(CATALOG_DRAFT); providerDrafts.delete(CUSTOM_DRAFT); selectedProvider = undefined } candidates = []; errors.delete('models'); render() } : discardSection, '', !!pending), save)
    return box
  }
  const renderFields = (): void => {
    for (const form of activeForms()) {
      const card = el('section', 'card'); card.append(el('h3', '', form.title))
      if (form.ns === 'session-log-deepseek') card.append(el('p', 'hint', 'Controls session metadata uploaded alongside official DeepSeek model requests.'))
      if (form.restart) card.append(el('p', 'notice', 'A runtime restart is required after saving. Active tasks are protected.'))
      const fieldset = el('fieldset'); fieldset.disabled = locked()
      for (const field of form.fields) fieldset.append(fieldControl(form, field))
      if (form.section === 'search') fieldset.append(keyControl(searchKey, value => { searchKey = value; searchKeyRevision ??= form.revision; formDraft(form) }, state?.searchCredential, state?.searchExtensionKey === true,
        () => start({ type: 'clear-key', provider: 'web-search', revision: form.revision })))
      card.append(fieldset)
      if (fields.get(form.ns)?.revision !== undefined && conflict(fields.get(form.ns)!.revision, form.revision)) card.append(el('p', 'error', 'These values changed elsewhere. Your draft is retained.'))
      content.append(card)
    }
  }
  const renderAllowed = (): void => {
    const view = state?.allowedModels
    if (!view) return
    const card = el('section', 'card'), fieldset = el('fieldset'); fieldset.disabled = locked()
    card.append(el('h3', '', 'Subagent model selection'), el('p', 'hint', 'Allow agents to choose from these exact provider/model routes. Turning this off keeps the saved choices.'))
    const draft = (): NonNullable<typeof allowed> => allowed ??= { revision: view.revision, enabled: view.enabled, routes: view.routes.map(route => ({ ...route })) }
    fieldset.append(check('Allow model selection', allowed?.enabled ?? view.enabled, value => { draft().enabled = value; allowed!.reset = false; render() }, 'allow-model-selection'))
    const query = input(allowSearch, 'allowed-model-search', value => { allowSearch = value; render() }); query.placeholder = 'Search models'; query.setAttribute('aria-label', 'Search subagent models'); fieldset.append(query)
    const chosen = allowed?.routes ?? view.routes
    const choices = new Map((state?.catalog ?? []).map(route => [JSON.stringify([route.provider, route.model]), { ...route, available: true }]))
    for (const route of view.routes) if (!choices.has(JSON.stringify([route.provider, route.model]))) choices.set(JSON.stringify([route.provider, route.model]), { ...route, label: `${route.provider} / ${route.model} (saved, unavailable)`, available: false })
    const list = el('div', 'choices')
    const filtered = [...choices.values()].filter(route => (route.label + ' ' + route.model).toLowerCase().includes(allowSearch.toLowerCase()))
    for (const route of filtered.slice(0, 300)) {
      const selected = chosen.some(item => item.provider === route.provider && item.model === route.model)
      const row = check(route.label, selected, value => {
        const next = draft(); next.reset = false; next.routes = next.routes.filter(item => item.provider !== route.provider || item.model !== route.model)
        if (value) next.routes.push({ provider: route.provider, model: route.model })
      }, 'allow:' + JSON.stringify([route.provider, route.model]))
      row.title = route.label; list.append(row)
    }
    if (!filtered.length) list.append(el('p', 'hint', 'No matching model routes. Previously saved routes remain available above.'))
    if (filtered.length > 300) list.append(el('p', 'hint', 'Showing 300 matches. Refine the search.'))
    fieldset.append(list, button('Restore defaults', () => { allowed = { revision: view.revision, enabled: false, routes: [], reset: true }; render() }, 'quiet', locked() || (!view.overridden && !allowed)))
    card.append(fieldset); if (allowed && conflict(allowed.revision, view.revision)) card.append(el('p', 'error', 'The allowed models changed elsewhere. Discard this draft before saving.'))
    content.append(card)
  }
  const saveProvider = (): void => {
    const draft = getProviderDraft(); if (!draft || locked()) return
    try {
      const changes: Record<string, unknown> = {}
      for (const key of draft.touched) {
        if (key === 'models') changes.models = draft.inheritModels ? null : draft.models.map(model => ({ id: model.id, ...(model.originalId ? { originalId: model.originalId } : {}),
          ...(model.name ? { name: model.name } : {}), ...(model.context ? { contextWindow: positive(model.context, 'Context window') } : {}),
          ...(model.output ? { maxTokens: positive(model.output, 'Output limit') } : {}), ...(model.input ? { input: model.input } : {}) }))
        else if (key === 'baseURL' || key === 'api' || key === 'displayName') changes[key] = draft[key] || null
      }
      start({ type: draft.creating ? 'create-provider' : 'save-provider', provider: draft.id, revision: draft.revision, fields: changes, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) })
    } catch (cause) { errors.set('models', (cause as Error).message); render() }
  }
  const providerField = (label: string, value: string, key: string, update: (value: string) => void): HTMLElement => {
    const row = el('div', 'field'); row.append(el('span', 'field-name', label), input(value, key, update)); return row
  }
  const renderModelRows = (draft: ProviderDraft): HTMLElement => {
    const box = el('section'); box.append(el('h3', '', 'Model options'), el('p', 'hint', draft.inheritModels ? 'Uses the provider catalog. Adding or editing models creates an explicit list.' : 'Only the fields shown here are edited; other existing model properties are retained.'))
    draft.models.forEach((model, index) => {
      const row = el('div', 'model'), grid = el('div', 'model-grid')
      for (const [key, label] of [['id', 'Model ID'], ['name', 'Display name'], ['context', 'Context window'], ['output', 'Maximum output tokens']] as const) {
        const wrapper = el('label', '', label), control = input(model[key], 'model:' + index + ':' + key, value => { model[key] = value; draft.touched.add('models'); draft.inheritModels = false })
        if (key === 'context' || key === 'output') control.inputMode = 'numeric'
        wrapper.append(control); grid.append(wrapper)
      }
      const actions = el('div', 'actions')
      for (const modality of ['text', 'image']) actions.append(check(modality === 'text' ? 'Text' : 'Images', (model.input ?? ['text']).includes(modality), selected => {
        const values = new Set(model.input ?? ['text']); if (selected) values.add(modality); else values.delete(modality)
        model.input = [...values]; draft.touched.add('models'); draft.inheritModels = false
      }, 'model:' + index + ':' + modality))
      actions.append(button('Remove', () => { draft.models.splice(index, 1); draft.touched.add('models'); draft.inheritModels = false; render() }, 'quiet danger', locked()))
      row.append(grid, actions); box.append(row)
    })
    const actions = el('div', 'actions')
    actions.append(button('Add model', () => { draft.models.push({ id: '', name: '', context: '', output: '' }); draft.inheritModels = false; draft.touched.add('models'); render() }, '', locked()),
      button('Restore default models', () => { draft.models = []; draft.inheritModels = true; draft.touched.add('models'); render() }, 'quiet', locked() || (draft.creating && draft.custom)))
    box.append(actions); return box
  }
  const discover = (draft: ProviderDraft): void => start({ type: 'discover-models', ns: draft.ns, revision: draft.revision, provider: draft.id, baseURL: draft.baseURL, api: draft.api, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) })
  const renderCandidates = (draft: ProviderDraft): HTMLElement => {
    const box = el('section', 'card'); box.append(el('h3', '', 'Available models'))
    const search = input(modelSearch, 'model-search', value => { modelSearch = value; render() }); search.placeholder = 'Search model IDs or names'; search.setAttribute('aria-label', 'Search discovered models'); box.append(search)
    const matches = candidates.filter(model => (model.id + ' ' + (model.name ?? '')).toLowerCase().includes(modelSearch.toLowerCase()))
    const list = el('div', 'choices')
    for (const model of matches.slice(0, 300)) {
      const row = check(model.id, selectedModels.has(model.id), selected => { if (selected) selectedModels.add(model.id); else selectedModels.delete(model.id) }, 'candidate:' + model.id)
      row.classList.add('model-id'); row.title = model.name ?? model.id; list.append(row)
    }
    const actions = el('div', 'actions')
    actions.append(button('Select visible', () => { matches.slice(0, 300).forEach(model => selectedModels.add(model.id)); render() }), button('Deselect all', () => { selectedModels.clear(); render() }), button('Add selected', () => {
      const ids = new Set(draft.models.map(model => model.id))
      for (const model of candidates) if (selectedModels.has(model.id) && !ids.has(model.id)) {
        draft.models.push(editable({ id: model.id, ...(model.name ? { name: model.name } : {}), ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}), ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}), ...(model.inputModalities ? { input: [...model.inputModalities] } : {}) })); ids.add(model.id)
      }
      draft.inheritModels = false; draft.touched.add('models'); candidates = []; selectedModels.clear(); render()
    }, 'primary'))
    box.append(list, actions); if (matches.length > 300) box.append(el('p', 'hint', 'Showing 300 matches. Refine the search.')); return box
  }
  const renderProvider = (draft: ProviderDraft, provider: ProviderView | undefined): void => {
    const card = el('section', 'card'), fieldset = el('fieldset'); fieldset.disabled = locked()
    card.append(el('h3', '', draft.creating ? 'Add model provider' : provider?.name ?? draft.id))
    if (provider?.error) card.append(el('p', 'error', provider.error))
    if (draft.creating) {
      const kind = el('select'); kind.setAttribute('aria-label', 'Provider source')
      kind.append(new Option('Third-party provider', 'catalog'), new Option('Custom model API', 'custom')); kind.value = draft.custom ? 'custom' : 'catalog'
      kind.addEventListener('change', () => {
        providerDrafts.set(draft.custom ? CUSTOM_DRAFT : CATALOG_DRAFT, draft)
        const target = kind.value === 'custom' ? CUSTOM_DRAFT : CATALOG_DRAFT
        const nextDraft = providerDrafts.get(target) ?? newDraft(); nextDraft.custom = kind.value === 'custom'
        if (nextDraft.custom && !nextDraft.api && state?.protocols[0]) { nextDraft.api = state.protocols[0]; nextDraft.touched.add('api') }
        providerDrafts.set(NEW_PROVIDER, nextDraft); candidates = []; render()
      }); fieldset.append(kind)
      if (!draft.custom) {
        const select = el('select'); select.setAttribute('aria-label', 'Choose provider'); select.append(new Option('Choose a provider', ''))
        for (const entry of state?.availableProviders ?? []) select.append(new Option(entry.name, entry.id)); select.value = draft.id
        select.addEventListener('change', () => { const nextDraft = newDraft(); nextDraft.id = select.value; providerDrafts.set(NEW_PROVIDER, nextDraft); candidates = []; render() }); fieldset.append(select)
      } else fieldset.append(providerField('Provider ID', draft.id, 'provider-id', value => { draft.id = value }))
    }
    if (!provider?.account) {
      if (draft.custom) fieldset.append(providerField('Display name', draft.displayName, 'provider-name', value => { draft.displayName = value; draft.touched.add('displayName') }))
      fieldset.append(providerField('Endpoint', draft.baseURL, 'provider-endpoint', value => { draft.baseURL = value; draft.touched.add('baseURL') }))
      if (draft.ns === 'llm-pi-ai') {
        const row = el('div', 'field'), select = el('select'); select.setAttribute('aria-label', 'API protocol'); select.dataset.focusKey = 'provider-protocol'
        if (!draft.custom) select.append(new Option('Provider default', ''))
        const labels: Record<string, string> = { 'openai-completions': 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', 'anthropic-messages': 'Anthropic Messages' }
        for (const protocol of state?.protocols ?? []) select.append(new Option(labels[protocol] ?? protocol, protocol)); select.value = draft.api
        select.addEventListener('change', () => { draft.api = select.value; draft.touched.add('api'); updateSaveButtons() }); row.append(el('span', 'field-name', 'API protocol'), select); fieldset.append(row)
      }
      const capability = provider?.credential ?? state?.availableProviders.find(entry => entry.id === draft.id)?.credential ?? (draft.creating ? { configured: false, writable: true } : undefined)
      fieldset.append(keyControl(draft.apiKey, value => { draft.apiKey = value }, capability, provider?.extensionKey === true,
        () => start({ type: 'clear-key', provider: draft.id, revision: draft.revision })))
      const lookup = button('Get available models', () => discover(draft), '', locked() || !draft.id); lookup.dataset.discover = 'true'
      fieldset.append(el('p', 'hint', 'Model lookup uses the key entered here, without storing it. Installed provider catalogs do not require an endpoint request.'), lookup)
    }
    fieldset.append(renderModelRows(draft)); card.append(fieldset)
    const latest = draft.creating ? state?.piRevision : provider?.revision
    const stale = latest === undefined || conflict(draft.revision, latest)
    if (stale) card.append(el('p', 'error', 'This provider changed elsewhere. Discard the draft to load its latest configuration.'))
    if (candidates.length) card.append(renderCandidates(draft))
    card.append(footer(true, stale)); content.append(card)
    if (provider?.removable) content.append(button('Remove provider…', () => start({ type: 'remove-provider', provider: draft.id, revision: draft.revision }), 'danger', locked()))
  }
  const renderModels = (): void => {
    if (state?.modelsError) content.append(el('p', 'notice', state.modelsError))
    for (const provider of state?.providers ?? []) {
      const row = button('', () => { selectedProvider = selectedProvider === provider.id ? undefined : provider.id; candidates = []; errors.delete('models'); render() }, 'provider', !!pending)
      row.dataset.provider = provider.id
      row.append(el('span', 'dot' + (provider.active && (provider.account ? state?.signedIn : provider.credential?.configured) ? ' active' : '')),
        el('span', 'provider-label', provider.name), el('span', 'hint', provider.account ? state?.signedIn ? 'Signed in' : 'Account sign-in' : provider.credential?.configured ? 'Configured' : 'Not configured'))
      content.append(row)
      if (selectedProvider === provider.id) { const draft = getProviderDraft(); if (draft) renderProvider(draft, provider) }
    }
    content.append(button('Add model provider', () => { selectedProvider = NEW_PROVIDER; if (!providerDrafts.has(NEW_PROVIDER)) providerDrafts.set(NEW_PROVIDER, newDraft()); candidates = []; render() }, '', locked() || state?.piRevision === undefined))
    if (selectedProvider === NEW_PROVIDER) { const draft = providerDrafts.get(NEW_PROVIDER); if (draft) renderProvider(draft, undefined) }
    if (!state?.providers.length && state?.piRevision === undefined) content.append(el('p', 'empty', 'No configurable model adapter is available in this runtime.'))
  }
  function render(): void {
    const active = document.activeElement as HTMLInputElement | null
    const focusKey = active?.dataset.focusKey, selectionStart = active?.selectionStart, selectionEnd = active?.selectionEnd
    banner.textContent = state?.error ?? state?.reason ?? ''
    if (!banner.textContent && state?.loading) banner.textContent = 'Refreshing settings…'
    document.getElementById('version')!.textContent = state ? 'DSH Sidebar ' + state.version : ''
    refresh.disabled = !!pending || state?.loading === true
    const sections = [['general', 'General'], ['models', 'Models'], ['shell', 'Shell'], ['agent', 'Agent loop'], ['subagents', 'Subagents'], ['search', 'Web search']] as const
    navigation.replaceChildren()
    for (const [id, label] of sections) {
      if (!['general', 'models'].includes(id) && !state?.forms.some(form => form.section === id) && !(id === 'subagents' && state?.allowedModels)) continue
      const control = button(label, () => { section = id; message = ''; render() }, '', !!pending); control.dataset.section = id
      if (section === id) control.setAttribute('aria-current', 'page'); navigation.append(control)
    }
    content.replaceChildren(el('h2', '', sections.find(([id]) => id === section)?.[1] ?? 'Settings'), el('p', 'hint', 'Runtime options are shared by windows using the same DSH profile.'))
    if (!state || (!state.forms.length && !state.providers.length && state.phase !== 'ready')) {
      content.append(el('p', 'empty', 'Connect to DSH to load its available settings.'), button('Connect runtime', () => native('connect'), 'primary', !!pending), button('VS Code extension settings', () => native('extension-settings'), 'quiet'))
      return
    }
    if (section === 'models') renderModels()
    else {
      if (section === 'general') {
        const account = el('section', 'card'); account.append(el('h3', '', 'DeepSeek account'), el('p', 'hint', state.accountText ?? (state.signedIn ? 'Signed in' : 'Not signed in')),
          button(state.signedIn ? 'Sign out' : 'Sign in', () => native(state!.signedIn ? 'sign-out' : 'sign-in'), '', locked()))
        const nativeOptions = el('section', 'card'); nativeOptions.append(el('h3', '', 'Appearance and keyboard shortcuts'), el('p', 'hint', 'This extension follows VS Code appearance and keyboard settings.'),
          button('Color theme', () => native('theme')), button('Keyboard shortcuts', () => native('shortcuts')), button('Extension settings', () => native('extension-settings')))
        content.append(account, nativeOptions)
      }
      renderFields()
      if (section === 'subagents') renderAllowed()
      if (section !== 'general' && (activeForms().length || (section === 'subagents' && state.allowedModels))) {
        const stale = activeForms().some(form => fields.has(form.ns) && conflict(fields.get(form.ns)!.revision, form.revision))
          || !!(allowed && state.allowedModels && conflict(allowed.revision, state.allowedModels.revision))
        content.append(footer(false, stale))
      }
      if (section === 'general') {
        if (dirtySection()) content.append(footer(false, activeForms().some(form => fields.has(form.ns) && conflict(fields.get(form.ns)!.revision, form.revision))))
        content.append(el('p', 'hint', 'Provider keys are saved through DSH’s credential provider. Their stored values are never returned to this page.'), button('Manage runtime plugins', () => native('plugins'), 'quiet'))
      }
    }
    content.append(el('p', 'error', errors.get(section) ?? ''), el('p', 'success', message))
    updateSaveButtons()
    if (focusKey) {
      const target = [...content.querySelectorAll<HTMLInputElement>('[data-focus-key]')].find(control => control.dataset.focusKey === focusKey)
      if (target && !target.disabled) {
        target.focus({ preventScroll: true })
        if (target.type !== 'checkbox' && target.tagName === 'INPUT' && selectionStart !== null && selectionStart !== undefined) {
          try { target.setSelectionRange(selectionStart, selectionEnd ?? selectionStart) } catch { /* number/password controls may decline selection */ }
        }
      }
    }
  }
  const receive = (event: MessageEvent): void => {
    const value = event.data
    if (value?.type === 'state') {
      const previous = state; state = value.state as SettingsPageState
      if (previous && previous.scope !== state.scope) {
        fields.clear(); providerDrafts.clear(); searchKey = ''; searchKeyRevision = undefined; allowed = undefined; pending = undefined; queue = []; selectedProvider = undefined; candidates = []; errors.clear(); message = ''
      }
      if (state.loading && previous?.scope === state.scope) { banner.textContent = state.reason || state.error || 'Refreshing settings…'; refresh.disabled = true; return }
      render(); return
    }
    if (value?.type !== 'result' || !pending || value.requestId !== pending.id || pending.scope !== state?.scope) return
    const request = pending; pending = undefined
    if (request.type === 'discover-models') {
      if (value.ok && Array.isArray(value.models)) { candidates = value.models; selectedModels.clear(); modelSearch = '' }
    } else if (request.type === 'save-fields') {
      if (Array.isArray(value.results)) for (const result of value.results) { if (result.ok) fields.delete(result.ns) }
      if (value.ok || value.keySaved) { searchKey = ''; searchKeyRevision = undefined }
      if (value.settingsSaved && request.section === 'search') { fields.delete('web-search-deepseek'); searchKeyRevision = state?.forms.find(form => form.ns === 'web-search-deepseek')?.revision }
    } else if (request.type === 'save-allowed-models' && value.ok) allowed = undefined
    else if (request.type === 'save-provider' || request.type === 'create-provider') {
      if (value.ok) { providerDrafts.delete(selectedProvider!); if (selectedProvider === NEW_PROVIDER) { providerDrafts.delete(CATALOG_DRAFT); providerDrafts.delete(CUSTOM_DRAFT) } selectedProvider = value.promotedProvider ?? selectedProvider; candidates = [] }
      else if (value.settingsSaved) {
        const draft = getProviderDraft(), id = value.promotedProvider ?? draft?.id
        if (draft && id) {
          providerDrafts.delete(selectedProvider!); selectedProvider = id; draft.creating = false; draft.id = id; draft.touched.clear()
          draft.revision = state?.providers.find(provider => provider.id === id)?.revision ?? draft.revision; providerDrafts.set(id, draft)
        }
      }
    } else if (request.type === 'remove-provider' && value.ok) { providerDrafts.delete(selectedProvider!); selectedProvider = undefined }
    if (!value.ok && !value.cancelled) errors.set(request.section, value.error || 'The settings operation failed. Your draft was retained.')
    else { errors.delete(request.section); if (request.type !== 'discover-models' && !value.cancelled) message = 'Saved.' }
    render(); next()
  }
  const refreshPage = (): void => { if (!pending) api.postMessage({ type: 'refresh' }) }
  refresh.addEventListener('click', refreshPage); document.defaultView!.addEventListener('message', receive)
  api.postMessage({ type: 'ready' })
  return { dispose(): void { document.defaultView!.removeEventListener('message', receive); refresh.removeEventListener('click', refreshPage); fields.clear(); providerDrafts.clear(); searchKey = ''; queue = [] } }
}

if (typeof acquireVsCodeApi === 'function') mountSettingsPage(document, acquireVsCodeApi())
