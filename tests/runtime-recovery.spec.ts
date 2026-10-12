import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeBroker, type ProcessProbe, type RuntimeDescriptor } from '../src/runtime-broker.ts'
import { endRecordedRuntime, inspectRecordedRuntime } from '../src/runtime-recovery.ts'

/**
 * The manual "end a leftover runtime" path.
 *
 * It is the only place the extension signals a process it does not hold a handle
 * for, so every refusal matters more than the happy path.
 */

const temporary: string[] = []
const children: ChildProcess[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-recovery-'))
  temporary.push(root)
  return root
}

/** Real liveness with a fixed start time, so the identity proof is deterministic. */
function testProbe(): ProcessProbe {
  const real = { isAlive: (pid: number) => { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' } } }
  return { isAlive: pid => real.isAlive(pid), startTime: async () => 'test-start' }
}

function idleProcess(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
  children.push(child)
  return child
}

function descriptorFor(child: ChildProcess, overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  return {
    schema: 1,
    origin: 'dsh-sidebar',
    manageable: true,
    instanceId: 'earlier-window',
    pid: child.pid!,
    processStartTime: 'test-start',
    startedAt: Date.now() - 1_000,
    cwd: '/workspace',
    fingerprint: { dshHome: '/home/.dsh', executable: 'dsh', arguments: ['web'], extensionVersion: '0.1.0' },
    launchUrl: 'http://127.0.0.1:43127/?token=runtime-token',
    ...overrides,
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => init?.method === 'GET' ? authResponse() : rpcResponse(init)))
})

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('inspecting what is on record', () => {
  it('reports nothing when no runtime was recorded', async () => {
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    await expect(inspectRecordedRuntime(broker, scratch())).resolves.toEqual({ state: 'none' })
  })

  it('reports an attach-only runtime without offering to end it', async () => {
    const child = idleProcess()
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    broker.writeDescriptor(descriptorFor(child, { manageable: false }))
    const recorded = await inspectRecordedRuntime(broker, scratch())
    expect(recorded.state).toBe('attach-only')
  })

  it('forgets a record whose process is gone', async () => {
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    broker.writeDescriptor(descriptorFor({ pid: 2_147_483_646 } as ChildProcess))
    await expect(inspectRecordedRuntime(broker, scratch())).resolves.toEqual({ state: 'gone' })
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('reports a live runtime as ready', async () => {
    const child = idleProcess()
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    broker.writeDescriptor(descriptorFor(child))
    const recorded = await inspectRecordedRuntime(broker, scratch())
    expect(recorded).toMatchObject({ state: 'ready', held: 0 })
  })
})

describe('ending a recorded runtime', () => {
  it('ends it once it answers with its own launch token', async () => {
    const child = idleProcess()
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    const descriptor = descriptorFor(child)
    broker.writeDescriptor(descriptor)

    await expect(endRecordedRuntime(broker, descriptor)).resolves.toEqual({ ended: true })

    await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true))
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('sends no signal when the runtime does not answer with its token', async () => {
    const child = idleProcess()
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    const descriptor = descriptorFor(child)
    broker.writeDescriptor(descriptor)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await expect(endRecordedRuntime(broker, descriptor)).resolves.toEqual({ ended: false, reason: 'unproved' })

    // The pid may belong to something else entirely, so it must be left alone.
    expect(child.exitCode).toBeNull()
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('sends no signal when the record cannot even be read', async () => {
    const child = idleProcess()
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    const descriptor = descriptorFor(child, { launchUrl: 'not a url' })
    broker.writeDescriptor(descriptor)

    await expect(endRecordedRuntime(broker, descriptor)).resolves.toEqual({ ended: false, reason: 'unproved' })
    expect(child.exitCode).toBeNull()
  })
})

describe('counting the conversations a runtime holds', () => {
  it('groups every lock a process holds, in one scan', async () => {
    const home = scratch()
    for (const [slug, id] of [['--code-a--', 'session-1'], ['--code-a--', 'session-2'], ['--code-b--', 'session-3']]) {
      const dir = join(home, 'sessions', slug!, id!)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.lock'), '')
    }
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    // lsof names the file it matched, so the count follows the process, not the path.
    const exec = async (_file: string, args: readonly string[]): Promise<{ stdout: string }> => {
      const lines = ['p4821', 'cdsh']
      for (const path of args.slice(4)) lines.push(`n${path}`)
      lines.push('p16208', 'cDeepSeek', `n${join(home, 'sessions', '--code-a--', 'session-1', 'session.lock')}`)
      return { stdout: lines.join('\n') + '\n' }
    }
    const { countSessionsHeldBy } = await import('../src/runtime-broker.ts')
    await expect(countSessionsHeldBy(home, 4821, { platform: 'darwin', exec, isAlive: () => true }))
      .resolves.toMatchObject({ count: 3, truncated: false, available: true })
    await expect(countSessionsHeldBy(home, 16208, { platform: 'darwin', exec, isAlive: () => true }))
      .resolves.toMatchObject({ count: 1 })
  })

  it('answers zero without spawning anything when there are no sessions', async () => {
    const exec = async (): Promise<{ stdout: string }> => { throw new Error('must not be called') }
    const { countSessionsHeldBy } = await import('../src/runtime-broker.ts')
    await expect(countSessionsHeldBy(scratch(), 4821, { platform: 'darwin', exec }))
      .resolves.toEqual({ count: 0, truncated: false, available: true })
  })

  it('says the count is a lower bound when the path list was capped', async () => {
    const home = scratch()
    // More locks than one lsof argument vector may carry.
    for (let index = 0; index < 4_005; index++) {
      const dir = join(home, 'sessions', '--code--', `session-${String(index)}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.lock'), '')
    }
    const { countSessionsHeldBy } = await import('../src/runtime-broker.ts')
    const result = await countSessionsHeldBy(home, 4821, {
      platform: 'darwin',
      exec: async (_file, args) => ({ stdout: `p4821\ncdsh\nn${String(args[4])}\n` }),
      isAlive: () => true,
    })
    expect(result.truncated).toBe(true)
  })
})

/**
 * A runtime the user asked us to remember: attach-only, never ours to end.
 */
describe('a saved runtime belonging to the user', () => {
  function saved(overrides: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
    const base = descriptorFor({ pid: undefined } as unknown as ChildProcess)
    const { pid, fingerprint, processStartTime, ...rest } = base
    void pid
    void fingerprint
    void processStartTime
    return { ...rest, manageable: false, pid: undefined, ...overrides }
  }

  it('is reported as attach-only, so the manual command offers nothing to end', async () => {
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    broker.writeDescriptor(saved())
    await expect(inspectRecordedRuntime(broker, scratch())).resolves.toMatchObject({ state: 'attach-only' })
  })

  it('is refused by the manual end path even when it answers with its token', async () => {
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: testProbe() })
    const record = saved()
    await expect(endRecordedRuntime(broker, record)).resolves.toEqual({ ended: false, reason: 'attach-only' })
  })
})
