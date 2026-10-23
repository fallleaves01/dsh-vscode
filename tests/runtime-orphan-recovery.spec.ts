import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeBroker, type ProcessProbe, type RuntimeDescriptor } from '../src/runtime-broker.js'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-orphan-recovery-')); roots.push(root)
  const live = new Set([20]), starts = new Map([[10, 'host-start'], [20, 'runtime-start'], [30, 'window-start']])
  const probe: ProcessProbe = { isAlive: pid => live.has(pid), startTime: async pid => starts.get(pid) }
  const broker = new RuntimeBroker({ stateDir: root, probe })
  const descriptor: RuntimeDescriptor = { schema: 1, origin: 'dsh-sidebar', manageable: true, instanceId: 'old-window',
    pid: 20, processStartTime: 'runtime-start', host: { pid: 10, startTime: 'host-start' }, startedAt: 1,
    cwd: '/fixture', fingerprint: { dshHome: '/fixture/dsh', executable: 'dsh', arguments: ['web'], extensionVersion: 'fixture', hostProtocol: 'ipc-2' },
    launchUrl: 'http://127.0.0.1:39001/?token=synthetic_fixture' }
  broker.writeDescriptor(descriptor)
  const signal = vi.spyOn(process, 'kill').mockImplementation((pid, kind) => {
    if (kind === 0 && !live.has(Math.abs(pid))) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    if (kind === 'SIGTERM' || kind === 'SIGKILL') live.delete(Math.abs(pid))
    return true
  })
  return { root, live, starts, broker, descriptor, signal }
}

