import type { SettingsDescription, SettingsMutation, SettingsNamespace, SettingsSchemaNode } from './runtime-settings.js'

export interface ConfigurableProvider {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  declared?: boolean
  error?: string
}
export interface CredentialState { configured: boolean; writable: boolean }
export interface DiscoveredModel { id: string; name?: string; contextWindow?: number; maxTokens?: number; inputModalities?: readonly string[] }
export interface ModelDiscoveryRequest { provider?: string; baseURL?: string; api?: string; apiKey?: string }
export interface SettingsFieldChoice { value: string; label: string }
export interface SettingsFieldView {
  key: string; label: string; type: 'number' | 'string' | 'boolean' | 'select' | 'string-list'; value?: unknown; inherited?: unknown
  overridden: boolean; min?: number; max?: number; integer?: boolean; description?: string
  /** Present for `select` fields: the schema's closed set of accepted values. */
  options?: SettingsFieldChoice[]
}
export interface SettingsFormView { ns: string; title: string; section: string; revision: number; fields: SettingsFieldView[]; restart: boolean }
export interface ModelDraft {
  id: string; originalId?: string; name?: string; contextWindow?: number; maxTokens?: number; input?: string[]
  reasoningEfforts?: Record<string, string | null> | false
}
export interface ProviderView {
  id: string; name: string; ns: string; revision: number; declared: boolean; removable: boolean; account: boolean
  active: boolean; baseURL: string; api: string; models: ModelDraft[]; modelsOverridden: boolean; credential?: CredentialState
  error?: string; extensionKey: boolean
  reasoningLevels?: string[]
}
export interface SearchSettingsView {
  selection?: { revision: number; enabled: boolean; available: boolean }
  profiles: { ns: string; revision: number; credential?: CredentialState; extensionKey: boolean }[]
}
export interface SettingsPageState {
  scope: string; version: string; phase: string; writable: boolean; reason: string; loading: boolean
  forms: SettingsFormView[]; providers: ProviderView[]; availableProviders: { id: string; name: string; credential?: CredentialState }[]
  protocols: string[]; piRevision?: number; catalog: { provider: string; model: string; label: string }[]
  reasoningLevels?: string[]
  allowedModels?: { ns: string; revision: number; enabled: boolean; overridden: boolean; routes: { provider: string; model: string }[] }
  searchCredential?: CredentialState
  searchExtensionKey?: boolean
  search?: SearchSettingsView
  inventory?: { label: string; rows: { name: string; status: string }[] }[]
  /** Optional profile bundles, when the runtime serves `pluginManager/listBundles`. */
  bundles?: BundleView[]
  signedIn: boolean; accountText?: string; error?: string; modelsError?: string
}

/**
 * One profile bundle reduced to the facts the plugins page may display.
 *
 * The wire row also carries an icon data URL, install source paths, patch rows
 * and raw diagnostics; none of those may reach the Webview. This projection is
 * the security boundary: unknown properties are dropped rather than forwarded,
 * and every retained string is length-capped.
 */
export interface BundleView {
  name: string
  official: boolean
  availability?: 'profile' | 'installation' | 'missing'
  version?: string
  title?: string
  description?: string
  enabled: boolean
  installed: boolean
  optional: boolean
  removable: boolean
  /** alpha2: undefined on older runtimes, where every bundle is listed. */
  listedByDefault?: boolean
  /** alpha2: whether the bundle can be updated; false on older runtimes. */
  updatable: boolean
  /** A whitelisted failure code from the bundle row; diagnostics are never projected. */
  errorCode?: string
  readOnlyReason?: 'management-required' | 'unaddressable'
}

