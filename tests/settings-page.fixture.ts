import type { SettingsNamespace, SettingsSchemaNode } from '../src/runtime-settings.js'
import type { ConfigurableProvider, SettingsPageState } from '../src/settings-page-state.js'
import { providerViews, reasoningLevels, searchSettings, settingsForms } from '../src/settings-page-state.js'

export function namespace(ns: string, value: Record<string, unknown>, options: { base?: Record<string, unknown>; user?: Record<string, unknown>; revision?: number } = {}): SettingsNamespace {
  const refs: Record<string, SettingsSchemaNode> = { '1': { type: 'object', dict: {} } }
  let id = 2
  for (const [key, field] of Object.entries(value)) {
    refs['1']!.dict![key] = id; refs[String(id++)] = { type: Array.isArray(field) ? 'array' : typeof field === 'object' ? 'object' : typeof field }
  }
  return { ns, revision: options.revision ?? 1, applies: 'live', secrets: [], schema: { uid: 1, refs }, value,
    base: structuredClone(options.base ?? value), user: structuredClone(options.user ?? {}) }
}
export function fixture() {
  const pi = namespace('llm-pi-ai', { providers: { anthropic: { baseURL: 'https://provider.example/v1', apiKeyEnv: 'ANTHROPIC_API_KEY', models: [{ id: 'existing', name: 'Existing', contextWindow: 10000, maxTokens: 1000, input: ['text'], compat: { keep: true } }], headers: { Authorization: 'hidden-marker' } } } }, { base: {}, user: { providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } } } })
  pi.schema = { uid: 1, refs: {
    '1': { type: 'object', dict: { providers: 2 } }, '2': { type: 'dict', inner: 3 } as SettingsSchemaNode,
    '3': { type: 'object', dict: { api: 4, models: 8 } }, '4': { type: 'union', list: [5, 6, 7] },
    '5': { type: 'const', value: 'openai-completions' }, '6': { type: 'const', value: 'openai-responses' }, '7': { type: 'const', value: 'anthropic-messages' },
    '8': { type: 'array', inner: 9 }, '9': { type: 'object', dict: { reasoningEfforts: 10 } },
    '10': { type: 'union', list: [11, 12] }, '11': { type: 'const', value: false }, '12': { type: 'dict', sKey: 13, inner: 14 },
    '13': { type: 'union', list: [15, 16, 17, 18, 19, 20, 21] }, '14': { type: 'string' },
    ...Object.fromEntries(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((value, index) => [String(15 + index), { type: 'const', value }])),
  } }
  const namespaces = [
    namespace('session-log-deepseek', { enabled: true }),
    namespace('bash-sandbox', { timeoutMs: 60000, maxOutputBytes: 64000, maxSpillBytes: 50000 }),
    namespace('agent-loop', { maxParallelToolCalls: 10 }),
    namespace('subagent', { maxDepth: 1, maxActiveSubagents: 8 }),
    namespace('web-search-deepseek', { baseURL: 'https://search.example', maxUses: 5, apiKeyEnv: 'DEEPSEEK_API_KEY' }),
    namespace('subagent-model-selection-settings', { enabled: false, allowedModels: [{ provider: 'old', model: 'saved' }] }),
    namespace('llm-deepseek', { baseURL: 'https://api.example', apiKeyEnv: 'DEEPSEEK_API_KEY', models: [{ id: 'deepseek', name: 'DeepSeek', inputModalities: ['text', 'image'], imageMaxBytes: 42 }] }),
    pi,
  ]
  const directory: ConfigurableProvider[] = [
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
    { provider: 'anthropic', displayName: 'Anthropic', settingsNs: pi.ns, settingsPath: ['providers', 'anthropic'], declared: true },
    { provider: 'openai', displayName: 'OpenAI', settingsNs: pi.ns, settingsPath: ['providers', 'openai'] },
  ]
  const description = { writable: true, hasDocument: true, namespaces }
  const credentials = { DEEPSEEK_API_KEY: { configured: true, writable: false }, ANTHROPIC_API_KEY: { configured: true, writable: true } }
  return { description, directory, credentials }
}
export function pageState(): SettingsPageState {
  const { description, directory, credentials } = fixture()
  return { scope: 'runtime-a', version: '0.1.7', phase: 'ready', writable: true, reason: '', loading: false, signedIn: false,
    forms: settingsForms(description), providers: providerViews(description.namespaces, directory, [{ id: 'anthropic', name: 'Anthropic' }], credentials),
    availableProviders: [{ id: 'openai', name: 'OpenAI' }], piRevision: 1, protocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
    reasoningLevels: reasoningLevels(description.namespaces.find(ns => ns.ns === 'llm-pi-ai')),
    catalog: [{ provider: 'anthropic', model: 'current', label: 'Anthropic / Current' }],
    allowedModels: { ns: 'subagent-model-selection-settings', revision: 1, enabled: false, routes: [{ provider: 'old', model: 'saved' }], overridden: true },
    searchCredential: credentials.DEEPSEEK_API_KEY, searchExtensionKey: true,
    inventory: [{ label: 'Agent preset: Standard', rows: [{ name: '@deepseek-ai/dsh-tool-bash', status: 'Active' }, { name: '@deepseek-ai/dsh-tool-fs', status: 'Active' }] }, { label: 'Global runtime', rows: [{ name: '@deepseek-ai/dsh-subagent', status: 'Active' }] }],
  }
}

export function searchFixture() {
  const data = fixture()
  data.description.namespaces.push(namespace('web', { searchProvider: 'deepseek-official', fetchProvider: 'http' }),
    namespace('web-deepseek-api', { baseURL: 'https://search-api.example/v1/tools', count: 10, apiKeyEnv: 'SEARCH_FIXTURE_API_KEY' }))
  return data
}
export function searchPageState(): SettingsPageState {
  const data = searchFixture(), state = pageState()
  state.forms = settingsForms(data.description)
  state.search = searchSettings(data.description, { ...data.credentials, SEARCH_FIXTURE_API_KEY: { configured: false, writable: true } })
  return state
}
