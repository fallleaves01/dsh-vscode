import { describe, expect, it } from 'vitest'
import { credentialRef, endpoint, fieldMutations, protocols, providerMutations, providerViews, publicBundles, publicPluginInventory, reasoningLevels, searchSelectionMutations, searchSettings, settingsForms, validProviderId } from '../src/settings-page-state.js'
import { cotTranslationNamespace, experimentalPageState, fixture, pluginMarketNamespace, searchFixture } from './settings-page.fixture.js'

describe('official settings form boundaries', () => {
  it('projects the plugin roster without configuration, conditions or error payloads', () => {
    const projected = publicPluginInventory({ entries: [{ moduleName: '<img src=x>', enabled: true, fiberPhase: 'active', config: { token: 'hidden-marker' } }], agentPresets: [{ id: 'standard', name: 'Standard', rows: [{ moduleName: 'fixture-plugin', enabled: 'conditional', condition: 'hidden-marker', rawError: 'hidden-marker' }] }] })
    expect(projected).toEqual([{ label: 'Agent preset: Standard', rows: [{ name: 'fixture-plugin', status: 'Conditional' }] }, { label: 'Global runtime', rows: [{ name: '<img src=x>', status: 'Active' }] }])
    expect(JSON.stringify(projected)).not.toContain('hidden-marker')
  })
  it('offers the official shell fields and excludes YAML-only fields', () => {
    const { description } = fixture()
    const shell = settingsForms(description).find(form => form.section === 'shell')!
    expect(shell.fields.map(field => field.key)).toEqual(['timeoutMs', 'maxOutputBytes'])
    expect(settingsForms(description).some(form => form.ns === 'llm-pi-ai')).toBe(false)
  })
  it('rejects arbitrary fields while keeping zero valid for delegation depth', () => {
    const ns = fixture().description.namespaces.find(item => item.ns === 'subagent')!
    expect(fieldMutations(ns, { maxDepth: 0 })).toEqual([{ op: 'set', path: ['maxDepth'], value: 0 }])
    expect(fieldMutations(ns, { maxDepth: null })).toEqual([{ op: 'unset', path: ['maxDepth'] }])
    expect(() => fieldMutations(ns, { arbitrary: true })).toThrow('not part')
    expect(() => fieldMutations(ns, { maxDepth: 1.5 })).toThrow('integer')
    expect(() => fieldMutations(ns, { maxActiveSubagents: 0 })).toThrow('minimum')
  })
  it('does not publish an invalid object or a schema-declared secret as a numeric field value', () => {
    const { description } = fixture(), ns = description.namespaces.find(item => item.ns === 'bash-sandbox')!
    ;(ns.value as any).timeoutMs = { private: 'hidden-marker' }
    expect(JSON.stringify(settingsForms(description))).not.toContain('hidden-marker')
    ns.secrets.push({ path: ['maxOutputBytes'], set: true })
    expect(settingsForms(description).find(form => form.ns === ns.ns)!.fields.map(field => field.key)).not.toContain('maxOutputBytes')
  })
  it('does not expose legacy endpoint credentials through values or inherited placeholders', () => {
    const { description } = fixture(), ns = description.namespaces.find(item => item.ns === 'web-search-deepseek')!
    ;(ns.value as any).baseURL = 'https://search.example?api_key=hidden-marker'
    ;(ns.base as any).baseURL = 'https://user:hidden-marker@search.example'
    expect(JSON.stringify(settingsForms(description))).not.toContain('hidden-marker')
    expect(settingsForms(description).find(form => form.ns === ns.ns)!.fields[0]).toMatchObject({ value: undefined, inherited: undefined })
  })
  it.each(['file:///tmp/config', 'https://name:pass@example.test', 'https://example.test?api_key=value', 'invalid'])('rejects an unsafe or invalid endpoint %s', url => {
    expect(() => endpoint(url)).toThrow()
  })
  it('allows local endpoints, IPv6 and version query parameters', () => {
    expect(endpoint('http://[::1]:1234/v1?api-version=v1')).toBe('http://[::1]:1234/v1?api-version=v1')
  })
  it('matches the official Shell number fields without inventing integer or minimum limits', () => {
    const ns = fixture().description.namespaces.find(item => item.ns === 'bash-sandbox')!
    expect(fieldMutations(ns, { timeoutMs: 0, maxOutputBytes: 1.5 })).toEqual([
      { op: 'set', path: ['timeoutMs'], value: 0 }, { op: 'set', path: ['maxOutputBytes'], value: 1.5 },
    ])
  })
})
describe('provider settings edits', () => {
  it('derives reasoning levels from the serving schema and preserves untouched model mappings', () => {
    const { description, directory } = fixture(), ns = description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!
    expect(reasoningLevels(ns)).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    const model = (ns.value as any).providers.anthropic.models[0]; model.reasoningEfforts = { off: null, high: 'adaptive' }
    const ops = providerMutations(ns, directory[1]!, { models: [{ id: 'existing', originalId: 'existing', name: 'Edited' }] })
    expect((ops[0] as any).value[0].reasoningEfforts).toEqual({ off: null, high: 'adaptive' })
    expect(reasoningLevels(description.namespaces.find(ns => ns.ns === 'llm-deepseek'))).toEqual([])
  })
  it('limits custom reasoning edits to declared Pi provider models, as the official editor does', () => {
    const { description, directory } = fixture(), ns = description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!, entry = { ...directory[1]!, declared: false }
    expect(providerViews(description.namespaces, [entry], [], {})[0]!.reasoningLevels).toEqual([])
    expect(() => providerMutations(ns, entry, { models: [{ id: 'existing', reasoningEfforts: { high: 'adaptive' } }] })).toThrow('does not support')
  })
  it('saves custom wire values and can restore automatic reasoning discovery', () => {
    const { description, directory } = fixture(), ns = description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!
    for (const reasoningEfforts of [{ off: null, high: 'custom-api-value', max: 'maximum' }, false, null]) {
      const op = providerMutations(ns, directory[1]!, { models: [{ id: 'existing', originalId: 'existing', reasoningEfforts }] })[0] as any
      if (reasoningEfforts === null) expect(Object.hasOwn(op.value[0], 'reasoningEfforts')).toBe(false)
      else expect(op.value[0].reasoningEfforts).toEqual(reasoningEfforts)
      expect(op.value[0].compat).toEqual({ keep: true })
    }
  })
  it.each([{}, { off: null }, { high: null }, { high: '' }, { invented: 'high' }, ['high']])('rejects an invalid reasoning mapping %#', reasoningEfforts => {
    const { description, directory } = fixture(), ns = description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!
    expect(() => providerMutations(ns, directory[1]!, { models: [{ id: 'existing', originalId: 'existing', reasoningEfforts }] })).toThrow()
  })
  it('retains a previously declared future reasoning level but rejects prototype keys', () => {
    const { description, directory } = fixture(), ns = description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!
    ;(ns.value as any).providers.anthropic.models[0].reasoningEfforts = { future: 'adaptive' }
    expect(() => providerMutations(ns, directory[1]!, { models: [{ id: 'existing', originalId: 'existing', reasoningEfforts: { future: 'custom' } }] })).not.toThrow()
    expect(() => providerMutations(ns, directory[1]!, { models: [{ id: 'existing', originalId: 'existing', reasoningEfforts: JSON.parse('{"__proto__":"value"}') }] })).toThrow()
  })
  it('projects provider rows without headers, secret literals or unshown model properties', () => {
    const { description, directory } = fixture()
    const rows = providerViews(description.namespaces, directory, [], { ANTHROPIC_API_KEY: { configured: true, writable: false, value: 'not-a-key' } as any })
    expect(rows.map(row => row.id)).toEqual(['deepseek-official', 'anthropic'])
    expect(JSON.stringify(rows)).not.toContain('hidden-marker')
    expect(JSON.stringify(rows)).not.toContain('not-a-key')
    expect(JSON.stringify(rows)).not.toContain('compat')
  })
  it('derives protocols from the adapter schema and reuses the actual credential reference', () => {
    const { description, directory } = fixture()
    expect(protocols(description.namespaces.find(ns => ns.ns === 'llm-pi-ai'))).toEqual(['openai-completions', 'openai-responses', 'anthropic-messages'])
    expect(credentialRef(description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!, directory[1]!)).toBe('ANTHROPIC_API_KEY')
    expect(credentialRef(description.namespaces.find(ns => ns.ns === 'llm-deepseek')!, directory[0]!)).toBe('DEEPSEEK_API_KEY')
  })
  it('retains unshown model compatibility fields and avoids replacing the provider', () => {
    const { description, directory } = fixture(), ns = description.namespaces.find(item => item.ns === 'llm-pi-ai')!
    const ops = providerMutations(ns, directory[1]!, { models: [{ id: 'renamed', originalId: 'existing', name: 'Renamed', contextWindow: 20000, input: ['text', 'image'] }] })
    expect(ops).toEqual([{ op: 'set', path: ['providers', 'anthropic', 'models'], value: [{ id: 'renamed', name: 'Renamed', contextWindow: 20000, input: ['text', 'image'], compat: { keep: true } }] }])
    expect(providerMutations(ns, directory[1]!, { baseURL: null })).toEqual([{ op: 'unset', path: ['providers', 'anthropic', 'baseURL'] }])
  })
  it('removes incompatible image limits when a DeepSeek model becomes text-only', () => {
    const { description, directory } = fixture(), ns = description.namespaces.find(item => item.ns === 'llm-deepseek')!
    const ops = providerMutations(ns, directory[0]!, { models: [{ id: 'deepseek', originalId: 'deepseek', input: ['text'] }] })
    expect(JSON.stringify(ops)).not.toContain('imageMaxBytes')
  })
  it.each([
    [{ id: '' }], [{ id: 'duplicate' }, { id: 'duplicate' }], [{ id: 'x', maxTokens: -1 }], [{ id: 'x', contextWindow: 2.5 }], [{ id: 'x', input: [] }], [{ id: 'x', input: ['audio'] }],
  ])('rejects invalid model declarations %#', models => {
    const { description, directory } = fixture()
    expect(() => providerMutations(description.namespaces.find(item => item.ns === 'llm-pi-ai')!, directory[1]!, { models })).toThrow()
  })
  it.each(['__proto__', 'constructor', 'with/slash', '123provider', ''])('rejects a dangerous or ambiguous new provider ID %s', id => {
    expect(() => validProviderId(id)).toThrow()
  })
})

