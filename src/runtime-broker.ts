import { execFile } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { acquireRuntimeTransition, privateDirectory, type RuntimeTransition } from './runtime-lock.js'
import { parseProcessIdentity, RUNTIME_HOST_PROTOCOL, type RuntimeProcessIdentity } from './runtime-lifetime.js'

/**
 * Cross-window DSH runtime broker: descriptors, leases, adoption, dead-file sweep.
 *
 * Why this exists. DSH holds a conversation's write lock — a kernel `flock` on
 * `session.lock` — for as long as a live Agent owns it, and it exposes no API to
 * release one (the whole Remote catalog has only `session/disposed` and
 * `agent/disposed` *events*). The only thing that ever returns a lock is the
 * owning process exiting. That makes the extension host the only releaser, and
 * the extension host can die without running `deactivate` — leaving an orphan
 * runtime that keeps holding every conversation it ever opened.
 *
 * Descriptors and leases also let the runtime host survive the first window and
 * clean up after the last extension host exits.
 *
 * - A **descriptor** records a runtime *this extension* spawned — pid, process
 *   start time, a configuration fingerprint, and the launch URL — so a later
 *   window can *adopt* it instead of spawning a second one.
 * - A **lease** per extension host makes "does anybody still want this runtime"
 *   a fact that survives a crash. Liveness is proved by pid + start time, never
 *   by a stored counter: a counter cannot be decremented by a process that was
 *   killed.
 * - Cleanup removes only files whose process is **provably** gone. Nothing here
 *   ever kills a process it did not spawn and cannot identify.
 *
 * A runtime the user started themselves writes no descriptor — DSH has no
 * pidfile, port file or token file at all — so it can never be mistaken for one
 * of ours, and it is never listed as terminable.
 *
 * Nothing in this module imports `vscode`, and every platform primitive (process
 * liveness, `ps`, `lsof`) is injectable, so the whole policy is unit-testable.
 */

/** Reject descriptors and leases written by a different broker version. */
export const BROKER_SCHEMA = 1

/** Ceiling on the lock paths handed to one `lsof`, to keep the argument vector valid. */
const MAX_LOCK_PATHS = 4_000

/** How this runtime's configuration must match before another window adopts it. */
export interface RuntimeFingerprint {
  readonly dshHome: string
  readonly executable: string
  readonly arguments: readonly string[]
  readonly extensionVersion: string
  readonly runtimeVersion?: string
  /** HMAC of explicit launcher overrides; never a plaintext credential. */
  readonly environmentDigest?: string
  /** Changes only when the runtime-host contract changes, not for UI updates. */
  readonly hostProtocol?: string
}

/**
 * One recorded DSH runtime.
 *
 * Two shapes, and the difference is who owns the process:
 *
 * - **`manageable: true`** — a runtime this extension spawned. It carries the pid
 *   and the configuration fingerprint, which is what lets a later window decide
 *   whether attaching is appropriate and (last resort) end it.
 * - **`manageable: false`** — an *attach-only* runtime the user started and asked
 *   this extension to remember. There is no pid to record and no fingerprint to
 *   compare: this extension did not start it, does not know how it was started, and
 *   must never signal it. Its identity is proved solely by authenticating the stored
 *   launch URL, which is also the only thing about it that can go stale.
 */
export interface RuntimeDescriptor {
  readonly schema: number
  readonly origin: 'dsh-sidebar'
  /** False means attach-only: never terminate it, even when the last lease goes. */
  readonly manageable: boolean
  /** The window that recorded it (diagnostics only; leases decide ownership). */
  readonly instanceId: string
  /** Absent for an attach-only runtime: this extension never learned its pid. */
  readonly pid?: number
  /** `ps -o lstart=` of the pid, when the platform can report it. */
  readonly processStartTime?: string
  /** The supervisor, for recovery if it exits while DSH is still alive. */
  readonly host?: RuntimeProcessIdentity
  readonly startedAt: number
  readonly cwd: string
  /** Absent for an attach-only runtime: its launch configuration is unknown. */
  readonly fingerprint?: RuntimeFingerprint
  /**
   * Launch URL including its token. **Secret**: never logged, never published to
   * the Webview, never put in `globalState`. It is the only way another window can
   * authenticate to a runtime it did not spawn, because DSH prints the URL exactly
   * once and keeps the token in process memory.
   */
  readonly launchUrl: string
}

/** One extension host that currently wants the runtime. */
export interface RuntimeLease {
  readonly schema: number
  readonly instanceId: string
  readonly pid: number
  readonly processStartTime?: string
  readonly createdAt: number
  /**
   * The runtime this window is using, so a release can prove *which* runtime the
   * caller actually used. Without it, a lease could be presented as evidence for a
   * runtime another window has since recorded over the top of it.
   */
  readonly runtimePid?: number
  /** Linux Remote–SSH server that owns this particular extension host. */
  readonly server?: RuntimeProcessIdentity
}

/** The platform facts the policy needs. Injected so tests never touch real processes. */
export interface ProcessProbe {
  /** Whether a process with this pid exists (or exists under another user). */
  isAlive(pid: number): boolean
  /** The process's start time as a stable string, or undefined when unknowable. */
  startTime(pid: number): Promise<string | undefined>
}

export type ExecFileLike = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string }>

export type AdoptionDecision =
  | { readonly action: 'spawn'; readonly reason: string }
  | { readonly action: 'adopt'; readonly descriptor: RuntimeDescriptor }
  | { readonly action: 'ignore'; readonly descriptor: RuntimeDescriptor; readonly reason: string }

