import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { nodeProcessProbe, RuntimeBroker, type RuntimeFingerprint } from './runtime-broker.js'
import { parseDshWebUrl } from './launch.js'
import { RuntimeOutput } from './runtime-output.js'
import { OwnedRuntimeGroup } from './runtime-process-group.js'
import { RUNTIME_HOST_PROTOCOL, type RuntimeProcessIdentity } from './runtime-lifetime.js'

interface LaunchMessage {
  kind: 'launch'; command: string; args: string[]; options: SpawnOptionsWithoutStdio
  stateDir: string; instanceId: string; fingerprint: RuntimeFingerprint
  timeoutMs: number; orphanGraceMs?: number; leasePollMs?: number
}

let child: ChildProcessWithoutNullStreams | undefined, group: OwnedRuntimeGroup | undefined
let launching = false, shuttingDown = false, finished = false, queuedBytes = 0
let broker: RuntimeBroker | undefined, instanceId: string | undefined
let published: Promise<void> | undefined
let monitor: NodeJS.Timeout | undefined, forceTimer: NodeJS.Timeout | undefined, exitTimer: NodeJS.Timeout | undefined
let exitPoll: NodeJS.Timeout | undefined
let resolveStopped!: () => void
const stopped = new Promise<void>(resolve => { resolveStopped = resolve })
// Bound the interval between spawning the helper and receiving its launch data.
let startupTimer = setTimeout(() => { void stop() }, 15_000)

function send(message: object, bytes = 0): void {
  if (!process.connected || process.send === undefined || (bytes > 0 && queuedBytes + bytes > 512 * 1024)) return
  queuedBytes += bytes
  try { process.send(message, () => { queuedBytes -= bytes }) } catch { queuedBytes -= bytes }
}

function cleanup(): void {
  if (broker === undefined || instanceId === undefined) return
  // Storage failures must never prevent process termination.
  try { broker.clearStartup(instanceId, process.pid) } catch { /* Retained for recovery. */ }
  try {
    const descriptor = broker.readDescriptor()
    if (descriptor?.instanceId === instanceId && descriptor.pid === child?.pid) broker.clearDescriptor()
  } catch { /* Retained for recovery. */ }
}

function finish(): void {
  if (finished) return
  finished = true
  clearTimeout(startupTimer); clearInterval(monitor); clearTimeout(forceTimer); clearTimeout(exitTimer); clearInterval(exitPoll)
  const exited = child === undefined || child.pid === undefined || child.exitCode !== null || child.signalCode !== null
  if (exited) cleanup()
  child?.stdout.destroy(); child?.stderr.destroy(); child?.stdin.destroy()
  if (exited) send({ kind: 'exit', code: child?.exitCode ?? null, signal: child?.signalCode ?? null })
  else send({ kind: 'error', data: 'DSH did not exit after forced cleanup; its process record was retained.' })
  resolveStopped()
  // Never wait indefinitely for inherited pipes or an unresponsive IPC reader.
  // A still-live DSH retains its descriptor and startup reservation.
  setTimeout(() => process.exit(exited ? 0 : 1), 100)
  if (process.connected) process.disconnect()
}

async function signal(signal: NodeJS.Signals): Promise<void> {
  try { await group?.signal(signal) } catch { send({ kind: 'error', data: 'The operating system refused DSH process cleanup.' }) }
}

async function stop(): Promise<void> {
  if (shuttingDown || finished) return stopped
  shuttingDown = true
  clearTimeout(startupTimer); clearInterval(monitor)
  if (child === undefined || child.pid === undefined) { finish(); return }
  // Bound cleanup even if tools inherit stdout after the DSH leader exits.
  forceTimer = setTimeout(() => {
    void signal('SIGKILL').finally(() => { exitTimer = setTimeout(finish, 500) })
  }, 4_000)
  exitPoll = setInterval(() => {
    if (child !== undefined && (child.exitCode !== null || child.signalCode !== null) && !group?.isAlive()) finish()
  }, 50)
  await signal('SIGTERM')
  return stopped
}

