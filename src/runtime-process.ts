import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { LaunchCommand } from './launch.js'
import { BROKER_SCHEMA, nodeProcessProbe, type RuntimeBroker, type RuntimeFingerprint } from './runtime-broker.js'

export interface RuntimeProcess extends EventEmitter {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  readonly stdout: PassThrough | NodeJS.ReadableStream
  readonly stderr: PassThrough | NodeJS.ReadableStream
  kill(signal?: NodeJS.Signals | number): boolean
  detach?(): void
}

export interface RuntimeHostOptions {
  readonly script: string
  /** Shorter intervals are only used by isolated lifecycle tests. */
  readonly orphanGraceMs?: number
  readonly leasePollMs?: number
}

/**
 * The helper owns DSH's pipes. Closing the spawning extension host only closes
 * IPC; the helper continues draining output for other windows, without log files.
 */
export async function spawnHostedRuntime(input: {
  launch: LaunchCommand; options: SpawnOptionsWithoutStdio; host: RuntimeHostOptions
  broker: RuntimeBroker; instanceId: string; fingerprint: RuntimeFingerprint
  timeoutMs: number; signal: AbortSignal
}): Promise<RuntimeProcess> {
  await input.broker.currentServer()
  if (input.signal.aborted) throw new Error('DSH runtime stopped.')
  const relay = spawn(process.execPath, [input.host.script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: true, windowsHide: true,
  })
  let pid: number | undefined, exitCode: number | null = null, signalCode: NodeJS.Signals | null = null
  let identity: Promise<string | undefined> | undefined
  let hostExited = false
  const emitter = new EventEmitter()
  // The asynchronous reservation can fail before the runtime installs listeners.
  emitter.on('error', () => {})
  let spawnedResolve!: () => void, spawnedReject!: (error: Error) => void
  const spawned = new Promise<void>((resolve, reject) => { spawnedResolve = resolve; spawnedReject = reject })
  void spawned.catch(() => {})
  const stdout = new PassThrough(), stderr = new PassThrough()
  let ended = false
  const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (ended) return
    ended = true; exitCode = code; signalCode = signal
    stdout.end(); stderr.end()
    emitter.emit('exit', code, signal)
    emitter.emit('close', code, signal)
  }
  const child = Object.assign(emitter, {
    stdout, stderr,
    get pid() { return pid },
    get exitCode() { return exitCode },
    get signalCode() { return signalCode },
    kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
      if (ended) return false
      if ((signal === 'SIGTERM' || signal === 'SIGKILL') && relay.connected && !hostExited) {
        try { relay.send({ kind: 'stop', force: signal === 'SIGKILL' }, () => {}); return true } catch { /* Verify the DSH identity below. */ }
      }
      if (pid !== undefined) {
        const target = pid
        void (async () => {
          const expected = await identity
          if (ended || expected === undefined || await nodeProcessProbe().startTime(target) !== expected) return
          try { process.kill(target, signal) } catch { /* Exit/recovery path reports the final result. */ }
        })()
        return true
      }
      return relay.kill(signal)
    },
    detach(): void {
      if (relay.connected) relay.disconnect()
      stdout.destroy(); stderr.destroy(); emitter.removeAllListeners()
      emitter.on('error', () => {})
    },
  })
  // Object.assign evaluates getters; define live process properties explicitly.
  Object.defineProperties(child, {
    pid: { get: () => pid }, exitCode: { get: () => exitCode }, signalCode: { get: () => signalCode },
  })
  relay.on('message', (message: unknown) => {
    const event = message as { kind?: string; pid?: number; data?: string; code?: number | null; signal?: NodeJS.Signals | null }
    if (event.kind === 'spawned') {
      pid = event.pid
      if (pid !== undefined) identity = nodeProcessProbe().startTime(pid)
      spawnedResolve()
    }
    else if (event.kind === 'stdout') stdout.write(event.data ?? '')
    else if (event.kind === 'stderr') stderr.write(event.data ?? '')
    else if (event.kind === 'url') stdout.write(`${event.data ?? ''}\n`)
    else if (event.kind === 'error') {
      const error = new Error(event.data ?? 'DSH runtime host failed.')
      spawnedReject(error); emitter.emit('error', error)
    }
    else if (event.kind === 'exit') finish(event.code ?? null, event.signal ?? null)
  })
  // Host errors after handoff are surfaced through the ordinary runtime path.
  relay.on('error', error => { spawnedReject(error); emitter.emit('error', error) })
  relay.on('exit', (code, signal) => {
    hostExited = true
    spawnedReject(new Error('DSH runtime host exited before launch.'))
    if (ended) return
    if (pid === undefined) { finish(code, signal); return }
    // The helper's exit is not proof that its detached DSH also exited.
    // Use the identity captured at spawn, never an unqualified reused PID.
    void (async () => {
      const startTime = await identity
      const stopped = await input.broker.stop({ schema: BROKER_SCHEMA, origin: 'dsh-sidebar', manageable: true,
        instanceId: input.instanceId, pid: pid!, startedAt: Date.now(), cwd: String(input.options.cwd),
        fingerprint: input.fingerprint, launchUrl: '', ...(startTime === undefined ? {} : { processStartTime: startTime }) },
      { processGroup: true })
      if (stopped) finish(code, signal)
      else emitter.emit('error', new Error('The DSH runtime host exited, but DSH cleanup could not be confirmed. Its record was retained.'))
    })().catch(() => { emitter.emit('error', new Error('Could not clean up DSH after its runtime host exited.')) })
  })
  const abort = (): void => { child.kill('SIGTERM') }
  input.signal.addEventListener('abort', abort, { once: true })
  try {
    if (relay.pid === undefined) throw new Error('Could not start the DSH runtime host.')
    await input.broker.reserveStartup(relay.pid, input.instanceId)
    if (input.signal.aborted) throw new Error('DSH runtime stopped.')
    await new Promise<void>((resolve, reject) => {
      relay.send({ kind: 'launch', command: input.launch.command, args: input.launch.args,
        options: input.options, stateDir: input.broker.sharedDirectory,
        instanceId: input.instanceId, fingerprint: input.fingerprint, timeoutMs: input.timeoutMs,
        orphanGraceMs: input.host.orphanGraceMs, leasePollMs: input.host.leasePollMs },
      error => { if (error) reject(error); else resolve() })
    })
    await spawned
    relay.unref()
    relay.channel?.unref()
    return child
  } catch (error) {
    relay.kill('SIGTERM')
    // The helper may already have spawned DSH. Its reservation remains until
    // that child exits, or the next starter proves the helper process is dead.
    throw error
  } finally { input.signal.removeEventListener('abort', abort) }
}
