import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BROKER_SCHEMA, RuntimeBroker, describeDescriptor, describeLockHolders, fingerprintsMatch,
  nodeProcessProbe, parseDescriptor, parseLease, sessionLockPaths,
  type ProcessProbe, type RuntimeDescriptor, type RuntimeFingerprint,
} from '../src/runtime-broker.ts'

const temporary: string[] = []
const children: ChildProcess[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-broker-'))
  temporary.push(root)
  return root
}

/** A state directory that does not exist yet, so `ensure` is exercised. */
function stateDir(): string {
  return join(scratch(), 'dsh-runtimes')
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('failed process termination', () => {
  it('retains a living runtime record when the operating system refuses its signal', async () => {
    const broker = new RuntimeBroker({ stateDir: stateDir(), probe: scriptedProbe([4821], { 4821: 'start' }) })
    broker.writeDescriptor(descriptor({ processStartTime: 'start' }))
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('EPERM') })
    await expect(broker.stop(broker.readDescriptor()!)).resolves.toBe(false)
    expect(broker.readDescriptor()?.pid).toBe(4821)
  })
})

function fingerprint(overrides: Partial<RuntimeFingerprint> = {}): RuntimeFingerprint {
  return {
    dshHome: '/home/test/.dsh',
    executable: '/opt/homebrew/bin/dsh',
    arguments: ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    extensionVersion: '0.1.0',
    ...overrides,
  }
}

function descriptor(overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  return {
    schema: BROKER_SCHEMA,
    origin: 'dsh-sidebar',
    manageable: true,
    instanceId: 'spawner-instance',
    pid: 4821,
    startedAt: 1_759_000_000_000,
    cwd: '/code/project',
    fingerprint: fingerprint(),
    launchUrl: 'http://127.0.0.1:43127/?token=secret-token',
    ...overrides,
  }
}

/**
 * Real process liveness with a fixed start time, so identity proof is
 * deterministic on any machine (a sandbox may refuse to run `ps`).
 */
function matchingProbe(startTime: string) {
  const real = nodeProcessProbe()
  return { isAlive: (pid: number) => real.isAlive(pid), startTime: async () => startTime }
}

/** A probe whose answers are fully scripted: no real process is ever consulted. */
function scriptedProbe(alive: number[] = [], times: Record<number, string | undefined> = {}): ProcessProbe {
  const live = new Set(alive)
  return {
    isAlive: pid => live.has(pid),
    startTime: async pid => times[pid],
  }
}

describe('runtime fingerprints', () => {
  it('matches only an identical configuration', () => {
    expect(fingerprintsMatch(fingerprint(), fingerprint())).toBe(true)
    expect(fingerprintsMatch(fingerprint(), fingerprint({ dshHome: '/other/.dsh' }))).toBe(false)
    expect(fingerprintsMatch(fingerprint(), fingerprint({ executable: '/usr/bin/dsh' }))).toBe(false)
    expect(fingerprintsMatch(fingerprint(), fingerprint({ extensionVersion: '0.2.0' }))).toBe(false)
    expect(fingerprintsMatch(fingerprint(), fingerprint({ arguments: ['web', '--port', '0'] }))).toBe(false)
  })

  it('compares arguments by order, not by membership', () => {
    const left = fingerprint({ arguments: ['web', '--port', '0'] })
    const right = fingerprint({ arguments: ['web', '0', '--port'] })
    expect(fingerprintsMatch(left, right)).toBe(false)
  })
})

describe('descriptor and lease parsing', () => {
  it('round-trips a descriptor', () => {
    const source = JSON.stringify(descriptor({ processStartTime: 'Wed Sep 30 02:23:36 2026' }))
    expect(parseDescriptor(source)).toEqual(descriptor({ processStartTime: 'Wed Sep 30 02:23:36 2026' }))
  })

  it('refuses a descriptor that is not ours, or is incomplete', () => {
    expect(parseDescriptor('not json')).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ ...descriptor(), schema: 99 }))).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ ...descriptor(), origin: 'user' }))).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ ...descriptor(), pid: 'x' }))).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ ...descriptor(), pid: -1 }))).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ ...descriptor(), launchUrl: '' }))).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ ...descriptor(), fingerprint: undefined }))).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ ...descriptor(), manageable: 'yes' }))).toBeUndefined()
  })

  it('round-trips a lease and refuses a foreign schema', () => {
    const lease = { schema: BROKER_SCHEMA, instanceId: 'i', pid: 42, createdAt: 5, runtimePid: 43 }
    expect(parseLease(JSON.stringify(lease))).toEqual(lease)
    expect(parseLease(JSON.stringify({ ...lease, schema: 2 }))).toBeUndefined()
    expect(parseLease('{}')).toBeUndefined()
  })

  it('never renders the launch token', () => {
    expect(describeDescriptor(descriptor())).not.toContain('secret-token')
    expect(describeDescriptor(descriptor())).toContain('pid 4821')
  })
})