/** What `release` decided about the runtime, before the caller terminates anything. */
export interface ReleaseOutcome {
  /** Present only when this window was the last user of a runtime it may stop. */
  readonly stop?: RuntimeDescriptor
  /**
   * How the process behind {@link stop} was identified.
   *
   * `proved` means this machine could tie the pid to the recorded runtime on its
   * own (a matching process start time), so it can be signalled directly.
   * `unproved` means the pid is alive but could belong to whatever reused it, so
   * the caller must prove the instance first — the runtime's launch token is
   * minted per process and never persisted, so authenticating with it proves that
   * exact instance is alive, which in turn proves its pid was not reused.
   */
  readonly stopIdentity?: 'proved' | 'unproved'
  /** Diagnostics for the output channel. Never contains the launch URL. */
  readonly notes: readonly string[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
    ? [...value] as string[]
    : undefined
}

/** A pid or session id is never allowed to become a path segment. */
function safeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..'
}

/**
 * Whether two windows are configured to run the same thing.
 *
 * A mismatch prevents automatic adoption and replacement. A UI-only extension
 * update does not change the runtime configuration.
 */
export function fingerprintsMatch(left: RuntimeFingerprint, right: RuntimeFingerprint): boolean {
  return fingerprintDifferences(left, right).length === 0
}

/** Field names only: arguments and environment values can contain credentials. */
export function fingerprintDifferences(left: RuntimeFingerprint, right: RuntimeFingerprint): string[] {
  const differences: string[] = []
  if (left.dshHome !== right.dshHome) differences.push('DSH home')
  if (left.executable !== right.executable) differences.push('executable')
  if (left.arguments.length !== right.arguments.length
    || left.arguments.some((value, index) => value !== right.arguments[index])) differences.push('arguments')
  if (left.runtimeVersion !== undefined && right.runtimeVersion !== undefined
    && left.runtimeVersion !== right.runtimeVersion) differences.push('DSH version')
  if (left.hostProtocol !== right.hostProtocol) differences.push('runtime-host protocol')
  if (left.environmentDigest !== right.environmentDigest) differences.push('launcher environment')
  return differences
}

function parseFingerprint(value: unknown): RuntimeFingerprint | undefined {
  const source = record(value)
  if (source === undefined) return undefined
  const dshHome = text(source.dshHome)
  const executable = text(source.executable)
  const extensionVersion = text(source.extensionVersion)
  const args = stringList(source.arguments)
  if (dshHome === undefined || executable === undefined || extensionVersion === undefined || args === undefined) return undefined
  return { dshHome, executable, extensionVersion, arguments: args,
    ...(text(source.runtimeVersion) === undefined ? {} : { runtimeVersion: text(source.runtimeVersion)! }),
    ...(text(source.hostProtocol) === undefined ? {} : { hostProtocol: text(source.hostProtocol)! }),
    ...(text(source.environmentDigest) === undefined ? {} : { environmentDigest: text(source.environmentDigest)! }) }
}

export function parseDescriptor(source: string): RuntimeDescriptor | undefined {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return undefined
  }
  const entry = record(value)
  if (entry === undefined || entry.schema !== BROKER_SCHEMA || entry.origin !== 'dsh-sidebar') return undefined
  const instanceId = text(entry.instanceId)
  const startedAt = count(entry.startedAt)
  const cwd = text(entry.cwd)
  const launchUrl = text(entry.launchUrl)
  if (instanceId === undefined || startedAt === undefined || cwd === undefined
    || launchUrl === undefined || typeof entry.manageable !== 'boolean') return undefined
  const pid = count(entry.pid)
  const fingerprint = parseFingerprint(entry.fingerprint)
  const processStartTime = text(entry.processStartTime)
  const host = parseProcessIdentity(entry.host)
  if (entry.host !== undefined && host === undefined) return undefined
  // A runtime this extension started must be identified by its process and the
  // configuration it was started with; that is what makes ending it defensible.
  // An attach-only runtime has neither, and relies on its launch URL alone.
  if (entry.manageable && (pid === undefined || fingerprint === undefined)) return undefined
  return {
    schema: BROKER_SCHEMA, origin: 'dsh-sidebar', manageable: entry.manageable,
    instanceId, startedAt, cwd, launchUrl,
    ...pid === undefined ? {} : { pid },
    ...fingerprint === undefined ? {} : { fingerprint },
    ...processStartTime === undefined ? {} : { processStartTime },
    ...host === undefined ? {} : { host },
  }
}

export function parseLease(source: string): RuntimeLease | undefined {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return undefined
  }
  const entry = record(value)
  if (entry === undefined || entry.schema !== BROKER_SCHEMA) return undefined
  const instanceId = text(entry.instanceId)
  const pid = count(entry.pid)
  const createdAt = count(entry.createdAt)
  const processStartTime = text(entry.processStartTime)
  const runtimePid = count(entry.runtimePid)
  const server = parseProcessIdentity(entry.server)
  if (entry.server !== undefined && server === undefined) return undefined
  if (instanceId === undefined || pid === undefined || createdAt === undefined) return undefined
  return {
    schema: BROKER_SCHEMA, instanceId, pid, createdAt,
    ...processStartTime === undefined ? {} : { processStartTime },
    ...runtimePid === undefined ? {} : { runtimePid },
    ...server === undefined ? {} : { server },
  }
}

