import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ panels: [] as any[], create: vi.fn(), warning: vi.fn(async () => 'Stop'), execute: vi.fn(), copy: vi.fn() }))
vi.mock('vscode', () => ({
  Uri: { joinPath: (_uri: unknown, ...parts: string[]) => ({ toString: () => parts.join('/') }), parse: (value: string) => value },
  ViewColumn: { Beside: 2 }, window: { createWebviewPanel: mocks.create, showWarningMessage: mocks.warning },
  commands: { executeCommand: mocks.execute }, env: { clipboard: { writeText: mocks.copy }, openExternal: vi.fn() },
}))
import { TaskPanelManager } from '../src/task-panels.js'
let manager: TaskPanelManager
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(55) }
const record = (seq: number, text = 'Child output') => ({ event: { seq, time: 1, type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } } } })
function fixture() {
  const observers: any[] = [], jobs: any[] = [], listeners = new Set<(state: any) => void>()
  const makeClient = () => ({
    watchRequests: vi.fn(), pendingRequests: vi.fn(() => []),
    observeSession: vi.fn((_id, _parent, emit, fail) => {
      const observer = { emit, fail, dispose: vi.fn(), page: vi.fn(async () => ({ events: [record(1, 'Earlier')], hasMore: false })),
        opening: Promise.resolve({ events: [record(5)], hasMore: true, projections: {}, isCurrent: () => true, activate: vi.fn() }) }
      observers.push(observer); return observer
    }),
    observeJob: vi.fn((_owner, _id, from, emit, fail) => { const watch = { from, emit, fail, cancel: vi.fn() }; jobs.push(watch); return watch.cancel }),
  })
  let client = makeClient()
  const state = { phase: 'ready', cwd: '/project', sessionId: 'parent', archivedSessions: [], sessions: [{ id: 'parent', title: 'Parent' }, { id: 'child', parentId: 'parent', subagent: { mode: 'continuable', label: 'Audit' }, title: 'Child', running: false }], projectJobs: [{ id: 'job', label: 'Build', sessionId: 'parent', kind: 'process', status: 'running', startedAt: 1 }] }
  const host = { state, taskClient: vi.fn((requireSelection = true) => { if (host.state.phase === 'error' || (requireSelection && host.state.phase !== 'ready')) throw new Error('Disconnected'); return client }),
    onDidChangeState: (listener: any) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) } },
    childReadOnlyReason: vi.fn(() => null), sendToChild: vi.fn(async () => {}), stopChild: vi.fn(async () => {}), answerTaskRequest: vi.fn(async () => {}),
    selectSession: vi.fn(async () => {}), killJob: vi.fn(async () => {}), openFile: vi.fn(),
  }
  const change = (patch: any) => { host.state = { ...host.state, ...patch }; for (const listener of listeners) listener(host.state) }
  const replace = () => { const previous = client; client = makeClient(); change({ phase: 'ready' }); return previous }
  manager = new TaskPanelManager(host as any, {} as any)
  return { host, observers, jobs, change, replace, get client() { return client } }
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.panels.length = 0; mocks.create.mockClear()
  mocks.create.mockImplementation(() => {
    let receive: (value: unknown) => void = () => {}, closed: () => void = () => {}
    const panel = { reveal: vi.fn(), dispose: vi.fn(() => closed()), onDidDispose: (listener: any) => { closed = listener; return { dispose() {} } },
      webview: { options: {}, html: '', cspSource: 'vscode-webview:', asWebviewUri: (uri: unknown) => uri, postMessage: vi.fn(async () => true),
        onDidReceiveMessage: (listener: any) => { receive = listener; return { dispose: () => { receive = () => {} } } } }, send: (value: unknown) => receive(value) }
    mocks.panels.push(panel); return panel
  })
})
afterEach(() => { manager?.dispose(); vi.useRealTimers() })
describe('independent task pane lifecycle', () => {
  it('reuses a pane by exact child address without selecting the main conversation', async () => {
    const h = fixture(); manager.open({ kind: 'subagent', sessionId: 'child' }); manager.open({ kind: 'subagent', sessionId: 'child' })
    mocks.panels[0].send({ type: 'ready' }); await flush()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.panels[0].reveal).toHaveBeenCalled()
    expect(h.host.selectSession).not.toHaveBeenCalled()
    expect(h.host.state.sessionId).toBe('parent')
    expect(h.client.observeSession).toHaveBeenCalledWith('child', 'parent', expect.any(Function), expect.any(Function))
    expect(h.client.watchRequests).toHaveBeenCalledWith('child')
    expect(mocks.panels[0].webview.postMessage.mock.calls.at(-1)[0].state.messages[0].text).toBe('Child output')
  })
  it('closes the observer and ignores later events when its pane is disposed', async () => {
    const h = fixture(); manager.open({ kind: 'subagent', sessionId: 'child' }); const panel = mocks.panels[0]; panel.send({ type: 'ready' }); await flush()
    const count = panel.webview.postMessage.mock.calls.length; panel.dispose()
    h.observers[0].emit({ payload: { type: 'session/event', event: record(6).event } }); await flush()
    expect(h.observers[0].dispose).toHaveBeenCalledTimes(1)
    expect(panel.webview.postMessage.mock.calls.length).toBe(count)
  })
  it('reconnects an observer without resending child messages', async () => {
    const h = fixture(); manager.open({ kind: 'subagent', sessionId: 'child' }); mocks.panels[0].send({ type: 'ready' }); await flush()
    h.change({ phase: 'error' }); await flush(); h.replace(); await flush()
    expect(h.observers[0].dispose).toHaveBeenCalledTimes(1)
    expect(h.observers).toHaveLength(2)
    expect(h.host.sendToChild).not.toHaveBeenCalled()
    expect(h.host.selectSession).not.toHaveBeenCalled()
  })
  it('fences old project output and prevents refresh from resubscribing in a different project', async () => {
    const h = fixture(); manager.open({ kind: 'subagent', sessionId: 'child' }); await flush()
    h.change({ cwd: '/other' }); mocks.panels[0].send({ type: 'refresh' }); await flush()
    expect(h.observers[0].dispose).toHaveBeenCalled()
    expect(h.observers).toHaveLength(1)
  })
  it('routes child follow-ups and approval answers without using the selected parent', async () => {
    const h = fixture(); manager.open({ kind: 'subagent', sessionId: 'child' }); await flush()
    mocks.panels[0].send({ type: 'send', text: 'Check more', mode: 'steer', requestId: 'r' })
    mocks.panels[0].send({ type: 'answer', rpcId: 'rpc', outcome: 'rejected' }); await flush()
    expect(h.host.sendToChild).toHaveBeenCalledWith('child', 'Check more', 'steer')
    expect(h.host.answerTaskRequest).toHaveBeenCalledWith('child', 'rpc', expect.objectContaining({ outcome: 'rejected' }))
    expect(mocks.panels[0].webview.postMessage).toHaveBeenCalledWith({ type: 'sent', requestId: 'r' })
  })
  it('paginates the child observer and preserves its live assistant prefix', async () => {
    const h = fixture(); manager.open({ kind: 'subagent', sessionId: 'child' }); const panel = mocks.panels[0]; panel.send({ type: 'ready' }); await flush()
    const emit = (update: any) => h.observers[0].emit({ payload: { type: 'session/assistant-stream', update } })
    emit({ kind: 'start', attemptId: 'live', turn: 2, step: 1 }); emit({ kind: 'chunk', attemptId: 'live', chunk: { type: 'text-delta', index: 0, text: 'Working' } })
    panel.send({ type: 'history' }); await flush()
    expect(h.observers[0].page).toHaveBeenCalledWith(5)
    const messages = panel.webview.postMessage.mock.calls.at(-1)[0].state.messages
    expect(messages.some((item: any) => item.text.includes('Earlier'))).toBe(true)
    expect(messages.some((item: any) => item.text === 'Working')).toBe(true)
  })
  it('resumes background output at its absolute cursor and releases watches on close', async () => {
    const h = fixture(); manager.open({ kind: 'job', sessionId: 'parent', jobId: 'job' }); const panel = mocks.panels[0]; panel.send({ type: 'ready' })
    h.jobs[0].emit({ type: 'opened', job: h.host.state.projectJobs[0], from: 0 }); h.jobs[0].emit({ type: 'output', chunks: [{ at: 1234, text: 'out', channel: 'stdout' }], next: 3 })
    await flush(); panel.send({ type: 'refresh' }); await flush()
    expect(h.jobs[0].cancel).toHaveBeenCalledTimes(1)
    expect(h.jobs[1].from).toBe(3)
    panel.dispose(); expect(h.jobs[1].cancel).toHaveBeenCalledTimes(1)
  })
  it('keeps an authoritative terminal status when an output stream ends', async () => {
    const h = fixture(); manager.open({ kind: 'job', sessionId: 'parent', jobId: 'job' }); const panel = mocks.panels[0]; panel.send({ type: 'ready' })
    const job = { ...h.host.state.projectJobs[0], status: 'completed' }
    h.jobs[0].emit({ type: 'opened', job, from: 0 }); h.jobs[0].fail(new Error('stream ended')); await flush()
    expect(panel.webview.postMessage.mock.calls.at(-1)[0].state.status).toBe('completed')
    expect(panel.webview.postMessage.mock.calls.at(-1)[0].state.error).toBeNull()
  })
})

it('keeps observing a child while the selected main chat changes', async () => {
  const h = fixture(); manager.open({ kind: 'subagent', sessionId: 'child' }); await flush()
  h.change({ phase: 'loading', sessionId: 'another' }); await flush()
  h.change({ phase: 'ready' }); await flush()
  expect(h.observers).toHaveLength(1)
  expect(h.observers[0].dispose).not.toHaveBeenCalled()
})

it('does not turn a terminal output status back into Running from a delayed catalog row', async () => {
  const h = fixture(); manager.open({ kind: 'job', sessionId: 'parent', jobId: 'job' }); const panel = mocks.panels[0]; panel.send({ type: 'ready' })
  h.jobs[0].emit({ type: 'opened', job: { ...h.host.state.projectJobs[0], status: 'completed' }, from: 0 }); h.change({}); await flush()
  expect(panel.webview.postMessage.mock.calls.at(-1)[0].state.running).toBe(false)
  expect(panel.webview.postMessage.mock.calls.at(-1)[0].state.status).toBe('completed')
  panel.send({ type: 'refresh' }); h.jobs[1].fail(new Error('Task no longer exists')); await flush()
  expect(panel.webview.postMessage.mock.calls.at(-1)[0].state.error).toContain('Task no longer exists')
})
