import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessProbe } from './runtime-broker.js'
import { parseProcessIdentity, type RuntimeProcessIdentity } from './runtime-lifetime.js'

export interface RuntimeTransition { release(): void }

/** Refuse links or shared directories before writing authentication material. */
export function privateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (process.getuid !== undefined && stat.uid !== process.getuid())
    || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
    throw new Error('DSH runtime storage must be an owner-only directory, without symbolic links.')
  }
}

interface Claim { pid: number; start?: string; ticket: number; server?: RuntimeProcessIdentity }

/**
 * A filesystem implementation of the bakery algorithm. Each contender owns a
 * unique directory; dead claims can be removed without deleting a successor's
 * lock. No age-based expiry can admit two live starters during a slow launch.
 */
export async function acquireRuntimeTransition(
  directory: string, probe: ProcessProbe,
  options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number; server?: RuntimeProcessIdentity } = {},
): Promise<RuntimeTransition> {
  privateDirectory(directory)
  const id = randomUUID(), staging = join(directory, `.${id}`), own = join(directory, id)
  const deadline = Date.now() + (options.timeoutMs ?? 310_000)
  const cancelled = (): void => {
    if (options.signal?.aborted) throw new Error('DSH runtime stopped.')
    if (Date.now() >= deadline) throw new Error('Timed out waiting for another VS Code window to finish a DSH runtime operation. No additional runtime was started.')
  }
  const start = await probe.startTime(process.pid)
  cancelled()
  const claim: Claim = { pid: process.pid, ticket: 0, ...(start === undefined ? {} : { start }),
    ...(options.server === undefined ? {} : { server: options.server }) }
  const write = (path: string): void => {
    const temp = join(path, 'next.json')
    writeFileSync(temp, JSON.stringify(claim), { mode: 0o600, flag: 'wx' })
    renameSync(temp, join(path, 'owner.json'))
  }
  // Publish the owner and the choosing flag together, never an empty lock.
  mkdirSync(staging, { mode: 0o700 })
  write(staging)
  renameSync(staging, own)
  const identities = new Map<string, { checked: number; live: boolean }>()
  const readClaims = async (): Promise<Array<{ id: string; claim: Claim }>> => {
    const names = readdirSync(directory).filter(name => /^[a-f0-9-]{36}$/.test(name))
    if (names.length > 128) throw new Error('Too many pending DSH runtime operations. No additional runtime was started.')
    const result: Array<{ id: string; claim: Claim }> = []
    for (const name of names) {
      if (name === id) continue
      let other: Claim
      try {
        const file = join(directory, name, 'owner.json')
        if (lstatSync(file).size > 2_048) throw new Error('Invalid DSH runtime operation record.')
        other = JSON.parse(readFileSync(file, 'utf8')) as Claim
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      if (!Number.isSafeInteger(other.pid) || other.pid <= 0
        || !Number.isSafeInteger(other.ticket) || other.ticket < 0
        || (other.start !== undefined && typeof other.start !== 'string')
        || (other.server !== undefined && parseProcessIdentity(other.server) === undefined)) throw new Error('Invalid DSH runtime operation record.')
      let live = probe.isAlive(other.pid)
      if (live && (other.start !== undefined || other.server !== undefined)) {
        const cached = identities.get(name)
        if (cached !== undefined && Date.now() - cached.checked < 2_000) live = cached.live
        else {
          if (other.start !== undefined) {
            const actual = await probe.startTime(other.pid)
            live = actual === undefined || actual === other.start
          }
          if (live && other.server !== undefined) {
            live = probe.isAlive(other.server.pid)
            if (live) {
              const actual = await probe.startTime(other.server.pid)
              live = actual === undefined || actual === other.server.startTime
            }
          }
          identities.set(name, { checked: Date.now(), live })
        }
      }
      if (!live) { rmSync(join(directory, name), { recursive: true, force: true }); continue }
      result.push({ id: name, claim: other })
    }
    return result
  }
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    rmSync(own, { recursive: true, force: true })
  }
  try {
    claim.ticket = 1 + Math.max(0, ...(await readClaims()).map(other => other.claim.ticket))
    write(own)
    for (;;) {
      cancelled()
      const others = await readClaims()
      if (!others.some(other => other.claim.ticket === 0 || other.claim.ticket < claim.ticket
        || (other.claim.ticket === claim.ticket && other.id < id))) return { release }
      await new Promise<void>((resolve, reject) => {
        const finish = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); resolve() }
        const abort = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(new Error('DSH runtime stopped.')) }
        const timer = setTimeout(finish, options.pollMs ?? 75)
        options.signal?.addEventListener('abort', abort, { once: true })
        if (options.signal?.aborted) abort()
      })
    }
  } catch (error) { release(); throw error }
}