/** Drop the secret before anything reaches a log, a notice or the Webview. */
export function describeDescriptor(descriptor: RuntimeDescriptor): string {
  const started = new Date(descriptor.startedAt).toISOString()
  if (descriptor.manageable) {
    return `pid ${String(descriptor.pid)} (${descriptor.fingerprint?.executable ?? 'dsh'}, started ${started})`
  }
  // An attach-only runtime has no pid to name, and its origin is what matters.
  return `the DSH runtime you saved (started ${started})`
}

/**
 * What can be established about a recorded pid.
 *
 * The three answers exist because cleanup and termination need opposite defaults.
 * Cleaning a file for a process that turns out to be alive costs a retry; ending a
 * process that merely reused the pid costs somebody's work — or somebody else's
 * process. So cleanup treats "cannot tell" as alive, and termination requires
 * `alive`: a positive identity match.
 */
type ProcessState = 'dead' | 'alive' | 'unknown'

async function processState(probe: ProcessProbe, pid: number, expected: string | undefined): Promise<ProcessState> {
  if (!probe.isAlive(pid)) return 'dead'
  // Without a recorded start time there is nothing to compare against, so the pid
  // alone cannot be tied to the recorded process.
  if (expected === undefined || expected.length === 0) return 'unknown'
  const actual = await probe.startTime(pid)
  if (actual === undefined) return 'unknown'
  // Legacy records used localized ps timestamps. A different identity format
  // is not evidence of PID reuse; authenticate that runtime instead.
  if (actual.startsWith('linux:') !== expected.startsWith('linux:')) return 'unknown'
  // A different start time is positive proof that the pid was reused.
  return actual === expected ? 'alive' : 'dead'
}

/** Liveness for cleanup and adoption: only *proof* of death counts as gone. */
async function stillRunning(probe: ProcessProbe, pid: number, expected: string | undefined): Promise<boolean> {
  return await processState(probe, pid, expected) !== 'dead'
}

/** Linux identity uses boot id + start ticks; other POSIX hosts use ps. */
export function nodeProcessProbe(options: {
  exec?: ExecFileLike; platform?: NodeJS.Platform; readText?: (path: string) => string
} = {}): ProcessProbe {
  const exec = options.exec ?? run
  const platform = options.platform ?? process.platform
  const readText = options.readText ?? (path => readFileSync(path, 'utf8'))
  let bootId: string | undefined
  return {
    isAlive(pid: number): boolean {
      // `pid 0` means "every process in this process group" to `kill(2)`, and a
      // negative pid means a group too. A record can legitimately carry no pid at
      // all (an attach-only runtime), so this guard is load-bearing: without it a
      // liveness check would signal the whole group.
      if (!Number.isSafeInteger(pid) || pid <= 0) return false
      if (platform === 'linux') {
        try {
          const stat = readText(`/proc/${pid}/stat`)
          const state = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[0]
          if (state === 'Z' || state === 'X') return false
        } catch { /* kill(0) remains the conservative fallback. */ }
      }
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        // EPERM means it exists under another user; ESRCH means it is gone.
        return (error as NodeJS.ErrnoException).code === 'EPERM'
      }
    },
    async startTime(pid: number): Promise<string | undefined> {
      if (platform === 'win32') return undefined
      if (platform === 'linux') {
        try {
          bootId ??= readText('/proc/sys/kernel/random/boot_id').trim()
          const stat = readText(`/proc/${pid}/stat`)
          // comm is parenthesized and may itself contain spaces or parentheses.
          const end = stat.lastIndexOf(')')
          const ticks = end < 0 ? undefined : stat.slice(end + 1).trim().split(/\s+/)[19]
          if (bootId !== '' && ticks !== undefined && /^\d+$/.test(ticks)) return `linux:${bootId}:${ticks}`
        } catch { /* Restricted /proc: retain the conservative ps fallback. */ }
      }
      try {
        // `lstart` is a fixed-format, locale-independent timestamp. It is only
        // ever compared with another reading of the same pid on this machine.
        const { stdout } = await exec('ps', ['-o', 'lstart=', '-p', String(pid)])
        const value = stdout.trim()
        return value === '' ? undefined : value
      } catch {
        return undefined
      }
    },
  }
}

function run(file: string, args: readonly string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error instanceof Error ? error : new Error(String(error)))
      else resolve({ stdout })
    })
  })
}

/**
 * Descriptors, leases and the sweep policy for one machine.
 *
 * `stateDir` is per host, account and DSH home, independent of VS Code profiles.
 * Callers hold acquireTransition() across lookup, startup, registration and
 * shutdown; atomic JSON writes alone cannot serialize those operations.
 */
export class RuntimeBroker {
  private readonly rootDir: string
  private readonly legacyStateDir: string | undefined
  private readonly probe: ProcessProbe
  private readonly serverOwner: (() => Promise<RuntimeProcessIdentity>) | undefined
  private serverIdentity: Promise<RuntimeProcessIdentity> | undefined

  constructor(options: { stateDir: string; legacyStateDir?: string; probe?: ProcessProbe; serverOwner?: () => Promise<RuntimeProcessIdentity> }) {
    this.rootDir = options.stateDir
    this.legacyStateDir = options.legacyStateDir
    this.probe = options.probe ?? nodeProcessProbe()
    this.serverOwner = options.serverOwner
  }

  async currentServer(): Promise<RuntimeProcessIdentity | undefined> {
    if (this.serverOwner === undefined) return undefined
    this.serverIdentity ??= this.serverOwner()
    const server = await this.serverIdentity
    if (!await this.isRecordRunning(server.pid, server.startTime)) throw new Error('The VS Code Server owning this window has exited. Reconnect before starting DSH.')
    return server
  }

