/**
 * Host-level wiring around the permission preset acknowledgement.
 *
 * `DshSurface` is private to the extension module, so this spec activates the
 * extension with a mocked VS Code host and a mocked DSH runtime, opens the
 * editor surface through its public command, and drives the real Webview
 * message handler. The pure gate (`permissionConfirmationFor`) is covered by
 * tests/collaboration-state.spec.ts; this file exists so deleting the
 * `showWarningMessage` call from the host cannot leave the suite green.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshConnectionError } from '../src/dsh-connection.js'
import { env } from 'vscode'
import type { DshFrame, SessionModels, SkillDescriptor } from '../src/dsh-client.js'

const mocks = vi.hoisted(() => ({
  client: undefined as any,
  warning: vi.fn(async (..._args: any[]) => undefined as any),
  info: vi.fn(async () => undefined),
  error: vi.fn(async () => undefined),
  command: vi.fn(async (..._args: any[]) => undefined),
  panels: [] as any[],
  contexts: [] as any[],
  commands: new Map<string, (...args: any[]) => any>(),
  output: [] as string[],
  fsStat: vi.fn(async (..._args: any[]) => ({ type: 1 })),
  fsReadFile: vi.fn(async (..._args: any[]) => Buffer.from('abc')),
  openDialog: vi.fn(async (..._args: any[]) => undefined as any),
  input: vi.fn(async (..._args: any[]) => undefined as any),
  pick: vi.fn(async (..._args: any[]) => undefined as any),
  progress: vi.fn(async (_options: any, task: any) => task({ report: () => {} })),
  runtime: undefined as any,
  broker: undefined as any,
  brokerState: { descriptor: undefined as any, running: false, leases: [] as any[] },
}))

vi.mock('vscode', () => {
  class EventEmitter {
    private readonly listeners = new Set<(value: any) => void>()
    readonly event = (listener: (value: any) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) } }
    fire(value?: any) { for (const listener of [...this.listeners]) listener(value) }
    dispose() { this.listeners.clear() }
  }
  const disposable = () => ({ dispose: () => {} })
  const uri = (fsPath: string) => ({ fsPath, scheme: 'file', path: fsPath, toString: () => fsPath })
  const Uri = {
    file: uri,
    parse: (value: string) => {
      const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(value)
      if (match === null) return uri(value)
      return { fsPath: match[3] ?? '/', scheme: match[1]!.toLowerCase(), authority: match[2] ?? '', path: match[3] ?? '/', toString: () => value }
    },
    joinPath: (...parts: any[]) => uri(parts.map(part => typeof part === 'string' ? part : part.fsPath).join('/')),
  }
  const workspaceFolder = { uri: uri('/workspace'), name: 'workspace', index: 0 }
  return {
    EventEmitter,
    Uri,
    ViewColumn: { Active: 1, Beside: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    FileType: { File: 1, Directory: 2 },
    env: { language: 'en', remoteName: undefined, clipboard: { writeText: vi.fn(async () => {}) }, openExternal: vi.fn(async () => true), asExternalUri: vi.fn(async (value: any) => value) },
    window: {
      createOutputChannel: () => ({ appendLine: (line: string) => { mocks.output.push(String(line)) }, append: () => {}, show: vi.fn(), dispose: vi.fn() }),
      registerWebviewViewProvider: vi.fn(() => disposable()),
      createWebviewPanel: vi.fn(() => {
        const listeners = new Set<(value: unknown) => void>()
        const webview = {
          cspSource: 'vscode-webview:', options: {}, html: '',
          asWebviewUri: (value: any) => value,
          postMessage: vi.fn(async () => true),
          onDidReceiveMessage: (listener: (value: unknown) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) } },
        }
        const panel = {
          webview, reveal: vi.fn(), dispose: vi.fn(),
          onDidDispose: vi.fn(() => disposable()),
          onDidChangeViewState: vi.fn(() => disposable()),
        }
        mocks.panels.push({ panel, send: (value: unknown) => { for (const listener of [...listeners]) listener(value) } })
        return panel
      }),
      showWarningMessage: mocks.warning,
      showInformationMessage: mocks.info,
      showErrorMessage: mocks.error,
      showInputBox: mocks.input,
      showQuickPick: mocks.pick,
      withProgress: (...args: any[]) => (mocks.progress as any)(...args),
      showOpenDialog: (...args: any[]) => (mocks.openDialog as any)(...args),
      onDidChangeActiveTextEditor: () => disposable(),
      onDidChangeTextEditorSelection: () => disposable(),
      activeTextEditor: undefined,
    },
    workspace: {
      isTrusted: true,
      workspaceFolders: [workspaceFolder],
      getConfiguration: () => ({ get: (_key: string, fallback: any) => fallback }),
      registerTextDocumentContentProvider: () => disposable(),
      onDidChangeConfiguration: () => disposable(),
      onDidChangeTextDocument: () => disposable(),
      onDidChangeWorkspaceFolders: () => disposable(),
      onDidCreateFiles: () => disposable(),
      onDidDeleteFiles: () => disposable(),
      onDidRenameFiles: () => disposable(),
      fs: { stat: (...args: any[]) => (mocks.fsStat as any)(...args), readFile: (...args: any[]) => (mocks.fsReadFile as any)(...args) },
    },
    commands: {
      registerCommand: (name: string, handler: (...args: any[]) => any) => { mocks.commands.set(name, handler); return disposable() },
      executeCommand: mocks.command,
    },
    debug: {
      registerDebugAdapterTrackerFactory: () => disposable(),
      onDidStartDebugSession: () => disposable(),
      onDidTerminateDebugSession: () => disposable(),
    },
    languages: { onDidChangeDiagnostics: () => disposable(), getDiagnostics: vi.fn(() => []) },
    Disposable: class { dispose() {} },
    Range: class { constructor(..._args: any[]) {} },
    Position: class { constructor(..._args: any[]) {} },
    Selection: class { constructor(..._args: any[]) {} },
    ThemeIcon: class { constructor(..._args: any[]) {} },
    TreeItem: class { constructor(..._args: any[]) {} },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  }
})

vi.mock('../src/runtime.js', () => ({
  DshRuntime: class {
    state: any = { kind: 'ready' as const, localUri: { toString: () => 'http://127.0.0.1:3080' } }
    releasedSessions = 0
    connection: any
    listener: ((state: any) => void) | undefined
    constructor() {
      this.connection = { canReauthenticate: true, reauthenticate: async () => {} }
      mocks.runtime = this
    }
    async start() {}
    async stop() {}
    async assertCanRestart() {}
    async prepareRestart() { return undefined }
    onDidChangeState = (listener: (state: any) => void) => { this.listener = listener; return { dispose: () => {} } }
    externalRuntimeUrlToRemember() { return undefined }
    async rememberExternalRuntime() { return true }
  },
}))

vi.mock('../src/runtime-broker.js', () => {
  class RuntimeBroker {
    constructor() { mocks.broker = this }
    readDescriptor() { return mocks.brokerState.descriptor }
    async isRecordRunning() { return mocks.brokerState.running }
    async liveLeases() { return mocks.brokerState.leases }
    async acquireTransition() { return { release: (): void => {} } }
    async sweep() { return [] }
    async stop() { return true }
    takeLease() { return Promise.resolve() }
    clearLease() {}
    clearDescriptor() {}
    publishOwnedRuntime() { return Promise.resolve() }
  }
  return {
    RuntimeBroker,
    nodeProcessProbe: () => ({}),
    sharedRuntimeDirectory: () => '/shared-runtimes',
    describeDescriptor: () => 'DSH runtime',
    describeLockHolders: () => '',
    sessionLockPaths: () => [],
  }
})

vi.mock('../src/runtime-recovery.js', () => ({
  inspectRecordedRuntime: async () => ({ state: 'none' }),
  endRecordedRuntime: async () => ({ ended: false, reason: 'unproved' }),
}))

vi.mock('../src/dsh-client.js', () => ({
  DshClient: class {
    constructor() { return mocks.client }
  },
}))

import * as vscode from 'vscode'
import {
  activate,
  deactivate,
  normalizedTranslationLanguage,
  translationFailureText,
  translationTargetLanguage,
} from '../src/extension.js'

const models = (id = 'model'): SessionModels => ({ current: { provider: 'p', model: id }, routable: true,
  groups: [{ id: 'p', name: 'Provider', models: [{ id, name: id }] }], failures: [] })


function testClient() {
  const listeners = new Set<(frame: DshFrame) => void>()
  const errors = new Set<(error: Error) => void>()
  const projections = { agentPreset: 'standard', plan: { active: false, pending: false } }
  const client = {
    onFrame: vi.fn((callback: (frame: DshFrame) => void) => { listeners.add(callback); return () => listeners.delete(callback) }),
    onError: vi.fn((callback: (error: Error) => void) => { errors.add(callback); return () => errors.delete(callback) }),
    startStreams: vi.fn(async () => {}), dispose: vi.fn(), handledSessionIds: [] as string[], respond: vi.fn(async () => ({ accepted: true })),
    monitorJobs: vi.fn(), goal: vi.fn(async () => null), schedules: vi.fn(async () => []), searchHistory: vi.fn(async () => ({ items: [], hasMore: false })),
    scheduleHistory: vi.fn(), changeGoal: vi.fn(), pendingRequests: vi.fn(() => []),
    scheduleRun: vi.fn(async (id: string) => ({ id })), scheduleEdit: vi.fn(async (id: string, edit: { action: string }) => edit.action === 'delete' ? { id, deleted: true } : { id }),
    scheduleDeleteInactive: vi.fn(async () => ({ deleted: 0 })), createSchedule: vi.fn(async () => ({ accepted: true })),
    pluginMarketIndexes: vi.fn(async () => []),
    pluginMarketSearch: vi.fn(async () => ({ entries: [], total: 0, nextOffset: null })),
    installBundle: vi.fn(async () => ({ changed: true, application: 'applied' as const })),
    listBundles: vi.fn(async () => [] as any[]),
    listWorkspaces: vi.fn(async () => ({ archivedSessionIds: [], pinnedSessionIds: [], pinningAvailable: false })),
    sessionProjections: vi.fn(async (): Promise<any> => ({kind:'sequenced',asOfSeq:1,values:{}})),
    adoptSessionProjections: vi.fn((_id:string,_seq:number,values:Record<string,unknown>)=>values),
    listSessions: vi.fn(async () => ({ items: ['a', 'b'].map(sessionId => ({ sessionId, cwd: '/workspace', updatedAt: 1,
      blank: true, running: false, agentAvailable: true, agentPreset: 'standard', projections: { values: { ...projections } } })) })),
    openSession: vi.fn(async () => ({ events: [], hasMore: false, projections: { ...projections }, isCurrent: () => true, activate() {} })),
    createSession: vi.fn(async () => ({ sessionId: 'created' })),
    models: vi.fn(async () => models()), currentModels: vi.fn(() => models()),
    listCommands: vi.fn(async () => [{ name: 'plan', description: 'Plan' }]),
    listSkills: vi.fn(async (): Promise<SkillDescriptor[]> => []),
    listAgentPresets: vi.fn(async () => ({ presets: [{ id: 'standard', trust: 'system', isDefault: true }, { id: 'minimal', trust: 'system', isDefault: false }] })),
    selectModel: vi.fn(async () => ({})), settings: vi.fn(), mutateSettings: vi.fn(), pluginInventory: vi.fn(), attachment: vi.fn(),
    selectAgentPreset: vi.fn(), prompt: vi.fn(async () => ({})),
    messageFeedback: vi.fn(async () => ({ ok: true, value: { items: [] } })),
    putMessageFeedback: vi.fn(async () => ({ ok: true, value: { messageId: 'm1', rating: 'positive', version: 1, createdAt: 1, updatedAt: 1 } })),
    deleteMessageFeedback: vi.fn(async () => ({ ok: true, value: { absent: true } })),
    recordSessionFeedback: vi.fn(async () => ({ recorded: true })),
    forkSession: vi.fn(async () => 'child'),
    updateQueue: vi.fn(async () => ({ accepted: true })),
    executeCommand: vi.fn(async () => ({ result: { kind: 'success' } })),
    permissionCatalog: vi.fn(async () => undefined),
    cotTranslationLimits: vi.fn(async () => undefined),
    cotTranslationTranslate: vi.fn(async (request: { text: string }) => `translated:${request.text}`),
    archiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
    unarchiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
    pinSession: vi.fn(async () => ({ pinnedSessionIds: [] })),
    unpinSession: vi.fn(async () => ({ pinnedSessionIds: [] })),
    killJob: vi.fn(async () => ({ outcome: 'requested' as const })),
    uploadFile: vi.fn(async (_sessionId: string, _data: string, name?: string) => ({ receiptId: 'receipt-1', file: { attachmentId: 'att-1', name: name ?? 'file', bytes: 3 } })),
    observeJob: vi.fn(() => () => {}),
    cancel: vi.fn(async () => ({ accepted: true as const })),
    interruptSubagent: vi.fn(async () => ({ accepted: true as const })),
    accountState: vi.fn(async () => ({ status: 'signed-out', attempt: null,
      links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } })),
    accountProfile: vi.fn(async () => null),
    accountBalance: vi.fn(async () => null),
    startAccountSignIn: vi.fn(async () => ({ status: 'signed-out', attempt: { id: 'a1', phase: 'initializing' },
      links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } })),
    cancelAccountSignIn: vi.fn(async () => ({ status: 'signed-out', attempt: { id: 'a1', phase: 'cancelled' },
      links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } })),
    signOutAccount: vi.fn(async () => ({ status: 'signed-out', attempt: null,
      links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } })),
  }
  const emit = (payload: Record<string, unknown>, channel: 'host' | 'mux' = 'host', rpcId = '') => {
    for (const listener of listeners) listener({ channel, rpcId, payload })
  }
  const fail = (error: Error) => { for (const listener of [...errors]) listener(error) }
  return { client, emit, fail }
}


describe('host surface wiring', () => {
  const CATALOG = {
    options: [
      { value: 'read-only', name: 'read-only' },
      { value: 'workspace-write', name: 'workspace-write' },
      { value: 'danger-full-access', name: 'danger-full-access' },
      { value: 'auto', name: 'auto' },
    ],
    defaultPreset: 'workspace-write',
  }

  afterEach(async () => {
    await deactivate()
    mocks.warning.mockReset()
    mocks.warning.mockResolvedValue(undefined)
    mocks.command.mockReset()
    mocks.command.mockResolvedValue(undefined)
    mocks.input.mockReset()
    mocks.input.mockResolvedValue(undefined)
    mocks.info.mockReset()
    mocks.info.mockResolvedValue(undefined)
    mocks.error.mockReset()
    mocks.error.mockResolvedValue(undefined)
    mocks.pick.mockReset()
    mocks.pick.mockResolvedValue(undefined)
    mocks.progress.mockReset()
    mocks.progress.mockImplementation(async (_options: any, task: any) => task({ report: () => {} }))
    mocks.brokerState.descriptor = undefined
    mocks.brokerState.running = false
    mocks.brokerState.leases = []
    mocks.panels.length = 0
    mocks.commands.clear()
    ;(vscode.env as { language: string }).language = 'en'
  })

  async function activated(options: { catalog?: unknown; translation?: unknown; language?: string; storagePath?: string; setup?: (client: any) => void } = {}) {
    const { client, emit, fail } = testClient()
    mocks.client = client
    client.listCommands.mockResolvedValue([
      { name: 'permission', description: 'Choose a permission preset' },
      { name: 'plan', description: 'Plan mode' },
    ])
    client.permissionCatalog.mockResolvedValue(options.catalog === undefined ? CATALOG : options.catalog)
    client.cotTranslationLimits.mockResolvedValue(options.translation)
    if (options.language !== undefined) (vscode.env as { language: string }).language = options.language
    options.setup?.(client)
    const context: any = {
      subscriptions: [] as Array<{ dispose(): void }>,
      extensionUri: { fsPath: '/extension' },
      extension: { packageJSON: { version: '0.1.16' } },
      globalStorageUri: options.storagePath === undefined ? undefined : { fsPath: options.storagePath },
      workspaceState: { get: () => [], update: async () => {} },
      globalState: { get: () => true, update: async () => {} },
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    }
    activate(context)
    mocks.contexts.push(context)
    await mocks.commands.get('deepseekHarness.openInEditor')!()
    const entry = mocks.panels.at(-1)
    await vi.waitFor(() => expect(client.permissionCatalog).toHaveBeenCalled())

    const posts = (): Array<Record<string, any>> =>
      entry.panel.webview.postMessage.mock.calls.map((call: any[]) => call[0] as Record<string, any>)
    const latestState = (): Record<string, any> | undefined =>
      posts().filter(packet => packet.type === 'state' || packet.type === 'state-update').at(-1)
    /** The state as the Webview would hold it: whole-state posts merged with patches. */
    const mergedState = (): Record<string, any> => {
      let state: Record<string, any> = {}
      for (const packet of posts()) {
        if (packet.type === 'state') state = { ...(packet.state ?? {}) }
        else if (packet.type === 'state-update' && packet.update?.patch !== undefined) state = { ...state, ...packet.update.patch }
      }
      return state
    }
    // The surface posts the whole state on `ready`, and a projection frame only
    // publishes the merged permissions list once the asynchronous catalogue read
    // has landed. Re-emitting until the full state shows `auto` is deterministic
    // without depending on timer ordering.
    const publishPermissions = async (): Promise<void> => {
      await vi.waitFor(() => {
        emit({ type: 'session/projection', sessionId: 'a', key: 'permissions',
          value: { currentValue: 'workspace-write' } }, 'mux')
        entry.send({ type: 'ready' })
        const state = latestState()
        const permissions = state?.state?.permissions ?? state?.update?.permissions
        expect(permissions?.some((item: any) => item.value === 'auto')).toBe(true)
      })
    }
    await publishPermissions()
    const send = (message: Record<string, unknown>): void => { entry.send(message) }
    return { context, client, entry, posts, send, publishPermissions, mergedState, emit, fail }
  }

  it('asks before switching to Auto review from the permission menu and cancels cleanly', async () => {
    const h = await activated()
    const statesBefore = h.posts().filter(packet => packet.type === 'state').length
    h.send({ type: 'select-permission', permission: 'auto' })
    await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1))
    expect(mocks.warning.mock.calls[0][0]).toContain('Auto review')
    expect(String(mocks.warning.mock.calls[0][1]?.detail)).toContain('experimental')
    expect(h.client.executeCommand).not.toHaveBeenCalled()
    // A declined switch republishes the authoritative state so the Webview
    // cannot keep the clicked row selected.
    await vi.waitFor(() => expect(h.posts().filter(packet => packet.type === 'state').length).toBeGreaterThan(statesBefore))
  })

  it('switches to Auto review after the confirmation is accepted', async () => {
    const h = await activated()
    mocks.warning.mockResolvedValueOnce('Enable Auto review')
    h.send({ type: 'select-permission', permission: 'auto' })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalled())
    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.warning.mock.calls[0][0]).toContain('Auto review')
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/permission auto', undefined)
  })

  it('keeps the Full access acknowledgement without prompting for stable presets', async () => {
    const h = await activated()
    mocks.warning.mockResolvedValueOnce('Enable Full Access')
    h.send({ type: 'select-permission', permission: 'danger-full-access' })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalled())
    expect(mocks.warning.mock.calls[0][0]).toContain('Full access')
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/permission danger-full-access', undefined)

    h.client.executeCommand.mockClear()
    h.send({ type: 'select-permission', permission: 'read-only' })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/permission read-only', undefined))
    expect(mocks.warning).toHaveBeenCalledTimes(1)
  })

  it('asks before a typed /permission auto command and restores the draft on cancel', async () => {
    const h = await activated()
    h.send({ type: 'send', sessionId: 'a', requestId: 7, text: '/permission auto', mode: 'queue' })
    await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'restore-draft'
      && packet.requestId === 7 && packet.text === '/permission auto')).toBe(true))
    expect(h.client.executeCommand).not.toHaveBeenCalled()
  })

  it('runs a typed /permission auto command after the confirmation is accepted', async () => {
    const h = await activated()
    mocks.warning.mockResolvedValueOnce('Enable Auto review')
    h.send({ type: 'send', sessionId: 'a', requestId: 8, text: '/permission auto', mode: 'queue' })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalled())
    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.warning.mock.calls[0][0]).toContain('Auto review')
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/permission auto', undefined)
    expect(h.posts().some(packet => packet.type === 'restore-draft')).toBe(false)
  })

  describe('cot translation bridge', () => {
    const LIMITS = {
      maxTextChars: 4_000,
      preferences: { provider: 'bing', targetLanguage: 'auto' },
      availableProviders: ['bing', 'google'],
    }

    it('normalizes editor languages for an auto translation target', () => {
      expect(normalizedTranslationLanguage('zh-cn')).toBe('zh')
      expect(normalizedTranslationLanguage('zh-TW')).toBe('zh')
      expect(normalizedTranslationLanguage('en-US')).toBe('en')
      expect(normalizedTranslationLanguage('ja')).toBe('ja')
      expect(normalizedTranslationLanguage('pt_BR')).toBe('pt')
      expect(normalizedTranslationLanguage('')).toBe('en')
      expect(translationTargetLanguage('auto', 'zh-cn')).toBe('zh')
      expect(translationTargetLanguage('ja', 'zh-cn')).toBe('ja')
    })

    it('exposes the probed capability with the editor-resolved target language', async () => {
      const h = await activated({ translation: LIMITS, language: 'zh-cn' })
      await vi.waitFor(() => expect(h.mergedState().translation).toMatchObject({
        provider: 'bing', targetLanguage: 'zh', available: true, maxTextChars: 4_000,
      }))
      expect(h.client.cotTranslationLimits).toHaveBeenCalled()
    })

    it('still tries the runtime provider when it is not listed as routable', async () => {
      // DSH does not pre-check `availableProviders`: that list only annotates
      // its settings form. A routing failure must come back from the translate
      // RPC so the UI can show a failed translation with Retry.
      const h = await activated({
        translation: { ...LIMITS, preferences: { provider: 'google', targetLanguage: 'zh-cn' }, availableProviders: ['bing'] },
      })
      await vi.waitFor(() => expect(h.mergedState().translation).toMatchObject({
        provider: 'google', targetLanguage: 'zh-cn', available: true, maxTextChars: 4_000,
      }))
      h.send({ type: 'translate-reasoning', requestId: 'r-unlisted', text: 'Reasoning' })
      await vi.waitFor(() => expect(h.posts()).toContainEqual({
        type: 'translate-reasoning-result', requestId: 'r-unlisted', ok: true, text: 'translated:Reasoning',
      }))
      expect(h.client.cotTranslationTranslate).toHaveBeenCalledWith({
        text: 'Reasoning', targetLanguage: 'zh-cn', provider: 'google', sessionId: 'a',
      })
    })

    it('translates reasoning through the preferred provider and scopes it to the session', async () => {
      const h = await activated({ translation: LIMITS })
      await vi.waitFor(() => expect(h.mergedState().translation?.available).toBe(true))
      h.send({ type: 'translate-reasoning', requestId: 'r-1', text: 'Reasoning paragraph' })
      await vi.waitFor(() => expect(h.posts()).toContainEqual({
        type: 'translate-reasoning-result', requestId: 'r-1', ok: true, text: 'translated:Reasoning paragraph',
      }))
      expect(h.client.cotTranslationTranslate).toHaveBeenCalledWith({
        text: 'Reasoning paragraph', targetLanguage: 'en', provider: 'bing', sessionId: 'a',
      })
    })

    it('rejects an invalid request without calling the runtime', async () => {
      const h = await activated({ translation: LIMITS })
      await vi.waitFor(() => expect(h.mergedState().translation?.available).toBe(true))
      h.send({ type: 'translate-reasoning', requestId: 'r-empty', text: '' })
      h.send({ type: 'translate-reasoning', requestId: 'r-long', text: 'x'.repeat(4_001) })
      h.send({ type: 'translate-reasoning', requestId: '', text: 'Reasoning' })
      await vi.waitFor(() => expect(h.posts().filter(packet => packet.type === 'translate-reasoning-result')).toHaveLength(2))
      const results = h.posts().filter(packet => packet.type === 'translate-reasoning-result')
      expect(results.map(packet => packet.ok)).toEqual([false, false])
      expect(h.client.cotTranslationTranslate).not.toHaveBeenCalled()
    })

    it('replies with the readable part of a provider failure', async () => {
      const h = await activated({ translation: LIMITS })
      await vi.waitFor(() => expect(h.mergedState().translation?.available).toBe(true))
      h.client.cotTranslationTranslate.mockRejectedValueOnce(
        Object.assign(new Error('Translation failed: provider timeout'), { code: 'cotTranslation/failed' }),
      )
      h.send({ type: 'translate-reasoning', requestId: 'r-fail', text: 'Reasoning' })
      await vi.waitFor(() => expect(h.posts()).toContainEqual({
        type: 'translate-reasoning-result', requestId: 'r-fail', ok: false, error: 'provider timeout',
      }))
    })

    it('answers a request that outlived its conversation instead of leaving it pending', async () => {
      const h = await activated({ translation: LIMITS })
      await vi.waitFor(() => expect(h.mergedState().translation?.available).toBe(true))
      const outgoing = Promise.withResolvers<string>()
      h.client.cotTranslationTranslate.mockReturnValueOnce(outgoing.promise)
      h.send({ type: 'translate-reasoning', requestId: 'r-late', text: 'Reasoning' })
      await vi.waitFor(() => expect(h.client.cotTranslationTranslate).toHaveBeenCalled())
      h.send({ type: 'select-session', sessionId: 'b' })
      await vi.waitFor(() => expect(h.mergedState().sessionId).toBe('b'))
      outgoing.resolve('translated late')
      await vi.waitFor(() => expect(h.posts()).toContainEqual({
        type: 'translate-reasoning-result', requestId: 'r-late', ok: false,
        error: expect.stringContaining('conversation changed'),
      }))
    })

    it('re-probes the capability when runtime settings change', async () => {
      const h = await activated({ translation: LIMITS })
      await vi.waitFor(() => expect(h.mergedState().translation?.provider).toBe('bing'))
      h.client.cotTranslationLimits.mockResolvedValue({
        maxTextChars: 2_000,
        preferences: { provider: 'deepseek-official', targetLanguage: 'ja' },
        availableProviders: ['deepseek-official'],
      })
      h.emit({ type: 'host/settings-changed', ns: 'cot-translation', revision: 2 }, 'host')
      await vi.waitFor(() => expect(h.mergedState().translation).toMatchObject({
        provider: 'deepseek-official', targetLanguage: 'ja', available: true, maxTextChars: 2_000,
      }))
    })

    it('clears the capability when the connection drops', async () => {
      const h = await activated({ translation: LIMITS })
      await vi.waitFor(() => expect(h.mergedState().translation?.available).toBe(true))
      h.fail(new Error('event stream lost'))
      await vi.waitFor(() => expect(h.mergedState().translation).toBeNull())
    })

    it('does not block the other surface actions while a translation is in flight', async () => {
      const h = await activated({ translation: LIMITS })
      await vi.waitFor(() => expect(h.mergedState().translation?.available).toBe(true))
      h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
      const outgoing = Promise.withResolvers<string>()
      h.client.cotTranslationTranslate.mockReturnValueOnce(outgoing.promise)
      h.send({ type: 'translate-reasoning', requestId: 'r-busy', text: 'Reasoning' })
      await vi.waitFor(() => expect(h.client.cotTranslationTranslate).toHaveBeenCalled())
      // The translation is still pending; a cancel must reach the runtime now.
      h.send({ type: 'cancel' })
      await vi.waitFor(() => expect(h.client.cancel).toHaveBeenCalled())
      outgoing.resolve('translated')
      await vi.waitFor(() => expect(h.posts()).toContainEqual({
        type: 'translate-reasoning-result', requestId: 'r-busy', ok: true, text: 'translated',
      }))
    })
  })

  it('does not start the runtime in an untrusted workspace', async () => {
    ;(vscode.workspace as { isTrusted: boolean }).isTrusted = false
    const { client } = testClient()
    mocks.client = client
    try {
      const context: any = {
        subscriptions: [] as Array<{ dispose(): void }>,
        extensionUri: { fsPath: '/extension' },
        extension: { packageJSON: { version: '0.1.16' } },
        globalStorageUri: undefined,
        workspaceState: { get: () => [], update: async () => {} },
        globalState: { get: () => true, update: async () => {} },
        secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
      }
      activate(context)
      mocks.contexts.push(context)
      await mocks.commands.get('deepseekHarness.openInEditor')!()
      const entry = mocks.panels.at(-1)
      // Nothing may reach the runtime or its client until the workspace is trusted.
      expect(client.permissionCatalog).not.toHaveBeenCalled()
      expect(client.listCommands).not.toHaveBeenCalled()
      entry.send({ type: 'ready' })
      await vi.waitFor(() => {
        const state = entry.panel.webview.postMessage.mock.calls
          .map((call: any[]) => call[0])
          .filter((packet: any) => packet.type === 'state')
          .at(-1)?.state
        expect(state?.phase).toBe('error')
        expect(String(state?.statusText)).toContain('trusted VS Code workspace')
      })
    } finally {
      ;(vscode.workspace as { isTrusted: boolean }).isTrusted = true
    }
  })

  describe('auto review approval reasons', () => {
    const request = (payload: Record<string, unknown>): Record<string, unknown> => ({
      type: 'approval/requested', sessionId: 'a', approvalId: 'ap-1', toolName: 'bash', ...payload,
    })

    it('prefers the localized display reason over the audited reason', async () => {
      const h = await activated()
      h.emit(request({
        reason: 'Auto review denied tool "bash"',
        displayReason: {
          en: 'Auto review denied this call: it deletes build output',
          zh: 'Auto review 拒绝了此调用：它会删除构建产物',
        },
      }), 'mux')
      await vi.waitFor(() => expect(h.mergedState().approval).toMatchObject({
        approvalId: 'ap-1',
        toolName: 'bash',
        reason: 'Auto review denied this call: it deletes build output',
      }))
    })

    it('uses the display reason for the editor language', async () => {
      const h = await activated()
      env.language = 'zh-cn'
      try {
        h.emit(request({
          reason: 'Auto review denied tool "bash"',
          displayReason: {
            en: 'Auto review denied this call: it deletes build output',
            zh: 'Auto review 拒绝了此调用：它会删除构建产物',
            ja: 'Auto review はこの呼び出しを拒否しました。',
          },
        }), 'mux')
        await vi.waitFor(() => expect(h.mergedState().approval?.reason).toBe('Auto review 拒绝了此调用：它会删除构建产物'))
      } finally { env.language = 'en' }
    })

    it('falls back to the English display reason for an unknown language', async () => {
      const h = await activated()
      env.language = 'xx-YY'
      try {
        h.emit(request({ reason: 'audited', displayReason: { en: 'English reason', ja: '日本語' } }), 'mux')
        await vi.waitFor(() => expect(h.mergedState().approval?.reason).toBe('English reason'))
      } finally { env.language = 'en' }
    })

    it('falls back to the English display reason when the language key is missing', async () => {
      const h = await activated()
      env.language = 'pt-br'
      try {
        h.emit(request({ reason: 'audited', displayReason: { en: 'English reason' } }), 'mux')
        await vi.waitFor(() => expect(h.mergedState().approval?.reason).toBe('English reason'))
      } finally { env.language = 'en' }
    })

    it('bounds and sanitizes a runtime approval reason', async () => {
      const h = await activated()
      h.emit(request({ reason: 'x'.repeat(6_000) + '\u0007\u0000y' }), 'mux')
      await vi.waitFor(() => expect(h.mergedState().approval?.reason).toBeDefined())
      const reason = String(h.mergedState().approval?.reason)
      expect(reason.length).toBeLessThanOrEqual(4_001)
      expect(reason).not.toContain('\u0007')
      expect(reason).not.toContain('\u0000')
    })

    it('falls back to the runtime reason when no display reason exists', async () => {
      const h = await activated()
      h.emit(request({ reason: 'Auto review denied tool "bash"' }), 'mux')
      await vi.waitFor(() => expect(h.mergedState().approval?.reason).toBe('Auto review denied tool "bash"'))
    })

    it.each([
      ['a non-object display reason', 'Auto review denied this call.'],
      ['a non-string en', { en: 42, zh: 'Auto review 拒绝了此调用。' }],
      ['a blank en', { en: '   ', zh: 'Auto review 拒绝了此调用。' }],
      ['an empty object', {}],
    ])('falls back to the runtime reason for %s', async (_name, displayReason) => {
      const h = await activated()
      h.emit(request({ reason: 'fallback reason', displayReason }), 'mux')
      await vi.waitFor(() => expect(h.mergedState().approval?.reason).toBe('fallback reason'))
    })
  })

  describe('stale stop and switching feedback', () => {
    const messages = (h: { posts: () => Array<Record<string, any>> }): Array<Record<string, any>> => {
      const all: Array<Record<string, any>> = []
      for (const packet of h.posts()) {
        if (packet.type === 'state') all.push(...(packet.state?.messages ?? []))
        else if (packet.type === 'state-update') {
          all.push(...(packet.update?.messages?.reset ?? []), ...(packet.update?.messages?.upserts ?? []))
        }
      }
      return all
    }

    it('forwards Stop when this window does not believe a turn is running', async () => {
      const h = await activated()
      h.client.cancel.mockClear()
      h.send({ type: 'cancel' })
      // The Stop click is never dropped on a stale-false local flag.
      await vi.waitFor(() => expect(h.client.cancel).toHaveBeenCalledWith('a'))
      expect(h.mergedState().stopping).toBe(false)
      expect(h.mergedState().cancelRequested).toBe(false)
    })

    it('shows the held banner when a stop request cannot be delivered', async () => {
      const h = await activated()
      h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
      h.client.cancel.mockRejectedValueOnce(Object.assign(
        new Error('conversation is already owned by an active write handle'),
        { code: 'session/writer-held' },
      ))
      h.send({ type: 'cancel' })
      // Held is explained by the composer banner, not by silence.
      await vi.waitFor(() => expect(h.mergedState().occupancyNotice).toContain('already in use'))
      await vi.waitFor(() => expect(h.mergedState().stopping).toBe(false))
    })

    it('reports a conversation this window cannot find instead of ignoring the click', async () => {
      const h = await activated()
      h.send({ type: 'select-session', sessionId: 'ghost' })
      await vi.waitFor(() => expect(messages(h).some(message => message.role === 'notice'
        && String(message.text).includes('not in the current project'))).toBe(true))
    })
  })

  describe('state delivery stalls', () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    beforeEach(() => {
      unhandled.length = 0
      process.on('unhandledRejection', onUnhandled)
    })
    afterEach(() => {
      process.off('unhandledRejection', onUnhandled)
    })

    const postMock = (h: any): ReturnType<typeof vi.fn> => h.entry.panel.webview.postMessage
    const fullStates = (h: any): Array<Record<string, any>> =>
      h.posts().filter((packet: Record<string, any>) => packet.type === 'state')
    /** Stall the first matching message; all other posts keep their real behaviour. */
    const stallFirst = (h: any, type: string): { stalled: PromiseWithResolvers<boolean>; called: () => number } => {
      const post = postMock(h)
      const real = post.getMockImplementation()!
      const stalled = Promise.withResolvers<boolean>()
      let calls = 0
      post.mockImplementation((message: Record<string, any>) =>
        message.type === type && calls++ === 0 ? stalled.promise : real(message))
      return { stalled, called: () => calls }
    }

    it('abandons a stalled update and posts the newest state as a full snapshot', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mocks.output.length = 0
        const { stalled, called } = stallFirst(h, 'state-update')
        const before = fullStates(h).length
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        expect(called()).toBe(1)
        // More state arrives while the first delivery hangs: only the newest is
        // kept, so no storm of posts can queue behind the dead promise.
        h.emit({ type: 'host/session-status', sessionId: 'a', running: false }, 'host')
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        expect(fullStates(h)).toHaveLength(before)
        await vi.advanceTimersByTimeAsync(2_100)
        // The queue continued, and the post that follows a timeout is a full
        // snapshot rather than a patch on a state the view may never have seen.
        expect(mocks.output.some(line => line.includes('state delivery stalled'))).toBe(true)
        const resent = fullStates(h).slice(before)
        expect(resent).toHaveLength(1)
        expect(resent[0]?.state).toMatchObject({ sessionId: 'a', running: true })
        // The late resolution must not become the base of later patches.
        stalled.resolve(false)
        await vi.advanceTimersByTimeAsync(20)
        h.emit({ type: 'host/session-status', sessionId: 'a', running: false }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        expect(h.posts().at(-1)).toMatchObject({ type: 'state-update' })
        expect(unhandled).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('delivers the switched full state while an earlier post is stalled', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mocks.output.length = 0
        const { stalled } = stallFirst(h, 'state-update')
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        h.send({ type: 'select-session', sessionId: 'b' })
        await vi.advanceTimersByTimeAsync(20)
        // The switch is queued behind the stalled delivery for now.
        expect(h.posts().some((packet: Record<string, any>) =>
          packet.type === 'state' && packet.state?.sessionId === 'b')).toBe(false)
        await vi.advanceTimersByTimeAsync(2_100)
        // … but it arrives once the stalled delivery is abandoned, as a full
        // state: the session change cannot ride on the old conversation.
        const switched = h.posts().filter((packet: Record<string, any>) =>
          packet.type === 'state' && packet.state?.sessionId === 'b')
        expect(switched.length).toBeGreaterThanOrEqual(1)
        expect(mocks.output.some(line => line.includes('state delivery stalled'))).toBe(true)
        // A late resolve cannot restore the old conversation's postedState.
        stalled.resolve(false)
        await vi.advanceTimersByTimeAsync(20)
        h.emit({ type: 'host/session-status', sessionId: 'b', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        expect(h.posts().at(-1)).toMatchObject({ type: 'state-update' })
        expect(unhandled).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('swallows a stalled delivery that rejects after its timeout', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const { stalled } = stallFirst(h, 'state-update')
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        await vi.advanceTimersByTimeAsync(2_100)
        stalled.reject(new Error('the Webview transport failed late'))
        await vi.advanceTimersByTimeAsync(20)
        expect(unhandled).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('resends a full state when the Webview asks while a delivery is stalled', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mocks.output.length = 0
        const { called } = stallFirst(h, 'state-update')
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        expect(called()).toBe(1)
        const before = fullStates(h).length
        h.send({ type: 'resync', staleMs: 6_000 })
        await vi.advanceTimersByTimeAsync(20)
        // The recovery bypasses both the throttle and the stalled queue.
        const resent = fullStates(h).slice(before)
        expect(resent).toHaveLength(1)
        expect(resent[0]?.state).toMatchObject({ sessionId: 'a', running: true })
        expect(mocks.output.some(line => line.includes('resent the full view state'))).toBe(true)
        await vi.advanceTimersByTimeAsync(2_100)
        // The abandoned attempt timed out after the resynchronization owned the
        // view; the log says so instead of claiming a fresh stall.
        expect(mocks.output.some(line => line.includes('state delivery stalled') && line.includes('superseded'))).toBe(true)
        expect(unhandled).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('falls back to a full snapshot when a state post is rejected outright', async () => {
      const h = await activated()
      const post = postMock(h)
      const real = post.getMockImplementation()!
      let rejected = false
      post.mockImplementation((message: Record<string, any>) => message.type === 'state-update' && !rejected
        ? (rejected = true, Promise.reject(new Error('the Webview transport closed')))
        : real(message))
      const before = fullStates(h).length
      mocks.output.length = 0
      h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
      await vi.waitFor(() => expect(mocks.output.some(line => line.includes('Could not publish state'))).toBe(true))
      // A rejected delivery is not a stall: the retry is simply a full snapshot.
      h.emit({ type: 'host/session-status', sessionId: 'a', running: false }, 'host')
      await vi.waitFor(() => expect(fullStates(h).length).toBeGreaterThan(before))
      expect(mocks.output.some(line => line.includes('state delivery stalled'))).toBe(false)
      expect(unhandled).toEqual([])
    })

    it('resends a full snapshot after a stall when nothing else is queued', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mocks.output.length = 0
        const { stalled } = stallFirst(h, 'state-update')
        const before = fullStates(h).length
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        await vi.advanceTimersByTimeAsync(2_100)
        const stallLine = mocks.output.find(line => line.includes('state delivery stalled'))
        expect(stallLine).toBeDefined()
        expect(stallLine).toContain('phase ready')
        expect(stallLine).toContain('generation ')
        expect(fullStates(h)).toHaveLength(before)
        expect(mocks.output.some(line => line.includes('retrying the full view state'))).toBe(false)
        // No newer state arrives: the Host itself resends the snapshot, because
        // a Webview stuck in a transition runs no watchdog of its own.
        await vi.advanceTimersByTimeAsync(1_600)
        expect(mocks.output.some(line => line.includes('retrying the full view state'))).toBe(true)
        const resent = fullStates(h).slice(before)
        expect(resent).toHaveLength(1)
        expect(resent[0]?.state).toMatchObject({ sessionId: 'a', running: true })
        stalled.resolve(false)
        await vi.advanceTimersByTimeAsync(20)
        expect(unhandled).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('lets a state arriving during the recovery delay take over', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mocks.output.length = 0
        const { stalled } = stallFirst(h, 'state-update')
        const before = fullStates(h).length
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        await vi.advanceTimersByTimeAsync(2_100)
        expect(mocks.output.some(line => line.includes('retrying the full view state'))).toBe(false)
        // The normal drain wins this race, so the proactive resend must be
        // cancelled rather than sending a second full snapshot.
        h.emit({ type: 'host/session-status', sessionId: 'a', running: false }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        expect(fullStates(h).slice(before)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1_600)
        expect(mocks.output.some(line => line.includes('retrying the full view state'))).toBe(false)
        expect(fullStates(h).slice(before)).toHaveLength(1)
        stalled.resolve(false)
        await vi.advanceTimersByTimeAsync(20)
        expect(unhandled).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('warns the user once when deliveries keep stalling', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mocks.warning.mockClear()
        mocks.output.length = 0
        const post = postMock(h)
        const real = post.getMockImplementation()!
        // Every state delivery hangs, as on a dead transport.
        post.mockImplementation((message: Record<string, any>) =>
          message.type === 'state' || message.type === 'state-update' ? new Promise<boolean>(() => {}) : real(message))
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        await vi.advanceTimersByTimeAsync(2_100)
        expect(mocks.warning).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1_600) // proactive resend starts
        await vi.advanceTimersByTimeAsync(2_100)
        expect(mocks.warning).not.toHaveBeenCalled()
        h.emit({ type: 'host/session-status', sessionId: 'a', running: false }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        await vi.advanceTimersByTimeAsync(2_100)
        expect(mocks.warning).toHaveBeenCalledTimes(1)
        expect(String(mocks.warning.mock.calls[0]?.[0])).toContain('not receiving state updates')
        // Further stalls inside the warning window stay quiet.
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        await vi.advanceTimersByTimeAsync(2_100)
        expect(mocks.warning).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('catches an unexpected drain failure and repairs the snapshot base', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const push = mocks.output.push
      try {
        mocks.output.length = 0
        const { stalled } = stallFirst(h, 'state-update')
        const before = fullStates(h).length
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        // Force the stall logging itself to throw: the rejection has to be
        // caught by the drain guard, not become an unhandled rejection.
        let throwOnce = true
        mocks.output.push = ((...items: string[]) => {
          if (throwOnce) {
            throwOnce = false
            throw new Error('log channel failed')
          }
          return push.apply(mocks.output, items)
        }) as typeof mocks.output.push
        await vi.advanceTimersByTimeAsync(2_100)
        expect(mocks.output.some(line => line.includes('state drain failed: log channel failed'))).toBe(true)
        // The failed drain invalidated the posted base: the next delivery is a
        // full snapshot rather than a patch.
        h.emit({ type: 'host/session-status', sessionId: 'a', running: false }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        expect(fullStates(h).slice(before)).toHaveLength(1)
        stalled.resolve(false)
        await vi.advanceTimersByTimeAsync(20)
        expect(unhandled).toEqual([])
      } finally {
        mocks.output.push = push
        vi.useRealTimers()
      }
    })
  })

  describe('diagnostic log safety', () => {
    const loggedLine = (prefix: string): string | undefined =>
      mocks.output.find(line => line.startsWith(prefix))

    it('redacts and single-lines error text reported by the Webview', async () => {
      const h = await activated()
      mocks.output.length = 0
      const canary = 'https://x/?token=CANARY\n[fake] Authorization: Bearer BEARERCANARY sk-CANARY1234567890 /Users/canary-user/file'
      h.send({ type: 'webview-error', message: `boom ${canary}` })
      await vi.waitFor(() => expect(loggedLine('[webview] error: boom')).toBeDefined())
      // The renderer's own failure report uses the same channel.
      h.send({ type: 'webview-error', message: `render failed: ${canary}` })
      await vi.waitFor(() => expect(loggedLine('[webview] error: render failed:')).toBeDefined())
      for (const line of [loggedLine('[webview] error: boom'), loggedLine('[webview] error: render failed:')]) {
        expect(line).toBeDefined()
        expect(line).toContain('[redacted]')
        expect(line).not.toContain('CANARY')
        expect(line).not.toContain('sk-CANARY1234567890')
        // One line only: the forged prefix stayed inside it.
        expect(line).toContain('[fake]')
      }
      expect(mocks.output.some(entry => entry.startsWith('[fake]'))).toBe(false)
    })

    it('records source, line and stack for a Webview failure and throttles repeats', async () => {
      const h = await activated()
      mocks.output.length = 0
      mocks.warning.mockClear(); mocks.info.mockClear(); mocks.error.mockClear()
      const clock = vi.spyOn(Date, 'now')
      try {
        clock.mockReturnValue(1_000)
        h.send({
          type: 'webview-error',
          message: 'render failed: boom',
          stack: 'Error: boom at render (webview.js:2:3)',
          source: 'vscode-webview://x/index.html',
          line: 42,
        })
        await vi.waitFor(() => expect(mocks.output.some(line => line.startsWith('[webview] error: render failed: boom'))).toBe(true))
        const first = mocks.output.find(line => line.startsWith('[webview] error: render failed: boom'))!
        expect(first).toContain('vscode-webview://x/index.html:42')
        expect(first).toContain('at render')
        // The identical failure inside ten seconds is recorded once.
        h.send({ type: 'webview-error', message: 'render failed: boom', stack: 'Error: boom' })
        await Promise.resolve()
        expect(mocks.output.filter(line => line.startsWith('[webview] error: render failed: boom'))).toHaveLength(1)
        // Another message is an independent throttle key.
        h.send({ type: 'webview-error', message: 'unhandled rejection: other' })
        await vi.waitFor(() => expect(mocks.output.some(line => line.startsWith('[webview] error: unhandled rejection: other'))).toBe(true))
        // Once the interval passes, the repeats are recorded again.
        clock.mockReturnValue(12_000)
        h.send({ type: 'webview-error', message: 'render failed: boom' })
        await vi.waitFor(() => expect(mocks.output.filter(line => line.startsWith('[webview] error: render failed: boom'))).toHaveLength(2))
      } finally {
        clock.mockRestore()
      }
      // Diagnostic evidence only: the Webview failure never becomes a toast.
      expect(mocks.warning).not.toHaveBeenCalled()
      expect(mocks.info).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
    })

    it('bounds one diagnostic line and marks the truncation', async () => {
      const h = await activated()
      mocks.output.length = 0
      h.send({ type: 'webview-error', message: 'x'.repeat(5_000) })
      await vi.waitFor(() => expect(loggedLine('[webview] ')).toBeDefined())
      const line = loggedLine('[webview] ')!
      expect(line.length).toBeLessThanOrEqual(301)
      expect(line.endsWith('…')).toBe(true)
    })

    it('replaces an unsafe Webview conversation id in the UI log', async () => {
      const h = await activated()
      mocks.output.length = 0
      h.send({ type: 'select-session', sessionId: 'evil\n[fake] forged' })
      await vi.waitFor(() => expect(loggedLine('[ui] select conversation ')).toBeDefined())
      const line = loggedLine('[ui] select conversation ')!
      expect(line).toContain('[ui] select conversation <invalid>')
      expect(line).not.toContain('\n')
      expect(mocks.output.some(entry => entry.startsWith('[fake]'))).toBe(false)
    })

    it('redacts a provider error quoted by a failed open', async () => {
      const h = await activated()
      mocks.output.length = 0
      h.client.openSession.mockRejectedValueOnce(new Error(
        'open failed https://x/?token=CANARY\n[fake] sk-CANARY1234567890'))
      h.send({ type: 'select-session', sessionId: 'b' })
      await vi.waitFor(() => expect(loggedLine('[chat] opening conversation b failed')).toBeDefined())
      const line = loggedLine('[chat] opening conversation b failed')!
      expect(line).not.toContain('CANARY')
      expect(line).not.toContain('sk-CANARY1234567890')
      expect(line).not.toContain('\n')
      expect(mocks.output.some(entry => entry.startsWith('[fake]'))).toBe(false)
    })

    it('redacts a transport error that reaches the publish-failure log', async () => {
      const h = await activated()
      mocks.output.length = 0
      const post = h.entry.panel.webview.postMessage as ReturnType<typeof vi.fn>
      const real = post.getMockImplementation()!
      post.mockImplementation((message: Record<string, any>) => message.type === 'state-update'
        ? Promise.reject(new Error('publish failed https://x/?token=CANARY sk-CANARY1234567890'))
        : real(message))
      h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
      await vi.waitFor(() => expect(loggedLine('[webview] Could not publish state')).toBeDefined())
      const line = loggedLine('[webview] Could not publish state')!
      expect(line).not.toContain('CANARY')
      expect(line).not.toContain('sk-CANARY1234567890')
    })

    it('redacts an error surfaced by a failed drain', async () => {
      const h = await activated()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const push = mocks.output.push
      try {
        mocks.output.length = 0
        const post = h.entry.panel.webview.postMessage as ReturnType<typeof vi.fn>
        const real = post.getMockImplementation()!
        post.mockImplementation((message: Record<string, any>) => message.type === 'state-update'
          ? new Promise<boolean>(() => {})
          : real(message))
        h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
        await vi.advanceTimersByTimeAsync(20)
        // Force the stall log to throw with a canary: the drain guard must still
        // write a redacted line.
        let throwOnce = true
        mocks.output.push = ((...items: string[]) => {
          if (throwOnce) {
            throwOnce = false
            throw new Error('log channel failed https://x/?token=CANARY sk-CANARY1234567890')
          }
          return push.apply(mocks.output, items)
        }) as typeof mocks.output.push
        await vi.advanceTimersByTimeAsync(2_100)
        const line = loggedLine('[webview] state drain failed')
        expect(line).toBeDefined()
        expect(line).not.toContain('CANARY')
        expect(line).not.toContain('sk-CANARY1234567890')
      } finally {
        mocks.output.push = push
        vi.useRealTimers()
      }
    })

    it('leaves ordinary diagnostic lines intact', async () => {
      const h = await activated()
      mocks.output.length = 0
      h.send({ type: 'cancel' })
      await vi.waitFor(() => expect(loggedLine('[cancel] requested for a')).toBeDefined())
      expect(loggedLine('[cancel] requested for a')).toBe('[cancel] requested for a')
    })
  })

  describe('conversation menu host handlers', () => {
    const messages = (h: { posts: () => Array<Record<string, any>> }): Array<Record<string, any>> => {
      const all: Array<Record<string, any>> = []
      for (const packet of h.posts()) {
        if (packet.type === 'state') all.push(...(packet.state?.messages ?? []))
        else if (packet.type === 'state-update') {
          all.push(...(packet.update?.messages?.reset ?? []), ...(packet.update?.messages?.upserts ?? []))
        }
      }
      return all
    }

    it('pins and unpins through the runtime and publishes the new order', async () => {
      const h = await activated()
      h.client.pinSession.mockResolvedValueOnce({ pinnedSessionIds: ['a'] })
      h.send({ type: 'pin-session', sessionId: 'a' })
      await vi.waitFor(() => expect(h.client.pinSession).toHaveBeenCalledWith('a'))
      await vi.waitFor(() => expect(h.mergedState().pinnedSessionIds).toEqual(['a']))
      expect(h.mergedState().pinningAvailable).toBe(true)

      h.client.unpinSession.mockResolvedValueOnce({ pinnedSessionIds: [] })
      h.send({ type: 'unpin-session', sessionId: 'a' })
      await vi.waitFor(() => expect(h.client.unpinSession).toHaveBeenCalledWith('a'))
      await vi.waitFor(() => expect(h.mergedState().pinnedSessionIds).toEqual([]))
    })

    it('applies a pinned-sessions host change without re-listing', async () => {
      const h = await activated()
      h.emit({ type: 'host/pinned-sessions-changed', pinnedSessionIds: ['b', 'a'] }, 'host')
      await vi.waitFor(() => expect(h.mergedState().pinnedSessionIds).toEqual(['b', 'a']))
      expect(h.mergedState().pinningAvailable).toBe(true)
    })

    it('copies the conversation id to the clipboard', async () => {
      const h = await activated()
      const clipboard = (await import('vscode')).env.clipboard.writeText as ReturnType<typeof vi.fn>
      clipboard.mockClear()
      h.send({ type: 'copy-session-id', sessionId: 'a' })
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('a'))
    })

    it('forks at an explicit numeric boundary from the branch button', async () => {
      const h = await activated()
      h.client.forkSession.mockClear()
      h.send({ type: 'fork-conversation', sessionId: 'a', atSeq: 42 })
      await vi.waitFor(() => expect(h.client.forkSession).toHaveBeenCalledWith('a', 42))
    })

    it('refuses a bare menu fork when no turn has completed', async () => {
      const h = await activated()
      h.client.forkSession.mockClear()
      h.send({ type: 'fork-conversation', sessionId: 'a' })
      await vi.waitFor(() => expect(messages(h).some(message => message.role === 'notice'
        && String(message.text).includes('no completed turn to branch from'))).toBe(true))
      expect(h.client.forkSession).not.toHaveBeenCalled()
    })

    it('reports a failed pin instead of dropping the click', async () => {
      const h = await activated()
      h.client.pinSession.mockRejectedValueOnce(new Error('pinning is unavailable on this runtime'))
      h.send({ type: 'pin-session', sessionId: 'a' })
      await vi.waitFor(() => expect(messages(h).some(message => message.role === 'notice'
        && String(message.text).includes('pinning is unavailable'))).toBe(true))
    })

    it('reports a failed clipboard write', async () => {
      const h = await activated()
      const clipboard = (await import('vscode')).env.clipboard.writeText as ReturnType<typeof vi.fn>
      clipboard.mockRejectedValueOnce(new Error('clipboard is unavailable'))
      h.send({ type: 'copy-session-id', sessionId: 'a' })
      await vi.waitFor(() => expect(messages(h).some(message => message.role === 'notice'
        && String(message.text).includes('clipboard is unavailable'))).toBe(true))
    })

    it('treats a non-finite boundary as a bare menu fork', async () => {
      const h = await activated()
      h.client.forkSession.mockClear()
      h.send({ type: 'fork-conversation', sessionId: 'a', atSeq: 'not-a-number' })
      await vi.waitFor(() => expect(messages(h).some(message => message.role === 'notice'
        && String(message.text).includes('no completed turn to branch from'))).toBe(true))
      expect(h.client.forkSession).not.toHaveBeenCalled()
    })
  })



  describe('background task host wiring', () => {
  it('answers an inline output open for an unknown job with an error message', async () => {
    const h = await activated()
    h.send({ type: 'job-output-open', sessionId: 'a', jobId: 'missing-job' })
    await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'job-output-error')).toBe(true))
    expect(h.posts().find(packet => packet.type === 'job-output-error')).toMatchObject({ jobId: 'missing-job' })
  })
  it('reports a failed background-job stop inline instead of a dialog', async () => {
    const h = await activated()
    h.send({ type: 'kill-job', sessionId: 'a', jobId: 'missing-job' })
    await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'job-kill-result')).toBe(true))
    const result = h.posts().find(packet => packet.type === 'job-kill-result')!
    expect(result).toMatchObject({ ok: false, jobId: 'missing-job' })
    expect(mocks.error).not.toHaveBeenCalled()
  })
  it('rejects a forged job message from another project without opening a stream', async () => {
    const h = await activated()
    h.client.observeJob.mockClear()
    h.client.killJob.mockClear()
    h.send({ type: 'job-output-open', sessionId: 'other-project', jobId: 'job-x' })
    h.send({ type: 'kill-job', sessionId: 'other-project', jobId: 'job-x' })
    await vi.waitFor(() => expect(h.posts().filter(packet => packet.type === 'job-output-error' || packet.type === 'job-kill-result').length).toBe(2))
    expect(h.client.observeJob).not.toHaveBeenCalled()
    expect(h.client.killJob).not.toHaveBeenCalled()
    expect(h.posts().find(packet => packet.type === 'job-kill-result')).toMatchObject({ ok: false })
  })

  describe('dropped reference resolution', () => {
    const resolve = (h: any, resources: unknown[], requestId = 1) => h.send({ type: 'resolve-references', sessionId: 'a', requestId, resources })
    const resolved = (h: any) => h.posts().filter((packet: any) => packet.type === 'references-resolved').at(-1)
    beforeEach(() => { mocks.fsStat.mockReset(); mocks.fsStat.mockResolvedValue({ type: 1 }); mocks.fsReadFile.mockReset(); mocks.openDialog.mockReset() })

    it('builds workspace-relative, absolute, folder and quoted references', async () => {
      const h = await activated()
      resolve(h, [
        { uri: '/workspace/src/a.ts', source: 'internal' },
        { uri: '/elsewhere/b.ts', source: 'internal' },
      ])
      await vi.waitFor(() => expect(resolved(h)).toBeDefined())
      expect(resolved(h).references).toEqual([
        { text: '@src/a.ts', label: 'a.ts', kind: 'file' },
        { text: '@/elsewhere/b.ts', label: 'b.ts', kind: 'file' },
      ])
      mocks.fsStat.mockResolvedValue({ type: 2 })
      resolve(h, [{ uri: '/workspace/docs', source: 'internal' }], 2)
      await vi.waitFor(() => expect(resolved(h).requestId).toBe(2))
      expect(resolved(h).references[0]).toMatchObject({ text: '@docs/', kind: 'folder' })
      mocks.fsStat.mockResolvedValue({ type: 1 })
      resolve(h, [{ uri: '/workspace/my file.txt', source: 'internal' }], 3)
      await vi.waitFor(() => expect(resolved(h).requestId).toBe(3))
      expect(resolved(h).references[0].text).toBe('@"my file.txt"')
    })

    it('rejects unsafe paths and keeps client paths out of a remote window', async () => {
      const h = await activated()
      resolve(h, [{ uri: '/workspace/bad\u0007.txt', source: 'internal' }])
      await vi.waitFor(() => expect(resolved(h)).toBeDefined())
      expect(resolved(h).references).toEqual([])
      expect(resolved(h).errors.length).toBeGreaterThan(0)
      const env = (vscode.env as { remoteName?: string })
      const before = env.remoteName
      env.remoteName = 'ssh-remote'
      try {
        // A drag payload can name a client-machine path. Even though the path
        // looks in-project, the uri-list source keeps it a client path.
        resolve(h, [{ uri: '/workspace/src/a.ts', source: 'uri-list' }], 2)
        await vi.waitFor(() => expect(resolved(h).requestId).toBe(2))
        expect(resolved(h).references).toEqual([])
        expect(String(resolved(h).errors[0])).toContain('Dragged text paths')
        // An internal resource outside the project is refused with the two
        // working entry points, and it is never stat-ed.
        const statCalls = mocks.fsStat.mock.calls.length
        resolve(h, [{ uri: '/elsewhere/b.ts', source: 'internal' }], 3)
        await vi.waitFor(() => expect(resolved(h).requestId).toBe(3))
        expect(resolved(h).references).toEqual([])
        expect(String(resolved(h).errors[0])).toContain('remote Explorer')
        expect(String(resolved(h).errors[0])).toContain('Upload from this computer')
        expect(mocks.fsStat.mock.calls.length).toBe(statCalls)
      } finally { env.remoteName = before }
    })

    it('pins a line-range drag as IDE context and still returns the path reference', async () => {
      const h = await activated()
      resolve(h, [{ uri: '/workspace/src/a.ts', source: 'internal', startLine: 2, endLine: 4 }])
      await vi.waitFor(() => expect(resolved(h)).toBeDefined())
      expect(resolved(h).pinned).toBe(1)
      expect(resolved(h).references[0].text).toBe('@src/a.ts')
    })

    it('reports upload states inline without a warning dialog', async () => {
      const h = await activated()
      h.send({ type: 'attach-files', sessionId: 'a', requestId: 7, files: [{ name: 'notes.txt', data: Buffer.from('abc').toString('base64') }] })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'file-upload' && packet.state === 'ready')).toBe(true))
      const states = h.posts().filter(packet => packet.type === 'file-upload').map(packet => packet.state)
      expect(states).toContain('uploading')
      expect(states).toContain('ready')
      expect(mocks.warning).not.toHaveBeenCalled()
      h.client.uploadFile.mockRejectedValueOnce(new Error('upload failed'))
      h.send({ type: 'attach-files', sessionId: 'a', requestId: 8, files: [{ name: 'bad.txt', data: Buffer.from('abc').toString('base64') }] })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'file-upload' && packet.state === 'error' && packet.requestId === 8)).toBe(true))
      expect(mocks.warning).not.toHaveBeenCalled()
    })

    it('splits picker selections into uploaded files and draft images', async () => {
      const h = await activated()
      mocks.openDialog.mockResolvedValue([{ fsPath: '/workspace/notes.txt', scheme: 'file' }, { fsPath: '/workspace/pic.png', scheme: 'file' }])
      mocks.fsStat.mockResolvedValue({ type: 1, size: 3 })
      mocks.fsReadFile.mockResolvedValue(Buffer.from('abc'))
      h.send({ type: 'choose-files', sessionId: 'a' })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'file-upload' && packet.state === 'ready')).toBe(true))
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'draft-images')).toBe(true))
      expect(mocks.openDialog).toHaveBeenCalled()
    })

    it('opens only one picker for repeated choose-files messages', async () => {
      const h = await activated()
      const pending = Promise.withResolvers<unknown>()
      mocks.openDialog.mockReset()
      mocks.openDialog.mockReturnValueOnce(pending.promise)
      h.send({ type: 'choose-files', sessionId: 'a' })
      h.send({ type: 'choose-files', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.openDialog).toHaveBeenCalledTimes(1))
      pending.resolve(undefined)
      // Let the first picker finish (and clear its single-flight flag) first.
      await new Promise(resolve => setTimeout(resolve, 10))
      mocks.openDialog.mockResolvedValue(undefined)
      h.send({ type: 'choose-files', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.openDialog).toHaveBeenCalledTimes(2))
    })
  })

  describe('drop authorization hardening', () => {
    const send = (h: any, resources: unknown[], requestId: number) => h.send({ type: 'resolve-references', sessionId: 'a', requestId, resources })
    const last = (h: any, requestId: number) => h.posts().filter((packet: any) => packet.type === 'references-resolved' && packet.requestId === requestId).at(-1)
    beforeEach(() => { mocks.fsStat.mockReset(); mocks.fsStat.mockResolvedValue({ type: 1 }) })

    it('rejects parent-directory and UNC paths', async () => {
      const h = await activated()
      send(h, [
        { uri: '/workspace/../outside.ts', source: 'internal' },
        { uri: '//server/share/file.ts', source: 'internal' },
        { uri: 'file://server/share/file.ts', source: 'internal' },
      ], 1)
      await vi.waitFor(() => expect(last(h, 1)).toBeDefined())
      expect(last(h, 1).references).toEqual([])
      expect(last(h, 1).errors.length).toBeGreaterThanOrEqual(3)
      expect(last(h, 1).errors.join(' ')).toMatch(/parent-directory|Network share/)
    })

    it('requires uri-list drops to stay inside the local workspace', async () => {
      const h = await activated()
      send(h, [{ uri: '/workspace/src/a.ts', source: 'uri-list' }], 1)
      await vi.waitFor(() => expect(last(h, 1)).toBeDefined())
      expect(last(h, 1).references[0].text).toBe('@src/a.ts')
      send(h, [{ uri: '/elsewhere/b.ts', source: 'uri-list' }], 2)
      await vi.waitFor(() => expect(last(h, 2)).toBeDefined())
      expect(last(h, 2).references).toEqual([])
      expect(last(h, 2).errors[0]).toContain('inside this workspace')
    })

    it('rejects a raw Windows drive path with a readable error', async () => {
      const h = await activated()
      send(h, [{ uri: 'C:\\work\\a.ts', source: 'internal' }], 1)
      await vi.waitFor(() => expect(last(h, 1)).toBeDefined())
      expect(last(h, 1).references).toEqual([])
      expect(last(h, 1).errors[0]).toContain('file:// URI')
      expect(mocks.fsStat).not.toHaveBeenCalled()
    })

    it('times out a stalled stat, reports and frees the single-flight guard', async () => {
      const h = await activated()
      const stalled = Promise.withResolvers<{ type: number }>()
      mocks.fsStat.mockReturnValueOnce(stalled.promise)
      send(h, [{ uri: '/workspace/src/a.ts', source: 'internal' }], 1)
      await vi.waitFor(() => expect(last(h, 1)).toBeDefined(), { timeout: 4_000 })
      expect(last(h, 1).errors.join(' ')).toContain('took too long to read')
      stalled.resolve({ type: 1 })
      // The guard was reset, so a fresh drop resolves normally.
      mocks.fsStat.mockResolvedValue({ type: 1 })
      send(h, [{ uri: '/workspace/src/b.ts', source: 'internal' }], 2)
      await vi.waitFor(() => expect(last(h, 2)?.references?.[0]?.text).toBe('@src/b.ts'))
    })

    it('times out a stalled selection pin without losing the path reference', async () => {
      const h = await activated()
      const stalled = Promise.withResolvers<{ type: number }>()
      // First stat (reference resolution) resolves; the pin path stat stalls.
      mocks.fsStat.mockResolvedValueOnce({ type: 1 }).mockReturnValueOnce(stalled.promise)
      send(h, [{ uri: '/workspace/src/a.ts', source: 'internal', startLine: 2, endLine: 3 }], 1)
      await vi.waitFor(() => expect(last(h, 1)?.references?.length).toBe(1), { timeout: 4_000 })
      expect(last(h, 1).errors.join(' ')).toContain('selection took too long')
      expect(last(h, 1).references[0].text).toBe('@src/a.ts')
      stalled.resolve({ type: 1 })
    })

    it('stops a batch that exceeds the overall resolve budget', async () => {
      vi.useFakeTimers()
      try {
        const h = await activated()
        mocks.fsStat.mockImplementation(() => new Promise<{ type: number }>(() => {}))
        const resources = Array.from({ length: 64 }, (_value, index) => ({ uri: `/workspace/src/${String(index)}.ts`, source: 'internal' }))
        send(h, resources, 1)
        for (let round = 0; round < 3; round++) await vi.advanceTimersByTimeAsync(3_000)
        for (let flush = 0; flush < 8; flush++) await Promise.resolve()
        expect(last(h, 1)).toBeDefined()
        expect(last(h, 1).errors.join(' ')).toContain('took too long to resolve')
        // The whole 64-item batch was not attempted after the budget expired.
        expect(mocks.fsStat.mock.calls.length).toBeLessThan(64)
      } finally { vi.useRealTimers() }
    })

    it('drops a late resolution after the conversation changes', async () => {
      const h = await activated()
      const stalled = Promise.withResolvers<{ type: number }>()
      mocks.fsStat.mockReturnValueOnce(stalled.promise)
      send(h, [{ uri: '/workspace/src/a.ts', source: 'internal' }], 1)
      h.send({ type: 'select-session', sessionId: 'b' })
      await vi.waitFor(() => expect(h.mergedState().sessionId).toBe('b'))
      stalled.resolve({ type: 1 })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(last(h, 1)).toBeUndefined()
      mocks.fsStat.mockResolvedValue({ type: 1 })
      h.send({ type: 'resolve-references', sessionId: 'b', requestId: 2,
        resources: [{ uri: '/workspace/src/b.ts', source: 'internal' }] })
      await vi.waitFor(() => expect(last(h, 2)?.references?.[0]?.text).toBe('@src/b.ts'))
    })

    it('refuses a second concurrent resolution and caches duplicate stats', async () => {
      const h = await activated()
      const pending = Promise.withResolvers<{ type: number }>()
      mocks.fsStat.mockReturnValueOnce(pending.promise)
      send(h, [{ uri: '/workspace/src/a.ts', source: 'internal' }], 1)
      await vi.waitFor(() => expect(mocks.fsStat).toHaveBeenCalledTimes(1))
      send(h, [{ uri: '/workspace/src/b.ts', source: 'internal' }], 2)
      await vi.waitFor(() => expect(last(h, 2)).toBeDefined())
      expect(last(h, 2).errors[0]).toContain('previous drop')
      pending.resolve({ type: 1 })
      await vi.waitFor(() => expect(last(h, 1)).toBeDefined())
      mocks.fsStat.mockClear()
      send(h, [
        { uri: '/workspace/src/a.ts', source: 'internal' },
        { uri: '/workspace/src/a.ts', source: 'internal' },
      ], 3)
      await vi.waitFor(() => expect(last(h, 3)).toBeDefined())
      // The 5 s stat cache (and the text de-duplication) mean the repeated URI
      // costs no second stat at all.
      expect(mocks.fsStat.mock.calls.length).toBeLessThanOrEqual(1)
      expect(last(h, 3).references).toHaveLength(1)
    })

    it('redacts an attachment error before showing it', async () => {
      const h = await activated()
      h.send({ type: 'attachment-error', message: 'boom\nsk-abcdefghijklmnop' })
      await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalled())
      const shown = String(mocks.warning.mock.calls.at(-1)![0])
      expect(shown).not.toContain('\n')
      expect(shown).not.toContain('sk-abcdefghijklmnop')
      expect(shown.length).toBeLessThanOrEqual(500)
    })
  })

  describe('forged attachment bounds', () => {
    const MAX_BASE64 = Math.ceil(32 * 1024 * 1024 * 4 / 3) + 4
    const data = Buffer.from('abc').toString('base64')
    beforeEach(() => { mocks.fsStat.mockReset() })

    it('uploads at most eight files from a forged oversized list', async () => {
      const h = await activated()
      const files = Array.from({ length: 20 }, (_value, index) => ({ name: `f-${String(index)}.txt`, data }))
      h.send({ type: 'attach-files', sessionId: 'a', requestId: 1, files })
      await vi.waitFor(() => expect(h.posts().filter(packet => packet.type === 'file-upload' && packet.state === 'ready')).toHaveLength(8))
      expect(h.client.uploadFile).toHaveBeenCalledTimes(8)
    })

    it('rejects an oversized base64 payload before decoding or uploading', async () => {
      const h = await activated()
      h.send({ type: 'attach-files', sessionId: 'a', requestId: 1, files: [{ name: 'huge.bin', data: 'A'.repeat(MAX_BASE64 + 1) }] })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'file-upload' && packet.state === 'error')).toBe(true))
      expect(h.client.uploadFile).not.toHaveBeenCalled()
    })

    it('sanitizes a forged file name to one bounded line', async () => {
      const h = await activated()
      h.send({ type: 'attach-files', sessionId: 'a', requestId: 1,
        files: [{ name: `bad\nname${'x'.repeat(400)}`, data }] })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'file-upload' && packet.state === 'ready')).toBe(true))
      const ready = h.posts().find(packet => packet.type === 'file-upload' && packet.state === 'ready')!
      expect(String(ready.name)).not.toContain('\n')
      expect(String(ready.name).length).toBeLessThanOrEqual(256)
    })

    it('throttles repeated webview attachment-error warnings', async () => {
      const h = await activated()
      mocks.warning.mockClear()
      h.send({ type: 'attachment-error', message: 'first' })
      h.send({ type: 'attachment-error', message: 'second' })
      h.send({ type: 'attachment-error', message: 'third' })
      await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1))
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(mocks.warning).toHaveBeenCalledTimes(1)
      expect(String(mocks.warning.mock.calls[0]![0])).toBe('first')
    })

    const seedDraft = async (h: any) => {
      h.send({ type: 'attach-files', sessionId: 'a', requestId: 1, files: [{ name: 'draft.txt', data: Buffer.from('abc').toString('base64') }] })
      await vi.waitFor(() => expect(h.posts().some((packet: any) => packet.type === 'draft-files'
        && packet.sessionId === 'a' && (packet.files as unknown[]).length === 1)).toBe(true))
    }
    const emptyPublishes = (h: any) => h.posts().filter((packet: any) => packet.sessionId === 'a'
      && ((packet.type === 'draft-files' && (packet.files as unknown[]).length === 0)
        || (packet.type === 'draft-images' && (packet.images as unknown[]).length === 0))).length

    it('publishes empty draft lists when the runtime connection is lost', async () => {
      const h = await activated()
      await seedDraft(h)
      const before = emptyPublishes(h)
      // The runtime going away is what invalidates drafts (not a conversation switch).
      mocks.runtime.listener!({ kind: 'failed', message: 'lost' })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'draft-files'
        && packet.sessionId === 'a' && (packet.files as unknown[]).length === 0)).toBe(true))
      expect(emptyPublishes(h)).toBeGreaterThan(before)
      expect(h.posts().some(packet => packet.type === 'draft-images' && packet.sessionId === 'a' && (packet.images as unknown[]).length === 0)).toBe(true)
    })

    it('publishes an empty draft list for an archived conversation', async () => {
      const h = await activated()
      await seedDraft(h)
      const before = emptyPublishes(h)
      h.emit({ type: 'host/archived-sessions-changed', archivedSessionIds: ['a'] }, 'host')
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'draft-files'
        && packet.sessionId === 'a' && (packet.files as unknown[]).length === 0)).toBe(true))
      expect(emptyPublishes(h)).toBeGreaterThan(before)
    })

    it('does not clear drafts on an ordinary conversation switch', async () => {
      const h = await activated()
      await seedDraft(h)
      const before = emptyPublishes(h)
      h.send({ type: 'select-session', sessionId: 'b' })
      await vi.waitFor(() => expect(h.mergedState().sessionId).toBe('b'))
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(emptyPublishes(h)).toBe(before)
      // The original conversation's draft is still held for when the user returns.
      expect(h.posts().some(packet => packet.type === 'draft-files' && packet.sessionId === 'a' && (packet.files as unknown[]).length === 1)).toBe(true)
    })

    it('uploads a zero-byte file through the normal state machine', async () => {
      const h = await activated()
      h.send({ type: 'attach-files', sessionId: 'a', requestId: 1, files: [{ name: 'empty.txt', data: '' }] })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'file-upload' && packet.state === 'ready')).toBe(true))
      expect(h.client.uploadFile).toHaveBeenCalledWith('a', '', 'empty.txt')
    })

    it('bounds forged image batches and reports rejected images inline', async () => {
      const h = await activated()
      const png = Buffer.from('png').toString('base64')
      const images = Array.from({ length: 20 }, (_value, index) => ({ mediaType: 'image/png', data: png, name: `p-${String(index)}.png` }))
      h.send({ type: 'attach-images', sessionId: 'a', requestId: 1, images })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'draft-images')).toBe(true))
      const draft = h.posts().filter(packet => packet.type === 'draft-images').at(-1)!
      expect((draft.images as unknown[]).length).toBeLessThanOrEqual(8)
      h.send({ type: 'attach-images', sessionId: 'a', requestId: 2, images: [{ mediaType: 'image/png', data: 'A'.repeat(MAX_BASE64 + 1), name: 'huge.png' }] })
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'attachment-error')).toBe(true))
    })
  })
  describe('slash command attachments', () => {
    const messages = (h: { posts: () => Array<Record<string, any>> }): Array<Record<string, any>> => {
      const all: Array<Record<string, any>> = []
      for (const packet of h.posts()) {
        if (packet.type === 'state') all.push(...(packet.state?.messages ?? []))
        else if (packet.type === 'state-update') {
          all.push(...(packet.update?.messages?.reset ?? []), ...(packet.update?.messages?.upserts ?? []))
        }
      }
      return all
    }

    /** Stage one uploaded file through the ordinary Webview attachment path. */
    async function stagedFile(h: any, requestId = 1): Promise<void> {
      h.send({ type: 'attach-files', sessionId: 'a', requestId, files: [{ name: 'report.pdf', data: Buffer.from('abc').toString('base64') }] })
      await vi.waitFor(() => expect(h.posts().some((packet: any) => packet.type === 'draft-files'
        && (packet.files as unknown[]).length === 1)).toBe(true))
    }

    it('sends a staged file receipt with a command that declares attachments', async () => {
      const h = await activated()
      h.client.listCommands.mockResolvedValue([{ name: 'review', description: '', input: { hint: '', attachments: true } }])
      h.client.executeCommand.mockClear()
      await stagedFile(h)
      h.send({ type: 'send', sessionId: 'a', requestId: 9, text: '/review report', mode: 'queue' })
      await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledTimes(1))
      const [sessionId, line, attachments] = h.client.executeCommand.mock.calls[0]!
      expect(sessionId).toBe('a')
      expect(line).toBe('/review report')
      expect(attachments).toEqual([expect.objectContaining({ type: 'file', receiptId: 'receipt-1', name: 'report.pdf' })])
      expect(h.posts().some((packet: any) => packet.type === 'restore-draft')).toBe(false)
    })

    it('sends image and staged file attachments together', async () => {
      const h = await activated()
      h.client.listCommands.mockResolvedValue([{ name: 'review', description: '', input: { hint: '', attachments: true } }])
      h.client.executeCommand.mockClear()
      h.send({ type: 'attach-images', sessionId: 'a', requestId: 2, images: [{ mediaType: 'image/png', data: 'YWJj', name: 'shot.png' }] })
      await vi.waitFor(() => expect(h.posts().some((packet: any) => packet.type === 'draft-images'
        && (packet.images as unknown[]).length === 1)).toBe(true))
      await stagedFile(h)
      h.send({ type: 'send', sessionId: 'a', requestId: 10, text: '/review report', mode: 'queue' })
      await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledTimes(1))
      const attachments = h.client.executeCommand.mock.calls[0]![2] as any[]
      expect(attachments).toHaveLength(2)
      expect(attachments[0]).toMatchObject({ type: 'image', mediaType: 'image/png', data: 'YWJj', name: 'shot.png' })
      expect(attachments[1]).toMatchObject({ type: 'file', receiptId: 'receipt-1' })
    })

    it('still sends an image-only command declared through the legacy images flag', async () => {
      const h = await activated()
      h.client.listCommands.mockResolvedValue([{ name: 'plan', description: '', input: { hint: '', images: true } }])
      h.client.executeCommand.mockClear()
      h.send({ type: 'attach-images', sessionId: 'a', requestId: 2, images: [{ mediaType: 'image/png', data: 'YWJj', name: 'shot.png' }] })
      await vi.waitFor(() => expect(h.posts().some((packet: any) => packet.type === 'draft-images')).toBe(true))
      h.send({ type: 'send', sessionId: 'a', requestId: 11, text: '/plan inspect', mode: 'queue' })
      await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledTimes(1))
      expect(h.client.executeCommand.mock.calls[0]![2]).toEqual([expect.objectContaining({ type: 'image', mediaType: 'image/png', data: 'YWJj' })])
    })

    it('keeps the attachments on a held command and runs them after the turn', async () => {
      const h = await activated()
      h.client.listCommands.mockResolvedValue([{ name: 'review', description: '', input: { hint: '', attachments: true } }])
      h.client.executeCommand.mockClear()
      await stagedFile(h)
      h.emit({ type: 'host/session-status', sessionId: 'a', running: true }, 'host')
      await vi.waitFor(() => expect(h.mergedState().running).toBe(true))
      h.send({ type: 'send', sessionId: 'a', requestId: 12, text: '/review report', mode: 'queue' })
      await vi.waitFor(() => expect(h.mergedState().queuedCommands).toHaveLength(1))
      // The dock preview stays text only; the staged receipt rides along internally.
      expect(h.mergedState().queuedCommands[0]).toMatchObject({ text: '/review report', preview: '/review report' })
      expect(h.client.executeCommand).not.toHaveBeenCalled()
      h.emit({ type: 'host/session-status', sessionId: 'a', running: false }, 'host')
      await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(h.mergedState().queuedCommands).toEqual([]))
      expect(h.client.executeCommand.mock.calls[0]![2]).toEqual([expect.objectContaining({ type: 'file', receiptId: 'receipt-1' })])
    })

    it('refuses a file attachment for a command that declares none, with the original text', async () => {
      const h = await activated()
      h.client.listCommands.mockResolvedValue([{ name: 'plan', description: '', input: { hint: '' } }])
      h.client.executeCommand.mockClear()
      await stagedFile(h)
      h.send({ type: 'send', sessionId: 'a', requestId: 13, text: '/plan inspect', mode: 'queue' })
      await vi.waitFor(() => expect(h.posts().some((packet: any) => packet.type === 'restore-draft'
        && packet.requestId === 13)).toBe(true))
      expect(h.client.executeCommand).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(messages(h).some(message => message.role === 'notice'
        && String(message.text).includes('does not accept attachments'))).toBe(true))
    })

    it('names a command failure that carried a file without logging the receipt', async () => {
      const h = await activated()
      h.client.listCommands.mockResolvedValue([{ name: 'review', description: '', input: { hint: '', attachments: true } }])
      h.client.executeCommand.mockResolvedValueOnce({ commandId: 'command', result: { kind: 'error', text: 'The runtime could not read the attachment.' } })
      await stagedFile(h)
      mocks.output.length = 0
      h.send({ type: 'send', sessionId: 'a', requestId: 14, text: '/review report', mode: 'queue' })
      await vi.waitFor(() => expect(messages(h).some(message => message.role === 'notice'
        && String(message.text).includes('could not read the attachment'))).toBe(true))
      expect(mocks.output.every(line => !String(line).includes('receipt-1'))).toBe(true)
    })
  })

  describe('session feedback', () => {
    beforeEach(() => {
      mocks.info.mockClear()
      mocks.error.mockClear()
      mocks.pick.mockReset()
      mocks.pick.mockResolvedValue(undefined)
      mocks.input.mockReset()
      mocks.input.mockResolvedValue(undefined)
    })

    const feedbackText = 'The summary matched the requested format.'

    it('offers the seven contract categories plus a no-category choice', async () => {
      const h = await activated()
      h.send({ type: 'session-feedback', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(1))
      const items = mocks.pick.mock.calls[0]![0] as Array<{ label: string; category?: string }>
      expect(items.filter(item => item.category !== undefined).map(item => item.category)).toEqual([
        'task-result', 'instruction-following', 'product-interaction', 'service-stability',
        'resource-cost', 'security-privacy-permission', 'other',
      ])
      expect(items.some(item => item.category === undefined && item.label === 'No category')).toBe(true)
      expect((mocks.pick.mock.calls[0]![1] as { title: string }).title).toBe('Send feedback')
    })

    it('records a category and text from the native prompts and confirms it', async () => {
      const h = await activated()
      mocks.pick.mockResolvedValueOnce({ label: 'Task result', description: '', category: 'task-result' })
      mocks.input.mockResolvedValueOnce(feedbackText)
      h.send({ type: 'session-feedback', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.info).toHaveBeenCalledWith('Feedback recorded.'))
      expect(h.client.recordSessionFeedback).toHaveBeenCalledWith('a', { category: 'task-result', text: feedbackText })
      expect(mocks.warning).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
      // The text is user content: it reaches the runtime and nowhere else.
      expect(mocks.output.every(line => !String(line).includes(feedbackText))).toBe(true)
      expect(JSON.stringify(h.posts())).not.toContain(feedbackText)
    })

    it('allows an empty text with no category', async () => {
      const h = await activated()
      mocks.pick.mockResolvedValueOnce({ label: 'No category', description: '' })
      mocks.input.mockResolvedValueOnce('')
      h.send({ type: 'session-feedback', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.info).toHaveBeenCalledWith('Feedback recorded.'))
      expect(h.client.recordSessionFeedback).toHaveBeenCalledWith('a', {})
    })

    it('sends nothing when the category prompt is dismissed', async () => {
      const h = await activated()
      h.send({ type: 'session-feedback', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.pick).toHaveBeenCalledTimes(1))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(mocks.input).not.toHaveBeenCalled()
      expect(h.client.recordSessionFeedback).not.toHaveBeenCalled()
      expect(mocks.info).not.toHaveBeenCalled()
    })

    it('sends nothing when the text prompt is dismissed', async () => {
      const h = await activated()
      mocks.pick.mockResolvedValueOnce({ label: 'Other', description: '', category: 'other' })
      h.send({ type: 'session-feedback', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.input).toHaveBeenCalledTimes(1))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(h.client.recordSessionFeedback).not.toHaveBeenCalled()
      expect(mocks.info).not.toHaveBeenCalled()
      expect(mocks.warning).not.toHaveBeenCalled()
    })

    it('reports a missing conversation without echoing the feedback', async () => {
      const h = await activated()
      h.client.recordSessionFeedback.mockRejectedValueOnce(new DshConnectionError('session-not-found', 'session "a" not found'))
      mocks.pick.mockResolvedValueOnce({ label: 'Other', description: '', category: 'other' })
      mocks.input.mockResolvedValueOnce(feedbackText)
      h.send({ type: 'session-feedback', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1))
      const message = String(mocks.warning.mock.calls[0]![0])
      expect(message).toContain('no longer exists')
      expect(message).not.toContain(feedbackText)
      expect(mocks.error).not.toHaveBeenCalled()
      expect(mocks.output.every(line => !String(line).includes(feedbackText))).toBe(true)
    })

    it('reports an unreachable runtime without echoing the feedback', async () => {
      const h = await activated()
      h.client.recordSessionFeedback.mockRejectedValueOnce(new DshConnectionError('transport-error', 'socket closed'))
      mocks.pick.mockResolvedValueOnce({ label: 'Other', description: '', category: 'other' })
      mocks.input.mockResolvedValueOnce(feedbackText)
      h.send({ type: 'session-feedback', sessionId: 'a' })
      await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
      const message = String(mocks.error.mock.calls[0]![0])
      expect(message).toContain('Could not record feedback')
      expect(message).toContain('transport-error')
      expect(message).not.toContain(feedbackText)
      expect(mocks.output.every(line => !String(line).includes(feedbackText))).toBe(true)
    })

    it('refuses a conversation that is not the open one', async () => {
      const h = await activated()
      mocks.pick.mockResolvedValueOnce({ label: 'Other', description: '', category: 'other' })
      mocks.input.mockResolvedValueOnce('anything')
      h.send({ type: 'session-feedback', sessionId: 'b' })
      await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
      expect(h.client.recordSessionFeedback).not.toHaveBeenCalled()
      const message = String(mocks.error.mock.calls[0]![0])
      expect(message).toContain('Could not record feedback')
      expect(message).not.toContain('anything')
    })
  })
})
  describe('plugin market commands', () => {
    const INDEX = { url: 'https://market.example/index.json', title: 'Official market' }
    const ENTRY = {
      name: '@scope/vision', title: 'Vision', description: 'Adds image tools',
      defaultVersion: '1.2.3', versions: [{ version: '1.2.3', install: { spec: '@scope/vision@1.2.3' }, compatible: true }],
    }
    const OFFICIAL = { name: '@deepseek-ai/dsh-codex-bundle', official: true, installed: false,
      installTarget: { spec: '@deepseek-ai/dsh-codex-bundle@1.0.0', version: '1.0.0' } }
    const discover = async (h: { client: any }): Promise<void> => { await mocks.commands.get('deepseekHarness.discoverPlugins')!() }
    const official = async (): Promise<void> => { await mocks.commands.get('deepseekHarness.installOfficialPlugin')!() }

    it('registers both install commands', async () => {
      await activated()
      expect(mocks.commands.has('deepseekHarness.discoverPlugins')).toBe(true)
      expect(mocks.commands.has('deepseekHarness.installOfficialPlugin')).toBe(true)
    })

    it('installs the default version found through a configured market index', async () => {
      const h = await activated({ setup: client => {
        client.pluginMarketIndexes.mockResolvedValue([INDEX])
        client.pluginMarketSearch.mockResolvedValue({ entries: [ENTRY], total: 1, nextOffset: null })
        client.installBundle.mockResolvedValue({ changed: true, application: 'applied', bundle: '@scope/vision', version: '1.2.3' })
      } })
      mocks.pick.mockResolvedValueOnce({ label: 'Official market', index: INDEX }).mockResolvedValueOnce({ label: 'Vision', entry: ENTRY })
      mocks.input.mockResolvedValueOnce('vision')
      mocks.warning.mockResolvedValueOnce('Install')
      await discover(h)
      expect(h.client.pluginMarketIndexes).toHaveBeenCalledTimes(1)
      expect(h.client.pluginMarketSearch).toHaveBeenCalledWith(INDEX.url, 'vision')
      expect(h.client.installBundle).toHaveBeenCalledWith('@scope/vision@1.2.3', {})
      const confirmation = mocks.warning.mock.calls[0]!
      expect(String(confirmation[0])).toContain('Vision 1.2.3')
      expect(String(confirmation[1]?.detail)).toContain('Spec: @scope/vision@1.2.3')
      expect(mocks.progress).toHaveBeenCalledTimes(1)
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('installed'))
    })

    it('sends no request when the installation confirmation is cancelled', async () => {
      const h = await activated({ setup: client => {
        client.pluginMarketIndexes.mockResolvedValue([INDEX])
        client.pluginMarketSearch.mockResolvedValue({ entries: [ENTRY], total: 1, nextOffset: null })
      } })
      mocks.pick.mockResolvedValueOnce({ label: 'Official market', index: INDEX }).mockResolvedValueOnce({ label: 'Vision', entry: ENTRY })
      mocks.input.mockResolvedValueOnce('vision')
      // The modal resolves undefined: the user dismissed it.
      await discover(h)
      expect(h.client.installBundle).not.toHaveBeenCalled()
      expect(mocks.progress).not.toHaveBeenCalled()
    })

    it('explains how to configure a missing market index', async () => {
      const h = await activated({ setup: client => { client.pluginMarketIndexes.mockResolvedValue([]) } })
      await discover(h)
      expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('index'))
      expect(mocks.input).not.toHaveBeenCalled()
      expect(h.client.installBundle).not.toHaveBeenCalled()
    })

    it('explains that the plugin market service is unavailable on a 404', async () => {
      const h = await activated({ setup: client => {
        client.pluginMarketIndexes.mockRejectedValue(new DshConnectionError('http-error', 'DSH pluginMarket/listIndexes failed: HTTP 404.', 404))
      } })
      await discover(h)
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('plugin market service'))
      expect(mocks.input).not.toHaveBeenCalled()
      expect(h.client.pluginMarketSearch).not.toHaveBeenCalled()
    })

    it('treats a gateway unknown-method answer as an unavailable plugin market', async () => {
      const h = await activated({ setup: client => {
        client.pluginMarketIndexes.mockRejectedValue(new DshConnectionError('gateway/invocation-unavailable', 'Unknown method.'))
      } })
      await discover(h)
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('plugin market service'))
      expect(h.client.installBundle).not.toHaveBeenCalled()
    })

    it('reports a refused installation with a readable explanation', async () => {
      const h = await activated({ setup: client => {
        client.pluginMarketIndexes.mockResolvedValue([INDEX])
        client.pluginMarketSearch.mockResolvedValue({ entries: [ENTRY], total: 1, nextOffset: null })
        client.installBundle.mockResolvedValue({ changed: false, application: 'failed', error: { code: 'incompatible-version' } })
      } })
      mocks.pick.mockResolvedValueOnce({ label: 'Official market', index: INDEX }).mockResolvedValueOnce({ label: 'Vision', entry: ENTRY })
      mocks.input.mockResolvedValueOnce('vision')
      mocks.warning.mockResolvedValueOnce('Install')
      await discover(h)
      expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('not compatible with this runtime'))
    })

    it('asks for a runtime restart when the installation requires one', async () => {
      const h = await activated({ setup: client => {
        client.pluginMarketIndexes.mockResolvedValue([INDEX])
        client.pluginMarketSearch.mockResolvedValue({ entries: [ENTRY], total: 1, nextOffset: null })
        client.installBundle.mockResolvedValue({ changed: true, application: 'restart-required', version: '1.2.3' })
      } })
      mocks.pick.mockResolvedValueOnce({ label: 'Official market', index: INDEX }).mockResolvedValueOnce({ label: 'Vision', entry: ENTRY })
      mocks.input.mockResolvedValueOnce('vision')
      mocks.warning.mockResolvedValueOnce('Install')
      await discover(h)
      const notice = mocks.warning.mock.calls.at(-1)!
      expect(String(notice[0])).toContain('Restart the DSH runtime')
    })

    it('installs an official on-demand bundle and skips installed or ineligible rows', async () => {
      const h = await activated({ setup: client => {
        client.listBundles.mockResolvedValue([OFFICIAL,
          { name: '@deepseek-ai/dsh-cua-bundle', official: true, installed: true, installTarget: { spec: '@deepseek-ai/dsh-cua-bundle@1.0.0', version: '1.0.0' } },
          { name: 'community-plugin', official: false, installed: false, installTarget: { spec: 'community-plugin@2.0.0', version: '2.0.0' } },
          { name: '@deepseek-ai/dsh-unaddressable-bundle', official: true, installed: false },
        ])
        client.installBundle.mockResolvedValue({ changed: true, application: 'applied', bundle: OFFICIAL.name, version: '1.0.0' })
      } })
      mocks.pick.mockResolvedValueOnce({ label: 'Codex', bundle: OFFICIAL })
      mocks.warning.mockResolvedValueOnce('Install')
      await official()
      const choices = mocks.pick.mock.calls[0]![0] as Array<{ label: string }>
      expect(choices.map(choice => choice.label)).toEqual(['dsh-codex-bundle'])
      expect(h.client.installBundle).toHaveBeenCalledWith('@deepseek-ai/dsh-codex-bundle@1.0.0', {})
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('installed'))
    })

    it('says when every official plugin is already installed', async () => {
      const h = await activated({ setup: client => {
        client.listBundles.mockResolvedValue([{ name: '@deepseek-ai/dsh-cua-bundle', official: true, installed: true }])
      } })
      await official()
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('No official plugins'))
      expect(h.client.installBundle).not.toHaveBeenCalled()
      expect(mocks.pick).not.toHaveBeenCalled()
    })

    it('refuses both commands on an attach-only external runtime before reading the market', async () => {
      const h = await activated()
      ;(mocks.runtime as any).state = { kind: 'ready', ownership: 'external' }
      await discover(h)
      await official()
      expect(mocks.warning).toHaveBeenCalledTimes(2)
      expect(String(mocks.warning.mock.calls[0]![0])).toContain('attach-only')
      expect(h.client.pluginMarketIndexes).not.toHaveBeenCalled()
      expect(h.client.listBundles).not.toHaveBeenCalled()
      expect(h.client.installBundle).not.toHaveBeenCalled()
    })

    it('routes the settings page plugin buttons to their commands', async () => {
      await activated()
      await mocks.commands.get('deepseekHarness.openSettings')!()
      const panel = mocks.panels.at(-1)!
      panel.send({ type: 'native-action', action: 'discover-plugins', scope: 'scope' })
      panel.send({ type: 'native-action', action: 'install-official-plugin', scope: 'scope' })
      expect(mocks.command).toHaveBeenCalledWith('deepseekHarness.discoverPlugins')
      expect(mocks.command).toHaveBeenCalledWith('deepseekHarness.installOfficialPlugin')
    })
  })

  describe('runtime manager wiring', () => {
    const manager = async (): Promise<void> => { await mocks.commands.get('deepseekHarness.manageRuntimes')!() }
    const pickCurrent = (): void => { mocks.pick.mockImplementationOnce(async (items: any[]) => items.find(item => item.action === 'current')) }
    const pickAction = (action: string): void => { mocks.pick.mockImplementationOnce(async (items: any[]) => items.find(item => item.action === action)) }

    it('registers the manager and lists the current connection without a launch token', async () => {
      await activated()
      expect(mocks.commands.has('deepseekHarness.manageRuntimes')).toBe(true)
      pickCurrent()
      mocks.pick.mockResolvedValueOnce(undefined)
      await manager()
      const items = mocks.pick.mock.calls[0]![0] as any[]
      expect(items.find(item => item.action === 'current')).toMatchObject({
        label: '$(plug) Current connection: Ready', description: 'unknown · 127.0.0.1:3080',
      })
      expect(JSON.stringify(items)).not.toContain('token=')
      // List → current row's action submenu dismissed → refreshed list dismissed.
      expect(mocks.pick).toHaveBeenCalledTimes(3)
    })

    it('disconnects the current runtime through the controller and reports the outcome', async () => {
      await activated()
      const stop = vi.spyOn(mocks.runtime, 'stop')
      pickCurrent(); pickAction('disconnect'); mocks.pick.mockResolvedValueOnce(undefined)
      mocks.warning.mockResolvedValueOnce('Disconnect')
      await manager()
      expect(stop).toHaveBeenCalledTimes(1)
      expect(mocks.warning.mock.calls[0]![0]).toContain('Disconnect from the DSH runtime?')
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Disconnected'))
      expect(mocks.command).not.toHaveBeenCalledWith('deepseekHarness.endLeftoverRuntime')
    })

    it('describes an external runtime disconnect as detach-only', async () => {
      await activated()
      mocks.runtime.state = { kind: 'ready', ownership: 'external', localUri: { toString: () => 'http://127.0.0.1:3099' } }
      const stop = vi.spyOn(mocks.runtime, 'stop')
      pickCurrent(); pickAction('disconnect'); mocks.pick.mockResolvedValueOnce(undefined)
      mocks.warning.mockResolvedValueOnce('Disconnect')
      await manager()
      expect(stop).toHaveBeenCalledTimes(1)
      expect(String(mocks.warning.mock.calls[0]![1]?.detail)).toContain('external runtime keeps running')
      expect(mocks.info).toHaveBeenCalledWith('Disconnected. The external DSH runtime keeps running.')
      expect(mocks.command).not.toHaveBeenCalledWith('deepseekHarness.endLeftoverRuntime')
    })

    it('turns an intentional external disconnect into idle instead of a runtime failure', async () => {
      const h = await activated()
      const runtime = mocks.runtime
      runtime.state = { kind: 'ready', ownership: 'external', localUri: { toString: () => 'http://127.0.0.1:3099' } }
      runtime.listener?.({ ...runtime.state })
      runtime.stop = vi.fn(async () => { runtime.listener?.({ kind: 'stopped' }) })
      pickCurrent(); pickAction('disconnect'); mocks.pick.mockResolvedValueOnce(undefined)
      mocks.warning.mockResolvedValueOnce('Disconnect')
      await manager()
      await vi.waitFor(() => expect(h.mergedState().phase).toBe('idle'))
      const state = h.mergedState()
      expect(state.statusText).toContain('external DSH runtime')
      expect(state.statusText).not.toBe('DeepSeek Harness stopped.')
    })

    it('reports a shared runtime disconnect as still in use instead of stopped', async () => {
      mocks.brokerState.descriptor = { manageable: true, pid: 4242, launchUrl: 'http://127.0.0.1:3080/?token=secret', processStartTime: 1 }
      mocks.brokerState.running = true
      mocks.brokerState.leases = [{ instanceId: 'other-window', runtimePid: 4242 }]
      const h = await activated({ storagePath: '/storage' })
      const runtime = mocks.runtime
      runtime.state = { kind: 'ready', ownership: 'managed', pid: 4242, localUri: { toString: () => 'http://127.0.0.1:3080' } }
      runtime.listener?.({ ...runtime.state })
      runtime.stop = vi.fn(async () => { runtime.listener?.({ kind: 'stopped' }) })
      pickCurrent(); pickAction('disconnect'); mocks.pick.mockResolvedValueOnce(undefined)
      mocks.warning.mockResolvedValueOnce('Disconnect')
      await manager()
      // The stop reported `stopped` before the broker saw the other lease; the
      // Webview must end on the accurate sentence, not "was stopped".
      await vi.waitFor(() => expect(h.mergedState().statusText).toContain('Another VS Code window'))
      expect(h.mergedState().statusText).not.toContain('managed runtime was stopped')
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('Another VS Code window'))
      // A duplicated stop event must not restore the generic "was stopped"
      // sentence after the broker-confirmed in-use correction.
      runtime.listener?.({ kind: 'stopped' })
      await vi.waitFor(() => expect(h.mergedState().statusText).toContain('Another VS Code window'))
      expect(h.mergedState().statusText).not.toContain('managed runtime was stopped')
    })

    it('dispatches restart to the existing command after confirmation', async () => {
      await activated()
      pickCurrent(); pickAction('restart'); mocks.pick.mockResolvedValueOnce(undefined)
      mocks.warning.mockResolvedValueOnce('Restart Runtime')
      await manager()
      expect(mocks.warning.mock.calls[0]![0]).toContain('Restart the current DSH runtime?')
      expect(mocks.command).toHaveBeenCalledWith('deepseekHarness.restart')
    })

    it('does nothing when the list is dismissed', async () => {
      await activated()
      const stop = vi.spyOn(mocks.runtime, 'stop')
      await manager()
      expect(stop).not.toHaveBeenCalled()
      expect(mocks.command).not.toHaveBeenCalled()
      expect(mocks.warning).not.toHaveBeenCalled()
    })

    it('dispatches diagnose and start-managed to their existing commands', async () => {
      await activated()
      mocks.pick.mockResolvedValueOnce({ label: '$(inspect) Diagnose session occupancy', action: 'diagnose' }).mockResolvedValueOnce(undefined)
      await manager()
      expect(mocks.command).toHaveBeenCalledWith('deepseekHarness.diagnoseOccupancy')

      mocks.command.mockClear()
      mocks.pick.mockResolvedValueOnce({ label: '$(play) Start new managed runtime', action: 'start-managed' }).mockResolvedValueOnce(undefined)
      await manager()
      expect(mocks.command).toHaveBeenCalledWith('deepseekHarness.startManagedRuntime')
    })
  })

  describe('webview runtime controls', () => {
    it('opens the runtime manager from the Webview message without crossing a token', async () => {
      const h = await activated()
      h.send({ type: 'manage-runtimes' })
      await vi.waitFor(() => expect(mocks.command).toHaveBeenCalledWith('deepseekHarness.manageRuntimes'))
      expect(JSON.stringify(h.posts())).not.toContain('token')
    })

    it('documents restart and runtime-manager copy in the manifest', async () => {
      const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        activationEvents?: string[]
        contributes?: { commands?: Array<Record<string, unknown>>; menus?: Record<string, Array<Record<string, unknown>>> }
      }
      expect(manifest.contributes?.commands).toContainEqual({
        command: 'deepseekHarness.restart',
        title: 'DeepSeek Harness: Restart Runtime (stop and start DSH)',
        shortTitle: 'DeepSeek Harness: Restart Runtime',
        icon: '$(debug-restart)',
      })
      expect(manifest.contributes?.commands).toContainEqual({
        command: 'deepseekHarness.manageRuntimes',
        title: 'DeepSeek Harness: Manage Runtimes',
        icon: '$(server-process)',
      })
      expect(manifest.contributes?.menus?.['view/title']).toContainEqual({
        command: 'deepseekHarness.restart', when: 'view == deepseekHarness.chat', group: 'navigation@2',
      })
      expect(manifest.activationEvents).toContain('onCommand:deepseekHarness.manageRuntimes')
    })

    it('contributes the plugin discovery commands to the Command Palette', async () => {
      await activated()
      const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        activationEvents?: string[]
        contributes?: { commands?: Array<Record<string, unknown>> }
      }
      expect(manifest.contributes?.commands).toContainEqual({
        command: 'deepseekHarness.discoverPlugins',
        title: 'DeepSeek Harness: Discover Plugins',
      })
      expect(manifest.contributes?.commands).toContainEqual({
        command: 'deepseekHarness.installOfficialPlugin',
        title: 'DeepSeek Harness: Install Official Plugin Bundle',
      })
      expect(manifest.activationEvents).toContain('onCommand:deepseekHarness.discoverPlugins')
      expect(manifest.activationEvents).toContain('onCommand:deepseekHarness.installOfficialPlugin')
      // The manifest is not enough on its own: the palette entry must have a handler.
      expect(mocks.commands.has('deepseekHarness.discoverPlugins')).toBe(true)
      expect(mocks.commands.has('deepseekHarness.installOfficialPlugin')).toBe(true)
    })
  })

  describe('explorer add to chat command', () => {
    const uri = (fsPath: string) => ({ scheme: 'file', fsPath, toString: () => fsPath })
    /** A remote resource as the Explorer should have delivered it. */
    const remoteUri = (authority: string, resourcePath: string) => ({
      scheme: 'vscode-remote', authority, path: resourcePath, fsPath: resourcePath,
      toString: () => `vscode-remote://${authority}${resourcePath}`,
    })
    /** A remote workspace folder URI: `with({path})` keeps scheme and authority. */
    const remoteFolderUri = (authority: string, folderPath: string) => ({
      ...remoteUri(authority, folderPath),
      with: (components: { path?: string }) => remoteUri(authority, components.path ?? folderPath),
    })
    const remoteFolder = (authority: string, folderPath: string) => ({ uri: remoteFolderUri(authority, folderPath), name: 'project', index: 0 })
    /** The default local workspace folder: keeps activation cwd and sessions stable. */
    const fileFolder = () => ({ uri: uri('/workspace'), name: 'workspace', index: 0 })
    const command = () => mocks.commands.get('deepseekHarness.addToChat')!
    const envMock = vscode.env as { remoteName?: string }
    const defaultFolders = vscode.workspace.workspaceFolders
    const setRemote = (name: string | undefined): void => { envMock.remoteName = name }
    const setFolders = (folders: unknown[]): void => {
      ;(vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = folders
    }
    const recoveryLine = (): string | undefined => mocks.output.find(line => line.startsWith('[webview] add-to-chat: '))
    const insertedTexts = (h: { posts(): Array<Record<string, any>> }): unknown =>
      h.posts().filter(packet => packet.type === 'insert-references').at(-1)?.texts
    afterEach(() => {
      setRemote(undefined)
      setFolders(defaultFolders as unknown[])
    })
    beforeEach(() => {
      mocks.fsStat.mockReset()
      mocks.fsStat.mockResolvedValue({ type: 1 })
      mocks.openDialog.mockReset()
      mocks.info.mockReset()
    })

    it('contributes the command and an Explorer context menu for remote-capable schemes', () => {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        activationEvents: string[]
        contributes: { commands: { command: string }[]; menus: Record<string, { command: string; when?: string }[]> }
      }
      expect(pkg.contributes.commands.some(item => item.command === 'deepseekHarness.addToChat')).toBe(true)
      expect(pkg.activationEvents).toContain('onCommand:deepseekHarness.addToChat')
      const menu = (pkg.contributes.menus['explorer/context'] ?? []).find(item => item.command === 'deepseekHarness.addToChat')
      expect(menu?.when).toContain('resourceScheme == file')
      expect(menu?.when).toContain('vscode-remote')
      expect(menu?.when).toContain('vscode-vfs')
    })

    it('inserts a single file, multiple files and a folder as references', async () => {
      const h = await activated()
      await command()(uri('/workspace/src/a.ts'))
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'insert-references')).toBe(true))
      expect(h.posts().filter(packet => packet.type === 'insert-references').at(-1)!.texts).toEqual(['@src/a.ts'])
      await command()(uri('/workspace/a.ts'), [uri('/workspace/a.ts'), uri('/workspace/b.ts')])
      await vi.waitFor(() => expect((h.posts().filter(packet => packet.type === 'insert-references').at(-1)!.texts as string[]).length).toBe(2))
      mocks.fsStat.mockResolvedValueOnce({ type: 2 })
      await command()(uri('/workspace/docs'))
      await vi.waitFor(() => expect(h.posts().filter(packet => packet.type === 'insert-references').at(-1)!.texts).toEqual(['@docs/']))
      // A local window never emits the remote-recovery diagnostic line.
      expect(recoveryLine()).toBeUndefined()
    })

    it('accepts an in-project file URI in a remote window through the resolution fallback', async () => {
      const h = await activated()
      setRemote('ssh-remote')
      mocks.output.length = 0
      await command()(uri('/workspace/src/a.ts'))
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'insert-references')).toBe(true))
      expect(insertedTexts(h)).toEqual(['@src/a.ts'])
      // The line records the downgraded scheme and the recovery count only.
      expect(recoveryLine()).toContain('remote=ssh-remote')
      expect(recoveryLine()).toContain('resource schemes=file')
      expect(recoveryLine()).toContain('recovered=0')
      expect(recoveryLine()).not.toContain('/workspace')
    })

    it('restores the remote scheme for a remote workspace file argument', async () => {
      // The local folder stays first so the activation cwd and the session list
      // stay stable; the remote folder contributes the scheme to restore.
      setFolders([fileFolder(), remoteFolder('ssh-remote+host', '/workspace')])
      setRemote('ssh-remote')
      const h = await activated()
      mocks.output.length = 0
      mocks.fsStat.mockClear()
      await command()(uri('/workspace/src/a.ts'))
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'insert-references')).toBe(true))
      expect(insertedTexts(h)).toEqual(['@src/a.ts'])
      expect(recoveryLine()).toContain('remote=ssh-remote')
      expect(recoveryLine()).toContain('resource schemes=file')
      expect(recoveryLine()).toContain('recovered=1')
      expect(recoveryLine()).not.toContain('/workspace')
      // The stat targets the recovered remote URI, not a local file.
      expect(mocks.fsStat).toHaveBeenCalledWith(expect.objectContaining({
        scheme: 'vscode-remote',
        authority: 'ssh-remote+host',
        fsPath: '/workspace/src/a.ts',
      }))
    })

    it('maps a file URI onto the matching root of a multi-root remote workspace', async () => {
      setFolders([fileFolder(), remoteFolder('ssh-remote+host', '/weka/project'), remoteFolder('ssh-remote+host', '/weka/other')])
      setRemote('ssh-remote')
      const h = await activated()
      mocks.output.length = 0
      await command()(uri('/weka/other/src/b.ts'))
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'insert-references')).toBe(true))
      // The second root is outside the DSH cwd, so its reference stays absolute.
      expect(insertedTexts(h)).toEqual(['@/weka/other/src/b.ts'])
      expect(recoveryLine()).toContain('recovered=1')
    })

    it('maps the workspace root itself onto its remote folder', async () => {
      setFolders([fileFolder(), remoteFolder('ssh-remote+host', '/workspace')])
      setRemote('ssh-remote')
      const h = await activated()
      mocks.output.length = 0
      mocks.fsStat.mockResolvedValue({ type: 2 })
      await command()(uri('/workspace'))
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'insert-references')).toBe(true))
      expect(insertedTexts(h)).toEqual(['@/workspace/'])
      expect(recoveryLine()).toContain('recovered=1')
    })

    it('refuses a client path outside the project and names both fallback entry points', async () => {
      setFolders([fileFolder(), remoteFolder('ssh-remote+host', '/weka/project')])
      setRemote('ssh-remote')
      const h = await activated()
      mocks.output.length = 0
      mocks.fsStat.mockClear()
      mocks.info.mockClear()
      await command()(uri('/Users/local/secret.txt'))
      await vi.waitFor(() => expect(mocks.info).toHaveBeenCalled())
      const message = String(mocks.info.mock.calls.at(-1)![0])
      expect(message).toContain('remote Explorer')
      expect(message).toContain('Upload from this computer')
      // Safe rejection: nothing is inserted and the client path is never stat-ed.
      expect(h.posts().filter(packet => packet.type === 'insert-references')).toEqual([])
      expect(mocks.fsStat).not.toHaveBeenCalled()
      expect(recoveryLine()).toContain('recovered=0')
      expect(recoveryLine()).not.toContain('/Users')
    })

    it('passes an unmodified vscode-remote URI through without a recovery line', async () => {
      setFolders([fileFolder(), remoteFolder('ssh-remote+host', '/workspace')])
      setRemote('ssh-remote')
      const h = await activated()
      mocks.output.length = 0
      await command()(remoteUri('ssh-remote+host', '/workspace/src/a.ts'))
      await vi.waitFor(() => expect(h.posts().some(packet => packet.type === 'insert-references')).toBe(true))
      expect(insertedTexts(h)).toEqual(['@src/a.ts'])
      expect(recoveryLine()).toBeUndefined()
    })

    it('delegates an argument-less invocation to the shared file picker', async () => {
      mocks.openDialog.mockResolvedValue(undefined)
      await activated()
      await command()()
      await vi.waitFor(() => expect(mocks.openDialog).toHaveBeenCalledTimes(1))
    })
  })

  describe('reminder and archive host wiring', () => {
    /** A real, non-blank conversation summary; the archive handler ignores blank rows. */
    const openSession = (sessionId: string) => ({ sessionId, cwd: '/workspace', updatedAt: 1, blank: false, running: false,
      agentAvailable: true, agentPreset: 'standard', projections: { values: { agentPreset: 'standard', plan: { active: false, pending: false } } } })
    /** One parsed alpha.3 reminder; management endpoints exist only for this shape. */
    const reminder = { id: 'r', title: 'Morning review', prompt: 'Check jobs', kind: 'daily', scheduledAt: '2026-11-05T01:00:00Z',
      status: 'active', target: { kind: 'new' as const }, involvedSessionIds: [] as string[], updatedAt: 'rev-1' }

    /** Activate with one open conversation and (optionally) an alpha.3 reminder catalog. */
    async function started(options: { reminder?: boolean; setup?: (client: any) => void } = {}) {
      const h = await activated({ setup: client => {
        client.listSessions.mockResolvedValue({ items: [openSession('a'), openSession('b')] })
        if (options.reminder === true) client.schedules.mockResolvedValue([reminder])
        options.setup?.(client)
      } })
      // Notifications are shared across this file's tests; only this test's own
      // notices matter for the assertions below.
      mocks.info.mockClear()
      mocks.error.mockClear()
      return h
    }
    const items = (h: Awaited<ReturnType<typeof started>>): any[] => (h.mergedState().schedules?.items ?? []) as any[]

    it('shows one alpha.3 reminder even though its target names no conversation', async () => {
      const h = await started({ reminder: true })
      await vi.waitFor(() => expect(items(h)).toHaveLength(1))
      expect(items(h)[0]).toMatchObject({ id: 'r', status: 'active', target: { kind: 'new' } })
    })

    it('runs, pauses and resumes a reminder through the alpha.3 endpoints', async () => {
      const h = await started({ reminder: true })
      await vi.waitFor(() => expect(items(h)).toHaveLength(1))

      h.send({ type: 'schedule-run', id: 'r' })
      await vi.waitFor(() => expect(h.client.scheduleRun).toHaveBeenCalledWith('r'))
      h.send({ type: 'schedule-set-active', id: 'r', active: false })
      await vi.waitFor(() => expect(h.client.scheduleEdit).toHaveBeenCalledWith('r',
        { action: 'update', patch: { active: false }, expectedUpdatedAt: 'rev-1' }))
      h.send({ type: 'schedule-set-active', id: 'r', active: true })
      await vi.waitFor(() => expect(h.client.scheduleEdit).toHaveBeenCalledWith('r',
        { action: 'update', patch: { active: true }, expectedUpdatedAt: 'rev-1' }))
      expect(h.client.scheduleDeleteInactive).not.toHaveBeenCalled()
    })

    it('asks before deleting one reminder or every ended reminder', async () => {
      const h = await started({ reminder: true })
      await vi.waitFor(() => expect(items(h)).toHaveLength(1))

      // A declined confirmation must not reach the runtime.
      mocks.warning.mockResolvedValueOnce(undefined)
      h.send({ type: 'schedule-delete', id: 'r', title: 'Morning review' })
      await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1))
      expect(String(mocks.warning.mock.calls[0]![0])).toContain('Morning review')
      expect(h.client.scheduleEdit).not.toHaveBeenCalled()

      mocks.warning.mockResolvedValueOnce('Delete')
      h.send({ type: 'schedule-delete', id: 'r', title: 'Morning review' })
      await vi.waitFor(() => expect(h.client.scheduleEdit).toHaveBeenCalledWith('r',
        { action: 'delete', expectedUpdatedAt: 'rev-1' }))

      mocks.warning.mockResolvedValueOnce('Delete')
      h.client.scheduleDeleteInactive.mockResolvedValueOnce({ deleted: 2 })
      h.send({ type: 'schedule-delete-ended' })
      await vi.waitFor(() => expect(h.client.scheduleDeleteInactive).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(String(mocks.info.mock.calls.at(-1)?.[0] ?? '')).toContain('Deleted 2 ended reminders'))
    })

    it('reads an alpha.3 delivery page addressed by id only', async () => {
      const h = await started({ reminder: true, setup: client => {
        client.scheduleHistory.mockResolvedValueOnce({ id: 'r', records: [
          { scheduledAt: '2026-11-04T01:00:00Z', deliveredAt: '2026-11-04T01:00:01Z', messageId: 'm1', prompt: 'sent', targetSessionId: 'x' },
        ], earlierRecordsUnavailable: false, earlierRecordsPruned: true, retention: { days: 30, records: 200 }, nextBefore: 'm1' })
      } })
      await vi.waitFor(() => expect(items(h)).toHaveLength(1))
      h.send({ type: 'schedule-history', id: 'r' })

      await vi.waitFor(() => expect(h.client.scheduleHistory).toHaveBeenCalledWith(undefined, 'r', undefined))
      await vi.waitFor(() => expect(h.mergedState().schedules?.history?.records).toHaveLength(1))
      const history = h.mergedState().schedules.history
      expect(history).toMatchObject({ id: 'r', earlierRecordsPruned: true, earlierRecordsUnavailable: false,
        nextBefore: 'm1', retention: { days: 30, records: 200 } })
      expect(history.records[0]).toMatchObject({ messageId: 'm1', prompt: 'sent' })
    })

    it('keeps a failed reminder action visible in the panel and the log', async () => {
      const h = await started({ reminder: true, setup: client => {
        client.scheduleRun.mockRejectedValueOnce(new Error('schedule/input-invalid: task is ended'))
      } })
      await vi.waitFor(() => expect(items(h)).toHaveLength(1))
      h.send({ type: 'schedule-run', id: 'r' })

      await vi.waitFor(() => expect(String(h.mergedState().schedules?.error ?? '')).toContain('Could not run the reminder'))
      expect(String(h.mergedState().schedules.error)).toContain('input-invalid')
      await vi.waitFor(() => expect(mocks.output.some(line => line.includes('schedule/input-invalid'))).toBe(true))
    })

    it('retries archiving with stopActivity when only active reminders block it', async () => {
      const h = await started({ setup: client => {
        client.archiveSession.mockRejectedValueOnce(new DshConnectionError('workspace/session-active',
          "cannot archive session 'a': the session is active (schedule)"))
          .mockResolvedValueOnce({ archivedSessionIds: ['a'] })
      } })
      h.send({ type: 'archive-session', sessionId: 'a' })

      await vi.waitFor(() => expect(mocks.info).toHaveBeenCalled())
      expect(h.client.archiveSession).toHaveBeenNthCalledWith(1, 'a')
      expect(h.client.archiveSession).toHaveBeenNthCalledWith(2, 'a', true)
      expect(String(mocks.info.mock.calls.at(-1)![0])).toContain('active reminders were stopped')
    })

    it.each([
      ['a running turn', "cannot archive session 'a': the session is active (turn)"],
      ['a turn and an active reminder', "cannot archive session 'a': the session is active (schedule, turn)"],
    ])('does not silently stop %s to archive', async (_case, message) => {
      const h = await started({ setup: client => {
        client.archiveSession.mockRejectedValueOnce(new DshConnectionError('workspace/session-active', message))
      } })
      h.send({ type: 'archive-session', sessionId: 'a' })

      await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
      expect(h.client.archiveSession).toHaveBeenCalledTimes(1)
      expect(String(mocks.error.mock.calls.at(-1)![0])).toContain('Could not archive the conversation')
      expect(mocks.info).not.toHaveBeenCalled()
    })

    describe('create and edit dialogs', () => {
      /** Queue one native input-box answer. */
      const answers = (...values: Array<string | undefined>): void => {
        for (const value of values) mocks.input.mockResolvedValueOnce(value)
      }
      /** Queue the quick-pick answer for a timing rule kind. */
      const pickKind = (kind: string): void => {
        mocks.pick.mockResolvedValueOnce({ label: kind, description: '', scheduleKind: kind })
      }
      /** Queue the quick-pick answer for a reminder destination. */
      const pickTarget = (kind: string): void => {
        mocks.pick.mockResolvedValueOnce({ label: kind, description: '', targetKind: kind })
      }
      /** Queue the quick-pick answer for the part of a reminder to edit. */
      const pickField = (field: string): void => {
        mocks.pick.mockResolvedValueOnce({ label: field, description: '', editField: field })
      }

      it('creates a reminder for this conversation from native dialogs', async () => {
        const h = await started()
        answers('Daily review', 'Check jobs', '09:30', 'UTC')
        pickKind('daily')
        pickTarget('session')
        h.send({ type: 'schedule-create' })

        await vi.waitFor(() => expect(h.client.createSchedule).toHaveBeenCalledTimes(1))
        expect(h.client.createSchedule).toHaveBeenCalledWith({ title: 'Daily review', prompt: 'Check jobs',
          timing: { kind: 'daily', daily: { time: '09:30:00', time_zone: 'UTC' } },
          target: { kind: 'session', sessionId: h.mergedState().sessionId } })
        await vi.waitFor(() => expect(String(mocks.info.mock.calls.at(-1)?.[0] ?? '')).toContain('Reminder created'))
        // The catalog is re-read so the new row reaches the panel.
        expect(h.client.schedules.mock.calls.length).toBeGreaterThan(1)
      })

      it.each([
        ['after', ['10m'], { kind: 'after', after_seconds: 600 }],
        ['at', ['2026-11-05', '09:30', 'UTC'], { kind: 'at', at: { date: '2026-11-05', time: '09:30:00', time_zone: 'UTC' } }],
        ['every', ['45m'], { kind: 'every', every_seconds: 2700 }],
        ['daily', ['07:05', 'UTC'], { kind: 'daily', daily: { time: '07:05:00', time_zone: 'UTC' } }],
        ['weekly', ['08:00', '1,3,5', 'UTC'], { kind: 'weekly', weekly: { time: '08:00:00', time_zone: 'UTC', weekdays: [1, 3, 5] } }],
        ['cron', ['*/5 * * * *', 'UTC'], { kind: 'cron', cron: { expression: '*/5 * * * *', time_zone: 'UTC' } }],
        ['rrule', ['DTSTART;TZID=Asia/Shanghai:20261105T090000', 'RRULE:FREQ=DAILY;INTERVAL=1'],
          { kind: 'rrule', rrule: 'DTSTART;TZID=Asia/Shanghai:20261105T090000\nRRULE:FREQ=DAILY;INTERVAL=1' }],
      ])('builds the %s timing rule from native dialog answers', async (kind, fields, timing) => {
        const h = await started()
        answers('Title', 'Instruction', ...(fields as string[]))
        pickKind(kind)
        pickTarget('new_once')
        h.send({ type: 'schedule-create' })

        await vi.waitFor(() => expect(h.client.createSchedule).toHaveBeenCalledTimes(1))
        expect(h.client.createSchedule).toHaveBeenCalledWith({ title: 'Title', prompt: 'Instruction',
          timing, target: { kind: 'new_once' } })
      })

      it('sends the new-conversation-per-delivery target choice', async () => {
        const h = await started()
        answers('Title', 'Instruction', '10m')
        pickKind('after')
        pickTarget('new')
        h.send({ type: 'schedule-create' })
        await vi.waitFor(() => expect(h.client.createSchedule).toHaveBeenCalledTimes(1))
        expect((h.client.createSchedule.mock.calls[0]![0] as { target: unknown }).target).toEqual({ kind: 'new' })
      })

      it('does nothing when the create dialog is cancelled', async () => {
        const h = await started()
        answers(undefined)
        h.send({ type: 'schedule-create' })
        await vi.waitFor(() => expect(mocks.input).toHaveBeenCalledTimes(1))
        expect(h.client.createSchedule).not.toHaveBeenCalled()
        expect(mocks.error).not.toHaveBeenCalled()
      })

      it('reports an invalid dialog answer instead of creating the reminder', async () => {
        const h = await started()
        answers('Title', 'Instruction', 'soon')
        pickKind('after')
        h.send({ type: 'schedule-create' })

        await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
        expect(String(mocks.error.mock.calls[0]![0])).toContain('Could not create the reminder')
        expect(String(mocks.error.mock.calls[0]![0])).toContain('duration')
        expect(h.client.createSchedule).not.toHaveBeenCalled()
      })

      it('edits one reminder title with its expected revision', async () => {
        const h = await started({ reminder: true })
        await vi.waitFor(() => expect(items(h)).toHaveLength(1))
        pickField('title')
        answers('Renamed review')
        h.send({ type: 'schedule-edit', id: 'r' })

        await vi.waitFor(() => expect(h.client.scheduleEdit).toHaveBeenCalledTimes(1))
        expect(h.client.scheduleEdit).toHaveBeenCalledWith('r',
          { action: 'update', patch: { title: 'Renamed review' }, expectedUpdatedAt: 'rev-1' })
        await vi.waitFor(() => expect(String(mocks.info.mock.calls.at(-1)?.[0] ?? '')).toContain('Reminder updated'))
      })

      it('edits one reminder timing rule through the shared builder', async () => {
        const h = await started({ reminder: true })
        await vi.waitFor(() => expect(items(h)).toHaveLength(1))
        pickField('timing')
        pickKind('weekly')
        answers('08:00', '1,5', 'UTC')
        h.send({ type: 'schedule-edit', id: 'r' })

        await vi.waitFor(() => expect(h.client.scheduleEdit).toHaveBeenCalledTimes(1))
        expect(h.client.scheduleEdit).toHaveBeenCalledWith('r', { action: 'update',
          patch: { timing: { kind: 'weekly', weekly: { time: '08:00:00', time_zone: 'UTC', weekdays: [1, 5] } } },
          expectedUpdatedAt: 'rev-1' })
      })

      it('does nothing when the edit dialog is cancelled', async () => {
        const h = await started({ reminder: true })
        await vi.waitFor(() => expect(items(h)).toHaveLength(1))
        mocks.pick.mockResolvedValueOnce(undefined)
        h.send({ type: 'schedule-edit', id: 'r' })
        await vi.waitFor(() => expect(mocks.pick).toHaveBeenCalled())
        expect(h.client.scheduleEdit).not.toHaveBeenCalled()
      })

      it('reports an edit conflict and re-reads the catalog', async () => {
        const h = await started({ reminder: true, setup: client => {
          client.scheduleEdit.mockResolvedValueOnce({ id: 'r', code: 'schedule_conflict' })
        } })
        await vi.waitFor(() => expect(items(h)).toHaveLength(1))
        const reads = h.client.schedules.mock.calls.length
        pickField('prompt')
        answers('New instruction')
        h.send({ type: 'schedule-edit', id: 'r' })

        await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
        expect(String(mocks.error.mock.calls.at(-1)![0])).toContain('changed in another window')
        await vi.waitFor(() => expect(h.client.schedules.mock.calls.length).toBeGreaterThan(reads))
      })
    })

    describe('reminder destination for a delegated child', () => {
      const summary = (sessionId: string, extra: Record<string, unknown> = {}) => ({ sessionId, cwd: '/workspace', updatedAt: 1,
        blank: false, running: false, agentAvailable: true, agentPreset: 'standard',
        projections: { values: { agentPreset: 'standard', plan: { active: false, pending: false } } }, ...extra })
      /** Activate on a project whose selected conversation is a subagent child. */
      const onChild = async () => {
        // `activated` seeds permissions for the session id `a`, so the parent
        // keeps that id and the child is selected after activation.
        const h = await activated({ setup: client => client.listSessions.mockResolvedValue({ items: [
          summary('a', { updatedAt: 2 }),
          summary('child', { origin: 'subagent', parentSessionId: 'a' }),
        ] }) })
        h.send({ type: 'select-session', sessionId: 'child' })
        await vi.waitFor(() => expect(h.mergedState().sessionId).toBe('child'))
        return h
      }
      const answers = (...values: Array<string | undefined>): void => {
        for (const value of values) mocks.input.mockResolvedValueOnce(value)
      }
      const pickKind = (kind: string): void => {
        mocks.pick.mockResolvedValueOnce({ label: kind, description: '', scheduleKind: kind })
      }

      it('hides This conversation and creates a new-conversation reminder', async () => {
        const h = await onChild()
        answers('Title', 'Instruction', '10m')
        pickKind('after')
        let targetItems: any[] = []
        mocks.pick.mockImplementationOnce(async (items: any[]) => {
          targetItems = items
          return items.find(item => item.targetKind === 'new_once')
        })
        h.send({ type: 'schedule-create' })

        await vi.waitFor(() => expect(h.client.createSchedule).toHaveBeenCalledTimes(1))
        expect(targetItems.map(item => item.targetKind)).toEqual(['new_once', 'new'])
        expect((h.client.createSchedule.mock.calls[0]![0] as { target: unknown }).target).toEqual({ kind: 'new_once' })
      })

      it('refuses a stale This-conversation choice without calling DSH', async () => {
        const h = await onChild()
        answers('Title', 'Instruction', '10m')
        pickKind('after')
        mocks.pick.mockResolvedValueOnce({ label: 'This conversation', description: '', targetKind: 'session' })
        h.send({ type: 'schedule-create' })

        await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled())
        expect(String(mocks.error.mock.calls.at(-1)?.[0] ?? '')).toContain('subagent')
        expect(h.client.createSchedule).not.toHaveBeenCalled()
      })
    })
  })

})
