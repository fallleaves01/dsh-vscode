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
  Uri: { parse: (value: string) => ({ scheme: value.split(':')[0], fsPath: value.replace(/^file:\/\//, ''), toString: () => value }), file: (fsPath: string) => ({ scheme: 'file', fsPath, toString: () => 'file://' + fsPath }) },
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
import { hasIdeContext } from '../src/ide-context.js'
import * as vscode from 'vscode'

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
  vi.mocked(vscode.workspace.fs.stat).mockReset().mockResolvedValue({ type: 1 } as never)
  vi.mocked(vscode.workspace.findFiles).mockReset().mockResolvedValue([])
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

  it('offers the editor and selection as suggestions without including them in a prompt', async () => {
    const getText = vi.fn(() => 'code selected in the editor')
    mocks.activeEditor = {
      document: { uri: uri('/workspace/src/current.ts'), languageId: 'typescript', getText },
      selection: { isEmpty: false, start: { line: 3, character: 0 }, end: { line: 8, character: 0 } },
    }
    const context = bridge(() => 'session-a')
    expect(context.viewState()).toMatchObject({ sessionId: 'session-a', availableFile: { path: 'src/current.ts' }, availableSelection: { startLine: 4, endLine: 8 }, pinned: [] })
    const snapshot = await context.snapshotForPrompt('explain this project')
    expect(snapshot).toEqual({ pinned: [], mentions: [] })
    expect(hasIdeContext(snapshot)).toBe(false)
    expect(getText).not.toHaveBeenCalled()
    expect(vscode.workspace.findFiles).not.toHaveBeenCalled()
    expect(context.pinSelection()).toBe(true)
    expect((await context.snapshotForPrompt('explain selected code')).pinned).toEqual([expect.objectContaining({ kind: 'selection', text: 'code selected in the editor' })])
  })

  it('removing an explicitly added current file prevents it from returning on the next send', async () => {
    mocks.activeEditor = { document: { uri: uri('/workspace/src/current.ts'), languageId: 'typescript' }, selection: { isEmpty: true } }
    const context = bridge(() => 'session-a')
    expect(await context.pinPath('src/current.ts', 'session-a')).toBe(true)
    context.removePinned(context.viewState().pinned[0]!.id!)
    expect((await context.snapshotForPrompt('hello')).pinned).toEqual([])
    expect(context.viewState().pinned).toEqual([])
    expect(context.viewState().availableFile!.path).toBe('src/current.ts')
  })

  it('confines picker paths to the project and refuses a stale session add', async () => {
    const context = bridge(() => 'session-a')
    expect(await context.pinPath('../private.txt', 'session-a')).toBe(false)
    expect(await context.pinPath('/outside/private.txt', 'session-a')).toBe(false)
    expect(await context.pinPath('src/app.ts', 'session-b')).toBe(false)
    expect(vscode.workspace.fs.stat).not.toHaveBeenCalled()
  })

  it('does not duplicate concurrent additions and keeps the original session after stat awaits', async () => {
    let sessionId = 'session-a'
    let finish!: (value: never) => void
    const stat = new Promise<never>(resolve => { finish = resolve })
    vi.mocked(vscode.workspace.fs.stat).mockImplementation(() => stat)
    const context = bridge(() => sessionId)
    const first = context.pinPath('src/app.ts', 'session-a')
    const second = context.pinPath('src/app.ts', 'session-a')
    sessionId = 'session-b'; finish({ type: 1 } as never)
    await Promise.all([first, second])
    expect(context.viewState().pinned).toEqual([])
    sessionId = 'session-a'
    expect(context.viewState().pinned).toHaveLength(1)
  })

  it('consumes only references sent by that session, preserving later additions and other drafts', async () => {
    let sessionId = 'session-a'
    const context = bridge(() => sessionId)
    await context.pinPath('sent.ts', 'session-a')
    const snapshot = await context.snapshotForPrompt('check this')
    await context.pinPath('next.ts', 'session-a')
    sessionId = 'session-b'; await context.pinPath('other.ts', 'session-b')
    context.clearPinned('session-a', snapshot.pinned)
    expect(context.viewState().pinned.map(item => item.path)).toEqual(['other.ts'])
    sessionId = 'session-a'; expect(context.viewState().pinned.map(item => item.path)).toEqual(['next.ts'])
  })
})
