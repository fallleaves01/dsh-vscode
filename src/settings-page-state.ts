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
export interface SettingsFieldView {
  key: string; label: string; type: 'number' | 'string' | 'boolean'; value?: unknown; inherited?: unknown
  overridden: boolean; min?: number; max?: number; integer?: boolean; description?: string
}
export interface SettingsFormView { ns: string; title: string; section: string; revision: number; fields: SettingsFieldView[]; restart: boolean }
export interface ModelDraft {
  id: string; originalId?: string; name?: string; contextWindow?: number; maxTokens?: number; input?: string[]
}
export interface ProviderView {
  id: string; name: string; ns: string; revision: number; declared: boolean; removable: boolean; account: boolean
  active: boolean; baseURL: string; api: string; models: ModelDraft[]; modelsOverridden: boolean; credential?: CredentialState
  error?: string; extensionKey: boolean
}
export interface SettingsPageState {
  scope: string; version: string; phase: string; writable: boolean; reason: string; loading: boolean
  forms: SettingsFormView[]; providers: ProviderView[]; availableProviders: { id: string; name: string; credential?: CredentialState }[]
  protocols: string[]; piRevision?: number; catalog: { provider: string; model: string; label: string }[]
  allowedModels?: { ns: string; revision: number; enabled: boolean; overridden: boolean; routes: { provider: string; model: string }[] }
  searchCredential?: CredentialState
  searchExtensionKey?: boolean
  signedIn: boolean; accountText?: string; error?: string; modelsError?: string
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

// These fields are the official settings cards, rather than every YAML field.
const forms = [
  { ns: 'session-log-deepseek', section: 'general', title: 'Privacy', fields: [{ key: 'enabled', label: 'Upload session logs with official model API requests', type: 'boolean' }] },
  ...['bash-sandbox', 'pwsh-sandbox'].map(ns => ({ ns, section: 'shell', title: 'Shell', fields: [
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
] as const

export function settingsForms(description: SettingsDescription): SettingsFormView[] {
  return forms.flatMap(spec => {
    const namespace = description.namespaces.find(item => item.ns === spec.ns)
    if (!namespace) return []
    const fields: SettingsFieldView[] = spec.fields.flatMap(field => {
      const node = schemaAt(namespace, [field.key])
      if (!node || node.type !== field.type || node.meta?.role === 'secret' || (namespace.secrets ?? []).some(secret => secret.path[0] === field.key)) return []
      const value = at(namespace.value, [field.key]), inherited = at(namespace.base, [field.key])
      const publicValue = field.key === 'baseURL' ? publicEndpoint(value) : value
      const publicInherited = field.key === 'baseURL' ? publicEndpoint(inherited) : inherited
      return [{ ...field, type: field.type as SettingsFieldView['type'], value: typeof publicValue === field.type ? publicValue : undefined, inherited: typeof publicInherited === field.type ? publicInherited : undefined,
        overridden: at(namespace.user, [field.key]) !== undefined,
        ...(typeof node.meta?.description === 'string' ? { description: node.meta.description } : {}),
        ...(value && publicValue === undefined && field.key === 'baseURL' ? { description: 'Embedded credentials are hidden. Re-enter the endpoint without credentials to change it.' } : {}),
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
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.integer && !Number.isSafeInteger(value))) throw new Error(`${field.label}: enter a valid ${field.integer ? 'integer' : 'number'}.`)
      if (field.min !== undefined && value < field.min) throw new Error(`${field.label}: minimum ${field.min}.`)
      if (field.max !== undefined && value > field.max) throw new Error(`${field.label}: maximum ${field.max}.`)
    } else if (typeof value !== field.type) throw new Error(`${field.label}: invalid value.`)
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
    return model
  })
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
