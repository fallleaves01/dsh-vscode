import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeBroker, nodeProcessProbe, parseDescriptor, parseLease } from '../src/runtime-broker.js'
import { findVsCodeServer } from '../src/runtime-lifetime.js'
import { OwnedRuntimeGroup } from '../src/runtime-process-group.js'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function scratch(): string { const root = mkdtempSync(join(tmpdir(), 'dsh-lifetime-')); roots.push(root); return root }
const stat = (pid: number, parent: number, name = 'node') => `${pid} (${name}) S ${parent} 0 0`

describe('VS Code Server lifetime identity', () => {
  it('walks only the bounded ancestry and stores no command-line material', async () => {
    const read = vi.fn((file: string) => ({
      '/proc/42/stat': stat(42, 40, 'node (helper)'), '/proc/42/cmdline': 'node\0wrapper.js\0',
      '/proc/40/stat': stat(40, 1), '/proc/40/cmdline': '/bin/node\0/private/out/server-main.js\0--token=private\0',
    })[file]!)
    const owner = await findVsCodeServer({ isAlive: () => true, startTime: async () => 'start' }, { parentPid: 42, readText: read })
    expect(owner).toEqual({ pid: 40, startTime: 'start' })
    expect(read).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(owner)).not.toMatch(/private|token|node/)
  })

  it('rejects PID reuse during ancestry inspection', async () => {
    let reads = 0
    await expect(findVsCodeServer({ isAlive: () => true, startTime: async () => String(++reads) }, {
      parentPid: 42, readText: file => file.endsWith('/stat') ? stat(42, 1) : '/bin/node\0/x/out/server-main.js\0',
    })).rejects.toThrow('Could not verify')
  })

  it('bounds traversal and refuses an unidentified remote server', async () => {
    const read = vi.fn((file: string) => file.endsWith('/stat') ? stat(40, Number(file.split('/')[2]) - 1) : '/bin/node\0')
    await expect(findVsCodeServer({ isAlive: () => true, startTime: async () => 'start' }, { parentPid: 100, readText: read })).rejects.toThrow('No managed DSH runtime was started')
    expect(read).toHaveBeenCalledTimes(16)
  })

  it('expires a surviving extension host when its owning server exits, while retaining another server', async () => {
    const dead = new Set<number>()
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: { isAlive: pid => !dead.has(pid), startTime: async () => 'start' } })
    const base = { schema: 1, pid: 42, createdAt: 1, processStartTime: 'start', runtimePid: 50 }
    broker.writeLease({ ...base, instanceId: 'a', server: { pid: 10, startTime: 'start' } })
    broker.writeLease({ ...base, instanceId: 'b', server: { pid: 11, startTime: 'start' } })
    expect(await broker.liveLeases()).toHaveLength(2)
    dead.add(10)
    expect((await broker.liveLeases()).map(x => x.instanceId)).toEqual(['b'])
    dead.add(11)
    expect(await broker.liveLeases()).toHaveLength(0)
  })

  it('keeps uncertain server identities and rejects malformed lifetime records', async () => {
    const lease = { schema: 1, instanceId: 'a', pid: 42, createdAt: 1, runtimePid: 50, server: { pid: 10, startTime: 'start' } }
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: { isAlive: () => true, startTime: async () => undefined } })
    broker.writeLease(lease)
    expect(await broker.liveLeases()).toHaveLength(1)
    expect(parseLease(JSON.stringify({ ...lease, server: { pid: -10, startTime: 'start' } }))).toBeUndefined()
    expect(parseDescriptor(JSON.stringify({ schema: 1, origin: 'dsh-sidebar', manageable: false, instanceId: 'a', startedAt: 1,
      cwd: '/fixture', launchUrl: 'http://127.0.0.1:1', host: { pid: 0, startTime: 'start' } }))).toBeUndefined()
  })

  it('records the server once per window and refuses a new lease after its death', async () => {
    let alive = true
    const serverOwner = vi.fn(async () => ({ pid: 10, startTime: 'start' }))
    const root = scratch()
    const broker = new RuntimeBroker({ stateDir: root, serverOwner, probe: { isAlive: () => alive, startTime: async () => 'start' } })
    await broker.takeLease('a', 50); await broker.takeLease('a', 50)
    expect(serverOwner).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(join(root, 'holds/a.json'), 'utf8')).server).toEqual({ pid: 10, startTime: 'start' })
    alive = false
    await expect(broker.takeLease('b', 50)).rejects.toThrow('VS Code Server')
  })

  it('does not let an old helper delete a new startup by the same window', async () => {
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: { isAlive: () => true, startTime: async () => 'start' } })
    await broker.reserveStartup(11, 'same-window')
    broker.clearStartup('same-window', 10)
    await expect(broker.waitForStartup(undefined, 0)).rejects.toThrow('still starting')
    broker.clearStartup('same-window', 11)
    await expect(broker.waitForStartup(undefined, 0)).resolves.toBeUndefined()
  })

  it('does not treat a Linux zombie as a live window or runtime', () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const probe = nodeProcessProbe({ platform: 'linux', readText: () => '42 (node (worker)) Z 1 0' })
    expect(probe.isAlive(42)).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })
})

describe('owned DSH process group', () => {
  it.skipIf(process.platform === 'win32')('force-cleans a verified orphan group even when only the leader accepted SIGTERM', async () => {
    let leader = true, groupAlive = true
    const broker = new RuntimeBroker({ stateDir: scratch(), probe: { isAlive: () => leader, startTime: async () => 'start' } })
    const descriptor = { schema: 1, origin: 'dsh-sidebar' as const, manageable: true, instanceId: 'group', pid: 12345,
      processStartTime: 'start', startedAt: 1, cwd: '/fixture', launchUrl: 'http://127.0.0.1:39001/?token=fixture' }
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGTERM') leader = false
      if (signal === 'SIGKILL') groupAlive = false
      if (signal === 0 && !groupAlive) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      return true
    })
    await expect(broker.stop(descriptor, { graceMs: 0, processGroup: true })).resolves.toBe(true)
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL')
  })

  it.skipIf(process.platform === 'win32')('signals only the dedicated group, and never a reused leader PID', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const child = { pid: 12345, exitCode: null as number | null, signalCode: null }
    let start = 'original'
    const group = new OwnedRuntimeGroup(child as never, { isAlive: () => true, startTime: async () => start })
    await group.signal('SIGTERM')
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGTERM')
    child.exitCode = 0; start = 'reused'
    await group.signal('SIGKILL')
    expect(kill).not.toHaveBeenCalledWith(-12345, 'SIGKILL')
  })
})
