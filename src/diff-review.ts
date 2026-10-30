import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type { DshEvent } from './conversation.js'
import type { HistoryEntry } from './dsh-client.js'
import { comparableFilePath } from './file-path.js'
import { fileMutation, mutationDiff, diffsFromMeta, writeCreated, toolRecord, type FileMutation, type FileDiff } from './tool-presentation.js'
import { diffLineStats, verifiedMutation } from './tool-diff.js'

export interface ChangedFileItem {
  path: string
  additions: number
  deletions: number
  canRevert: boolean
}

export interface ChangedFileGroup {
  turn: number
  files: ChangedFileItem[]
}

interface PendingFile {
  absolutePath: string
  displayPath: string
  before?: FileImage
  diffs: FileDiff[]
  turn: number
  mutation?: FileMutation
  identity?: string
}

interface ReviewSnapshot {
  before: string | null
  after: string | null
  fullFile: boolean
  additions: number
  deletions: number
  eventSeq?: number
}

interface ReviewFile {
  absolutePath: string
  displayPath: string
  turn: number
  snapshots: ReviewSnapshot[]
  identity?: string
  /** The project root the review was recorded in; revert re-checks containment. */
  root: string
}

/** Filesystem identity of the target when Revert validated it (TOCTOU, S3-05). */
interface FileStamp {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  nlink: number
  physical: string
  symbolicLink: boolean
}

interface FileImage {
  text: string | null
}

interface UnknownRecord {
  [key: string]: unknown
}

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function callIdOf(event: DshEvent): string | undefined {
  const data = record(event.data)
  if (event.type === 'tool/call') return typeof data?.callId === 'string' ? data.callId : undefined
  if (event.type !== 'tool/result') return undefined
  const message = record(data?.message)
  const source = record(message?.source)
  if (typeof source?.callId === 'string') return source.callId
  const first = Array.isArray(message?.content) ? record(message.content[0]) : undefined
  return typeof first?.toolCallId === 'string' ? first.toolCallId : undefined
}

function failedResult(event: DshEvent): boolean {
  const data = record(event.data)
  if (data?.error !== undefined) return true
  const message = record(data?.message)
  return Array.isArray(message?.content) && message.content.some(value => record(value)?.isError === true)
}

function turnOf(event: DshEvent): number {
  const turn = record(event.data)?.turn
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn > 0 ? turn : 0
}

function diffsOf(value: unknown, expected: 'call' | 'result'): FileDiff[] {
  const wrapper = record(value)
  const view = wrapper?.for === expected ? record(wrapper.view) : undefined
  if (view?.card !== 'diff' || !Array.isArray(view.diffs)) return []
  return view.diffs.flatMap((value): FileDiff[] => {
    const diff = record(value)
    if (
      typeof diff?.path !== 'string'
      || (diff.oldText !== null && typeof diff.oldText !== 'string')
      || typeof diff.newText !== 'string'
    ) return []
    return [{ path: diff.path, oldText: diff.oldText, newText: diff.newText }]
  })
}

function inside(basePath: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(basePath), path.resolve(filePath))
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

/** Whether a reply spelled the home directory, which is never a project path. */
function isHomeSpelling(value: string): boolean {
  return value === '~' || value.startsWith('~/') || value.startsWith('~\\')
}

/**
 * The physical location of a path: symlinks along the existing prefix resolved.
 *
 * Nothing here opens a path; it only turns a lexical spelling into the file the
 * operating system would reach, which is what a containment check must inspect.
 */
function physicalPath(filePath: string): string {
  const resolved = path.resolve(filePath)
  let ancestor = resolved
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor)
  try {
    return path.resolve(fs.realpathSync.native(ancestor), path.relative(ancestor, resolved))
  } catch {
    return resolved
  }
}

/** Whether an existing path is, after following symlinks, inside a root. */
function containedIn(root: string, filePath: string): boolean {
  return inside(physicalPath(root), physicalPath(filePath))
}

/** The one sentence a refused path gets, so a click on an outside file is legible. */
function outsideProject(value: string): Error {
  return new Error(`Could not open ${value}: the path is outside this project.`)
}

/** A written path, as a workspace glob literal: only the names, never a pattern. */
function globLiteral(value: string): string {
  return value.replace(/[*?[\]{}!\\]/g, '\\$&')
}

/** The tail of a written path, as the project index searches for it. */
function searchSuffix(value: string): string {
  // A Windows separator is a glob escape, so a path spelled that way is read as
  // a POSIX one before the pattern is built. On POSIX a backslash is a name.
  const separators = path.sep === '\\' ? value.replace(/\\/g, '/') : value
  return globLiteral(separators.replace(/^(?:\.{1,2}[\\/])+/, '').replace(/[\\/]$/, ''))
}

