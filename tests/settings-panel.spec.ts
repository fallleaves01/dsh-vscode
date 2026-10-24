import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundleFixture, fixture, searchFixture } from './settings-page.fixture.js'
import { at } from '../src/settings-page-state.js'

const mocks = vi.hoisted(() => ({ panels: [] as any[], warning: vi.fn(), command: vi.fn() }))
vi.mock('vscode', () => ({
  ViewColumn: { Active: 1 }, Uri: { joinPath: (...parts: any[]) => ({ toString: () => parts.map(part => typeof part === 'string' ? part : part.fsPath).join('/') }) },
  window: { showWarningMessage: mocks.warning, createWebviewPanel: vi.fn(() => {
    const listeners = new Set<(value: unknown) => void>(), dispose = new Set<() => void>()
    const panel = { reveal: vi.fn(), webview: { cspSource: 'vscode-webview:', html: '', options: {}, asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(async () => true), onDidReceiveMessage: (fn: (value: unknown) => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) } } },
      send: (value: unknown) => { for (const listener of listeners) listener(value) },
      onDidDispose: (fn: () => void) => { dispose.add(fn); return { dispose: () => dispose.delete(fn) } }, dispose: () => { for (const fn of [...dispose]) fn() } }
    mocks.panels.push(panel); return panel
  }) }, commands: { executeCommand: mocks.command },
}))
import { SettingsPanelManager } from '../src/settings-panel.js'
import type { SettingsMutation, SettingsNamespace } from '../src/runtime-settings.js'

const managers: SettingsPanelManager[] = []
afterEach(() => { managers.splice(0).forEach(manager => manager.dispose()); vi.restoreAllMocks() })
beforeEach(() => { mocks.panels.length = 0; mocks.warning.mockReset(); mocks.command.mockReset() })
const clone = <T>(value: T): T => structuredClone(value)
function bus() {
  const listeners = new Set<() => void>()
  return { event: (fn: () => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) } }, fire: () => { for (const fn of listeners) fn() } }
}
function assign(value: any, path: string[], next: unknown, unset = false) {
  let target = value
  for (const part of path.slice(0, -1)) target = target[part] ??= {}
  if (unset) delete target[path.at(-1)!]; else target[path.at(-1)!] = clone(next)
}
async function harness(ownership: string = 'managed', data = fixture()) {
  const changes = bus(), stateChanges = bus(), owners = new WeakMap<object, object>()
  const secrets = new Map<string, string>()
  const createClient = () => ({
    listConfigurableProviders: vi.fn(async () => {
      const rows = clone(data.directory), pi = data.description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!
      for (const id of Object.keys((pi.value as any).providers)) if (!rows.some(row => row.provider === id)) rows.push({ provider: id, displayName: id, settingsNs: pi.ns, settingsPath: ['providers', id], declared: true })
      return rows
    }),
    listLlmProviders: vi.fn(async () => [{ id: 'anthropic', name: 'Anthropic' }]),
    models: vi.fn(async () => ({ groups: [{ id: 'anthropic', name: 'Anthropic', models: [{ id: 'current', name: 'Current' }] }], failures: [] })),
    describeCredentials: vi.fn(async (refs: string[]) => Object.fromEntries(refs.map(ref => [ref, { configured: secrets.has(ref) || ref === 'ANTHROPIC_API_KEY', writable: ref !== 'DEEPSEEK_API_KEY', value: 'response-hidden-marker' }]))),
    setCredential: vi.fn(async (ref: string, value: string) => { secrets.set(ref, value); changes.fire() }),
    unsetCredential: vi.fn(async (ref: string) => { secrets.delete(ref); changes.fire() }),
    discoverModels: vi.fn(async () => [{ id: 'found', name: 'Found', value: 'not-a-model-field' }]),
    listBundles: vi.fn(async () => clone((data as any).bundles ?? [])),
    setBundleEnabled: vi.fn(async (name: string, enabled: boolean) => {
      const row = ((data as any).bundles as any[] | undefined)?.find(item => item.name === name)
      if (row !== undefined) row.enabled = enabled
      changes.fire()
      return { changed: true, application: 'applied', stage: enabled ? 'enable' : 'remove', target: name, enabled }
    }),
  })
  let client = createClient()
  const host = {
    cwd: '/workspace', runtimeIdentity: {}, runtimeOwnership: ownership, hasRunningTasks: false,
    state: { phase: 'ready', statusText: '', account: { signedIn: false } }, onDidChangeState: stateChanges.event, onDidChangeRuntimeSettings: changes.event,
    start: vi.fn(async () => {}),
    settings: vi.fn(async () => { const result = clone(data.description); result.namespaces.forEach(ns => owners.set(ns, client)); return result }),
    settingsClient: vi.fn((ns?: SettingsNamespace) => { if (ns && owners.get(ns) !== client) throw new Error('Wrong runtime owner'); return client }),
    mutateSettings: vi.fn(async (ns: SettingsNamespace, ops: SettingsMutation[]) => {
      if (owners.get(ns) !== client) throw new Error('Wrong runtime owner')
      const current = data.description.namespaces.find(item => item.ns === ns.ns)!
      if (current.revision !== ns.revision) throw new Error('Settings conflict')
      for (const op of ops) {
        if (op.op === 'set') { assign(current.value, op.path, op.value); assign(current.user, op.path, op.value) }
        else {
          const inherited = at(current.base, op.path); assign(current.user, op.path, undefined, true)
          assign(current.value, op.path, inherited, inherited === undefined)
        }
      }
      current.revision++; changes.fire(); return clone(current)
    }),
  }
  const manager = new SettingsPanelManager(host as any, { fsPath: '/extension' } as any, '0.1.7'); managers.push(manager); manager.open()
  const panel = mocks.panels.at(-1)
  panel.send({ type: 'ready' })
  const packets = () => panel.webview.postMessage.mock.calls.map((call: any[]) => call[0])
  const state = () => packets().filter((packet: any) => packet.type === 'state' && !packet.state.loading).at(-1)?.state
  await vi.waitFor(() => expect(state()?.forms.length).toBeGreaterThan(0))
  let serial = 0
  const send = (body: Record<string, unknown>) => { const id = 'request-' + (++serial); panel.send({ scope: state().scope, requestId: id, ...body }); return id }
  const result = async (id: string) => { await vi.waitFor(() => expect(packets().some((packet: any) => packet.type === 'result' && packet.requestId === id)).toBe(true)); return packets().find((packet: any) => packet.type === 'result' && packet.requestId === id) }
  return { data, host, manager, panel, client, secrets, state, send, result, packets, changes, stateChanges,
    switchClient: () => { const next = createClient(); client = next; host.runtimeIdentity = {}; stateChanges.fire(); return next } }
}

