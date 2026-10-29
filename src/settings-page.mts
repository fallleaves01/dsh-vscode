import type { ModelDraft, ProviderView, SettingsFieldView, SettingsFormView, SettingsPageState, DiscoveredModel } from './settings-page-state.js'
import { secretIcon, updateSecretIcon } from './secret-icon.mjs'
import { settingsIcon } from './settings-ui.js'
export { createSettingsModal } from './settings-modal.mjs'

interface Api { postMessage(value: unknown): void }
declare function acquireVsCodeApi(): Api
interface FieldsDraft { revision: number; values: Record<string, unknown> }
interface EditableModel { id: string; originalId?: string; name: string; context: string; output: string; input?: string[]; reasoning?: [string, string | null][]; reasoningTouched?: boolean }
interface ProviderDraft {
  id: string; revision: number; ns: string; creating: boolean; custom: boolean
  baseURL: string; api: string; displayName: string; apiKey: string
  models: EditableModel[]; inheritModels: boolean; touched: Set<string>
}
type Message = Record<string, unknown>

/** Settings drafts live only in this Webview's memory. Secrets are never persisted. */
export function mountSettingsPage(document: Document, api: Api, options: { root?: HTMLElement; externalMessages?: boolean; onClose?: () => void } = {}): { dispose(): void; receive(value: unknown): void } {
  const root = options.root ?? document.getElementById('settingsRoot')!
  const content = root.querySelector<HTMLElement>('#content')!, navigation = root.querySelector<HTMLElement>('#navigation')!
  const banner = root.querySelector<HTMLElement>('#banner')!, refresh = root.querySelector<HTMLButtonElement>('#refresh')!
  const toast = root.querySelector<HTMLElement>('#settings-toast')!, toastText = root.querySelector<HTMLElement>('#settings-toast-text')!, toastClose = root.querySelector<HTMLButtonElement>('#settings-toast-close')!
  const NEW_PROVIDER = Symbol('new-provider'), CATALOG_DRAFT = Symbol('catalog-draft'), CUSTOM_DRAFT = Symbol('custom-draft')
  let state: SettingsPageState | undefined, section = 'general', selectedProvider: string | typeof NEW_PROVIDER | undefined, serial = 0
  let inventorySearch = ''
  const fields = new Map<string, FieldsDraft>(), providerDrafts = new Map<string | symbol, ProviderDraft>(), errors = new Map<string, string>()
  const advancedProviders = new Set<string>()
  let searchKey = '', searchKeyRevision: number | undefined
  let searchMode: { revision: number; enabled: boolean } | undefined, searchSelectionRevision: number | undefined
  let searchKeyTarget: { ns: string; revision: number } | undefined
  let allowed: { revision: number; enabled: boolean; routes: { provider: string; model: string }[]; reset?: boolean } | undefined
  let pending: { id: string; scope: string; type: string; provider?: string; section: string } | undefined
  let queue: Message[] = [], candidates: DiscoveredModel[] = [], selectedModels = new Set<string>(), modelSearch = '', allowSearch = ''
  let message = ''
  let toastKey = '', toastEpoch = 0
  let pendingBundle: { name: string; enabled: boolean } | undefined
  const announcedToasts = new Set<string>()
  let toastTimer: number | undefined
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag); element.className = className; if (text) element.textContent = text; return element
  }
  const locked = (): boolean => !!pending || !state?.writable
  const button = (label: string, action: () => void, className = '', disabled = false): HTMLButtonElement => {
    const control = el('button', className, label); control.type = 'button'; control.disabled = disabled
    control.addEventListener('click', () => { if (!control.disabled) action() }); return control
  }
  /**
   * Keep operation feedback visible above the scrolling body.
   *
   * The inline error paragraph at the end of the content stays for context, but
   * a long section (a plugin list, a model catalogue) pushes it out of view.
   * The toast repeats the newest failure or confirmation, dismisses an error on
   * request, and fades a success without re-announcing it on the next render.
   */
  const hideToast = (): void => {
    if (toastTimer !== undefined) { document.defaultView!.clearTimeout(toastTimer); toastTimer = undefined }
    if (!toast.hidden) toast.hidden = true
    toastKey = ''
  }
  const dismissToast = (): void => { hideToast() }
  const syncToast = (): void => {
    const error = errors.get(section) ?? ''
    const current = error !== '' ? 'error|' + error : message !== '' ? 'success|' + message : ''
    if (current === '') { hideToast(); return }
    // One announcement per result epoch, not per render. Switching sections must
    // not replay an error the user already saw, while a new result carrying the
    // same text must be shown again.
    const key = toastEpoch + '|' + current
    if (announcedToasts.has(key)) return
    if (announcedToasts.size > 64) announcedToasts.clear()
    announcedToasts.add(key)
    hideToast()
    toastKey = current
    toastText.textContent = error !== '' ? error : message
    toast.className = 'settings-toast ' + (error !== '' ? 'error' : 'success')
    toast.hidden = false
    if (error === '') toastTimer = document.defaultView!.setTimeout(() => { if (toastKey === current) hideToast() }, 8000)
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
  const toggle = (label: string, checked: boolean, update: (value: boolean) => void, key: string): HTMLLabelElement => {
    const row = check(label, checked, update, key); row.classList.add('switch-row'); row.querySelector('input')!.setAttribute('role', 'switch'); return row
  }
  const native = (action: string): void => api.postMessage({ type: 'native-action', action, scope: state?.scope })
  const formDraft = (form: SettingsFormView): FieldsDraft => {
    let draft = fields.get(form.ns)
    if (!draft) { draft = { revision: form.revision, values: {} }; fields.set(form.ns, draft) }
    return draft
  }
  const activeForms = (): SettingsFormView[] => state?.forms.filter(form => form.section === section) ?? []
  const revealSection = (): void => { root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }
  const searchForm = (): SettingsFormView | undefined => state?.forms.find(form => form.ns === ((searchMode?.enabled ?? state?.search?.selection?.enabled) ? 'web-deepseek-api' : 'web-search-deepseek'))
  const captureSearchSelection = (): void => { searchSelectionRevision ??= state?.search?.selection?.revision }
  const searchConflict = (): boolean => !!state?.search && ((searchSelectionRevision !== undefined && searchSelectionRevision !== state.search.selection?.revision)
    || !!(searchKeyTarget && searchKeyTarget.revision !== state.search.profiles.find(profile => profile.ns === searchKeyTarget!.ns)?.revision))
  const conflict = (revision: number, latest: number): boolean => !pending && revision !== latest
  const start = (body: Message): void => {
    if (!state || pending) return
    const id = 'settings-' + (++serial)
    pending = { id, scope: state.scope, type: String(body.type), section, ...(typeof body.provider === 'string' ? { provider: body.provider } : {}) }
    if (body.type === 'set-bundle' && typeof body.name === 'string' && typeof body.enabled === 'boolean') pendingBundle = { name: body.name, enabled: body.enabled }
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
    context: model.contextWindow === undefined ? '' : String(model.contextWindow), output: model.maxTokens === undefined ? '' : String(model.maxTokens), ...(model.input ? { input: [...model.input] } : {}),
    ...(model.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? { reasoning: Object.entries(model.reasoningEfforts) } : {}) })
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
    || (section === 'search' && (!!searchKey.trim() || !!searchMode)) || (section === 'subagents' && !!allowed)
  function updateSaveButtons(): void {
    for (const control of root.querySelectorAll<HTMLButtonElement>('[data-save]')) {
      const dirty = control.dataset.save === 'provider' ? dirtyProvider() : dirtySection()
      const invalid = control.dataset.save === 'provider' && getProviderDraft()?.models.some(model => reasoningError(model) !== undefined)
      control.disabled = locked() || !dirty || !!invalid || control.dataset.conflicted === 'true'
    }
    for (const control of root.querySelectorAll<HTMLButtonElement>('[data-discover]')) control.disabled = locked() || !getProviderDraft()?.id
  }
  const parsedFields = (form: SettingsFormView, values: Record<string, unknown>): Record<string, unknown> => {
    return Object.fromEntries(Object.entries(values).map(([key, raw]) => {
      const field = form.fields.find(item => item.key === key)!
      if (field.type === 'string-list') {
        if (raw === null || raw === '') return [key, []]
        if (Array.isArray(raw)) return [key, raw]
        if (typeof raw !== 'string') return [key, raw]
        return [key, raw.split('\n').map(line => line.trim()).filter(line => line !== '')]
      }
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
      if (section === 'search' && state.search) {
        if (searchConflict()) throw new Error('The search selection or credential target changed elsewhere. Discard the draft first.')
        const changes = activeForms().flatMap(form => {
          const draft = fields.get(form.ns)
          if (!draft || !Object.keys(draft.values).length) return []
          if (draft.revision !== form.revision) throw new Error('These settings changed elsewhere. Discard the draft first.')
          return [{ ns: form.ns, revision: draft.revision, values: parsedFields(form, draft.values) }]
        })
        start({ type: 'save-search', changes,
          ...(state.search.selection ? { selectionRevision: searchSelectionRevision ?? state.search.selection.revision } : {}),
          ...(searchMode ? { selection: { enabled: searchMode.enabled } } : {}),
          ...(searchKey ? { apiKey: searchKey, keyNamespace: searchKeyTarget?.ns, keyRevision: searchKeyTarget?.revision } : {}) })
        return
      }
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
    activeForms().forEach(form => fields.delete(form.ns)); if (section === 'search') { searchKey = ''; searchKeyRevision = undefined; searchKeyTarget = undefined; searchMode = undefined; searchSelectionRevision = undefined }
    if (section === 'subagents') allowed = undefined
    errors.delete(section); message = ''; render()
  }
  const fieldControl = (form: SettingsFormView, field: SettingsFieldView): HTMLElement => {
    const row = el('div', 'field'), copy = el('div', 'field-copy'), draft = fields.get(form.ns)
    const touched = !!draft && Object.hasOwn(draft.values, field.key)
    const value = touched ? draft.values[field.key] : field.value
    copy.append(el('span', 'field-name', field.label))
    if (touched || field.overridden) copy.append(el('span', 'hint', touched && value === null ? 'Use default on save' : 'Customized'))
    row.append(copy)
    if (field.type === 'boolean') row.append(toggle(field.label, (value === null ? field.inherited : value) === true, checked => {
      if (form.section === 'search') captureSearchSelection()
      formDraft(form).values[field.key] = checked
      if (form.section === 'general') saveSection()
    }, form.ns + ':' + field.key))
    else if (field.type === 'select') {
      const control = el('select'); control.dataset.focusKey = form.ns + ':' + field.key
      control.setAttribute('aria-label', field.label)
      const current = value === undefined || value === null ? '' : String(value)
      const options = field.options ?? []
      if (current !== '' && !options.some(option => option.value === current)) control.append(new Option(current, current))
      for (const option of options) control.append(new Option(option.label, option.value))
      control.value = current !== '' ? current : options[0]?.value ?? ''
      control.addEventListener('change', () => { if (form.section === 'search') captureSearchSelection(); formDraft(form).values[field.key] = control.value; updateSaveButtons() })
      row.append(control)
    } else if (field.type === 'string-list') {
      const control = el('textarea'); control.dataset.focusKey = form.ns + ':' + field.key
      control.setAttribute('aria-label', field.label); control.rows = 4; control.spellcheck = false
      control.value = Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') : value === undefined || value === null ? '' : String(value)
      control.placeholder = 'https://example.com/index.json'
      control.addEventListener('input', () => { if (form.section === 'search') captureSearchSelection(); formDraft(form).values[field.key] = control.value; updateSaveButtons() })
      row.append(control)
    } else {
      const control = input(value === undefined || value === null ? '' : String(value), form.ns + ':' + field.key, raw => { if (form.section === 'search') captureSearchSelection(); formDraft(form).values[field.key] = raw })
      control.setAttribute('aria-label', field.label)
      if (field.type === 'number') control.inputMode = field.integer ? 'numeric' : 'decimal'
      if (field.inherited !== undefined) control.placeholder = 'Default: ' + String(field.inherited)
      row.append(control)
    }
    const reset = button('Reset', () => { if (form.section === 'search') captureSearchSelection(); formDraft(form).values[field.key] = null; if (form.section === 'general') saveSection(); else render() }, 'quiet', locked() || (!touched && !field.overridden))
    reset.hidden = !touched && !field.overridden; row.append(reset)
    if (field.description) row.append(el('span', 'hint field-description', field.description))
    return row
  }
  const keyControl = (value: string, update: (value: string) => void, capability: { configured: boolean; writable: boolean } | undefined, extensionKey: boolean, clear: () => void, clearDisabled = false, missingHint = 'Not configured; optional for native provider authentication'): HTMLElement => {
    const box = el('div', 'key-control'), row = el('div', 'field'), copy = el('div', 'field-copy')
    copy.append(el('span', 'field-name', 'API key'))
    const status = el('p', 'hint key-status', !capability ? 'Credential status unavailable' : capability.configured ? capability.writable ? 'Configured; leave blank to keep it' : 'Configured by a read-only source' : missingHint)
    const control = input(value, 'api-key', update, 'password'); control.setAttribute('aria-label', 'API key'); control.disabled = locked() || capability?.writable === false || !capability
    control.spellcheck = false; control.setAttribute('autocapitalize', 'off')
    const keyInput = el('div', 'key-input'), eye = secretIcon(document), reveal = button('', () => {
      const hidden = control.type === 'password'; control.type = hidden ? 'text' : 'password'
      reveal.title = hidden ? 'Hide API key' : 'Show API key'; reveal.setAttribute('aria-label', reveal.title); reveal.setAttribute('aria-pressed', String(hidden)); updateSecretIcon(eye, hidden)
    }, 'quiet', control.disabled)
    reveal.title = 'Show API key'; reveal.setAttribute('aria-label', reveal.title); reveal.setAttribute('aria-pressed', 'false'); reveal.append(eye); keyInput.append(control, reveal)
    const clearButton = button('Clear key', clear, 'quiet danger', locked() || clearDisabled || !capability?.writable || !capability.configured); clearButton.hidden = !capability?.configured
    row.append(copy, keyInput, clearButton); box.append(row, status)
    if (extensionKey) box.append(button('Configure extension API key…', () => native('extension-key'), 'quiet', locked()))
    return box
  }
  const footer = (provider = false, stale = false): HTMLElement => {
    const box = el('div', 'actions section-save')
    box.append(el('span', 'hint', pending ? 'Saving…' : stale ? 'Changed elsewhere. Discard to reload.' : ''))
    const save = button('Save changes', provider ? saveProvider : saveSection, 'primary'); save.dataset.save = provider ? 'provider' : 'section'; save.dataset.conflicted = String(stale)
    box.append(button('Discard', provider ? () => { if (selectedProvider) providerDrafts.delete(selectedProvider); if (selectedProvider === NEW_PROVIDER) { providerDrafts.delete(CATALOG_DRAFT); providerDrafts.delete(CUSTOM_DRAFT); selectedProvider = undefined } candidates = []; errors.delete('models'); render() } : discardSection, '', !!pending), save)
    return box
  }
  const renderFields = (): void => {
    for (const form of activeForms()) {
      const card = el('section', 'card' + (form.section === 'general' ? ' general-form' : '')); card.append(el('h3', '', form.title))
      if (form.ns === 'session-log-deepseek') card.append(el('p', 'hint', 'Help improve DeepSeek models and products.'))
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
  const renderSearch = (): void => {
    const view = state?.search
    if (!view) { renderFields(); return }
    const card = el('section', 'card'), fieldset = el('fieldset'), modeFieldset = el('fieldset'); fieldset.disabled = locked(); modeFieldset.disabled = locked()
    const enabled = searchMode?.enabled ?? view.selection?.enabled ?? false
    const switchControl = toggle('Use the new Web Search API', enabled, value => {
      if (!view.selection?.available) return
      captureSearchSelection(); searchMode = { revision: searchSelectionRevision ?? view.selection.revision, enabled: value }
      if (searchKey) { const form = searchForm(); searchKeyTarget = form ? { ns: form.ns, revision: form.revision } : undefined }
      render()
    }, 'search-api-mode')
    switchControl.querySelector('input')!.disabled = locked() || !view.selection?.available
    modeFieldset.append(switchControl, el('p', 'hint', 'Off by default: use the Messages API for search. Turning this on selects the Search and Fetch APIs together.'))
    card.append(modeFieldset, button('Search API guide ↗', () => native('search-guide'), 'quiet'))
    const form = searchForm(), profile = view.profiles.find(item => item.ns === form?.ns)
    if (form && profile) {
      fieldset.append(keyControl(searchKey, value => {
        searchKey = value; captureSearchSelection()
        if (value) searchKeyTarget ??= { ns: form.ns, revision: form.revision }; else searchKeyTarget = undefined
      }, profile.credential, profile.extensionKey, () => start({ type: 'clear-key', provider: 'web-search', ns: form.ns, revision: fields.get(form.ns)?.revision ?? searchKeyTarget?.revision ?? form.revision,
        ...(view.selection ? { selectionRevision: searchSelectionRevision ?? view.selection.revision } : {}) }), searchConflict() || activeForms().some(item => fields.has(item.ns) && fields.get(item.ns)!.revision !== item.revision),
        'No key is configured; only conversations using a DeepSeek Account model can search through the default endpoint.'))
      for (const field of form.fields) {
        const description = field.key === 'baseURL'
          ? enabled ? 'Include the API prefix, such as https://api.deepseek.com/v1/tools. The provider appends /search or /fetch. Leave blank to restore the default.' : 'Include the API version prefix. The provider appends /messages. Leave blank to restore the default.'
          : enabled ? 'Results returned per query: an integer from 1 to 50, default 10. This controls result count, not search calls.' : 'Maximum searches in each Messages API request. Leave blank to restore the default.'
        fieldset.append(fieldControl(form, { ...field, description: [field.description, description].filter(Boolean).join(' ') }))
      }
    } else fieldset.append(el('p', 'notice', 'The selected search provider settings are unavailable in this runtime.'))
    card.append(fieldset); content.append(card)
    if (searchConflict()) content.append(el('p', 'error', 'The search selection or credential target changed elsewhere. Your draft is retained.'))
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
      const invalid = draft.models.map(reasoningError).find(Boolean)
      if (invalid) throw new Error(invalid)
      const changes: Record<string, unknown> = {}
      for (const key of draft.touched) {
        if (key === 'models') changes.models = draft.inheritModels ? null : draft.models.map(model => ({ id: model.id, ...(model.originalId ? { originalId: model.originalId } : {}),
          ...(model.name ? { name: model.name } : {}), ...(model.context ? { contextWindow: positive(model.context, 'Context window') } : {}),
          ...(model.output ? { maxTokens: positive(model.output, 'Output limit') } : {}), ...(model.input ? { input: model.input } : {}),
          ...(model.reasoningTouched ? { reasoningEfforts: model.reasoning === undefined ? null : Object.fromEntries(model.reasoning) } : {}) }))
        else if (key === 'baseURL' || key === 'api' || key === 'displayName') changes[key] = draft[key] || null
      }
      start({ type: draft.creating ? 'create-provider' : 'save-provider', provider: draft.id, revision: draft.revision, fields: changes, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) })
    } catch (cause) { errors.set('models', (cause as Error).message); render() }
  }
  const providerField = (label: string, value: string, key: string, update: (value: string) => void): HTMLElement => {
    const row = el('div', 'field'); row.append(el('span', 'field-name', label), input(value, key, update)); return row
  }
  function reasoningError(model: EditableModel): string | undefined {
    if (model.reasoning === undefined) return
    if (!model.reasoning.some(([level]) => level !== 'off')) return 'Add at least one level besides Off, or turn reasoning levels off.'
    if (model.reasoning.some(([level, wire]) => !(level === 'off' && wire === null) && (typeof wire !== 'string' || !wire.length))) return 'Every level besides Off needs an API value, and no value can be empty.'
  }
  const renderReasoning = (model: EditableModel, draft: ProviderDraft, position: number, levels: string[]): HTMLElement => {
    const group = el('div', 'model-reasoning'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', `Reasoning levels ${position + 1}`)
    const changed = (): void => { model.reasoningTouched = true; draft.touched.add('models'); draft.inheritModels = false }
    group.append(toggle('Reasoning levels', model.reasoning !== undefined, enabled => {
      if (enabled) model.reasoning = ['off', 'low', 'medium', 'high'].filter(level => levels.includes(level)).map(level => [level, level === 'off' ? null : level])
      else delete model.reasoning
      changed(); render()
    }, `reasoning:${position}:enabled`))
    if (model.reasoning === undefined) return group
    const entries = model.reasoning, used = entries.map(([level]) => level)
    const header = el('div', 'reasoning-row reasoning-labels'); header.setAttribute('aria-hidden', 'true')
    header.append(el('span', 'hint', 'Level'), el('span', 'hint', 'API value')); group.append(header)
    const error = el('p', 'error', reasoningError(model)); error.hidden = !reasoningError(model)
    entries.forEach(([level, wire], index) => {
      const row = el('div', 'reasoning-row'), select = el('select'); select.setAttribute('aria-label', `Reasoning level ${index + 1}`); select.dataset.focusKey = `reasoning:${position}:${index}:level`
      for (const choice of [...levels.includes(level) ? [] : [level], ...levels.filter(choice => choice === level || !used.includes(choice))]) select.append(new Option(choice, choice))
      select.value = level
      select.addEventListener('change', () => {
        const next = select.value
        entries[index] = [next, typeof wire === 'string' && wire.length > 0 && wire !== level && level !== 'off' && next !== 'off' ? wire : next === 'off' ? null : next]
        changed(); render()
      })
      const value = input(typeof wire === 'string' ? wire : '', `reasoning:${position}:${index}:value`, raw => {
        entries[index] = [level, raw.trim() || (level === 'off' ? null : level)]; changed()
        error.textContent = reasoningError(model) ?? ''; error.hidden = !error.textContent
      })
      value.placeholder = level === 'off' ? 'Not sent' : level; value.disabled = locked() || level === 'off'; value.setAttribute('aria-label', `${level} API value`)
      row.append(select, value, button('×', () => { entries.splice(index, 1); changed(); render() }, 'quiet danger', locked()))
      row.querySelector('button')!.setAttribute('aria-label', `Delete level ${level}`); group.append(row)
    })
    group.append(error, button('+ Add level', () => {
      const highest = Math.max(-1, ...used.map(level => levels.indexOf(level)))
      const level = levels.find((candidate, index) => index > highest && !used.includes(candidate)) ?? levels.find(candidate => !used.includes(candidate))
      if (level) { entries.push([level, level === 'off' ? null : level]); changed(); render() }
    }, 'quiet', locked() || levels.every(level => used.includes(level))))
    return group
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
      row.append(grid)
      const levels = state?.providers.find(provider => provider.id === draft.id)?.reasoningLevels ?? (draft.ns === 'llm-pi-ai' && draft.custom ? state?.reasoningLevels : undefined) ?? []
      if (levels.length) row.append(renderReasoning(model, draft, index, levels))
      row.append(actions); box.append(row)
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
  const renderProvider = (draft: ProviderDraft, provider: ProviderView | undefined, target: HTMLElement = content): void => {
    const card = el('section', 'card'), fieldset = el('fieldset'); fieldset.disabled = locked()
    if (draft.creating) card.append(el('h3', '', 'Add model provider'))
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
    fieldset.append(renderModelRows(draft))
    if (!draft.creating && !provider?.account) {
      const key = fieldset.querySelector<HTMLElement>(':scope > .key-control')!, advanced = el('details', 'provider-customized'), summary = el('summary', '', 'Custom settings')
      advanced.open = advancedProviders.has(draft.id); advanced.append(summary)
      for (const child of [...fieldset.children]) if (child !== key) advanced.append(child)
      advanced.addEventListener('toggle', () => { if (advanced.open) advancedProviders.add(draft.id); else advancedProviders.delete(draft.id) })
      const keepOpen = (): void => { advancedProviders.add(draft.id) }
      advanced.addEventListener('input', keepOpen, true); advanced.addEventListener('change', keepOpen, true)
      advanced.addEventListener('click', () => { if (advanced.open) keepOpen() }, true)
      fieldset.append(key, advanced)
    }
    card.append(fieldset)
    const latest = draft.creating ? state?.piRevision : provider?.revision
    const stale = latest === undefined || conflict(draft.revision, latest)
    if (stale) card.append(el('p', 'error', 'This provider changed elsewhere. Discard the draft to load its latest configuration.'))
    if (candidates.length) card.append(renderCandidates(draft))
    card.append(footer(true, stale)); target.append(card)
    if (provider?.removable) target.append(button('Remove provider…', () => start({ type: 'remove-provider', provider: draft.id, revision: draft.revision }), 'danger', locked()))
  }
  const renderModels = (): void => {
    if (state?.modelsError) content.append(el('p', 'notice', state.modelsError))
    for (const provider of state?.providers ?? []) {
      const shell = el('section', 'provider-shell')
      const row = button('', () => { selectedProvider = selectedProvider === provider.id ? undefined : provider.id; candidates = []; errors.delete('models'); render() }, 'provider', !!pending)
      row.dataset.provider = provider.id
      row.setAttribute('aria-expanded', String(selectedProvider === provider.id))
      row.append(el('span', 'dot' + ((provider.account ? state?.signedIn : provider.credential?.configured) ? ' active' : '')),
        el('span', 'provider-label', provider.name), el('span', 'hint', provider.account ? state?.signedIn ? 'Signed in' : 'Account sign-in' : provider.credential?.configured ? 'Configured' : 'Not configured'))
      shell.append(row); content.append(shell)
      if (selectedProvider === provider.id) { const draft = getProviderDraft(); if (draft) renderProvider(draft, provider, shell) }
    }
    content.append(button('Add model provider', () => { selectedProvider = NEW_PROVIDER; if (!providerDrafts.has(NEW_PROVIDER)) providerDrafts.set(NEW_PROVIDER, newDraft()); candidates = []; render() }, 'provider-add', locked() || state?.piRevision === undefined))
    if (selectedProvider === NEW_PROVIDER) { const draft = providerDrafts.get(NEW_PROVIDER); if (draft) renderProvider(draft, undefined) }
    if (!state?.providers.length && state?.piRevision === undefined) content.append(el('p', 'empty', 'No configurable model adapter is available in this runtime.'))
  }
  const renderInventory = (): void => {
    const search = input(inventorySearch, 'plugin-search', value => { inventorySearch = value; render() }); search.placeholder = 'Search plugins'; search.setAttribute('aria-label', 'Search plugins'); content.append(search)
    const groups = state?.inventory ?? []
    for (const group of groups) {
      const rows = group.rows.filter(row => (row.name + ' ' + row.status).toLowerCase().includes(inventorySearch.toLowerCase()))
      if (!rows.length) continue
      content.append(el('h3', 'inventory-heading', group.label))
      const grid = el('div', 'plugin-inventory')
      for (const row of rows) {
        const card = el('article', 'inventory-card'); card.append(el('div', 'inventory-name', row.name.replace(/^@deepseek-ai\/dsh-/, '')), el('span', 'hint', row.status), el('code', 'inventory-module', row.name)); grid.append(card)
      }
      content.append(grid)
    }
    if (!groups.some(group => group.rows.length)) content.append(el('p', 'empty', 'Plugin inventory is unavailable in this runtime.'))
    const bundles = (state?.bundles ?? []).filter(bundle => bundle.optional)
    if (bundles.length) {
      content.append(el('h3', 'inventory-heading', 'Experimental bundles'))
      content.append(el('p', 'hint', 'Optional runtime capabilities shipped with DSH. Enabling one changes the shared web profile; a runtime restart may be required.'))
      const manage = state?.writable === true
      if (!manage) content.append(el('p', 'notice', state?.reason || 'This runtime is read-only. Change its optional bundles from the client that manages this profile.'))
      const fieldset = el('fieldset'); fieldset.disabled = locked() || !manage
      const grid = el('div', 'plugin-inventory')
      for (const bundle of bundles) {
        const card = el('article', 'inventory-card bundle-card')
        const label = bundle.title ?? bundle.name.replace(/^@deepseek-ai\/dsh-/, '')
        const applying = pendingBundle?.name === bundle.name
        const current = applying ? pendingBundle!.enabled : bundle.enabled
        // An on-demand bundle that is not installed has nothing to switch: the
        // toggle would only produce a Host failure. A bundle the Host does not
        // list by default is still switchable here: `setBundleEnabled` accepts
        // those bundles, and this page is their only switch in VS Code.
        const onDemandMissing = bundle.availability === 'missing'
        const unsupported = bundle.errorCode === 'unsupported-platform'
        card.append(el('div', 'inventory-name', label),
          el('span', 'hint bundle-status', [
            applying ? 'Applying…' : current ? 'Enabled' : 'Disabled',
            bundle.version ? 'v' + bundle.version : '',
            bundle.installed ? 'Installed' : onDemandMissing ? 'Not installed' : 'Provided by this installation',
            bundle.listedByDefault === false ? 'Not listed by default' : '',
            unsupported ? 'Unsupported on this platform' : '',
          ].filter(Boolean).join(' · ')))
        if (bundle.description) card.append(el('span', 'hint bundle-description', bundle.description))
        if (manage && !onDemandMissing) card.append(toggle('Enabled', current, enabled => {
          if (enabled === current) return
          start({ type: 'set-bundle', name: bundle.name, enabled })
        }, 'bundle:' + bundle.name))
        grid.append(card)
      }
      fieldset.append(grid); content.append(fieldset)
    }
    content.append(button('Manage runtime plugins', () => native('plugins'), 'quiet'))
  }
  function render(): void {
    const active = document.activeElement as HTMLInputElement | null
    const focusKey = active?.dataset.focusKey, selectionStart = active?.selectionStart, selectionEnd = active?.selectionEnd
    banner.textContent = state?.error ?? state?.reason ?? ''
    if (!banner.textContent && state?.loading) banner.textContent = 'Refreshing settings…'
    refresh.disabled = !!pending || state?.loading === true
    const pluginSections = [['subagents', 'Subagents'], ['agent', 'Agent loop'], ['search', 'Web search'], ['shell', 'Shell'], ['translation', 'Reasoning translation'], ['voice', 'Voice input'], ['market', 'Plugin market']].filter(([id]) => state?.forms.some(form => form.section === id) || (id === 'subagents' && state?.allowedModels)) as [string, string][]
    const isPlugin = section === 'inventory' || pluginSections.some(([id]) => id === section)
    const sections = [['general', 'General'], ['models', 'Models'], ...(pluginSections.length || state?.inventory?.length ? [['plugins', 'Built-in plugins']] : [])]
    navigation.replaceChildren()
    for (const [id, label] of sections) {
      const control = button('', () => { section = id === 'plugins' ? 'inventory' : id!; message = ''; render() }, '', !!pending); control.dataset.section = id!
      control.innerHTML = settingsIcon(id!); control.append(el('span', 'nav-label', label!)); control.title = label!; control.setAttribute('aria-label', label!)
      control.dataset.focusKey = 'section:' + id
      if (section === id || (id === 'plugins' && isPlugin)) control.setAttribute('aria-current', 'page'); navigation.append(control)
    }
    content.replaceChildren()
    if (isPlugin) {
      content.append(el('h2', '', 'Built-in plugins'))
      const tabs = el('div', 'settings-plugin-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Plugin settings')
      const views: [string, string][] = [['inventory', 'Plugins'], ...pluginSections]
      views.forEach(([id, label], index) => {
        const selected = section === id, tab = button(label, () => { section = id; message = ''; render() }, '', !!pending)
        tab.dataset.section = id; tab.dataset.focusKey = 'section:' + id; tab.id = 'plugin-tab-' + id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(selected)); tab.setAttribute('aria-controls', 'plugin-panel'); tab.tabIndex = selected ? 0 : -1
        tab.addEventListener('keydown', event => {
          const target = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : undefined
          if (target === undefined || pending) return
          event.preventDefault(); section = views[target]![0]; message = ''; render(); root.querySelector<HTMLButtonElement>('#plugin-tab-' + section)!.focus()
        }); tabs.append(tab)
      }); content.append(tabs)
    } else if (section !== 'general') content.append(el('h2', '', sections.find(([id]) => id === section)?.[1] ?? 'Settings'))
    if (!state || (!state.forms.length && !state.providers.length && state.phase !== 'ready')) {
      content.append(el('p', 'empty', 'Connect to DSH to load its available settings.'), button('Connect runtime', () => native('connect'), 'primary', !!pending), button('VS Code extension settings', () => native('extension-settings'), 'quiet'))
      return
    }
    if (section === 'models') renderModels()
    else if (section === 'inventory') renderInventory()
    else {
      if (section === 'account') {
        const account = el('section', 'card'); account.append(el('h3', '', 'DeepSeek account'), el('p', 'hint', state.accountText ?? (state.signedIn ? 'Signed in' : 'Not signed in')),
          button(state.signedIn ? 'Sign out' : 'Sign in', () => native(state!.signedIn ? 'sign-out' : 'sign-in'), '', locked()))
        content.append(account)
      }
      if (section === 'general') {
        for (const [label, description, action, value] of [['Appearance', 'Use the VS Code color theme.', 'theme', 'Color theme'], ['Keyboard shortcuts', 'Configure shortcuts in VS Code.', 'shortcuts', 'Keyboard shortcuts'], ['Extension settings', 'Configure VS Code integration.', 'extension-settings', 'Extension settings']]) {
          const row = el('section', 'general-row'), copy = el('div'); copy.append(el('span', '', label), el('p', 'hint', description)); row.append(copy, button(value!, () => native(action!))); content.append(row)
        }
        const account = el('section', 'general-row'), copy = el('div'); copy.append(el('span', '', 'DeepSeek account'), el('p', 'hint', state.accountText ?? (state.signedIn ? 'Signed in' : 'Not signed in'))); account.append(copy, button(state.signedIn ? 'Sign out' : 'Sign in', () => native(state!.signedIn ? 'sign-out' : 'sign-in'), '', locked())); content.append(account)
      }
      if (section === 'search') renderSearch(); else renderFields()
      if (section === 'subagents') renderAllowed()
      if (section !== 'general' && (activeForms().length || (section === 'subagents' && state.allowedModels))) {
        const stale = activeForms().some(form => fields.has(form.ns) && conflict(fields.get(form.ns)!.revision, form.revision))
          || !!(allowed && state.allowedModels && conflict(allowed.revision, state.allowedModels.revision))
          || (section === 'search' && searchConflict())
        content.append(footer(false, stale))
      }
      if (section === 'general') {
        if (dirtySection()) content.append(footer(false, activeForms().some(form => fields.has(form.ns) && conflict(fields.get(form.ns)!.revision, form.revision))))
        content.append(el('p', 'general-row', 'DSH Sidebar ' + state.version), button('Manage runtime plugins', () => native('plugins'), 'quiet'))
      }
    }
    syncToast()
    content.append(el('p', 'error', errors.get(section) ?? ''), el('p', 'success', message))
    if (isPlugin) {
      const panel = el('div'); panel.id = 'plugin-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'plugin-tab-' + section)
      panel.append(...[...content.children].slice(2)); content.append(panel)
    }
    updateSaveButtons()
    if (document.activeElement === root) navigation.querySelector<HTMLButtonElement>('[aria-current]')?.focus({ preventScroll: true })
    if (focusKey) {
      const target = [...root.querySelectorAll<HTMLInputElement>('[data-focus-key]')].find(control => control.dataset.focusKey === focusKey)
      if (target && !target.disabled) {
        target.focus({ preventScroll: true })
        if (target.type !== 'checkbox' && target.tagName === 'INPUT' && selectionStart !== null && selectionStart !== undefined) {
          try { target.setSelectionRange(selectionStart, selectionEnd ?? selectionStart) } catch { /* number/password controls may decline selection */ }
        }
      }
    }
    revealSection()
  }
  const receive = (event: MessageEvent): void => {
    const value = event.data
    if (value?.type === 'state') {
      const previous = state; state = value.state as SettingsPageState
      if (previous && previous.scope !== state.scope) {
        fields.clear(); providerDrafts.clear(); advancedProviders.clear(); searchKey = ''; searchKeyRevision = undefined; searchKeyTarget = undefined; searchMode = undefined; searchSelectionRevision = undefined; allowed = undefined; pending = undefined; pendingBundle = undefined; queue = []; selectedProvider = undefined; candidates = []; errors.clear(); message = ''
      }
      if (state.loading && previous?.scope === state.scope) { banner.textContent = state.reason || state.error || 'Refreshing settings…'; refresh.disabled = true; return }
      render(); return
    }
    if (value?.type !== 'result' || !pending || value.requestId !== pending.id || pending.scope !== state?.scope) return
    const request = pending; pending = undefined
    toastEpoch += 1
    if (request.type === 'set-bundle') pendingBundle = undefined
    if (request.type === 'discover-models') {
      if (value.ok && Array.isArray(value.models)) { candidates = value.models; selectedModels.clear(); modelSearch = '' }
    } else if (request.type === 'save-search') {
      if (Array.isArray(value.results)) for (const result of value.results) {
        if (!result.ok) continue
        fields.delete(result.ns)
        if (searchKeyTarget && searchKeyTarget.ns === result.ns && Number.isSafeInteger(result.revision)) searchKeyTarget.revision = result.revision
      }
      if (value.ok || value.keySaved) { searchKey = ''; searchKeyTarget = undefined }
      if (value.ok || value.selectionSaved) { searchMode = undefined; searchSelectionRevision = undefined }
    } else if (request.type === 'save-fields') {
      if (Array.isArray(value.results)) for (const result of value.results) { if (result.ok) fields.delete(result.ns) }
      if (value.ok || value.keySaved) { searchKey = ''; searchKeyRevision = undefined }
      if (value.settingsSaved && request.section === 'search') { fields.delete('web-search-deepseek'); searchKeyRevision = state?.forms.find(form => form.ns === 'web-search-deepseek')?.revision }
    } else if (request.type === 'save-allowed-models' && value.ok) allowed = undefined
    else if (request.type === 'set-bundle') {
      if (value.ok) message = value.restartRequired === true
        ? 'Bundle updated. Restart the DeepSeek Harness runtime to apply the change.'
        : 'Bundle updated.'
    }
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
    else { errors.delete(request.section); if (request.type !== 'discover-models' && request.type !== 'set-bundle' && !value.cancelled) message = 'Saved.' }
    render(); next()
  }
  const refreshPage = (): void => { if (!pending) api.postMessage({ type: 'refresh' }) }
  const close = (): void => { if (options.onClose) options.onClose(); else api.postMessage({ type: 'close' }) }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return }
    if (event.key !== 'Tab') return
    const controls = [...root.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,[tabindex="0"]')].filter(node => !(node as HTMLInputElement).disabled && !node.closest('fieldset:disabled,[hidden],.hidden') && (!node.closest('details:not([open])') || node.matches('summary')) && node.tabIndex >= 0)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const closeButton = root.querySelector<HTMLButtonElement>('#settingsClose')!
  refresh.addEventListener('click', refreshPage); closeButton.addEventListener('click', close); toastClose.addEventListener('click', dismissToast); root.addEventListener('keydown', keydown)
  if (!options.externalMessages) document.defaultView!.addEventListener('message', receive)
  document.defaultView!.addEventListener('resize', revealSection)
  api.postMessage({ type: 'ready' })
  return { receive(value: unknown): void { receive({ data: value } as MessageEvent) }, dispose(): void { document.defaultView!.removeEventListener('message', receive); document.defaultView!.removeEventListener('resize', revealSection); refresh.removeEventListener('click', refreshPage); closeButton.removeEventListener('click', close); toastClose.removeEventListener('click', dismissToast); hideToast(); root.removeEventListener('keydown', keydown); fields.clear(); providerDrafts.clear(); searchKey = ''; searchKeyTarget = undefined; queue = [] } }
}

if (typeof acquireVsCodeApi === 'function' && document.getElementById('settingsRoot')) {
  mountSettingsPage(document, acquireVsCodeApi()); document.getElementById('settingsRoot')!.focus({ preventScroll: true })
}
