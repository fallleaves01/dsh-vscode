import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DshFrame, SessionModels, SkillDescriptor } from '../src/dsh-client.js'
import { withIdeContext } from '../src/ide-context.js'
import { DshStreamError } from '../src/dsh-streams.js'
import { DshConnection } from '../src/dsh-connection.js'
import { DshConnectionError } from '../src/dsh-connection.js'
import { ExistingRuntimeConnectionError } from '../src/runtime-target.js'

const mocks = vi.hoisted(() => ({ client: undefined as any }))
vi.mock('../src/dsh-client.js', () => ({ DshClient: class {
  constructor(_connection: unknown, requestSessions: string[] = []) {
    mocks.client.handledSessionIds = requestSessions
    return mocks.client
  }
} }))
vi.mock('vscode', () => ({
  EventEmitter: class {
    listeners = new Set<(value: unknown) => void>()
    event = (listener: (value: unknown) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) } }
    fire(value: unknown) { for (const listener of this.listeners) listener(value) }
    dispose() { this.listeners.clear() }
  },
  Uri: { file: (fsPath: string) => ({ fsPath, scheme: 'file' }) },
  env: { language: 'en' },
  window: { showWarningMessage: vi.fn(), showInformationMessage: vi.fn(async () => undefined), showErrorMessage: vi.fn(async () => undefined) },
  commands: { executeCommand: vi.fn(async () => undefined) },
}))
import { DshChatController } from '../src/extension.js'
import * as vscode from 'vscode'

const controllers: DshChatController[] = []
const connections: DshConnection[] = []
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.dispose())
  connections.splice(0).forEach(connection => connection.dispose())
  vi.useRealTimers()
})
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

async function harness(connection?: DshConnection) {
  if (connection !== undefined) connections.push(connection)
  const { client, emit, fail } = testClient()
  mocks.client = client
  const output = { appendLine: vi.fn() }
  const runtime = {
    start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    connection: connection ?? { canReauthenticate: true, reauthenticate: vi.fn(async () => {}) },
    state: { kind: 'ready' },
    // Selecting an external runtime offers to save it; these tests never reach the
    // prompt because the double reports nothing worth remembering.
    externalRuntimeUrlToRemember: () => undefined,
    rememberExternalRuntime: vi.fn(async () => true),
  }
  const reviews = { clear: vi.fn(), rebuild: vi.fn(() => [] as any[]), accept: () => false, dispose() {}, revertFile: vi.fn(() => []), revertAll: vi.fn(() => []) }
  const controller = new DshChatController(runtime as any,
    output as any, {} as any, reviews as any,
    { get: () => [], update: async () => {} } as any, '/workspace', '0.0.11')
  controllers.push(controller)
  await controller.start()
  await vi.waitFor(() => expect(controller.state.commands).toHaveLength(1))
  const next = () => { const next = testClient(); mocks.client = next.client; return next }
  return { client, controller, output, emit, fail, runtime, reviews, next }
}

describe('rating a response', () => {
  const opening = { events: [], hasMore: false, projections: { values: {} }, isCurrent: () => true, activate() {} }

  it('records a first rating without claiming a version', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    await h.controller.submitFeedback('a', 'm1', 'positive')
    // No rating exists yet, so the write must claim exactly that.
    expect(h.client.putMessageFeedback).toHaveBeenCalledWith('a', 'm1', 'positive', null)
    expect(h.controller.state.messageFeedback).toEqual([expect.objectContaining({ messageId: 'm1', rating: 'positive' })])
  })

  it('withdraws the rating that is already recorded', async () => {
    const h = await harness()
    h.client.messageFeedback.mockResolvedValue({ ok: true, value: { items: [{ messageId: 'm1', rating: 'positive', version: 7, createdAt: 1, updatedAt: 1 }] } })
    await h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.controller.state.messageFeedback).toHaveLength(1))

    await h.controller.submitFeedback('a', 'm1', 'positive')
    expect(h.client.deleteMessageFeedback).toHaveBeenCalledWith('a', 'm1', 7)
    expect(h.controller.state.messageFeedback).toEqual([])
  })

  it('replaces a rating by quoting its version', async () => {
    const h = await harness()
    h.client.messageFeedback.mockResolvedValue({ ok: true, value: { items: [{ messageId: 'm1', rating: 'positive', version: 7, createdAt: 1, updatedAt: 1 }] } })
    await h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.controller.state.messageFeedback).toHaveLength(1))

    await h.controller.submitFeedback('a', 'm1', 'negative')
    expect(h.client.putMessageFeedback).toHaveBeenCalledWith('a', 'm1', 'negative', 7)
  })

  it('adopts the authoritative rating on a conflict instead of retrying', async () => {
    const h = await harness()
    h.client.messageFeedback.mockResolvedValue({ ok: true, value: { items: [{ messageId: 'm1', rating: 'positive', version: 7, createdAt: 1, updatedAt: 1 }] } })
    await h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.controller.state.messageFeedback).toHaveLength(1))

    // Another window voted in between. Retrying here would silently overrule it,
    // so the runtime's item becomes the state.
    h.client.putMessageFeedback.mockResolvedValueOnce({ ok: false, error: { code: 'version-conflict', current: { messageId: 'm1', rating: 'negative', version: 9, createdAt: 2, updatedAt: 2 } } })
    await h.controller.submitFeedback('a', 'm1', 'negative')
    expect(h.controller.state.messageFeedback).toEqual([expect.objectContaining({ rating: 'negative', version: 9 })])
  })

  it('clears a rating another window removed', async () => {
    const h = await harness()
    h.client.messageFeedback.mockResolvedValue({ ok: true, value: { items: [{ messageId: 'm1', rating: 'positive', version: 7, createdAt: 1, updatedAt: 1 }] } })
    await h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.controller.state.messageFeedback).toHaveLength(1))

    h.client.deleteMessageFeedback.mockResolvedValueOnce({ ok: false, error: { code: 'version-conflict', current: null } })
    await h.controller.submitFeedback('a', 'm1', 'positive')
    expect(h.controller.state.messageFeedback).toEqual([])
  })
})

describe('branching a conversation', () => {
  it('forks at the given event and opens the child', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    await h.controller.forkConversation('a', 42)
    expect(h.client.forkSession).toHaveBeenCalledWith('a', 42)
    // The list this test serves does not contain the child — the runtime may not
    // have published it yet — and the click must still open it rather than do
    // nothing visible.
    expect(h.client.openSession).toHaveBeenCalledWith('child', undefined)
    expect(h.controller.state.sessionId).toBe('child')
  })
})

describe('a conversation that cannot be opened', () => {
  it('reports the failure instead of staying in the loading phase', async () => {
    const h = await harness()
    // Opening a conversation the runtime no longer has: the sidebar must not be
    // left with every control disabled and no way back.
    h.client.openSession.mockRejectedValueOnce(new DshConnectionError('session/not-found', 'session "b" not found'))
    await h.controller.selectSession('b').catch(() => undefined)

    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.statusText).toContain('no longer on the runtime')
    expect(h.controller.state.sessionId).toBe('b')
  })
})

describe('diagnostics and notices', () => {
  it('keeps credential-shaped text out of the channel', async () => {
    const h = await harness()
    // A DSH failure can quote the request it failed on, and the channel is the
    // first thing anyone pastes into an issue.
    h.controller.report(new Error('request to http://127.0.0.1:3080/api/session?token=secret-token-value failed'))
    const written = h.output.appendLine.mock.calls.map(call => String(call[0])).join('\n')
    expect(written).not.toContain('secret-token-value')
    expect(written).toContain('[redacted]')
  })

  it('keeps credential-shaped text out of the runtime banner', async () => {
    const h = await harness()
    // The banner is as visible as the log, and a launch failure can quote the
    // URL it failed on.
    h.controller.observeRuntime({ kind: 'failed', message: 'connect http://127.0.0.1:3080/?token=secret-token-value failed' } as never)
    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.statusText).not.toContain('secret-token-value')
    expect(h.controller.state.statusText).toContain('[redacted]')
  })

  it('releases the stop acknowledgement when the controller is disposed', async () => {
    vi.useFakeTimers()
    const h = await harness()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.cancel()
    h.controller.dispose()
    h.output.appendLine.mockClear()
    await vi.advanceTimersByTimeAsync(120_000)
    // Nothing may run against a disposed controller: the channel can already be
    // closed, and the timer would keep the controller alive.
    expect(h.output.appendLine.mock.calls.map(call => String(call[0]))).toEqual([])
    vi.useRealTimers()
  })

  it('keeps credential-shaped text out of the conversation too', async () => {
    const h = await harness()
    h.controller.report(new Error('cookie: session=abcdef123456 rejected'))
    const notices = h.controller.state.messages.filter(message => message.role === 'notice')
    expect(JSON.stringify(notices)).not.toContain('abcdef123456')
  })
})

describe('sending in a subagent conversation', () => {
  it.each(['one-shot', 'unknown'])('rejects follow-ups to a %s child before calling the runtime', async mode => {
    const h = await harness()
    h.emit({ type: 'host/session-added', sessionId: 'child', cwd: '/workspace', origin: 'subagent', parentSessionId: 'a' })
    await h.controller.selectSession('child')
    h.emit({ type: 'session/projection', sessionId: 'child', key: 'subagent', value: { mode, label: 'Research', seq: 1 } }, 'mux')
    h.client.prompt.mockClear()
    await expect(h.controller.send('continue please')).rejects.toThrow('read-only')
    expect(h.client.prompt).not.toHaveBeenCalled()
  })
  it('delivers the message through the owning conversation', async () => {
    const h = await harness()
    h.emit({ type: 'host/session-added', sessionId: 'child', cwd: '/workspace', origin: 'subagent', parentSessionId: 'a' })
    await h.controller.selectSession('child')
    h.emit({ type: 'session/projection', sessionId: 'child', key: 'subagent', value: { mode: 'continuable', label: 'Research', seq: 1 } }, 'mux')
    h.client.prompt.mockClear()
    await h.controller.send('continue please')
    // session/prompt is refused for a session owned by subagent routing.
    expect(h.client.prompt).toHaveBeenCalledWith('child', 'continue please', [], 'queue', 'a')
  })

  it('keeps an ordinary conversation free of a parent', async () => {
    const h = await harness()
    h.client.prompt.mockClear()
    await h.controller.send('hello')
    expect(h.client.prompt).toHaveBeenCalledWith('a', 'hello', [], 'queue', undefined)
  })
})

describe('task projection state', () => {
  it('updates child activity and resets todo steps when navigating to its conversation', async () => {
    const h = await harness()
    h.emit({ type: 'session/projection', sessionId: 'a', key: 'todos', value: [{ content: 'Inspect', status: 'in_progress' }] }, 'mux')
    expect(h.controller.state.todos).toEqual([{ content: 'Inspect', status: 'in_progress' }])
    h.emit({ type: 'host/session-added', sessionId: 'child', cwd: '/workspace', origin: 'subagent', parentSessionId: 'a', blank: false })
    h.emit({ type: 'session/projection', sessionId: 'child', key: 'subagentTiming', value: { settledMs: 65000, lastTurnCompleted: true } }, 'mux')
    expect(h.controller.state.sessions.find(item => item.id === 'child')?.activity).toMatchObject({ elapsedMs: 65000, status: 'completed' })
    await h.controller.selectSession('child')
    expect(h.controller.state.todos).toEqual([])
    h.emit({ type: 'session/projection', sessionId: 'a', key: 'todos', value: [{ content: 'Parent only', status: 'pending' }] }, 'mux')
    expect(h.controller.state.todos).toEqual([])
  })
})