describe('Search / Fetch API settings boundaries', () => {
  it('projects only public capabilities and selects paired providers with inherited defaults', () => {
    const { description } = searchFixture(), web = description.namespaces.find(ns => ns.ns === 'web')!
    const state = searchSettings(description, { SEARCH_FIXTURE_API_KEY: { configured: true, writable: true, value: 'hidden-marker' } as any })
    expect(state.selection).toEqual({ revision: 1, available: true, enabled: false })
    expect(JSON.stringify(state)).not.toContain('hidden-marker')
    expect(searchSelectionMutations(web, true)).toEqual([{ op: 'set', path: ['searchProvider'], value: 'deepseek-search-api' }, { op: 'set', path: ['fetchProvider'], value: 'deepseek-fetch-api' }])
    expect(searchSelectionMutations(web, false)).toEqual([{ op: 'unset', path: ['searchProvider'] }, { op: 'unset', path: ['fetchProvider'] }])
  })
  it.each([0, 51, 1.5, '10', Infinity])('enforces the API result count bounds for %s', count => {
    const ns = searchFixture().description.namespaces.find(ns => ns.ns === 'web-deepseek-api')!
    expect(() => fieldMutations(ns, { count })).toThrow()
  })
  it('distinguishes results per search from Messages API search calls', () => {
    const ns = searchFixture().description.namespaces.find(ns => ns.ns === 'web-deepseek-api')!
    expect(fieldMutations(ns, { count: 50 })).toEqual([{ op: 'set', path: ['count'], value: 50 }])
    expect(() => fieldMutations(ns, { maxUses: 3 })).toThrow('not part')
  })
})