describe('settings host ownership and credentials', () => {
  it('binds the chat modal to one opening and ignores messages after close', async () => {
    const h = await harness(); h.manager.openEmbedded(h.panel.webview)
    const opened = h.packets().filter((packet: any) => packet.type === 'settings-open').at(-1), id = opened.settingsId
    h.panel.send({ type: 'settings-message', settingsId: id, message: { type: 'ready' } })
    await vi.waitFor(() => expect(h.packets().some((packet: any) => packet.type === 'settings-message' && packet.message.type === 'state' && !packet.message.state.loading)).toBe(true))
    const latest = h.packets().filter((packet: any) => packet.type === 'settings-message' && packet.message.type === 'state').at(-1).message.state
    const operation = { type: 'save-fields', requestId: 'modal-save', scope: latest.scope, changes: [{ ns: 'bash-sandbox', revision: 1, values: { timeoutMs: 80000 } }] }
    h.panel.send({ type: 'settings-message', settingsId: 'wrong-opening', message: operation }); expect(h.host.mutateSettings).not.toHaveBeenCalled()
    h.panel.send({ type: 'settings-message', settingsId: id, message: operation })
    await vi.waitFor(() => expect(h.host.mutateSettings).toHaveBeenCalledOnce())
    h.panel.send({ type: 'settings-message', settingsId: id, message: { type: 'close' } })
    h.panel.send({ type: 'settings-message', settingsId: id, message: operation }); expect(h.host.mutateSettings).toHaveBeenCalledOnce()
    h.manager.openEmbedded(h.panel.webview)
    expect(h.packets().filter((packet: any) => packet.type === 'settings-open').at(-1).settingsId).not.toBe(id)
  })
  it('saves both Search / Fetch providers and restores inherited selection defaults', async () => {
    const h = await harness('managed', searchFixture())
    expect(h.state().search.selection).toEqual({ revision: 1, available: true, enabled: false })
    expect(h.state().search.profiles.find((item: any) => item.ns === 'web-deepseek-api').credential).toEqual({ configured: false, writable: true })
    const enable = h.send({ type: 'save-search', changes: [{ ns: 'web-deepseek-api', revision: 1, values: { count: 25, baseURL: 'https://custom.example/v1/tools' } }], selectionRevision: 1, selection: { enabled: true }, keyNamespace: 'web-deepseek-api', keyRevision: 1, apiKey: 'fixture-search-key' })
    expect(await h.result(enable)).toMatchObject({ ok: true, keySaved: true, selectionSaved: true })
    expect(h.client.setCredential).toHaveBeenCalledWith('SEARCH_FIXTURE_API_KEY', 'fixture-search-key')
    expect((h.data.description.namespaces.find(ns => ns.ns === 'web')!.value as any)).toEqual({ searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' })
    const disable = h.send({ type: 'save-search', changes: [], selectionRevision: 2, selection: { enabled: false } })
    expect((await h.result(disable)).ok).toBe(true)
    expect(h.host.mutateSettings.mock.calls.at(-1)![1]).toEqual([{ op: 'unset', path: ['searchProvider'] }, { op: 'unset', path: ['fetchProvider'] }])
  })
  it('stops a search save after a failed profile and does not change the key or routing', async () => {
    const h = await harness('managed', searchFixture())
    h.host.mutateSettings.mockRejectedValueOnce(new Error('Profile write refused'))
    const id = h.send({ type: 'save-search', changes: [{ ns: 'web-search-deepseek', revision: 1, values: { maxUses: 8 } }, { ns: 'web-deepseek-api', revision: 1, values: { count: 20 } }], selectionRevision: 1, selection: { enabled: true }, apiKey: 'fixture-search-key', keyNamespace: 'web-deepseek-api', keyRevision: 1 })
    expect(await h.result(id)).toMatchObject({ ok: false, keySaved: false, selectionSaved: false, results: [{ ns: 'web-search-deepseek', ok: false }] })
    expect(h.host.mutateSettings).toHaveBeenCalledOnce(); expect(h.client.setCredential).not.toHaveBeenCalled()
  })
  it('retains a confirmed profile revision after credential failure, then retries only the remaining phases', async () => {
    const h = await harness('managed', searchFixture())
    h.client.setCredential.mockRejectedValueOnce(new Error('Credential store unavailable'))
    const body = { type: 'save-search', selectionRevision: 1, selection: { enabled: true }, apiKey: 'fixture-search-key', keyNamespace: 'web-deepseek-api' }
    const first = h.send({ ...body, changes: [{ ns: 'web-deepseek-api', revision: 1, values: { count: 22 } }], keyRevision: 1 })
    expect(await h.result(first)).toMatchObject({ ok: false, results: [{ ns: 'web-deepseek-api', ok: true, revision: 2 }], keySaved: false, selectionSaved: false })
    expect(h.host.mutateSettings).toHaveBeenCalledOnce()
    const retry = h.send({ ...body, changes: [], keyRevision: 2 })
    expect((await h.result(retry)).ok).toBe(true); expect(h.host.mutateSettings).toHaveBeenCalledTimes(2)
  })
  it('rejects stale or forged search targets before writing any fields', async () => {
    const h = await harness('managed', searchFixture())
    for (const extra of [{ selectionRevision: 0 }, { keyNamespace: 'web-search-deepseek' }, { changes: [{ ns: 'bash-sandbox', revision: 1, values: { timeoutMs: 1 } }] }, { changes: [{ ns: 'web-deepseek-api', revision: 1, values: { count: 51 } }] }]) {
      const id = h.send({ type: 'save-search', changes: [], selectionRevision: 1, selection: { enabled: true }, apiKey: 'fixture-search-key', keyNamespace: 'web-deepseek-api', keyRevision: 1, ...extra })
      expect((await h.result(id)).ok).toBe(false)
    }
    expect(h.host.mutateSettings).not.toHaveBeenCalled(); expect(h.client.setCredential).not.toHaveBeenCalled()
  })
  it('rechecks search routing before storing a key when another window changes the selection', async () => {
    const h = await harness('managed', searchFixture())
    h.client.describeCredentials.mockImplementationOnce(async refs => {
      h.data.description.namespaces.find(ns => ns.ns === 'web')!.revision++
      return Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])) as any
    })
    const id = h.send({ type: 'save-search', changes: [], selectionRevision: 1, selection: { enabled: true }, apiKey: 'fixture-search-key', keyNamespace: 'web-deepseek-api', keyRevision: 1 })
    expect((await h.result(id)).error).toContain('selection changed')
    expect(h.client.setCredential).not.toHaveBeenCalled(); expect(h.host.mutateSettings).not.toHaveBeenCalled()
  })
  it('clears only the explicitly displayed Search / Fetch API credential', async () => {
    const h = await harness('managed', searchFixture()); mocks.warning.mockResolvedValueOnce('Clear key')
    h.secrets.set('SEARCH_FIXTURE_API_KEY', 'fixture-search-key')
    const id = h.send({ type: 'clear-key', provider: 'web-search', ns: 'web-deepseek-api', revision: 1, selectionRevision: 1 })
    expect((await h.result(id)).ok).toBe(true)
    expect(h.client.unsetCredential).toHaveBeenCalledWith('SEARCH_FIXTURE_API_KEY')
  })
  it('reuses a panel and publishes only curated fields and credential capabilities', async () => {
    const h = await harness(); h.manager.open()
    expect(mocks.panels).toHaveLength(1)
    expect(JSON.stringify(h.packets())).not.toContain('hidden-marker')
    expect(JSON.stringify(h.packets())).not.toContain('response-hidden-marker')
    expect(h.state().forms.find((form: any) => form.section === 'shell').fields).toHaveLength(2)
    expect(h.state().availableProviders.map((row: any) => row.id)).toContain('openai')
  })
  it('saves only requested fields, preserving other runtime settings', async () => {
    const h = await harness(), id = h.send({ type: 'save-fields', changes: [{ ns: 'bash-sandbox', revision: 1, values: { timeoutMs: 90000 } }] })
    expect((await h.result(id)).ok).toBe(true)
    expect(h.host.mutateSettings).toHaveBeenCalledWith(expect.objectContaining({ ns: 'bash-sandbox' }), [{ op: 'set', path: ['timeoutMs'], value: 90000 }])
    expect((h.data.description.namespaces.find(ns => ns.ns === 'bash-sandbox')!.value as any).maxSpillBytes).toBe(50000)
  })
  it.each(['external', 'attached'])('keeps %s runtime configuration and credentials read-only', async ownership => {
    const h = await harness(ownership)
    expect(h.state().writable).toBe(false)
    const id = h.send({ type: 'save-provider', provider: 'anthropic', revision: 1, fields: {}, apiKey: 'fixture-key' })
    expect((await h.result(id)).ok).toBe(false)
    expect(h.host.mutateSettings).not.toHaveBeenCalled(); expect(h.client.setCredential).not.toHaveBeenCalled()
  })
  it('rejects stale revisions and fields outside official settings cards', async () => {
    const h = await harness()
    const stale = h.send({ type: 'save-fields', changes: [{ ns: 'bash-sandbox', revision: 0, values: { timeoutMs: 2 } }] })
    expect((await h.result(stale)).error).toContain('changed elsewhere')
    const unknown = h.send({ type: 'save-fields', changes: [{ ns: 'bash-sandbox', revision: 1, values: { maxSpillBytes: 1 } }] })
    expect((await h.result(unknown)).ok).toBe(false)
    expect(h.host.mutateSettings).not.toHaveBeenCalled()
  })
  it('writes a key through credentials and never puts its literal in settings or replies', async () => {
    const h = await harness(), id = h.send({ type: 'save-provider', provider: 'anthropic', revision: 1, fields: {}, apiKey: ' fixture-key ' })
    expect((await h.result(id)).ok).toBe(true)
    expect(h.client.setCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'fixture-key')
    expect(JSON.stringify(h.host.mutateSettings.mock.calls)).not.toContain('fixture-key')
    expect(JSON.stringify(h.packets())).not.toContain('fixture-key')
  })
  it('keeps a successful provider write after a credential failure and redacts the literal', async () => {
    const h = await harness(); h.client.setCredential.mockRejectedValueOnce(new Error('Failed with fixture-key'))
    const id = h.send({ type: 'save-provider', provider: 'anthropic', revision: 1, fields: { baseURL: 'https://new.example/v1' }, apiKey: 'fixture-key' })
    const reply = await h.result(id)
    expect(reply).toMatchObject({ ok: false, settingsSaved: true }); expect(reply.error).toContain('[redacted]')
    expect(JSON.stringify(h.packets())).not.toContain('fixture-key')
    expect(h.state().providers.find((row: any) => row.id === 'anthropic').baseURL).toBe('https://new.example/v1')
  })
  it('reports independent search-field and credential outcomes', async () => {
    const h = await harness()
    h.client.describeCredentials.mockImplementation(async refs => Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true, value: 'response-hidden-marker' }])))
    h.client.setCredential.mockRejectedValueOnce(new Error('Credential store unavailable'))
    const id = h.send({ type: 'save-fields', changes: [{ ns: 'web-search-deepseek', revision: 1, values: { maxUses: 8 } }], apiKey: 'fixture-key' })
    expect(await h.result(id)).toMatchObject({ ok: false, settingsSaved: true, keySaved: false, results: [{ ns: 'web-search-deepseek', ok: true }] })
  })
  it('stops the credential phase when the runtime changes during a provider write', async () => {
    const h = await harness(), operation = Promise.withResolvers<any>()
    h.host.mutateSettings.mockReturnValueOnce(operation.promise)
    h.send({ type: 'save-provider', provider: 'anthropic', revision: 1, fields: { baseURL: 'https://new.example' }, apiKey: 'fixture-key' })
    await vi.waitFor(() => expect(h.host.mutateSettings).toHaveBeenCalledOnce())
    const next = h.switchClient(); operation.resolve({})
    await vi.waitFor(() => expect(h.state().scope).not.toBe(undefined))
    expect(h.client.setCredential).not.toHaveBeenCalled(); expect(next.setCredential).not.toHaveBeenCalled()
  })
  it('rechecks the credential reference after a confirmation dialog', async () => {
    const h = await harness()
    mocks.warning.mockImplementationOnce(async () => {
      const ns = h.data.description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!; ns.revision++
      ;(ns.value as any).providers.anthropic.apiKeyEnv = 'OTHER_API_KEY'; return 'Clear key'
    })
    const id = h.send({ type: 'clear-key', provider: 'anthropic', revision: 1 })
    expect((await h.result(id)).error).toContain('target changed')
    expect(h.client.unsetCredential).not.toHaveBeenCalled()
  })
  it('rejects a key write if its namespace changes during credential capability discovery', async () => {
    const h = await harness()
    h.client.describeCredentials.mockImplementationOnce(async refs => {
      const ns = h.data.description.namespaces.find(ns => ns.ns === 'llm-pi-ai')!; ns.revision++
      ;(ns.value as any).providers.anthropic.apiKeyEnv = 'OTHER_API_KEY'
      return Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true, value: 'response-hidden-marker' }]))
    })
    const id = h.send({ type: 'save-provider', provider: 'anthropic', revision: 1, fields: {}, apiKey: 'fixture-key' })
    expect((await h.result(id)).error).toContain('target changed')
    expect(h.client.setCredential).not.toHaveBeenCalled()
  })
  it('rejects concurrent writes while a prior operation is awaiting its final refresh', async () => {
    const h = await harness(), read = Promise.withResolvers<any>()
    h.host.settings.mockReturnValueOnce(read.promise)
    const first = h.send({ type: 'save-fields', changes: [{ ns: 'bash-sandbox', revision: 1, values: { timeoutMs: 1234 } }] })
    await vi.waitFor(() => expect(h.host.mutateSettings).toHaveBeenCalledOnce())
    const second = h.send({ type: 'save-fields', changes: [{ ns: 'agent-loop', revision: 1, values: { maxParallelToolCalls: 2 } }] })
    expect((await h.result(second)).error).toContain('Wait')
    read.resolve(clone(h.data.description)); await h.result(first)
    expect(h.host.mutateSettings).toHaveBeenCalledOnce()
  })
  it('uses read-only model discovery and projects only the advertised model fields', async () => {
    const h = await harness(), id = h.send({ type: 'discover-models', ns: 'llm-pi-ai', revision: 1, provider: 'anthropic' })
    expect(await h.result(id)).toMatchObject({ ok: true, models: [{ id: 'found', name: 'Found' }] })
    expect(h.host.mutateSettings).not.toHaveBeenCalled(); expect(h.client.setCredential).not.toHaveBeenCalled()
    expect(JSON.stringify(h.packets())).not.toContain('not-a-model-field')
  })
  it('aborts outstanding model queries when closing the panel', async () => {
    const h = await harness(), query = Promise.withResolvers<any>()
    h.client.discoverModels.mockReturnValueOnce(query.promise)
    h.send({ type: 'discover-models', ns: 'llm-pi-ai', revision: 1, provider: 'anthropic' })
    await vi.waitFor(() => expect(h.client.discoverModels).toHaveBeenCalledOnce())
    const signal = (h.client.discoverModels.mock.calls[0] as any[])[2] as AbortSignal
    h.manager.dispose(); expect(signal.aborted).toBe(true); query.resolve([])
  })
  it('rejects invented allowed models while retaining previously stored unavailable routes', async () => {
    const h = await harness()
    const invalid = h.send({ type: 'save-allowed-models', revision: 1, enabled: true, routes: [{ provider: 'invented', model: 'invented' }] })
    expect((await h.result(invalid)).ok).toBe(false)
    const valid = h.send({ type: 'save-allowed-models', revision: 1, enabled: true, routes: [{ provider: 'old', model: 'saved' }] })
    expect((await h.result(valid)).ok).toBe(true)
  })
  it('requires a complete custom provider and preserves a credential after provider removal', async () => {
    const h = await harness()
    const bad = h.send({ type: 'create-provider', provider: 'custom', revision: 1, fields: { baseURL: 'https://gateway.example' } })
    expect((await h.result(bad)).ok).toBe(false)
    const good = h.send({ type: 'create-provider', provider: 'custom', revision: 1, fields: { baseURL: 'https://gateway.example/v1', api: 'openai-completions', models: [{ id: 'm', input: ['text'] }] }, apiKey: 'fixture-key' })
    expect(await h.result(good)).toMatchObject({ ok: true, promotedProvider: 'custom' })
    expect(h.client.setCredential).toHaveBeenCalledWith('CUSTOM_API_KEY', 'fixture-key')
    mocks.warning.mockResolvedValueOnce('Remove')
    const remove = h.send({ type: 'remove-provider', provider: 'custom', revision: h.state().providers.find((row: any) => row.id === 'custom').revision })
    expect((await h.result(remove)).ok).toBe(true)
    expect(h.client.unsetCredential).not.toHaveBeenCalled()
  })
  it('does not replace a stored provider when the configurable directory is unavailable', async () => {
    const h = await harness()
    h.client.listConfigurableProviders.mockResolvedValueOnce([])
    h.panel.send({ type: 'refresh' })
    await vi.waitFor(() => expect(h.state().providers).toHaveLength(0))
    const id = h.send({ type: 'create-provider', provider: 'anthropic', revision: 1, fields: { baseURL: 'https://gateway.example', api: 'openai-completions', models: [{ id: 'm' }] } })
    expect((await h.result(id)).error).toContain('already configured')
    expect(h.host.mutateSettings).not.toHaveBeenCalled()
  })
  it('keeps ordinary settings writable when the model catalog is temporarily missing', async () => {
    const h = await harness()
    h.client.models.mockResolvedValueOnce(undefined as any)
    h.panel.send({ type: 'refresh' })
    await vi.waitFor(() => expect(h.state().catalog).toEqual([]))
    expect(h.state().writable).toBe(true)
    expect(h.state().forms.some((form: any) => form.section === 'shell')).toBe(true)
    expect(h.state().modelsError).toContain('catalog')
  })
  it('accepts only known native commands and rejects credentials actions with a stale scope', async () => {
    const h = await harness()
    h.panel.send({ type: 'native-action', action: 'workbench.action.terminal.sendSequence' })
    h.panel.send({ type: 'native-action', action: 'extension-key', scope: 'stale' })
    expect(mocks.command).not.toHaveBeenCalled()
    h.panel.send({ type: 'native-action', action: 'shortcuts' })
    expect(mocks.command).toHaveBeenCalledWith('workbench.action.openGlobalKeybindings')
  })
})