describe('stopping the active turn', () => {
  it('cancels an ordinary session through session/cancel', async () => {
    const h = await harness()
    h.client.cancel.mockClear()
    h.client.interruptSubagent.mockClear()
    await h.controller.cancel()
    expect(h.client.cancel).toHaveBeenCalledWith('a')
    expect(h.client.interruptSubagent).not.toHaveBeenCalled()
  })

  it('acknowledges the request so the click is visible', async () => {
    const h = await harness()
    expect(h.controller.state.stopping).toBe(false)
    await h.controller.cancel()
    // Cancellation is cooperative: the turn is still running, and the sidebar
    // has to show that the request landed rather than appearing inert.
    expect(h.controller.state.stopping).toBe(true)
  })

  it('stops a subagent session through its parent', async () => {
    const h = await harness()
    // session/cancel is refused for a session owned by subagent routing, so a
    // child has to be interrupted by naming its parent.
    h.emit({ type: 'host/session-added', sessionId: 'child', cwd: '/workspace', origin: 'subagent', parentSessionId: 'a' })
    h.emit({ type: 'host/session-status', sessionId: 'child', running: true })
    await h.controller.selectSession('child')
    expect(h.controller.state.parentSessionId).toBe('a')

    h.client.cancel.mockClear()
    h.client.interruptSubagent.mockClear()
    await h.controller.cancel()
    expect(h.client.interruptSubagent).toHaveBeenCalledWith('child', 'a')
    expect(h.client.cancel).not.toHaveBeenCalled()
  })

  it('does not carry an acknowledgement into another conversation', async () => {
    const h = await harness()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.cancel()
    expect(h.controller.state.stopping).toBe(true)
    // 'b' is running too, but its turn was never asked to stop: showing the
    // acknowledgement here would leave its Stop button disabled.
    h.emit({ type: 'host/session-status', sessionId: 'b', running: true })
    await h.controller.selectSession('b')
    expect(h.controller.state.running).toBe(true)
    expect(h.controller.state.stopping).toBe(false)
  })

  it('follows the owner when the open conversation changes', async () => {
    const h = await harness()
    // Regression: the owner was only derived while refreshing the list, so
    // opening a subagent kept the previous conversation's lineage.
    expect(h.controller.state.parentSessionId).toBeNull()
    h.emit({ type: 'host/session-added', sessionId: 'child', cwd: '/workspace', origin: 'subagent', parentSessionId: 'a' })
    await h.controller.selectSession('child')
    expect(h.controller.state.parentSessionId).toBe('a')
    await h.controller.selectSession('b')
    expect(h.controller.state.parentSessionId).toBeNull()
  })

  it('clears the acknowledgement when the turn ends', async () => {
    const h = await harness()
    await h.controller.cancel()
    expect(h.controller.state.stopping).toBe(true)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    expect(h.controller.state.stopping).toBe(false)
    expect(h.controller.state.running).toBe(false)
  })

  it('clears the acknowledgement when the request is refused', async () => {
    const h = await harness()
    h.client.cancel.mockRejectedValue(new Error('session/not-found: not attached'))
    await expect(h.controller.cancel()).rejects.toThrow('not attached')
    // Nothing is pending, so the button must not stay disabled.
    expect(h.controller.state.stopping).toBe(false)
  })

  it('releases the acknowledgement if the turn never reports finishing', async () => {
    vi.useFakeTimers()
    const h = await harness()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.cancel()
    expect(h.controller.state.stopping).toBe(true)
    await vi.advanceTimersByTimeAsync(90_000)
    // A missed status frame must not leave the button disabled forever.
    expect(h.controller.state.stopping).toBe(false)
    expect(h.controller.state.running).toBe(true)
    vi.useRealTimers()
  })
})

describe('account sign-in state', () => {
  it('loads account state as soon as a conversation becomes ready', async () => {
    // Regression: refreshAccount was only reached from the sign-in poll, so the
    // account control never appeared until an attempt already existed.
    const h = await harness()
    await vi.waitFor(() => expect(h.controller.state.account.available).toBe(true))
    expect(h.client.accountState).toHaveBeenCalled()
    expect(h.controller.state.account.signedIn).toBe(false)
    expect(h.controller.state.accountNotice).toBeNull()
  })

  it('stops polling an attempt the host never settles', async () => {
    vi.useFakeTimers()
    const h = await harness()
    h.client.accountState.mockResolvedValue({ status: 'signed-out', attempt: { id: 'a1', phase: 'waiting-browser',
      authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?x=1' },
      links: { usageUrl: 'u', topUpUrl: 't' } })
    await h.controller.refreshAccount()
    await vi.advanceTimersByTimeAsync(1500 * 500)
    // Bounded: a host stuck in `waiting-browser` cannot poll forever.
    expect(h.client.accountState.mock.calls.length).toBeLessThan(450)
    vi.useRealTimers()
  })

  it('re-reads account state when the runtime reports a sign-out', async () => {
    const h = await harness()
    await vi.waitFor(() => expect(h.controller.state.account.available).toBe(true))
    // The user signed out (or the session expired) elsewhere; the sidebar must
    // not keep claiming a sign-in it can no longer prove.
    h.client.accountState.mockClear()
    h.client.accountState.mockResolvedValue({ status: 'signed-out', attempt: null,
      links: { usageUrl: 'u', topUpUrl: 't' } })
    h.emit({ type: 'host/account-changed' })
    await vi.waitFor(() => expect(h.client.accountState).toHaveBeenCalled())
    expect(h.controller.state.account.signedIn).toBe(false)
  })

  it('hides the account control when the runtime has no account service', async () => {
    const h = await harness()
    h.client.accountState.mockRejectedValue(new Error('gateway/not-found: unknown method account/getState'))
    await h.controller.refreshAccount()
    expect(h.controller.state.account.available).toBe(false)
    expect(h.controller.state.accountNotice).toBeNull()
    // A deployment without the account controller is supported, not an error.
    expect(h.controller.state.messages.filter(message => message.role === 'notice')).toHaveLength(0)
  })

  it('renders the signed-in identity and balance for the account row', async () => {
    const h = await harness()
    h.client.accountState.mockResolvedValue({ status: 'credential-stored', attempt: null,
      links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } })
    h.client.accountProfile.mockResolvedValue({ status: 'ready', value: { id: 'u1', name: 'Alex', contact: null } })
    h.client.accountBalance.mockResolvedValue({ status: 'ready', value: [{ currency: 'CNY', balance: '12.50' }], bonusWallets: [] })
    await h.controller.refreshAccount()
    expect(h.controller.state.account.signedIn).toBe(true)
    expect(h.controller.state.accountNotice).toBe('Alex · ¥12.50')
  })

  it('keeps a failed detail read from failing the whole account row', async () => {
    const h = await harness()
    h.client.accountState.mockResolvedValue({ status: 'credential-stored', attempt: null,
      links: { usageUrl: 'u', topUpUrl: 't' } })
    h.client.accountProfile.mockRejectedValue(new Error('boom'))
    h.client.accountBalance.mockRejectedValue(new Error('boom'))
    await h.controller.refreshAccount()
    expect(h.controller.state.account.signedIn).toBe(true)
    expect(h.controller.state.accountNotice).toBe('Signed in')
  })
})

