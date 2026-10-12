import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
const settings = vi.hoisted(() => ({ values: {} as Record<string, boolean> }))
vi.mock('vscode', () => ({ Uri: { file: (fsPath: string) => ({ fsPath }) }, workspace: { getConfiguration: () => ({ get: (key: string, fallback: boolean) => settings.values[key] ?? fallback }) } }))
import { taskRuntimeArgs, taskRuntimePatch, TaskRuntimeContribution } from '../src/task-runtime-contribution.js'
const directories: string[] = []
afterEach(async () => { settings.values = {}; for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })
describe('opt-in task services for managed runtimes', () => {
  it('leaves defaults and existing launch contributions unchanged', async () => {
    const existing = { transformArguments: vi.fn((args: readonly string[]) => [...args, 'debug']) }, previous = { prepare: vi.fn(async () => existing) }
    const contribution = new TaskRuntimeContribution({} as any, previous)
    expect(await contribution.prepare({ workspacePath: '/project', configuredExecutable: '', configuredArguments: ['web'] })).toBe(existing)
    expect(taskRuntimePatch({ historySearch: false, schedule: false })).toBe('')
  })
  it('enables first-search SQLite only and separately mounts Schedule', () => {
    expect(taskRuntimePatch({ historySearch: true, schedule: false })).toContain('openAt: first-search')
    expect(taskRuntimePatch({ historySearch: true, schedule: false })).not.toContain('dsh-schedule')
    expect(taskRuntimePatch({ historySearch: false, schedule: true })).toContain("name: '@deepseek-ai/dsh-schedule'")
    expect(taskRuntimePatch({ historySearch: false, schedule: true })).not.toContain('sqlite')
  })
  it.each(['0.2.0-rc.2', '0.2.0-rc.10', '0.2.0', '0.2.1-alpha.1', '1.0.0'])('supports verified %s and preserves other launch arguments', version => {
    expect(taskRuntimeArgs(['web', '--no-open', '--port', '0'], version, '/patch')).toEqual(['web', '--patch', '/patch', '--no-open', '--port', '0'])
  })
  it.each([undefined, '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-alpha.1'])('rejects unsupported %s before starting a runtime', version => {
    expect(() => taskRuntimeArgs(['web'], version, '/patch')).toThrow('0.2.0-rc.2')
  })
  it('rejects custom profiles without attempting to replace their configuration', () => {
    expect(() => taskRuntimeArgs(['--profile', 'custom'], '0.2.0-rc.2', '/patch')).toThrow('custom profile')
  })
  it('uses a stable private patch path and composes debugger environment/disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-task-runtime-')); directories.push(dir)
    settings.values = { enableHistorySearch: true, enableSchedule: true }
    const dispose = vi.fn(), previous = { prepare: vi.fn(async () => ({ environment: { DEBUG_BRIDGE: 'test' }, dispose, transformArguments: (args: readonly string[]) => [...args, '--debug'] })) }
    const contribution = new TaskRuntimeContribution({ globalStorageUri: { fsPath: dir } } as any, previous)
    const launch = { workspacePath: '/project', configuredExecutable: '', configuredArguments: ['web'] }
    const first = (await contribution.prepare(launch))!, second = (await contribution.prepare(launch))!
    const args = first.transformArguments(['web'], '0.2.0-rc.2')
    expect(args).toEqual(second.transformArguments(['web'], '0.2.0-rc.2'))
    expect(args).toContain('--debug'); expect(first.environment).toEqual({ DEBUG_BRIDGE: 'test' })
    expect(await readFile(String(args[args.indexOf('--patch') + 1]), 'utf8')).toBe(taskRuntimePatch({ historySearch: true, schedule: true }))
    await first.dispose!(); expect(dispose).toHaveBeenCalledOnce()
  })
})
