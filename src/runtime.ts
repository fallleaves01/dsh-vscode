import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
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
import type { RuntimeTransition } from './runtime-lock.js'
import { spawnHostedRuntime, type RuntimeHostOptions, type RuntimeProcess } from './runtime-process.js'
import { inspectRuntimeRestart, stopRuntimeForRestart, validateRuntimeRestart, type RuntimeRestartPlan } from './runtime-restart.js'
import { RUNTIME_HOST_PROTOCOL } from './runtime-lifetime.js'

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
  | { kind: 'ready'; localUri: vscode.Uri; ownership: RuntimeOwnership; pid?: number }
  | { kind: 'failed'; message: string; reason?: 'runtime-auth' }

interface PendingStart {
  readonly abort: AbortController
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
  return { resolve, reject, promise, abort: new AbortController() }
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
 * The UI version is diagnostic metadata; launch compatibility is independent.
 */
function extensionVersionOf(context: vscode.ExtensionContext): string {
  const manifest = (context.extension as { packageJSON?: { version?: unknown } } | undefined)?.packageJSON
  return typeof manifest?.version === 'string' && manifest.version !== '' ? manifest.version : 'unknown'
}

/** One line of operator-facing detail; never surfaces a launch token. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Version output cached per executable identity, so a restart of the same
 * CLI does not pay for the `dsh --version` process again. */
const versionCache = new Map<string, string>()

/** Test seam: the cache is process-wide and the CLI identity is fixed in tests. */
export function clearDshVersionCacheForTests(): void {
  versionCache.clear()
}

function versionCacheKey(launch: LaunchCommand): string | undefined {
  try {
    const commandMtime = statSync(launch.command).mtimeMs
    // A wrapper can stay byte-identical while the entry it forwards to is
    // upgraded in place, so the mtime of every absolute file argument joins the
    // identity. An unstatable argument cannot prove freshness; it is ignored.
    const args = launch.args.map(arg => {
      if (!isAbsolute(arg)) return arg
      try { return `${arg}@${statSync(arg).mtimeMs}` } catch { return arg }
    })
    return `${launch.command}\u0000${args.join('\u0000')}\u0000${commandMtime}`
  } catch {
    // A shell fallback or a source-checkout launcher has no stable file to stat.
    return undefined
  }
}

/** Cache a version only after it was proven acceptable by the caller. */
function rememberDshVersion(launch: LaunchCommand, version: string | undefined): void {
  const key = versionCacheKey(launch)
  if (key !== undefined && version !== undefined) versionCache.set(key, version)
}

/** A failed start must not keep serving the version that failed. */
function forgetDshVersion(launch: LaunchCommand): void {
  const key = versionCacheKey(launch)
  if (key !== undefined) versionCache.delete(key)
}

function readDshVersion(launch: LaunchCommand, cwd: string): Promise<string | undefined> {
  const cacheKey = versionCacheKey(launch)
  if (cacheKey !== undefined) {
    const cached = versionCache.get(cacheKey)
    if (cached !== undefined) return Promise.resolve(cached)
  }
  return new Promise(resolve => {
    let settled = false
    let output = ''
    let timer: NodeJS.Timeout | undefined
    const finish = (version?: string): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      // Caching belongs to the caller's supported-version check, not to the read.
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
  private child: RuntimeProcess | undefined
  private transition: RuntimeTransition | undefined
  private brokerUse = false
  /** Also retained after a failed adoption: Restart must reach that recorded process. */
  private sharedStartAttempted = false
  private launchingChild: Promise<RuntimeProcess> | undefined
  private readonly brokerWrites = new Set<Promise<unknown>>()
  private pending: PendingStart | undefined
  private startupTimer: NodeJS.Timeout | undefined
  private hostMonitor: NodeJS.Timeout | undefined
  private _connection: DshConnection | undefined
  private authenticating: DshConnection | undefined
  private startTask: Promise<vscode.Uri> | undefined
  private stopTask: Promise<void> | undefined
  private stopRevision = 0
  private stopping = false
  private launchPreparation: RuntimeLaunchPreparation | undefined
  /** The CLI version read for this start, when it looked like a real version. */
  private knownVersion: string | undefined
  private launchPreparationRelease: Promise<void> | undefined
  private _state: RuntimeState = { kind: 'stopped' }
  /** This extension host's identity in the broker's lease ledger. */
  private readonly instanceId = randomUUID()
  /** Conversations released by the most recent stop, for the restart report. */
  private released = 0
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
    private readonly host?: RuntimeHostOptions,
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
    if (state.kind === 'starting' && (this._state.kind !== 'starting' || this._state.detail !== state.detail)) {
      this.output.appendLine(`[runtime] ${redactDshSecrets(state.detail, this.outputSecrets)}`)
    }
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
    this.brokerUse = false
    this.sharedStartAttempted = false
    const inheritedApiKey = process.env.DEEPSEEK_API_KEY
    if (inheritedApiKey !== undefined && inheritedApiKey !== '' && !this.outputSecrets.includes(inheritedApiKey)) this.outputSecrets.push(inheritedApiKey)

    let launch: LaunchCommand
    let version: string | undefined
    let storedApiKey: string | undefined
    try {
      if (target?.kind === 'external') {
        // Workspace/folder values are repository-controlled; only the user's
        // global setting may enable this dangerous capability.
        if (config.inspect<boolean>('autonomousDebugging')?.globalValue === true) {
          throw new Error('Autonomous debugging requires a managed runtime. Disable it before connecting to an existing DSH runtime.')
        }
        const launchUrl = existingRuntimeUrl(target.launchUrl.href)
        void this.connectExternal(launchUrl, pending)
        return pending.promise
      }
      if (this.broker !== undefined) {
        this.sharedStartAttempted = this.adoptOwnRuntimes
        this.publish({ kind: 'starting', detail: `Waiting for another window's DSH operation (up to ${Math.ceil(timeoutMs / 1_000)} s)…` })
        const transition = await this.broker.acquireTransition({ signal: pending.abort.signal, timeoutMs })
        if (this.pending !== pending) { transition.release(); return pending.promise }
        this.transition = transition
        this.publish({ kind: 'starting', detail: 'Checking the saved DSH runtime and its supervisor…' })
        const recoverAbandoned = this.host !== undefined && this.adoptOwnRuntimes
        if (recoverAbandoned && await this.broker.recoverAbandonedRuntime(pending.abort.signal)) {
          this.output.appendLine('[runtime] cleaned up DSH left by an exited runtime host; starting a supervised replacement before opening a conversation')
        }
        this.publish({ kind: 'starting', detail: 'Checking for an unfinished DSH startup…' })
        await this.broker.waitForStartup(pending.abort.signal, timeoutMs, recoverAbandoned)
        if (this.pending !== pending) return pending.promise
      }
      this.publish({ kind: 'starting', detail: 'Preparing DSH runtime settings…' })
      const launchPreparation = await this.launchContributor?.prepare({
        workspacePath: workspace.fsPath,
        configuredExecutable,
        configuredArguments: configuredArgs,
        ...(this.broker === undefined ? {} : { sharedRuntimeDirectory: this.broker.sharedDirectory }),
      })
      if (this.pending !== pending) {
        await launchPreparation?.dispose?.()
        return pending.promise
      }
      this.launchPreparation = launchPreparation
      if (this.broker !== undefined && this.adoptOwnRuntimes && launchPreparation !== undefined && launchPreparation.sharing !== 'compatible') {
        throw new Error('This launch uses a window-bound runtime bridge, which cannot be shared safely. Disable autonomous debugging to share DSH, or disable deepseekHarness.reuseAcrossWindows for an intentionally separate runtime.')
      }
      // The version probe and the credential read are independent of each
      // other, and of the conventional-port probe when that probe runs. Start
      // them before whichever work comes first and await in the original order.
      // The swallowed rejections only prevent an unhandled rejection if the
      // start is cancelled before the await.
      const versionLaunch = resolveLaunch(this.context.extensionUri.fsPath, configuredExecutable, ['--version'], {
        cwd: workspace.fsPath,
      })
      const checksConventionalPort = this.broker === undefined && launchPreparation === undefined && target?.kind !== 'managed'
        && shouldProbeExistingDsh(reuseExistingRuntime, configuredExecutable, hasCustomArguments)
        && findSourceRoot(this.context.extensionUri.fsPath) === undefined
      // A failed existing-runtime handshake must not pay for an extra process;
      // with no port probe to hide behind, the version read starts immediately.
      const versionRead = checksConventionalPort
        ? undefined
        : readDshVersion(versionLaunch, workspace.fsPath)
      versionRead?.catch(() => undefined)
      const secretRead = this.context.secrets.get(DEEPSEEK_API_KEY_SECRET)
      Promise.resolve(secretRead).catch(() => undefined)
      if (checksConventionalPort) {
        await this.checkConventionalEndpoint()
        if (this.pending !== pending) return pending.promise
      }
      const resolvedVersion = versionRead ?? readDshVersion(versionLaunch, workspace.fsPath)
      resolvedVersion.catch(() => undefined)
      this.publish({ kind: 'starting', detail: 'Checking the installed DSH version…' })
      version = await resolvedVersion
      if (this.pending !== pending) return pending.promise
      try {
        assertSupportedDshVersion(version)
      } catch (error) {
        forgetDshVersion(versionLaunch)
        throw error
      }
      rememberDshVersion(versionLaunch, version)
      // 'source' and other free-form version lines are not a contract proof.
      this.knownVersion = /(?:^|\s|v)\d+\.\d+\.\d+/.test(version ?? '') ? version : undefined
      const versionedArgs = webArgsForDshVersion(configuredArgs, version)
      const args = applyRuntimeLaunchPreparation(versionedArgs, version, launchPreparation)
      launch = resolveLaunch(this.context.extensionUri.fsPath, configuredExecutable, args, {
        cwd: workspace.fsPath,
      })
      this.publish({ kind: 'starting', detail: 'Loading DSH credentials…' })
      storedApiKey = await secretRead
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

    if (this.broker !== undefined) {
      try {
        const environmentDigest = this.broker.environmentDigest({
          ...searchEnv, ...launch.env, ...this.launchPreparation?.environment,
          ...((storedApiKey ?? inheritedApiKey) === undefined ? {} : { DEEPSEEK_API_KEY: storedApiKey ?? inheritedApiKey }),
        })
        const owned = {
          fingerprint: {
            dshHome: resolveDshHome(),
            executable: launch.command,
            arguments: launch.args,
            extensionVersion: extensionVersionOf(this.context),
            ...(this.host === undefined ? {} : { hostProtocol: RUNTIME_HOST_PROTOCOL }),
            ...(version === undefined ? {} : { runtimeVersion: version }),
            ...(environmentDigest === undefined ? {} : { environmentDigest }),
          },
          cwd: workspace.fsPath,
        }
        if (this.host !== undefined && this.adoptOwnRuntimes) await this.broker.currentServer()
        const decision = await this.broker.decide(owned.fingerprint)
        if (this.pending !== pending) return pending.promise
        if (decision.action === 'adopt' && decision.descriptor.manageable && !this.adoptOwnRuntimes) {
          this.output.appendLine('[runtime] not attaching to the runtime another window started: reuse across windows is disabled')
        } else if (decision.action === 'ignore') {
          if (this.adoptOwnRuntimes) throw new Error(`The shared DSH runtime is already running with incompatible settings (${decision.reason}). Use Restart Runtime to replace it with this window's settings, or align the settings in both windows. Restarting interrupts tasks in every window using that runtime. No additional runtime was started.`)
        } else if (decision.action === 'adopt') {
          const adopted = await this.adopt(decision.descriptor, pending)
          if (adopted !== undefined) return adopted
          if (this.pending !== pending) return pending.promise
        }
        if (this.adoptOwnRuntimes) { pending.owned = owned; this.brokerUse = true }
        else this.releaseTransition()
      } catch (error) {
        this.failStart(error instanceof Error ? error : new Error(String(error)), pending)
        return pending.promise
      }
    }

    // Saved, authenticated instances take precedence over an unrelated service
    // on the conventional port. Never adopt an unauthenticated loopback service.
    if (this.broker !== undefined && this.launchPreparation === undefined && target?.kind !== 'managed'
      && shouldProbeExistingDsh(reuseExistingRuntime, configuredExecutable, hasCustomArguments)
      && findSourceRoot(this.context.extensionUri.fsPath) === undefined) {
      try {
        await this.checkConventionalEndpoint()
        if (this.pending !== pending) return pending.promise
      } catch (error) {
        this.failStart(error instanceof Error ? error : new Error(String(error)), pending)
        return pending.promise
      }
    }

    this.publish({
      kind: 'starting',
      detail: launch.sourceCheckout ? 'Starting the official DSH source profile…' : 'Starting the official DSH profile…',
    })

    let child: RuntimeProcess
    try {
      const options = {
        cwd: workspace.fsPath,
        env: {
          ...process.env,
          NO_COLOR: '1',
          ...(storedApiKey === undefined ? {} : { DEEPSEEK_API_KEY: storedApiKey }),
          ...searchEnv,
          ...launch.env,
          ...this.launchPreparation?.environment,
        },
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      }
      if (this.host !== undefined && this.broker !== undefined && pending.owned !== undefined) {
        const launching = spawnHostedRuntime({ launch, options, host: this.host, broker: this.broker,
          instanceId: this.instanceId, fingerprint: pending.owned.fingerprint, timeoutMs, signal: pending.abort.signal })
        this.launchingChild = launching
        try { child = await launching } finally { if (this.launchingChild === launching) this.launchingChild = undefined }
      } else child = spawn(launch.command, launch.args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
      if (this.pending !== pending) return pending.promise
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
      const failure = describeLaunchFailure(launch, error)
      if (this.pending === pending) this.failStart(failure, pending)
      else this.publish({ kind: 'failed', message: redactDshSecrets(failure.message, this.outputSecrets) })
      this.stopAfterFailedStart()
    })
    child.on('exit', (code, signal) => {
      // A replaced process must not clear the new startup timer or credentials.
      if (this.child !== child) return
      this.clearStartupTimer()
      this.child = undefined
      if (this.pending === undefined) this.releaseTransition()
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

  private async checkConventionalEndpoint(): Promise<void> {
    const connection = new DshConnection(new URL(DEFAULT_DSH_SERVER_URL))
    let probe: Awaited<ReturnType<typeof probeDshServer>>
    try { probe = await probeDshServer(connection) } finally { connection.dispose() }
    if (probe.kind === 'authentication-required') throw new ExistingRuntimeConnectionError()
    if (probe.kind === 'ready') this.output.appendLine('[runtime] ignoring an unauthenticated service on 127.0.0.1:3080; starting a managed runtime with its own launch token')
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
   * A failed handshake never justifies a competing writer. Only a process that
   * is proved dead can be replaced automatically.
   */
  private async adopt(descriptor: RuntimeDescriptor, pending: PendingStart): Promise<vscode.Uri | undefined> {
    let launchUrl: URL
    try {
      launchUrl = new URL(descriptor.launchUrl)
    } catch {
      throw new Error('The saved DSH runtime URL is invalid. No additional runtime was started. Use Forget the Saved Runtime only after checking the existing process.')
    }
    this.rememberOutputSecrets(launchUrl)
    const connection = new DshConnection(new URL(launchUrl.origin))
    this.authenticating = connection
    this.publish({ kind: 'starting', detail: descriptor.manageable
      ? `Connecting to the existing shared DSH runtime${descriptor.pid === undefined ? '' : ` (PID ${descriptor.pid})`}…`
      : 'Connecting to the saved external DSH runtime…' })
    try {
      if (this.broker !== undefined) await this.trackBrokerWrite(this.broker.takeLease(this.instanceId, descriptor.pid))
      if (this.pending !== pending) { connection.dispose(); return undefined }
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
      this.brokerUse = true
      this.pending = undefined
      this.clearStartupTimer()
      const localUri = vscode.Uri.parse(connection.baseUrl.href)
      // Who owns this process decides what may be done to it: an attach-only record
      // is the user's own `dsh web`, which this extension never manages or ends.
      const ownership: RuntimeOwnership = descriptor.manageable ? 'adopted' : 'attached'
      this.output.appendLine(ownership === 'adopted'
        ? `[runtime] attached to a DSH runtime started by another window: ${describeDescriptor(descriptor)}`
        : `[runtime] attached to the DSH runtime you saved: ${describeDescriptor(descriptor)}`)
      this.publish({ kind: 'ready', localUri, ownership, ...(descriptor.pid === undefined ? {} : { pid: descriptor.pid }) })
      if (descriptor.manageable) this.watchRuntimeHost(descriptor)
      this.releaseTransition()
      pending.resolve(localUri)
      return localUri
    } catch (error) {
      connection.dispose()
      if (this.authenticating === connection) this.authenticating = undefined
      if (this.pending !== pending) return undefined
      this.broker?.clearLease(this.instanceId)
      if (descriptor.manageable && this.broker !== undefined
        && !await this.broker.isRecordRunning(descriptor.pid, descriptor.processStartTime)) {
        if (this.pending !== pending) return undefined
        this.broker.clearDescriptor()
        this.output.appendLine('[runtime] the recorded DSH process exited during connection; starting its replacement')
        return undefined
      }
      throw new Error(`Could not connect to the shared DSH runtime (${redactDshSecrets(describeError(error), this.outputSecrets)}). Its record was retained; no additional runtime was started. Retry the connection, or inspect the recorded process before ending or forgetting it.`)
    }
  }

  /**
   * Record this window in the broker's lease ledger.
   *
   * A failed lease is bookkeeping, not a runtime failure: the conversation still
   * works, and the next `stop()` simply finds no lease of ours to release.
   */
  private async recordLease(runtimePid: number | undefined): Promise<void> {
    const broker = this.broker
    if (broker === undefined) return
    await this.trackBrokerWrite(broker.takeLease(this.instanceId, runtimePid))
  }

  /**
   * Publish the runtime this window started so a later window can attach to it
   * instead of starting a second one.
   *
   * The descriptor's launch URL carries an authentication token, so the broker
   * writes it owner-only (0600) and nothing here ever logs it.
   */
  private async publishOwnedRuntime(launchUrl: URL, pending: PendingStart): Promise<void> {
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
    await this.trackBrokerWrite(broker.publishOwnedRuntime({
      instanceId: this.instanceId,
      pid,
      cwd: owned.cwd,
      fingerprint: owned.fingerprint,
      launchUrl: launchUrl.href,
      ...(previous?.pid === pid && previous.host !== undefined ? { host: previous.host } : {}),
    }))
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
    const connection = this._connection, revision = this.stopRevision
    let lock: RuntimeTransition | undefined
    try {
      lock = await broker.acquireTransition()
      if (revision !== this.stopRevision || this._connection !== connection) return false
      const previous = broker.readDescriptor()
      if (previous !== undefined && previous.launchUrl !== launchUrl
        && await broker.isRecordRunning(previous.pid, previous.processStartTime)) {
        throw new Error('Another live DSH runtime is already saved. Its record was retained.')
      }
      await broker.publishOwnedRuntime({
        instanceId: this.instanceId,
        manageable: false,
        cwd,
        launchUrl,
      })
      if (revision !== this.stopRevision || this._connection !== connection) return false
      await broker.takeLease(this.instanceId)
      if (revision !== this.stopRevision || this._connection !== connection) { broker.clearLease(this.instanceId); return false }
      this.brokerUse = true
      this.output.appendLine(`[runtime] saved this DSH runtime for other windows (attach-only; it is never managed or ended from here)`)
      return true
    } catch (error) {
      this.output.appendLine(`[runtime] could not save this DSH runtime: ${describeError(error)}`)
      return false
    } finally { lock?.release() }
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
      if (this.knownVersion === undefined) {
        const probe = await probeDshServer(connection, 10_000)
        if (probe.kind !== 'ready') {
          throw new Error(probe.kind === 'unsupported' ? DSH_UPGRADE_MESSAGE
            : `Could not verify the authenticated DSH Remote service (${probe.kind}). Reconnect the runtime.`)
        }
      } else {
        // A runtime this window started from a version that passed the contract
        // minimum is verified by the first stream read, which repeats the same
        // call the probe would make. This removes a duplicate session/list on
        // the startup path; an unknown/source version keeps the probe.
        this.output.appendLine('[runtime] DSH version known; contract verified on the first stream read')
      }
      if (this.pending !== pending) {
        connection.dispose()
        return
      }
      const localUri = vscode.Uri.parse(connection.baseUrl.href)
      if (pending.owned !== undefined) {
        await this.publishOwnedRuntime(launchUrl, pending)
        if (this.pending !== pending) { connection.dispose(); return }
        await this.recordLease(this.child?.pid)
        if (this.pending !== pending) { connection.dispose(); return }
      }
      this.authenticating = undefined
      this._connection = connection
      this.pending = undefined
      this.clearStartupTimer()
      this.publish({ kind: 'ready', localUri, ownership: 'managed', ...(this.child?.pid === undefined ? {} : { pid: this.child.pid }) })
      if (pending.owned !== undefined) this.watchRuntimeHost(this.broker?.readDescriptor())
      this.releaseTransition()
      pending.resolve(localUri)
    })().catch(error => {
      connection.dispose()
      if (this.pending !== pending) return
      this.failStart(error instanceof Error ? error : new Error('DSH authentication failed.'), pending)
      this.stopAfterFailedStart()
    })
  }

  private disposeConnections(): void {
    clearInterval(this.hostMonitor)
    this.hostMonitor = undefined
    this.authenticating?.dispose()
    this.authenticating = undefined
    this._connection?.dispose()
    this._connection = undefined
  }

  /** Every attached window can clean up if the independent host is killed. */
  private watchRuntimeHost(descriptor: RuntimeDescriptor | undefined): void {
    clearInterval(this.hostMonitor)
    const broker = this.broker, host = descriptor?.host
    if (broker === undefined || descriptor === undefined || !descriptor.manageable || host === undefined) return
    let checking = false
    const connection = this._connection
    this.hostMonitor = setInterval(() => {
      if (checking || connection !== this._connection) return
      checking = true
      void (async () => {
        if (await broker.isRecordRunning(host.pid, host.startTime)) return
        const lock = await broker.acquireTransition({ timeoutMs: 1_000 })
        try {
          if (connection !== this._connection) return
          const current = broker.readDescriptor()
          if (current?.instanceId !== descriptor.instanceId || current.pid !== descriptor.pid
            || current.host?.pid !== host.pid || current.host.startTime !== host.startTime) {
            // Another attached window may already have completed cleanup.
            if (!await broker.isRecordRunning(descriptor.pid, descriptor.processStartTime)
              && connection === this._connection) {
              this.disposeConnections()
              this.publish({ kind: 'failed', message: 'The shared DSH runtime exited. Use Restart Runtime to continue from saved history.' })
            }
            return
          }
          if (await broker.isRecordRunning(host.pid, host.startTime)) return
          const stopped = await broker.stop(current, { processGroup: current.fingerprint?.hostProtocol === RUNTIME_HOST_PROTOCOL })
          if (connection !== this._connection) return
          this.disposeConnections()
          this.publish({ kind: 'failed', message: stopped
            ? 'The shared DSH runtime host exited unexpectedly. Its DSH process was stopped. Use Restart Runtime to continue from saved history.'
            : 'The shared DSH runtime host exited unexpectedly. DSH cleanup could not be confirmed; its record was retained. Use Restart Runtime to inspect and recover.' })
        } finally { lock.release() }
      })().catch(() => { /* Retry an uncertain identity or busy transition. */ }).finally(() => { checking = false })
    }, this.host?.leasePollMs ?? 5_000)
    this.hostMonitor.unref()
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
    pending.abort.abort()
    this.clearStartupTimer()
    this.publish({ kind: 'failed', message: error.message,
      ...(error instanceof ExistingRuntimeConnectionError ? { reason: 'runtime-auth' as const } : {}) })
    void this.releaseLaunchPreparation()
    pending.reject(error)
    if (this.child === undefined) this.releaseTransition()
  }

  private releaseTransition(): void {
    const transition = this.transition
    this.transition = undefined
    transition?.release()
  }

  private async trackBrokerWrite<T>(write: Promise<T>): Promise<T> {
    this.brokerWrites.add(write)
    try { return await write } finally { this.brokerWrites.delete(write) }
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
    const plan = await this.prepareRestart()
    if ((plan?.otherWindows.length ?? 0) > 0) throw new Error('The DSH runtime is in use by another VS Code window. Use Restart Runtime in the sidebar to confirm a shared restart, or Reconnect to preserve running work.')
    await this.stop(false, true, plan)
    return this.start()
  }

  async prepareRestart(): Promise<RuntimeRestartPlan | undefined> {
    if (this.broker === undefined || !this.adoptOwnRuntimes || !this.sharedStartAttempted || this.pending !== undefined) return undefined
    const lock = await this.broker.acquireTransition()
    try { return await inspectRuntimeRestart(this.broker, this.instanceId) } finally { lock.release() }
  }

  async assertCanRestart(plan?: RuntimeRestartPlan): Promise<void> {
    if (this.broker !== undefined && (this.brokerUse || plan !== undefined)) {
      if (this.transition !== undefined) {
        if (plan === undefined) await this.assertExclusiveRuntime()
        else await validateRuntimeRestart(this.broker, plan, this.instanceId)
        return
      }
      const lock = await this.broker.acquireTransition()
      try {
        if (plan === undefined) await this.assertExclusiveRuntime()
        else await validateRuntimeRestart(this.broker, plan, this.instanceId)
      } finally { lock.release() }
    }
  }

  private async assertExclusiveRuntime(): Promise<void> {
    if (this.broker === undefined) return
    const descriptor = this.broker.readDescriptor()
    const pid = descriptor?.pid
    if (descriptor !== undefined && pid !== undefined
      && !await this.broker.isRecordRunning(pid, descriptor.processStartTime)) return
    const others = (await this.broker.liveLeases()).filter(lease => lease.instanceId !== this.instanceId
      && (lease.runtimePid === undefined || lease.runtimePid === pid))
    if (others.length > 0) throw new Error('The DSH runtime is in use by another VS Code window. Restart was cancelled to preserve its work. Use Reconnect for this window, or close the other windows before restarting.')
  }

  stop(preserveFailure = false, forRestart = false, plan?: RuntimeRestartPlan): Promise<void> {
    this.pending?.abort.abort()
    this.stopRevision++
    this.startTask = undefined
    if (this.stopTask !== undefined) return this.stopTask
    const task = this.stopRuntime(preserveFailure, forRestart, plan)
    this.stopTask = task
    const clear = (): void => { if (this.stopTask === task) this.stopTask = undefined }
    void task.then(clear, clear)
    return task
  }

  private async stopRuntime(preserveFailure = false, forRestart = false, plan?: RuntimeRestartPlan): Promise<void> {
    if (forRestart && this.broker !== undefined && (this.brokerUse || plan !== undefined)) {
      if (this.transition === undefined) this.transition = await this.broker.acquireTransition()
      try {
        if (plan === undefined) await this.assertExclusiveRuntime()
        else await validateRuntimeRestart(this.broker, plan, this.instanceId)
      } catch (error) { this.releaseTransition(); throw error }
    }
    const state: RuntimeState = preserveFailure && this._state.kind === 'failed' ? this._state : { kind: 'stopped' }
    this.stopping = true
    this.released = 0
    this.clearStartupTimer()
    this.disposeConnections()
    let stoppingChild = this.child
    this.child = undefined
    const pending = this.pending
    this.pending = undefined
    pending?.reject(new Error('DSH runtime stopped.'))
    try {
      if (this.launchingChild !== undefined) {
        try { stoppingChild = await this.launchingChild } catch { /* Startup reservation guards any unfinished helper cleanup. */ }
      }
      await Promise.allSettled([...this.brokerWrites])
      // Provisional adoption leases have not reached ready yet, but their write
      // must finish and be removed before a newer start can reuse this window id.
      if (!this.brokerUse && this.transition !== undefined) this.broker?.clearLease(this.instanceId)
      if (this.transition === undefined && this.broker !== undefined && this.brokerUse) {
        this.transition = await this.broker.acquireTransition()
      }
      if (forRestart && plan !== undefined && this.broker !== undefined) {
        // This also handles a failed window that never acquired a lease or child.
        this.output.appendLine('[runtime] restarting the recorded shared DSH runtime with this window\'s settings')
        await stopRuntimeForRestart(this.broker, plan, this.instanceId)
        this.broker.clearLease(this.instanceId)
        this.brokerUse = false
        stoppingChild?.detach?.()
        await this.waitForLaunchCleanup()
        this.publish(state)
        return
      }
      const child = stoppingChild
      if (child === undefined || child.exitCode != null || child.signalCode != null) {
        await this.waitForLaunchCleanup()
        await this.releaseBroker(child?.pid)
        this.publish(state)
        return
      }
      // The spawning window can also have borrowers. Its process handle does
      // not grant permission to interrupt work in those other windows.
      const borrowed = this.brokerUse && this.broker !== undefined && (await this.broker.liveLeases()).some(lease =>
        lease.instanceId !== this.instanceId && (lease.runtimePid === undefined || lease.runtimePid === child.pid))
      if (borrowed) {
        await this.releaseBroker(undefined)
        child.detach?.()
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
      if (stoppingChild !== undefined && stoppingChild.exitCode == null && stoppingChild.signalCode == null) this.child = stoppingChild
      this.stopping = false
      this.output.appendLine(`[runtime] shutdown failed: ${describeError(error)}`)
      this.publish({ kind: 'failed', message: describeError(error) })
      throw error
    } finally { this.releaseTransition() }
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
    if (broker === undefined || !this.brokerUse) return
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
        this.output.appendLine(`[runtime] the runtime recorded as ${describeDescriptor(stop)} did not answer with its own launch token, so no signal was sent and its record was retained. 'DSH: Diagnose Session Occupancy' reports what holds a conversation now.`)
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
