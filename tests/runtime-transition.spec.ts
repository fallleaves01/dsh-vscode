import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireRuntimeTransition } from '../src/runtime-lock.js'
import { nodeProcessProbe, RuntimeBroker, sharedRuntimeDirectory, type RuntimeDescriptor } from '../src/runtime-broker.js'

const roots: string[] = []
const scratch = (): string => { const root = mkdtempSync(join(tmpdir(), 'dsh-transition-')); roots.push(root); return root }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const probe = { isAlive: (pid: number) => pid === process.pid, startTime: async () => 'current-start' }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('cross-process runtime transition policy', () => {
  it('uses boot identity and start ticks on Linux without spawning ps', async () => {
    const times = ['S',...Array.from({length:18},()=> '0'),'123456','0']
    const probe = nodeProcessProbe({platform:'linux',readText:path=>path.endsWith('boot_id')?'boot-test\n':`42 (node (worker)) ${times.join(' ')}`,
      exec:async()=>{throw new Error('ps must not run')}})
    expect(await probe.startTime(42)).toBe('linux:boot-test:123456')
  })
  it('does not treat a legacy ps identity as a dead process after the Linux upgrade', async () => {
    const broker = new RuntimeBroker({stateDir:scratch(),probe:{isAlive:()=>true,startTime:async()=> 'linux:boot:123'}})
    expect(await broker.isRecordRunning(42,'Tue Oct 20 10:00:00 2026')).toBe(true)
  })
  it('serializes simultaneous contenders until each entire operation finishes', async () => {
    const directory = join(scratch(), 'operations'); let active = 0, max = 0, completed = 0
    await Promise.all(Array.from({ length: 12 }, async () => {
      const lock = await acquireRuntimeTransition(directory, probe, { pollMs: 2, timeoutMs: 2_000 })
      try { active++; max = Math.max(max, active); await pause(3); completed++; active-- }
      finally { lock.release(); lock.release() }
    }))
    expect(max).toBe(1); expect(completed).toBe(12); expect(readdirSync(directory)).toEqual([])
  })
  it.each(['dead-pid', 'reused-pid'])('recovers only a proved %s claim', async mode => {
    const directory = scratch(), abandoned = join(directory, randomUUID())
    mkdirSync(abandoned, { mode: 0o700 })
    writeFileSync(join(abandoned, 'owner.json'), JSON.stringify({pid: mode === 'dead-pid' ? 2147483646 : process.pid, start: 'old-start', ticket: 1}))
    const lock = await acquireRuntimeTransition(directory, probe)
    expect(existsSync(abandoned)).toBe(false); lock.release(); expect(readdirSync(directory)).toEqual([])
  })
  it('does not expire a slow live owner or leave a cancelled contender', async () => {
    const directory = scratch(), first = await acquireRuntimeTransition(directory, probe)
    await expect(acquireRuntimeTransition(directory, probe, {pollMs:2,timeoutMs:30})).rejects.toThrow('No additional runtime')
    expect(readdirSync(directory)).toHaveLength(1)
    const controller = new AbortController()
    const waiting = acquireRuntimeTransition(directory, probe, { signal: controller.signal, pollMs: 2 })
    await pause(10); controller.abort(); await expect(waiting).rejects.toThrow('stopped')
    expect(readdirSync(directory)).toHaveLength(1); first.release()
    const next = await acquireRuntimeTransition(directory, probe); next.release()
  })
  it('releases an operation owned by a dead server even if its extension host survived', async () => {
    const directory = scratch(), abandoned = join(directory, randomUUID())
    mkdirSync(abandoned, { mode: 0o700 })
    writeFileSync(join(abandoned, 'owner.json'), JSON.stringify({ pid: process.pid, start: 'current-start', ticket: 1,
      server: { pid: 2147483646, startTime: 'server-start' } }))
    const lock = await acquireRuntimeTransition(directory, probe, { timeoutMs: 100 })
    expect(existsSync(abandoned)).toBe(false)
    lock.release()
  })
  it('treats an unknown process start time as live', async () => {
    const directory = scratch(), abandoned = join(directory, randomUUID())
    mkdirSync(abandoned, {mode:0o700}); writeFileSync(join(abandoned,'owner.json'),JSON.stringify({pid:process.pid,start:'recorded',ticket:1}))
    await expect(acquireRuntimeTransition(directory, {...probe,startTime:async()=>undefined}, {pollMs:2,timeoutMs:20})).rejects.toThrow('No additional runtime')
    expect(existsSync(abandoned)).toBe(true)
  })
  it('rejects links and public storage before writing tokens', async () => {
    const directory = scratch(), link = join(scratch(), 'link')
    symlinkSync(directory,link,'dir'); await expect(acquireRuntimeTransition(link,probe)).rejects.toThrow('owner-only')
    if (process.platform !== 'win32') {
      chmodSync(directory,0o755); await expect(acquireRuntimeTransition(directory,probe)).rejects.toThrow('owner-only')
    }
  })
})