process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
process.on('disconnect', () => { if (!launching) void stop() })
process.on('uncaughtException', () => { send({ kind: 'error', data: 'The DSH runtime host encountered an internal error.' }); void stop() })
process.on('unhandledRejection', () => { send({ kind: 'error', data: 'The DSH runtime host encountered an asynchronous error.' }); void stop() })
process.on('message', (unknown: unknown) => {
  const input = unknown as LaunchMessage | { kind: 'stop'; force?: boolean }
  if (input?.kind === 'stop') { void stop(); if (input.force === true) void signal('SIGKILL'); return }
  if (input?.kind !== 'launch' || launching || shuttingDown) return
  launching = true
  clearTimeout(startupTimer)
  startupTimer = setTimeout(() => { void stop() }, Math.min(Math.max(input.timeoutMs || 60_000, 1_000), 300_000) + 10_000)
  void launch(input).catch(() => { send({ kind: 'error', data: 'Could not launch or register DSH from the runtime host.' }); void stop() })
})

async function launch(input: LaunchMessage): Promise<void> {
  broker = new RuntimeBroker({ stateDir: input.stateDir }); instanceId = input.instanceId
  const hostStart = await nodeProcessProbe().startTime(process.pid)
  const host: RuntimeProcessIdentity | undefined = hostStart === undefined ? undefined : { pid: process.pid, startTime: hostStart }
  if (shuttingDown) return
  broker.markStartupLaunched(input.instanceId)
  child = spawn(input.command, input.args, { ...input.options, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
  group = new OwnedRuntimeGroup(child)
  child.on('error', () => { send({ kind: 'error', data: 'DSH could not start.' }); void stop() })
  // exit is independent of pipe handles inherited by tools.
  child.on('exit', () => { void stop() })
  child.on('close', () => { if (!shuttingDown) void stop() })
  child.stdin.end()
  if (child.pid !== undefined) broker.markStartupLaunched(input.instanceId, child.pid)
  send({ kind: 'spawned', pid: child.pid })
  const runtimeStart = child.pid === undefined ? undefined : await nodeProcessProbe().startTime(child.pid)
  if (shuttingDown) return
  broker.markStartupLaunched(input.instanceId, child.pid, runtimeStart, RUNTIME_HOST_PROTOCOL)
  let emptySince: number | undefined, checking = false
  const urlLine = (line: string): void => {
    if (published !== undefined || shuttingDown) return
    const url = parseDshWebUrl(line)
    if (url === undefined || !new URL(url).searchParams.has('token')) return
    published = (async () => {
      if (child?.pid === undefined || broker === undefined) throw new Error('Missing process identity.')
      await broker.publishOwnedRuntime({ instanceId: input.instanceId, pid: child.pid,
        cwd: String(input.options.cwd), fingerprint: input.fingerprint, launchUrl: url,
        ...(host === undefined ? {} : { host }) })
      if (shuttingDown || child.exitCode !== null || child.signalCode !== null) { if (finished) cleanup(); return }
      broker.clearStartup(input.instanceId, process.pid)
      clearTimeout(startupTimer)
      send({ kind: 'url', data: url })
      emptySince = Date.now()
      monitor = setInterval(() => {
        if (checking || shuttingDown || broker === undefined) return
        checking = true
        void (async () => {
          const live = (await broker!.liveLeases()).some(lease => lease.runtimePid === undefined || lease.runtimePid === child?.pid)
          if (live) emptySince = undefined
          else if (emptySince === undefined) emptySince = Date.now()
          else if (Date.now() - emptySince >= (input.orphanGraceMs ?? 30_000)) {
            const lock = await broker!.acquireTransition({ timeoutMs: 1_000 })
            try {
              if ((await broker!.liveLeases()).some(lease => lease.runtimePid === undefined || lease.runtimePid === child?.pid)) { emptySince = undefined; return }
              await stop()
            } finally { lock.release() }
          }
        })().catch(() => { /* Uncertain ownership never authorises termination. */ })
          .finally(() => { checking = false })
      }, input.leasePollMs ?? 5_000)
    })().catch(() => { send({ kind: 'error', data: 'Could not register the shared DSH runtime.' }); void stop() })
  }
  const stdout = new RuntimeOutput(() => {}, urlLine), stderr = new RuntimeOutput(() => {}, urlLine)
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', (data: string) => { stdout.consume(data); send({ kind: 'stdout', data }, Buffer.byteLength(data)) })
  child.stderr.on('data', (data: string) => { stderr.consume(data); send({ kind: 'stderr', data }, Buffer.byteLength(data)) })
}