describe('broker adoption', () => {
  it('spawns when nothing was recorded', async () => {
    const broker = new RuntimeBroker({ stateDir: stateDir(), probe: scriptedProbe() })
    await expect(broker.decide(fingerprint())).resolves.toMatchObject({ action: 'spawn' })
  })

  it('adopts a matching, still-running runtime instead of spawning a second one', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821]) })
    broker.writeDescriptor(descriptor())
    await expect(broker.decide(fingerprint())).resolves.toMatchObject({ action: 'adopt' })
  })

  it('spawns and forgets a descriptor whose process is gone', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([]) })
    broker.writeDescriptor(descriptor())
    await expect(broker.decide(fingerprint())).resolves.toMatchObject({ action: 'spawn' })
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('treats a reused pid as dead', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({
      stateDir: dir,
      probe: scriptedProbe([4821], { 4821: 'Thu Oct  1 09:00:00 2026' }),
    })
    broker.writeDescriptor(descriptor({ processStartTime: 'Wed Sep 30 02:23:36 2026' }))
    await expect(broker.decide(fingerprint())).resolves.toMatchObject({ action: 'spawn' })
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('ignores a live runtime with a different configuration and never terminates it', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821]) })
    broker.writeDescriptor(descriptor({ fingerprint: fingerprint({ dshHome: '/old/.dsh' }) }))
    const decision = await broker.decide(fingerprint())
    expect(decision.action).toBe('ignore')
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('answers "alive" when a start time is unknowable, so nothing is cleaned by guesswork', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], {}) })
    broker.writeDescriptor(descriptor({ processStartTime: 'Wed Sep 30 02:23:36 2026' }))
    await expect(broker.decide(fingerprint())).resolves.toMatchObject({ action: 'adopt' })
  })

  it('never logs the launch token through the adoption path', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821]) })
    broker.writeDescriptor(descriptor())
    const decision = await broker.decide(fingerprint())
    if (decision.action !== 'adopt') throw new Error('expected adoption')
    expect(JSON.stringify(describeDescriptor(decision.descriptor))).not.toContain('secret-token')
  })
})

describe('leases', () => {
  it('records the current process with owner-only permissions', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([process.pid], {}) })
    const lease = await broker.takeLease('window-a')
    expect(lease.pid).toBe(process.pid)
    expect(readFileSync(join(dir, 'holds', 'window-a.json'), 'utf8')).toContain('window-a')
  })

  it('counts only leases whose process is still running', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([11], {}) })
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'live', pid: 11, createdAt: 1 })
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'dead', pid: 22, createdAt: 1 })
    await expect(broker.liveLeases()).resolves.toMatchObject([{ instanceId: 'live' }])
  })

  it('sweeps only provably-dead files and keeps live ones', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821, 11], {}) })
    broker.writeDescriptor(descriptor())
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'live', pid: 11, createdAt: 1 })
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'dead', pid: 22, createdAt: 1 })
    await broker.sweep()
    expect(broker.readDescriptor()).toBeDefined()
    expect(broker.readLeases()).toMatchObject([{ instanceId: 'live' }])
  })

  it('sweeps a dead descriptor and a dead lease', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([], {}) })
    broker.writeDescriptor(descriptor())
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'dead', pid: 22, createdAt: 1 })
    const removed = await broker.sweep()
    expect(removed).toHaveLength(2)
    expect(broker.readDescriptor()).toBeUndefined()
    expect(broker.readLeases()).toEqual([])
  })

  it('rejects an instance id that would escape the state directory', async () => {
    const broker = new RuntimeBroker({ stateDir: stateDir(), probe: scriptedProbe([], {}) })
    await expect(broker.takeLease('../escape')).rejects.toThrow('Invalid broker instance id')
  })
})