describe('experimental settings and bundle projection', () => {
  it('projects only whitelisted bundle facts and drops icons, paths and raw diagnostics', () => {
    const projected = publicBundles([
      { name: '@deepseek-ai/dsh-base', official: false, availability: 'profile', version: '0.2.1-rc.3', description: 'Base', enabled: true, installed: true, optional: false, removable: false, icon: 'data:image/svg+xml;base64,hidden-marker', source: '/srv/hidden-marker/profile', error: { code: 'operation-error', diagnostic: 'hidden-marker' } },
      { name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', official: true, availability: 'installation', version: '0.2.1-rc.3', enabled: false, installed: false, optional: true, removable: false, meta: { title: { en: 'Machine translation', zh: '机翻' }, description: { en: 'Translate reasoning.' }, icon: 'data:image/svg+xml;base64,hidden-marker' }, overrides: ['hidden-marker'], rows: [{ rowId: 'hidden-marker' }] },
      { name: 12, enabled: true },
    ])
    expect(projected).toEqual([
      { name: '@deepseek-ai/dsh-base', official: false, availability: 'profile', version: '0.2.1-rc.3', description: 'Base', enabled: true, installed: true, optional: false, removable: false },
      { name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', official: true, availability: 'installation', version: '0.2.1-rc.3', title: 'Machine translation', description: 'Translate reasoning.', enabled: false, installed: false, optional: true, removable: false },
    ])
    expect(JSON.stringify(projected)).not.toContain('hidden-marker')
    expect(JSON.stringify(projected)).not.toContain('data:image')
    expect(publicBundles(undefined)).toEqual([])
    expect(publicBundles({ entries: [] })).toEqual([])
  })
  it('renders the COT provider as the closed schema choice list and validates writes', () => {
    const ns = cotTranslationNamespace()
    const form = settingsForms({ writable: true, hasDocument: true, namespaces: [ns] })[0]!
    expect(form.section).toBe('translation')
    expect(form.fields.map(field => field.key)).toEqual(['provider', 'targetLanguage'])
    expect(form.fields[0]!.type).toBe('select')
    expect(form.fields[0]!.options).toEqual([
      { value: 'bing', label: 'Bing' }, { value: 'google', label: 'Google' },
      { value: 'deepseek-account', label: 'DeepSeek Account' }, { value: 'deepseek-official', label: 'DeepSeek API' },
    ])
    expect(fieldMutations(ns, { provider: 'google' })).toEqual([{ op: 'set', path: ['provider'], value: 'google' }])
    expect(fieldMutations(ns, { targetLanguage: 'zh-CN' })).toEqual([{ op: 'set', path: ['targetLanguage'], value: 'zh-CN' }])
    expect(() => fieldMutations(ns, { provider: 'invented' })).toThrow('offered values')
    expect(() => fieldMutations(ns, { provider: 7 })).toThrow('offered values')
  })
  it('renders voice fields as plain strings supplied by the speech schema', () => {
    const state = experimentalPageState(), voice = state.forms.find(form => form.section === 'voice')!
    expect(voice.ns).toBe('speech-to-text')
    expect(voice.fields.map(field => field.type)).toEqual(['string', 'string'])
    expect(voice.fields[0]!.value).toBe('sensevoice-local')
  })
  it('renders market indexes as a deduplicated URL list with strict validation', () => {
    const ns = pluginMarketNamespace()
    const form = settingsForms({ writable: true, hasDocument: true, namespaces: [ns] })[0]!
    expect(form.section).toBe('market')
    expect(form.fields[0]!.type).toBe('string-list')
    expect(fieldMutations(ns, { indexes: ['https://a.example/index.json', ' https://a.example/index.json ', 'https://b.example/x.json'] }))
      .toEqual([{ op: 'set', path: ['indexes'], value: ['https://a.example/index.json', 'https://b.example/x.json'] }])
    expect(fieldMutations(ns, { indexes: [] })).toEqual([{ op: 'set', path: ['indexes'], value: [] }])
    expect(() => fieldMutations(ns, { indexes: ['file:///tmp/index.json'] })).toThrow()
    expect(() => fieldMutations(ns, { indexes: ['https://name:pass@example.test/index.json'] })).toThrow()
    expect(() => fieldMutations(ns, { indexes: Array.from({ length: 33 }, (_value, index) => `https://e.example/${String(index)}.json`) })).toThrow('32')
  })
  it('hides the experimental sections when their bundles are not enabled', () => {
    const { description } = fixture()
    expect(settingsForms(description).some(form => ['translation', 'voice', 'market'].includes(form.section))).toBe(false)
  })
  it('deduplicates bundle rows and bounds a very long string setting', () => {
    const bundles = publicBundles([
      { name: '@deepseek-ai/dsh-a', enabled: false, optional: true },
      { name: '@deepseek-ai/dsh-a', enabled: true, optional: true },
    ])
    expect(bundles).toHaveLength(1)
    expect(bundles[0]!.enabled).toBe(false)
    const ns = cotTranslationNamespace()
    expect(() => fieldMutations(ns, { targetLanguage: 'x'.repeat(1025) })).toThrow('under 1024')
    expect(fieldMutations(ns, { targetLanguage: 'zh-CN' })).toEqual([{ op: 'set', path: ['targetLanguage'], value: 'zh-CN' }])
  })
})
