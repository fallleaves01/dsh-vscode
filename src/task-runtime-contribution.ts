import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RuntimeLaunchContext, RuntimeLaunchContributor, RuntimeLaunchPreparation } from './runtime-launch.js'

export interface TaskRuntimeOptions { historySearch: boolean; schedule: boolean }
/** Standard Web profile keeps these opt-in; no database is opened before first search. */
export function taskRuntimePatch(options: TaskRuntimeOptions): string {
  return (options.historySearch ? "- id: session-query-sqlite\n  config:\n    path: ':memory:'\n    openAt: first-search\n" : '')
    + (options.schedule ? "- insert:\n    - id: vscode-task-schedule\n      name: '@deepseek-ai/dsh-schedule'\n" : '')
}
export function taskRuntimeArgs(args: readonly string[], version: string | undefined, patch: string): string[] {
  const web = args[0] === 'web' || (args[0] === '--profile' && args[1] === 'web')
  if (!web) throw new Error('Task services require the standard DSH Web profile. Configure Schedule and session-query in your custom profile instead.')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/.exec(version ?? '')
  const supported = match && (Number(match[1]) > 0 || Number(match[2]) > 2 || (Number(match[2]) === 2 && (Number(match[3]) > 0 || !match[4] || /^rc\.(?:[2-9]|[1-9]\d)(?:\.|$)/.test(match[4]))))
  if (!supported) throw new Error('Task services require a verified DSH 0.2.0-rc.2 or newer. Update DSH, or disable the task service settings to use your current runtime.')
  if (args.some((arg, index) => arg === '--patch' && args[index + 1] === patch)) return [...args]
  return args[0] === 'web' ? ['web', '--patch', patch, ...args.slice(1)] : ['--profile', 'web', '--patch', patch, ...args.slice(2)]
}

/** Adds only explicitly enabled services to a managed launch; external runtimes never call prepare. */
export class TaskRuntimeContribution implements RuntimeLaunchContributor {
  constructor(private readonly context: vscode.ExtensionContext, private readonly previous?: RuntimeLaunchContributor) {}
  async prepare(launch: RuntimeLaunchContext): Promise<RuntimeLaunchPreparation | undefined> {
    const config = vscode.workspace.getConfiguration('deepseekHarness', vscode.Uri.file(launch.workspacePath))
    const options = { historySearch: config.get<boolean>('enableHistorySearch', false), schedule: config.get<boolean>('enableSchedule', false) }
    const existing = await this.previous?.prepare(launch)
    if (!options.historySearch && !options.schedule) return existing
    try {
      const directory = join(this.context.globalStorageUri.fsPath, 'task-services')
      await mkdir(directory, { recursive: true })
      const file = join(directory, `web-${Number(options.historySearch)}-${Number(options.schedule)}.patch.yml`)
      // Stable content/path lets other windows reuse a runtime with the same options.
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, taskRuntimePatch(options), { mode: 0o600, flag: 'wx' })
        await rename(temporary, file)
      } finally { await rm(temporary, { force: true }) }
      return { ...(existing?.environment === undefined ? {} : { environment: existing.environment }),
        transformArguments: (args, version) => taskRuntimeArgs(existing?.transformArguments(args, version) ?? args, version, file),
        ...(existing?.dispose === undefined ? {} : { dispose: () => existing.dispose!() }) }
    } catch (error) { await existing?.dispose?.(); throw error }
  }
}