describe('runtime selection', () => {
  it.each(['terminal error', 'exhausted retries'])('blocks workspace and runtime switches until task state is restored after %s', async failure => {
    const h = await harness()
    h.emit({ type: 'session/jobs', sessionId: 'foreign', jobs: [
      { id: 'server', kind: 'bash', label: 'Server', startedAt: 1, status: 'running' },
    ] }, 'mux')
    vi.useFakeTimers()
    if (failure === 'exhausted retries') {
      const next = h.next()
      next.client.startStreams.mockRejectedValue(new DshStreamError('Still offline', true))
      h.fail(new DshStreamError('Connection lost', true))
      const reconnect = h.controller.reconnect()
      await vi.advanceTimersByTimeAsync(5000)
      await reconnect
    } else h.fail(new DshStreamError('Invalid stream frame'))
    expect(h.controller.state.phase).toBe('error')
    await expect(h.controller.switchWorkspace('/other-workspace')).rejects.toThrow('Reconnect')
    await expect(h.controller.selectRuntime({ kind: 'managed' })).rejects.toThrow('Reconnect')
    expect(h.controller.cwd).toBe('/workspace')
    expect(h.runtime.stop).not.toHaveBeenCalled()

    // A fresh idle baseline makes switching available again.
    h.next()
    const reconnect = h.controller.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    await reconnect
    expect(h.controller.state.phase).toBe('ready')
    expect(h.controller.hasRunningTasks).toBe(false)
    expect(() => h.controller.assertCanSelectRuntime()).not.toThrow()
  })

  it('marks a restart in progress before stopping the runtime and reports only the current completion', async () => {
    const h = await harness(), stopped = Promise.withResolvers<void>()
    h.runtime.stop.mockReturnValueOnce(stopped.promise)
    const earlier = h.controller.restart()
    expect(h.controller.state.phase).toBe('loading')
    const latest = h.controller.restart()
    expect(await latest).toBe(true)
    stopped.resolve()
    expect(await earlier).toBe(false)
    h.controller.dispose()
    expect(await h.controller.restart()).toBe(false)
  })

  it('does not report an old restart as current when a reconnect supersedes its session load', async () => {
    const h = await harness(), next = h.next(), opening = Promise.withResolvers<any>()
    next.client.openSession.mockReturnValueOnce(opening.promise)
    const restart = h.controller.restart()
    await vi.waitFor(() => expect(next.client.openSession).toHaveBeenCalledTimes(1))
    h.next()
    await h.controller.reconnect()
    opening.resolve({ events: [], hasMore: false, projections: {}, isCurrent: () => true, activate() {} })
    expect(await restart).toBe(false)
    expect(h.controller.state.phase).toBe('ready')
  })

  it.each(['running', 'stopping'])('protects a %s job even after its agent and foreground session are idle', async status => {
    const h = await harness()
    h.emit({ type: 'session/jobs', sessionId: 'foreign', jobs: [{ id: 'server', kind: 'bash', label: 'Server', startedAt: 1, status }] }, 'mux')
    expect(h.controller.state.running).toBe(false)
    expect(h.controller.state.jobs).toEqual([])
    expect(h.controller.hasRunningTasks).toBe(true)
    await expect(h.controller.switchWorkspace('/elsewhere')).rejects.toThrow('running DeepSeek tasks')
    await expect(h.controller.selectRuntime({ kind: 'managed' })).rejects.toThrow('running DeepSeek tasks')
    expect(h.runtime.stop).not.toHaveBeenCalled()
    h.emit({ type: 'host/session-removed', sessionId: 'foreign' })
    expect(h.controller.hasRunningTasks).toBe(false)
  })

  it.each(['completed', 'failed', 'killed'])('unblocks changes after a job becomes %s', async status => {
    const h = await harness()
    const job = { id: 'server', kind: 'bash', label: 'Server', startedAt: 1, status: 'running' }
    h.emit({ type: 'session/jobs', sessionId: 'b', jobs: [job] }, 'mux')
    expect(h.controller.hasRunningTasks).toBe(true)
    h.emit({ type: 'session/jobs', sessionId: 'b', jobs: [{ ...job, status }] }, 'mux')
    expect(h.controller.hasRunningTasks).toBe(false)
    expect(() => h.controller.assertCanSelectRuntime()).not.toThrow()
  })

  it('restores other sessions’ jobs on reconnect and discards jobs missing from the new baseline', async () => {
    const h = await harness()
    const job = { id: 'server', kind: 'bash', label: 'Server', startedAt: 1, status: 'running' }
    h.emit({ type: 'session/jobs', sessionId: 'stale', jobs: [job] }, 'mux')
    const next = h.next()
    next.client.startStreams.mockImplementationOnce(async () => {
      next.emit({ type: 'session/jobs', sessionId: 'b', jobs: [job] }, 'mux')
    })
    await h.controller.reconnect()
    expect(h.controller.state.jobs).toEqual([])
    expect(h.controller.hasRunningTasks).toBe(true)
    await h.controller.selectSession('b')
    expect(h.controller.state.jobs).toEqual([job])
    h.emit({ type: 'session/jobs', sessionId: 'stale', jobs: [job] }, 'mux')
    next.emit({ type: 'session/jobs', sessionId: 'b', jobs: [] }, 'mux')
    expect(h.controller.hasRunningTasks).toBe(false)
  })

  it('blocks restart-required settings while a job outlives its agent', async () => {
    const h = await harness()
    h.client.settings.mockResolvedValue({ namespaces: [{ ns: 'plugin', revision: 1, applies: 'restart' }] })
    const [ns] = (await h.controller.settings()).namespaces
    h.emit({ type: 'session/jobs', sessionId: 'b', jobs: [{ id: 'server', kind: 'bash', label: 'Server', startedAt: 1, status: 'running' }] }, 'mux')
    expect(() => h.controller.mutateSettings(ns!, [])).toThrow('all running DeepSeek tasks')
    expect(h.client.mutateSettings).not.toHaveBeenCalled()
  })

  it('blocks switching projects while another conversation is running', async () => {
    const h = await harness()
    h.emit({ type: 'host/session-status', sessionId: 'b', running: true })
    expect(h.controller.state.running).toBe(false)
    expect(h.controller.hasRunningTasks).toBe(true)
    await expect(h.controller.switchWorkspace('/another-project')).rejects.toThrow('running DeepSeek tasks')
    expect(h.controller.cwd).toBe('/workspace')
    expect(h.runtime.stop).not.toHaveBeenCalled()
    h.emit({ type: 'host/session-status', sessionId: 'b', running: false })
    expect(h.controller.hasRunningTasks).toBe(false)
    expect(() => h.controller.assertCanSelectRuntime()).not.toThrow()
  })

  it('protects sessions outside the visible project, including child agents', async () => {
    const h = await harness()
    h.emit({ type: 'host/session-added', sessionId: 'foreign', cwd: '/elsewhere', updatedAt: 1, blank: false, running: true })
    h.emit({ type: 'host/session-added', sessionId: 'child', origin: 'subagent', cwd: '/workspace', updatedAt: 1, blank: false, running: true })
    expect(h.controller.state.sessions.every(item => !['foreign', 'child'].includes(item.id))).toBe(true)
    expect(h.controller.hasRunningTasks).toBe(true)
    await expect(h.controller.selectRuntime({ kind: 'managed' })).rejects.toThrow('running DeepSeek tasks')
    h.emit({ type: 'host/session-removed', sessionId: 'child' })
    expect(h.controller.hasRunningTasks).toBe(true)
    h.emit({ type: 'host/session-status', sessionId: 'foreign', running: false })
    expect(h.controller.hasRunningTasks).toBe(false)
  })

  it('includes already-running foreign sessions from the initial runtime snapshot', async () => {
    const h = await harness()
    const snapshot = await h.client.listSessions()
    h.client.listSessions.mockResolvedValue({ items: [...snapshot.items, { ...snapshot.items[0]!, sessionId: 'foreign', cwd: '/elsewhere', running: true }] })
    await h.controller.start()
    expect(h.controller.hasRunningTasks).toBe(true)
    expect(h.controller.state.sessions.every(item => item.id !== 'foreign')).toBe(true)
    h.controller.observeRuntime({ kind: 'stopped' })
    expect(h.controller.hasRunningTasks).toBe(false)
  })

  it.each([true, false])('keeps the latest running=%s event when session/list returns an older snapshot', async running => {
    const h = await harness()
    const snapshot = await h.client.listSessions()
    const pending = Promise.withResolvers<any>()
    h.client.listSessions.mockReturnValueOnce(pending.promise)
    const before = h.client.listSessions.mock.calls.length
    const loading = h.controller.start()
    await vi.waitFor(() => expect(h.client.listSessions.mock.calls.length).toBeGreaterThan(before))
    h.emit({ type: 'host/session-status', sessionId: 'b', running })
    pending.resolve({ items: snapshot.items.map(summary => summary.sessionId === 'b' ? { ...summary, running: !running } : summary) })
    await loading
    expect(h.controller.hasRunningTasks).toBe(running)
    h.emit({ type: 'host/session-status', sessionId: 'b', running: false })
    expect(h.controller.hasRunningTasks).toBe(false)
  })

  it('rechecks background tasks before saving restart-required settings, but allows live settings', async () => {
    const h = await harness()
    const restart = { ns: 'restart-setting', revision: 1, applies: 'restart' }
    const live = { ns: 'live-setting', revision: 1, applies: 'live' }
    h.client.settings.mockResolvedValue({ namespaces: [restart, live] })
    const [restartDraft, liveDraft] = (await h.controller.settings()).namespaces
    h.emit({ type: 'host/session-status', sessionId: 'b', running: true })
    expect(() => h.controller.mutateSettings(restartDraft!, [])).toThrow('all running DeepSeek tasks')
    expect(h.client.mutateSettings).not.toHaveBeenCalled()
    await h.controller.mutateSettings(liveDraft!, [])
    expect(h.client.mutateSettings).toHaveBeenCalledWith('live-setting', [], 1)
    h.emit({ type: 'host/session-status', sessionId: 'b', running: false })
    await h.controller.mutateSettings(restartDraft!, [])
    expect(h.client.mutateSettings).toHaveBeenCalledWith('restart-setting', [], 1)
  })

  it('disconnects the old client and passes the explicit target without publishing its credentials', async () => {
    const h = await harness()
    const next = h.next()
    const states: unknown[] = []
    h.controller.onDidChangeState(state => states.push(state))
    const target = { kind: 'external' as const, launchUrl: new URL('http://127.0.0.1:43127/?token=private-token') }
    await h.controller.selectRuntime(target)
    expect(h.runtime.stop).toHaveBeenCalledTimes(1)
    expect(h.client.dispose).toHaveBeenCalledTimes(1)
    expect(h.runtime.start).toHaveBeenLastCalledWith(expect.objectContaining({ fsPath: '/workspace' }), target)
    expect(next.client.startStreams).toHaveBeenCalledTimes(1)
    expect(h.controller.state.phase).toBe('ready')
    expect(JSON.stringify(states)).not.toContain('private-token')
    expect(h.reviews.clear).toHaveBeenCalledTimes(2)
  })

  it('does not switch during a background task or another connection attempt', async () => {
    const h = await harness()
    h.emit({ type: 'host/session-status', sessionId: 'b', running: true })
    await expect(h.controller.selectRuntime({ kind: 'managed' })).rejects.toThrow('running DeepSeek tasks')
    expect(h.runtime.stop).not.toHaveBeenCalled()
    h.controller.publish({ phase: 'loading' })
    await expect(h.controller.selectRuntime({ kind: 'managed' })).rejects.toThrow('connection attempt')
    expect(h.runtime.stop).not.toHaveBeenCalled()
  })

  it('renders the external connection choice from both startup rejection and runtime state', async () => {
    const h = await harness()
    h.runtime.start.mockRejectedValueOnce(new ExistingRuntimeConnectionError())
    await h.controller.restart()
    expect(h.controller.state).toMatchObject({ phase: 'error', setup: 'runtime-auth' })
    h.controller.observeRuntime({ kind: 'failed', reason: 'runtime-auth', message: 'Try another launch URL' })
    expect(h.controller.state).toMatchObject({ phase: 'error', setup: 'runtime-auth', statusText: 'Try another launch URL' })
  })

  it('does not complete a superseded switch after a newer restart', async () => {
    const h = await harness()
    let stop!: () => void
    const stopped = new Promise<void>(resolve => { stop = resolve })
    h.runtime.stop.mockReturnValue(stopped)
    const switching = h.controller.selectRuntime({ kind: 'external', launchUrl: new URL('http://127.0.0.1:43127/?token=old') })
    const restart = h.controller.restart({ kind: 'managed' })
    h.next()
    stop()
    await Promise.all([switching, restart])
    expect(h.runtime.start).toHaveBeenCalledTimes(2)
    expect(h.runtime.start).toHaveBeenLastCalledWith(expect.anything(), { kind: 'managed' })
  })

  it('does not connect to a selected runtime after disposal', async () => {
    const h = await harness()
    let stop!: () => void
    h.runtime.stop.mockReturnValue(new Promise<void>(resolve => { stop = resolve }))
    const switching = h.controller.selectRuntime({ kind: 'managed' })
    h.controller.dispose()
    stop(); await switching
    expect(h.runtime.start).toHaveBeenCalledTimes(1)
    await expect(h.controller.selectRuntime({ kind: 'managed' })).rejects.toThrow('sidebar has closed')
    await h.controller.restart()
    await h.controller.start()
    expect(h.runtime.stop).toHaveBeenCalledTimes(1)
    expect(h.runtime.start).toHaveBeenCalledTimes(1)
  })
})

describe('starting again', () => {
  it('keeps the conversation the user was reading', async () => {
    const h = await harness()
    await h.controller.selectSession('b')
    expect(h.controller.state.sessionId).toBe('b')

    // A restart, or the view being re-created, calls start() again. The session
    // list is reloaded from scratch, and the selection has to survive it.
    await h.controller.start()
    expect(h.controller.state.sessionId).toBe('b')
  })

  it('leaves a failed restart on a screen that can try again', async () => {
    const h = await harness()
    await h.controller.selectSession('b')
    h.runtime.stop.mockRejectedValueOnce(new Error('the runtime would not stop'))

    await expect(h.controller.restart()).rejects.toThrow('the runtime would not stop')

    // Loading offers the user nothing to click, so a restart that cannot even
    // stop used to be a dead screen: no conversation, no composer, no retry.
    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.statusText).toBe('Could not restart DeepSeek Harness: the runtime would not stop')
    expect(h.controller.state.setup).toBeNull()
    expect(h.controller.state.running).toBe(false)
  })
})