describe('release', () => {
  it('does not stop a runtime another window still holds', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821, 11], {}) })
    broker.writeDescriptor(descriptor())
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1, runtimePid: 4821 })
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'other-window', pid: 11, createdAt: 1 })
    const outcome = await broker.release('this-window')
    expect(outcome.stop).toBeUndefined()
    expect(outcome.notes.join(' ')).toContain('still in use')
  })

  it('stops the runtime when the last lease goes', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], { 4821: 'start-t' }) })
    broker.writeDescriptor(descriptor({ processStartTime: 'start-t' }))
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1, runtimePid: 4821 })
    const outcome = await broker.release('this-window')
    expect(outcome.stop?.pid).toBe(4821)
    expect(broker.readLeases()).toEqual([])
  })

  it('leaves an attach-only runtime alone', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], {}) })
    broker.writeDescriptor(descriptor({ manageable: false }))
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1, runtimePid: 4821 })
    const outcome = await broker.release('this-window')
    expect(outcome.stop).toBeUndefined()
    expect(outcome.notes.join(' ')).toContain('attach-only')
  })

  it('forgets an already-exited runtime without signalling anything', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([], {}) })
    broker.writeDescriptor(descriptor())
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1, runtimePid: 4821 })
    const outcome = await broker.release('this-window')
    expect(outcome.stop).toBeUndefined()
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('never stops a runtime this window never used', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], {}) })
    // A window that only started VS Code: it holds no lease, and the record
    // belongs to an earlier window, so ending that runtime is not its business.
    broker.writeDescriptor(descriptor({ instanceId: 'earlier-window' }))
    const outcome = await broker.release('this-window')
    expect(outcome.stop).toBeUndefined()
    expect(outcome.notes.join(' ')).toContain('not the one this window used')
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('stops what this window spawned even when its lease was never written', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], { 4821: 'start-t' }) })
    broker.writeDescriptor(descriptor({ instanceId: 'this-window', processStartTime: 'start-t' }))
    const outcome = await broker.release('this-window')
    expect(outcome.stop?.pid).toBe(4821)
  })

  it('does nothing when no runtime was recorded', async () => {
    const broker = new RuntimeBroker({ stateDir: stateDir(), probe: scriptedProbe() })
    await expect(broker.release('this-window')).resolves.toMatchObject({ notes: [] })
  })
})

describe('stopping a runtime this extension spawned', () => {
  it('terminates a real process and removes the descriptor', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
    children.push(child)
    await new Promise(resolve => { child.once('spawn', resolve) })
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: matchingProbe('child-start') })
    broker.writeDescriptor(descriptor({ pid: child.pid!, manageable: true, processStartTime: 'child-start' }))
    await expect(broker.stop(broker.readDescriptor()!, { graceMs: 3_000 })).resolves.toBe(true)
    expect(broker.readDescriptor()).toBeUndefined()
    expect(child.killed || child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('hard-kills a runtime that ignores SIGTERM', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60_000)"], { stdio: 'ignore' })
    children.push(child)
    await new Promise(resolve => { child.once('spawn', resolve) })
    // Give the handler time to be installed before the signal arrives.
    await new Promise(resolve => { setTimeout(resolve, 300) })
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: matchingProbe('child-start') })
    broker.writeDescriptor(descriptor({ pid: child.pid!, processStartTime: 'child-start' }))
    await expect(broker.stop(broker.readDescriptor()!, { graceMs: 400 })).resolves.toBe(true)
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('signals a confirmed runtime whose start time cannot be read', async () => {
    // The Windows shape: a live pid, no start time, identity proved by the
    // caller's token handshake instead.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
    children.push(child)
    await new Promise(resolve => { child.once('spawn', resolve) })
    const real = nodeProcessProbe()
    const dir = stateDir()
    const broker = new RuntimeBroker({
      stateDir: dir,
      probe: { isAlive: pid => real.isAlive(pid), startTime: async () => undefined },
    })
    broker.writeDescriptor(descriptor({ pid: child.pid! }))
    await expect(broker.stop(broker.readDescriptor()!, { confirmed: true, graceMs: 3_000 })).resolves.toBe(true)
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('treats an already-exited runtime as stopped', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([], {}) })
    broker.writeDescriptor(descriptor())
    await expect(broker.stop(broker.readDescriptor()!)).resolves.toBe(true)
    expect(broker.readDescriptor()).toBeUndefined()
  })
})

