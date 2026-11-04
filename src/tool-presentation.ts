import type { DshEvent } from './conversation.js'
import { subagentToolLabel, subagentToolReferences } from './subagent-tools.js'

type RecordValue = Record<string, unknown>
export function presentSubagentReferences(view: unknown, name: string, raw: unknown, text = '', meta?: unknown, failed = false): unknown {
  const label = subagentToolLabel(name, raw), refs = subagentToolReferences(name, raw, text, meta, failed)
  if (label === undefined && refs.length === 0) return view
  return { card: 'generic', ...toolRecord(view), ...(label === undefined ? {} : { title: label, subagentLabel: label }),
    ...(refs.length ? { subagentLinks: refs } : {}) }
}
export interface FileDiff { path: string; oldText: string | null; newText: string }
export type FileMutation =
  | { kind: 'write'; path: string; content: string }
  | { kind: 'edit'; path: string; oldText: string; newText: string; replaceAll: boolean }

export type PatchCallView = RecordValue & {
  card: 'diff'
  title: string
  diffs: FileDiff[]
  locations: Array<{ path: string }>
}

interface PatchHunk {
  oldLines: string[]
  newLines: string[]
  isEndOfFile: boolean
}

interface PatchOperation {
  kind: 'add' | 'delete' | 'update'
  path: string
  content: string
  hunks: PatchHunk[]
  moveTo?: string
}

export function toolRecord(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined
}

export function toolArguments(value: unknown): RecordValue | undefined {
  if (typeof value !== 'string') return toolRecord(value)
  try { return toolRecord(JSON.parse(value)) } catch { return undefined }
}

/** Only interpret the official filesystem tools; opaque plugin metadata stays opaque. */
export function fileMutation(name: string, raw: unknown): FileMutation | undefined {
  const args = toolArguments(raw)
  if (typeof args?.file_path !== 'string' || args.file_path.trim() === '') return undefined
  if (name === 'write' && typeof args.content === 'string') return { kind: 'write', path: args.file_path, content: args.content }
  if (name === 'edit' && typeof args.old_string === 'string' && args.old_string !== '' && typeof args.new_string === 'string'
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')) {
    return { kind: 'edit', path: args.file_path, oldText: args.old_string, newText: args.new_string, replaceAll: args.replace_all === true }
  }
  return undefined
}

export function mutationDiff(mutation: FileMutation): FileDiff {
  return { path: mutation.path, oldText: mutation.kind === 'edit' ? mutation.oldText : null,
    newText: mutation.kind === 'edit' ? mutation.newText : mutation.content }
}

/** The persisted 0.1.2 fs result metadata contains applied contextual hunks, not full files. */
export function diffsFromMeta(meta: unknown): FileDiff[] | undefined {
  const values = toolRecord(meta)?.diffs
  if (!Array.isArray(values)) return undefined
  const diffs: FileDiff[] = []
  for (const value of values) {
    const diff = toolRecord(value)
    if (typeof diff?.path !== 'string' || diff.path.trim() === '' || (diff.oldText !== null && typeof diff.oldText !== 'string')
      || typeof diff.newText !== 'string') return undefined
    diffs.push({ path: diff.path, oldText: diff.oldText, newText: diff.newText })
  }
  return diffs
}

const PATCH_BEGIN = '*** Begin Patch'
const PATCH_END = '*** End Patch'
const PATCH_EOF = '*** End of File'
const PATCH_MOVE = '*** Move to: '
const PATCH_ADD = '*** Add File: '
const PATCH_DELETE = '*** Delete File: '
const PATCH_UPDATE = '*** Update File: '
const PATCH_HEREDOCS = ['<<EOF', "<<'EOF'", '<<"EOF"']
const PATCH_ENVIRONMENT = '*** Environment ID:'
const PATCH_WHITE_SPACE = /\p{White_Space}/u

/** Syntax failure while previewing a patch; the public presenters absorb it. */
class PatchPreviewError extends Error {}

function patchTrimStart(value: string): string {
  let start = 0
  while (start < value.length && PATCH_WHITE_SPACE.test(value.charAt(start))) start += 1
  return value.slice(start)
}

function patchTrimEnd(value: string): string {
  let end = value.length
  while (end > 0 && PATCH_WHITE_SPACE.test(value.charAt(end - 1))) end -= 1
  return value.slice(0, end)
}

function patchTrim(value: string): string {
  return patchTrimEnd(patchTrimStart(value))
}

function patchHunkEmpty(hunk: PatchHunk): boolean {
  return hunk.oldLines.length === 0 && hunk.newLines.length === 0
}

