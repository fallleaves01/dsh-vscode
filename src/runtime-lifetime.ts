import { closeSync, openSync, readSync } from 'node:fs'
import type { ProcessProbe } from './runtime-broker.js'

/** Only process identities are persisted; never command lines or environment. */
export interface RuntimeProcessIdentity { readonly pid: number; readonly startTime: string }

export function parseProcessIdentity(value: unknown): RuntimeProcessIdentity | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  if (!Number.isSafeInteger(item.pid) || Number(item.pid) <= 0
    || typeof item.startTime !== 'string' || item.startTime === '') return undefined
  return { pid: Number(item.pid), startTime: item.startTime }
}

/** Bounded procfs reads, never a process-table scan or a subprocess. */
function readProc(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(32 * 1024)
    const length = readSync(fd, buffer, 0, buffer.length, 0)
    if (length === buffer.length) throw new Error('Process metadata exceeds the runtime inspection limit.')
    return buffer.toString('utf8', 0, length)
  } finally { closeSync(fd) }
}

/** Resolve the actual Linux Remote–SSH server from this extension host's ancestry. */
export async function findVsCodeServer(
  probe: ProcessProbe,
  options: { parentPid?: number; readText?: (file: string) => string } = {},
): Promise<RuntimeProcessIdentity> {
  const read = options.readText ?? readProc
  let pid = options.parentPid ?? process.ppid
  const visited = new Set<number>()
  for (let depth = 0; depth < 8 && pid > 1 && !visited.has(pid); depth++) {
    visited.add(pid)
    const start = await probe.startTime(pid)
    const stat = read(`/proc/${pid}/stat`)
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)
    const args = read(`/proc/${pid}/cmdline`).split('\0')
    if (args.some(arg => /(?:^|\/)out\/server-main\.js$/.test(arg))) {
      if (start === undefined || !probe.isAlive(pid) || await probe.startTime(pid) !== start) break
      return { pid, startTime: start }
    }
    const parent = Number(fields[1])
    if (!Number.isSafeInteger(parent) || parent <= 0) break
    pid = parent
  }
  throw new Error('Could not verify the VS Code Server process for this SSH window. No managed DSH runtime was started. Reload the remote window and retry.')
}

/** Protocol changes require an explicit restart of an older shared host. */
export const RUNTIME_HOST_PROTOCOL = 'ipc-2'