  get sharedDirectory(): string { return this.rootDir }

  /** A migrated runtime retains its original ledger so old windows see leases. */
  get ledgerDirectory(): string {
    const pointer = join(this.rootDir, 'ledger.json')
    try {
      const stat = lstatSync(pointer)
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8_192
        || (process.getuid !== undefined && stat.uid !== process.getuid())
        || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('Unsafe DSH runtime ledger pointer.')
      const value: unknown = JSON.parse(readFileSync(pointer, 'utf8'))
      if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Invalid DSH runtime ledger pointer.')
      privateDirectory(value)
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return this.rootDir
    }
  }

  private get stateDir(): string { return this.ledgerDirectory }

  async acquireTransition(options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {}): Promise<RuntimeTransition> {
    privateDirectory(this.rootDir)
    const server = await this.currentServer()
    const lock = await acquireRuntimeTransition(join(this.rootDir, 'operations'), this.probe,
      { ...options, ...(server === undefined ? {} : { server }) })
    try {
      const pointer = join(this.rootDir, 'ledger.json')
      if (!existsSync(pointer) && this.legacyStateDir !== undefined
        && existsSync(join(this.legacyStateDir, 'runtime.json')) && !existsSync(join(this.rootDir, 'runtime.json'))) {
        privateDirectory(this.legacyStateDir)
        const temp = `${pointer}.${randomUUID()}.tmp`
        writeFileSync(temp, JSON.stringify(this.legacyStateDir), { mode: 0o600, flag: 'wx' })
        renameSync(temp, pointer)
      }
      // Resolve and validate before handing the transition to the caller.
      void this.ledgerDirectory
      return lock
    } catch (error) { lock.release(); throw error }
  }