describe('sidebar reconnect', () => {
  it.each(['healthy', 'disconnected'])('manually reconnects a %s tokenless runtime without authenticating or resending', async state => {
    const connection = new DshConnection(new URL('http://127.0.0.1:3080'))
    const reauthenticate = vi.spyOn(connection, 'reauthenticate')
    const h = await harness(connection)
    await h.controller.selectSession('b')
    if (state === 'disconnected') h.fail(new DshStreamError('Invalid stream frame'))
    const next = h.next()
    await h.controller.reconnect()
    expect(h.controller.state).toMatchObject({ phase: 'ready', sessionId: 'b' })
    expect(reauthenticate).not.toHaveBeenCalled()
    expect(connection.authenticated).toBe(false)
    expect(h.client.dispose).toHaveBeenCalledTimes(1)
    expect(next.client.startStreams).toHaveBeenCalledTimes(1)
    // The second argument is the subagent owner; an ordinary conversation has none.
    expect(next.client.openSession).toHaveBeenCalledWith('b', undefined)
    expect(h.runtime.start).toHaveBeenCalledTimes(1)
    expect(h.runtime.stop).not.toHaveBeenCalled()
    expect(next.client.prompt).not.toHaveBeenCalled()
    expect(next.client.respond).not.toHaveBeenCalled()
    expect(next.client.executeCommand).not.toHaveBeenCalled()
    expect(next.client.updateQueue).not.toHaveBeenCalled()
  })

  it('reports authentication refusal when a tokenless runtime no longer accepts its subscriptions', async () => {
    const connection = new DshConnection(new URL('http://127.0.0.1:3080'))
    const reauthenticate = vi.spyOn(connection, 'reauthenticate')
    const h = await harness(connection)
    const next = h.next()
    next.client.startStreams.mockRejectedValue(new DshStreamError('DSH authentication was refused. Reconnect to authenticate again.'))
    await h.controller.reconnect()
    expect(h.controller.state).toMatchObject({ phase: 'error', canReconnect: true })
    expect(h.controller.state.statusText).toContain('DSH authentication was refused')
    expect(reauthenticate).not.toHaveBeenCalled()
    expect(next.client.startStreams).toHaveBeenCalledTimes(1)
    expect(next.client.openSession).not.toHaveBeenCalled()
    expect(h.runtime.start).toHaveBeenCalledTimes(1)
    expect(h.runtime.stop).not.toHaveBeenCalled()
  })

  it('does not rebuild subscriptions after token-backed reauthentication fails', async () => {
    const h = await harness()
    vi.spyOn(h.runtime.connection, 'reauthenticate').mockRejectedValue(new Error('DSH did not accept its launch token'))
    const next = h.next()
    await h.controller.reconnect()
    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.statusText).toContain('DSH did not accept its launch token')
    expect(h.runtime.connection.reauthenticate).toHaveBeenCalledTimes(1)
    expect(next.client.startStreams).not.toHaveBeenCalled()
    expect(h.runtime.start).toHaveBeenCalledTimes(1)
    expect(h.runtime.stop).not.toHaveBeenCalled()
  })

  it.each(['stream error', 'failed', 'stopped'])('discards live assistant state and preserves durable messages after %s', async failure => {
    const h = await harness()
    h.emit({ type: 'session/event', sessionId: 'a', event: {
      type: 'user/message', seq: 1, time: 10,
      data: { id: 'durable-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Durable prompt' }] },
    } }, 'mux')
    h.emit({ type: 'session/assistant-stream', sessionId: 'a', update: {
      kind: 'start', attemptId: 'a:1', turn: 1, step: 1,
    } }, 'mux')
    h.emit({ type: 'session/assistant-stream', sessionId: 'a', update: {
      kind: 'chunk', attemptId: 'a:1', chunk: { type: 'text-delta', text: 'Transient partial answer' },
    } }, 'mux')
    expect(h.controller.state.messages.some(message => message.streaming)).toBe(true)

    if (failure === 'stream error') h.fail(new DshStreamError('Invalid stream frame'))
    else {
      h.runtime.state.kind = failure
      h.controller.observeRuntime(failure === 'failed' ? { kind: 'failed', message: 'DSH exited (code 1).' } : { kind: 'stopped' })
    }

    expect(h.controller.state).toMatchObject({ phase: 'error', sessionId: 'a', setup: null })
    if (failure === 'stream error') expect(h.controller.state.statusText).toContain('Invalid stream frame')
    else expect(h.controller.state).toMatchObject({ canReconnect: false, running: false })
    expect(h.controller.state.messages).toEqual([{ id: 'durable-user', role: 'user', text: 'Durable prompt' }])
    expect(h.controller.state.messages.some(message => message.streaming)).toBe(false)
    expect(h.client.dispose).toHaveBeenCalled()
    expect(h.runtime.stop).not.toHaveBeenCalled()
  })

  it('retains the same session transcript when reopening its snapshot fails', async () => {
    const h = await harness()
    h.emit({ type: 'session/event', sessionId: 'a', event: { type: 'user/message', seq: 1, time: 10,
      data: { id: 'a-prompt', source: { kind: 'user' }, content: [{ type: 'text', text: 'Durable A' }] },
    } }, 'mux')
    const next = h.next()
    next.client.openSession.mockRejectedValue(new DshStreamError('Invalid session snapshot'))
    await h.controller.reconnect()
    expect(h.controller.state).toMatchObject({ sessionId: 'a', phase: 'error',
      messages: [{ id: 'a-prompt', role: 'user', text: 'Durable A' }] })
  })

  it.each(['snapshot', 'models'])('does not restore an archived session transcript when the fallback %s fails', async stage => {
    const h = await harness()
    h.emit({ type: 'session/event', sessionId: 'a', event: { type: 'user/message', seq: 1, time: 10,
      data: { id: 'a-prompt', source: { kind: 'user' }, content: [{ type: 'text', text: 'Only belongs to A' }] },
    } }, 'mux')
    h.controller.publish({ changedFiles: [{ turn: 1, files: [{ path: 'a.ts', additions: 1, deletions: 0, canRevert: false }] }] })
    const next = h.next()
    next.client.listWorkspaces.mockResolvedValue({ archivedSessionIds: ['a'] })
    if (stage === 'snapshot') next.client.openSession.mockRejectedValue(new DshStreamError('Invalid session snapshot'))
    else next.client.models.mockRejectedValue(new Error('Model catalog unavailable'))
    await h.controller.reconnect()
    expect(h.controller.state).toMatchObject({ sessionId: 'b', phase: 'error', messages: [], changedFiles: [] })
  })

  it('keeps a restored empty snapshot authoritative if the stream then fails', async () => {
    const h = await harness()
    h.emit({ type: 'session/event', sessionId: 'a', event: { type: 'user/message', seq: 1, time: 10,
      data: { id: 'old-prompt', source: { kind: 'user' }, content: [{ type: 'text', text: 'Obsolete history' }] },
    } }, 'mux')
    const next = h.next()
    next.client.openSession.mockResolvedValue({ events: [], hasMore: false, projections: {}, isCurrent: () => true,
      activate: () => next.fail(new DshStreamError('Invalid stream frame')) })
    await h.controller.reconnect()
    expect(h.controller.state).toMatchObject({ sessionId: 'a', phase: 'error', messages: [] })
  })

  it('restores the selected conversation and background request scope without restarting or resending', async () => {
    const h = await harness()
    h.client.handledSessionIds.push('a')
    await h.controller.selectSession('b')
    h.emit({ type: 'session/event', sessionId: 'b', event: { type: 'user/message', seq: 1, time: 30,
      data: { content: [{ type: 'text', text: 'Already submitted' }] } } }, 'mux')
    const messages = h.controller.state.messages
    const oldListener = h.client.onFrame.mock.calls[0]![0]
    const next = h.next()
    next.client.openSession.mockResolvedValue({ events: [{ event: { type: 'assistant/message', seq: 2, time: 50,
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Completed while offline' }] }, stream: [] } } }],
      hasMore: false, projections: {}, isCurrent: () => true, activate() {} } as any)
    vi.useFakeTimers()
    h.fail(new DshStreamError('Connection lost', true))
    expect(h.controller.state).toMatchObject({ phase: 'loading', sessionId: 'b', messages, approval: null, question: null })
    await expect(h.controller.send('Do not send')).rejects.toThrow('not connected')
    const reconnect = h.controller.reconnect()
    expect(h.controller.reconnect()).toBe(reconnect)
    await vi.advanceTimersByTimeAsync(500)
    await reconnect
    expect(h.controller.state).toMatchObject({ phase: 'ready', sessionId: 'b' })
    expect(h.controller.state.messages[0]?.text).toBe('Completed while offline')
    expect(next.client.handledSessionIds).toEqual(['a', 'b'])
    expect(h.runtime.start).toHaveBeenCalledTimes(1)
    expect(h.runtime.stop).not.toHaveBeenCalled()
    expect(h.runtime.connection.reauthenticate).not.toHaveBeenCalled()
    expect(h.reviews.clear).toHaveBeenCalledTimes(1)
    expect(next.client.prompt).not.toHaveBeenCalled()
    expect(next.client.respond).not.toHaveBeenCalled()
    expect(next.client.executeCommand).not.toHaveBeenCalled()
    expect(next.client.updateQueue).not.toHaveBeenCalled()
    oldListener({ channel: 'host', rpcId: '', payload: { type: 'host/session-activity', sessionId: 'b', updatedAt: 999 } })
    expect(h.controller.state.sessions.find(s => s.id === 'b')?.updatedAt).not.toBe(999)
  })

  it('bounds retry attempts and keeps the transcript when reconnection fails', async () => {
    const h = await harness()
    h.emit({ type: 'session/event', sessionId: 'a', event: {
      type: 'user/message', seq: 1, time: 10,
      data: { id: 'durable-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Durable prompt' }] },
    } }, 'mux')
    h.emit({ type: 'session/assistant-stream', sessionId: 'a', update: {
      kind: 'start', attemptId: 'a:1', turn: 1, step: 1,
    } }, 'mux')
    h.emit({ type: 'session/assistant-stream', sessionId: 'a', update: {
      kind: 'chunk', attemptId: 'a:1', chunk: { type: 'text-delta', text: 'Transient partial answer' },
    } }, 'mux')
    expect(h.controller.state.messages.some(message => message.streaming)).toBe(true)
    const next = h.next()
    next.client.startStreams.mockRejectedValue(new DshStreamError('Still offline', true))
    vi.useFakeTimers()
    h.fail(new DshStreamError('Connection lost', true))
    const reconnect = h.controller.reconnect()
    await vi.advanceTimersByTimeAsync(5000)
    await reconnect
    expect(next.client.startStreams).toHaveBeenCalledTimes(3)
    expect(h.controller.state).toMatchObject({ phase: 'error', sessionId: 'a', canReconnect: true, setup: null })
    expect(h.controller.state.statusText).toContain('No tasks were resent')
    expect(h.controller.state.messages).toEqual([{ id: 'durable-user', role: 'user', text: 'Durable prompt' }])
    expect(h.controller.state.messages.some(message => message.streaming)).toBe(false)
    expect(h.runtime.stop).not.toHaveBeenCalled()
    expect(next.client.prompt).not.toHaveBeenCalled()
  })

  it('does not loop indefinitely when the stream repeatedly drops just after recovery', async () => {
    const h = await harness()
    let active = { fail: h.fail }
    vi.useFakeTimers()
    for (let index = 0; index < 4; index++) {
      const next = h.next()
      active.fail(new DshStreamError('Flapping', true))
      const reconnect = h.controller.reconnect()
      await vi.advanceTimersByTimeAsync(500)
      await reconnect
      expect(next.client.startStreams).toHaveBeenCalledTimes(index < 3 ? 1 : 0)
      active = next
    }
    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.statusText).toContain('keeps dropping')
    expect(h.runtime.stop).not.toHaveBeenCalled()
  })

  it('retries a stream failure during snapshot restoration without replaying commands', async () => {
    const h = await harness()
    const next = h.next()
    next.client.listSessions.mockImplementationOnce(async () => {
      next.fail(new DshStreamError('Lost during restore', true))
      throw new Error('Read cancelled by disposal')
    })
    vi.useFakeTimers()
    h.fail(new DshStreamError('Connection lost', true))
    const reconnect = h.controller.reconnect()
    await vi.advanceTimersByTimeAsync(2000)
    await reconnect
    expect(h.controller.state.phase).toBe('ready')
    expect(next.client.startStreams).toHaveBeenCalledTimes(2)
    expect(next.client.executeCommand).not.toHaveBeenCalled()
    expect(next.client.prompt).not.toHaveBeenCalled()
  })

  it('requires manual retry for protocol errors and never creates a replacement conversation', async () => {
    const h = await harness()
    const next = h.next()
    next.client.listSessions.mockResolvedValue({ items: [] })
    vi.useFakeTimers()
    h.fail(new DshStreamError('Invalid frame'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(next.client.startStreams).not.toHaveBeenCalled()
    const reconnect = h.controller.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    await reconnect
    expect(h.runtime.connection.reauthenticate).toHaveBeenCalledTimes(1)
    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.statusText).toContain('No conversation is available')
    expect(h.runtime.start).toHaveBeenCalledTimes(1)
  })

  it.each(['dispose', 'stop', 'restart'])('cancels a scheduled reconnect on %s', async action => {
    const h = await harness()
    const next = h.next()
    vi.useFakeTimers()
    h.fail(new DshStreamError('Connection lost', true))
    const reconnect = h.controller.reconnect()
    if (action === 'dispose') h.controller.dispose()
    if (action === 'stop') { h.runtime.state.kind = 'stopped'; h.controller.observeRuntime({ kind: 'stopped' }) }
    if (action === 'restart') await h.controller.restart()
    await vi.advanceTimersByTimeAsync(5000)
    await reconnect
    expect(next.client.startStreams).toHaveBeenCalledTimes(action === 'restart' ? 1 : 0)
    expect(h.runtime.stop).toHaveBeenCalledTimes(action === 'restart' ? 1 : 0)
  })

  it('ignores a late snapshot from a reconnect superseded by an explicit restart', async () => {
    const h = await harness()
    const old = h.next()
    const opening = Promise.withResolvers<any>()
    old.client.openSession.mockReturnValueOnce(opening.promise)
    vi.useFakeTimers()
    h.fail(new DshStreamError('Connection lost', true))
    const reconnect = h.controller.reconnect()
    await vi.advanceTimersByTimeAsync(500)
    const fresh = h.next()
    await h.controller.restart()
    opening.resolve({ events: [], hasMore: false, projections: { title: 'Stale' }, isCurrent: () => true, activate() {} })
    await reconnect
    expect(h.controller.state.phase).toBe('ready')
    expect(fresh.client.openSession).toHaveBeenCalledTimes(1)
    expect(h.controller.state.sessions.some(s => s.title === 'Stale')).toBe(false)
  })

  it('does not let an old approval response clear a redelivered request after reconnecting', async () => {
    const h = await harness()
    const pending = Promise.withResolvers<any>()
    h.client.respond.mockReturnValueOnce(pending.promise)
    const payload = { type: 'approval/requested', sessionId: 'a', approvalId: 'same-id', toolName: 'Write' }
    h.emit(payload, 'mux', 'same-id')
    const response = h.controller.answerApproval('same-id', 'same-id', 'allowed-once')
    const next = h.next()
    vi.useFakeTimers()
    h.fail(new DshStreamError('Connection lost', true))
    const reconnect = h.controller.reconnect()
    await vi.advanceTimersByTimeAsync(500)
    await reconnect
    next.emit(payload, 'mux', 'same-id')
    pending.resolve({ accepted: true }); await response
    expect(h.controller.state.approval?.rpcId).toBe('same-id')
    expect(next.client.respond).not.toHaveBeenCalled()
  })
})

