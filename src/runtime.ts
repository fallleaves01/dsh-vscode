import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { DEEPSEEK_API_KEY_SECRET } from './credentials.js'
import { resolveDshHome } from './plugin-profile.js'
import { proveRuntimeIdentity } from './runtime-identity.js'
import {
  RuntimeBroker,
  countSessionsHeldBy,
  describeDescriptor,
  type RuntimeDescriptor,
  type RuntimeFingerprint,
} from './runtime-broker.js'
import { findSourceRoot, parseDshWebUrl, resolveLaunch, searchEnvironment, type LaunchCommand, webArgsForDshVersion } from './launch.js'
import {
  DEFAULT_DSH_SERVER_URL,
  DEFAULT_DSH_WEB_ARGS,
  probeDshServer,
  shouldProbeExistingDsh,
} from './runtime-endpoint.js'
import {
  applyRuntimeLaunchPreparation,
  type RuntimeLaunchContributor,
  type RuntimeLaunchPreparation,
} from './runtime-launch.js'
import { terminateProcessTree } from './process-tree.js'
import { DshConnection } from './dsh-connection.js'
import { assertSupportedDshVersion, DSH_UPGRADE_MESSAGE } from './runtime-endpoint.js'
import { redactDshSecrets, RuntimeOutput } from './runtime-output.js'
import { existingRuntimeUrl, ExistingRuntimeConnectionError, type RuntimeTarget } from './runtime-target.js'

/**
 * Who owns the runtime process.
 *
 * - `managed` — this window started it and holds its handle.
 * - `adopted` — another window of this extension started it; this window attached.
 * - `attached` — the *user* started it and asked this extension to remember the
 *   launch URL. It is never managed: no plugins, no settings, no restart, no end.
 * - `external` — a launch URL used for this window only, never written down.
 */
export type RuntimeOwnership = 'external' | 'managed' | 'adopted' | 'attached'

export type RuntimeState =
  | { kind: 'stopped' }
  | { kind: 'starting'; detail: string }
  | { kind: 'ready'; localUri: vscode.Uri; ownership: RuntimeOwnership }
  | { kind: 'failed'; message: string; reason?: 'runtime-auth' }

interface PendingStart {
  resolve(uri: vscode.Uri): void
  reject(error: Error): void
  promise: Promise<vscode.Uri>
  /** Set for a managed spawn: what a later window must match to attach to it. */
  owned?: { fingerprint: RuntimeFingerprint; cwd: string }
}

function deferredStart(): PendingStart {
  let resolve!: (uri: vscode.Uri) => void
  let reject!: (error: Error) => void
  const promise = new Promise<vscode.Uri>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  // stop() can reject while launch preparation is still awaited; the caller
  // receives the same rejection once that preparation settles.
  void promise.catch(() => {})
  return { resolve, reject, promise }
}

/**
 * Turn a bare `spawn … ENOENT` into something the user can act on.
 *
 * `deepseekHarness.executable` is a per-machine absolute path, but VS Code
 * Settings Sync copies User settings between machines — so a path that is
 * correct on one operating system silently travels to another, where the spawn
 * fails with no mention of the setting that caused it. Windows shims are spawned
 * through a shell, so only a missing command is reported here.
 */
export function describeLaunchFailure(launch: LaunchCommand, error: unknown): Error {
  const code = (error as { code?: unknown } | null)?.code
  if (code !== 'ENOENT') return error instanceof Error ? error : new Error(String(error))
  return new Error(
    `DeepSeek Harness could not start: "${launch.command}" was not found on this ${process.platform} machine. `
    + 'VS Code Settings Sync copies deepseekHarness.executable between machines, so an absolute path set for another '
    + 'operating system breaks here. Clear the setting to use `dsh` from PATH, or point it at this machine\'s DSH.',
  )
}

/**
 * The installed extension version, used only to keep a broker fingerprint honest.
 *
 * Two windows may run different extension builds across a VS Code update; a
 * fingerprint mismatch makes them start separate runtimes rather than let an
 * older window drive a runtime a newer one configured.
 */
function extensionVersionOf(context: vscode.ExtensionContext): string {
  const manifest = (context.extension as { packageJSON?: { version?: unknown } } | undefined)?.packageJSON
  return typeof manifest?.version === 'string' && manifest.version !== '' ? manifest.version : 'unknown'
}