/** Require that an update operation ended with a nonempty hunk. */
function ensurePatchUpdate(operation: PatchOperation | undefined): void {
  if (operation?.kind !== 'update') return
  const last = operation.hunks.at(-1)
  if (last === undefined) throw new PatchPreviewError()
  if (patchHunkEmpty(last)) throw new PatchPreviewError()
}

/** Read one update line: a marker, an end-of-file anchor, or one hunk line. */
function readPatchUpdate(operation: PatchOperation, line: string): void {
  const text = patchTrimEnd(line)
  const previous = operation.hunks.at(-1)
  const marker = text === '@@' || text.startsWith('@@ ')
  if (previous?.isEndOfFile === true) {
    if (text === '') return
    if (!marker) throw new PatchPreviewError()
  }
  if (previous === undefined && operation.moveTo === undefined && text.startsWith(PATCH_MOVE)) {
    operation.moveTo = text.slice(PATCH_MOVE.length)
    return
  }
  if (marker) {
    if (previous !== undefined && patchHunkEmpty(previous)) throw new PatchPreviewError()
    operation.hunks.push({ oldLines: [], newLines: [], isEndOfFile: false })
    return
  }
  if (text === PATCH_EOF) {
    if (previous !== undefined) {
      if (patchHunkEmpty(previous)) throw new PatchPreviewError()
      previous.isEndOfFile = true
    }
    return
  }
  const prefix = line.charAt(0)
  if (line !== '' && prefix !== ' ' && prefix !== '+' && prefix !== '-') throw new PatchPreviewError()
  const hunk = previous ?? { oldLines: [], newLines: [], isEndOfFile: false }
  if (previous === undefined) operation.hunks.push(hunk)
  const content = line.slice(1)
  if (prefix === '+') hunk.newLines.push(content)
  else if (prefix === '-') hunk.oldLines.push(content)
  else {
    hunk.oldLines.push(content)
    hunk.newLines.push(content)
  }
}

/**
 * Parse a Codex-style patch into preview operations.
 *
 * This is a bounded port of the runtime's parser (`dsh-fs-patch`), used only to
 * preview a call without filesystem access. It accepts the same construction —
 * Begin/End markers, Add/Update/Delete headers, an optional move destination,
 * hunk markers and lines, an end-of-file anchor, and literal heredoc wrappers —
 * and returns undefined for any syntax it does not accept, so the caller falls
 * back to a generic card instead of showing a broken preview.
 */
function parsePatchPreview(patch: string): PatchOperation[] | undefined {
  let lines = patchTrim(patch).split(/\r?\n/u)
  const wrapperFirst = lines[0]
  const wrapperLast = lines.at(-1)
  if (wrapperFirst !== undefined && wrapperLast !== undefined && PATCH_HEREDOCS.includes(wrapperFirst)
    && wrapperLast.endsWith('EOF') && lines.length >= 4) lines = lines.slice(1, -1)
  if (lines.length < 2) return undefined
  const first = lines[0]
  const last = lines.at(-1)
  if (first === undefined || last === undefined) return undefined
  if (patchTrim(first) !== PATCH_BEGIN) return undefined
  if (patchTrim(last) !== PATCH_END) return undefined
  const text = lines.map((line, index) => index < lines.length - 1 ? line.replace(/\r$/u, '') : line)
  const operations: PatchOperation[] = []
  let ended = false
  try {
    for (let index = 1; index < text.length; index += 1) {
      const line = text[index] ?? ''
      const isLast = index === text.length - 1
      const operation = operations.at(-1)
      const header = operation?.kind === 'update' && !isLast ? patchTrimEnd(line) : patchTrim(line)
      if (ended && !isLast) {
        if (patchTrim(line) !== '') throw new PatchPreviewError()
        continue
      }
      if (header === PATCH_END) {
        ensurePatchUpdate(operation)
        ended = true
      } else if (header.startsWith(PATCH_ADD)) {
        ensurePatchUpdate(operation)
        operations.push({ kind: 'add', path: header.slice(PATCH_ADD.length), content: '', hunks: [] })
      } else if (header.startsWith(PATCH_DELETE)) {
        ensurePatchUpdate(operation)
        operations.push({ kind: 'delete', path: header.slice(PATCH_DELETE.length), content: '', hunks: [] })
      } else if (header.startsWith(PATCH_UPDATE)) {
        ensurePatchUpdate(operation)
        operations.push({ kind: 'update', path: header.slice(PATCH_UPDATE.length), content: '', hunks: [] })
      } else if (operations.length === 0 && header.startsWith(PATCH_ENVIRONMENT)) {
        throw new PatchPreviewError()
      } else if (operation?.kind === 'add' && line.startsWith('+')) {
        operation.content += line.slice(1) + '\n'
      } else if (operation?.kind === 'update') {
        readPatchUpdate(operation, line)
      } else {
        throw new PatchPreviewError()
      }
    }
  } catch {
    return undefined
  }
  return operations
}

