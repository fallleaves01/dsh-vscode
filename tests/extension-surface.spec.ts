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
    cotTranslationLimits: vi.fn(async () => undefined),
    cotTranslationTranslate: vi.fn(async (request: { text: string }) => `translated:${request.text}`),
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
    mocks.panels.length = 0
    mocks.commands.clear()
    ;(vscode.env as { language: string }).language = 'en'
  })

  async function activated(options: { catalog?: unknown; translation?: unknown; language?: string } = {}) {
    const { client, emit, fail } = testClient()
    mocks.client = client
    client.listCommands.mockResolvedValue([
      { name: 'permission', description: 'Choose a permission preset' },
      { name: 'plan', description: 'Plan mode' },
    ])
    client.permissionCatalog.mockResolvedValue(options.catalog === undefined ? CATALOG : options.catalog)
    client.cotTranslationLimits.mockResolvedValue(options.translation)
    if (options.language !== undefined) (vscode.env as { language: string }).language = options.language
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
})