const BUNDLE_AVAILABILITY = new Set(['profile', 'installation', 'missing'])
const BUNDLE_READ_ONLY = new Set(['management-required', 'unaddressable'])
// Only these codes are safe to show as a classified failure; the raw error text
// can quote paths and is deliberately dropped.
const BUNDLE_ERROR_CODES = new Set(['management-required', 'unaddressable', 'unsupported-platform', 'incompatible-version', 'operation-error'])
function localized(value: unknown, limit: number): string | undefined {
  if (typeof value === 'string') return value.slice(0, limit) || undefined
  if (!record(value)) return undefined
  for (const key of ['en', 'zh']) {
    const text = value[key]
    if (typeof text === 'string' && text !== '') return text.slice(0, limit)
  }
  return undefined
}
/** Project `pluginManager/listBundles` without icons, local paths or raw errors. */
export function publicBundles(value: unknown): BundleView[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.filter(record).slice(0, 100).flatMap((row): BundleView[] => {
    if (typeof row.name !== 'string' || row.name === '' || seen.has(row.name)) return []
    seen.add(row.name)
    const availability = typeof row.availability === 'string' && BUNDLE_AVAILABILITY.has(row.availability) ? row.availability as BundleView['availability'] : undefined
    const readOnlyReason = typeof row.readOnlyReason === 'string' && BUNDLE_READ_ONLY.has(row.readOnlyReason) ? row.readOnlyReason as BundleView['readOnlyReason'] : undefined
    const rowError = record(row.error) ? row.error : undefined
    const errorCode = typeof rowError?.code === 'string' && BUNDLE_ERROR_CODES.has(rowError.code) ? rowError.code : undefined
    const listedByDefault = typeof row.listedByDefault === 'boolean' ? row.listedByDefault : undefined
    const meta = record(row.meta) ? row.meta : undefined
    const title = localized(meta?.title, 300)
    const description = localized(meta?.description, 1200) ?? (typeof row.description === 'string' ? row.description.slice(0, 1200) || undefined : undefined)
    return [{
      name: row.name.slice(0, 300),
      official: row.official === true,
      ...(availability === undefined ? {} : { availability }),
      ...(typeof row.version === 'string' ? { version: row.version.slice(0, 100) } : {}),
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      enabled: row.enabled === true,
      installed: row.installed === true,
      optional: row.optional === true,
      removable: row.removable === true,
      ...(listedByDefault === undefined ? {} : { listedByDefault }),
      updatable: row.updatable === true,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
    }]
  })
}

/** Project the read-only roster without configuration, conditions, paths, or errors. */
export function publicPluginInventory(value: unknown): NonNullable<SettingsPageState['inventory']> {
  if (!record(value) || !Array.isArray(value.entries)) return []
  const group = (label: string, rows: unknown[]): NonNullable<SettingsPageState['inventory']>[number] => ({ label: label.slice(0, 300), rows: rows.filter(record).filter(row => typeof row.moduleName === 'string').slice(0, 1000).map(row => ({
    name: (row.moduleName as string).slice(0, 300), status: row.enabled === false ? 'Disabled' : row.enabled === 'conditional' ? 'Conditional' : row.fiberPhase === 'failed' ? 'Failed' : row.fiberPhase === 'active' ? 'Active' : row.fiberPhase === 'loading' ? 'Loading' : 'Configured',
  })) })
  return [...(Array.isArray(value.agentPresets) ? value.agentPresets.filter(record).slice(0, 100).map(preset => group('Agent preset: ' + String(preset.name ?? preset.id ?? ''), Array.isArray(preset.rows) ? preset.rows : [])) : []), group('Global runtime', value.entries)]
}