describe('recovery before opening a conversation', () => {
  it('stops a verified orphan and removes its record before a new startup', async () => {
    const { broker, signal } = setup()
    await expect(broker.recoverAbandonedRuntime()).resolves.toBe(true)
    expect(signal).toHaveBeenCalledWith(process.platform === 'win32' ? 20 : -20, 'SIGTERM')
    expect(broker.readDescriptor()).toBeUndefined()
  })

  it('preserves a supervised runtime for reconnection', async () => {
    const { broker, live, descriptor, signal } = setup(); live.add(10)
    await expect(broker.recoverAbandonedRuntime()).resolves.toBe(false)
    expect(signal).not.toHaveBeenCalled()
    expect(await broker.decide(descriptor.fingerprint!)).toMatchObject({ action: 'adopt' })
  })

  it('does not kill a live runtime with an unprovable helper identity', async () => {
    const { broker, live, starts, signal } = setup(); live.add(10); starts.delete(10)
    await expect(broker.recoverAbandonedRuntime()).resolves.toBe(false)
    expect(signal).not.toHaveBeenCalled()
  })

  it('blocks an orphan whose PID identity is unknown', async () => {
    const { broker, starts, signal } = setup(); starts.delete(20)
    await expect(broker.recoverAbandonedRuntime()).rejects.toThrow('identity cannot be verified')
    expect(signal).not.toHaveBeenCalled(); expect(broker.readDescriptor()).toBeDefined()
  })

  it('discards a reused PID record without signalling its new owner', async () => {
    const { broker, starts, signal } = setup(); starts.set(20, 'unrelated-new-process')
    await expect(broker.recoverAbandonedRuntime()).resolves.toBe(true)
    expect(signal).not.toHaveBeenCalled(); expect(broker.readDescriptor()).toBeUndefined()
  })

  it('refuses automatic cleanup while another valid window still uses the runtime', async () => {
    const { broker, live, signal } = setup(); live.add(30)
    broker.writeLease({ schema: 1, instanceId: 'another', pid: 30, processStartTime: 'window-start', runtimePid: 20, createdAt: 1 })
    await expect(broker.recoverAbandonedRuntime()).rejects.toThrow('another VS Code window')
    expect(signal).not.toHaveBeenCalled(); expect(broker.readDescriptor()).toBeDefined()
  })

  it('retains the orphan when its signal is refused', async () => {
    const { broker, signal } = setup()
    signal.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    await expect(broker.recoverAbandonedRuntime()).rejects.toThrow('could not be stopped')
    expect(broker.readDescriptor()).toBeDefined()
  })

  it('honours cancellation before signalling', async () => {
    const { broker, signal } = setup()
    await expect(broker.recoverAbandonedRuntime(AbortSignal.abort())).rejects.toThrow('stopped')
    expect(signal).not.toHaveBeenCalled()
  })

  it('never cleans up an attach-only runtime', async () => {
    const { broker, descriptor, signal } = setup(); broker.writeDescriptor({ ...descriptor, manageable: false })
    await expect(broker.recoverAbandonedRuntime()).resolves.toBe(false)
    expect(signal).not.toHaveBeenCalled(); expect(broker.readDescriptor()).toBeDefined()
  })

  it('recovers a recorded startup that died before the URL was published', async () => {
    const { broker, root } = setup(); broker.clearDescriptor()
    await broker.reserveStartup(10, 'old-window')
    broker.markStartupLaunched('old-window', 20, 'runtime-start', 'ipc-2')
    await expect(broker.waitForStartup(undefined, 10, true)).resolves.toBeUndefined()
    expect(existsSync(join(root, 'starting.json'))).toBe(false)
  })

  it.each([undefined, ''])('retains a startup without a verifiable identity (%s)', async runtimeStart => {
    const { broker, root, signal } = setup(); broker.clearDescriptor()
    await broker.reserveStartup(10, 'old-window')
    broker.markStartupLaunched('old-window', 20, runtimeStart, 'ipc-2')
    await expect(broker.waitForStartup(undefined, 10, true)).rejects.toThrow('record was retained')
    expect(signal).not.toHaveBeenCalled(); expect(existsSync(join(root, 'starting.json'))).toBe(true)
  })

  it('refuses a startup whose runtime is different from the saved descriptor', async () => {
    const { broker, signal } = setup()
    await broker.reserveStartup(10, 'different-window')
    broker.markStartupLaunched('different-window', 20, 'runtime-start', 'ipc-2')
    await expect(broker.waitForStartup(undefined, 10, true)).rejects.toThrow('differs from the abandoned startup')
    expect(signal).not.toHaveBeenCalled()
  })

  it('retains a startup using an unknown process-group protocol', async () => {
    const { broker, root, signal } = setup(); broker.clearDescriptor()
    await broker.reserveStartup(10, 'old-window')
    broker.markStartupLaunched('old-window', 20, 'runtime-start', 'unknown')
    await expect(broker.waitForStartup(undefined, 10, true)).rejects.toThrow('record was retained')
    expect(signal).not.toHaveBeenCalled(); expect(existsSync(join(root, 'starting.json'))).toBe(true)
  })

  it('preserves an abandoned startup with another live user', async () => {
    const { broker, root, live, signal } = setup(); broker.clearDescriptor(); live.add(30)
    await broker.reserveStartup(10, 'old-window')
    broker.markStartupLaunched('old-window', 20, 'runtime-start', 'ipc-2')
    broker.writeLease({ schema: 1, instanceId: 'another', pid: 30, processStartTime: 'window-start', runtimePid: 20, createdAt: 1 })
    await expect(broker.waitForStartup(undefined, 10, true)).rejects.toThrow('another VS Code window')
    expect(signal).not.toHaveBeenCalled(); expect(existsSync(join(root, 'starting.json'))).toBe(true)
  })

  it('retains an abandoned startup when termination is denied', async () => {
    const { broker, root, signal } = setup(); broker.clearDescriptor()
    await broker.reserveStartup(10, 'old-window')
    broker.markStartupLaunched('old-window', 20, 'runtime-start', 'ipc-2')
    signal.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    await expect(broker.waitForStartup(undefined, 10, true)).rejects.toThrow('could not be stopped')
    expect(existsSync(join(root, 'starting.json'))).toBe(true)
  })
})