describe('sidebar attachments after reconnect', () => {
  const attachment = { attachmentId: 'picture', mediaType: 'image/png', bytes: 8, width: 1, height: 1 }
  const event = { type: 'assistant/message', seq: 1, time: 10, data: {
    turn: 1, step: 1, message: { content: [{ type: 'image', attachment }] },
  } }
  const opening = { events: [{ event }], hasMore: false, projections: {}, isCurrent: () => true, activate() {} }

  it('retries an image request cancelled by disconnecting', async () => {
    const h = await harness()
    const pending = Promise.withResolvers<any>()
    h.client.attachment.mockReturnValue(pending.promise)
    h.emit({ type: 'session/event', sessionId: 'a', event }, 'mux')
    h.client.dispose.mockImplementationOnce(() => pending.reject(new Error('Attachment request cancelled')))
    const next = h.next()
    next.client.attachment.mockResolvedValue({ attachment, data: 'aW1hZ2U=' })
    next.client.openSession.mockResolvedValue(opening as any)
    await h.controller.reconnect()
    expect(next.client.attachment).toHaveBeenCalledExactlyOnceWith('a', 'picture')
    await vi.waitFor(() => expect(h.controller.state.messages[0]?.images?.[0]?.data).toBe('aW1hZ2U='))
    expect(h.controller.state.messages[0]?.images?.[0]?.error).toBeUndefined()
  })

  it.each(['failed', 'cached'])('restores a previously %s image after reconnecting', async status => {
    const h = await harness()
    if (status === 'failed') h.client.attachment.mockRejectedValue(new Error('Network unavailable'))
    else h.client.attachment.mockResolvedValue({ attachment, data: 'aW1hZ2U=' })
    h.emit({ type: 'session/event', sessionId: 'a', event }, 'mux')
    await vi.waitFor(() => expect(h.controller.state.messages[0]?.images?.[0]).toMatchObject(
      status === 'failed' ? { error: 'Image unavailable.' } : { data: 'aW1hZ2U=' },
    ))
    const next = h.next()
    next.client.attachment.mockResolvedValue({ attachment, data: 'aW1hZ2U=' })
    next.client.openSession.mockResolvedValue(opening as any)
    await h.controller.reconnect()
    await vi.waitFor(() => expect(h.controller.state.messages[0]?.images?.[0]?.data).toBe('aW1hZ2U='))
    expect(h.controller.state.messages[0]?.images?.[0]?.error).toBeUndefined()
    expect(next.client.attachment).toHaveBeenCalledTimes(status === 'failed' ? 1 : 0)
  })

  it.each(['resolves', 'rejects'])('ignores an old image request that %s after its replacement starts', async outcome => {
    const h = await harness()
    const old = Promise.withResolvers<any>()
    h.client.attachment.mockReturnValue(old.promise)
    h.emit({ type: 'session/event', sessionId: 'a', event }, 'mux')
    const next = h.next()
    const fresh = Promise.withResolvers<any>()
    next.client.attachment.mockReturnValue(fresh.promise)
    next.client.openSession.mockResolvedValue(opening as any)
    await h.controller.reconnect()
    expect(next.client.attachment).toHaveBeenCalledTimes(1)
    if (outcome === 'resolves') old.resolve({ attachment, data: 'b2xk' })
    else old.reject(new Error('Old connection cancelled'))
    await new Promise<void>(resolve => setImmediate(resolve))
    next.emit({ type: 'session/event', sessionId: 'a', event: { type: 'user/message', seq: 2, time: 20,
      data: { id: 'new-prompt', source: { kind: 'user' }, content: [{ type: 'text', text: 'Another message' }] },
    } }, 'mux')
    expect(next.client.attachment).toHaveBeenCalledTimes(1)
    expect(h.controller.state.messages[0]?.images?.[0]?.data).toBeUndefined()
    expect(h.controller.state.messages[0]?.images?.[0]?.error).toBeUndefined()
    fresh.resolve({ attachment, data: 'aW1hZ2U=' })
    await vi.waitFor(() => expect(h.controller.state.messages[0]?.images?.[0]?.data).toBe('aW1hZ2U='))
  })
})