export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const credentialQuery = /^(?:token|access_token|refresh_token|client_secret|api[_-]?key|password|key|authorization)$/i
const safeSegment = (key: string): boolean => !['__proto__', 'prototype', 'constructor'].includes(key)
export function at(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (!safeSegment(key) || !record(current) || !Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}
export function schemaAt(namespace: SettingsNamespace, path: readonly string[]): SettingsSchemaNode | undefined {
  if (!namespace.schema || !record(namespace.schema.refs)) return undefined
  let node = namespace.schema.refs[String(namespace.schema.uid)]
  for (const key of path) {
    if (!safeSegment(key) || node?.dict?.[key] === undefined) return undefined
    node = namespace.schema.refs[String(node.dict[key])]
  }
  return node
}

interface SettingsFieldSpec {
  key: string
  label: string
  type: SettingsFieldView['type']
  min?: number
  max?: number
  integer?: boolean
  description?: string
}
interface SettingsFormSpec { ns: string; section: string; title: string; fields: readonly SettingsFieldSpec[] }

// These fields are the official settings cards, rather than every YAML field.
const forms: readonly SettingsFormSpec[] = [
  { ns: 'session-log-deepseek', section: 'general', title: 'Privacy', fields: [{ key: 'enabled', label: 'Upload session logs with official model API requests', type: 'boolean' }] },
  ...(['bash-sandbox', 'pwsh-sandbox'] as const).map((ns): SettingsFormSpec => ({ ns, section: 'shell', title: 'Shell', fields: [
    { key: 'timeoutMs', label: 'Command timeout (ms)', type: 'number' },
    { key: 'maxOutputBytes', label: 'Output retained per stream (bytes)', type: 'number' },
  ] })),
  { ns: 'agent-loop', section: 'agent', title: 'Agent loop', fields: [{ key: 'maxParallelToolCalls', label: 'Parallel tool calls', type: 'number', min: 1, integer: true }] },
  { ns: 'subagent', section: 'subagents', title: 'Subagent limits', fields: [
    { key: 'maxDepth', label: 'Maximum delegation depth', type: 'number', min: 0, integer: true },
    { key: 'maxActiveSubagents', label: 'Maximum active subagents', type: 'number', min: 1, integer: true },
  ] },
  { ns: 'web-search-deepseek', section: 'search', title: 'Web search', fields: [
    { key: 'baseURL', label: 'Endpoint', type: 'string' },
    { key: 'maxUses', label: 'Searches per request', type: 'number', min: 1, integer: true },
  ] },
  { ns: 'web-deepseek-api', section: 'search', title: 'Search / Fetch API', fields: [
    { key: 'baseURL', label: 'Search / Fetch API base URL', type: 'string' },
    { key: 'count', label: 'Results per search', type: 'number', min: 1, max: 50, integer: true },
  ] },
  // DSH 0.2.1-rc.3 experimental settings namespaces. Each appears only while
  // its optional bundle is enabled, because the Host omits inactive entries
  // from `settings/describe`; a missing namespace therefore hides its tab.
  { ns: 'cot-translation', section: 'translation', title: 'Reasoning translation', fields: [
    { key: 'provider', label: 'Provider', type: 'select' },
    { key: 'targetLanguage', label: 'Target language', type: 'string', description: 'Use auto to follow the interface language, or enter a language tag such as zh-CN.' },
  ] },
  { ns: 'speech-to-text', section: 'voice', title: 'Voice input', fields: [
    { key: 'defaultProvider', label: 'Recognizer', type: 'string' },
    { key: 'language', label: 'Language', type: 'string' },
  ] },
  { ns: 'plugin-market', section: 'market', title: 'Plugin market', fields: [
    { key: 'indexes', label: 'Index sources', type: 'string-list', description: 'Enter one HTTP(S) index URL per line. Duplicate URLs are removed when saved.' },
  ] },
]

/** Upper bound for one settings string value; the host schemas impose no length. */
const MAX_SETTINGS_STRING = 1024

export const SEARCH_PROFILES = ['web-search-deepseek', 'web-deepseek-api'] as const
export function searchSettings(description: SettingsDescription, credentials: Record<string, CredentialState>): SearchSettingsView {
  const web = description.namespaces.find(ns => ns.ns === 'web')
  const profiles = description.namespaces.filter(ns => (SEARCH_PROFILES as readonly string[]).includes(ns.ns))
  return {
    ...(web ? { selection: { revision: web.revision, enabled: at(web.value, ['searchProvider']) === 'deepseek-search-api',
      available: profiles.some(ns => ns.ns === 'web-deepseek-api') && ['searchProvider', 'fetchProvider'].every(key => schemaAt(web, [key])?.type === 'string') } } : {}),
    profiles: profiles.map(ns => ({ ns: ns.ns, revision: ns.revision, extensionKey: credentialRef(ns) === 'DEEPSEEK_API_KEY',
      ...(credentials[credentialRef(ns)] ? { credential: { configured: credentials[credentialRef(ns)]!.configured === true, writable: credentials[credentialRef(ns)]!.writable === true } } : {}) })),
  }
}
export function searchSelectionMutations(namespace: SettingsNamespace, enabled: unknown): SettingsMutation[] {
  if (namespace.ns !== 'web' || typeof enabled !== 'boolean' || !['searchProvider', 'fetchProvider'].every(key => schemaAt(namespace, [key])?.type === 'string')) throw new Error('Search / Fetch selection is unavailable.')
  return Object.entries(enabled ? { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' } : { searchProvider: 'deepseek-official', fetchProvider: 'http' })
    .map(([key, value]) => at(namespace.base, [key]) === value ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value })
}

/** Human-readable labels for the closed choices DSH schemas declare. */
const CHOICE_LABELS: Readonly<Record<string, string>> = {
  bing: 'Bing',
  google: 'Google',
  'deepseek-account': 'DeepSeek Account',
  'deepseek-official': 'DeepSeek API',
}

function selectOptions(namespace: SettingsNamespace, node: SettingsSchemaNode): SettingsFieldChoice[] | undefined {
  if (node.type !== 'union' || !Array.isArray(node.list)) return undefined
  const refs = namespace.schema.refs
  const options: SettingsFieldChoice[] = []
  for (const uid of node.list) {
    const choice = refs[String(uid)]
    if (choice?.type !== 'const' || typeof choice.value !== 'string') return undefined
    options.push({ value: choice.value, label: CHOICE_LABELS[choice.value] ?? choice.value })
  }
  return options.length ? options : undefined
}

function arrayItemType(namespace: SettingsNamespace, node: SettingsSchemaNode): string | undefined {
  return node.inner === undefined ? undefined : namespace.schema.refs[String(node.inner)]?.type
}

export function settingsForms(description: SettingsDescription): SettingsFormView[] {
  return forms.flatMap(spec => {
    const namespace = description.namespaces.find(item => item.ns === spec.ns)
    if (!namespace) return []
    const fields: SettingsFieldView[] = spec.fields.flatMap(field => {
      const node = schemaAt(namespace, [field.key])
      if (!node || node.meta?.role === 'secret' || (namespace.secrets ?? []).some(secret => secret.path[0] === field.key)) return []
      const options = field.type === 'select' ? selectOptions(namespace, node) : undefined
      const shapeAccepted = field.type === 'select'
        ? options !== undefined
        : field.type === 'string-list'
          ? node.type === 'array' && arrayItemType(namespace, node) === 'string'
          : node.type === field.type
      if (!shapeAccepted) return []
      const value = at(namespace.value, [field.key]), inherited = at(namespace.base, [field.key])
      const publicValue = field.key === 'baseURL' ? publicEndpoint(value) : value
      const publicInherited = field.key === 'baseURL' ? publicEndpoint(inherited) : inherited
      const project = (raw: unknown): unknown => {
        if (field.type === 'string-list') return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').slice(0, 32) : undefined
        if (field.type === 'select') return typeof raw === 'string' ? raw : undefined
        return typeof raw === field.type ? raw : undefined
      }
      return [{ key: field.key, label: field.label, type: field.type, ...(options === undefined ? {} : { options }),
        value: project(publicValue), inherited: project(publicInherited),
        overridden: at(namespace.user, [field.key]) !== undefined,
        ...(field.description !== undefined ? { description: field.description } : typeof node.meta?.description === 'string' ? { description: node.meta.description } : {}),
        ...(value && publicValue === undefined && field.key === 'baseURL' ? { description: 'Embedded credentials are hidden. Re-enter the endpoint without credentials to change it.' } : {}),
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
        ...(field.integer === true ? { integer: true } : {}),
        ...(typeof node.meta?.min === 'number' ? { min: node.meta.min } : {}),
        ...(typeof node.meta?.max === 'number' ? { max: node.meta.max } : {}),
      }]
    })
    return fields.length ? [{ ns: namespace.ns, title: spec.title, section: spec.section, revision: namespace.revision, fields, restart: namespace.applies === 'restart' }] : []
  })
}

export function endpoint(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Enter a valid HTTP or HTTPS endpoint.') }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS endpoint.')
  if (url.username || url.password || [...url.searchParams.keys()].some(key => credentialQuery.test(key))) {
    throw new Error('Enter credentials in the API key field, not in the endpoint.')
  }
  return value
}
function publicEndpoint(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value
  try { const url = new URL(value); if (url.username || url.password || [...url.searchParams.keys()].some(key => credentialQuery.test(key))) return undefined }
  catch { /* An invalid non-secret endpoint must remain editable. */ }
  return value
}
export function fieldMutations(namespace: SettingsNamespace, values: unknown): SettingsMutation[] {
  const form = settingsForms({ writable: true, hasDocument: true, namespaces: [namespace] })[0]
  if (!form || !record(values) || Object.keys(values).length > form.fields.length) throw new Error('Invalid settings form.')
  return Object.entries(values).map(([key, value]) => {
    const field = form.fields.find(item => item.key === key)
    if (!field) throw new Error('This field is not part of the settings page.')
    if (value === null || value === '') return { op: 'unset', path: [key] }
    if (field.type === 'select') {
      if (typeof value !== 'string' || !field.options?.some(option => option.value === value)) throw new Error(`${field.label}: select one of the offered values.`)
      return { op: 'set', path: [key], value }
    }
    if (field.type === 'string-list') {
      if (!Array.isArray(value) || value.length > 32) throw new Error(`${field.label}: provide no more than 32 URLs.`)
      const urls = value.map(entry => {
        if (typeof entry !== 'string' || entry.trim() === '') throw new Error(`${field.label}: every line must be a URL.`)
        return endpoint(entry.trim())
      })
      return { op: 'set', path: [key], value: [...new Set(urls)] }
    }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.integer && !Number.isSafeInteger(value))) throw new Error(`${field.label}: enter a valid ${field.integer ? 'integer' : 'number'}.`)
      if (field.min !== undefined && value < field.min) throw new Error(`${field.label}: minimum ${field.min}.`)
      if (field.max !== undefined && value > field.max) throw new Error(`${field.label}: maximum ${field.max}.`)
    } else if (typeof value !== field.type) throw new Error(`${field.label}: invalid value.`)
    if (typeof value === 'string' && value.length > MAX_SETTINGS_STRING) throw new Error(`${field.label}: keep the value under ${String(MAX_SETTINGS_STRING)} characters.`)
    if (key === 'baseURL') endpoint(value as string)
    return { op: 'set', path: [key], value }
  })
}

