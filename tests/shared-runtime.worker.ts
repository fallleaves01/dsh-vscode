// Built only by shared-runtime.runtime.mjs, with a minimal VS Code host adapter.
import * as vscode from 'vscode'
import { DshRuntime } from '../src/runtime.js'
import { RuntimeBroker, sharedRuntimeDirectory } from '../src/runtime-broker.js'
import { TaskRuntimeContribution } from '../src/task-runtime-contribution.js'
import { DshClient } from '../src/dsh-client.js'
import { join } from 'node:path'
import type { RuntimeRestartPlan } from '../src/runtime-restart.js'

const home = process.env.HOME!, project = process.env.DSH_TEST_PROJECT!
const broker = new RuntimeBroker({ stateDir: sharedRuntimeDirectory(process.env.DSH_HOME!, home, 'isolated-test-host') })
const logs: string[] = []
const runtime = new DshRuntime({
  extensionUri: { fsPath: process.env.DSH_TEST_EXTENSION! },
  globalStorageUri: { fsPath: join(home, process.env.DSH_TEST_PROFILE!) },
  extension: { packageJSON: { version: process.env.DSH_TEST_VERSION ?? 'fixture' } },
  secrets: { get: async () => undefined },
} as never, { appendLine: (line: string) => { if (logs.length < 500) logs.push(line) } } as never,
new TaskRuntimeContribution({ globalStorageUri: { fsPath: join(home, process.env.DSH_TEST_PROFILE!) } } as never), broker, true,
{ script: join(process.env.DSH_TEST_EXTENSION!, 'dist', 'runtime-host.js'), orphanGraceMs: 3_000, leasePollMs: 150 })
let client: DshClient | undefined
let restartPlan: RuntimeRestartPlan | undefined
let crashDuringAuthentication = false
runtime.onDidChangeState(state => {
  if (crashDuringAuthentication && state.kind === 'starting' && state.detail.includes('Authenticating')) process.exit(0)
})
process.on('message', (input: { id: number; command: string; sessionId?: string }) => {
  void (async () => {
    if (input.command === 'start' || input.command === 'start-and-crash') {
      crashDuringAuthentication = input.command === 'start-and-crash'
      await runtime.start(vscode.Uri.file(project))
      client = new DshClient(runtime.connection); await client.startStreams()
      return { pid: broker.readDescriptor()?.pid, ownership: runtime.state.kind === 'ready' ? runtime.state.ownership : undefined,
        leases: broker.readLeases().length }
    }
    if (input.command === 'stop') { client?.dispose(); client = undefined; await runtime.stop(); return true }
    if (input.command === 'state') return runtime.state
    if (input.command === 'restart') { await runtime.restart(); return true }
    if (input.command === 'prepare-restart') {
      restartPlan = await runtime.prepareRestart()
      return { pid: restartPlan?.descriptor.pid, otherWindows: restartPlan?.otherWindows.length ?? 0 }
    }
    if (input.command === 'confirm-restart') {
      if (restartPlan === undefined) throw new Error('No reviewed restart plan.')
      client?.dispose(); client = undefined
      await runtime.stop(false, true, restartPlan); restartPlan = undefined
      await runtime.start(vscode.Uri.file(project))
      client = new DshClient(runtime.connection); await client.startStreams()
      return { pid: broker.readDescriptor()?.pid, ownership: runtime.state.kind === 'ready' ? runtime.state.ownership : undefined }
    }
    if (input.command === 'create') {
      const { sessionId } = await client!.createSession(project)
      await client!.renameSession(sessionId, 'Shared runtime test')
      await client!.listCommands(sessionId)
      return { sessionId }
    }
    if (input.command === 'read') {
      // Reopen persisted sessions as the conversation controller does. A fresh
      // DSH process has no in-memory agent until this step has completed.
      const opening = await client!.openSession(input.sessionId!); opening.activate()
      const commands = await client!.listCommands(input.sessionId!)
      await client!.renameSession(input.sessionId!, 'Changed by another window')
      return { commands: Array.isArray(commands), sessions: (await client!.listSessions()).items }
    }
    if (input.command === 'services') {
      await client!.schedules(); await client!.searchHistory('isolated-no-matches')
      return { historySearch: true, schedule: true }
    }
    if (input.command === 'exit') process.exit(0)
    throw new Error('Unknown isolated test command.')
  })().then(result => { process.send?.({ id: input.id, result }) }, error => {
    process.send?.({ id: input.id, error: error instanceof Error ? error.message : String(error) })
  })
})
process.on('disconnect', () => { process.exit(0) })