/**
 * Preview an `apply_patch` call as the runtime's own card does.
 *
 * Additions carry their full new content, updates carry their hunk text, and
 * deletions have no diff text, so a deletion appears only among the locations.
 * A move names both its source and its destination among the locations.
 */
export function presentPatchCall(patch: string): PatchCallView | undefined {
  const operations = parsePatchPreview(patch)
  if (operations === undefined) return undefined
  const diffs: FileDiff[] = []
  const paths = new Set<string>()
  for (const operation of operations) {
    paths.add(operation.path)
    if (operation.moveTo !== undefined) paths.add(operation.moveTo)
    if (operation.kind === 'add') {
      diffs.push({ path: operation.path, oldText: null, newText: operation.content })
      continue
    }
    if (operation.kind !== 'update') continue
    const oldText = operation.hunks.flatMap(hunk => hunk.oldLines).join('\n')
    const newText = operation.hunks.flatMap(hunk => hunk.newLines).join('\n')
    diffs.push({ path: operation.path, oldText: oldText === '' ? null : oldText, newText })
  }
  const count = paths.size
  return {
    card: 'diff',
    title: `Apply patch (${String(count)} ${count === 1 ? 'file' : 'files'})`,
    diffs,
    locations: [...paths].map(path => ({ path })),
  }
}

/** The raw patch argument, when the tool was called with the expected shape. */
function patchArgument(raw: unknown): string | undefined {
  const args = toolArguments(raw)
  return typeof args?.input === 'string' ? args.input : undefined
}

/**
 * Present an `apply_patch` result.
 *
 * The runtime's result metadata carries the applied hunks for updates and
 * deletions and omits created files (as `write` does), plus a `stopped` flag for
 * a commit that did not finish. Only known applied effects are shown: when the
 * result is stopped, the card carries the metadata hunks under a stopped title;
 * when it completed, a created file may be added because every operation ran.
 * A result whose metadata is missing or malformed falls back to a generic card
 * instead of claiming an effect nobody reported.
 */
export function presentPatchResult(raw: unknown, event: DshEvent): RecordValue {
  const text = toolResultText(event)
  const meta = toolRecord(toolRecord(event.data)?.meta)
  const applied = diffsFromMeta(meta)
  const stopped = meta?.stopped === true
  const patch = patchArgument(raw)
  const call = patch === undefined ? undefined : presentPatchCall(patch)
  if (stopped) {
    if (applied !== undefined && applied.length > 0) return { card: 'diff', title: 'Apply patch (stopped)', diffs: applied }
    return { card: 'generic', title: 'Apply patch (stopped)', content: [{ type: 'text', text }] }
  }
  if (applied !== undefined && applied.length > 0) {
    const appliedByPath = new Map(applied.map(diff => [diff.path, diff]))
    const diffs: FileDiff[] = []
    const used = new Set<string>()
    if (call !== undefined) for (const diff of call.diffs) {
      const actual = appliedByPath.get(diff.path)
      if (actual !== undefined) {
        diffs.push(actual)
        used.add(actual.path)
      } else if (diff.oldText === null) {
        // A creation has no metadata hunk; the whole patch completed, so the
        // content previewed at call time is the content that was written.
        diffs.push(diff)
      }
    }
    for (const diff of applied) if (!used.has(diff.path)) diffs.push(diff)
    return { card: 'diff', title: 'Apply patch', diffs }
  }
  if (applied !== undefined && call !== undefined) {
    const created = call.diffs.filter(diff => diff.oldText === null)
    if (created.length > 0) return { card: 'diff', title: 'Apply patch', diffs: created }
  }
  return { card: 'generic', title: 'Apply patch', content: [{ type: 'text', text }] }
}

export function toolResultText(event: DshEvent): string {
  const message = toolRecord(toolRecord(event.data)?.message)
  const result = Array.isArray(message?.content) ? toolRecord(message.content[0]) : undefined
  if (typeof result?.content === 'string') return result.content
  if (!Array.isArray(result?.content)) return ''
  return result.content.flatMap(value => {
    const part = toolRecord(value)
    return part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []
  }).join('\n')
}

/** A successful write can have no hunks for a create, a no-op, or an oversized diff basis. */
export function writeCreated(event: DshEvent): boolean {
  return /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\nCreated file\n<\/content>$/.test(toolResultText(event))
}

