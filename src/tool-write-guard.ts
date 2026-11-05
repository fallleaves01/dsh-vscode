import * as path from 'node:path'
import type { DshEvent } from './conversation.js'

export interface ToolWriteIntent {
  callId: string
  paths: string[]
}

interface UnknownRecord {
  [key: string]: unknown
}

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : undefined
}

/** Last namespace segment of a tool name, which is what DSH dispatches on. */
function toolLeafName(name: string): string {
  return name.toLowerCase().split(/[/:.]/).at(-1) ?? ''
}

function modifyingTool(name: string): boolean {
  const normalized = toolLeafName(name)
  return normalized === 'write'
    || normalized === 'edit'
    || normalized === 'str_replace_editor'
    || normalized === 'apply_patch'
}

const PATCH_BEGIN = '*** Begin Patch'
const PATCH_END = '*** End Patch'
const PATCH_HEREDOC_WRAPPERS = ['<<EOF', "<<'EOF'", '<<"EOF"']
const PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/u
const PATCH_MOVE_HEADER = /^\*\*\* Move to: (.+)$/u

/** Lines of one patch, without a transport heredoc wrapper or blank edges. */
function patchLines(patch: string): string[] {
  const lines = patch.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').split('\n')
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift()
  while (lines.length > 0 && (lines.at(-1) ?? '').trim() === '') lines.pop()
  const first = lines[0]
  const last = lines.at(-1)
  if (first !== undefined && last !== undefined && lines.length >= 4
    && PATCH_HEREDOC_WRAPPERS.includes(first.trim()) && last.trim().endsWith('EOF')) {
    return lines.slice(1, -1)
  }
  return lines
}

/**
 * Extract every path an `apply_patch` input names, before any view exists.
 *
 * A Codex-style patch states each operation in a header line: Add, Update and
 * Delete name one path, and an Update may also move it with a `*** Move to:`
 * line. The dirty-file guard needs those names, not the hunks, so the scan is
 * tolerant of hunk syntax while still requiring the Begin/End envelope. That
 * envelope is also what keeps ordinary text or JSON from being read as a path.
 * Anything unrecognizable returns no paths instead of throwing: a guard that
 * cannot understand a patch must fall back to the runtime's own view.
 */
function pathsFromPatch(patch: string): string[] {
  try {
    const lines = patchLines(patch)
    if (lines[0]?.trim() !== PATCH_BEGIN || lines.at(-1)?.trim() !== PATCH_END) return []
    const paths: string[] = []
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      const file = PATCH_FILE_HEADER.exec(line)
      const move = PATCH_MOVE_HEADER.exec(line)
      const candidate = (file ?? move)?.[1]?.trim() ?? ''
      if (candidate !== '') paths.push(candidate)
    }
    return paths
  } catch {
    return []
  }
}

function parsedArguments(value: unknown): UnknownRecord | undefined {
  if (typeof value !== 'string') return record(value)
  try {
    return record(JSON.parse(value))
  } catch {
    return undefined
  }
}

function pathsFromArguments(name: string, value: unknown): string[] {
  if (!modifyingTool(name)) return []
  const args = parsedArguments(value)
  if (args === undefined) return []
  const direct = ['file_path', 'filePath', 'path'].flatMap(key => {
    const candidate = args[key]
    return typeof candidate === 'string' && candidate.trim() !== '' ? [candidate] : []
  })
  // `apply_patch` carries every operation inside one patch string, so its
  // headers are the only early source of paths when no presenter view arrives.
  const patch = toolLeafName(name) === 'apply_patch' && typeof args.input === 'string'
    ? pathsFromPatch(args.input)
    : []
  return [...direct, ...patch]
}

function pathsFromView(value: unknown): string[] {
  const wrapper = record(value)
  const view = wrapper?.for === 'call' ? record(wrapper.view) : record(value)
  if (view?.card !== 'diff') return []
  // A deletion has no diff text, so its path appears only among the locations;
  // an update or a move lists both there. Reading both keeps a replay without
  // arguments guardable as well.
  const entries = [
    ...(Array.isArray(view.diffs) ? view.diffs : []),
    ...(Array.isArray(view.locations) ? view.locations : []),
  ]
  return entries.flatMap(entry => {
    const candidate = record(entry)?.path
    return typeof candidate === 'string' && candidate.trim() !== '' ? [candidate] : []
  })
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** Extracts pending file mutations early enough to cancel before dispatch when possible. */
export function toolWriteIntents(event: DshEvent, view?: unknown): ToolWriteIntent[] {
  const data = record(event.data)
  if (data === undefined) return []

  if (event.type === 'assistant/message') {
    const message = record(data.message)
    if (!Array.isArray(message?.content)) return []
    return message.content.flatMap((value): ToolWriteIntent[] => {
      const block = record(value)
      if (block?.type !== 'tool-call' || typeof block.id !== 'string' || typeof block.name !== 'string') return []
      const paths = unique(pathsFromArguments(block.name, block.arguments))
      return paths.length === 0 ? [] : [{ callId: block.id, paths }]
    })
  }

  if (event.type !== 'tool/call' || typeof data.callId !== 'string') return []
  const viewPaths = pathsFromView(view)
  const argumentPaths = typeof data.name === 'string' ? pathsFromArguments(data.name, data.arguments) : []
  const paths = unique([...viewPaths, ...argumentPaths])
  return paths.length === 0 ? [] : [{ callId: data.callId, paths }]
}

/** Resolves model-facing tool paths the same way DSH resolves project-relative paths. */
export function absoluteToolPaths(cwd: string, values: readonly string[]): string[] {
  return unique(values.map(value => path.normalize(path.isAbsolute(value) ? value : path.resolve(cwd, value))))
}