  environmentDigest(environment: Readonly<Record<string, string | undefined>>): string | undefined {
    const entries = Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined).sort(([a], [b]) => a.localeCompare(b))
    if (entries.length === 0) return undefined
    privateDirectory(this.rootDir)
    const file = join(this.rootDir, 'environment.key')
    if (!existsSync(file)) {
      try { writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32
      || (process.getuid !== undefined && stat.uid !== process.getuid())
      || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('Unsafe DSH runtime environment key.')
    return createHmac('sha256', readFileSync(file)).update(JSON.stringify(entries)).digest('hex')
  }

  async reserveStartup(hostPid: number, instanceId: string): Promise<void> {
    this.ensure(false)
    const startTime = await this.probe.startTime(hostPid)
    writeFileSync(join(this.stateDir, 'starting.json'), JSON.stringify({ hostPid, instanceId, startTime }), { mode: 0o600, flag: 'wx' })
  }

  markStartupLaunched(instanceId: string, runtimePid?: number, runtimeStartTime?: string, hostProtocol?: string): void {
    const file = join(this.stateDir, 'starting.json')
    const value = JSON.parse(readFileSync(file, 'utf8')) as { instanceId?: string }
    if (value.instanceId !== instanceId) throw new Error('DSH startup reservation changed before launch.')
    const temp = `${file}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify({ ...value, launchRequested: true, ...(runtimePid === undefined ? {} : { runtimePid }),
      ...(runtimeStartTime === undefined ? {} : { runtimeStartTime }), ...(hostProtocol === undefined ? {} : { hostProtocol }) }), { mode: 0o600, flag: 'wx' })
    renameSync(temp, file)
  }

  clearStartup(instanceId: string, hostPid?: number): void {
    const file = join(this.stateDir, 'starting.json')
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as { instanceId?: unknown; hostPid?: unknown }
      if (value.instanceId === instanceId && (hostPid === undefined || value.hostPid === hostPid)) rmSync(file)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  async waitForStartup(signal?: AbortSignal, timeoutMs = 310_000, recoverAbandoned = false): Promise<void> {
    const file = join(this.stateDir, 'starting.json'), deadline = Date.now() + timeoutMs
    let checkedAt = 0, checkedOwner = ''
    while (existsSync(file)) {
      if (signal?.aborted) throw new Error('DSH runtime stopped.')
      const value = JSON.parse(readFileSync(file, 'utf8')) as { hostPid: number; instanceId: string; startTime?: string;
        launchRequested?: boolean; runtimePid?: number; runtimeStartTime?: string; hostProtocol?: string }
      if (!Number.isSafeInteger(value.hostPid) || value.hostPid <= 0 || typeof value.instanceId !== 'string'
        || (value.runtimePid !== undefined && (!Number.isSafeInteger(value.runtimePid) || value.runtimePid <= 0))
        || (value.launchRequested !== undefined && typeof value.launchRequested !== 'boolean')
        || (value.startTime !== undefined && typeof value.startTime !== 'string')
        || (value.runtimeStartTime !== undefined && typeof value.runtimeStartTime !== 'string')
        || (value.hostProtocol !== undefined && typeof value.hostProtocol !== 'string')) throw new Error('Invalid DSH runtime startup record.')
      const owner = `${value.hostPid}:${value.startTime ?? ''}`
      let live = this.probe.isAlive(value.hostPid)
      if (live && (owner !== checkedOwner || Date.now() - checkedAt >= 2_000)) {
        live = await stillRunning(this.probe, value.hostPid, value.startTime)
        checkedOwner = owner; checkedAt = Date.now()
      }
      if (!live) {
        const state = value.runtimePid === undefined ? 'unknown' : await processState(this.probe, value.runtimePid, value.runtimeStartTime)
        if (value.launchRequested && state !== 'dead') {
          if (!recoverAbandoned || state !== 'alive' || value.runtimePid === undefined || value.hostProtocol !== RUNTIME_HOST_PROTOCOL) {
            throw new Error(`The DSH runtime host exited during startup${value.runtimePid === undefined ? '' : ` (DSH pid ${value.runtimePid})`}. A running DSH process cannot be ruled out. The startup record was retained; no additional runtime was started.`)
          }
          const recorded = this.readDescriptor()
          if (recorded !== undefined && (!recorded.manageable || recorded.instanceId !== value.instanceId || recorded.pid !== value.runtimePid)) {
            throw new Error('The saved runtime differs from the abandoned startup. Its record was retained; no additional runtime was started.')
          }
          await this.assertNoRuntimeUsers(value.runtimePid)
          if (signal?.aborted) throw new Error('DSH runtime stopped.')
          // A startup may die before there is an authentication URL. This local
          // descriptor is only a signalling input, never persisted or adopted.
          if (!await this.stop({ schema: BROKER_SCHEMA, origin: 'dsh-sidebar', manageable: true,
            instanceId: value.instanceId, pid: value.runtimePid, processStartTime: value.runtimeStartTime!,
            startedAt: Date.now(), cwd: this.stateDir, launchUrl: '' }, { processGroup: true })) {
            throw new Error('The abandoned DSH startup could not be stopped. Its record was retained; no additional runtime was started.')
          }
        }
        this.clearStartup(value.instanceId, value.hostPid); return
      }
      if (Date.now() >= deadline) throw new Error('Another DSH runtime is still starting. No additional runtime was started.')
      await delay(100)
    }
  }

  private async assertNoRuntimeUsers(pid: number): Promise<void> {
    if ((await this.liveLeases()).some(lease => lease.runtimePid === undefined || lease.runtimePid === pid)) {
      throw new Error('The DSH runtime host exited, but another VS Code window still uses that runtime. Use Restart Runtime to review a shared restart. No additional runtime was started.')
    }
  }

  /** Caller holds the transition lock. Recover before authentication or a new turn. */
  async recoverAbandonedRuntime(signal?: AbortSignal): Promise<boolean> {
    const descriptor = this.readDescriptor(), host = descriptor?.host
    if (descriptor === undefined || !descriptor.manageable || descriptor.pid === undefined || host === undefined) return false
    if (await processState(this.probe, host.pid, host.startTime) !== 'dead') return false
    const runtimeState = await this.recordProcessState(descriptor)
    if (runtimeState === 'unknown') {
      throw new Error('The DSH runtime host exited, but the remaining DSH process identity cannot be verified. Its record was retained; no additional runtime was started.')
    }
    if (runtimeState === 'alive') await this.assertNoRuntimeUsers(descriptor.pid)
    if (signal?.aborted) throw new Error('DSH runtime stopped.')
    if (!await this.stop(descriptor, { processGroup: descriptor.fingerprint?.hostProtocol === RUNTIME_HOST_PROTOCOL })) {
      throw new Error('The abandoned DSH runtime could not be stopped. Its record was retained; no additional runtime was started.')
    }
    this.clearStartup(descriptor.instanceId, host.pid)
    return true
  }

  private get descriptorFile(): string { return join(this.stateDir, 'runtime.json') }
  private get leaseDir(): string { return join(this.stateDir, 'holds') }
  private leaseFile(instanceId: string): string {
    if (!safeSegment(instanceId)) throw new Error('Invalid broker instance id.')
    return join(this.leaseDir, `${instanceId}.json`)
  }

  /** Create the state directory with owner-only permissions, or reuse it. */
  private ensure(deep: boolean): void {
    if (!deep) {
      privateDirectory(this.stateDir)
      return
    }
    privateDirectory(this.stateDir)
    privateDirectory(this.leaseDir)
  }

  readDescriptor(): RuntimeDescriptor | undefined {
    try {
      return parseDescriptor(readFileSync(this.descriptorFile, 'utf8'))
    } catch {
      return undefined
    }
  }

  /** Atomic replace, owner-only: a reader never sees a half-written descriptor. */
  writeDescriptor(descriptor: RuntimeDescriptor): void {
    this.ensure(false)
    const temp = `${this.descriptorFile}.${randomUUID()}.tmp`
    writeFileSync(temp, `${JSON.stringify(descriptor, undefined, 2)}\n`, { mode: 0o600 })
    renameSync(temp, this.descriptorFile)
  }

  clearDescriptor(): void {
    rmSync(this.descriptorFile, { force: true })
  }

  /**
   * Record a runtime this window just started, so a later window can attach to it.
   *
   * `launchUrl` carries the runtime's authentication token; it is written 0600
   * and must never reach a log, a notice or the Webview.
   */
  async publishOwnedRuntime(input: {
    instanceId: string
    /** Absent only for an attach-only runtime: the user's process, unknown here. */
    pid?: number
    cwd: string
    fingerprint?: RuntimeFingerprint
    launchUrl: string
    manageable?: boolean
    host?: RuntimeProcessIdentity
  }): Promise<RuntimeDescriptor> {
    const startTime = input.pid === undefined ? undefined : await this.probe.startTime(input.pid)
    const descriptor: RuntimeDescriptor = {
      schema: BROKER_SCHEMA,
      origin: 'dsh-sidebar',
      manageable: input.manageable ?? true,
      instanceId: input.instanceId,
      startedAt: Date.now(),
      cwd: input.cwd,
      launchUrl: input.launchUrl,
      ...input.pid === undefined ? {} : { pid: input.pid },
      ...input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint },
      ...startTime === undefined ? {} : { processStartTime: startTime },
      ...input.host === undefined ? {} : { host: input.host },
    }
    this.writeDescriptor(descriptor)
    return descriptor
  }

  readLeases(strict = false): RuntimeLease[] {
    let names: string[]
    try {
      names = readdirSync(this.leaseDir)
    } catch (error) {
      if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return []
    }
    const leases: RuntimeLease[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const file = join(this.leaseDir, name)
        const stat = lstatSync(file)
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8_192) throw new Error('Invalid DSH runtime lease file.')
        const lease = parseLease(readFileSync(file, 'utf8'))
        if (lease !== undefined) leases.push(lease)
        else if (strict) throw new Error('An unreadable DSH runtime lease prevents safe shutdown.')
      } catch (error) {
        if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return leases
  }

  /**
   * Whether a recorded process is still there.
   *
   * Only proof of death counts as gone, so a platform that cannot report a start
   * time keeps a record rather than dropping a runtime that may still be serving.
   */
  async isRecordRunning(pid: number | undefined, processStartTime?: string): Promise<boolean> {
    if (pid === undefined) return true
    return await processState(this.probe, pid, processStartTime) !== 'dead'
  }

  /** Positive OS identity can authorize manual recovery even when HTTP is hung. */
  async recordProcessState(descriptor: RuntimeDescriptor): Promise<ProcessState> {
    return descriptor.pid === undefined ? 'unknown'
      : processState(this.probe, descriptor.pid, descriptor.processStartTime)
  }

  /** Leases whose process is still running, judged by pid + start time. */
  async liveLeases(): Promise<RuntimeLease[]> {
    const leases = this.readLeases(true)
    const live: RuntimeLease[] = []
    for (const lease of leases) {
      if (await stillRunning(this.probe, lease.pid, lease.processStartTime)
        && (lease.server === undefined || await stillRunning(this.probe, lease.server.pid, lease.server.startTime))) live.push(lease)
    }
    return live
  }

  writeLease(lease: RuntimeLease): void {
    this.ensure(true)
    const file = this.leaseFile(lease.instanceId)
    const temp = `${file}.${randomUUID()}.tmp`
    writeFileSync(temp, `${JSON.stringify(lease, undefined, 2)}\n`, { mode: 0o600 })
    renameSync(temp, file)
  }

  clearLease(instanceId: string): void {
    rmSync(this.leaseFile(instanceId), { force: true })
  }

  /** Record this extension host as a current user of the runtime it is using. */
  async takeLease(instanceId: string, runtimePid?: number): Promise<RuntimeLease> {
    this.ensure(true)
    const server = runtimePid === undefined ? undefined : await this.currentServer()
    const startTime = await this.probe.startTime(process.pid)
    const lease: RuntimeLease = {
      schema: BROKER_SCHEMA, instanceId, pid: process.pid, createdAt: Date.now(),
      ...startTime === undefined ? {} : { processStartTime: startTime },
      ...runtimePid === undefined ? {} : { runtimePid },
      ...server === undefined ? {} : { server },
    }
    this.writeLease(lease)
    return lease
  }

  /**
   * Forget every file whose process is **provably** gone.
   *
   * This is the only automatic cleanup in the design, and it never terminates
   * anything: a provably-dead process needs no signal, only its files removed so
   * the next window does not mistake them for a live runtime. A live-but-wedged
   * runtime is deliberately left alone and surfaced to the user instead.
   */
  async sweep(): Promise<string[]> {
    const removed: string[] = []
    const descriptor = this.readDescriptor()
    if (descriptor !== undefined && descriptor.pid !== undefined
      && !await stillRunning(this.probe, descriptor.pid, descriptor.processStartTime)) {
      this.clearDescriptor()
      removed.push(this.descriptorFile)
    }
    for (const lease of this.readLeases()) {
      if (!await stillRunning(this.probe, lease.pid, lease.processStartTime)) {
        this.clearLease(lease.instanceId)
        removed.push(this.leaseFile(lease.instanceId))
      }
    }
    return removed
  }

  /**
   * Decide what this window should do about a recorded runtime.
   *
   * Adoption is deliberately the default answer for a matching fingerprint: the
   * leftover runtime may be mid-turn from work the user started before the last
   * extension host died, so reattaching both preserves that work and removes the
   * orphan. Nothing here terminates anything.
   */
  async decide(fingerprint: RuntimeFingerprint): Promise<AdoptionDecision> {
    const descriptor = this.readDescriptor()
    if (descriptor === undefined) {
      if (existsSync(this.descriptorFile)) throw new Error('The saved DSH runtime record cannot be verified. No additional runtime was started.')
      return { action: 'spawn', reason: 'no recorded runtime' }
    }
    if (!descriptor.manageable) {
      // An attach-only runtime is the user's: this extension knows neither its pid
      // nor how it was started, so nothing here can decide that it is gone. Whether
      // that launch URL still answers is the caller's handshake to make.
      return { action: 'adopt', descriptor }
    }
    const pid = descriptor.pid
    // A managed record is required to carry a pid (see `parseDescriptor`).
    if (pid === undefined) {
      this.clearDescriptor()
      return { action: 'spawn', reason: 'the recorded runtime has no process identity' }
    }
    if (!await stillRunning(this.probe, pid, descriptor.processStartTime)) {
      this.clearDescriptor()
      return { action: 'spawn', reason: 'the recorded runtime is no longer running' }
    }
    const differences = fingerprintDifferences(descriptor.fingerprint ?? fingerprint, fingerprint)
    if (differences.length > 0) {
      return {
        action: 'ignore', descriptor,
        reason: `different ${differences.join(', ')}`,
      }
    }
    return { action: 'adopt', descriptor }
  }

  /**
   * Give up this host's lease and say whether the runtime should now be stopped.
   *
   * The caller performs the termination, and only for the last live lease of a
   * runtime this extension spawned and marked manageable. A shared runtime is
   * left running for the windows that still hold a lease, and a runtime this
   * window never used is never stopped: a window that merely started VS Code must
   * not be the one that ends somebody else's turn.
   */
  async release(instanceId: string): Promise<ReleaseOutcome> {
    const notes: string[] = []
    const descriptor = this.readDescriptor()
    if (descriptor === undefined) { this.clearLease(instanceId); return { notes } }
    if (!descriptor.manageable) {
      // The user's own runtime: this extension did not start it, so it is never
      // ended from here — the process outlives every window that attached to it.
      this.clearLease(instanceId)
      notes.push('the runtime is attach-only, so it was left running')
      return { notes }
    }
    // Proof that *this* window used *this* runtime. A lease names the runtime pid,
    // so it cannot be reused as evidence for a record another window has since
    // written over. A window that spawned the recorded runtime needs no lease
    // (its write may simply have been lost), and nothing else counts.
    const lease = this.readLeases().find(entry => entry.instanceId === instanceId)
    const used = lease === undefined
      ? descriptor.instanceId === instanceId
      : lease.runtimePid !== undefined && lease.runtimePid === descriptor.pid
    this.clearLease(instanceId)
    if (!used) {
      notes.push('the recorded runtime is not the one this window used, so it was left alone')
      return { notes }
    }
    const live = (await this.liveLeases()).filter(lease => lease.runtimePid === undefined || lease.runtimePid === descriptor.pid)
    if (live.length > 0) {
      notes.push(`the runtime is still in use by ${String(live.length)} other window(s); leaving it running`)
      return { notes }
    }
    if (!descriptor.manageable) {
      notes.push('the runtime is attach-only, so it was not stopped')
      return { notes }
    }
    const pid = descriptor.pid
    // A managed record is required to carry a pid (see `parseDescriptor`).
    if (pid === undefined) return { notes }
    const state = await processState(this.probe, pid, descriptor.processStartTime)
    if (state === 'dead') {
      this.clearDescriptor()
      notes.push('the runtime had already exited')
      return { notes }
    }
    // An unprovable pid is still a candidate: the caller can prove the *instance*
    // through its launch token, which no reused pid can answer for.
    return { stop: descriptor, stopIdentity: state === 'alive' ? 'proved' : 'unproved', notes }
  }

  /**
   * Terminate a runtime this extension spawned, after `release` approved it.
   *
   * Waits for the process to actually go away, then removes the descriptor. The
   * hard kill can lose events still buffered in DSH. Its JSONL backend repairs a
   * torn tail on the next open; recovery reopens the saved prefix, not unfinished
   * requests or in-memory output.
   */
  async stop(
    descriptor: RuntimeDescriptor,
    /**
     * `confirmed` means the caller authenticated the runtime's own per-process
     * launch token a moment ago, so the instance is alive and the pid cannot have
     * been reused. A pid that cannot be tied to the record any other way is only
     * signalled when that proof exists.
     */
    options: { graceMs?: number; confirmed?: boolean; confirmIdentity?: () => Promise<boolean>; processGroup?: boolean } = {},
  ): Promise<boolean> {
    const graceMs = options.graceMs ?? 4_000
    // Attach-only runtimes are never signalled, and a managed one always has a pid.
    if (!descriptor.manageable || descriptor.pid === undefined) return false
    const group = options.processGroup === true && process.platform !== 'win32'
    const target = group ? -descriptor.pid : descriptor.pid
    const targetAlive = (): boolean => {
      if (!group) return this.probe.isAlive(descriptor.pid!)
      try { process.kill(target, 0); return true } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    }
    const clear = (): void => {
      const current = this.readDescriptor()
      if (current?.instanceId === descriptor.instanceId && current.pid === descriptor.pid
        && current.processStartTime === descriptor.processStartTime) this.clearDescriptor()
    }
    const state = await processState(this.probe, descriptor.pid, descriptor.processStartTime)
    if (state === 'dead') {
      clear()
      return true
    }
    if (state === 'unknown' && options.confirmed !== true) return false
    try {
      process.kill(target, 'SIGTERM')
    } catch {
      if (targetAlive()) return false
      clear()
      return true
    }
    const deadline = Date.now() + graceMs
    while (Date.now() < deadline) {
      if (!targetAlive()) {
        clear()
        return true
      }
      await delay(100)
    }
    // A process can exit and its PID can be reused during the grace period.
    // Initial proof must not authorize SIGKILL against a different process.
    const beforeForce = await processState(this.probe, descriptor.pid, descriptor.processStartTime)
    if (beforeForce === 'dead' && (!group || !targetAlive() || this.probe.isAlive(descriptor.pid))) { clear(); return true }
    if (beforeForce === 'unknown' && !await options.confirmIdentity?.()) return false
    try {
      process.kill(target, 'SIGKILL')
    } catch {
      // Already gone, or no longer ours to signal.
    }
    // A killed process is not reaped instantly, so poll rather than reporting a
    // race as a failure.
    const killDeadline = Date.now() + 1_000
    while (Date.now() < killDeadline && targetAlive()) await delay(50)
    if (targetAlive()) return false
    clear()
    return true
  }
}

/** Host-local, account-local coordination, independent of VS Code profiles. */
export function sharedRuntimeDirectory(dshHome: string, home = homedir(), host = hostname()): string {
  const key = createHash('sha256').update(JSON.stringify([host, dshHome])).digest('hex').slice(0, 32)
  return join(home, '.dsh-vscode', 'runtimes', key)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Every `session.lock` for one session id under the DSH home.
 *
 * The lock lives at `<home>/sessions/<cwd-slug>/<sessionId>/session.lock`. The
 * slug is DSH's own encoding of the session's cwd, so this searches the slug
 * level instead of reimplementing it — and tolerates a session that appears under
 * more than one slug.
 */
export function sessionLockPaths(dshHome: string, sessionId: string): string[] {
  if (!safeSegment(sessionId)) return []
  let slugs: string[]
  try {
    slugs = readdirSync(join(dshHome, 'sessions'))
  } catch {
    return []
  }
  return slugs
    .map(slug => join(dshHome, 'sessions', slug, sessionId, 'session.lock'))
    .filter(lock => existsSync(lock))
}

/**
 * Every session lock under the DSH home.
 *
 * Capped so the path list stays a valid argument vector; `truncated` says the
 * answer is a lower bound rather than silently reporting a smaller number.
 */
export function allSessionLockPaths(dshHome: string): { paths: string[]; truncated: boolean } {
  const root = join(dshHome, 'sessions')
  let slugs: string[]
  try {
    slugs = readdirSync(root)
  } catch {
    return { paths: [], truncated: false }
  }
  const paths: string[] = []
  for (const slug of slugs) {
    let ids: string[]
    try {
      ids = readdirSync(join(root, slug))
    } catch {
      continue
    }
    for (const id of ids) {
      const lock = join(root, slug, id, 'session.lock')
      if (!existsSync(lock)) continue
      paths.push(lock)
      if (paths.length >= MAX_LOCK_PATHS) return { paths, truncated: true }
    }
  }
  return { paths, truncated: false }
}

/**
 * Read-only: which processes hold the given locks, grouped by process.
 *
 * One `lsof` invocation handles every path, so a whole DSH home costs a single
 * process spawn (~150 ms for a few hundred sessions). `lsof -F pcn` is
 * machine-readable (p=pid, c=command, n=name) and needs no locale parsing.
 */
export async function lockHolders(
  paths: readonly string[],
  options: { platform?: NodeJS.Platform; exec?: ExecFileLike; isAlive?: (pid: number) => boolean } = {},
): Promise<{ byPid: Map<number, { command: string; locks: string[] }>; available: boolean }> {
  const platform = options.platform ?? process.platform
  const isAlive = options.isAlive ?? ((pid: number) => nodeProcessProbe().isAlive(pid))
  const byPid = new Map<number, { command: string; locks: string[] }>()
  if (paths.length === 0) return { byPid, available: true }
  if (platform === 'win32') return { byPid, available: false }
  const exec = options.exec ?? run
  let stdout: string
  try {
    ({ stdout } = await exec('lsof', ['-F', 'pcn', '-w', '--', ...paths]))
  } catch (error) {
    // A numeric exit code means lsof ran and found nothing holding the files — a
    // valid answer. A spawn-level failure means the question was never asked, and
    // reporting "nothing holds it" would send the user down the wrong path.
    return { byPid, available: typeof (error as { code?: unknown }).code === 'number' }
  }
  let pid: number | undefined
  let command = ''
  for (const line of stdout.split('\n')) {
    const kind = line.slice(0, 1)
    const value = line.slice(1).trim()
    if (kind === 'p') {
      const parsed = Number.parseInt(value, 10)
      pid = Number.isSafeInteger(parsed) ? parsed : undefined
    } else if (kind === 'c') {
      command = value
    } else if (kind === 'n') {
      if (pid !== undefined && value !== '' && isAlive(pid)) {
        // lsof can list one file once per descriptor; the count must not double.
        const entry = byPid.get(pid) ?? { command: command === '' ? 'unknown' : command, locks: [] }
        if (!entry.locks.includes(value)) entry.locks.push(value)
        byPid.set(pid, entry)
      }
      if (pid === undefined) command = ''
    }
  }
  return { byPid, available: true }
}

/**
 * How many conversations one runtime currently holds.
 *
 * A runtime holds a conversation exactly while it holds that session's lock, so
 * this is the number a user is about to release — and the only number that makes
 * the consequence of ending a runtime concrete.
 */
export async function countSessionsHeldBy(
  dshHome: string,
  pid: number,
  options: { platform?: NodeJS.Platform; exec?: ExecFileLike; isAlive?: (pid: number) => boolean } = {},
): Promise<{ count: number; truncated: boolean; available: boolean }> {
  const { paths, truncated } = allSessionLockPaths(dshHome)
  const { byPid, available } = await lockHolders(paths, options)
  return { count: byPid.get(pid)?.locks.length ?? 0, truncated, available }
}

/**
 * Read-only: which processes hold one session lock.
 *
 * The extension only ever *reports* this — termination is the user's call,
 * because a lock holder may be the desktop app or a `dsh web` the user started
 * themselves, neither of which is ours to end.
 */
export async function describeLockHolders(
  lockPath: string,
  options: { platform?: NodeJS.Platform; exec?: ExecFileLike; isAlive?: (pid: number) => boolean } = {},
): Promise<{ holders: { pid: number; command: string }[]; available: boolean }> {
  const { byPid, available } = await lockHolders([lockPath], options)
  return { holders: [...byPid].map(([pid, entry]) => ({ pid, command: entry.command })), available }
}