describe('sidebar discovery notifications', () => {
  it('shows pending background requests without moving focus or clearing them just by visiting', async () => {
    const h = await harness()
    const calls = h.client.openSession.mock.calls.length
    h.emit({ type: 'host/session-attention', sessionId: 'b', approvals: 2, questions: 1 })
    expect(h.controller.state).toMatchObject({ sessionId: 'a', approval: null, question: null })
    expect(h.client.openSession).toHaveBeenCalledTimes(calls)
    expect(h.controller.state.sessions.find(s => s.id === 'b')).toMatchObject({ attention: { approvals: 2, questions: 1 } })
    await h.controller.selectSession('b')
    expect(h.controller.state.sessions.find(s => s.id === 'b')?.attention).toEqual({ approvals: 2, questions: 1 })
    h.emit({ type: 'host/session-attention', sessionId: 'b', approvals: 0, questions: 1 })
    expect(h.controller.state.sessions.find(s => s.id === 'b')?.attention).toEqual({ approvals: 0, questions: 1 })
    h.emit({ type: 'host/session-attention', sessionId: 'b', approvals: 0, questions: 0 })
    expect(h.controller.state.sessions.find(s => s.id === 'b')?.attention).toBeUndefined()
    h.emit({ type: 'host/session-attention', sessionId: 'unknown-workspace', approvals: 1, questions: 0 })
    expect(h.controller.state.sessions.some(s => s.id === 'unknown-workspace')).toBe(false)
    await h.controller.start()
    expect(h.controller.state.sessions.every(s => s.attention === undefined)).toBe(true)
  })

  it('updates titles, activity and running state without displaying subagents or changing the conversation', async () => {
    const h = await harness()
    const calls = h.client.openSession.mock.calls.length
    const added = { type: 'host/session-added', cwd: '/workspace', updatedAt: 20, running: false, blank: false,
      projections: { asOfSeq: 3, values: { title: 'Background work' } } }
    h.emit({ ...added, sessionId: 'child', origin: 'subagent' })
    h.emit({ ...added, sessionId: 'foreign', cwd: '/elsewhere' })
    h.emit({ ...added, sessionId: 'new' })
    expect(h.controller.state.sessions.map(s => s.id)).toEqual(['new', 'a'])
    expect(h.controller.state.sessions[0]?.title).toBe('Background work')
    h.emit({ type: 'host/session-activity', sessionId: 'b', updatedAt: 30 })
    h.emit({ type: 'host/session-activity', sessionId: 'b', updatedAt: 5 })
    h.emit({ type: 'session/projection', sessionId: 'new', key: 'title', value: 'Renamed' }, 'mux')
    expect(h.controller.state.sessions.map(s => s.id)).toEqual(['b', 'new', 'a'])
    expect(h.controller.state.sessions.find(s => s.id === 'b')).toMatchObject({ blank: false, updatedAt: 30 })
    expect(h.controller.state.sessions.find(s => s.id === 'new')).toMatchObject({ title: 'Renamed', updatedAt: 20 })
    h.emit({ type: 'host/session-status', sessionId: 'new', running: true })
    h.emit({ type: 'host/session-attention', sessionId: 'new', approvals: 1, questions: 0 })
    h.emit({ type: 'host/session-removed', sessionId: 'new' })
    expect(h.controller.state.sessions.find(s => s.id === 'new')).toMatchObject({ running: false, unread: true, title: 'Renamed' })
    expect(h.controller.state.sessions.find(s => s.id === 'new')?.attention).toBeUndefined()
    h.emit({ ...added, sessionId: 'new', projections: { values: { title: 'Resumed' } } })
    expect(h.controller.state.sessions.filter(s => s.id === 'new')).toHaveLength(1)
    expect(h.controller.state.sessions.find(s => s.id === 'new')?.title).toBe('Resumed')
    expect(h.controller.state.sessionId).toBe('a')
    expect(h.client.openSession).toHaveBeenCalledTimes(calls)
  })

  it('clears disposed interactive controls without erasing the current transcript', async () => {
    const h = await harness()
    h.emit({ type: 'session/event', sessionId: 'a', event: { type: 'user/message', seq: 1, time: 30,
      data: { content: [{ type: 'text', text: 'Work' }] } } }, 'mux')
    const messages = h.controller.state.messages
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    h.emit({ type: 'approval/requested', sessionId: 'a', approvalId: 'pending', toolName: 'Write' }, 'mux')
    h.emit({ type: 'session/queue', sessionId: 'a', items: [{ id: 'q', placement: 'queued', message: { content: [{ type: 'text', text: 'Follow up' }] } }] }, 'mux')
    h.emit({ type: 'host/session-removed', sessionId: 'a' })
    expect(h.controller.state).toMatchObject({ sessionId: 'a', running: false, messages, approval: null, question: null, queue: [], jobs: [] })
    expect(h.controller.state.sessions.some(s => s.id === 'a')).toBe(true)
  })

  it('does not let a delayed list refresh reopen the conversation after an explicit selection', async () => {
    const h = await harness()
    const pending = Promise.withResolvers<any>()
    const list = await h.client.listSessions()
    h.client.listSessions.mockReturnValueOnce(pending.promise)
    h.emit({ type: 'host/archived-sessions-changed', archivedSessionIds: [] })
    await h.controller.selectSession('b')
    const calls = h.client.openSession.mock.calls.length
    pending.resolve(list)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.controller.state.sessionId).toBe('b')
    expect(h.client.openSession).toHaveBeenCalledTimes(calls)
  })

  it('preserves captured IDE context on queue edits and rejects stale or attachment-only edits', async () => {
    const h = await harness()
    const original = withIdeContext('Original', { activeFile: { kind: 'file', path: 'app.ts' }, pinned: [], mentions: [] })
    h.emit({ type: 'session/queue', sessionId: 'a', items: [
      { id: 'text', placement: 'queued', message: { content: [{ type: 'text', text: original }] } },
      { id: 'image', placement: 'queued', message: { content: [{ type: 'image', name: 'test.png' }] } },
      { id: 'steering', placement: 'steering', message: { content: [{ type: 'text', text: 'Already steering' }] } },
    ] }, 'mux')
    await h.controller.updateQueue('a', 'text', 'edit', 'Edited')
    expect(h.client.updateQueue).toHaveBeenLastCalledWith('a', 'text', {
      kind: 'edit', content: [{ type: 'text', text: original.replace('Original', 'Edited') }],
    })
    await expect(h.controller.updateQueue('a', 'image', 'edit', 'Replace image')).rejects.toThrow('attachments')
    await expect(h.controller.updateQueue('a', 'missing', 'remove')).rejects.toThrow('no longer queued')
    await expect(h.controller.updateQueue('a', 'steering', 'edit', 'Too late')).rejects.toThrow('no longer queued')
    await expect(h.controller.updateQueue('a', 'text', 'steer')).rejects.toThrow('only while')
    expect(h.client.updateQueue).toHaveBeenCalledTimes(1)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.updateQueue('a', 'text', 'steer')
    expect(h.client.updateQueue).toHaveBeenLastCalledWith('a', 'text', { kind: 'steer' })
    await h.controller.updateQueue('a', 'image', 'remove')
    expect(h.client.updateQueue).toHaveBeenLastCalledWith('a', 'image', { kind: 'remove' })
  })

  it('clears old interactive controls immediately and rejects old-session queue actions while loading or ready', async () => {
    const h = await harness()
    const items = [{ id: 'same-row', placement: 'queued', message: { content: [{ type: 'text', text: 'Original' }] } }]
    h.emit({ type: 'session/queue', sessionId: 'a', items }, 'mux')
    h.emit({ type: 'approval/requested', sessionId: 'a', approvalId: 'old', toolName: 'Write' }, 'mux')
    const loading = Promise.withResolvers<any>()
    h.client.openSession.mockReturnValueOnce(loading.promise)
    const switchSession = h.controller.selectSession('b')
    expect(h.controller.state).toMatchObject({ phase: 'loading', sessionId: 'b', queue: [], approval: null, question: null })
    await expect(h.controller.updateQueue('a', 'same-row', 'remove')).rejects.toThrow('conversation changed')
    await expect(h.controller.updateQueue('b', 'same-row', 'remove')).rejects.toThrow('conversation changed')
    loading.resolve({ events: [], hasMore: false, projections: {}, isCurrent: () => true, activate() {} })
    await switchSession
    h.emit({ type: 'session/queue', sessionId: 'b', items }, 'mux')
    await expect(h.controller.updateQueue('a', 'same-row', 'remove')).rejects.toThrow('conversation changed')
    expect(h.client.updateQueue).not.toHaveBeenCalled()
    await h.controller.updateQueue('b', 'same-row', 'remove')
    expect(h.client.updateQueue).toHaveBeenCalledExactlyOnceWith('b', 'same-row', { kind: 'remove' })
  })

  it('switches conversations while a load that never finishes is still in flight', async () => {
    const h = await harness()
    const stuck = Promise.withResolvers<any>()
    h.client.openSession.mockReturnValueOnce(stuck.promise)
    void h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.controller.state.phase).toBe('loading'))
    // That conversation is not going to open. The list is the way out of it, so
    // the second click must supersede the load instead of being refused for the
    // phase it left behind.
    await h.controller.selectSession('b')
    expect(h.controller.state).toMatchObject({ phase: 'ready', sessionId: 'b' })
    stuck.resolve({ events: [], hasMore: false, projections: {}, isCurrent: () => true, activate() {} })
  })

  it('accepts the new command attachment capability without enabling attachments on other commands', async () => {
    const h = await harness()
    const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'YWJj' }
    h.client.listCommands.mockResolvedValue([{ name: 'plan', description: '', input: { hint: '', attachments: true } }] as any)
    await h.controller.send('/plan inspect', [image])
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/plan inspect', [image])
    h.client.listCommands.mockResolvedValue([{ name: 'plan', description: '', input: { hint: '', attachments: false, images: true } }] as any)
    await expect(h.controller.send('/plan inspect', [image])).rejects.toThrow('does not accept image')
    expect(h.client.executeCommand).toHaveBeenCalledTimes(1)
  })

  it('publishes 0.1.5 live text without adding it to history and clears it at durable settlement', async () => {
    const h = await harness()
    const live = (update: unknown, sessionId = 'a') => h.emit({ type: 'session/assistant-stream', sessionId, update }, 'mux')
    live({ kind: 'start', attemptId: 'a:1', turn: 1, step: 1 })
    live({ kind: 'chunk', attemptId: 'a:1', chunk: { type: 'text-delta', text: 'Live text' } })
    expect(h.controller.state.messages).toMatchObject([{ text: 'Live text', streaming: true }])
    expect((h.controller as any).historyEntries).toEqual([])
    live({ kind: 'end', attemptId: 'a:1' }, 'b')
    expect(h.controller.state.messages[0]?.text).toBe('Live text')
    h.emit({ type: 'session/event', sessionId: 'a', event: {
      type: 'assistant/message', seq: 1, time: 10, surfaceOp: 'append',
      data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Final text' }] }, stream: [] },
    } }, 'mux')
    expect(h.controller.state.messages).toEqual([{ id: 'assistant:1:1', role: 'assistant', text: 'Final text' }])
    expect((h.controller as any).historyEntries).toHaveLength(1)
  })

  it('refreshes commands and models, while permissions and Plan only follow projections', async () => {
    const h = await harness()
    h.client.listCommands.mockResolvedValue([])
    h.emit({ type: 'host/commands-changed' })
    await vi.waitFor(() => expect(h.controller.state.commands).toEqual([]))
    expect(h.controller.state.plan.available).toBe(false)
    h.client.models.mockResolvedValue(models('new-model'))
    h.emit({ type: 'host/models-changed' })
    await vi.waitFor(() => expect(h.controller.state.models[0]?.model).toBe('new-model'))
    h.emit({ type: 'session/projection', sessionId: 'a', key: 'permissions', value: {
      currentValue: 'read-only', options: [{ value: 'read-only' }, { value: 'workspace-write' }],
    } }, 'mux')
    expect(h.controller.state.permissions[0]?.selected).toBe(true)
    h.emit({ type: 'session/projection', sessionId: 'b', key: 'plan', value: { active: true, pending: false } }, 'mux')
    expect(h.controller.state.plan.active).toBe(false)
    h.emit({ type: 'session/projection', sessionId: 'a', key: 'plan', value: { active: true, pending: false } }, 'mux')
    expect(h.controller.state.plan).toEqual({ active: true, pending: false, available: false })
  })

  it('ignores delayed discovery results across A → B → A switches', async () => {
    const h = await harness()
    const old = Promise.withResolvers<Array<{ name: string; description: string }>>()
    h.client.listCommands.mockReturnValueOnce(old.promise)
    h.emit({ type: 'host/commands-changed' })
    await h.controller.selectSession('b')
    h.client.listCommands.mockResolvedValue([{ name: 'current', description: '' }])
    await h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.controller.state.commands[0]?.name).toBe('current'))
    old.resolve([{ name: 'stale', description: '' }])
    await old.promise
    expect(h.controller.state.commands[0]?.name).toBe('current')
  })

  it('only refreshes the active composition and uses the projection for its selected preset', async () => {
    const h = await harness()
    const calls = h.client.listSkills.mock.calls.length
    h.emit({ type: 'host/session-composition-changed', sessionId: 'b' })
    expect(h.client.listSkills).toHaveBeenCalledTimes(calls)
    h.emit({ type: 'host/session-composition-changed', sessionId: 'a' })
    expect(h.controller.state.agentPreset.current).toBe('standard')
    h.emit({ type: 'session/projection', sessionId: 'a', key: 'agentPreset', value: 'minimal' }, 'mux')
    await vi.waitFor(() => expect(h.controller.state.agentPreset.current).toBe('minimal'))
    expect(h.client.listSkills.mock.calls.length).toBeGreaterThan(calls)
  })

  it('preserves the working sidebar after a background discovery failure and retries on the next notification', async () => {
    const h = await harness()
    h.client.models.mockRejectedValueOnce(new Error('temporary catalog failure'))
    h.emit({ type: 'host/settings-changed', ns: 'llm', revision: 2 })
    await vi.waitFor(() => expect(h.output.appendLine).toHaveBeenCalledWith(expect.stringContaining('temporary catalog failure')))
    expect(h.controller.state.phase).toBe('ready')
    expect(h.controller.state.models[0]?.model).toBe('model')
    // The picker names the provider, so the patch has to carry its display name
    // rather than the route id that only the runtime uses.
    expect(h.controller.state.models[0]?.providerLabel).toBe('Provider')
    h.client.models.mockResolvedValue(models('recovered'))
    h.emit({ type: 'host/models-changed' })
    await vi.waitFor(() => expect(h.controller.state.models[0]?.model).toBe('recovered'))
  })

  it('waits for a refreshed catalog before dispatching a newly added slash command', async () => {
    const h = await harness()
    const pending = Promise.withResolvers<Array<{ name: string; description: string }>>()
    h.client.listCommands.mockReturnValue(pending.promise)
    h.emit({ type: 'host/session-composition-changed', sessionId: 'a' })
    expect(h.controller.state.commands).toEqual([])
    const send = h.controller.send('/new-command')
    expect(h.client.prompt).not.toHaveBeenCalled()
    expect(h.client.executeCommand).not.toHaveBeenCalled()
    pending.resolve([{ name: 'new-command', description: '' }])
    await send
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/new-command', undefined)
    expect(h.client.prompt).not.toHaveBeenCalled()
  })

  it('routes from the latest catalog, preserving unknown slash text and skill input', async () => {
    const h = await harness()
    h.client.listCommands.mockResolvedValue([])
    await h.controller.send('/plan is plain text now')
    expect(h.client.prompt).toHaveBeenCalledWith('a', '/plan is plain text now', [], 'queue', undefined)
    expect(h.client.executeCommand).not.toHaveBeenCalled()
    h.client.listSkills.mockResolvedValue([{ name: 'review', description: '', modelInvocable: true }])
    const context = { activeFile: { kind: 'file' as const, path: 'code.ts' }, mentions: [], pinned: [] }
    await h.controller.send('/review code', [], context)
    expect(h.client.prompt).toHaveBeenLastCalledWith('a', '/review code', [], 'queue', undefined)
    h.client.listCommands.mockRejectedValue(new Error('catalog unavailable'))
    await expect(h.controller.send('/unknown')).rejects.toThrow('catalog unavailable')
    expect(h.client.prompt).toHaveBeenCalledTimes(2)
    await h.controller.send('hello')
    expect(h.client.prompt).toHaveBeenLastCalledWith('a', 'hello', [], 'queue', undefined)
  })

  it('does not dispatch a slash input after the conversation changed during discovery', async () => {
    const h = await harness()
    const pending = Promise.withResolvers<Array<{ name: string; description: string }>>()
    h.client.listCommands.mockReturnValueOnce(pending.promise)
    const send = h.controller.send('/plan')
    const rejected = expect(send).rejects.toThrow('conversation changed')
    await h.controller.selectSession('b')
    await h.controller.selectSession('a')
    pending.resolve([{ name: 'plan', description: '' }])
    await rejected
    expect(h.client.executeCommand).not.toHaveBeenCalled()
    expect(h.client.prompt).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'])('does not replace a newer projected preset after a delayed local %s', async outcome => {
    const h = await harness()
    const pending = Promise.withResolvers<{ agentPreset: string }>()
    h.client.selectAgentPreset.mockReturnValueOnce(pending.promise)
    const selection = h.controller.selectAgentPreset('minimal')
    const settled = selection.catch(error => error)
    h.emit({ type: 'session/projection', sessionId: 'a', key: 'agentPreset', value: 'minimal' }, 'mux')
    h.emit({ type: 'session/projection', sessionId: 'a', key: 'agentPreset', value: 'standard' }, 'mux')
    if (outcome === 'resolve') pending.resolve({ agentPreset: 'minimal' })
    else pending.reject(new Error('old operation failed'))
    await settled
    expect(h.controller.state.agentPreset.current).toBe('standard')
    expect(h.controller.state.agentPreset.busy).toBe(false)
  })

  it('notifies an open settings picker and refuses to save a draft into a replacement runtime', async () => {
    const h = await harness()
    const listener = vi.fn()
    h.controller.onDidChangeRuntimeSettings(listener)
    h.emit({ type: 'host/settings-changed', ns: 'test', revision: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
    h.emit({ type: 'host/credentials-changed' })
    expect(listener).toHaveBeenCalledTimes(2)
    const namespace = { ns: 'test', revision: 1 }
    h.client.settings.mockResolvedValue({ namespaces: [namespace] })
    const draft = (await h.controller.settings()).namespaces[0]!
    await h.controller.mutateSettings(draft, [])
    expect(h.client.mutateSettings).toHaveBeenCalledWith('test', [], 1)
    const replacement = { ...h.client, mutateSettings: vi.fn() }
    mocks.client = replacement
    await h.controller.start()
    expect(() => h.controller.mutateSettings(draft, [])).toThrow('runtime changed')
    expect(replacement.mutateSettings).not.toHaveBeenCalled()
  })

  it('rejects inventory results from a replaced runtime', async () => {
    const h = await harness()
    const pending = Promise.withResolvers<{ entries: [] }>()
    h.client.pluginInventory.mockReturnValueOnce(pending.promise)
    const inventory = h.controller.pluginInventory()
    const rejected = expect(inventory).rejects.toThrow('runtime changed')
    mocks.client = { ...h.client }
    await h.controller.start()
    pending.resolve({ entries: [] })
    await rejected
  })
})

