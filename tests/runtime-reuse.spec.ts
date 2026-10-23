import { createHash } from 'node:crypto'
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cross-window reuse, end to end through the runtime state machine.
 *
 * These tests wire the *real* broker into `DshRuntime` (only the process children
 * are stubbed), so the lease ledger, the descriptor on disk and the adoption
 * decision are all exercised rather than mocked.
 */

const state = vi.hoisted(() => ({
  version: '0.1.2-rc.1',
  timeout: 60_000,
  reuse: false,
  debugging: false,
  children: [] as ChildProcessWithoutNullStreams[],
  realSpawn: undefined as typeof import('node:child_process').spawn | undefined,
}))

vi.mock('vscode', () => ({
  EventEmitter: class {
    readonly event = vi.fn()
    fire(): void {}
    dispose(): void {}
  },
  Uri: { parse: (value: string) => ({ toString: () => value, fsPath: '/workspace' }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => key === 'reuseExistingRuntime' ? state.reuse
        : key === 'autonomousDebugging' ? state.debugging
        : key === 'startupTimeout' ? state.timeout : fallback,
      inspect: () => undefined,
    }),
  },
}))

vi.mock('../src/launch.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/launch.ts')>(),
  findSourceRoot: () => undefined,
  resolveLaunch: (_root: string, _executable: string, args: string[]) => ({ command: 'dsh', args, env: {} }),
}))

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  state.realSpawn = actual.spawn
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  return {
    ...actual,
    spawn: vi.fn((_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        pid: 123, exitCode: null as number | null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      }) as unknown as ChildProcessWithoutNullStreams
      if (args.includes('--version')) {
        queueMicrotask(() => {
          child.stdout.emit('data', state.version + '\n')
          child.emit('exit', 0)
          child.emit('close', 0)
        })
      } else {
        state.children.push(child)
      }
      return child
    }),
  }
})

vi.mock('../src/process-tree.ts', () => ({
  terminateProcessTree: (child: ChildProcessWithoutNullStreams) => {
    child.emit('exit', 0)
    child.emit('close', 0)
    return true
  },
}))

import { DshRuntime } from '../src/runtime.ts'
import { RuntimeBroker, nodeProcessProbe, type RuntimeDescriptor } from '../src/runtime-broker.ts'
import { resolveDshHome } from '../src/plugin-profile.js'

const temporary: string[] = []
const spawned: ChildProcess[] = []
const runtimes: DshRuntime[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-reuse-'))
  temporary.push(root)
  return root
}

function runtime(broker?: RuntimeBroker, adoptOwnRuntimes = true) {
  const logs: string[] = []
  const instance = new DshRuntime({
    extensionUri: { fsPath: '/extension' }, secrets: { get: vi.fn(async () => undefined) },
  } as never, { appendLine: (line: string) => { logs.push(line) } } as never, undefined, broker, adoptOwnRuntimes)
  runtimes.push(instance)
  return { instance, logs }
}

/** The record the user's own runtime is saved as: no pid, no fingerprint. */
function savedDescriptor(dir: string, overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  const record: RuntimeDescriptor = {
    schema: 1,
    origin: 'dsh-sidebar',
    manageable: false,
    instanceId: 'the-user',
    startedAt: Date.now() - 60_000,
    cwd: '/workspace',
    launchUrl: 'http://127.0.0.1:43127/?token=saved-token',
    ...overrides,
  }
  new RuntimeBroker({ stateDir: dir, probe: testProbe() }).writeDescriptor(record)
  return record
}

/**
 * Real process liveness with a deterministic start time.
 *
 * Identity proof (pid + start time) is what authorises ending a runtime, and a
 * sandbox may refuse to run `ps`, so the start time is fixed here: every record
 * these tests write is then provably the process it names, on any machine.
 */
function testProbe() {
  const real = nodeProcessProbe()
  return { isAlive: (pid: number) => real.isAlive(pid), startTime: async () => 'test-start' }
}

/**
 * Real liveness with no start time at all — the shape of a platform that cannot
 * report one (Windows today). Identity can then only come from the handshake.
 */
function blindProbe() {
  const real = nodeProcessProbe()
  return { isAlive: (pid: number) => real.isAlive(pid), startTime: async () => undefined }
}