describe('read-only occupancy diagnosis', () => {
  it('finds a session lock without reimplementing the cwd slug', () => {
    const home = scratch()
    mkdirSync(join(home, 'sessions', '--code-project--', 'session-1'), { recursive: true })
    mkdirSync(join(home, 'sessions', '--code-other--', 'session-1'), { recursive: true })
    writeFileSync(join(home, 'sessions', '--code-project--', 'session-1', 'session.lock'), '')
    writeFileSync(join(home, 'sessions', '--code-other--', 'session-1', 'session.lock'), '')
    expect(sessionLockPaths(home, 'session-1')).toHaveLength(2)
  })

  it('resolves no lock for an unknown or unsafe session id', () => {
    const home = scratch()
    expect(sessionLockPaths(home, 'session-missing')).toEqual([])
    expect(sessionLockPaths(home, '../../etc/passwd')).toEqual([])
    expect(sessionLockPaths(home, '..')).toEqual([])
  })

  it('parses machine-readable lsof output', async () => {
    const report = await describeLockHolders('/tmp/session.lock', {
      platform: 'darwin',
      isAlive: () => true,
      exec: async () => ({ stdout: 'p16208\ncDeepSeek\nn/tmp/session.lock\np38956\ncnode\nn/tmp/session.lock\n' }),
    })
    expect(report.holders).toEqual([
      { pid: 16208, command: 'DeepSeek' },
      { pid: 38956, command: 'node' },
    ])
    expect(report.available).toBe(true)
  })

  it('drops a holder whose pid has already exited', async () => {
    const report = await describeLockHolders('/tmp/session.lock', {
      platform: 'darwin',
      isAlive: pid => pid === 38956,
      exec: async () => ({ stdout: 'p16208\ncDeepSeek\nn/tmp/session.lock\np38956\ncnode\nn/tmp/session.lock\n' }),
    })
    expect(report.holders).toEqual([{ pid: 38956, command: 'node' }])
  })

  it('says the holder is unknown when the tool is missing, instead of "nothing holds it"', async () => {
    const missing = Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT' })
    await expect(describeLockHolders('/tmp/session.lock', {
      platform: 'darwin', exec: async () => { throw missing },
    })).resolves.toEqual({ holders: [], available: false })
    // A non-zero exit means the tool ran and found no holder: a real answer.
    const notHeld = Object.assign(new Error('exit 1'), { code: 1 })
    await expect(describeLockHolders('/tmp/session.lock', {
      platform: 'darwin', exec: async () => { throw notHeld },
    })).resolves.toEqual({ holders: [], available: true })
  })

  it('reports nothing on Windows, where lsof does not exist', async () => {
    const exec = async (): Promise<{ stdout: string }> => { throw new Error('must not be called') }
    await expect(describeLockHolders('/tmp/session.lock', { platform: 'win32', exec }))
      .resolves.toEqual({ holders: [], available: false })
  })

  it('does not create state when only reading', () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe() })
    expect(broker.readDescriptor()).toBeUndefined()
    expect(broker.readLeases()).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })
})