describe('profile-independent shared state and migration', () => {
  it('partitions hosts and DSH homes while ignoring VS Code profiles', () => {
    expect(sharedRuntimeDirectory('/data/dsh','/account','host-a')).toBe(sharedRuntimeDirectory('/data/dsh','/account','host-a'))
    expect(sharedRuntimeDirectory('/data/dsh','/account','host-a')).not.toBe(sharedRuntimeDirectory('/data/dsh','/account','host-b'))
    expect(sharedRuntimeDirectory('/data/dsh','/account','host-a')).not.toBe(sharedRuntimeDirectory('/other/dsh','/account','host-a'))
  })
  it('keeps legacy leases in the original ledger so old owners see new borrowers', async () => {
    const root = scratch(), legacyDir = join(root,'legacy'), sharedDir = join(root,'shared')
    const legacy = new RuntimeBroker({stateDir:legacyDir,probe})
    const descriptor: RuntimeDescriptor = {schema:1,origin:'dsh-sidebar',manageable:true,instanceId:'old-window',pid:process.pid,
      startedAt:Date.now(),cwd:'/project',fingerprint:{dshHome:'/dsh',executable:'dsh',arguments:['web'],extensionVersion:'0.1.10'},launchUrl:'http://127.0.0.1:1234/?token=fixture'}
    legacy.writeDescriptor(descriptor)
    const first = new RuntimeBroker({stateDir:sharedDir,legacyStateDir:legacyDir,probe})
    const lock = await first.acquireTransition(); await first.takeLease('new-window',process.pid); lock.release()
    const anotherProfile = new RuntimeBroker({stateDir:sharedDir,probe})
    expect(anotherProfile.readDescriptor()).toEqual(descriptor)
    expect(legacy.readLeases().map(x=>x.instanceId)).toEqual(['new-window'])
    expect(anotherProfile.readLeases()).toEqual(legacy.readLeases())
    expect(existsSync(join(sharedDir,'runtime.json'))).toBe(false)
  })
  it('hashes explicit environment overrides without persisting credentials', () => {
    const dir = scratch(), a = new RuntimeBroker({stateDir:dir,probe}), b = new RuntimeBroker({stateDir:dir,probe})
    const key = 'fixture-secret-which-must-not-be-written'
    expect(a.environmentDigest({})).toBeUndefined()
    const digest = a.environmentDigest({DEEPSEEK_API_KEY:key,SEARCH_BASE_URL:'https://example.test'})
    expect(digest).toBe(b.environmentDigest({SEARCH_BASE_URL:'https://example.test',DEEPSEEK_API_KEY:key}))
    expect(digest).not.toBe(a.environmentDigest({DEEPSEEK_API_KEY:'different'}))
    expect(readFileSync(join(dir,'environment.key')).includes(Buffer.from(key))).toBe(false)
    if(process.platform!=='win32')expect(statSync(join(dir,'environment.key')).mode & 0o777).toBe(0o600)
  })
  it('does not discard a live startup reservation but removes a dead one', async () => {
    const broker = new RuntimeBroker({stateDir:scratch(),probe})
    await broker.reserveStartup(process.pid,'first')
    await expect(broker.waitForStartup(undefined,10)).rejects.toThrow('No additional runtime')
    broker.clearStartup('different'); expect(existsSync(join(broker.ledgerDirectory,'starting.json'))).toBe(true)
    broker.clearStartup('first'); await broker.reserveStartup(2147483646,'dead')
    await broker.waitForStartup(); expect(existsSync(join(broker.ledgerDirectory,'starting.json'))).toBe(false)
  })
  it.each([undefined,process.pid])('retains uncertain child identity %s after a startup host crash', async runtimePid => {
    const broker=new RuntimeBroker({stateDir:scratch(),probe})
    await broker.reserveStartup(2147483646,'crashed-host'); broker.markStartupLaunched('crashed-host',runtimePid)
    await expect(broker.waitForStartup()).rejects.toThrow('no additional runtime was started')
    expect(existsSync(join(broker.ledgerDirectory,'starting.json'))).toBe(true)
  })
})