/** The fingerprint `DshRuntime` computes for the stubbed launch configuration. */
function expectedFingerprint() {
  return {
    dshHome: resolveDshHome(),
    executable: 'dsh',
    // `webArgsForDshVersion` appends `--no-open` for 0.1.2-rc.1.
    arguments: ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    extensionVersion: 'unknown',
    runtimeVersion: state.version,
  }
}

function authResponse(): Response {
  const name = `dsh-auth-${createHash('sha256').update('127.0.0.1:43127').digest('base64url')}`
  return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${name}=v1.dGVzdA.c2lnbmF0dXJl` } })
}

function rpcResponse(init?: RequestInit): Response {
  const message = JSON.parse(String(init?.body))
  return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: { items: [] } } })
}

function authRequired(): Response {
  return new Response(null, { status: 401 })
}

/** A live process standing in for a runtime another window started. */
function idleProcess(): ChildProcess {
  const child = state.realSpawn!(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
  spawned.push(child)
  return child
}

function descriptorFor(child: ChildProcess, stateDir: string, overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  const descriptor: RuntimeDescriptor = {
    schema: 1,
    origin: 'dsh-sidebar',
    manageable: true,
    instanceId: 'earlier-window',
    pid: child.pid!,
    startedAt: Date.now() - 60_000,
    processStartTime: 'test-start',
    cwd: '/workspace',
    fingerprint: expectedFingerprint(),
    launchUrl: 'http://127.0.0.1:43127/?token=shared-token',
    ...overrides,
  }
  const broker = new RuntimeBroker({ stateDir, probe: testProbe() })
  broker.writeDescriptor(descriptor)
  return descriptor
}

const originalDshHome = process.env.DSH_HOME

beforeEach(() => {
  // Keep the ledger, the fingerprints and the conversation count hermetic: the
  // runtime resolves its DSH home from the environment, and these tests must not
  // read or depend on the developer's real one.
  process.env.DSH_HOME = join(scratch(), 'home')
  state.children = []
  state.version = '0.1.2-rc.1'
  state.timeout = 60_000
  state.reuse = false
  state.debugging = false
  vi.mocked(state.realSpawn!).mockClear?.()
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => init?.method === 'GET' ? authResponse() : rpcResponse(init)))
})

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async instance => { await instance.stop() }))
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  for (const child of spawned.splice(0)) child.kill('SIGKILL')
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('attaching to a runtime another window started', () => {
  it('bounds a busy operation by startupTimeout and can retry the same instance afterwards', async () => {
    const child = idleProcess(), dir = scratch(), broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir); state.timeout = 30
    const lock = await broker.acquireTransition(), { instance, logs } = runtime(broker)
    try {
      await expect(instance.start()).rejects.toThrow('Timed out waiting for another VS Code window')
      expect(instance.state.kind).toBe('failed')
      expect(broker.readDescriptor()?.pid).toBe(child.pid)
      expect(state.children).toHaveLength(0)
    } finally { lock.release() }
    await instance.start()
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'adopted', pid: child.pid })
    expect(logs.join('\n')).toContain('Connecting to the existing shared DSH runtime')
    expect(logs.join('\n')).not.toContain('shared-token')
    expect(state.children).toHaveLength(0)
  })

  it('uses the authenticated ledger before probing a different service on port 3080', async () => {
    const child = idleProcess(), dir = scratch(), broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir); state.reuse = true
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (new URL(url).port === '3080') throw new Error('The conventional port must not be consulted')
      return init?.method === 'GET' ? authResponse() : rpcResponse(init)
    }))
    await runtime(broker).instance.start()
    expect(state.children).toHaveLength(0)
  })

  it('does not reject a compatible runtime solely because its extension UI version differs', async () => {
    const child = idleProcess(), dir = scratch(), broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir, {fingerprint:{...expectedFingerprint(),extensionVersion:'0.1.10'}})
    await runtime(broker).instance.start()
    expect(state.children).toHaveLength(0)
  })

  it('cancels a waiting window without admitting a competing startup', async () => {
    const broker = new RuntimeBroker({stateDir:scratch(),probe:testProbe()})
    const lock = await broker.acquireTransition(), {instance} = runtime(broker)
    const starting = instance.start(); await vi.waitFor(()=>expect(instance.state.kind).toBe('starting'))
    await instance.stop(); await expect(starting).rejects.toThrow('stopped')
    expect(state.children).toHaveLength(0); lock.release()
    const after = await broker.acquireTransition({timeoutMs:100}); after.release()
  })

  it('waits for a pending lease write when a window closes during adoption', async () => {
    const child = idleProcess(), dir = scratch(), leaseWrite = Promise.withResolvers<void>()
    let selfReads = 0
    const probe = {...testProbe(),startTime:async(pid:number)=>{
      if(pid===process.pid && ++selfReads===2) await leaseWrite.promise
      return 'test-start'
    }}
    const broker = new RuntimeBroker({stateDir:dir,probe}); descriptorFor(child,dir)
    const {instance} = runtime(broker), start = instance.start()
    await vi.waitFor(()=>expect(selfReads).toBe(2))
    const stop = instance.stop(); leaseWrite.resolve(); await stop; await expect(start).rejects.toThrow('stopped')
    expect(broker.readLeases()).toEqual([]); expect(state.children).toHaveLength(0)
  })

  it('adopts it instead of spawning a second one', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir)
    const { instance, logs } = runtime(broker)

    const uri = await instance.start()

    expect(uri.toString()).toBe('http://127.0.0.1:43127/')
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'adopted' })
    expect(instance.connection.authenticated).toBe(true)
    // The whole point: no second runtime competing for the same conversations.
    expect(state.children).toHaveLength(0)
    expect(logs.join('\n')).toContain('attached to a DSH runtime started by another window')
    expect(logs.join('\n')).not.toContain('shared-token')
  })

  it('records this window as a lease holder of the adopted runtime', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir)
    const { instance } = runtime(broker)

    await instance.start()
    await vi.waitFor(() => expect(broker.readLeases()).toHaveLength(1))
    expect(broker.readLeases()[0]!.pid).toBe(process.pid)
  })

  it('reports incompatible settings without spawning or ending the live runtime', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir, { fingerprint: { ...expectedFingerprint(), dshHome: '/somewhere/else/.dsh' } })
    const { instance, logs } = runtime(broker)

    await expect(instance.start()).rejects.toThrow('incompatible settings')
    expect(state.children).toHaveLength(0)
    expect(instance.state).toMatchObject({ kind: 'failed' })
    expect(logs.join('\n')).not.toContain('shared-token')
    // The mismatched runtime is still running: nothing in this path ends a process.
    expect(child.exitCode).toBeNull()
  })

  it('actually replaces an incompatible runtime when Restart is requested by a window that never acquired a lease', async () => {
    const child = idleProcess(), dir = scratch(), broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir, { fingerprint: { ...expectedFingerprint(), runtimeVersion: 'older-version' } })
    const { instance, logs } = runtime(broker)
    await expect(instance.start()).rejects.toThrow('different DSH version')
    expect(broker.readLeases()).toEqual([])
    const restart = instance.restart()
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=replacement-token\n')
    await restart
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'managed' })
    expect(broker.readDescriptor()?.pid).toBe(123)
    expect(logs.join('\n')).not.toContain('shared-token')
    expect(logs.join('\n')).not.toContain('replacement-token')
  })

  it('does not replace an incompatible runtime with active borrowers without confirmation', async () => {
    const child = idleProcess(), dir = scratch(), broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir, { fingerprint: { ...expectedFingerprint(), runtimeVersion: 'older-version' } })
    await broker.takeLease('other-window', child.pid)
    const { instance } = runtime(broker)
    await expect(instance.start()).rejects.toThrow('incompatible settings')
    await expect(instance.restart()).rejects.toThrow('another VS Code window')
    expect(child.exitCode).toBeNull()
    expect(state.children).toHaveLength(0)
  })

  it('retains an unauthenticating live runtime without starting a competing writer', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir)
    const { instance, logs } = runtime(broker)
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => init?.method === 'GET' ? authRequired() : rpcResponse(init)))

    await expect(instance.start()).rejects.toThrow('no additional runtime was started')
    expect(instance.state).toMatchObject({ kind: 'failed' })
    expect(state.children).toHaveLength(0)
    expect(broker.readDescriptor()?.pid).toBe(child.pid)
    expect(logs.join('\n')).not.toContain('shared-token')
    expect(child.exitCode).toBeNull()
  })

  it('refuses to replace an unverifiable descriptor', async () => {
    const child = idleProcess()
    const dir = scratch()
    writeFileSync(join(dir, 'runtime.json'), JSON.stringify({
      ...descriptorFor(child, dir), origin: 'user',
    }))
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance } = runtime(broker)

    await expect(instance.start()).rejects.toThrow('cannot be verified')
    expect(state.children).toHaveLength(0)
    expect(instance.state).toMatchObject({ kind: 'failed' })
  })
})

describe('publishing a runtime for another window', () => {
  it('releases startup coordination after a process error so retry can complete', async () => {
    const broker=new RuntimeBroker({stateDir:scratch(),probe:testProbe()}),{instance}=runtime(broker)
    const first=instance.start(); await vi.waitFor(()=>expect(state.children).toHaveLength(1))
    state.children[0]!.emit('error',new Error('Isolated runtime host registration failed'))
    await expect(first).rejects.toThrow('registration failed')
    const retry=instance.start(); await vi.waitFor(()=>expect(state.children).toHaveLength(2))
    state.children[1]!.stdout.emit('data','dsh web: http://127.0.0.1:43127/?token=retry-token\n')
    await retry; expect(instance.state.kind).toBe('ready'); expect(broker.readLeases()).toHaveLength(1)
  })
  it('records the managed runtime with its fingerprint, and keeps the token out of the log', async () => {
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance, logs } = runtime(broker)

    const pending = instance.start()
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=managed-token\n')
    await pending

    await vi.waitFor(() => expect(broker.readDescriptor()).toBeDefined())
    const descriptor = broker.readDescriptor()!
    expect(descriptor.pid).toBe(123)
    expect(descriptor.cwd).toBe('/workspace')
    expect(descriptor.fingerprint).toEqual(expectedFingerprint())
    // The token has to be on disk for a later window to authenticate, and must
    // never reach the output channel.
    expect(descriptor.manageable).toBe(true)
    expect(readFileSync(join(dir, 'runtime.json'), 'utf8')).toContain('managed-token')
    expect(logs.join('\n')).not.toContain('managed-token')
    // Started, not attached: the log says so, without leaking the token.
    expect(logs.join('\n')).not.toContain('attached to a DSH runtime')
    expect(logs.join('\n')).toContain('[runtime] launch:')
  })

  it('preserves a mismatched record when refusing to start', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    // Same machine, different DSH home: adoptable by nobody, but still holding
    // whatever conversations it opened.
    descriptorFor(child, dir, { fingerprint: { ...expectedFingerprint(), dshHome: '/elsewhere/.dsh' } })
    const { instance, logs } = runtime(broker)

    await expect(instance.start()).rejects.toThrow('incompatible settings')
    expect(state.children).toHaveLength(0)
    expect(broker.readDescriptor()?.pid).toBe(child.pid)
    expect(logs.join('\n')).not.toContain('shared-token')
    expect(child.exitCode).toBeNull()
  })
})

describe('recovering a runtime orphaned by a crashed window', () => {
  it('adopts the orphan, then releases it when the last window closes', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    // The window that started it was killed without running `deactivate`: its
    // record survives, and its lease names a process that no longer exists.
    descriptorFor(child, dir, { instanceId: 'crashed-window' })
    broker.writeLease({
      schema: 1, instanceId: 'crashed-window', pid: 2_147_483_646, createdAt: Date.now(), runtimePid: child.pid!,
    })
    await broker.sweep()
    expect(broker.readLeases()).toEqual([])

    const { instance, logs } = runtime(broker)
    await instance.start()
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'adopted' })
    expect(state.children).toHaveLength(0)

    // The runtime was mid-turn work from the crashed window; attaching kept it,
    // and closing the last window is what finally releases its conversations.
    await instance.stop()
    await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true))
    expect(broker.readDescriptor()).toBeUndefined()
    expect(logs.join('\n')).toContain('the conversations it held are released')
  })
})

describe('releasing a runtime', () => {
  it('allows replacing a proved-dead runtime even if another live window has an old lease', async () => {
    const child=idleProcess(),dir=scratch(),broker=new RuntimeBroker({stateDir:dir,probe:testProbe()})
    descriptorFor(child,dir)
    const {instance}=runtime(broker); await instance.start()
    broker.writeLease({schema:1,instanceId:'other-window',pid:process.pid,createdAt:Date.now(),runtimePid:child.pid})
    const exited=new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM'); await exited
    const restart=instance.restart()
    await vi.waitFor(()=>expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data','dsh web: http://127.0.0.1:43127/?token=replacement-token\n')
    await restart
    expect(instance.state).toMatchObject({kind:'ready',ownership:'managed'})
    expect(broker.readDescriptor()?.pid).toBe(123)
  })
  it('stops an adopted runtime when this was the last window using it', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir)
    const { instance, logs } = runtime(broker)
    await instance.start()

    await instance.stop()

    await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true))
    expect(broker.readDescriptor()).toBeUndefined()
    expect(broker.readLeases()).toEqual([])
    expect(logs.join('\n')).toContain('the conversations it held are released')
  })

  it('leaves a shared runtime running for the window that still holds it', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir)
    broker.writeLease({ schema: 1, instanceId: 'other-window', pid: process.pid, createdAt: Date.now() })
    const { instance, logs } = runtime(broker)
    await instance.start()

    await instance.stop()

    expect(child.exitCode).toBeNull()
    expect(broker.readDescriptor()).toBeDefined()
    expect(logs.join('\n')).toContain('still in use by 1 other window(s)')
  })

  it('proves identity through the runtime itself when no start time is available', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: blindProbe() })
    descriptorFor(child, dir)
    const { instance, logs } = runtime(broker)
    await instance.start()
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'adopted' })

    await instance.stop()

    // The launch token is minted per runtime process and never persisted, so a
    // runtime that accepts it is that instance — enough to signal its pid.
    await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true))
    expect(broker.readDescriptor()).toBeUndefined()
    expect(logs.join('\n')).toContain('the conversations it held are released')
  })

  it('never signals a runtime it cannot identify', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: blindProbe() })
    descriptorFor(child, dir)
    const { instance, logs } = runtime(broker)
    await instance.start()
    // The record is now stale: whatever holds that port no longer answers with the
    // recorded token, so the pid may belong to something else entirely.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await instance.stop()

    expect(child.exitCode).toBeNull()
    expect(broker.readDescriptor()?.pid).toBe(child.pid)
    expect(logs.join('\n')).toContain('did not answer with its own launch token')
    expect(logs.join('\n')).not.toContain('the conversations it held are released')
  })

  it('removes only its own lease when another window shares the runtime', async () => {
    const child = idleProcess()
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    descriptorFor(child, dir)
    broker.writeLease({ schema: 1, instanceId: 'other-window', pid: process.pid, createdAt: Date.now() })
    const { instance } = runtime(broker)
    await instance.start()
    await vi.waitFor(() => expect(broker.readLeases()).toHaveLength(2))

    await instance.stop()

    expect(broker.readLeases().map(lease => lease.instanceId)).toEqual(['other-window'])
  })

  it('stops a managed runtime that this window started', async () => {
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance } = runtime(broker)
    const pending = instance.start()
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=managed-token\n')
    await pending
    await vi.waitFor(() => expect(broker.readDescriptor()).toBeDefined())

    await instance.stop()

    // The stub child reports its own exit, and the ledger is cleared with it.
    expect(broker.readDescriptor()).toBeUndefined()
    expect(broker.readLeases()).toEqual([])
  })

  it('leaves its own child running when another window still holds its lease', async () => {
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    const { instance, logs } = runtime(broker)
    const pending = instance.start()
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    const child = state.children[0]!
    child.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=managed-token\n')
    await pending
    await vi.waitFor(() => expect(broker.readDescriptor()).toBeDefined())
    broker.writeLease({ schema: 1, instanceId: 'other-window', pid: process.pid, createdAt: Date.now(), runtimePid: child.pid })
    let exited = false
    child.once('exit', () => { exited = true })
    await instance.stop()
    expect(exited).toBe(false)
    expect(broker.readDescriptor()?.pid).toBe(child.pid)
    expect(broker.readLeases().map(lease => lease.instanceId)).toEqual(['other-window'])
    expect(logs.join('\n')).toContain('leaving it running')
  })

  it('discards a record whose process is provably gone', async () => {
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    broker.writeDescriptor({
      schema: 1, origin: 'dsh-sidebar', manageable: true, instanceId: 'dead-window',
      // A pid that cannot exist, so the sweep must not need to signal anything.
      pid: 2_147_483_646, startedAt: Date.now() - 1_000, cwd: '/workspace',
      fingerprint: expectedFingerprint(), launchUrl: 'http://127.0.0.1:43127/?token=stale',
    })
    expect(existsSync(join(dir, 'runtime.json'))).toBe(true)
    await expect(broker.sweep()).resolves.toHaveLength(1)
    expect(broker.readDescriptor()).toBeUndefined()
  })
})

describe('launcher home resolution used by the fingerprint', () => {
  it('matches the DSH default so two windows on one machine agree', () => {
    expect(resolveDshHome({}, '/home/example')).toBe(join('/home/example', '.dsh'))
    expect(expectedFingerprint().dshHome).toBe(process.env.DSH_HOME?.trim() ? resolveDshHome() : join(homedir(), '.dsh'))
  })
})


describe('a runtime the user asked us to remember', () => {
  it('is attached to, and reported as attached rather than adopted', async () => {
    const dir = scratch()
    savedDescriptor(dir)
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance, logs } = runtime(broker)

    await instance.start()

    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'attached' })
    expect(state.children).toHaveLength(0)
    expect(logs.join('\n')).toContain('the DSH runtime you saved')
  })

  it('is never stopped, even when it is the last window using it', async () => {
    const dir = scratch()
    savedDescriptor(dir)
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance, logs } = runtime(broker)
    await instance.start()

    await instance.stop()

    // The user's own process outlives every window that attached to it.
    expect(broker.readDescriptor()).toBeDefined()
    expect(logs.join('\n')).toContain('attach-only')
    expect(logs.join('\n')).not.toContain('the conversations it held are released')
  })

  it('retains a saved runtime that stops answering until explicitly forgotten', async () => {
    const dir = scratch()
    savedDescriptor(dir)
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance, logs } = runtime(broker)
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => init?.method === 'GET' ? authRequired() : rpcResponse(init)))

    await expect(instance.start()).rejects.toThrow('record was retained')
    expect(instance.state).toMatchObject({ kind: 'failed' })
    expect(state.children).toHaveLength(0)
    expect(broker.readDescriptor()).toMatchObject({ manageable: false })
    expect(logs.join('\n')).not.toContain('saved-token')
  })

  it('is still honoured when reuse across windows is disabled', async () => {
    const dir = scratch()
    savedDescriptor(dir)
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance } = runtime(broker, false)

    await instance.start()

    // `reuseAcrossWindows` is about runtimes this extension started; the user's own
    // runtime is theirs to share and is not affected by it.
    expect(instance.state).toMatchObject({ kind: 'ready', ownership: 'attached' })
    expect(state.children).toHaveLength(0)
  })

  it('records the URL the user pasted, and then stops asking', async () => {
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance } = runtime(broker)
    const external = { kind: 'external' as const, launchUrl: new URL('http://127.0.0.1:43127/?token=saved-token') }

    await instance.start(undefined, external)
    expect(instance.externalRuntimeUrlToRemember()).toBe(external.launchUrl.href)
    await expect(instance.rememberExternalRuntime('/workspace')).resolves.toBe(true)

    const record = broker.readDescriptor()!
    expect(record).toMatchObject({ manageable: false, launchUrl: external.launchUrl.href, cwd: '/workspace' })
    // Nothing left to ask: the same URL is already saved.
    expect(instance.externalRuntimeUrlToRemember()).toBeUndefined()
  })

  it('never offers to save a runtime this extension started', async () => {
    const dir = scratch()
    const broker = new RuntimeBroker({ stateDir: dir, probe: testProbe() })
    const { instance } = runtime(broker)
    const pending = instance.start()
    await vi.waitFor(() => expect(state.children).toHaveLength(1))
    state.children[0]!.stdout.emit('data', 'dsh web: http://127.0.0.1:43127/?token=managed-token\n')
    await pending

    expect(instance.externalRuntimeUrlToRemember()).toBeUndefined()
    expect(broker.readDescriptor()?.manageable).toBe(true)
  })
})