/** One line of operator-facing detail; never surfaces a launch token. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readDshVersion(launch: LaunchCommand, cwd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    let settled = false
    let output = ''
    let timer: NodeJS.Timeout | undefined
    const finish = (version?: string): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(version)
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(launch.command, launch.args, {
        cwd,
        env: { ...process.env, NO_COLOR: '1', ...launch.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      })
    } catch {
      finish()
      return
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk })
    child.stderr.on('data', (chunk: string) => { output += chunk })
    child.on('error', () => { finish() })
    // 'close' (not 'exit') guarantees the stdio streams have flushed, so the
    // version string cannot be truncated by a late stdout chunk.
    child.on('close', code => { finish(code === 0 ? output.trim() : undefined) })
    timer = setTimeout(() => {
      terminateProcessTree(child)
      finish()
    }, 5_000)
  })
}

/** Connects to one official DSH Web runtime, spawning and owning it only when needed. */
export class DshRuntime implements vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<RuntimeState>()
  private child: ChildProcessWithoutNullStreams | undefined
  private pending: PendingStart | undefined
  private startupTimer: NodeJS.Timeout | undefined
  private _connection: DshConnection | undefined
  private authenticating: DshConnection | undefined
  private startTask: Promise<vscode.Uri> | undefined
  private stopTask: Promise<void> | undefined
  private stopRevision = 0
  private stopping = false
  private launchPreparation: RuntimeLaunchPreparation | undefined
  private launchPreparationRelease: Promise<void> | undefined
  private _state: RuntimeState = { kind: 'stopped' }
  /** This extension host's identity in the broker's lease ledger. */
  private readonly instanceId = randomUUID()
  /** Conversations released by the most recent stop, for the restart report. */
  private released = 0
  /** When this window already reported that a saved runtime went away. */
  private warnedStaleAttached = false
  /**
   * Every form of the launch token this window has seen, for the one logger that
   * handles arbitrary runtime output: the launch URL is printed by the runtime
   * itself, and a line that echoes it must not reach the output channel verbatim.
   */
  private readonly outputSecrets: string[] = []

  readonly onDidChangeState = this.changes.event

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly launchContributor?: RuntimeLaunchContributor,
    /**
     * Cross-window runtime ledger. Omitted by unit tests and by callers that do
     * not want a window to attach to a runtime it did not spawn; every behaviour
     * it adds is gated on it being present.
     */
    private readonly broker?: RuntimeBroker,
    /**
     * Whether a window may attach to a runtime *this extension* started elsewhere.
     * A saved external runtime is unaffected: the user asked for that one.
     */
    private readonly adoptOwnRuntimes = true,
  ) {}

  get state(): RuntimeState {
    return this._state
  }

  /**
   * How many conversations the last `stop()` released.
   *
   * Ending a runtime is the only thing that returns the conversations it holds,
   * so this is what the restart button reports to the user.
   */
  get releasedSessions(): number { return this.released }

  get connection(): DshConnection {
    if (this._state.kind !== 'ready' || this._connection === undefined) {
      throw new Error('DeepSeek Harness is not connected.')
    }
    return this._connection
  }

  private publish(state: RuntimeState): void {
    this._state = state
    this.changes.fire(state)
  }

  start(workspaceUri?: vscode.Uri, target?: RuntimeTarget): Promise<vscode.Uri> {
    if (target !== undefined && (this.startTask !== undefined || this._state.kind === 'ready')) {
      return Promise.reject(new Error('Disconnect the current runtime before selecting a different connection.'))
    }
    if (this.startTask !== undefined) return this.startTask
    const task = this.startRuntime(workspaceUri, target)
    this.startTask = task
    const clear = (): void => { if (this.startTask === task) this.startTask = undefined }
    void task.then(clear, clear)
    return task
  }

  private async startRuntime(workspaceUri?: vscode.Uri, target?: RuntimeTarget): Promise<vscode.Uri> {
    const revision = this.stopRevision
    if (this.stopTask !== undefined) await this.stopTask
    if (revision !== this.stopRevision) throw new Error('DSH runtime stopped.')
    if (this._state.kind === 'ready') return this._state.localUri
    if (this.pending !== undefined) return this.pending.promise
    if (this.child !== undefined) await this.stopRuntime()
    await this.waitForLaunchCleanup()
    if (revision !== this.stopRevision) throw new Error('DSH runtime stopped.')

    const workspace = workspaceUri === undefined
      ? vscode.workspace.workspaceFolders?.[0]?.uri
      : workspaceUri
    if (workspace === undefined) {
      const error = new Error('Open a folder or workspace before starting DeepSeek Harness.')
      this.publish({ kind: 'failed', message: error.message })
      throw error
    }

    const config = vscode.workspace.getConfiguration('deepseekHarness', workspace)
    const configuredExecutable = config.get<string>('executable', '')
    const configuredArgs = config.get<string[]>('arguments', [...DEFAULT_DSH_WEB_ARGS])
    // DSH refuses this one in a `.env`: it decides how the runtime reaches the
    // network, so only its launcher may set it.
    const searchEnv = searchEnvironment(config.get<string>('searchBaseUrl', ''))
    const inspectedArgs = config.inspect<string[]>('arguments')
    const hasCustomArguments = inspectedArgs?.globalValue !== undefined
      || inspectedArgs?.workspaceValue !== undefined
      || inspectedArgs?.workspaceFolderValue !== undefined
    const reuseExistingRuntime = config.get<boolean>('reuseExistingRuntime', true)
    const timeoutMs = config.get<number>('startupTimeout', 60_000)
    const pending = deferredStart()
    this.pending = pending
    this.stopping = false
    const inheritedApiKey = process.env.DEEPSEEK_API_KEY
    if (inheritedApiKey !== undefined && inheritedApiKey !== '' && !this.outputSecrets.includes(inheritedApiKey)) this.outputSecrets.push(inheritedApiKey)

    let launch: LaunchCommand
    let version: string | undefined
    let storedApiKey: string | undefined
    try {
      if (target?.kind === 'external') {
        if (config.get<boolean>('autonomousDebugging', false)) {
          throw new Error('Autonomous debugging requires a managed runtime. Disable it before connecting to an existing DSH runtime.')
        }
        const launchUrl = existingRuntimeUrl(target.launchUrl.href)
        void this.connectExternal(launchUrl, pending)
        return pending.promise
      }
      const launchPreparation = await this.launchContributor?.prepare({
        workspacePath: workspace.fsPath,
        configuredExecutable,
        configuredArguments: configuredArgs,
      })
      if (this.pending !== pending) {
        await launchPreparation?.dispose?.()
        return pending.promise
      }
      this.launchPreparation = launchPreparation

      // A nested deepseek-harness checkout is the documented empty-executable
      // launch; an unrelated stock DSH on 3080 must not silently pre-empt it.
      if (launchPreparation === undefined
        && target?.kind !== 'managed'
        && shouldProbeExistingDsh(reuseExistingRuntime, configuredExecutable, hasCustomArguments)
        && findSourceRoot(this.context.extensionUri.fsPath) === undefined) {
        const existingUrl = new URL(DEFAULT_DSH_SERVER_URL)
        this.publish({ kind: 'starting', detail: 'Looking for an existing DeepSeek Harness runtime…' })
        const connection = new DshConnection(existingUrl)
        const probe = await probeDshServer(connection)
        connection.dispose()
        // `127.0.0.1` is host-wide, not user-wide: on a shared machine every
        // local account can bind this port. A real DSH always demands its
        // launch token, so an endpoint that answers `session/list` without one
        // is not a runtime this sidebar may adopt — adopting it would hand the
        // user's prompts and workspace files to whoever is listening.
        if (probe.kind === 'ready') {
          this.output.appendLine('[runtime] ignoring an unauthenticated service on 127.0.0.1:3080: a DeepSeek Harness runtime must present its launch token. Starting a separate managed runtime.')
        } else if (probe.kind === 'authentication-required') {
          throw new ExistingRuntimeConnectionError()
        } else if (probe.kind === 'unsupported') {
          this.output.appendLine('[runtime] existing endpoint does not support the required DSH Remote protocol; starting a separate managed runtime.')
        }
        if (this.pending !== pending) return pending.promise
      }
      const versionLaunch = resolveLaunch(this.context.extensionUri.fsPath, configuredExecutable, ['--version'], {
        cwd: workspace.fsPath,
      })
      version = await readDshVersion(versionLaunch, workspace.fsPath)
      if (this.pending !== pending) return pending.promise
      assertSupportedDshVersion(version)
      const versionedArgs = webArgsForDshVersion(configuredArgs, version)
      const args = applyRuntimeLaunchPreparation(versionedArgs, version, launchPreparation)
      launch = resolveLaunch(this.context.extensionUri.fsPath, configuredExecutable, args, {
        cwd: workspace.fsPath,
      })
      storedApiKey = await this.context.secrets.get(DEEPSEEK_API_KEY_SECRET)
      if (this.pending !== pending) return pending.promise
    } catch (error) {
      this.failStart(error instanceof Error ? error : new Error(String(error)), pending)
      return pending.promise
    }

    const renderedCommand = [launch.command, ...launch.args].map(part => JSON.stringify(part)).join(' ')
    if (storedApiKey !== undefined && storedApiKey !== '' && !this.outputSecrets.includes(storedApiKey)) this.outputSecrets.push(storedApiKey)
    this.output.appendLine(`[runtime] cwd: ${workspace.fsPath}`)
    if (version !== undefined) this.output.appendLine(`[runtime] DSH version: ${redactDshSecrets(version)}`)
    this.output.appendLine(`[runtime] launch: ${redactDshSecrets(renderedCommand, this.outputSecrets)}`)
    if (storedApiKey !== undefined) this.output.appendLine('[runtime] DeepSeek credential: VS Code SecretStorage')

    // A runtime a previous extension host left behind may still be serving — and
    // may still be running a turn the user started before that host died.
    // Attaching preserves that work and removes the orphan; it never terminates
    // anything. A launch preparation (autonomous debugging) always spawns its own,
    // because its overlay is part of the configuration a fingerprint compares.
    if (this.broker !== undefined && this.launchPreparation !== undefined) {
      this.output.appendLine('[runtime] autonomous debugging starts its own runtime, so any runtime recorded for reuse is left alone')
    }
    if (this.broker !== undefined && this.launchPreparation === undefined) {
      pending.owned = {
        fingerprint: {
          dshHome: resolveDshHome(),
          executable: launch.command,
          arguments: launch.args,
          extensionVersion: extensionVersionOf(this.context),
        },
        cwd: workspace.fsPath,
      }
      // Consulting the ledger is an optimisation: any failure here must fall
      // through to a normal spawn rather than leave the sidebar in 'starting'.
      try {
        const decision = await this.broker.decide(pending.owned.fingerprint)
        if (this.pending !== pending) return pending.promise
        if (decision.action === 'adopt' && decision.descriptor.manageable && !this.adoptOwnRuntimes) {
          this.output.appendLine('[runtime] not attaching to the runtime another window started: reuse across windows is disabled')
        } else if (decision.action === 'ignore') {
          // Why we are not attaching; the leftover runtime itself is reported once,
          // with its pid, at the point we commit to starting a separate one.
          this.output.appendLine(`[runtime] not attaching to the running DSH runtime: ${decision.reason}`)
        } else if (decision.action === 'adopt') {
          const adopted = await this.adopt(decision.descriptor, pending)
          if (adopted !== undefined) return adopted
          if (this.pending !== pending) return pending.promise
        }
      } catch (error) {
        this.output.appendLine(`[runtime] could not check for a runtime another window started: ${describeError(error)}`)
      }
    }

    this.publish({
      kind: 'starting',
      detail: launch.sourceCheckout ? 'Starting the official DSH source profile…' : 'Starting the official DSH profile…',
    })

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(launch.command, launch.args, {
        cwd: workspace.fsPath,
        env: {
          ...process.env,
          NO_COLOR: '1',
          ...(storedApiKey === undefined ? {} : { DEEPSEEK_API_KEY: storedApiKey }),
          ...searchEnv,
          ...launch.env,
          ...this.launchPreparation?.environment,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      })
    } catch (error) {
      this.failStart(error instanceof Error ? error : new Error(String(error)), pending)
      return pending.promise
    }
    this.child = child

    const consume = (line: string): void => {
      if (this.child === child) this.acceptOutputLine(line, pending)
    }
    // The runtime's own output is the one stream that can contain anything it
    // prints, and the launch URL it prints carries its token. Until that URL is
    // parsed the token is unknown, so the parsed secrets are added here and every
    // later line is redacted with them.
    const log = (line: string): void => { this.output.appendLine(redactDshSecrets(line, this.outputSecrets)) }
    const stdout = new RuntimeOutput(log, consume)
    const stderr = new RuntimeOutput(log, consume)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout.consume(chunk) })
    child.stderr.on('data', (chunk: string) => { stderr.consume(chunk) })
    child.once('close', () => { stdout.flush(); stderr.flush() })
    child.on('error', (error) => {
      if (this.child !== child) return
      if (child.pid === undefined) this.child = undefined
      this.failStart(describeLaunchFailure(launch, error), pending)
    })
    child.on('exit', (code, signal) => {
      // A replaced process must not clear the new startup timer or credentials.
      if (this.child !== child) return
      this.clearStartupTimer()
      this.child = undefined
      this.disposeConnections()
      void this.releaseLaunchPreparation()
      const detail = `DSH exited (${signal ?? `code ${String(code)}`}).`
      this.output.appendLine(`[runtime] ${detail}`)
      if (this.stopping) {
        this.publish({ kind: 'stopped' })
        return
      }
      if (this.pending !== undefined) {
        this.failStart(new Error(detail), pending)
      } else {
        this.publish({ kind: 'failed', message: detail })
      }
    })

    this.startupTimer = setTimeout(() => {
      if (this.pending !== pending) return
      this.failStart(new Error(`DSH did not report a web URL within ${String(timeoutMs)} ms.`), pending)
      this.stopAfterFailedStart()
    }, timeoutMs)

    return pending.promise
  }

  private async connectExternal(launchUrl: URL, pending: PendingStart): Promise<void> {
    // The URL has arrived, so the startup timeout's only question is answered.
    // Leaving it armed while authentication and the probe run could fail a start
    // that succeeded, and blame a missing URL that was in fact reported.
    this.clearStartupTimer()
    this.rememberOutputSecrets(launchUrl)
    const connection = new DshConnection(new URL(launchUrl.origin))
    this.authenticating = connection
    this.publish({ kind: 'starting', detail: 'Connecting to the existing DeepSeek Harness runtime…' })
    try {
      await connection.authenticate(launchUrl)
      const probe = await probeDshServer(connection, 10_000)
      if (probe.kind !== 'ready') throw new Error(probe.kind === 'unsupported' ? DSH_UPGRADE_MESSAGE
        : `Could not verify the existing DSH Remote service (${probe.kind}). Check its launch URL and try again.`)
      if (this.pending !== pending) { connection.dispose(); return }
      this.authenticating = undefined
      this._connection = connection
      this.pending = undefined
      const localUri = vscode.Uri.parse(connection.baseUrl.href)
      this.output.appendLine(`[runtime] connected to existing DSH: ${connection.baseUrl.origin}`)
      this.publish({ kind: 'ready', localUri, ownership: 'external' })
      pending.resolve(localUri)
    } catch (error) {
      connection.dispose()
      if (this.authenticating === connection) this.authenticating = undefined
      this.failStart(new ExistingRuntimeConnectionError(error instanceof Error ? error.message
        : 'Could not connect to the existing DSH runtime. Check its launch URL and try again.'), pending)
    }
  }

  /**
   * Remember every form of a launch token this window has seen.
   *
   * The runtime prints its own launch URL, and a later line can echo it; the
   * logger that handles that output is the one place the token must never reach
   * verbatim. Both spellings are kept because a line can quote either.
   */
  private rememberOutputSecrets(launchUrl: URL): void {
    const token = launchUrl.searchParams.get('token')
    for (const secret of [token ?? '', launchUrl.href, launchUrl.search]) {
      if (secret !== '' && !this.outputSecrets.includes(secret)) this.outputSecrets.push(secret)
    }
  }

  /**
   * Attach to a runtime this extension started in an earlier window.
   *
   * Returning undefined means "start a separate one": attaching is an
   * optimisation, never a failure mode. The recorded runtime is left running
   * either way — one that does not answer is reported, not killed, because the
   * extension cannot prove which turn it would be interrupting.
   */
  private async adopt(descriptor: RuntimeDescriptor, pending: PendingStart): Promise<vscode.Uri | undefined> {
    let launchUrl: URL
    try {
      launchUrl = new URL(descriptor.launchUrl)
    } catch {
      this.output.appendLine(`[runtime] ignoring an unreadable recorded runtime (${describeDescriptor(descriptor)})`)
      return undefined
    }
    const connection = new DshConnection(new URL(launchUrl.origin))
    this.authenticating = connection
    this.publish({ kind: 'starting', detail: 'Attaching to the DSH runtime already running for this workspace…' })
    try {
      await connection.authenticate(launchUrl)
      const probe = await probeDshServer(connection, 10_000)
      if (probe.kind !== 'ready') {
        throw new Error(probe.kind === 'unsupported'
          ? DSH_UPGRADE_MESSAGE
          : `the recorded runtime did not answer the DSH Remote contract (${probe.kind})`)
      }
      if (this.pending !== pending) {
        connection.dispose()
        return undefined
      }
      this.authenticating = undefined
      this._connection = connection
      this.pending = undefined
      this.clearStartupTimer()
      const localUri = vscode.Uri.parse(connection.baseUrl.href)
      // Who owns this process decides what may be done to it: an attach-only record
      // is the user's own `dsh web`, which this extension never manages or ends.
      const ownership: RuntimeOwnership = descriptor.manageable ? 'adopted' : 'attached'
      this.output.appendLine(ownership === 'adopted'
        ? `[runtime] attached to a DSH runtime started by another window: ${describeDescriptor(descriptor)}`
        : `[runtime] attached to the DSH runtime you saved: ${describeDescriptor(descriptor)}`)
      this.publish({ kind: 'ready', localUri, ownership })
      pending.resolve(localUri)
      this.recordLease(descriptor.pid)
      return localUri
    } catch (error) {
      connection.dispose()
      if (this.authenticating === connection) this.authenticating = undefined
      if (!descriptor.manageable) {
        // The user's runtime is gone, or something else took its port. Its record
        // is the only thing left, and keeping it would make every window pay for a
        // dead URL, so it is dropped and the user is told once.
        this.broker?.clearDescriptor()
        this.output.appendLine(`[runtime] the DSH runtime you saved is no longer answering (${describeError(error)}); its record was dropped`)
        if (!this.warnedStaleAttached) {
          this.warnedStaleAttached = true
          void vscode.window.showWarningMessage(
            'The DSH runtime you asked this extension to remember is no longer answering, so a separate runtime was started. Connect to a runtime again to save a new one.',
            'Show Output').then(choice => { if (choice === 'Show Output') this.output.show(true) })
        }
        return undefined
      }
      this.output.appendLine(`[runtime] could not attach to the recorded DSH runtime; starting a separate one: ${describeError(error)}`)
      return undefined
    }
  }

  /**
   * Record this window in the broker's lease ledger.
   *
   * A failed lease is bookkeeping, not a runtime failure: the conversation still
   * works, and the next `stop()` simply finds no lease of ours to release.
   */
  private recordLease(runtimePid: number | undefined): void {
    const broker = this.broker
    if (broker === undefined) return
    void broker.takeLease(this.instanceId, runtimePid).catch(error => {
      this.output.appendLine(`[runtime] could not record this window's runtime lease: ${describeError(error)}`)
    })
  }

  /**
   * Publish the runtime this window started so a later window can attach to it
   * instead of starting a second one.
   *
   * The descriptor's launch URL carries an authentication token, so the broker
   * writes it owner-only (0600) and nothing here ever logs it.
   */
  private publishOwnedRuntime(launchUrl: URL, pending: PendingStart): void {
    const broker = this.broker
    const owned = pending.owned
    const pid = this.child?.pid
    if (broker === undefined || owned === undefined || pid === undefined) return
    const previous = broker.readDescriptor()
    if (previous !== undefined && previous.pid !== pid) {
      // The one authoritative report of a leftover runtime: it is alive, it is not
      // ours to end, and it keeps every conversation it has opened until it exits.
      this.output.appendLine(`[runtime] a runtime from an earlier window is still running and was not adopted (${describeDescriptor(previous)}); it keeps the conversations it opened until it exits. 'DSH: Diagnose Session Occupancy' reports which process holds one.`)
    }
    void broker.publishOwnedRuntime({
      instanceId: this.instanceId,
      pid,
      cwd: owned.cwd,
      fingerprint: owned.fingerprint,
      launchUrl: launchUrl.href,
    }).catch(error => {
      this.output.appendLine(`[runtime] could not record this runtime for reuse by another window: ${describeError(error)}`)
    })
  }

  /**
   * The launch URL of the external runtime this window is attached to, when
   * remembering it would change anything.
   *
   * Returns undefined for a runtime this extension started (already recorded) and
   * for one already saved with the same URL, so the caller only ever asks the user
   * once per runtime.
   */
  externalRuntimeUrlToRemember(): string | undefined {
    const state = this._state
    if (state.kind !== 'ready' || state.ownership !== 'external' || this.broker === undefined) return undefined
    const launchUrl = this._connection?.browserUrl()
    // Only a URL carrying its token can authenticate another window.
    if (launchUrl === undefined || !launchUrl.searchParams.has('token')) return undefined
    const saved = this.broker.readDescriptor()
    if (saved !== undefined && !saved.manageable && saved.launchUrl === launchUrl.href) return undefined
    return launchUrl.href
  }

  /**
   * Remember the external runtime so every window — and every later session — can
   * attach to it without the user pasting its URL again.
   *
   * The record is attach-only, so this extension will never install into that
   * runtime, never write settings or credentials to it, and never end it: only its
   * owner can. It stores the launch URL, which authenticates that runtime, in the
   * extension's owner-only global storage.
   */
  async rememberExternalRuntime(cwd: string): Promise<boolean> {
    const broker = this.broker
    const launchUrl = this.externalRuntimeUrlToRemember()
    if (broker === undefined || launchUrl === undefined) return false
    try {
      await broker.publishOwnedRuntime({
        instanceId: this.instanceId,
        manageable: false,
        cwd,
        launchUrl,
      })
      this.output.appendLine(`[runtime] saved this DSH runtime for other windows (attach-only; it is never managed or ended from here)`)
      return true
    } catch (error) {
      this.output.appendLine(`[runtime] could not save this DSH runtime: ${describeError(error)}`)
      return false
    }
  }

  private acceptOutputLine(line: string, pending: PendingStart): void {
    if (this.pending !== pending || this.authenticating !== undefined) return
    const url = parseDshWebUrl(line)
    if (url === undefined) return
    const launchUrl = new URL(url)
    if (!launchUrl.searchParams.has('token')) {
      this.failStart(new Error(DSH_UPGRADE_MESSAGE), pending)
      this.stopAfterFailedStart()
      return
    }
    this.rememberOutputSecrets(launchUrl)
    const connection = new DshConnection(new URL(launchUrl.origin))
    this.authenticating = connection
    this.publish({ kind: 'starting', detail: 'Authenticating with DeepSeek Harness…' })
    void (async () => {
      await connection.authenticate(launchUrl)
      const probe = await probeDshServer(connection, 10_000)
      if (probe.kind !== 'ready') {
        throw new Error(probe.kind === 'unsupported' ? DSH_UPGRADE_MESSAGE
          : `Could not verify the authenticated DSH Remote service (${probe.kind}). Reconnect the runtime.`)
      }
      if (this.pending !== pending) {
        connection.dispose()
        return
      }
      this.authenticating = undefined
      this._connection = connection
      const localUri = vscode.Uri.parse(connection.baseUrl.href)
      this.pending = undefined
      this.clearStartupTimer()
      this.recordLease(this.child?.pid)
      this.publishOwnedRuntime(launchUrl, pending)
      this.publish({ kind: 'ready', localUri, ownership: 'managed' })
      pending.resolve(localUri)
    })().catch(error => {
      connection.dispose()
      if (this.pending !== pending) return
      this.failStart(error instanceof Error ? error : new Error('DSH authentication failed.'), pending)
      this.stopAfterFailedStart()
    })
  }

  private disposeConnections(): void {
    this.authenticating?.dispose()
    this.authenticating = undefined
    this._connection?.dispose()
    this._connection = undefined
  }

  private stopAfterFailedStart(): void {
    void this.stop(true).catch(error => {
      this.output.appendLine(`[runtime] startup cleanup failed: ${describeError(error)}`)
    })
  }

  private failStart(error: Error, pending: PendingStart): void {
    if (this.pending !== pending) return
    // Errors cross into controller state, notices and callers as well as logs.
    // Keep their original error type while removing credentials we already know.
    error.message = redactDshSecrets(error.message, this.outputSecrets)
    if (error.stack !== undefined) error.stack = redactDshSecrets(error.stack, this.outputSecrets)
    this.pending = undefined
    this.clearStartupTimer()
    this.publish({ kind: 'failed', message: error.message,
      ...(error instanceof ExistingRuntimeConnectionError ? { reason: 'runtime-auth' as const } : {}) })
    void this.releaseLaunchPreparation()
    pending.reject(error)
  }

  private async releaseLaunchPreparation(): Promise<void> {
    if (this.launchPreparationRelease !== undefined) {
      await this.launchPreparationRelease
      return
    }
    const preparation = this.launchPreparation
    this.launchPreparation = undefined
    if (preparation === undefined) return

    const release = (async () => {
      try {
        await preparation.dispose?.()
      } catch (error) {
        this.output.appendLine(`[runtime] launch contribution cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
    this.launchPreparationRelease = release
    try {
      await release
    } finally {
      if (this.launchPreparationRelease === release) this.launchPreparationRelease = undefined
    }
  }

  private async waitForLaunchCleanup(): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        this.releaseLaunchPreparation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('DSH launch cleanup did not finish within 5 seconds. Restart was cancelled; retry after cleanup finishes.')), 5_000)
        }),
      ])
    } catch (error) {
      this.publish({ kind: 'failed', message: describeError(error) })
      throw error
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private clearStartupTimer(): void {
    if (this.startupTimer === undefined) return
    clearTimeout(this.startupTimer)
    this.startupTimer = undefined
  }

  async restart(): Promise<vscode.Uri> {
    await this.stop()
    return this.start()
  }

  stop(preserveFailure = false): Promise<void> {
    this.stopRevision++
    this.startTask = undefined
    if (this.stopTask !== undefined) return this.stopTask
    const task = this.stopRuntime(preserveFailure)
    this.stopTask = task
    const clear = (): void => { if (this.stopTask === task) this.stopTask = undefined }
    void task.then(clear, clear)
    return task
  }

  private async stopRuntime(preserveFailure = false): Promise<void> {
    const state: RuntimeState = preserveFailure && this._state.kind === 'failed' ? this._state : { kind: 'stopped' }
    this.stopping = true
    this.released = 0
    this.clearStartupTimer()
    this.disposeConnections()
    const child = this.child
    this.child = undefined
    const pending = this.pending
    this.pending = undefined
    pending?.reject(new Error('DSH runtime stopped.'))
    try {
      if (child === undefined || child.exitCode != null || child.signalCode != null) {
        await this.waitForLaunchCleanup()
        await this.releaseBroker(child?.pid)
        this.publish(state)
        return
      }
      // The spawning window can also have borrowers. Its process handle does
      // not grant permission to interrupt work in those other windows.
      const borrowed = this.broker !== undefined && (await this.broker.liveLeases()).some(lease =>
        lease.instanceId !== this.instanceId && (lease.runtimePid === undefined || lease.runtimePid === child.pid))
      if (borrowed) {
        await this.releaseBroker(undefined)
        await this.waitForLaunchCleanup()
        this.publish(state)
        return
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        let forceTimer: NodeJS.Timeout | undefined
        const finish = (error?: Error): void => {
          if (settled) return
          settled = true
          if (forceTimer !== undefined) clearTimeout(forceTimer)
          child.removeListener('exit', onExit)
          if (error === undefined) resolve()
          else reject(error)
        }
        const onExit = (): void => finish()
        const signal = (kind: NodeJS.Signals): void => {
          try {
            if (!terminateProcessTree(child, kind)) {
              finish(child.exitCode != null || child.signalCode != null ? undefined
                : new Error(`DSH process ${String(child.pid)} refused ${kind}; it is still managed and no replacement was started.`))
            }
          } catch (error) {
            finish(new Error(`Could not stop DSH process ${String(child.pid)}: ${describeError(error)}. No replacement was started.`))
          }
        }
        child.once('exit', onExit)
        forceTimer = setTimeout(() => {
          signal('SIGKILL')
          if (!settled) forceTimer = setTimeout(() => finish(new Error(`DSH process ${String(child.pid)} did not exit after SIGKILL. No replacement was started.`)), 1_000)
        }, 4_000)
        signal('SIGTERM')
      })
      await this.waitForLaunchCleanup()
      await this.releaseBroker(child.pid)
      this.publish(state)
    } catch (error) {
      // Retain a live process so another restart cannot silently orphan it.
      if (child !== undefined && child.exitCode == null && child.signalCode == null) this.child = child
      this.stopping = false
      this.output.appendLine(`[runtime] shutdown failed: ${describeError(error)}`)
      this.publish({ kind: 'failed', message: describeError(error) })
      throw error
    }
  }

  /**
   * Give up this window's lease, and stop the runtime when it was the last one.
   *
   * Stopping is what actually releases conversations: DSH exposes no way to
   * release a single session, so the only thing that returns a lock is its owner
   * exiting. A runtime another window still uses — or one marked attach-only — is
   * left running, and nothing here touches a runtime this extension did not start.
   */
  private async releaseBroker(ownedPid: number | undefined): Promise<void> {
    const broker = this.broker
    if (broker === undefined) return
    try {
      const outcome = await broker.release(this.instanceId)
      for (const note of outcome.notes) this.output.appendLine(`[runtime] ${note}`)
      const stop = outcome.stop
      if (stop === undefined) return
      if (stop.pid === ownedPid) {
        // This window held the process handle and has already ended it; the record
        // is all that is left. No proof or signal is needed, and the common path
        // costs nothing.
        broker.clearDescriptor()
        return
      }
      const identified = outcome.stopIdentity === 'proved'
        || await this.confirmRuntimeIdentity(stop)
      if (!identified) {
        // A pid whose process cannot be tied to the record is never signalled:
        // it may be whatever reused the pid. The runtime is reported instead.
        broker.clearDescriptor()
        this.output.appendLine(`[runtime] the runtime recorded as ${describeDescriptor(stop)} did not answer with its own launch token, so no signal was sent and its record was dropped. 'DSH: Diagnose Session Occupancy' reports what holds a conversation now.`)
        return
      }
      const stopPid = stop.pid
      if (stopPid === undefined) return
      const held = await this.heldConversations(stopPid)
      this.output.appendLine(`[runtime] stopping the runtime this extension started (${describeDescriptor(stop)})`)
      if (!await broker.stop(stop, { confirmed: true })) {
        throw new Error(`DSH process ${String(stopPid)} is still running; its record was retained. No replacement was started.`)
      }
      this.released = held
      this.output.appendLine('[runtime] the conversations it held are released')
      if (held > 0) this.output.appendLine(`[runtime] released ${String(held)} conversation(s)`)
    } catch (error) {
      this.output.appendLine(`[runtime] could not release this window's runtime lease: ${describeError(error)}`)
      throw error
    }
  }

  /**
   * How many conversations a runtime currently holds, for the shutdown report.
   *
   * Read-only, single `lsof` over the DSH home; a failure to measure only costs
   * the number in the message, never the release itself.
   */
  private async heldConversations(pid: number): Promise<number> {
    try {
      return (await countSessionsHeldBy(resolveDshHome(), pid)).count
    } catch (error) {
      this.output.appendLine(`[runtime] could not count the conversations this runtime holds: ${describeError(error)}`)
      return 0
    }
  }

  /**
   * Prove that a recorded runtime is still the process it was recorded as.
   *
   * The handshake and the reasoning behind it live in `runtime-identity.ts`; it is
   * shared with the manual "end a leftover runtime" command.
   */
  private async confirmRuntimeIdentity(descriptor: RuntimeDescriptor): Promise<boolean> {
    return await proveRuntimeIdentity(descriptor.launchUrl)
  }

  dispose(): void {
    this.changes.dispose()
    void this.stop().catch(error => {
      this.output.appendLine(`[runtime] disposal failed: ${describeError(error)}`)
    })
  }
}
