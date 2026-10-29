import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type { DshChatController } from './extension.js'
import type { DshBundleChange, DshClient } from './dsh-client.js'
import type { SettingsDescription, SettingsNamespace, SettingsMutation } from './runtime-settings.js'
import { runtimeIsOurs } from './runtime-change.js'
import { redactDshSecrets } from './runtime-output.js'
import { settingsPageHtml } from './settings-page-html.js'
import { at, credentialRef, endpoint, fieldMutations, protocols, providerMutations, providerProfile, providerViews, publicBundles, publicPluginInventory, reasoningLevels, record, searchSettings, searchSelectionMutations, SEARCH_PROFILES, settingsForms, validProviderId,
  type ConfigurableProvider, type CredentialState, type ModelDiscoveryRequest, type SettingsPageState } from './settings-page-state.js'

type Host = Pick<DshChatController, 'state' | 'cwd' | 'runtimeIdentity' | 'runtimeOwnership' | 'onDidChangeState' | 'onDidChangeRuntimeSettings' | 'settings' | 'settingsClient' | 'mutateSettings' | 'start'>
type SettingsSurface = { webview: Pick<vscode.Webview, 'postMessage' | 'onDidReceiveMessage'>; onDidDispose: vscode.Event<void> }
const text = (value: unknown): string => value instanceof Error ? value.message : String(value)
const ALLOWLIST_NS = 'subagent-model-selection-settings'
function apiKey(value: unknown): string {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string') throw new Error('Enter a valid API key.')
  const key = value.trim()
  if (!key || key.length > 16384 || !/^[\x21-\x7E]+$/.test(key) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(key) || /^["']|["']$/.test(key)) throw new Error('Enter the API key itself, without quotes or an environment assignment.')
  return key
}

/** Explain a profile bundle mutation the runtime refused, without forwarding raw diagnostics. */
function bundleFailure(result: DshBundleChange): string {
  const rawCode = result.error?.code
  // The code is runtime text: bound its length and strip control characters
  // before it becomes user-visible copy.
  const code = typeof rawCode === 'string' && rawCode !== '' ? rawCode.replace(/[^\x20-\x7E]/gu, '').slice(0, 64) : undefined
  if (code === 'management-required') return 'This runtime is managed outside this extension. Change bundles from its own plugin manager.'
  if (code === 'incompatible-version') return 'This bundle is not compatible with the running DSH version.'
  if (code === 'unsupported-platform') return 'This bundle does not support the runtime\'s operating system.'
  if (result.application === 'overridden') return 'The change was saved, but a higher-priority profile layer overrides this bundle.'
  if (result.application === 'cancelled') return 'The bundle change was cancelled.'
  if (code !== undefined) return `The runtime refused the bundle change (${code}).`
  return 'The runtime could not change this bundle. Refresh and try again.'
}

/** One settings surface, bound to a runtime client rather than the selected chat. */
export class SettingsPanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private close: (() => void) | undefined
  private embedded: { webview: vscode.Webview; id: string } | undefined
  constructor(private readonly host: Host, private readonly extensionUri: vscode.Uri, private readonly version: string) {}
  dispose(): void { this.close?.(); this.panel?.dispose(); this.panel = undefined; this.embedded = undefined }
  /** Reuse the same fenced settings controller in the chat's modal surface. */
  openEmbedded(webview: vscode.Webview): void {
    if (this.embedded?.webview === webview) { void webview.postMessage({ type: 'settings-open', settingsId: this.embedded.id }); return }
    this.dispose()
    const id = randomUUID(); this.embedded = { webview, id }
    this.bind({ webview: {
      postMessage: value => webview.postMessage({ type: 'settings-message', settingsId: id, message: value }),
      onDidReceiveMessage: listener => webview.onDidReceiveMessage(packet => {
        if (!record(packet) || packet.type !== 'settings-message' || packet.settingsId !== id || !record(packet.message)) return
        if (packet.message.type === 'close') { this.dispose(); return }
        listener(packet.message)
      }),
    }, onDidDispose: () => ({ dispose() {} }) })
    void webview.postMessage({ type: 'settings-open', settingsId: id })
  }
  open(): void {
    if (this.panel) { this.panel.reveal(); return }
    this.dispose()
    const panel = vscode.window.createWebviewPanel('deepseekHarness.settings', 'DeepSeek Settings', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true })
    this.panel = panel
    const assets = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    panel.webview.options = { enableScripts: true, localResourceRoots: [assets] }
    panel.webview.html = settingsPageHtml(panel.webview, panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, 'settings-page.js')))
    this.bind(panel)
  }
  private bind(panel: SettingsSurface): void {
    let disposed = false, ready = false, loading = false, busy = false, pendingRefresh = false, generation = 0
    let client: DshClient | undefined, identity: object | undefined, cwd = this.host.cwd, scope = randomUUID()
    let description: SettingsDescription = { writable: false, hasDocument: false, namespaces: [] }
    let directory: ConfigurableProvider[] = [], registered: { id: string; name: string }[] = [], credentials: Record<string, CredentialState> = {}
    let catalog: SettingsPageState['catalog'] = [], error: string | undefined, modelsError: string | undefined
    let inventory: NonNullable<SettingsPageState['inventory']> = []
    let bundles: NonNullable<SettingsPageState['bundles']> = []
    let timer: NodeJS.Timeout | undefined, lifetime = new AbortController()
    const clean = (value: unknown, secrets: string[] = []): string => redactDshSecrets(text(value), secrets).slice(0, 1500)
    const connected = (): boolean => {
      try { return !!client && this.host.settingsClient() === client && this.host.runtimeIdentity === identity && this.host.cwd === cwd } catch { return false }
    }
    const assertCurrent = (): DshClient => {
      if (disposed || !connected()) throw new Error('The runtime connection changed. Reload settings before continuing.')
      return client!
    }
    const writable = (): boolean => connected() && this.host.state.phase === 'ready' && description.writable && runtimeIsOurs(this.host.runtimeOwnership)
    const requireWrite = (): DshClient => {
      const current = assertCurrent()
      if (!writable()) throw new Error('Settings are read-only or the runtime is reconnecting. Reconnect to a managed runtime before saving.')
      return current
    }
    const namespace = (name: unknown, revision: unknown): SettingsNamespace => {
      const view = description.namespaces.find(item => item.ns === name)
      if (!view || !Number.isSafeInteger(revision) || view.revision !== revision) throw new Error('These settings changed elsewhere. Discard the draft to load the current values.')
      this.host.settingsClient(view)
      return view
    }
    const post = (): void => {
      if (!ready || disposed) return
      const allowed = description.namespaces.find(item => item.ns === ALLOWLIST_NS)
      const routes = at(allowed?.value, ['allowedModels'])
      const pi = description.namespaces.find(item => item.ns === 'llm-pi-ai')
      const search = description.namespaces.find(item => item.ns === 'web-search-deepseek')
      const canWrite = writable()
      const reason = !connected() ? 'Connect to DSH to load settings.' : !runtimeIsOurs(this.host.runtimeOwnership)
        ? 'This external runtime is attach-only. Its settings are available for inspection.'
        : this.host.state.phase !== 'ready' ? 'Wait for the runtime to finish reconnecting.' : !description.writable ? 'The active profile is read-only.' : ''
      const state: SettingsPageState = {
        scope, version: this.version, phase: this.host.state.phase, writable: canWrite, reason, loading,
        forms: settingsForms(description), providers: providerViews(description.namespaces, directory, registered, credentials),
        availableProviders: directory.filter(entry => entry.settingsNs === 'llm-pi-ai' && pi && !providerProfile(pi, entry)).map(entry => ({ id: entry.provider, name: entry.displayName,
          ...(pi && credentials[credentialRef(pi, entry)] ? { credential: credentials[credentialRef(pi, entry)]! } : {}) })),
        protocols: protocols(pi), reasoningLevels: reasoningLevels(pi), ...(pi ? { piRevision: pi.revision } : {}), catalog,
        ...(allowed ? { allowedModels: { ns: allowed.ns, revision: allowed.revision, enabled: at(allowed.value, ['enabled']) === true,
          overridden: at(allowed.user, ['enabled']) !== undefined || at(allowed.user, ['allowedModels']) !== undefined,
          routes: Array.isArray(routes) ? routes.filter(record).filter(row => typeof row.provider === 'string' && typeof row.model === 'string').map(row => ({ provider: row.provider as string, model: row.model as string })) : [] } } : {}),
        ...(search && credentials[credentialRef(search)] ? { searchCredential: credentials[credentialRef(search)]! } : {}),
        ...(search ? { searchExtensionKey: credentialRef(search) === 'DEEPSEEK_API_KEY' } : {}),
        search: searchSettings(description, credentials),
        inventory,
        ...(bundles.length ? { bundles } : {}),
        signedIn: this.host.state.account?.signedIn === true,
        ...(this.host.state.accountNotice ? { accountText: this.host.state.accountNotice.slice(0, 600) } : {}),
        ...(error ? { error } : {}), ...(modelsError ? { modelsError } : {}),
      }
      void panel.webview.postMessage({ type: 'state', state })
    }
    const refresh = async (force = false): Promise<void> => {
      if (disposed) return
      if (busy && !force) { pendingRefresh = true; return }
      const request = ++generation
      let next: DshClient
      try { next = this.host.settingsClient() } catch (cause) {
        if (client) { lifetime.abort(); lifetime = new AbortController(); client = undefined; scope = randomUUID(); description = { writable: false, hasDocument: false, namespaces: [] }; directory = []; catalog = []; inventory = []; bundles = [] }
        error = clean(cause); loading = false; post(); return
      }
      if (next !== client || this.host.runtimeIdentity !== identity || this.host.cwd !== cwd) {
        lifetime.abort(); lifetime = new AbortController(); client = next; identity = this.host.runtimeIdentity; cwd = this.host.cwd; scope = randomUUID()
        description = { writable: false, hasDocument: false, namespaces: [] }; directory = []; registered = []; credentials = {}; catalog = []; inventory = []; bundles = []
      }
      const readScope = scope
      loading = true; error = undefined; modelsError = undefined; post()
      try {
        const [settings, providers, live, models, roster, bundleRoster] = await Promise.allSettled([
          this.host.settings(), next.listConfigurableProviders(), next.listLlmProviders(), next.models(''), next.pluginInventory?.(), next.listBundles?.(),
        ])
        if (disposed || request !== generation || scope !== readScope || !connected()) return
        if (settings.status === 'rejected') throw settings.reason
        description = settings.value
        inventory = roster.status === 'fulfilled' ? publicPluginInventory(roster.value) : []
        // An unavailable read (an older runtime, or an attach-only profile) leaves
        // the bundle section absent; the read-only inventory still renders.
        bundles = bundleRoster.status === 'fulfilled' && Array.isArray(bundleRoster.value) ? publicBundles(bundleRoster.value) : []
        directory = providers.status === 'fulfilled' && Array.isArray(providers.value) ? providers.value : []
        registered = live.status === 'fulfilled' && Array.isArray(live.value) ? live.value : []
        if (providers.status === 'rejected' || live.status === 'rejected') modelsError = 'The provider directory is unavailable. Refresh or check the DSH version.'
        catalog = models.status === 'fulfilled' && Array.isArray(models.value?.groups)
          ? models.value.groups.flatMap(group => (Array.isArray(group.models) ? group.models : []).map(model => ({ provider: group.id, model: model.id, label: `${group.name} / ${model.name ?? model.id}` }))).slice(0, 5000) : []
        if (models.status === 'rejected' || !models.value?.groups) modelsError ??= 'The model catalog is unavailable. Saved model routes remain available for inspection.'
        const refs = new Set<string>()
        for (const entry of directory) {
          const ns = description.namespaces.find(item => item.ns === entry.settingsNs)
          if (ns && ns.ns !== 'llm-deepseek-account') refs.add(credentialRef(ns, entry))
        }
        for (const search of description.namespaces.filter(item => (SEARCH_PROFILES as readonly string[]).includes(item.ns))) refs.add(credentialRef(search))
        credentials = {}
        const list = [...refs]
        for (let index = 0; index < list.length; index += 16) {
          try {
            const batch = await next.describeCredentials(list.slice(index, index + 16))
            if (disposed || request !== generation || scope !== readScope || !connected()) return
            // Copy only the two public capability facts; never forward an arbitrary response.
            for (const ref of list.slice(index, index + 16)) if (record(batch[ref])) credentials[ref] = { configured: batch[ref]!.configured === true, writable: batch[ref]!.writable === true }
          } catch { modelsError = 'Credential status is unavailable. Credential changes are disabled until it can be refreshed.' }
        }
      } catch (cause) {
        if (disposed || request !== generation || scope !== readScope) return
        error = clean(cause); description = { ...description, writable: false }
      } finally {
        if (!disposed && request === generation && scope === readScope) { loading = false; post() }
      }
    }
    const schedule = (): void => {
      if (busy) { pendingRefresh = true; return }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; void refresh() }, 80)
    }
    const write = async (view: SettingsNamespace, ops: SettingsMutation[]): Promise<SettingsNamespace> => {
      requireWrite(); this.host.settingsClient(view)
      if (!ops.length) return view
      const saved = await this.host.mutateSettings(view, ops)
      assertCurrent()
      if (!saved || saved.ns !== view.ns || !Number.isSafeInteger(saved.revision)) throw new Error('DSH did not confirm the saved settings. Reload before retrying.')
      return saved
    }
    const checkSearchRevision = (fresh: SettingsDescription, revision: number | undefined): void => {
      if (revision !== undefined && fresh.namespaces.find(item => item.ns === 'web')?.revision !== revision) throw new Error('The search selection changed. Discard the draft before retrying.')
    }
    const storeKey = async (name: string, provider: ConfigurableProvider | undefined, ref: string, value: string, revision: number, selectionRevision?: number): Promise<void> => {
      if (!value || value !== value.trim() || !/^[\x21-\x7E]+$/.test(value) || value.length > 16384) throw new Error('Enter the API key itself, without quotes, whitespace or an environment assignment.')
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value) || /^["']|["']$/.test(value)) throw new Error('Enter the API key itself, without quotes or an environment assignment.')
      const current = requireWrite()
      const fresh = await this.host.settings(); assertCurrent()
      checkSearchRevision(fresh, selectionRevision)
      const ns = fresh.namespaces.find(item => item.ns === name)
      if (!ns || ns.revision !== revision || credentialRef(ns, provider) !== ref) throw new Error('The credential target changed. Reload this provider before retrying.')
      const state = await current.describeCredentials([ref]); requireWrite()
      if (!state[ref]?.writable) throw new Error('This key is supplied by a read-only credential source.')
      const checkedDescription = await this.host.settings(); requireWrite()
      checkSearchRevision(checkedDescription, selectionRevision)
      const checked = checkedDescription.namespaces.find(item => item.ns === name)
      if (!checked || checked.revision !== revision || credentialRef(checked, provider) !== ref) throw new Error('The credential target changed. Reload this provider before retrying.')
      await current.setCredential(ref, value); assertCurrent()
    }
    const run = async (message: Record<string, unknown>): Promise<void> => {
      const requestId = message.requestId
      if (typeof requestId !== 'string' || requestId.length > 100 || !requestId) return
      if (busy) { void panel.webview.postMessage({ type: 'result', requestId, ok: false, error: 'Wait for the current settings operation.' }); return }
      if (message.scope !== scope) { void panel.webview.postMessage({ type: 'result', requestId, ok: false, error: 'The runtime connection changed. Reload settings.' }); return }
      ++generation; loading = false
      busy = true
      const operationScope = scope
      const secrets = typeof message.apiKey === 'string' ? [message.apiKey, message.apiKey.trim()] : []
      let settingsSaved = false, promotedProvider: string | undefined
      try {
        const current = assertCurrent()
        const keyInput = apiKey(message.apiKey)
        if (message.type === 'set-bundle') {
          if (!runtimeIsOurs(this.host.runtimeOwnership)) throw new Error('This external runtime is attach-only. Change its plugin bundles from the runtime that owns them.')
          requireWrite()
          // A running task is not a reason to refuse the change: the runtime
          // owns that decision and answers with `applied` or `restart-required`,
          // which the result below already surfaces.
          const name = message.name, enabled = message.enabled
          if (typeof name !== 'string' || name === '' || typeof enabled !== 'boolean') throw new Error('Invalid bundle change.')
          const bundle = bundles.find(item => item.name === name && item.optional)
          if (!bundle) throw new Error('This bundle is unavailable in the current runtime. Refresh settings and try again.')
          if (bundle.enabled === enabled) {
            void panel.webview.postMessage({ type: 'result', requestId, ok: true, application: 'applied', unchanged: true })
            return
          }
          const label = bundle.title ?? name
          const action = enabled ? 'Enable' : 'Disable'
          const choice = await vscode.window.showWarningMessage(`${action} ${label}?`, {
            modal: true,
            detail: 'This changes the shared DSH web profile for every project that uses it. '
              + (enabled ? 'The optional capability stays available until it is disabled again.' : 'The capability is removed from new sessions; its saved settings are retained.')
              + ' A runtime restart may be required.',
          }, action)
          requireWrite()
          if (choice !== action) { void panel.webview.postMessage({ type: 'result', requestId, ok: false, cancelled: true }); return }
          const result = await requireWrite().setBundleEnabled(name, enabled)
          await refresh(true); assertCurrent()
          if (!result || typeof result.application !== 'string') throw new Error('DSH did not confirm the bundle change. Reload settings before retrying.')
          const ok = result.application === 'applied' || result.application === 'restart-required'
          void panel.webview.postMessage({ type: 'result', requestId, ok, application: result.application,
            restartRequired: result.application === 'restart-required',
            ...(ok ? {} : { error: bundleFailure(result), ...(result.error?.code === undefined ? {} : { code: result.error.code }) }) })
          return
        }
        if (message.type === 'save-search') {
          requireWrite()
          if (!Array.isArray(message.changes) || message.changes.length > 2) throw new Error('Invalid search settings changes.')
          const web = description.namespaces.some(ns => ns.ns === 'web') ? namespace('web', message.selectionRevision) : undefined
          if (!web && message.selection !== undefined) throw new Error('Search / Fetch selection is unavailable.')
          const selection = message.selection
          if (selection !== undefined && (!record(selection) || typeof selection.enabled !== 'boolean')) throw new Error('Invalid search selection.')
          const selectionOps = web && record(selection) ? searchSelectionMutations(web, selection.enabled) : []
          const selectedApi = record(selection) ? selection.enabled === true : at(web?.value, ['searchProvider']) === 'deepseek-search-api'
          if (selectedApi && !description.namespaces.some(ns => ns.ns === 'web-deepseek-api')) throw new Error('Search / Fetch API is unavailable.')
          const names = new Set<string>()
          const plans = message.changes.map(change => {
            if (!record(change) || !(SEARCH_PROFILES as readonly unknown[]).includes(change.ns) || names.has(String(change.ns))) throw new Error('Invalid search settings changes.')
            const ns = namespace(change.ns, change.revision); names.add(ns.ns)
            return { ns, ops: fieldMutations(ns, change.values) }
          }).sort((a, b) => SEARCH_PROFILES.indexOf(a.ns.ns as typeof SEARCH_PROFILES[number]) - SEARCH_PROFILES.indexOf(b.ns.ns as typeof SEARCH_PROFILES[number]))
          const keyTarget = keyInput ? namespace(message.keyNamespace, message.keyRevision) : undefined
          if (keyTarget && keyTarget.ns !== (selectedApi ? 'web-deepseek-api' : 'web-search-deepseek')) throw new Error('The search credential target does not match the selected API.')
          const ref = keyTarget ? credentialRef(keyTarget) : undefined
          const results: { ns: string; ok: boolean; revision?: number }[] = []
          let keySaved = false, selectionSaved = false, failure: string | undefined
          try {
            for (const plan of plans) {
              try { const saved = await write(plan.ns, plan.ops); results.push({ ns: plan.ns.ns, ok: true, revision: saved.revision }) }
              catch (cause) { results.push({ ns: plan.ns.ns, ok: false }); throw cause }
            }
            if (keyTarget && ref) {
              const revision = results.find(result => result.ns === keyTarget.ns && result.ok)?.revision ?? keyTarget.revision
              await storeKey(keyTarget.ns, undefined, ref, keyInput, revision, web?.revision); keySaved = true
            }
            if (web && selectionOps.length) { await write(web, selectionOps); selectionSaved = true }
          } catch (cause) { failure = clean(cause, secrets) }
          await refresh(true); assertCurrent()
          void panel.webview.postMessage({ type: 'result', requestId, ok: failure === undefined, results, keySaved, selectionSaved,
            ...(failure ? { error: failure } : {}) })
          return
        }
        if (message.type === 'save-fields') {
          requireWrite()
          if (!Array.isArray(message.changes) || message.changes.length > 4) throw new Error('Invalid settings changes.')
          const plans = message.changes.map(change => {
            if (!record(change)) throw new Error('Invalid settings changes.')
            const ns = namespace(change.ns, change.revision)
            return { ns, ops: fieldMutations(ns, change.values) }
          })
          const results: { ns: string; ok: boolean; revision?: number; error?: string }[] = []
          for (const plan of plans) {
            try { const saved = await write(plan.ns, plan.ops); results.push({ ns: plan.ns.ns, ok: true, revision: saved.revision }) }
            catch (cause) { results.push({ ns: plan.ns.ns, ok: false, error: clean(cause, secrets) }) }
          }
          let keySaved = false, keyError: string | undefined
          if (keyInput) {
            const search = description.namespaces.find(item => item.ns === 'web-search-deepseek')
            if (!search || !plans.every(plan => plan.ns.ns === search.ns)) throw new Error('Invalid search credential target.')
            settingsSaved = results.some(item => item.ok)
            try {
              const revision = results.find(item => item.ns === search.ns && item.ok)?.revision
              if (revision === undefined) throw new Error('Resolve the search settings error before updating its key.')
              await storeKey(search.ns, undefined, credentialRef(search), keyInput, revision); keySaved = true
            }
            catch (cause) { keyError = clean(cause, secrets) }
          }
          await refresh(true); assertCurrent()
          const failure = keyError ?? results.find(result => !result.ok)?.error
          void panel.webview.postMessage({ type: 'result', requestId, ok: results.every(result => result.ok) && !keyError, results, keySaved, settingsSaved,
            ...(failure ? { error: failure } : {}) })
          return
        }
        if (message.type === 'save-allowed-models') {
          const ns = namespace(ALLOWLIST_NS, message.revision)
          let ops: SettingsMutation[]
          if (message.reset === true) ops = ['enabled', 'allowedModels'].map(key => ({ op: 'unset', path: [key] }))
          else {
            if (typeof message.enabled !== 'boolean' || !Array.isArray(message.routes) || message.routes.length > 5000) throw new Error('Invalid subagent model selection.')
            const existing = at(ns.value, ['allowedModels'])
            const known = new Set([...catalog, ...(Array.isArray(existing) ? existing.filter(record) : [])].map(route => JSON.stringify([route.provider, route.model])))
            const unique = new Map<string, { provider: string; model: string }>()
            for (const route of message.routes) {
              if (!record(route) || typeof route.provider !== 'string' || typeof route.model !== 'string' || !known.has(JSON.stringify([route.provider, route.model]))) throw new Error('Select an advertised or previously saved model route.')
              unique.set(JSON.stringify([route.provider, route.model]), { provider: route.provider, model: route.model })
            }
            if (message.enabled && !unique.size) throw new Error('Select at least one model before enabling subagent model selection.')
            ops = [{ op: 'set', path: ['enabled'], value: message.enabled }, { op: 'set', path: ['allowedModels'], value: [...unique.values()] }]
          }
          await write(ns, ops)
        } else if (message.type === 'save-provider' || message.type === 'create-provider') {
          requireWrite()
          const creating = message.type === 'create-provider'
          if (creating) validProviderId(message.provider)
          else if (typeof message.provider !== 'string') throw new Error('Choose a valid provider.')
          let entry = directory.find(item => item.provider === message.provider)
          const ns = namespace(creating ? 'llm-pi-ai' : entry?.settingsNs, message.revision)
          if (!['llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account'].includes(ns.ns)) throw new Error('This provider cannot be edited here.')
          if (creating && at(ns.value, ['providers', message.provider as string]) !== undefined) throw new Error('This provider ID is already configured.')
          if (creating && entry && (entry.settingsNs !== ns.ns || providerProfile(ns, entry))) throw new Error('This provider ID is already configured.')
          if (!entry && !creating) throw new Error('This provider is no longer available.')
          if (creating && !entry && registered.some(row => row.id === message.provider)) throw new Error('This provider ID is already registered.')
          const custom = creating && !entry
          if (!entry) entry = { provider: message.provider, displayName: message.provider, settingsNs: ns.ns, settingsPath: ['providers', message.provider], declared: true }
          const changes = record(message.fields) ? message.fields : {}
          const ops = providerMutations(ns, entry, changes)
          if (custom && (typeof changes.baseURL !== 'string' || !changes.baseURL || typeof changes.api !== 'string' || !changes.api || !Array.isArray(changes.models) || !changes.models.length)) throw new Error('A custom API requires an endpoint, protocol and at least one model.')
          const key = keyInput
          if (ns.ns === 'llm-deepseek-account' && key) throw new Error('The DeepSeek account route uses account sign-in.')
          const ref = credentialRef(ns, entry)
          let saved: SettingsNamespace
          if (creating) {
            const profile: Record<string, unknown> = {}
            for (const op of ops) if (op.op === 'set') profile[op.path.at(-1)!] = op.value
            if (key) profile.apiKeyEnv = ref
            saved = await write(ns, [{ op: 'set', path: [...entry.settingsPath], value: profile }])
            promotedProvider = entry.provider
          } else {
            if (key && at(providerProfile(ns, entry), ['apiKeyEnv']) === undefined) ops.push({ op: 'set', path: [...entry.settingsPath, 'apiKeyEnv'], value: ref })
            saved = await write(ns, ops)
          }
          settingsSaved = true
          if (key) await storeKey(ns.ns, entry, ref, key, saved.revision)
        } else if (message.type === 'remove-provider') {
          requireWrite()
          const entry = directory.find(item => item.provider === message.provider)
          const ns = namespace(entry?.settingsNs, message.revision)
          if (!entry || !entry.settingsPath.length || at(ns.user, entry.settingsPath) === undefined || at(ns.base, entry.settingsPath) !== undefined) throw new Error('Only a provider configured in the user layer can be removed.')
          const choice = await vscode.window.showWarningMessage(`Remove ${entry.displayName}?`, { modal: true, detail: 'This removes the provider override. Saved credentials are retained.' }, 'Remove')
          requireWrite()
          if (choice !== 'Remove') { void panel.webview.postMessage({ type: 'result', requestId, ok: false, cancelled: true }); return }
          await write(ns, [{ op: 'unset', path: [...entry.settingsPath] }])
        } else if (message.type === 'clear-key') {
          requireWrite()
          const entry = directory.find(item => item.provider === message.provider)
          const search = message.provider === 'web-search'
          if (search && message.ns !== undefined && !(SEARCH_PROFILES as readonly unknown[]).includes(message.ns)) throw new Error('Invalid search credential target.')
          const selectionRevision = search && message.ns !== undefined && description.namespaces.some(item => item.ns === 'web') ? namespace('web', message.selectionRevision).revision : undefined
          const ns = namespace(search ? message.ns ?? 'web-search-deepseek' : entry?.settingsNs, message.revision)
          if (message.provider !== 'web-search' && (!entry || ns.ns === 'llm-deepseek-account')) throw new Error('This credential target is unavailable.')
          const ref = credentialRef(ns, entry)
          const choice = await vscode.window.showWarningMessage('Clear this saved API key?', { modal: true, detail: 'A model provider and web search can share a key. This clears only a writable stored key, not an environment credential.' }, 'Clear key')
          requireWrite()
          if (choice !== 'Clear key') { void panel.webview.postMessage({ type: 'result', requestId, ok: false, cancelled: true }); return }
          const fresh = await this.host.settings(); requireWrite()
          checkSearchRevision(fresh, selectionRevision)
          const latest = fresh.namespaces.find(item => item.ns === ns.ns)
          if (!latest || latest.revision !== ns.revision || credentialRef(latest, entry) !== ref) throw new Error('The credential target changed. Reload this page.')
          const capability = await current.describeCredentials([ref]); requireWrite()
          if (!capability[ref]?.writable) throw new Error('This credential source is read-only.')
          const checkedDescription = await this.host.settings(); requireWrite()
          checkSearchRevision(checkedDescription, selectionRevision)
          const checked = checkedDescription.namespaces.find(item => item.ns === ns.ns)
          if (!checked || checked.revision !== ns.revision || credentialRef(checked, entry) !== ref) throw new Error('The credential target changed. Reload this page.')
          await current.unsetCredential(ref); assertCurrent()
        } else if (message.type === 'discover-models') {
          const ns = namespace(message.ns, message.revision)
          if (!['llm-deepseek', 'llm-pi-ai'].includes(ns.ns)) throw new Error('Model discovery is unavailable for this provider.')
          const request: ModelDiscoveryRequest = {}
          if (typeof message.provider === 'string' && directory.some(item => item.provider === message.provider && item.settingsNs === ns.ns)) request.provider = message.provider
          if (typeof message.baseURL === 'string' && message.baseURL) request.baseURL = endpoint(message.baseURL)
          if (typeof message.api === 'string' && message.api) request.api = message.api
          if (keyInput) request.apiKey = keyInput
          const models = await current.discoverModels(ns.ns, request, lifetime.signal); assertCurrent()
          const safe = models.filter(model => typeof model.id === 'string').slice(0, 5000).map(model => ({ id: model.id,
            ...(typeof model.name === 'string' ? { name: model.name } : {}), ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
            ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}), ...(Array.isArray(model.inputModalities) ? { inputModalities: model.inputModalities.filter(value => value === 'text' || value === 'image') } : {}) }))
          void panel.webview.postMessage({ type: 'result', requestId, ok: true, models: safe })
          return
        } else throw new Error('Unknown settings action.')
        await refresh(true); assertCurrent()
        if (operationScope === scope) void panel.webview.postMessage({ type: 'result', requestId, ok: true, ...(promotedProvider ? { promotedProvider } : {}) })
      } catch (cause) {
        if (connected()) await refresh(true)
        if (!disposed && operationScope === scope) void panel.webview.postMessage({ type: 'result', requestId, ok: false, error: clean(cause, secrets), settingsSaved,
          ...(promotedProvider ? { promotedProvider } : {}) })
      } finally {
        busy = false
        if (pendingRefresh && !disposed) { pendingRefresh = false; schedule() }
      }
    }
    let lastPhase = this.host.state.phase, lastSignedIn = this.host.state.account?.signedIn, lastAccountText = this.host.state.accountNotice
    const disposables = [
      panel.webview.onDidReceiveMessage((value: unknown) => {
        if (!record(value) || typeof value.type !== 'string') return
        if (value.type === 'close') { this.panel?.dispose(); return }
        if (value.type === 'ready') { ready = true; void refresh(); return }
        if (value.type === 'refresh') { void refresh(); return }
        if (value.type === 'native-action') {
          const commands: Record<string, string> = { theme: 'workbench.action.selectTheme', shortcuts: 'workbench.action.openGlobalKeybindings', 'extension-settings': 'workbench.action.openSettings', plugins: 'deepseekHarness.managePlugins' }
          const command = typeof value.action === 'string' ? commands[value.action] : undefined
          if (command) void vscode.commands.executeCommand(command, ...(value.action === 'extension-settings' ? ['@ext:fallleaves01.dsh-sidebar'] : []))
          else if (value.action === 'search-guide') void vscode.env.openExternal(vscode.Uri.parse('https://api-docs.deepseek.com/guides/search'))
          else if (value.action === 'connect') void this.host.start().then(() => refresh(), cause => { error = clean(cause); post() })
          else if (!busy && value.scope === scope && writable() && ['sign-in', 'sign-out', 'extension-key'].includes(String(value.action))) {
            void vscode.commands.executeCommand(value.action === 'sign-in' ? 'deepseekHarness.signIn' : value.action === 'sign-out' ? 'deepseekHarness.signOut' : 'deepseekHarness.configureApiKey')
          }
          return
        }
        void run(value)
      }),
      this.host.onDidChangeRuntimeSettings(schedule),
      this.host.onDidChangeState(() => {
        const changed = lastPhase !== this.host.state.phase || lastSignedIn !== this.host.state.account?.signedIn
        const accountChanged = lastAccountText !== this.host.state.accountNotice
        lastPhase = this.host.state.phase; lastSignedIn = this.host.state.account?.signedIn; lastAccountText = this.host.state.accountNotice
        if (!connected() && client) {
          ++generation; lifetime.abort(); client = undefined; scope = randomUUID(); description = { writable: false, hasDocument: false, namespaces: [] }; directory = []; catalog = []; inventory = []; bundles = []; post(); schedule()
        } else if (changed || (!client && lastPhase === 'ready')) { post(); if (lastPhase === 'ready') schedule() }
        else if (accountChanged) post()
      }),
      panel.onDidDispose(() => { this.close?.(); this.panel = undefined }),
    ]
    this.close = () => { if (disposed) return; disposed = true; ++generation; lifetime.abort(); if (timer) clearTimeout(timer); for (const item of disposables) item.dispose(); this.close = undefined }
  }
}