describe('experimental bundle management', () => {
  it('enables an optional bundle after confirmation and projects only public facts', async () => {
    const data = fixture() as any; data.bundles = bundleFixture()
    const h = await harness('managed', data)
    expect(h.state().bundles.map((bundle: any) => bundle.name)).toContain('@deepseek-ai/dsh-experimental-cot-translation-bundle')
    expect(JSON.stringify(h.packets())).not.toContain('hidden-marker')
    mocks.warning.mockResolvedValueOnce('Enable')
    const reply = await h.result(h.send({ type: 'set-bundle', name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', enabled: true }))
    expect(reply).toMatchObject({ ok: true, application: 'applied' })
    expect(h.client.setBundleEnabled).toHaveBeenCalledWith('@deepseek-ai/dsh-experimental-cot-translation-bundle', true)
    expect(mocks.warning).toHaveBeenCalledOnce()
    expect(h.state().bundles.find((bundle: any) => bundle.name === '@deepseek-ai/dsh-experimental-cot-translation-bundle').enabled).toBe(true)
  })
  it('reports restart-required without presenting the change as already live', async () => {
    const data = fixture() as any; data.bundles = bundleFixture()
    const h = await harness('managed', data)
    mocks.warning.mockResolvedValueOnce('Enable')
    h.client.setBundleEnabled.mockResolvedValueOnce({ changed: true, application: 'restart-required', restartReason: 'package-moved', stage: 'enable', target: 'x' })
    const reply = await h.result(h.send({ type: 'set-bundle', name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', enabled: true }))
    expect(reply).toMatchObject({ ok: true, application: 'restart-required', restartRequired: true })
    expect(reply.message).toBeUndefined()
  })
  it('does not change bundles on an attach-only runtime', async () => {
    const data = fixture() as any; data.bundles = bundleFixture()
    const h = await harness('external', data)
    const reply = await h.result(h.send({ type: 'set-bundle', name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', enabled: true }))
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('attach-only')
    expect(h.client.setBundleEnabled).not.toHaveBeenCalled()
  })
  it('refuses bundle changes while a DeepSeek task is running', async () => {
    const data = fixture() as any; data.bundles = bundleFixture()
    const h = await harness('managed', data); h.host.hasRunningTasks = true
    const reply = await h.result(h.send({ type: 'set-bundle', name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', enabled: true }))
    expect(reply.error).toContain('running DeepSeek tasks')
    expect(h.client.setBundleEnabled).not.toHaveBeenCalled()
  })
  it('keeps the bundle unchanged when the confirmation is dismissed', async () => {
    const data = fixture() as any; data.bundles = bundleFixture()
    const h = await harness('managed', data); mocks.warning.mockResolvedValueOnce(undefined)
    const reply = await h.result(h.send({ type: 'set-bundle', name: '@deepseek-ai/dsh-experimental-cot-translation-bundle', enabled: true }))
    expect(reply).toMatchObject({ ok: false, cancelled: true })
    expect(h.client.setBundleEnabled).not.toHaveBeenCalled()
  })
  it('refreshes bundle state after a runtime plugin invalidation', async () => {
    const data = fixture() as any; data.bundles = bundleFixture()
    const h = await harness('managed', data)
    expect(h.state().bundles.find((bundle: any) => bundle.name === '@deepseek-ai/dsh-experimental-cot-translation-bundle').enabled).toBe(false)
    data.bundles[1].enabled = true
    h.changes.fire()
    await vi.waitFor(() => {
      expect(h.state().bundles.find((bundle: any) => bundle.name === '@deepseek-ai/dsh-experimental-cot-translation-bundle').enabled).toBe(true)
    })
  })
  it('degrades to the read-only inventory when the runtime lacks bundle management', async () => {
    const data = fixture() as any; data.bundles = bundleFixture()
    const h = await harness('managed', data)
    h.client.listBundles.mockRejectedValueOnce(new Error('gateway/invocation-unavailable'))
    h.panel.send({ type: 'refresh' })
    await vi.waitFor(() => expect(h.state().bundles).toBeUndefined())
    expect(h.state().forms.length).toBeGreaterThan(0)
  })
})
