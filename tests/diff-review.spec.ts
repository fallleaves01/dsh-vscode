import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  textDocuments: [] as Array<{ isDirty: boolean; uri: { fsPath: string } }>,
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
  showQuickPick: vi.fn(),
  workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
  findPatterns: [] as string[],
}))

vi.mock('vscode', () => {
  class EventEmitter {
    event = (): { dispose(): void } => ({ dispose() {} })
    dispose(): void {}
  }
  return {
    EventEmitter,
    FileType: { File: 1, Directory: 2 },
    RelativePattern: class {
      readonly baseUri: { fsPath: string }
      constructor(base: string | { fsPath: string }, readonly pattern: string) {
        this.baseUri = typeof base === 'string' ? { fsPath: base } : base
      }
    },
    Range: class {
      constructor(readonly startLine: number, readonly startColumn: number, readonly endLine: number, readonly endColumn: number) {}
    },
    Uri: {
      from(value: { scheme: string; authority: string; path: string }) {
        return { ...value, toString: () => `${value.scheme}://${value.authority}${value.path}` }
      },
      file(filePath: string) {
        return { scheme: 'file', authority: '', path: filePath, fsPath: filePath, toString: () => `file://${filePath}` }
      },
    },
    commands: { executeCommand: mocks.executeCommand },
    workspace: {
      textDocuments: mocks.textDocuments,
      get workspaceFolders() { return mocks.workspaceFolders },
      fs: {
        async stat(uri: { fsPath: string }) {
          const stat = fs.statSync(uri.fsPath)
          return { type: stat.isDirectory() ? 2 : 1 }
        },
      },
      openTextDocument: mocks.openTextDocument,
      // The real search honours glob syntax, a base folder, and the reader's
      // file-excludes (undefined = the settings apply, which this mock models by
      // hiding `dist`). These tests need only the literal `**/<name>` shape the
      // sidebar asks for, resolved over a real directory tree.
      async findFiles(include: string | { baseUri: { fsPath: string }; pattern: string }, exclude?: unknown, maxResults?: number) {
        const pattern = typeof include === 'string' ? include : include.pattern
        mocks.findPatterns.push(pattern)
        const bases = typeof include === 'string'
          ? mocks.workspaceFolders.map(folder => folder.uri.fsPath)
          : [include.baseUri.fsPath]
        const hidden = exclude === undefined
          ? /[\\/](dist|\.git|node_modules)[\\/]/
          : /[\\/](\.git|node_modules)[\\/]/
        const wanted = pattern.replace(/^\*\*\//, '').replace(/\\(.)/g, '$1')
        const found: Array<{ fsPath: string }> = []
        const walk = (directory: string): void => {
          if (found.length >= (maxResults ?? 64)) return
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const child = path.join(directory, entry.name)
            if (entry.isDirectory()) walk(child)
            else if (child.endsWith(path.sep + wanted)) found.push({ fsPath: child })
            if (found.length >= (maxResults ?? 64)) return
          }
        }
        for (const base of bases) walk(base)
        return found.filter(entry => !hidden.test(entry.fsPath))
      },
    },
    window: {
      showInformationMessage: vi.fn(),
      showTextDocument: mocks.showTextDocument,
      showQuickPick: mocks.showQuickPick,
    },
  }
})

// S2: the write path is atomic (temp file + fsync + rename). These switches
// inject a failure at each step without touching the rest of the real fs module.
const fsFailure = vi.hoisted(() => ({ fsync: false, rename: false }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    fsyncSync: (...args: Parameters<typeof actual.fsyncSync>) => {
      if (fsFailure.fsync) { fsFailure.fsync = false; throw Object.assign(new Error('injected fsync failure'), { code: 'EIO' }) }
      return actual.fsyncSync(...args)
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsFailure.rename) { fsFailure.rename = false; throw Object.assign(new Error('injected rename failure'), { code: 'EIO' }) }
      return actual.renameSync(...args)
    },
  }
})

import type { DshEvent } from '../src/conversation.js'
import { DiffReviewManager } from '../src/diff-review.js'
import { appliedHunks } from '../src/tool-diff.js'

function event(type: string, seq: number, data: unknown): DshEvent {
  return { type, seq, time: seq, data }
}