describe('archived conversations and background jobs', () => {
  it('restores an archived conversation without stealing focus', async () => {
    const h = await harness()
    h.client.listSessions.mockResolvedValue({ items: [
      { sessionId: 'a', cwd: '/workspace', updatedAt: 5, blank: false, running: false, projections: { values: { title: 'Older work' } } },
      { sessionId: 'b', cwd: '/workspace', updatedAt: 9, blank: false, running: false, projections: { values: { title: 'Current work' } } },
    ] })
    h.client.unarchiveSession.mockResolvedValue({ archivedSessionIds: [] })
    // `workspace/follow` is authoritative: every reload re-reads the archive list.
    h.client.listWorkspaces.mockResolvedValue({ archivedSessionIds: ['a'] })

    h.emit({ type: 'host/archived-sessions-changed', archivedSessionIds: ['a'] })
    await vi.waitFor(() => expect(h.controller.state.archivedSessions).toHaveLength(1))
    expect(h.controller.state.archivedSessions[0]).toMatchObject({ id: 'a', title: 'Older work' })
    expect(h.controller.state.sessions.map(item => item.id)).toEqual(['b'])

    await h.controller.unarchiveSession('a')
    expect(h.client.unarchiveSession).toHaveBeenCalledWith('a')
    expect(h.controller.state.archivedSessions).toEqual([])
    expect(h.controller.state.sessions.map(item => item.id)).toEqual(['b', 'a'])
    expect(h.controller.state.sessionId).toBe('b')
  })

  it('leaves a conversation alone when it is not archived', async () => {
    const h = await harness()
    await h.controller.unarchiveSession('a')
    expect(h.client.unarchiveSession).not.toHaveBeenCalled()
  })

  it('stops only a live job that belongs to the visible session', async () => {
    const h = await harness()
    h.emit({ type: 'session/jobs', sessionId: 'a', jobs: [
      { id: 'live', kind: 'bash', label: 'npm test', status: 'running', startedAt: 1 },
      { id: 'settled', kind: 'bash', label: 'build', status: 'completed', startedAt: 2, finishedAt: 3 },
    ] }, 'mux')
    expect(h.controller.state.jobs.map(job => job.id)).toEqual(['live', 'settled'])

    await h.controller.killJob('a', 'settled')
    await h.controller.killJob('b', 'live')
    await h.controller.killJob('a', 'missing')
    expect(h.client.killJob).not.toHaveBeenCalled()

    await h.controller.killJob('a', 'live')
    expect(h.client.killJob).toHaveBeenCalledWith('a', 'live')
  })
})

/**
 * While a turn runs and sends nothing, the sidebar used to show no state at all,
 * so a quietly working model looked exactly like a dead one. The Webview renders
 * the clock; what it renders has to come from here, and the honest source is
 * what the sidebar witnessed rather than a turn start DSH never sends it.
 */
describe('the running-turn clock', () => {
  it('starts with the turn and refreshes on every frame of it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const h = await harness()
    await h.controller.selectSession('a')

    vi.setSystemTime(1_000_000)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    expect(h.controller.state).toMatchObject({ running: true, turnStartedAt: 1_000_000, turnActivityAt: 1_000_000 })

    // A frame is what proves the turn is alive: the clock must not move by
    // itself, or a stalled turn would keep looking healthy.
    vi.setSystemTime(1_045_000)
    h.emit({ type: 'session/event', sessionId: 'a', event: { type: 'user/message', seq: 1, time: 10,
      data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } } }, 'mux')
    expect(h.controller.state).toMatchObject({ turnStartedAt: 1_000_000, turnActivityAt: 1_045_000 })
  })

  it('keeps one start time for as long as the same turn runs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const h = await harness()
    await h.controller.selectSession('a')

    vi.setSystemTime(2_000_000)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    vi.setSystemTime(2_030_000)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    expect(h.controller.state.turnStartedAt).toBe(2_000_000)
  })

  it('leaves the clock alone while nothing is running', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const h = await harness()
    await h.controller.selectSession('a')

    vi.setSystemTime(3_000_000)
    h.emit({ type: 'session/event', sessionId: 'a', event: { type: 'user/message', seq: 1, time: 10,
      data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'typed' }] } } }, 'mux')
    expect(h.controller.state).toMatchObject({ running: false, turnStartedAt: 0, turnActivityAt: 0 })
  })

  it('drops the clock when the turn ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const h = await harness()
    await h.controller.selectSession('a')
    vi.setSystemTime(4_000_000)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    expect(h.controller.state.turnStartedAt).toBe(4_000_000)

    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    expect(h.controller.state).toMatchObject({ running: false, turnStartedAt: 0, turnActivityAt: 0 })
  })

  it('times the conversation on screen, not another one sending frames', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const h = await harness()
    await h.controller.selectSession('a')
    vi.setSystemTime(5_000_000)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })

    // A background conversation working is not this turn making progress.
    vi.setSystemTime(5_060_000)
    h.emit({ type: 'session/event', sessionId: 'b', event: { type: 'user/message', seq: 1, time: 10,
      data: { id: 'b1', source: { kind: 'user' }, content: [{ type: 'text', text: 'elsewhere' }] } } }, 'mux')
    expect(h.controller.state.turnActivityAt).toBe(5_000_000)

    await h.controller.selectSession('b')
    h.emit({ type: 'host/session-status', sessionId: 'b', running: true })
    expect(h.controller.state.turnStartedAt).toBe(5_060_000)
  })
})