export function derivedCredential(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_API_KEY'
}
export function providerProfile(namespace: SettingsNamespace, provider: ConfigurableProvider): Record<string, unknown> | undefined {
  const value = at(namespace.value, provider.settingsPath)
  return record(value) ? value : undefined
}
export function credentialRef(namespace: SettingsNamespace, provider?: ConfigurableProvider): string {
  const profile = provider ? providerProfile(namespace, provider) : namespace.value
  const ref = record(profile) ? profile.apiKeyEnv : undefined
  if (typeof ref === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return ref
  return provider ? derivedCredential(provider.provider === 'deepseek-official' ? 'deepseek' : provider.provider) : 'DEEPSEEK_API_KEY'
}
export function publicModels(models: unknown): ModelDraft[] {
  return Array.isArray(models) ? models.filter(record).filter(item => typeof item.id === 'string').map(item => ({
    id: item.id as string, originalId: item.id as string,
    ...(typeof item.name === 'string' ? { name: item.name } : {}),
    ...(typeof item.contextWindow === 'number' ? { contextWindow: item.contextWindow } : {}),
    ...(typeof item.maxTokens === 'number' ? { maxTokens: item.maxTokens } : {}),
    ...(Array.isArray(item.inputModalities ?? item.input) ? { input: ((item.inputModalities ?? item.input) as unknown[]).filter((value): value is string => value === 'text' || value === 'image') } : {}),
    ...(item.reasoningEfforts === false ? { reasoningEfforts: false as const } : record(item.reasoningEfforts)
      ? { reasoningEfforts: Object.fromEntries(Object.entries(item.reasoningEfforts).filter(([key, value]) => safeSegment(key) && (typeof value === 'string' || value === null))) as Record<string, string | null> } : {}),
  })) : []
}
export function providerViews(namespaces: SettingsNamespace[], directory: ConfigurableProvider[], registered: { id: string; name: string }[], credentials: Record<string, CredentialState>): ProviderView[] {
  return directory.flatMap(entry => {
    const ns = namespaces.find(item => item.ns === entry.settingsNs)
    if (!ns || !['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai'].includes(ns.ns)) return []
    const profile = providerProfile(ns, entry)
    if (!profile) return []
    let baseURL = typeof profile.baseURL === 'string' ? profile.baseURL : ''
    try { if (baseURL) endpoint(baseURL) } catch { baseURL = '' }
    const account = ns.ns === 'llm-deepseek-account'
    const credential = credentials[credentialRef(ns, entry)]
    return [{ id: entry.provider, name: entry.displayName, ns: ns.ns, revision: ns.revision,
      declared: entry.declared === true, removable: entry.settingsPath.length > 0 && at(ns.user, entry.settingsPath) !== undefined && at(ns.base, entry.settingsPath) === undefined,
      account, active: registered.some(item => item.id === entry.provider), baseURL, api: typeof profile.api === 'string' ? profile.api : '',
      models: publicModels(profile.models), modelsOverridden: at(ns.user, [...entry.settingsPath, 'models']) !== undefined,
      extensionKey: !account && credentialRef(ns, entry) === 'DEEPSEEK_API_KEY',
      reasoningLevels: entry.declared === true ? reasoningLevels(ns) : [],
      ...(account || !credential ? {} : { credential: { configured: credential.configured === true, writable: credential.writable === true } }),
      ...(typeof entry.error === 'string' ? { error: 'This provider has a configuration error. Review its settings.' } : {}),
    }]
  }).sort((a, b) => (a.account ? -2 : a.ns === 'llm-deepseek' ? -1 : 0) - (b.account ? -2 : b.ns === 'llm-deepseek' ? -1 : 0))
}
export function protocols(namespace: SettingsNamespace | undefined): string[] {
  if (!namespace) return []
  const providers = schemaAt(namespace, ['providers']) as (SettingsSchemaNode & { inner?: number }) | undefined
  const profile = providers?.inner === undefined ? undefined : namespace.schema.refs[String(providers.inner)]
  const api = profile?.dict?.api === undefined ? undefined : namespace.schema.refs[String(profile.dict.api)]
  return (api?.list ?? []).flatMap(uid => {
    const node = namespace.schema.refs[String(uid)]
    return node?.type === 'const' && typeof node.value === 'string' ? [node.value] : []
  })
}
export function validProviderId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value) || !safeSegment(value)) throw new Error('Use a unique provider ID starting with a letter, followed by letters, digits, _ or -.')
}
function modelChanges(namespace: SettingsNamespace, entry: ConfigurableProvider, input: unknown): unknown[] {
  if (!Array.isArray(input) || input.length > 500) throw new Error('Invalid model list.')
  const existing = providerProfile(namespace, entry)?.models
  const old = new Map((Array.isArray(existing) ? existing : []).filter(record).map(item => [item.id, item]))
  const ids = new Set<string>()
  return input.map(item => {
    if (!record(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 300 || ids.has(item.id.trim())) throw new Error('Model IDs must be non-empty and unique.')
    const id = item.id.trim(); ids.add(id)
    const model: Record<string, unknown> = { ...old.get(item.originalId), id }
    for (const key of ['name', 'contextWindow', 'maxTokens']) {
      const value = item[key]
      if (value === undefined || value === '') { delete model[key]; continue }
      if (key === 'name') {
        if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a non-empty model display name.')
      } else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('Model capacities must be positive integers.')
      model[key] = value
    }
    if (item.input !== undefined) {
      if (!Array.isArray(item.input) || !item.input.length || item.input.some(value => value !== 'text' && value !== 'image')) throw new Error('Select text, image, or both input types.')
      const key = namespace.ns === 'llm-pi-ai' ? 'input' : 'inputModalities'
      model[key] = [...new Set(item.input)]
      if (namespace.ns !== 'llm-pi-ai' && !item.input.includes('image')) { delete model.imagePixelBudget; delete model.imageMaxBytes }
    }
    if (Object.hasOwn(item, 'reasoningEfforts')) {
      const efforts = item.reasoningEfforts
      if (entry.declared !== true || !reasoningLevels(namespace).length) throw new Error('This provider does not support custom reasoning levels.')
      if (efforts === null) delete model.reasoningEfforts
      else if (efforts === false) model.reasoningEfforts = false
      else {
        if (!record(efforts)) throw new Error('Invalid reasoning levels.')
        const known = new Set(reasoningLevels(namespace))
        const previous = record(model.reasoningEfforts) ? model.reasoningEfforts : {}
        const rows = Object.entries(efforts)
        if (!rows.some(([level]) => level !== 'off')) throw new Error('Keep at least one reasoning level other than off.')
        for (const [level, wire] of rows) {
          if (!safeSegment(level) || (!known.has(level) && !Object.hasOwn(previous, level))) throw new Error('Select a supported reasoning level.')
          if (!(wire === null && level === 'off') && (typeof wire !== 'string' || !wire.length || wire.length > 4096)) throw new Error('Enter a request value for each reasoning level; only off can omit it.')
        }
        model.reasoningEfforts = Object.fromEntries(rows)
      }
    }
    return model
  })
}

/** Read the adapter's own declaration, including the supported escalation order. */
export function reasoningLevels(namespace: SettingsNamespace | undefined): string[] {
  if (!namespace) return []
  const refs = namespace.schema.refs
  const providers = schemaAt(namespace, ['providers'])
  const profile = namespace.ns === 'llm-pi-ai' ? refs[String(providers?.inner)] : refs[String(namespace.schema.uid)]
  const models = refs[String(profile?.dict?.models)]
  const model = refs[String(models?.inner)]
  const choice = refs[String(model?.dict?.reasoningEfforts)]
  const dict = choice?.type === 'dict' ? choice : choice?.list?.map(uid => refs[String(uid)]).find(node => node?.type === 'dict')
  const key = refs[String(dict?.sKey)]
  return (key?.type === 'const' ? [key] : key?.list?.map(uid => refs[String(uid)]) ?? [])
    .flatMap(node => node?.type === 'const' && typeof node.value === 'string' && safeSegment(node.value) ? [node.value] : [])
}
export function providerMutations(namespace: SettingsNamespace, entry: ConfigurableProvider, changes: unknown): SettingsMutation[] {
  if (!record(changes)) throw new Error('Invalid provider changes.')
  const allowed = namespace.ns === 'llm-deepseek-account' ? ['models'] : namespace.ns === 'llm-deepseek' ? ['baseURL', 'models'] : ['baseURL', 'api', 'displayName', 'models']
  return Object.entries(changes).map(([key, value]) => {
    if (!allowed.includes(key)) throw new Error('This field is not editable for this provider.')
    const path = [...entry.settingsPath, key]
    if (value === null || value === '') return { op: 'unset', path }
    if (key === 'models') return { op: 'set', path, value: modelChanges(namespace, entry, value) }
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid provider value.')
    if (key === 'baseURL') endpoint(value)
    if (key === 'api' && !protocols(namespace).includes(value)) throw new Error('Select a supported API protocol.')
    return { op: 'set', path, value }
  })
}
