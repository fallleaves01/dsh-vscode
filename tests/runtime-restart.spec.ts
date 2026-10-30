import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeBroker, type ProcessProbe, type RuntimeDescriptor } from '../src/runtime-broker.ts'
import { inspectRuntimeRestart, stopRuntimeForRestart, validateRuntimeRestart } from '../src/runtime-restart.ts'
import { waitForChildExit } from './child-exit.ts'

const roots: string[] = [], children: ChildProcess[] = []
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(identity: string | undefined = 'recorded-start') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-restart-')); roots.push(root)
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' }); children.push(child)
  const probe: ProcessProbe = {
    isAlive: pid => { try { process.kill(pid, 0); return true } catch { return false } },
    startTime: async () => identity,
  }
  const broker = new RuntimeBroker({ stateDir: root, probe })
  const descriptor: RuntimeDescriptor = {
    schema: 1, origin: 'dsh-sidebar', manageable: true, instanceId: 'original-window', pid: child.pid!,
    processStartTime: 'recorded-start', startedAt: Date.now(), cwd: '/fixture',
    fingerprint: { dshHome: '/fixture/.dsh', executable: 'dsh', arguments: ['web'], extensionVersion: 'fixture' },
    launchUrl: 'http://127.0.0.1:43127/?token=fixture-launch-secret',
  }
  broker.writeDescriptor(descriptor)
  return { child, broker, descriptor }
}

describe('explicit shared runtime restart', () => {
  it('includes borrowers even when the requesting window has no lease', async () => {
    const { broker, child } = fixture()
    await broker.takeLease('borrower', child.pid)
    const plan = await inspectRuntimeRestart(broker, 'failed-window')
    expect(plan?.otherWindows).toEqual(['borrower'])
    expect(plan?.descriptor.pid).toBe(child.pid)
  })

  it('stops the reviewed runtime and preserves unrelated lease records', async () => {
    const { broker, child } = fixture()
    await broker.takeLease('borrower', child.pid)
    const plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    const lock = await broker.acquireTransition()
    try { await stopRuntimeForRestart(broker, plan, 'failed-window') } finally { lock.release() }
    // The broker may prove the PID dead before the ChildProcess handle updates.
    await waitForChildExit(child)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(broker.readDescriptor()).toBeUndefined()
    expect(broker.readLeases().map(x => x.instanceId)).toEqual(['borrower'])
  })

  it('can recover a runtime whose HTTP service is hung when OS process identity is proved', async () => {
    const { broker } = fixture(), fetch = vi.fn(async () => { throw new Error('HTTP unavailable') })
    vi.stubGlobal('fetch', fetch)
    const plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    await stopRuntimeForRestart(broker, plan, 'failed-window')
    expect(fetch).not.toHaveBeenCalled()
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('never stops a replacement written while the confirmation was open', async () => {
    const { broker, descriptor, child } = fixture(), plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    broker.writeDescriptor({ ...descriptor, instanceId: 'replacement-window' })
    await expect(stopRuntimeForRestart(broker, plan, 'failed-window')).rejects.toThrow('changed')
    expect(child.exitCode).toBeNull()
    expect(broker.readDescriptor()?.instanceId).toBe('replacement-window')
  })

  it('requests another review if another window joins after confirmation', async () => {
    const { broker, child } = fixture(), plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    await broker.takeLease('new-borrower', child.pid)
    await expect(stopRuntimeForRestart(broker, plan, 'failed-window')).rejects.toThrow('Another VS Code window connected')
    expect(child.exitCode).toBeNull()
  })

  it('does not treat a borrower of an older runtime as affected', async () => {
    const { broker, child } = fixture()
    await broker.takeLease('old-borrower', child.pid! + 1)
    expect((await inspectRuntimeRestart(broker, 'failed-window'))?.otherWindows).toEqual([])
  })

  it('refuses an unidentified and unauthenticated PID', async () => {
    const { broker, child } = fixture()
    const descriptor = broker.readDescriptor()!
    broker.writeDescriptor({ ...descriptor, processStartTime: undefined })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    const plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    await expect(stopRuntimeForRestart(broker, plan, 'failed-window')).rejects.toThrow('could not be identified')
    expect(child.exitCode).toBeNull()
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('uses launch-token proof when OS start-time evidence is missing', async () => {
    const { broker } = fixture()
    broker.writeDescriptor({ ...broker.readDescriptor()!, processStartTime: undefined })
    const cookie = `dsh-auth-${createHash('sha256').update('127.0.0.1:43127').digest('base64url')}`
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      if (init?.method === 'GET') return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${cookie}=v1.dGVzdA.c2lnbmF0dXJl` } })
      const request = JSON.parse(String(init?.body))
      return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { items: [] } } })
    }))
    const plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    await stopRuntimeForRestart(broker, plan, 'failed-window')
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('retains the record and reports failure if the process cannot be stopped', async () => {
    const { broker, child } = fixture(), plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    const kill = process.kill.bind(process)
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === child.pid && signal !== 0) throw new Error('EPERM')
      return kill(pid, signal)
    })
    await expect(stopRuntimeForRestart(broker, plan, 'failed-window')).rejects.toThrow('did not stop')
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('does not signal a PID reused by another process after the plan was made', async () => {
    const { broker, child } = fixture(), plan = (await inspectRuntimeRestart(broker, 'failed-window'))!
    // The process probe now disagrees with the recorded start identity.
    const restartedBroker = new RuntimeBroker({ stateDir: broker.sharedDirectory,
      probe: { isAlive: () => true, startTime: async () => 'unrelated-process-start' } })
    const signal = vi.spyOn(process, 'kill')
    await stopRuntimeForRestart(restartedBroker, plan, 'failed-window')
    expect(signal).not.toHaveBeenCalled()
    expect(child.exitCode).toBeNull()
  })

  it('does not offer attach-only runtimes for termination', async () => {
    const { broker, descriptor } = fixture()
    broker.writeDescriptor({ ...descriptor, manageable: false })
    expect(await inspectRuntimeRestart(broker, 'failed-window')).toBeUndefined()
    const plan = { descriptor, otherWindows: [] }
    await expect(validateRuntimeRestart(broker, plan, 'failed-window')).rejects.toThrow('changed')
  })
})