describe('adversarial: release must never end a runtime this window did not use', () => {
  it('refuses to stop a runtime whose record was overwritten by another window', async () => {
    const dir = stateDir()
    // Window A spawned pid 4821 and holds a lease naming that runtime.
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821, 9001], {}) })
    broker.writeLease({
      schema: BROKER_SCHEMA, instanceId: 'window-a', pid: process.pid, createdAt: 1, runtimePid: 4821,
    })
    // Window B could not adopt A's runtime, so it started its own and overwrote
    // the single record with its own pid. B is now gone, leaving 9001 running.
    broker.writeDescriptor(descriptor({ instanceId: 'window-b', pid: 9001 }))

    const outcome = await broker.release('window-a')

    // A must not end B's runtime: A never used it.
    expect(outcome.stop).toBeUndefined()
  })

  it('offers an unprovable pid as a candidate for the caller to authenticate', async () => {
    const dir = stateDir()
    // No process start time is available (Windows, or `ps` unavailable), so the pid
    // alone cannot be tied to the recorded runtime. The runtime is still offered,
    // but only the token handshake may authorise signalling it.
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], {}) })
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1, runtimePid: 4821 })
    broker.writeDescriptor(descriptor({ instanceId: 'this-window', pid: 4821 }))

    const outcome = await broker.release('this-window')

    expect(outcome.stop?.pid).toBe(4821)
    expect(outcome.stopIdentity).toBe('unproved')
  })

  it('reports a proved identity so no handshake is needed', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], { 4821: 'start-t' }) })
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1, runtimePid: 4821 })
    broker.writeDescriptor(descriptor({ instanceId: 'this-window', pid: 4821, processStartTime: 'start-t' }))

    const outcome = await broker.release('this-window')

    expect(outcome.stop?.pid).toBe(4821)
    expect(outcome.stopIdentity).toBe('proved')
  })

  it('refuses to signal a pid whose identity was not proved and not confirmed', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], {}) })
    broker.writeDescriptor(descriptor({ pid: 4821 }))
    // No start time on either side: either signal would be a guess, so nothing is sent.
    await expect(broker.stop(broker.readDescriptor()!)).resolves.toBe(false)
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('stops the runtime once its identity is proved by a matching start time', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({
      stateDir: dir,
      probe: scriptedProbe([4821], { 4821: 'Wed Sep 30 02:23:36 2026' }),
    })
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1, runtimePid: 4821 })
    broker.writeDescriptor(descriptor({ instanceId: 'this-window', pid: 4821, processStartTime: 'Wed Sep 30 02:23:36 2026' }))

    const outcome = await broker.release('this-window')

    expect(outcome.stop?.pid).toBe(4821)
  })

  it('drops a holder whose pid is gone without losing the next entry', async () => {
    const report = await describeLockHolders('/tmp/session.lock', {
      platform: 'darwin',
      // 16208 has exited and its pid is not reused; 38956 is live.
      isAlive: pid => pid === 38956,
      exec: async () => ({ stdout: 'p16208\ncDeepSeek\nn/tmp/session.lock\np38956\ncnode\nn/tmp/session.lock\n' }),
    })
    expect(report.holders).toEqual([{ pid: 38956, command: 'node' }])
  })
})

/**
 * A runtime the *user* started and asked us to remember.
 *
 * It carries no pid and no fingerprint: this extension did not start it, does not
 * know how it was started, and must never signal it. Its launch URL is the only
 * handle, and authenticating that is the only identity proof available.
 */
describe('attach-only records (the user\'s own runtime)', () => {
  function attached(overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
    const base = descriptor()
    // Deliberately drop the process identity a managed record is required to carry.
    const { pid, fingerprint, processStartTime, ...rest } = base
    void pid
    void fingerprint
    void processStartTime
    return { ...rest, manageable: false, launchUrl: 'http://127.0.0.1:3080/?token=saved-token', ...overrides }
  }

  it('round-trips without a pid or a fingerprint', () => {
    const record = attached()
    expect(parseDescriptor(JSON.stringify(record))).toEqual(record)
  })

  it('still refuses a managed record that is missing its process identity', () => {
    const { pid, fingerprint, ...rest } = descriptor()
    void pid
    void fingerprint
    expect(parseDescriptor(JSON.stringify({ ...rest, manageable: true }))).toBeUndefined()
  })

  it('is adopted on its URL alone, whatever this window is configured to run', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe() })
    broker.writeDescriptor(attached())
    // A fingerprint that can never match: an attach-only record has none to compare.
    await expect(broker.decide(fingerprint({ dshHome: '/somewhere/else/.dsh' })))
      .resolves.toMatchObject({ action: 'adopt' })
  })

  it('is never offered for termination, and its lease is still released', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], {}) })
    broker.writeDescriptor(attached({ pid: 4821 }))
    broker.writeLease({ schema: BROKER_SCHEMA, instanceId: 'this-window', pid: process.pid, createdAt: 1 })
    const outcome = await broker.release('this-window')
    expect(outcome.stop).toBeUndefined()
    expect(outcome.notes.join(' ')).toContain('attach-only')
    expect(broker.readLeases()).toEqual([])
    // The record survives: other windows still need it to attach.
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('refuses to signal even when the caller confirmed its identity', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([4821], {}) })
    const record = attached({ pid: 4821 })
    broker.writeDescriptor(record)
    await expect(broker.stop(record, { confirmed: true })).resolves.toBe(false)
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('is not swept, because its process can never be proven dead', async () => {
    const dir = stateDir()
    const broker = new RuntimeBroker({ stateDir: dir, probe: scriptedProbe([], {}) })
    broker.writeDescriptor(attached())
    await expect(broker.sweep()).resolves.toEqual([])
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('is described without a pid, and never by its URL', () => {
    const text = describeDescriptor(attached())
    expect(text).toContain('the DSH runtime you saved')
    expect(text).not.toContain('saved-token')
    expect(text).not.toContain('pid')
  })
})