describe('DiffReviewManager', () => {
  const temporaryDirectories: string[] = []

  beforeEach(() => {
    mocks.executeCommand.mockReset()
    mocks.textDocuments.splice(0)
    mocks.workspaceFolders.splice(0)
    mocks.findPatterns.splice(0)
    fsFailure.fsync = false
    fsFailure.rename = false
    mocks.showQuickPick.mockReset()
    mocks.showTextDocument.mockReset()
    mocks.openTextDocument.mockReset()
    mocks.openTextDocument.mockImplementation(async (uri: { fsPath: string }) => ({ uri, lineCount: 3 }))
  })
  afterEach(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

  function temporaryWorkspace(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vscode-diff-'))
    temporaryDirectories.push(directory)
    return directory
  }

  function modernEvents(name: 'edit' | 'write', args: Record<string, unknown>, before: string | null, after: string, turn = 1) {
    const callId = `modern-${turn}`
    const call = event('tool/call', turn * 10, { turn, callId, name, arguments: JSON.stringify(args) })
    const text = name === 'write'
      ? `<path>${args.file_path}</path>\n<type>file</type>\n<content>\n${before === null ? 'Created' : 'Updated'} file\n</content>`
      : `The file ${args.file_path} has been updated successfully.`
    const result = event('tool/result', turn * 10 + 1, { turn,
      meta: { diffs: before === null ? [] : appliedHunks(before, after)?.map(diff => ({ path: args.file_path, ...diff })) },
      message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }] }] },
    })
    return { call, result }
  }

  it('reviews and reverts rc.1 applied hunks, retaining complete snapshots across history rebuilds', async () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const before = 'context\nold\ncontext\n', after = 'context\nnew\ncontext\n'
    const { call, result } = modernEvents('edit', { file_path: 'app.ts', old_string: 'old', new_string: 'new' }, before, after)
    const manager = new DiffReviewManager()
    fs.writeFileSync(file, before)
    manager.accept('modern', cwd, call)
    fs.writeFileSync(file, after)
    expect(manager.accept('modern', cwd, result)).toBe(true)
    const expected = [{ turn: 1, files: [{ path: 'app.ts', additions: 1, deletions: 1, canRevert: true }] }]
    expect(manager.changedFiles('modern')).toEqual(expected)
    const entries = [call, result].map(event => ({ event }))
    expect(manager.rebuild('modern', cwd, entries)).toEqual(expected)
    expect(manager.prependHistory('modern', cwd, entries)).toEqual(expected)
    await manager.reviewFile('modern', cwd, 'app.ts', 1)
    const [, beforeUri, afterUri] = mocks.executeCommand.mock.calls.at(-1)!
    expect(manager.provideTextDocumentContent(beforeUri)).toBe(before)
    expect(manager.provideTextDocumentContent(afterUri)).toBe(after)
    expect(manager.revertFile('modern', cwd, 'app.ts', 1)).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  })

  it('captures the early assistant tool intent before the later tool/call notification', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const args = { file_path: 'app.ts', old_string: 'old', new_string: 'new' }
    const { call, result } = modernEvents('edit', args, 'old\n', 'new\n')
    const manager = new DiffReviewManager()
    fs.writeFileSync(file, 'old\n')
    manager.accept('early', cwd, event('assistant/message', 9, { turn: 1, message: { content: [
      { type: 'tool-call', id: 'modern-1', name: 'edit', arguments: JSON.stringify(args) },
    ] } }))
    fs.writeFileSync(file, 'new\n')
    manager.accept('early', cwd, call)
    manager.accept('early', cwd, result)
    expect(manager.changedFiles('early')[0]?.files[0]?.canRevert).toBe(true)
  })

  it('releases the text of a diff that was opened again', async () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const { call, result } = modernEvents('edit', { file_path: 'app.ts', old_string: 'old', new_string: 'new' }, 'old\n', 'new\n')
    const manager = new DiffReviewManager()
    fs.writeFileSync(file, 'old\n')
    manager.accept('modern', cwd, call)
    fs.writeFileSync(file, 'new\n')
    manager.accept('modern', cwd, result)

    await manager.reviewFile('modern', cwd, 'app.ts', 1)
    const [, firstBefore] = mocks.executeCommand.mock.calls.at(-1)!
    expect(manager.provideTextDocumentContent(firstBefore)).toBe('old\n')

    // Re-opening the same diff must not leave the previous pair behind: each
    // open used to keep up to two full snapshots until the runtime restarted.
    await manager.reviewFile('modern', cwd, 'app.ts', 1)
    const [, secondBefore, secondAfter] = mocks.executeCommand.mock.calls.at(-1)!
    expect(secondBefore.toString()).not.toBe(firstBefore.toString())
    expect(manager.provideTextDocumentContent(firstBefore)).toBe('')
    expect(manager.provideTextDocumentContent(secondBefore)).toBe('old\n')
    expect(manager.provideTextDocumentContent(secondAfter)).toBe('new\n')
  })

  it('still offers a later change to the same file in the same turn after a Keep', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const manager = new DiffReviewManager()
    const change = (seq: number, callId: string, before: string, after: string) => {
      const args = { file_path: 'app.ts', old_string: before.trim(), new_string: after.trim() }
      return {
        call: event('tool/call', seq, { turn: 5, callId, name: 'edit', arguments: JSON.stringify(args) }),
        result: event('tool/result', seq + 1, { turn: 5,
          meta: { diffs: appliedHunks(before, after)?.map(diff => ({ path: 'app.ts', ...diff })) },
          message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId,
            content: [{ type: 'text', text: 'The file app.ts has been updated successfully.' }] }] },
        }),
      }
    }

    fs.writeFileSync(file, 'one\n')
    const first = change(50, 'c1', 'one\n', 'two\n')
    manager.accept('s', cwd, first.call); fs.writeFileSync(file, 'two\n'); manager.accept('s', cwd, first.result)
    expect(manager.changedFiles('s')[0]?.files).toHaveLength(1)
    // The user keeps it. The agent then keeps working in the same turn.
    expect(manager.keepFile('s', cwd, 'app.ts', 5)).toEqual([])

    fs.writeFileSync(file, 'three\n')
    const second = change(60, 'c2', 'two\n', 'three\n')
    manager.accept('s', cwd, second.call); fs.writeFileSync(file, 'three\n'); manager.accept('s', cwd, second.result)
    // Keying the dismissal on `turn:path` hid this edit entirely: it was neither
    // shown nor revertable, although the file on disk had changed again.
    expect(manager.changedFiles('s')[0]?.files).toHaveLength(1)
  })

  it('does not invent a reversible full file from replayed hunks or a late snapshot', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const { call, result } = modernEvents('edit', { file_path: 'app.ts', old_string: 'old', new_string: 'new' }, 'old\n', 'new\n')
    fs.writeFileSync(file, 'new\n')
    for (const replay of [true, false]) {
      const manager = new DiffReviewManager()
      manager.accept('late', cwd, call, undefined, replay)
      manager.accept('late', cwd, result, undefined, replay)
      expect(manager.changedFiles('late')).toEqual([{ turn: 1, files: [{ path: 'app.ts', additions: 1, deletions: 1, canRevert: false }] }])
      expect(() => manager.revertAll('late')).toThrow('full snapshot')
      expect(fs.readFileSync(file, 'utf8')).toBe('new\n')
    }
  })

  it.each(['', 'one\ntwo\n'])('safely reverts an explicitly created rc.1 file containing %j', content => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'new.ts')
    const { call, result } = modernEvents('write', { file_path: 'new.ts', content }, null, content)
    const manager = new DiffReviewManager()
    manager.accept('create', cwd, call)
    fs.writeFileSync(file, content)
    manager.accept('create', cwd, result)
    expect(manager.changedFiles('create')[0]?.files[0]?.canRevert).toBe(true)
    manager.revertAll('create')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('rejects dirty buffers and subsequent user edits, while Keep leaves bytes untouched', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const { call, result } = modernEvents('write', { file_path: 'app.ts', content: 'new\n' }, 'old\n', 'new\n')
    const manager = new DiffReviewManager()
    fs.writeFileSync(file, 'old\n')
    manager.accept('dirty', cwd, call)
    fs.writeFileSync(file, 'new\n')
    manager.accept('dirty', cwd, result)
    mocks.textDocuments.push({ isDirty: true, uri: { fsPath: file } })
    expect(() => manager.revertAll('dirty')).toThrow('unsaved')
    mocks.textDocuments.splice(0)
    fs.writeFileSync(file, 'manual edit\n')
    expect(() => manager.revertAll('dirty')).toThrow('changed after DeepSeek')
    expect(manager.keepAll('dirty')).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe('manual edit\n')
  })

  it('ignores failed results, empty overwrite metadata, malformed metadata and opaque plugin metadata', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    for (const variant of ['failure', 'empty', 'malformed', 'plugin', 'wrong-path']) {
      const { call, result } = modernEvents('write', { file_path: 'app.ts', content: 'new\n' }, 'old\n', 'new\n')
      if (variant === 'failure') (result.data as any).error = { message: 'denied' }
      if (variant === 'empty') (result.data as any).meta = { diffs: [] }
      if (variant === 'malformed') (result.data as any).meta = { diffs: [null] }
      if (variant === 'plugin') (call.data as any).name = 'mcp__plugin__write'
      if (variant === 'wrong-path') (result.data as any).meta.diffs[0].path = 'other.ts'
      const manager = new DiffReviewManager()
      fs.writeFileSync(file, 'old\n')
      manager.accept(variant, cwd, call)
      fs.writeFileSync(file, 'new\n')
      manager.accept(variant, cwd, result)
      expect(manager.changedFiles(variant)).toEqual([])
    }
  })

  it('validates a continuous rc.1 multi-turn edit chain before Revert All', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const manager = new DiffReviewManager()
    let before = 'original\r\n'
    fs.writeFileSync(file, before)
    for (const turn of [1, 2]) {
      const after = `turn ${turn}\r\n`
      const { call, result } = modernEvents('write', { file_path: 'app.ts', content: after }, before, after, turn)
      manager.accept('series', cwd, call)
      fs.writeFileSync(file, after)
      manager.accept('series', cwd, result)
      before = after
    }
    expect(manager.changedFiles('series').map(group => group.files[0]?.canRevert)).toEqual([true, true])
    manager.revertAll('series')
    expect(fs.readFileSync(file, 'utf8')).toBe('original\r\n')
  })

  it('does not enable Revert for a binary or oversized captured file', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    for (const before of ['old\0bytes', 'x'.repeat(5 * 1024 * 1024 + 1)]) {
      const { call, result } = modernEvents('write', { file_path: 'app.ts', content: 'new\n' }, 'old\n', 'new\n')
      const manager = new DiffReviewManager()
      fs.writeFileSync(file, before)
      manager.accept('bounded', cwd, call)
      fs.writeFileSync(file, 'new\n')
      manager.accept('bounded', cwd, result)
      expect(manager.changedFiles('bounded')[0]?.files[0]?.canRevert).toBe(false)
      expect(() => manager.revertAll('bounded')).toThrow('full snapshot')
      expect(fs.readFileSync(file, 'utf8')).toBe('new\n')
    }
  })

  it.skipIf(process.platform === 'win32')('does not track symlink escapes or revert through a changed symlink target', () => {
    const cwd = temporaryWorkspace(), outside = temporaryWorkspace()
    fs.symlinkSync(outside, path.join(cwd, 'external'))
    const escaped = modernEvents('write', { file_path: 'external/new.ts', content: 'new\n' }, null, 'new\n')
    const manager = new DiffReviewManager()
    manager.accept('escape', cwd, escaped.call)
    fs.writeFileSync(path.join(outside, 'new.ts'), 'new\n')
    manager.accept('escape', cwd, escaped.result)
    expect(manager.changedFiles('escape')).toEqual([])

    const file = path.join(cwd, 'a.ts'), other = path.join(cwd, 'b.ts'), link = path.join(cwd, 'link.ts')
    fs.writeFileSync(file, 'old\n'); fs.writeFileSync(other, 'new\n'); fs.symlinkSync(file, link)
    const { call, result } = modernEvents('edit', { file_path: 'link.ts', old_string: 'old', new_string: 'new' }, 'old\n', 'new\n')
    manager.accept('link', cwd, call)
    fs.writeFileSync(file, 'new\n')
    manager.accept('link', cwd, result)
    fs.unlinkSync(link); fs.symlinkSync(other, link)
    expect(() => manager.revertAll('link')).toThrow('target changed')
    expect(fs.readFileSync(other, 'utf8')).toBe('new\n')
    expect(manager.rebuild('link', cwd, [call, result].map(event => ({ event })))[0]?.files[0]?.canRevert).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('refuses to revert through a symbolic link even when it is unchanged', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'a.ts'), link = path.join(cwd, 'link.ts')
    fs.writeFileSync(file, 'old\n')
    fs.symlinkSync(file, link)
    const { call, result } = modernEvents('write', { file_path: 'link.ts', content: 'new\n' }, 'old\n', 'new\n')
    const manager = new DiffReviewManager()
    manager.accept('unchanged-link', cwd, call)
    fs.writeFileSync(file, 'new\n')
    manager.accept('unchanged-link', cwd, result)
    expect(manager.changedFiles('unchanged-link')[0]?.files[0]?.canRevert).toBe(true)

    // The identity check alone would accept this link; the revert guard also
    // refuses to write through a symlink (S3-05).
    expect(() => manager.revertAll('unchanged-link')).toThrow('symbolic link')
    expect(fs.readFileSync(file, 'utf8')).toBe('new\n')
  })

  it.skipIf(process.platform === 'win32')('re-checks the revert target between validation and the write', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const { call, result } = modernEvents('write', { file_path: 'app.ts', content: 'new\n' }, 'old\n', 'new\n')
    const manager = new DiffReviewManager()
    fs.writeFileSync(file, 'old\n')
    manager.accept('toctou', cwd, call)
    fs.writeFileSync(file, 'new\n')
    manager.accept('toctou', cwd, result)

    // The production window is synchronous; the re-check is driven directly to
    // prove that a target replaced after validation is refused, not written.
    const review = (manager as unknown as { allReviews(sessionId: string): Array<Record<string, any>> }).allReviews('toctou')[0]!
    const content = (manager as unknown as { reviewContent(review: unknown): { before: string | null; after: string | null } }).reviewContent(review)
    const validate = manager as unknown as {
      validateCurrentFile(review: unknown, expected: string | null): unknown
      applyRevert(review: unknown, before: string | null, after: string | null, stamp: unknown): void
    }
    const stamp = validate.validateCurrentFile(review, content.after)
    // A new inode with the same bytes is a different file, not the reviewed one.
    fs.renameSync(file, file + '.replaced')
    fs.writeFileSync(file, content.after)
    expect(() => validate.applyRevert(review, content.before, content.after, stamp)).toThrow('changed after DeepSeek')

    // The same guard refuses a symlink that appeared in that window.
    fs.rmSync(file)
    const outside = temporaryWorkspace()
    fs.writeFileSync(path.join(outside, 'x.ts'), content.after)
    fs.symlinkSync(path.join(outside, 'x.ts'), file)
    expect(() => validate.applyRevert(review, content.before, content.after, stamp)).toThrow(/symbolic link|changed after DeepSeek/)
  })

  it.skipIf(process.platform === 'win32')('refuses to revert a file that other hard links share', () => {
    const cwd = temporaryWorkspace(), outside = temporaryWorkspace()
    const external = path.join(outside, 'shared.ts')
    fs.writeFileSync(external, 'old\n')
    // A hard link inside the project names the same inode as a file the project
    // does not own; writing through it would change that outside file (M4).
    const link = path.join(cwd, 'shared.ts')
    fs.linkSync(external, link)
    const { call, result } = modernEvents('write', { file_path: 'shared.ts', content: 'new\n' }, 'old\n', 'new\n')
    const manager = new DiffReviewManager()
    manager.accept('hard-link', cwd, call)
    fs.writeFileSync(link, 'new\n')
    manager.accept('hard-link', cwd, result)
    expect(manager.changedFiles('hard-link')[0]?.files[0]?.canRevert).toBe(true)

    expect(() => manager.revertAll('hard-link')).toThrow('hard link')
    expect(fs.readFileSync(link, 'utf8')).toBe('new\n')
    expect(fs.readFileSync(external, 'utf8')).toBe('new\n')
  })

  it('keeps the original bytes when the atomic revert write fails', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'app.ts')
    const { call, result } = modernEvents('write', { file_path: 'app.ts', content: 'new\n' }, 'old\n', 'new\n')
    const manager = new DiffReviewManager()
    fs.writeFileSync(file, 'old\n')
    manager.accept('atomic', cwd, call)
    fs.writeFileSync(file, 'new\n')
    manager.accept('atomic', cwd, result)
    const temporaryFiles = (): string[] => fs.readdirSync(cwd).filter(name => name.includes('.dsh-revert-'))

    // A failed fsync (the write step) leaves the reviewed file byte-for-byte
    // unchanged and removes the temporary file (S2).
    fsFailure.fsync = true
    expect(() => manager.revertAll('atomic')).toThrow('injected fsync failure')
    expect(fs.readFileSync(file, 'utf8')).toBe('new\n')
    expect(temporaryFiles()).toEqual([])

    // A failed rename has the same property: the original is never truncated.
    fsFailure.rename = true
    expect(() => manager.revertAll('atomic')).toThrow('injected rename failure')
    expect(fs.readFileSync(file, 'utf8')).toBe('new\n')
    expect(temporaryFiles()).toEqual([])

    // With no injected failure the same review reverts normally.
    expect(manager.revertAll('atomic')).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe('old\n')
    expect(temporaryFiles()).toEqual([])
  })

  it('rebuilds changed files from official DSH diff views and opens a native diff', async () => {
    const manager = new DiffReviewManager()
    const displayPath = path.join('src', 'app.ts')
    const changed = manager.rebuild('session-1', '/workspace', [
      {
        event: event('tool/call', 1, { turn: 1, step: 1, callId: 'call-1', name: 'edit', arguments: '{}' }),
        view: {
          for: 'call',
          view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'old', newText: 'new' }] },
        },
      },
      {
        event: event('tool/result', 2, {
          turn: 1,
          step: 1,
          message: {
            source: { kind: 'tool', callId: 'call-1' },
            content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false }],
          },
        }),
        view: {
          for: 'result',
          view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'old', newText: 'new' }] },
        },
      },
    ])

    expect(changed).toEqual([{ turn: 1, files: [{ path: displayPath, additions: 1, deletions: 1, canRevert: false }] }])
    await manager.reviewFile('session-1', '/workspace', 'src/app.ts')
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'dsh-diff', authority: 'before' }),
      expect.objectContaining({ scheme: 'dsh-diff', authority: 'after' }),
      `${displayPath} — DeepSeek changes (Turn 1)`,
      { preview: true },
    )
  })

  it('does not list a failed file edit as an applied change', () => {
    const manager = new DiffReviewManager()
    const changed = manager.rebuild('session-2', '/workspace', [
      {
        event: event('tool/call', 1, { callId: 'call-2', name: 'write', arguments: '{}' }),
        view: {
          for: 'call',
          view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: null, newText: 'new' }] },
        },
      },
      {
        event: event('tool/result', 2, {
          error: { code: 'FAILED' },
          message: {
            source: { kind: 'tool', callId: 'call-2' },
            content: [{ type: 'tool-result', toolCallId: 'call-2', isError: true }],
          },
        }),
      },
    ])

    expect(changed).toEqual([])
  })

  it('groups live changes by turn and safely reverts an unchanged file', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'src', 'app.ts')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'const value = 1\n')
    const manager = new DiffReviewManager()
    const call = event('tool/call', 1, { turn: 2, step: 1, callId: 'call-live', name: 'edit', arguments: '{}' })
    const result = event('tool/result', 2, {
      turn: 2,
      step: 1,
      message: { source: { kind: 'tool', callId: 'call-live' }, content: [{ type: 'tool-result', toolCallId: 'call-live', isError: false }] },
    })
    const callView = { for: 'call', view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'const value = 1', newText: 'const value = 2' }] } }
    const resultView = { for: 'result', view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'const value = 1', newText: 'const value = 2' }] } }

    manager.accept('session-live', cwd, call, callView)
    fs.writeFileSync(filePath, 'const value = 2\n')
    expect(manager.accept('session-live', cwd, result, resultView)).toBe(true)
    expect(manager.changedFiles('session-live')).toEqual([{
      turn: 2,
      files: [{ path: path.join('src', 'app.ts'), additions: 1, deletions: 1, canRevert: true }],
    }])

    expect(manager.revertFile('session-live', cwd, 'src/app.ts', 2)).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const value = 1\n')
  })

  it('treats differently cased aliases as the same file on a case-insensitive filesystem', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'CaseFile.ts')
    fs.writeFileSync(filePath, 'before\n')
    if (!fs.existsSync(path.join(cwd, 'casefile.ts'))) return
    const manager = new DiffReviewManager()
    const callId = 'case-insensitive-path'
    const call = event('tool/call', 1, { turn: 1, callId, name: 'edit' })
    const result = event('tool/result', 2, {
      turn: 1,
      message: { source: { kind: 'tool', callId }, content: [] },
    })
    const view = (forValue: 'call' | 'result', fileName: string) => ({
      for: forValue,
      view: { card: 'diff', diffs: [{ path: fileName, oldText: 'before', newText: 'after' }] },
    })

    manager.accept('session-case', cwd, call, view('call', 'CaseFile.ts'))
    fs.writeFileSync(filePath, 'after\n')
    expect(manager.accept('session-case', cwd, result, view('result', 'casefile.ts'))).toBe(true)
    expect(manager.changedFiles('session-case')).toEqual([{
      turn: 1,
      files: [{ path: 'CaseFile.ts', additions: 1, deletions: 1, canRevert: true }],
    }])
    expect(manager.revertFile('session-case', cwd, 'casefile.ts', 1)).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('before\n')
  })

  it('keeps differently cased files separate on a case-sensitive filesystem', () => {
    const cwd = temporaryWorkspace()
    const upperPath = path.join(cwd, 'App.ts')
    const lowerPath = path.join(cwd, 'app.ts')
    fs.writeFileSync(upperPath, 'upper-before\n')
    fs.writeFileSync(lowerPath, 'lower-before\n')
    if (fs.readFileSync(upperPath, 'utf8') !== 'upper-before\n') return

    const manager = new DiffReviewManager()
    const callId = 'case-sensitive-paths'
    const diffs = [
      { path: 'App.ts', oldText: 'upper-before', newText: 'upper-after' },
      { path: 'app.ts', oldText: 'lower-before', newText: 'lower-after' },
    ]
    manager.accept(
      'session-sensitive',
      cwd,
      event('tool/call', 1, { turn: 1, callId, name: 'edit' }),
      { for: 'call', view: { card: 'diff', diffs } },
    )
    fs.writeFileSync(upperPath, 'upper-after\n')
    fs.writeFileSync(lowerPath, 'lower-after\n')
    expect(manager.accept(
      'session-sensitive',
      cwd,
      event('tool/result', 2, { turn: 1, message: { source: { kind: 'tool', callId }, content: [] } }),
      { for: 'result', view: { card: 'diff', diffs } },
    )).toBe(true)

    expect(manager.changedFiles('session-sensitive')).toEqual([{
      turn: 1,
      files: [
        { path: 'App.ts', additions: 1, deletions: 1, canRevert: true },
        { path: 'app.ts', additions: 1, deletions: 1, canRevert: true },
      ],
    }])
    expect(manager.revertAll('session-sensitive')).toEqual([])
    expect(fs.readFileSync(upperPath, 'utf8')).toBe('upper-before\n')
    expect(fs.readFileSync(lowerPath, 'utf8')).toBe('lower-before\n')
  })

  it('prepends older review history without losing reversible live snapshots', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'current.ts')
    fs.writeFileSync(filePath, 'before\n')
    const manager = new DiffReviewManager()
    const liveCall = event('tool/call', 20, { turn: 2, callId: 'live', name: 'edit' })
    const liveResult = event('tool/result', 21, {
      turn: 2,
      message: { source: { kind: 'tool', callId: 'live' }, content: [{ type: 'tool-result', toolCallId: 'live' }] },
    })
    const liveCallView = { for: 'call', view: { card: 'diff', diffs: [{ path: 'current.ts', oldText: 'before', newText: 'after' }] } }
    const liveResultView = { for: 'result', view: { card: 'diff', diffs: [{ path: 'current.ts', oldText: 'before', newText: 'after' }] } }
    manager.accept('session-pages', cwd, liveCall, liveCallView)
    fs.writeFileSync(filePath, 'after\n')
    manager.accept('session-pages', cwd, liveResult, liveResultView)

    const changed = manager.prependHistory('session-pages', cwd, [
      {
        event: event('tool/call', 1, { turn: 1, callId: 'older', name: 'write' }),
        view: { for: 'call', view: { card: 'diff', diffs: [{ path: 'old.ts', oldText: null, newText: 'old' }] } },
      },
      {
        event: event('tool/result', 2, {
          turn: 1,
          message: { source: { kind: 'tool', callId: 'older' }, content: [{ type: 'tool-result', toolCallId: 'older' }] },
        }),
        view: { for: 'result', view: { card: 'diff', diffs: [{ path: 'old.ts', oldText: null, newText: 'old' }] } },
      },
    ])

    expect(changed.find(group => group.turn === 2)?.files[0]?.canRevert).toBe(true)
    expect(changed.find(group => group.turn === 1)?.files[0]?.canRevert).toBe(false)
  })

  it('refuses to overwrite a file changed after DeepSeek edited it', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'app.ts')
    fs.writeFileSync(filePath, 'before\n')
    const manager = new DiffReviewManager()
    const call = event('tool/call', 1, { turn: 3, step: 1, callId: 'call-conflict', name: 'edit', arguments: '{}' })
    const result = event('tool/result', 2, {
      turn: 3,
      step: 1,
      message: { source: { kind: 'tool', callId: 'call-conflict' }, content: [{ type: 'tool-result', toolCallId: 'call-conflict', isError: false }] },
    })
    const view = (forValue: 'call' | 'result') => ({ for: forValue, view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: 'before', newText: 'after' }] } })
    manager.accept('session-conflict', cwd, call, view('call'))
    fs.writeFileSync(filePath, 'after\n')
    manager.accept('session-conflict', cwd, result, view('result'))
    mocks.textDocuments.push({ isDirty: true, uri: { fsPath: filePath } })
    expect(() => manager.revertFile('session-conflict', cwd, 'app.ts', 3)).toThrow('unsaved VS Code changes')
    mocks.textDocuments.splice(0)
    fs.writeFileSync(filePath, 'user edit\n')

    expect(() => manager.revertFile('session-conflict', cwd, 'app.ts', 3)).toThrow('the file changed after DeepSeek edited it')
    expect(fs.readFileSync(filePath, 'utf8')).toBe('user edit\n')
    expect(manager.changedFiles('session-conflict')).toHaveLength(1)
  })

  it('reverts a continuous chain of changes across turns', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'app.ts')
    fs.writeFileSync(filePath, 'one')
    const manager = new DiffReviewManager()
    const apply = (turn: number, before: string, after: string) => {
      const callId = `call-${String(turn)}`
      const call = event('tool/call', turn * 2, { turn, step: 1, callId, name: 'edit', arguments: '{}' })
      const result = event('tool/result', turn * 2 + 1, { turn, step: 1, message: { source: { kind: 'tool', callId }, content: [] } })
      const view = (forValue: 'call' | 'result') => ({ for: forValue, view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: before, newText: after }] } })
      manager.accept('session-chain', cwd, call, view('call'))
      fs.writeFileSync(filePath, after)
      manager.accept('session-chain', cwd, result, view('result'))
    }
    apply(1, 'one', 'two')
    apply(2, 'two', 'three')

    expect(manager.changedFiles('session-chain').map(group => group.turn)).toEqual([2, 1])
    expect(manager.revertAll('session-chain')).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('one')
  })

  it('validates every file before reverting all changes', () => {
    const cwd = temporaryWorkspace()
    const firstPath = path.join(cwd, 'first.ts')
    const secondPath = path.join(cwd, 'second.ts')
    fs.writeFileSync(firstPath, 'first-before')
    fs.writeFileSync(secondPath, 'second-before')
    const manager = new DiffReviewManager()
    const diffs = [
      { path: 'first.ts', oldText: 'first-before', newText: 'first-after' },
      { path: 'second.ts', oldText: 'second-before', newText: 'second-after' },
    ]
    manager.accept('session-atomic', cwd, event('tool/call', 1, { turn: 1, step: 1, callId: 'call-atomic', name: 'edit', arguments: '{}' }), { for: 'call', view: { card: 'diff', diffs } })
    fs.writeFileSync(firstPath, 'first-after')
    fs.writeFileSync(secondPath, 'second-after')
    manager.accept('session-atomic', cwd, event('tool/result', 2, { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'call-atomic' }, content: [] } }), { for: 'result', view: { card: 'diff', diffs } })
    fs.writeFileSync(secondPath, 'user-edit')

    expect(() => manager.revertAll('session-atomic')).toThrow('the file changed after DeepSeek edited it')
    expect(fs.readFileSync(firstPath, 'utf8')).toBe('first-after')
    expect(fs.readFileSync(secondPath, 'utf8')).toBe('user-edit')
  })

  it('keeps a reviewed change without touching the file', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'app.ts')
    fs.writeFileSync(filePath, 'before')
    const manager = new DiffReviewManager()
    const call = event('tool/call', 1, { turn: 4, step: 1, callId: 'call-keep', name: 'edit', arguments: '{}' })
    const result = event('tool/result', 2, { turn: 4, step: 1, message: { source: { kind: 'tool', callId: 'call-keep' }, content: [] } })
    const view = (forValue: 'call' | 'result') => ({ for: forValue, view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: 'before', newText: 'after' }] } })
    manager.accept('session-keep', cwd, call, view('call'))
    fs.writeFileSync(filePath, 'after')
    manager.accept('session-keep', cwd, result, view('result'))

    expect(manager.keepFile('session-keep', cwd, 'app.ts', 4)).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('after')
  })

  describe('opening a file a reply named', () => {
    /** A reply that names a file the way DSH writes it: often just the basename. */
    async function opened(): Promise<string[]> {
      return mocks.showTextDocument.mock.calls.map(call => (call[0] as { uri: { fsPath: string } }).uri.fsPath)
    }

    it('opens a project-relative path at the requested line', async () => {
      const cwd = temporaryWorkspace()
      fs.writeFileSync(path.join(cwd, 'app.ts'), 'one\ntwo\nthree')
      const manager = new DiffReviewManager()

      await manager.openFile(cwd, 'app.ts', 2)

      expect(mocks.showTextDocument).toHaveBeenCalledTimes(1)
      expect((mocks.showTextDocument.mock.calls[0]![1] as { selection: { startLine: number } }).selection.startLine).toBe(1)
    })

    it('finds a file the reply named by basename alone, the way a kernel tree is linked', async () => {
      const cwd = temporaryWorkspace()
      const nested = path.join(cwd, 'csrc', 'kernels')
      fs.mkdirSync(nested, { recursive: true })
      fs.writeFileSync(path.join(nested, 'rdma.cuh'), 'kernel')
      mocks.workspaceFolders.push({ uri: { fsPath: cwd } })
      const manager = new DiffReviewManager()

      await manager.openFile(cwd, 'rdma.cuh')

      expect(await opened()).toEqual([path.join(cwd, 'csrc', 'kernels', 'rdma.cuh')])
    })

    it('falls back to the window\'s own folders when there is no project to resolve against', async () => {
      const folder = temporaryWorkspace()
      fs.mkdirSync(path.join(folder, 'csrc'))
      fs.writeFileSync(path.join(folder, 'csrc', 'hybrid.cuh'), 'kernel')
      mocks.workspaceFolders.push({ uri: { fsPath: folder } })
      const manager = new DiffReviewManager()

      await manager.openFile('', path.join('csrc', 'hybrid.cuh'))

      expect(await opened()).toEqual([path.join(folder, 'csrc', 'hybrid.cuh')])
    })

    it('opens the row the reader picked when two folders spell it the same way', async () => {
      const first = temporaryWorkspace()
      const second = temporaryWorkspace()
      for (const folder of [first, second]) {
        fs.mkdirSync(path.join(folder, 'src'))
        fs.writeFileSync(path.join(folder, 'src', 'index.ts'), 'export {}')
      }
      mocks.workspaceFolders.push({ uri: { fsPath: first } }, { uri: { fsPath: second } })
      const manager = new DiffReviewManager()

      mocks.showQuickPick.mockResolvedValueOnce(undefined)
      await manager.openFile('', 'index.ts')
      const offered = mocks.showQuickPick.mock.calls[0]![0] as Array<{ label: string; detail: string }>
      expect(offered.map(item => item.label)).toEqual([path.join('src', 'index.ts'), path.join('src', 'index.ts')])

      // The labels are indistinguishable, so the answer has to be the row itself.
      mocks.showQuickPick.mockResolvedValueOnce(offered[0])
      await manager.openFile('', 'index.ts')
      expect(await opened()).toEqual([offered[0]!.detail])
    })

    it('refuses a path the reply spelled above the project', async () => {
      const parent = temporaryWorkspace()
      const cwd = path.join(parent, 'project')
      fs.mkdirSync(cwd)
      fs.writeFileSync(path.join(parent, 'shared.cuh'), 'kernel')
      const manager = new DiffReviewManager()

      // The click is a read, but it stays inside the project it belongs to:
      // a spelling that climbs above the root must not reach a file there.
      await expect(manager.openFile(cwd, path.join('..', 'shared.cuh'))).rejects.toThrow('outside this project')
      expect(await opened()).toEqual([])
    })

    it('reads a leading slash as the project root, not as an absolute path', async () => {
      const cwd = temporaryWorkspace()
      fs.mkdirSync(path.join(cwd, 'csrc', 'kernels'), { recursive: true })
      fs.writeFileSync(path.join(cwd, 'csrc', 'kernels', 'rdma.cuh'), 'kernel')
      mocks.workspaceFolders.push({ uri: { fsPath: cwd } })
      const manager = new DiffReviewManager()

      // Models spell a project path from the root with a leading slash, which is
      // not where the project lives on this machine.
      await manager.openFile(cwd, '/csrc/kernels/rdma.cuh')

      expect(await opened()).toEqual([path.join(cwd, 'csrc', 'kernels', 'rdma.cuh')])
    })

    it('looks past the reader\'s own file-excludes, so a built file is still openable', async () => {
      const cwd = temporaryWorkspace()
      fs.mkdirSync(path.join(cwd, 'dist'))
      fs.writeFileSync(path.join(cwd, 'dist', 'extension.js'), 'bundle')
      mocks.workspaceFolders.push({ uri: { fsPath: cwd } })
      const manager = new DiffReviewManager()

      await manager.openFile(cwd, 'extension.js')

      expect(await opened()).toEqual([path.join(cwd, 'dist', 'extension.js')])
    })

    it('searches the conversation\'s own project, not another open folder\'s copy of the name', async () => {
      const cwd = temporaryWorkspace()
      const other = temporaryWorkspace()
      fs.mkdirSync(path.join(cwd, 'vendor'))
      fs.writeFileSync(path.join(cwd, 'vendor', 'chunk.cuh'), 'ours')
      fs.writeFileSync(path.join(other, 'chunk.cuh'), 'theirs, and shallower')
      mocks.workspaceFolders.push({ uri: { fsPath: cwd } }, { uri: { fsPath: other } })
      const manager = new DiffReviewManager()

      // The model wrote its path relative to the project it runs in, so a
      // same-named file in another folder of the window is not its file.
      await manager.openFile(cwd, 'chunk.cuh')

      expect(await opened()).toEqual([path.join(cwd, 'vendor', 'chunk.cuh')])
      expect(mocks.showQuickPick).not.toHaveBeenCalled()
    })

    it('looks up a name that glob syntax would otherwise read as a pattern', async () => {
      const cwd = temporaryWorkspace()
      fs.mkdirSync(path.join(cwd, 'vendor'))
      fs.writeFileSync(path.join(cwd, 'vendor', 'weird[1].ts'), 'generated')
      mocks.workspaceFolders.push({ uri: { fsPath: cwd } })
      const manager = new DiffReviewManager()

      await manager.openFile(cwd, 'weird[1].ts')

      // The name is escaped, so the search looks for a file rather than for
      // `weird1.ts` or for nothing at all.
      expect(mocks.findPatterns).toEqual(['**/weird\\[1\\].ts'])
      expect(await opened()).toEqual([path.join(cwd, 'vendor', 'weird[1].ts')])
    })

    it('asks which file when the name is ambiguous, and opens nothing when the picker is dismissed', async () => {
      const cwd = temporaryWorkspace()
      for (const directory of ['kernels', 'csrc/kernels']) {
        fs.mkdirSync(path.join(cwd, directory), { recursive: true })
        fs.writeFileSync(path.join(cwd, directory, 'reduce_scatter.hpp'), 'kernel')
      }
      mocks.workspaceFolders.push({ uri: { fsPath: cwd } })
      const manager = new DiffReviewManager()

      mocks.showQuickPick.mockResolvedValueOnce(undefined)
      await manager.openFile(cwd, 'reduce_scatter.hpp')
      expect(mocks.showQuickPick).toHaveBeenCalledTimes(1)
      expect(mocks.showTextDocument).not.toHaveBeenCalled()

      // The shallowest match is offered first, and each entry leads with the
      // project-relative path, which is the part that tells them apart.
      const offered = mocks.showQuickPick.mock.calls[0]![0] as Array<{ label: string }>
      expect(offered.map(item => item.label)).toEqual([
        path.join('kernels', 'reduce_scatter.hpp'),
        path.join('csrc', 'kernels', 'reduce_scatter.hpp'),
      ])
      mocks.showQuickPick.mockResolvedValueOnce(offered[1])
      await manager.openFile(cwd, 'reduce_scatter.hpp')
      expect(await opened()).toEqual([path.join(cwd, 'csrc', 'kernels', 'reduce_scatter.hpp')])
    })

    it('refuses an absolute path outside the project and a home-directory spelling', async () => {
      const cwd = temporaryWorkspace()
      const outside = temporaryWorkspace()
      const file = path.join(outside, 'passwd')
      fs.writeFileSync(file, 'secret')
      const manager = new DiffReviewManager()

      const notes = path.join(outside, 'notes.md')
      fs.writeFileSync(notes, 'notes')
      await expect(manager.openFile(cwd, file)).rejects.toThrow('outside this project')
      await expect(manager.openFile(cwd, notes)).rejects.toThrow('outside this project')
      // `~` names the home directory, which is outside every project root;
      // expanding it would only produce a path the containment check refuses.
      await expect(manager.openFile(cwd, '~/dsh-open-file-spec.tmp')).rejects.toThrow('outside this project')
      expect(await opened()).toEqual([])
    })

    it('opens an absolute path that is inside the project', async () => {
      const cwd = temporaryWorkspace()
      const file = path.join(cwd, 'src', 'app.ts')
      fs.mkdirSync(path.dirname(file))
      fs.writeFileSync(file, 'export {}')
      const manager = new DiffReviewManager()

      await manager.openFile(cwd, file)

      expect(await opened()).toEqual([file])
    })

    it.skipIf(process.platform === 'win32')('refuses a link whose physical target is outside the project', async () => {
      const cwd = temporaryWorkspace(), outside = temporaryWorkspace()
      fs.writeFileSync(path.join(outside, 'secret.md'), 'secret')
      fs.symlinkSync(outside, path.join(cwd, 'external'))
      const manager = new DiffReviewManager()

      // The path is spelled inside the project, but its realpath is not: the
      // containment check follows the symlink before the file is opened.
      await expect(manager.openFile(cwd, path.join('external', 'secret.md'))).rejects.toThrow('outside this project')
      expect(await opened()).toEqual([])

      // A symlink that stays inside the project is still a project file.
      const real = path.join(cwd, 'real.md')
      fs.writeFileSync(real, 'real')
      fs.symlinkSync(real, path.join(cwd, 'alias.md'))
      await manager.openFile(cwd, 'alias.md')
      expect(await opened()).toEqual([path.join(cwd, 'alias.md')])
    })

    it('reports a name the project cannot answer for, instead of claiming the file was deleted', async () => {
      const cwd = temporaryWorkspace()
      mocks.workspaceFolders.push({ uri: { fsPath: cwd } })
      const manager = new DiffReviewManager()

      await expect(manager.openFile(cwd, 'missing.cuh')).rejects.toThrow(
        'Could not open missing.cuh: no file with that path or name was found in this project.',
      )
      expect(mocks.showTextDocument).not.toHaveBeenCalled()
    })

    it('reveals a directory rather than opening it as a document', async () => {
      const cwd = temporaryWorkspace()
      fs.mkdirSync(path.join(cwd, 'csrc'))
      const manager = new DiffReviewManager()

      await manager.openFile(cwd, 'csrc')

      expect(mocks.executeCommand).toHaveBeenCalledWith('revealInExplorer', expect.objectContaining({ fsPath: path.join(cwd, 'csrc') }))
      expect(mocks.showTextDocument).not.toHaveBeenCalled()
    })
  })
})