describe('state that may not outlive its conversation or its connection', () => {
  it('stops showing the previous conversation’s turn when the next one will not open', async () => {
    const h = await harness()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    expect(h.controller.state.running).toBe(true)

    h.client.openSession.mockRejectedValueOnce(new Error('session "b" not found'))
    await expect(h.controller.selectSession('b')).rejects.toThrow()
    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.sessionId).toBe('b')
    // The state names 'b' now, so its running flags must describe 'b' — the clock
    // and the Stop button used to belong to the conversation it left.
    expect(h.controller.state.running).toBe(false)
    expect(h.controller.state.turnStartedAt).toBe(0)
  })

  it('releases a running turn when the event stream is lost', async () => {
    const h = await harness()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    h.fail(new DshStreamError('Invalid stream frame'))
    expect(h.controller.state.phase).toBe('error')
    expect(h.controller.state.running).toBe(false)
    // Nothing is observable, so an unfinished task must not keep blocking a
    // project or runtime switch until a reconnect happens to succeed.
    expect(h.controller.hasRunningTasks).toBe(false)
  })

  it('marks the conversation the failure came from, not the one on screen', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    expect(h.controller.state.sessionId).toBe('a')
    const held = new DshConnectionError('gateway/internal', 'session "b" is already owned by an active write handle')

    h.controller.report(held, 'b')
    // 'a' is writable: marking it here disabled a composer the user could use.
    expect(h.controller.state.occupancyNotice).toBeNull()

    h.controller.report(held, 'a')
    expect(h.controller.state.occupancyNotice).toContain('already in use')
  })

  it('logs a failed ratings read instead of rejecting into nothing', async () => {
    const h = await harness()
    h.client.messageFeedback.mockRejectedValueOnce(new DshConnectionError('transport-error', 'socket closed'))
    await h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.output.appendLine).toHaveBeenCalledWith(expect.stringContaining('[feedback]')))
  })

  it('reports a rating the runtime refuses, and does not reject the click', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    h.client.putMessageFeedback.mockRejectedValueOnce(new DshConnectionError('transport-error', 'socket closed'))
    await expect(h.controller.submitFeedback('a', 'm1', 'positive')).resolves.toBeUndefined()
    expect(h.output.appendLine).toHaveBeenCalledWith(expect.stringContaining('[chat]'))
  })

  it('does not revert another conversation after the user confirms an older request', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    const confirmation = Promise.withResolvers<string>()
    vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(confirmation.promise as never)
    const reverting = h.controller.revertFile('src/shared.ts', 1)
    await h.controller.selectSession('b')
    confirmation.resolve('Revert')
    await reverting
    expect(h.reviews.revertFile).not.toHaveBeenCalled()
  })

  it('does not revert all changes from a different conversation after confirmation', async () => {
    const h = await harness()
    h.reviews.rebuild.mockReturnValue([{ turn: 1, files: [{ path: 'src/shared.ts', additions: 1, deletions: 0, canRevert: true }] }])
    await h.controller.selectSession('a')
    const confirmation = Promise.withResolvers<string>()
    vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(confirmation.promise as never)
    const reverting = h.controller.revertAll()
    await h.controller.selectSession('b')
    confirmation.resolve('Revert All')
    await reverting
    expect(h.reviews.revertAll).not.toHaveBeenCalled()
  })

  it.each(['file', 'all'] as const)('still reverts %s when the confirmation target remains unchanged', async kind => {
    const h = await harness()
    h.reviews.rebuild.mockReturnValue([{ turn: 1, files: [{ path: 'src/shared.ts', additions: 1, deletions: 0, canRevert: true }] }])
    await h.controller.selectSession('a')
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce((kind === 'file' ? 'Revert' : 'Revert All') as never)
    if (kind === 'file') {
      await h.controller.revertFile('src/shared.ts', 1)
      expect(h.reviews.revertFile).toHaveBeenCalledWith('a', '/workspace', 'src/shared.ts', 1)
    } else {
      await h.controller.revertAll()
      expect(h.reviews.revertAll).toHaveBeenCalledWith('a')
    }
  })

  it('rejects a stale homepage origin before creating a conversation', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    await expect(h.controller.newSession({ cwd: '/elsewhere', sessionId: 'a' })).rejects.toThrow('project or conversation changed')
    expect(h.client.createSession).not.toHaveBeenCalled()
  })

  it('does not replace a later user selection when a homepage create finishes', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    const create = Promise.withResolvers<{ sessionId: string }>()
    h.client.createSession.mockReturnValueOnce(create.promise)
    const preparing = h.controller.newSession({ cwd: '/workspace', sessionId: 'a' })
    const rejected = expect(preparing).rejects.toThrow('changed before the new draft opened')
    await h.controller.selectSession('b')
    create.resolve({ sessionId: 'fresh' })
    await rejected
    expect(h.controller.state.sessionId).toBe('b')
    expect(h.client.prompt).not.toHaveBeenCalled()
  })

  it('prepares the requested homepage conversation without dispatching a prompt', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    const createdId = await h.controller.newSession({ cwd: '/workspace', sessionId: 'a' })
    expect(createdId).toBe('created')
    expect(h.controller.state).toMatchObject({ sessionId: 'created', phase: 'ready' })
    expect(h.client.prompt).not.toHaveBeenCalled()
  })

  it('opens the conversation it created even when another load started in the meantime', async () => {
    const h = await harness()
    await h.controller.selectSession('a')
    const create = Promise.withResolvers<{ sessionId: string }>()
    h.client.createSession.mockReturnValueOnce(create.promise)
    const creating = h.controller.newSession()
    await vi.waitFor(() => expect(h.client.createSession).toHaveBeenCalled())

    // A background list refresh (or a click) starts a load while the create is in
    // flight. A conversation with no messages earns no row of its own, so dropping
    // it left the user's click as a no-op and the conversation unreachable.
    const stuck = Promise.withResolvers<any>()
    h.client.openSession.mockReturnValueOnce(stuck.promise)
    void h.controller.selectSession('b')
    await vi.waitFor(() => expect(h.controller.state.phase).toBe('loading'))

    create.resolve({ sessionId: 'fresh' })
    await creating
    expect(h.controller.state.sessionId).toBe('fresh')
    expect(h.controller.state.phase).toBe('ready')
    stuck.resolve({ events: [], hasMore: false, projections: {}, isCurrent: () => true, activate() {} })
  })
})

describe('a command sent while a turn is running', () => {
  /** A conversation whose catalog offers /compact, the command that cannot run busy. */
  async function withCompact() {
    const h = await harness()
    h.client.listCommands.mockResolvedValue([{ name: 'compact', description: 'Compact older conversation history' }])
    await h.controller.selectSession('a')
    await vi.waitFor(() => expect(h.controller.state.commands.map(command => command.name)).toContain('compact'))
    return h
  }

  it('waits for the turn to finish, then runs it', async () => {
    const h = await withCompact()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.send('/compact', [], undefined, 'queue')

    // DSH executes a command immediately and `/compact` refuses while the agent is
    // busy, so running it here was a failed command node instead of a compaction.
    expect(h.client.executeCommand).not.toHaveBeenCalled()
    expect(h.controller.state.queuedCommands).toHaveLength(1)
    expect(h.controller.state.queuedCommands[0]).toMatchObject({ text: '/compact', preview: '/compact' })

    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/compact', undefined))
    expect(h.controller.state.queuedCommands).toEqual([])
  })

  it('runs immediately when the conversation is idle', async () => {
    const h = await withCompact()
    await h.controller.send('/compact')
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/compact', undefined)
    expect(h.controller.state.queuedCommands).toEqual([])
  })

  it('runs immediately when the send asked to steer', async () => {
    const h = await withCompact()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.send('/compact', [], undefined, 'steer')
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/compact', undefined)
    expect(h.controller.state.queuedCommands).toEqual([])
  })

  it('waits for a queued message to have its turn first', async () => {
    const h = await withCompact()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    h.emit({ type: 'session/queue', sessionId: 'a', items: [{ id: 'q1', placement: 'queued', message: { content: [{ type: 'text', text: 'later' }] } }] }, 'mux')
    await h.controller.send('/compact', [], undefined, 'queue')
    expect(h.controller.state.queuedCommands).toHaveLength(1)

    // That queued message starts the next turn: the held command must not cut in.
    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.client.executeCommand).not.toHaveBeenCalled()

    // Its turn ends, and now the command runs.
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    h.emit({ type: 'session/queue', sessionId: 'a', items: [] }, 'mux')
    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/compact', undefined))
  })

  it('runs a held command now, or drops it, from the dock', async () => {
    const h = await withCompact()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.send('/compact', [], undefined, 'queue')
    const held = h.controller.state.queuedCommands[0]!

    await h.controller.runQueuedCommand('a', held.id)
    expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/compact', undefined)
    expect(h.controller.state.queuedCommands).toEqual([])

    await h.controller.send('/compact', [], undefined, 'queue')
    const again = h.controller.state.queuedCommands[0]!
    h.controller.removeQueuedCommand('a', again.id)
    expect(h.controller.state.queuedCommands).toEqual([])
    expect(h.client.executeCommand).toHaveBeenCalledTimes(1)
  })

  it.each(['idle', 'manual'])('preserves image attachments in a command queued until %s execution', async execution => {
    const h = await harness()
    h.client.listCommands.mockResolvedValue([{ name: 'inspect', description: '', input: { images: true } }] as any)
    await h.controller.selectSession('a')
    const images = [{ type: 'image' as const, mediaType: 'image/png', data: 'aW1hZ2U=' }]
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.send('/inspect', images, undefined, 'queue')
    if (execution === 'manual') await h.controller.runQueuedCommand('a', h.controller.state.queuedCommands[0]!.id)
    else h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledWith('a', '/inspect', images))
  })

  it('keeps command arguments out of queue lifecycle logs', async () => {
    const h = await withCompact()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.send('/compact private draft text', [], undefined, 'queue')
    expect(h.output.appendLine.mock.calls.flat().join('\n')).not.toContain('private draft text')
  })

  it('executes queued commands serially when idle notifications overlap', async () => {
    const h = await withCompact()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.send('/compact first', [], undefined, 'queue')
    await h.controller.send('/compact second', [], undefined, 'queue')
    const first = Promise.withResolvers<any>()
    h.client.executeCommand.mockReturnValueOnce(first.promise)
    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledTimes(1))
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.client.executeCommand).toHaveBeenCalledTimes(1)
    first.resolve({ result: { kind: 'success' } })
    await vi.waitFor(() => expect(h.client.executeCommand).toHaveBeenCalledTimes(2))
    expect(h.client.executeCommand.mock.calls.map(call => call[1])).toEqual(['/compact first', '/compact second'])
  })

  it('removing a prior conversation command does not replace the visible queue', async () => {
    const h = await withCompact()
    h.emit({ type: 'host/session-status', sessionId: 'a', running: true })
    await h.controller.send('/compact', [], undefined, 'queue')
    const held = h.controller.state.queuedCommands[0]!
    await h.controller.selectSession('b')
    h.emit({ type: 'host/session-status', sessionId: 'b', running: true })
    await h.controller.send('/compact other', [], undefined, 'queue')
    h.controller.removeQueuedCommand('a', held.id)
    expect(h.controller.state.queuedCommands).toEqual([expect.objectContaining({ text: '/compact other' })])
  })
})

describe('parallel child actions and authoritative parent availability', () => {
  async function childHarness() {
    const h = await harness()
    h.emit({ type: 'host/session-added', sessionId: 'child', cwd: '/workspace', origin: 'subagent', parentSessionId: 'a', updatedAt: 1, blank: false, running: true })
    h.emit({ type: 'session/projection', sessionId: 'child', key: 'subagent', value: { mode: 'continuable', label: 'Audit', seq: 1 } }, 'mux')
    return h
  }
  it('sends to a child while the main conversation is loading without changing selection', async () => {
    const h = await childHarness(); h.controller.publish({ phase: 'loading' })
    await h.controller.sendToChild('child', 'Check more', 'steer')
    expect(h.client.prompt).toHaveBeenCalledWith('child', 'Check more', [], 'steer', 'a')
    expect(h.controller.state.sessionId).toBe('a')
  })
  it('blocks a child whose parent has been disposed but keeps Stop available', async () => {
    const h = await childHarness(); h.emit({ type: 'host/session-removed', sessionId: 'a' })
    await expect(h.controller.sendToChild('child', 'Continue')).rejects.toThrow('owning agent is unavailable')
    await h.controller.stopChild('child')
    expect(h.client.interruptSubagent).toHaveBeenCalledWith('child', 'a')
    h.emit({ type: 'host/session-status', sessionId: 'a', running: false })
    expect(h.controller.childReadOnlyReason('child')).toBeNull()
    await h.controller.sendToChild('child', 'Now continue')
    expect(h.client.prompt).toHaveBeenCalledWith('child', 'Now continue', [], 'queue', 'a')
  })
  it('validates child approval identity and exact question answers before responding', async () => {
    const h = await childHarness()
    h.client.pendingRequests.mockReturnValue([{ rpcId: 'q', event: 'user-questions/request', request: { questions: [{ id: 'one' }, { id: 'two' }] } }] as any)
    await expect(h.controller.answerTaskRequest('child', 'other', { answers: [] })).rejects.toThrow('no longer pending')
    await expect(h.controller.answerTaskRequest('child', 'q', { answers: [{ id: 'one', selected: [] }, { id: 'one', selected: [] }] })).rejects.toThrow('exactly one')
    await h.controller.answerTaskRequest('child', 'q', { answers: [{ id: 'one', selected: ['A'] }, { id: 'two', selected: [], custom: 'B' }] })
    expect(h.client.respond).toHaveBeenCalledWith('q', { sessionId: 'child', answer: { answers: [{ id: 'one', selected: ['A'] }, { id: 'two', selected: [], custom: 'B' }] } })
  })
  it('retains workflow member outcomes from durable conversation records', async () => {
    const h = await harness()
    h.emit({ type: 'session/event', sessionId: 'a', event: { seq: 1, time: 1, type: 'tool-workflow/run-start', data: { runId: 'w', name: 'Audit' } } }, 'mux')
    h.emit({ type: 'session/event', sessionId: 'a', event: { seq: 2, time: 2, type: 'tool-workflow/agent-start', data: { runId: 'w', seq: 1, childId: 'c', label: 'Verify', phase: 'Testing' } } }, 'mux')
    h.emit({ type: 'session/event', sessionId: 'a', event: { seq: 3, time: 3, type: 'tool-workflow/agent-end', data: { runId: 'w', seq: 1, outcome: 'success' } } }, 'mux')
    expect(h.controller.state.workflows[0]?.members[0]?.outcome).toBe('success')
  })
})
