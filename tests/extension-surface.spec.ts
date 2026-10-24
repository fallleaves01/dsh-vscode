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
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    parse: (value: string) => uri(value),
    joinPath: (...parts: any[]) => uri(parts.map(part => typeof part === 'string' ? part : part.fsPath).join('/')),
  }
  const workspaceFolder = { uri: uri('/workspace'), name: 'workspace', index: 0 }
  return {
    EventEmitter,
    Uri,
    ViewColumn: { Active: 1, Beside: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
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
      showInputBox: vi.fn(async () => undefined),
      showQuickPick: vi.fn(async () => undefined),
      onDidChangeActiveTextEditor: () => disposable(),
      onDidChangeTextEditorSelection: () => disposable(),
      activeTextEditor: undefined,
    },
    workspace: {
      workspaceFolders: [workspaceFolder],
      getConfiguration: () => ({ get: (_key: string, fallback: any) => fallback }),
      registerTextDocumentContentProvider: () => disposable(),
      onDidChangeConfiguration: () => disposable(),
      onDidChangeTextDocument: () => disposable(),
      onDidChangeWorkspaceFolders: () => disposable(),
      onDidCreateFiles: () => disposable(),
      onDidDeleteFiles: () => disposable(),
      onDidRenameFiles: () => disposable(),
      fs: {},
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
    state = { kind: 'ready' as const }
    connection: any
    constructor() {
      this.connection = { canReauthenticate: true, reauthenticate: async () => {} }
    }
    async start() {}
    async stop() {}
    async assertCanRestart() {}
    async prepareRestart() { return undefined }
    onDidChangeState = () => ({ dispose: () => {} })
    externalRuntimeUrlToRemember() { return undefined }
    async rememberExternalRuntime() { return true }
  },
}))

vi.mock('../src/dsh-client.js', () => ({
  DshClient: class {
    constructor() { return mocks.client }
  },
}))

import { activate, deactivate } from '../src/extension.js'

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
    listWorkspaces: vi.fn(async () => ({ archivedSessionIds: [] })),
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
    forkSession: vi.fn(async () => 'child'),
    updateQueue: vi.fn(async () => ({ accepted: true })),
    executeCommand: vi.fn(async () => ({ result: { kind: 'success' } })),
    permissionCatalog: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
    unarchiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
    killJob: vi.fn(async () => ({ outcome: 'requested' as const })),
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


describe('host permission confirmation', () => {
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
    mocks.panels.length = 0
    mocks.commands.clear()
  })

  async function activated(options: { catalog?: unknown } = {}) {
    const { client, emit } = testClient()
    mocks.client = client
    client.listCommands.mockResolvedValue([
      { name: 'permission', description: 'Choose a permission preset' },
      { name: 'plan', description: 'Plan mode' },
    ])
    client.permissionCatalog.mockResolvedValue(options.catalog === undefined ? CATALOG : options.catalog)
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
    await vi.waitFor(() => expect(client.permissionCatalog).toHaveBeenCalled())

    const posts = (): Array<Record<string, any>> =>
      entry.panel.webview.postMessage.mock.calls.map((call: any[]) => call[0] as Record<string, any>)
    const latestState = (): Record<string, any> | undefined =>
      posts().filter(packet => packet.type === 'state' || packet.type === 'state-update').at(-1)
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
    return { context, client, entry, posts, send, publishPermissions }
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
})