function depth(filePath: string): number {
  return filePath.split(/[\\/]/).filter(part => part !== '').length
}

/** Whether the editor's own file system can see the path. */
async function exists(filePath: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
    return true
  } catch {
    return false
  }
}

/** The path as the project spells it, which is the part that tells files apart. */
function projectLabel(cwd: string, filePath: string): string {
  const folder = (vscode.workspace.workspaceFolders ?? []).find(candidate => inside(candidate.uri.fsPath, filePath))
  const relative = path.relative(folder?.uri.fsPath ?? cwd, filePath)
  return relative === '' ? filePath : relative
}

/**
 * Ask which of several files was meant.
 *
 * Absolute paths share so much of their prefix that a list of them is not a
 * question a reader can answer, so each entry leads with the project-relative
 * path and keeps the absolute one beside it.
 */
async function pickProjectFile(cwd: string, value: string, candidates: readonly string[]): Promise<string | undefined> {
  const items = candidates.map(candidate => ({ label: projectLabel(cwd, candidate), detail: candidate }))
  const picked = await vscode.window.showQuickPick(items, {
    title: `${value} matched more than one file`,
    placeHolder: 'Open which file?',
  })
  // Two folders can spell a path the same way, so the answer is the row's own
  // absolute path rather than the label the reader saw.
  return picked?.detail
}

/**
 * The files under one root whose path ends with a written one.
 *
 * The first search honours the reader's `files.exclude` settings, which is what
 * keeps it quick. A model also writes about the files it built (`dist/*.js`),
 * and a basename-only link to one of those is still a file the click asked for,
 * so a search that found nothing looks again past those exclusions — the two
 * directories nothing useful lives in stay excluded either way.
 */
async function searchProject(root: string, suffix: string): Promise<vscode.Uri[]> {
  const pattern = new vscode.RelativePattern(root, '**/' + suffix)
  const found = await vscode.workspace.findFiles(pattern, undefined, 64)
  if (found.length > 0) return found
  return vscode.workspace.findFiles(pattern, '**/{.git,node_modules}/**', 64)
}

function projectPath(cwd: string, value: string): string | undefined {
  const resolved = path.normalize(path.isAbsolute(value) ? value : path.resolve(cwd, value))
  if (!inside(cwd, resolved)) return undefined
  // Resolve existing ancestors too: a newly created file can be under a symlink.
  let ancestor = resolved
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor)
  const physical = path.resolve(comparableFilePath(ancestor), path.relative(ancestor, resolved))
  return inside(comparableFilePath(path.resolve(cwd)), physical) ? resolved : undefined
}

function readImage(filePath: string): FileImage | undefined {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) return undefined
    const bytes = fs.readFileSync(filePath)
    if (bytes.length > MAX_SNAPSHOT_BYTES || bytes.includes(0)) return undefined
    const text = bytes.toString('utf8')
    return Buffer.from(text, 'utf8').equals(bytes) ? { text } : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: null }
    return undefined
  }
}

/**
 * Filesystem identity of a path for the revert guard.
 *
 * `lstat` is deliberate: a symbolic link must stay visible as one instead of
 * being followed to whatever it currently points at.
 */
