import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeEditor: undefined as unknown,
  diagnostics: [] as Array<[unknown, unknown[]]>,
}))

vi.mock('vscode', () => ({
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  FileType: { File: 1, Directory: 2 },
  EventEmitter: class<T> {
    private readonly listeners = new Set<(value: T) => void>()
    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener)
      return { dispose: () => { this.listeners.delete(listener) } }
    }
    fire(value: T) { for (const listener of [...this.listeners]) listener(value) }
    dispose() { this.listeners.clear() }
  },
  RelativePattern: class { constructor(readonly base: unknown, readonly pattern: string) {} },
  Uri: { parse: (value: string) => ({ scheme: value.split(':')[0], fsPath: value.replace(/^file:\/\//, ''), toString: () => value }) },
  window: {
    get activeTextEditor() { return mocks.activeEditor },
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
  },
  workspace: {
    fs: { stat: vi.fn(async () => ({ type: 1 })) },
    findFiles: vi.fn(async () => []),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidCreateFiles: () => ({ dispose() {} }),
    onDidDeleteFiles: () => ({ dispose() {} }),
    onDidRenameFiles: () => ({ dispose() {} }),
  },
  languages: { getDiagnostics: () => mocks.diagnostics, onDidChangeDiagnostics: () => ({ dispose() {} }) },
}))

import { EditorContextBridge } from '../src/editor-context-bridge.js'

const CWD = '/workspace'

function bridge(sessionId: () => string) {
  return new EditorContextBridge(() => CWD, sessionId)
}

/** Builds a dropped-file URI the same way the extension parses one. */
function uri(path: string) {
  return { scheme: 'file', fsPath: path, toString: () => `file://${path}` }
}

beforeEach(() => {
  mocks.activeEditor = undefined
  mocks.diagnostics = []
})

describe('editor context pins', () => {
  it('pins a dropped file as a project-relative reference', async () => {
    const context = bridge(() => 'session-a')
    await expect(context.pinUri(uri('/workspace/src/app.ts') as never, CWD)).resolves.toBe(true)
    expect(context.viewState().pinned).toEqual([expect.objectContaining({ kind: 'file', path: 'src/app.ts' })])
  })

  it('refuses a drop outside the project instead of pinning a foreign path', async () => {
    const context = bridge(() => 'session-a')
    await expect(context.pinUri(uri('/elsewhere/report.pdf') as never, CWD)).resolves.toBe(false)
    expect(context.viewState().pinned).toEqual([])
  })

  it('keeps a dropped reference out of every other conversation', async () => {
    let sessionId = 'session-a'
    const context = bridge(() => sessionId)
    await context.pinUri(uri('/workspace/src/app.ts') as never, CWD)

    sessionId = 'session-b'
    expect(context.viewState().pinned).toEqual([])
    const snapshot = await context.snapshotForPrompt('hello')
    expect(snapshot.pinned).toEqual([])

    sessionId = 'session-a'
    expect(context.viewState().pinned).toEqual([expect.objectContaining({ path: 'src/app.ts' })])
  })

  it('clears only the sending conversation, leaving another session staged', async () => {
    let sessionId = 'session-a'
    const context = bridge(() => sessionId)
    await context.pinUri(uri('/workspace/a.ts') as never, CWD)
    sessionId = 'session-b'
    await context.pinUri(uri('/workspace/b.ts') as never, CWD)

    // Session A sends: only its own staged reference is consumed.
    sessionId = 'session-a'
    context.clearPinned()
    expect(context.viewState().pinned).toEqual([])

    sessionId = 'session-b'
    expect(context.viewState().pinned).toEqual([expect.objectContaining({ path: 'b.ts' })])
  })

  it('does not double-pin the same dropped resource twice in one conversation', async () => {
    const context = bridge(() => 'session-a')
    await context.pinUri(uri('/workspace/src/app.ts') as never, CWD)
    await context.pinUri(uri('/workspace/src/app.ts') as never, CWD)
    expect(context.viewState().pinned).toHaveLength(1)
  })

  it('carries a dropped editor range through to the prompt snapshot', async () => {
    const context = bridge(() => 'session-a')
    await context.pinUri(uri('/workspace/src/app.ts') as never, CWD, { startLine: 4, endLine: 9 })
    const snapshot = await context.snapshotForPrompt('explain this')
    expect(snapshot.pinned).toEqual([expect.objectContaining({ path: 'src/app.ts', startLine: 4, endLine: 9 })])
  })
})