/** Mirror the official Bash/PowerShell trailing status-marker contract on replay. */
function shellResult(text: string): RecordValue {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { output: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined && Number.isSafeInteger(Number(exit[1]))) {
    return { output: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  }
  return { output: text, exitCode: 0 }
}

export function presentToolCall(name: string, raw: unknown): RecordValue | undefined {
  const args = toolArguments(raw)
  if (args === undefined) return undefined
  // A Codex-style patch carries every operation inside one `input` string, so
  // its card is built from that text rather than from a file_path argument.
  if (name === 'apply_patch' && typeof args.input === 'string') return presentPatchCall(args.input)
  const mutation = fileMutation(name, args)
  if (mutation !== undefined) return { card: 'diff', title: `${name === 'write' ? 'Write' : 'Edit'} ${mutation.path}`,
    diffs: [mutationDiff(mutation)], locations: [{ path: mutation.path }] }
  if (name === 'read' && typeof args.file_path === 'string') return { card: 'generic', title: `Read ${args.file_path}`,
    locations: [{ path: args.file_path, line: typeof args.offset === 'number' ? args.offset : 1 }] }
  if ((name === 'bash' || name === 'pwsh') && typeof args.command === 'string') {
    if (args.run_in_background === true) return { card: 'generic', title: args.command,
      ...(typeof args.description === 'string' ? { content: [{ type: 'text', text: args.description }] } : {}) }
    const cwd = typeof args.workdir === 'string' ? args.workdir : args.cwd
    return { card: 'terminal', title: args.command, ...(typeof cwd === 'string' ? { cwd } : {}),
      ...(typeof args.description === 'string' ? { description: args.description } : {}) }
  }
  if ((name === 'grep' || name === 'glob') && typeof args.pattern === 'string') {
    return { card: 'generic', title: `${name === 'grep' ? 'Grep' : 'Glob'} ${args.pattern}` }
  }
  return undefined
}

/** Rebuild built-in cards from durable events; never execute plugin presenter code in VS Code. */
export function presentToolResult(name: string, raw: unknown, event: DshEvent, failed: boolean): RecordValue | undefined {
  const data = toolRecord(event.data)
  const meta = toolRecord(data?.meta)
  const call = presentToolCall(name, raw)
  const text = toolResultText(event)
  if (call === undefined && text === '' && meta === undefined) return undefined
  const generic: RecordValue = { card: 'generic', ...(call?.title === undefined ? {} : { title: call.title }), content: [{ type: 'text', text }] }
  if (failed) return generic
  if (name === 'apply_patch') return presentPatchResult(raw, event)
  const mutation = fileMutation(name, raw)
  if (mutation !== undefined) {
    const diffs = diffsFromMeta(meta)
    if (diffs !== undefined && diffs.length > 0) return { card: 'diff', title: call?.title, diffs }
    if (mutation.kind === 'write' && writeCreated(event)) return { card: 'diff', title: call?.title, diffs: [mutationDiff(mutation)] }
    return generic
  }
  if (name === 'read' && meta !== undefined) {
    const { path, offset, lines, totalLines } = meta
    if (typeof path === 'string' && Number.isSafeInteger(offset) && (offset as number) > 0
      && Number.isSafeInteger(totalLines) && (totalLines as number) >= 0 && Array.isArray(lines)) {
      let previous = (offset as number) - 1
      const valid = lines.every(value => {
        const line = toolRecord(value)
        if (line === undefined || !Number.isSafeInteger(line.number) || (line.number as number) <= previous
          || (line.number as number) > (totalLines as number) || typeof line.text !== 'string') return false
        previous = line.number as number
        return true
      })
      if (valid) return { card: 'read', title: call?.title, path, offset, lines, totalLines }
    }
  }
  if ((name === 'glob' || name === 'grep') && meta !== undefined && typeof meta.truncated === 'boolean'
    && Number.isSafeInteger(meta.total) && (meta.total as number) >= 0) {
    if (meta.shape === 'paths' && Array.isArray(meta.paths) && meta.paths.every(p => typeof p === 'string')) {
      return { card: 'search', title: call?.title, shape: 'paths', paths: meta.paths, truncated: meta.truncated, total: meta.total }
    }
    if (meta.shape === 'matches' && Array.isArray(meta.files) && meta.files.every(value => {
      const file = toolRecord(value)
      return typeof file?.path === 'string' && Array.isArray(file.matches) && file.matches.every(value => {
        const match = toolRecord(value)
        return typeof match?.line === 'string' && Number.isSafeInteger(match.lineNumber) && (match.lineNumber as number) > 0
      })
    })) return { card: 'search', title: call?.title, shape: 'matches', files: meta.files, truncated: meta.truncated, total: meta.total }
  }
  if ((name === 'bash' || name === 'pwsh') && toolArguments(raw)?.run_in_background !== true) {
    return { card: 'terminal', title: call?.title, ...shellResult(text) }
  }
  return generic
}