function stampOf(filePath: string): FileStamp | undefined {
  try {
    const stat = fs.lstatSync(filePath)
    return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, nlink: stat.nlink,
      physical: comparableFilePath(filePath), symbolicLink: stat.isSymbolicLink() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function groupedDiffs(cwd: string, diffs: readonly FileDiff[], turn: number): Map<string, PendingFile> {
  const grouped = new Map<string, PendingFile>()
  for (const diff of diffs) {
    const absolutePath = projectPath(cwd, diff.path)
    if (absolutePath === undefined) continue
    const key = comparableFilePath(absolutePath)
    const existing = grouped.get(key)
    if (existing === undefined) {
      grouped.set(key, {
        absolutePath,
        displayPath: path.relative(cwd, absolutePath) || path.basename(absolutePath),
        diffs: [diff],
        turn,
      })
    } else {
      existing.diffs.push(diff)
    }
  }
  return grouped
}

function fragmentSnapshot(diffs: readonly FileDiff[], contextualHunks = false): ReviewSnapshot | undefined {
  const changed = diffs.filter(diff => diff.oldText === null || diff.oldText !== diff.newText)
  if (changed.length === 0) return undefined
  const separator = '\n\n⋯ unchanged lines ⋯\n\n'
  return {
    before: changed.map(diff => diff.oldText ?? '').join(separator),
    after: changed.map(diff => diff.newText).join(separator),
    fullFile: false,
    ...diffLineStats(changed, contextualHunks),
  }
}

/** Tracks official DSH diff events and opens their changes in VS Code's native editors. */
export class DiffReviewManager implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>()
  private readonly content = new Map<string, string>()
  /**
   * Preview URIs per review, so re-opening a diff (or dismissing it) releases the
   * file text it showed. Without this every open left up to two orphans holding
   * the full before/after content until the runtime restarted.
   */
  private readonly previewUris = new Map<string, string[]>()
  private readonly pending = new Map<string, Map<string, PendingFile>>()
  private readonly reviews = new Map<string, Map<number, Map<string, ReviewFile>>>()
  private readonly dismissed = new Map<string, Set<string>>()

  readonly onDidChange = this.changed.event

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? ''
  }

  dispose(): void {
    this.changed.dispose()
    this.previewUris.clear()
    this.content.clear()
    this.pending.clear()
    this.reviews.clear()
    this.dismissed.clear()
  }

  clear(): void {
    this.previewUris.clear()
    this.content.clear()
    this.pending.clear()
    this.reviews.clear()
  }

  rebuild(sessionId: string, cwd: string, entries: readonly HistoryEntry[]): ChangedFileGroup[] {
    const live = new Map(this.allReviews(sessionId).flatMap(file => file.snapshots
      .filter(snapshot => snapshot.fullFile && snapshot.eventSeq !== undefined)
      .map(snapshot => [`${file.turn}:${comparableFilePath(file.absolutePath)}:${snapshot.eventSeq}`, { snapshot, identity: file.identity }] as const)))
    this.clearSession(sessionId)
    for (const entry of entries) this.accept(sessionId, cwd, entry.event, entry.view, true)
    for (const file of this.allReviews(sessionId)) file.snapshots = file.snapshots.map(snapshot => {
      const cached = live.get(`${file.turn}:${comparableFilePath(file.absolutePath)}:${snapshot.eventSeq}`)
      return cached !== undefined && cached.identity === file.identity ? cached.snapshot : snapshot
    })
    return this.changedFiles(sessionId)
  }

  /** Replay an older, complete history page without discarding reversible live snapshots. */
  prependHistory(sessionId: string, cwd: string, entries: readonly HistoryEntry[]): ChangedFileGroup[] {
    for (const entry of entries) this.accept(sessionId, cwd, entry.event, entry.view, true)
    return this.changedFiles(sessionId)
  }

  accept(sessionId: string, cwd: string, event: DshEvent, view?: unknown, replay = false): boolean {
    if (event.type === 'assistant/message' && !replay) {
      const data = toolRecord(event.data)
      const message = toolRecord(data?.message)
      if (Array.isArray(message?.content)) for (const value of message.content) {
        const block = toolRecord(value)
        if (block?.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string'
          && fileMutation(block.name, block.arguments) !== undefined) {
          this.accept(sessionId, cwd, { ...event, type: 'tool/call', data: {
            turn: data?.turn, callId: block.id, name: block.name, arguments: block.arguments,
          } })
        }
      }
      return false
    }
    if (event.type === 'turn/end') {
      for (const key of this.pending.keys()) if (key.startsWith(`${sessionId}:`)) this.pending.delete(key)
      return false
    }
    const callId = callIdOf(event)
    if (callId === undefined) return false
    const key = `${sessionId}:${callId}`
    const turn = turnOf(event)

    if (event.type === 'tool/call') {
      const data = record(event.data)
      const mutation = typeof data?.name === 'string' ? fileMutation(data.name, data.arguments) : undefined
      const files = groupedDiffs(cwd, mutation === undefined ? diffsOf(view, 'call') : [mutationDiff(mutation)], turn)
      const previous = this.pending.get(key)
      for (const [pathKey, file] of files) {
        if (mutation !== undefined) file.mutation = mutation
        const earlier = previous?.get(pathKey)?.before
        if (earlier !== undefined) file.before = earlier
        file.identity = previous?.get(pathKey)?.identity ?? comparableFilePath(file.absolutePath)
      }
      if (!replay) {
        for (const file of files.values()) {
          const before = file.before ?? readImage(file.absolutePath)
          if (before !== undefined) file.before = before
        }
      }
      if (files.size > 0) this.pending.set(key, files)
      return false
    }

    if (event.type !== 'tool/result') return false
    const pending = this.pending.get(key)
    this.pending.delete(key)
    if (failedResult(event)) return false

    // A newly created file may not have had a realpath during tool/call. Resolve
    // pending entries again now that tool/result has made the path observable.
    const currentPending = pending === undefined
      ? undefined
      : new Map([...pending.values()].map(file => [comparableFilePath(file.absolutePath), file]))
    const modern = [...(currentPending?.values() ?? [])].some(file => file.mutation !== undefined)
    const applied = modern ? diffsFromMeta(record(event.data)?.meta) : undefined
    const created = modern && writeCreated(event)
    const resultDiffs = modern ? applied ?? [] : diffsOf(view, 'result')
    const results = groupedDiffs(cwd, resultDiffs, turn)
    const fileKeys = new Set([...(currentPending?.keys() ?? []), ...results.keys()])
    let updated = false
    for (const fileKey of fileKeys) {
      const callFile = currentPending?.get(fileKey)
      const resultFile = results.get(fileKey)
      const absolutePath = callFile?.absolutePath ?? resultFile?.absolutePath
      if (absolutePath === undefined || projectPath(cwd, absolutePath) === undefined) continue
      const displayPath = callFile?.displayPath ?? resultFile?.displayPath ?? path.relative(cwd, absolutePath)
      const fileTurn = resultFile?.turn ?? callFile?.turn ?? turn
      const diffs = resultFile?.diffs ?? callFile?.diffs ?? []
      if (modern && callFile === undefined) continue
      const after = replay ? undefined : readImage(absolutePath)
      const mutation = callFile?.mutation
      const actualDiffs = mutation === undefined ? diffs : resultFile?.diffs
        ?? (created && mutation.kind === 'write' ? [mutationDiff(mutation)] : [])
      const before = callFile?.before
      const sameTarget = before?.text === null || callFile?.identity === comparableFilePath(absolutePath)
      const matchedApplied = resultFile?.diffs ?? (applied?.length === 0 ? applied : undefined)
      const verified = sameTarget && (mutation === undefined
        ? before !== undefined && after !== undefined && before.text !== after.text
        : before !== undefined && after !== undefined && verifiedMutation(before.text, after.text, mutation, matchedApplied, created))
      const snapshot = verified && before !== undefined && after !== undefined
        ? { before: before.text, after: after.text, fullFile: true,
          ...diffLineStats([{ path: displayPath, oldText: before.text, newText: after.text ?? '' }]) }
        : fragmentSnapshot(actualDiffs, mutation !== undefined && !created)
      if (snapshot === undefined) continue
      this.record(sessionId, { absolutePath, displayPath, turn: fileTurn, identity: comparableFilePath(absolutePath),
        root: cwd, snapshots: [{ ...snapshot, eventSeq: event.seq }] })
      updated = true
    }
    return updated
  }

  changedFiles(sessionId: string): ChangedFileGroup[] {
    const turns = this.reviews.get(sessionId)
    if (turns === undefined) return []
    return [...turns.entries()]
      .sort(([left], [right]) => right - left)
      .map(([turn, files]) => ({
        turn,
        files: [...files.values()].map(file => {
          const stats = file.snapshots.reduce((total, snapshot) => ({
            additions: total.additions + snapshot.additions,
            deletions: total.deletions + snapshot.deletions,
          }), { additions: 0, deletions: 0 })
          return {
            path: file.displayPath,
            ...stats,
            canRevert: this.reviewContent(file).fullFile,
          }
        }),
      }))
      .filter(group => group.files.length > 0)
  }

  /**
   * Open a file a reply named.
   *
   * A model writes the file it means, not the one this window has open: the
   * value can be absolute, relative to the project, or nothing but the basename
   * of a file several directories down (`rdma.cuh`). Resolving only the literal
   * project spelling made every such link read as "not available on this
   * machine", so the project's own index answers for a name the roots cannot.
   */
  async openFile(cwd: string, value: string, line?: number): Promise<void> {
    const candidates = await this.openCandidates(cwd, value)
    if (candidates.length === 0) {
      throw new Error(`Could not open ${value}: no file with that path or name was found in this project.`)
    }
    // One answer needs no ceremony; several mean the reply named a file this
    // project holds more than once, and guessing between them would be a coin flip.
    const picked = candidates.length === 1 ? candidates[0] : await pickProjectFile(cwd, value, candidates)
    if (picked === undefined) return
    const uri = vscode.Uri.file(picked)
    const stat = await vscode.workspace.fs.stat(uri)
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      await vscode.commands.executeCommand('revealInExplorer', uri)
      return
    }
    const document = await vscode.workspace.openTextDocument(uri)
    const targetLine = line === undefined ? undefined : Math.max(0, Math.min(line - 1, document.lineCount - 1))
    const selection = targetLine === undefined ? undefined : new vscode.Range(targetLine, 0, targetLine, 0)
    await vscode.window.showTextDocument(document, {
      preview: true,
      ...(selection === undefined ? {} : { selection }),
    })
  }

  /**
   * Every path the project can answer for a written one, best first.
   *
   * A model writes its paths relative to the directory the conversation runs in,
   * which is this project, so that is the directory that answers for them: a
   * literal hit wins outright, and otherwise the project's own index supplies
   * the files whose path ends with what was written — `rdma.cuh` finds
   * `csrc/kernels/rdma.cuh`. The index answer can be ambiguous, which is the
   * caller's cue to ask rather than to guess.
   */
  private async openCandidates(cwd: string, value: string): Promise<string[]> {
    const written = value.trim()
    if (written === '') return []
    // A reply may spell a home file, but a click must not leave the project;
    // expanding `~` would only produce a path this method then refuses.
    if (isHomeSpelling(written)) throw outsideProject(value)
    // Without a project of its own, the window's folders are the only roots.
    const roots = (cwd === '' ? (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath) : [cwd])
      .filter(root => root !== '')
    if (roots.length === 0) throw outsideProject(value)
    // An absolute path is opened when it is the user's own workspace; the
    // folders are included so another open folder stays reachable.
    const workspaceRoots = [...roots, ...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath)]
      .filter(root => root !== '')
    if (path.isAbsolute(written)) {
      const absolute = path.normalize(written)
      if (await exists(absolute)) {
        if (workspaceRoots.some(root => containedIn(root, absolute))) return [absolute]
        throw outsideProject(value)
      }
      // A reply also spells a *project* path with a leading slash
      // (`/csrc/kernels/rdma.cuh`), which is not where this project lives: that
      // spelling is answered for below rather than refused here.
    } else {
      // A relative path may not climb above the root it is read against, whether
      // or not the outside target happens to exist.
      const escaping = roots.every(root => !inside(path.resolve(root), path.resolve(root, written)))
      if (escaping) throw outsideProject(value)
    }
    const relative = written.replace(/^[\\/]+/, '')
    let outsideLiteral = false
    for (const root of roots) {
      const resolved = path.normalize(path.resolve(root, relative))
      if (!inside(path.resolve(root), resolved)) continue
      if (!(await exists(resolved))) continue
      // The path exists under the root the reply spelled, but a symlink moved
      // its physical target elsewhere: that is an outside file, not a miss.
      if (containedIn(root, resolved)) return [resolved]
      outsideLiteral = true
    }
    if (outsideLiteral) throw outsideProject(value)
    // A Windows separator is a glob escape, so the search reads the path the
    // way the glob language does before the pattern is built.
    const suffix = searchSuffix(relative)
    if (suffix === '') return []
    const found: string[] = []
    for (const root of roots) {
      const matches = await searchProject(root, suffix)
      for (const uri of matches) {
        // The workspace search can surface a symlinked path; the physical target
        // is what decides whether the file is really inside the root.
        if (!found.includes(uri.fsPath) && await exists(uri.fsPath) && containedIn(root, uri.fsPath)) found.push(uri.fsPath)
      }
    }
    // The shallowest and shortest path is the likeliest one meant.
    return found.sort((left, right) => depth(left) - depth(right)
      || left.length - right.length || left.localeCompare(right))
  }

  async reviewFile(sessionId: string, cwd: string, value: string, turn?: number): Promise<void> {
    const review = this.findReview(sessionId, cwd, value, turn)
    if (review === undefined) throw new Error(`No completed DeepSeek change is available for ${value}.`)
    await this.openReview(review, true, sessionId)
  }

  async reviewAll(sessionId: string): Promise<void> {
    const reviews = this.allReviews(sessionId)
    if (reviews.length === 0) throw new Error('No completed DeepSeek changes are available to review.')
    for (const review of reviews.slice(0, 20)) await this.openReview(review, false, sessionId)
    if (reviews.length > 20) void vscode.window.showInformationMessage('Opened the first 20 changed files.')
  }

  keepFile(sessionId: string, cwd: string, value: string, turn: number): ChangedFileGroup[] {
    const review = this.findReview(sessionId, cwd, value, turn)
    if (review === undefined) throw new Error(`No completed DeepSeek change is available for ${value}.`)
    this.dismiss(sessionId, review)
    return this.changedFiles(sessionId)
  }

  keepAll(sessionId: string): ChangedFileGroup[] {
    for (const review of this.allReviews(sessionId)) this.markDismissed(sessionId, review)
    this.reviews.delete(sessionId)
    return []
  }

  revertFile(sessionId: string, cwd: string, value: string, turn: number): ChangedFileGroup[] {
    const review = this.findReview(sessionId, cwd, value, turn)
    if (review === undefined) throw new Error(`No completed DeepSeek change is available for ${value}.`)
    const content = this.validateRevert(review)
    this.applyRevert(review, content.before, content.after, content.stamp)
    this.dismiss(sessionId, review)
    return this.changedFiles(sessionId)
  }

  revertAll(sessionId: string): ChangedFileGroup[] {
    const reviews = this.allReviews(sessionId)
    if (reviews.length === 0) throw new Error('No completed DeepSeek changes are available to revert.')
    const byFile = new Map<string, ReviewFile[]>()
    for (const review of reviews) {
      const key = comparableFilePath(review.absolutePath)
      const existing = byFile.get(key)
      if (existing === undefined) byFile.set(key, [review])
      else existing.push(review)
    }
    const validated = [...byFile.values()].map(series => this.validateRevertSeries(series))
    for (const item of validated) this.applyRevert(item.review, item.before, item.after, item.stamp)
    for (const review of reviews) this.markDismissed(sessionId, review)
    this.reviews.delete(sessionId)
    return []
  }

  private clearSession(sessionId: string): void {
    this.forgetPreviews(undefined, `${sessionId}:`)
    this.reviews.delete(sessionId)
    for (const key of this.pending.keys()) if (key.startsWith(`${sessionId}:`)) this.pending.delete(key)
  }

  private record(sessionId: string, incoming: ReviewFile): void {
    // Only skip when *every* change this review stands for was dismissed: a
    // later edit in the same turn is a change the user has not seen yet.
    const dismissed = this.dismissed.get(sessionId)
    if (dismissed !== undefined && this.changeKeys(incoming).every(key => dismissed.has(key))) return
    let turns = this.reviews.get(sessionId)
    if (turns === undefined) this.reviews.set(sessionId, turns = new Map())
    let files = turns.get(incoming.turn)
    if (files === undefined) turns.set(incoming.turn, files = new Map())
    const key = comparableFilePath(incoming.absolutePath)
    const existing = files.get(key)
    if (existing === undefined) files.set(key, incoming)
    else for (const snapshot of incoming.snapshots) {
      if (snapshot.eventSeq === undefined || !existing.snapshots.some(value => value.eventSeq === snapshot.eventSeq)) {
        existing.snapshots.push(snapshot)
      }
    }
  }

  private reviewContent(review: ReviewFile): { before: string | null; after: string | null; fullFile: boolean } {
    const first = review.snapshots[0]
    const continuous = review.snapshots.slice(1).every((snapshot, index) => review.snapshots[index]?.after === snapshot.before)
    if (first?.fullFile === true && review.snapshots.every(snapshot => snapshot.fullFile) && continuous) {
      const latest = review.snapshots.at(-1)?.after ?? first.after
      return { before: first.before, after: latest, fullFile: true }
    }
    const separator = '\n\n================ next DeepSeek change ================\n\n'
    return {
      before: review.snapshots.map(snapshot => snapshot.before ?? '').join(separator),
      after: review.snapshots.map(snapshot => snapshot.after ?? '').join(separator),
      fullFile: false,
    }
  }

  private findReview(sessionId: string, cwd: string, value: string, turn?: number): ReviewFile | undefined {
    const absolutePath = projectPath(cwd, value)
    if (absolutePath === undefined) return undefined
    const key = comparableFilePath(absolutePath)
    const turns = this.reviews.get(sessionId)
    if (turn !== undefined) return turns?.get(turn)?.get(key)
    return [...(turns?.entries() ?? [])]
      .sort(([left], [right]) => right - left)
      .map(([, files]) => files.get(key))
      .find((review): review is ReviewFile => review !== undefined)
  }

  private allReviews(sessionId: string): ReviewFile[] {
    return [...(this.reviews.get(sessionId)?.values() ?? [])].flatMap(files => [...files.values()])
  }

  private reviewKey(review: ReviewFile): string {
    return `${String(review.turn)}:${comparableFilePath(review.absolutePath)}`
  }

  private markDismissed(sessionId: string, review: ReviewFile): void {
    let dismissed = this.dismissed.get(sessionId)
    if (dismissed === undefined) this.dismissed.set(sessionId, dismissed = new Set())
    for (const key of this.changeKeys(review)) dismissed.add(key)
  }

  /**
   * Identities of the individual changes a review stands for.
   *
   * A file edited twice in one turn produces two changes under one row, and the
   * user may dismiss the first. Keying the dismissal on the row (`turn:path`)
   * therefore hid the second edit entirely — it was neither shown nor revertable.
   * The event sequence identifies the change, so dismissing one leaves the next
   * one to be reported. A review with no sequence numbers can only be named as a
   * whole, which is what the row key is for.
   */
  private changeKeys(review: ReviewFile): string[] {
    const path = comparableFilePath(review.absolutePath)
    const keys: string[] = []
    for (const snapshot of review.snapshots) {
      if (typeof snapshot.eventSeq === 'number') keys.push(`${String(review.turn)}:${path}:${String(snapshot.eventSeq)}`)
    }
    return keys.length > 0 ? keys : [this.reviewKey(review)]
  }

  private dismiss(sessionId: string, review: ReviewFile): void {
    this.forgetPreviews(this.previewKey(sessionId, review))
    this.markDismissed(sessionId, review)
    const turns = this.reviews.get(sessionId)
    const files = turns?.get(review.turn)
    files?.delete(comparableFilePath(review.absolutePath))
    if (files?.size === 0) turns?.delete(review.turn)
    if (turns?.size === 0) this.reviews.delete(sessionId)
  }

  private validateRevert(review: ReviewFile): { before: string | null; after: string | null; stamp: FileStamp | undefined } {
    const content = this.reviewContent(review)
    if (!content.fullFile) {
      throw new Error(`Cannot safely revert ${review.displayPath}: its full snapshot is no longer available.`)
    }
    const stamp = this.validateCurrentFile(review, content.after)
    return { ...content, stamp }
  }

  private validateRevertSeries(series: ReviewFile[]): { review: ReviewFile; before: string | null; after: string | null; stamp: FileStamp | undefined } {
    const ordered = [...series].sort((left, right) => left.turn - right.turn)
    const contents = ordered.map(review => ({ review, content: this.reviewContent(review) }))
    const unavailable = contents.find(item => !item.content.fullFile)
    if (unavailable !== undefined) {
      throw new Error(`Cannot safely revert ${unavailable.review.displayPath}: its full snapshot is no longer available.`)
    }
    for (let index = 1; index < contents.length; index += 1) {
      if (contents[index - 1]?.content.after !== contents[index]?.content.before) {
        throw new Error(`Cannot safely revert ${contents[index]?.review.displayPath}: it changed between DeepSeek turns.`)
      }
    }
    const latest = contents.at(-1)
    const earliest = contents[0]
    if (latest === undefined || earliest === undefined) throw new Error('No completed DeepSeek changes are available to revert.')
    const stamp = this.validateCurrentFile(latest.review, latest.content.after)
    return { review: latest.review, before: earliest.content.before, after: latest.content.after, stamp }
  }

  /** The target changed since validation, in the one way this message describes. */
  private targetChanged(review: ReviewFile): Error {
    return new Error(`Cannot revert ${review.displayPath}: the file changed after DeepSeek edited it.`)
  }

  private validateCurrentFile(review: ReviewFile, expected: string | null): FileStamp | undefined {
    const target = path.resolve(review.absolutePath)
    if (review.root !== '' && !inside(path.resolve(review.root), target)) {
      throw new Error(`Cannot revert ${review.displayPath}: its target is outside this project.`)
    }
    const reviewPath = comparableFilePath(target)
    if (review.identity !== undefined && reviewPath !== review.identity) throw new Error(`Cannot revert ${review.displayPath}: its filesystem target changed.`)
    if (review.root !== '' && !containedIn(review.root, target)) {
      throw new Error(`Cannot revert ${review.displayPath}: its target is outside this project.`)
    }
    const dirty = vscode.workspace.textDocuments.some(document =>
      document.isDirty
      && comparableFilePath(path.resolve(document.uri.fsPath)) === reviewPath,
    )
    if (dirty) throw new Error(`Cannot revert ${review.displayPath}: it has unsaved VS Code changes.`)
    const current = readImage(target)
    if (current === undefined) throw new Error(`Cannot safely read ${review.displayPath} before reverting.`)
    if (current.text !== expected) throw this.targetChanged(review)
    const stamp = stampOf(target)
    if (stamp?.symbolicLink === true) throw new Error(`Cannot revert ${review.displayPath}: its target is a symbolic link.`)
    return stamp
  }

  /**
   * Re-establish the validated facts at the last moment before writing (S3-05).
   *
   * `validateCurrentFile` compared one read of the target; this re-reads the
   * same facts immediately before the write, so a path that was replaced with a
   * symlink, another file or different bytes in between is refused instead of
   * written through.
   */
  private assertRevertTarget(review: ReviewFile, expected: string | null, stamp: FileStamp | undefined): void {
    const target = path.resolve(review.absolutePath)
    if (review.root !== '' && !inside(path.resolve(review.root), target)) {
      throw new Error(`Cannot revert ${review.displayPath}: its target is outside this project.`)
    }
    const current = stampOf(target)
    if (stamp === undefined) {
      if (current !== undefined) throw this.targetChanged(review)
    } else {
      if (current === undefined || current.symbolicLink || stamp.symbolicLink) {
        throw new Error(`Cannot revert ${review.displayPath}: its target is a symbolic link.`)
      }
      // A second link means another name shares this inode, possibly one outside
      // the project: writing through it would change a file the project does not
      // own.
      if (current.nlink > 1 || stamp.nlink > 1) {
        throw new Error(`Cannot revert ${review.displayPath}: its target has other hard links.`)
      }
      if (current.dev !== stamp.dev || current.ino !== stamp.ino || current.size !== stamp.size
        || current.mtimeMs !== stamp.mtimeMs || current.physical !== stamp.physical) throw this.targetChanged(review)
      if (review.identity !== undefined && current.physical !== review.identity) {
        throw new Error(`Cannot revert ${review.displayPath}: its filesystem target changed.`)
      }
      if (review.root !== '' && !inside(physicalPath(review.root), current.physical)) {
        throw new Error(`Cannot revert ${review.displayPath}: its target is outside this project.`)
      }
    }
    const image = readImage(target)
    if (image === undefined || image.text !== expected) throw this.targetChanged(review)
  }

  private applyRevert(review: ReviewFile, before: string | null, after: string | null, stamp: FileStamp | undefined): void {
    this.assertRevertTarget(review, after, stamp)
    const target = path.resolve(review.absolutePath)
    if (before === null) {
      try {
        fs.unlinkSync(target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return
    }
    const directory = path.dirname(target)
    fs.mkdirSync(directory, { recursive: true })
    // Write beside the target and rename it into place: a failed write leaves
    // the reviewed file byte-for-byte unchanged instead of truncated (S2).
    const temporary = path.join(directory, '.' + path.basename(target) + '.dsh-revert-' + randomUUID())
    const mode = fs.statSync(target).mode & 0o777
    let descriptor: number | undefined
    try {
      descriptor = fs.openSync(temporary, 'wx', mode)
      fs.writeFileSync(descriptor, before, 'utf8')
      fs.fsyncSync(descriptor)
    } catch (error) {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor) } catch { /* cleanup below */ } }
      try { fs.rmSync(temporary, { force: true }) } catch { /* the original is untouched */ }
      throw error
    }
    fs.closeSync(descriptor)
    try {
      fs.renameSync(temporary, target)
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }) } catch { /* the original is untouched */ }
      throw error
    }
  }

  private previewKey(sessionId: string, review: ReviewFile): string {
    return `${sessionId}:${String(review.turn)}:${comparableFilePath(review.absolutePath)}`
  }

  /** Release the text behind whatever this review was last shown with. */
  private forgetPreviews(key: string | undefined, prefix?: string): void {
    for (const [existing, uris] of this.previewUris) {
      if (key !== undefined && existing !== key) continue
      if (prefix !== undefined && !existing.startsWith(prefix)) continue
      for (const uri of uris) this.content.delete(uri)
      this.previewUris.delete(existing)
      if (key !== undefined) break
    }
  }

  private async openReview(review: ReviewFile, preview: boolean, sessionId: string): Promise<void> {
    const key = this.previewKey(sessionId, review)
    this.forgetPreviews(key)
    const id = randomUUID()
    const name = path.basename(review.absolutePath)
    const beforeUri = vscode.Uri.from({ scheme: 'dsh-diff', authority: 'before', path: `/${id}/${name}` })
    const afterUri = vscode.Uri.from({ scheme: 'dsh-diff', authority: 'after', path: `/${id}/${name}` })
    const content = this.reviewContent(review)
    this.content.set(beforeUri.toString(), content.before ?? '')
    this.content.set(afterUri.toString(), content.after ?? '')
    this.previewUris.set(key, [beforeUri.toString(), afterUri.toString()])
    await vscode.commands.executeCommand(
      'vscode.diff',
      beforeUri,
      afterUri,
      `${review.displayPath} — DeepSeek changes (Turn ${String(review.turn)})`,
      { preview },
    )
  }
}
