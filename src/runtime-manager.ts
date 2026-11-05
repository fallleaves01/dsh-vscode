import * as vscode from 'vscode'
import type { RuntimeOwnership, RuntimeState } from './runtime.js'
import { redactDshSecrets } from './runtime-output.js'
import { existingRuntimeUrl } from './runtime-target.js'

/** The lifecycle phase the current window reports for its runtime. */
export type RuntimeManagerPhase = 'stopped' | 'starting' | 'ready' | 'failed'

/** The current window's connection, with only non-secret display data. */
export interface CurrentRuntimeEntry {
  phase: RuntimeManagerPhase
  ownership?: RuntimeOwnership
  cwd: string
  pid?: number
  /** `host:port` only; a launch URL or token must never reach this field. */
  host?: string
  /** Redacted detail for a starting or failed runtime. */
  detail?: string
}

/** A saved attach-only runtime from the broker record: host only, never a launch URL. */
export interface SavedRuntimeEntry {
  host: string
  /** Opaque record identity used to detect a changed descriptor before clearing it. */
  key?: string
}

/** One saved external runtime connection: label and host, never its launch URL. */
export interface RuntimeConnectionEntry {
  id: string
  label: string
  host: string
  /** True only while this window is connected to this exact host. */
  connected: boolean
}

/** A runtime this extension started in an earlier window and still records. */
export interface RecordedRuntimeEntry {
  pid?: number
  cwd: string
  host?: string
  held: number
  heldIsLowerBound: boolean
}

export interface RuntimeManagerSnapshot {
  current: CurrentRuntimeEntry
  saved?: SavedRuntimeEntry
  recorded?: RecordedRuntimeEntry
  /** Saved external runtime connections, newest metadata only. */
  connections?: RuntimeConnectionEntry[]
}

/** One action the manager can dispatch to an existing runtime command. */
export type RuntimeManagerCommandAction = 'start-managed' | 'connect-external' | 'restart'
  | 'reconnect' | 'end-recorded' | 'forget-saved' | 'diagnose'

type RowPickAction = RuntimeManagerCommandAction | 'disconnect' | 'end-current' | 'show-output' | 'none'
  | 'connect-connection' | 'delete-connection' | 'connect-saved' | 'save-saved'
type MainPickAction = RuntimeManagerCommandAction | 'current' | 'saved' | 'recorded' | 'show-output' | 'none'
  | 'connection' | 'add-connection'

interface RowPick extends vscode.QuickPickItem {
  action: RowPickAction
  connection?: RuntimeConnectionEntry
}

interface MainPick extends vscode.QuickPickItem {
  action: MainPickAction
  connection?: RuntimeConnectionEntry
}

/**
 * Host dependencies of the runtime manager.
 *
 * The list itself is data; every mutation is delegated to the command that
 * already implements it (`Restart Runtime`, `End a Leftover Runtime`, …), and a
 * disconnect goes through the controller so the runtime's existing stop
 * semantics — shared windows keep the process, attach-only runtimes are never
 * stopped — are not re-derived here.
 */
export interface RuntimeManagerHost {
  /** Whether a workspace folder exists; starting a managed runtime needs one. */
  readonly workspaceOpen: boolean
  snapshot(): Promise<RuntimeManagerSnapshot>
  /** Stop or detach the current runtime and return the user-facing outcome. */
  disconnectCurrent(): Promise<string>
  execute(action: RuntimeManagerCommandAction): Promise<void>
  showOutput(): void
  /**
   * Save an external launch URL under a non-secret label. The host validates
   * and stores it; the manager only ever receives the label and host back.
   */
  addConnection?(input: { launchUrl: string; label?: string }): Promise<{ id: string; label: string; host: string }>
  /** Connect this window to one saved connection and mark it used on success. */
  connectConnection?(id: string): Promise<void>
  /** Delete one saved connection; disconnects this window first when it is in use. */
  removeConnection?(id: string): Promise<{ label: string; host: string } | undefined>
  /** Connect to the broker's legacy saved external runtime. */
  connectSaved?(): Promise<void>
  /** Copy the legacy saved runtime URL into the saved-connection registry. */
  saveSaved?(): Promise<{ label: string; host: string }>
  /**
   * Start a real managed runtime. The host clears a legacy attach-only broker
   * record first, so DSH cannot reuse that external runtime instead of spawning.
   */
  startManaged?(options: { legacyKey?: string }): Promise<void>
}

const MAX_TEXT = 300

/** Raw runtime facts the host observes; the snapshot below is the safe projection. */
export interface RuntimeManagerObservation {
  runtime: RuntimeState
  cwd: string
  /** A recorded attach-only runtime, if any. Its launch URL is projected to host:port. */
  saved?: { launchUrl: string; key?: string }
  /** An extension-started runtime a later window recorded, if it is still running. */
  recorded?: { pid?: number; cwd: string; launchUrl: string; held: number; heldIsLowerBound: boolean }
}

/** One display line: redact credentials, strip controls, collapse space, bound length. */
export function safeRuntimeText(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return ''
  return redactDshSecrets(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max)
}

/**
 * `host:port` for a launch URL, never the URL itself.
 *
 * The token lives in the query string, so the only safe projection is the
 * authority. An unparseable value degrades to a fixed label rather than echoing
 * whatever it contained.
 */
export function runtimeHostLabel(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'unknown host'
  try { return new URL(value).host || 'unknown host' } catch { return 'unknown host' }
}

/**
 * Project observed runtime facts into the display snapshot.
 *
 * This is the only place a launch URL is reduced to its authority and a runtime
 * detail line is redacted, so neither the current state nor a broker descriptor
 * can leak a token into the list.
 */
export function runtimeManagerSnapshot(observation: RuntimeManagerObservation): RuntimeManagerSnapshot {
  const state = observation.runtime
  const cwd = observation.cwd
  const current: CurrentRuntimeEntry = state.kind === 'ready'
    ? { phase: 'ready', cwd, ...(state.ownership === undefined ? {} : { ownership: state.ownership }),
        ...(state.pid === undefined ? {} : { pid: state.pid }), host: runtimeHostLabel(state.localUri.toString()) }
    : state.kind === 'starting'
      ? { phase: 'starting', cwd, detail: safeRuntimeText(state.detail) }
      : state.kind === 'failed'
        ? { phase: 'failed', cwd, detail: safeRuntimeText(state.message) }
        : { phase: 'stopped', cwd }
  const saved = observation.saved === undefined ? undefined : {
    host: runtimeHostLabel(observation.saved.launchUrl),
    ...(observation.saved.key === undefined ? {} : { key: observation.saved.key }),
  }
  const recorded = observation.recorded === undefined ? undefined : {
    ...(observation.recorded.pid === undefined ? {} : { pid: observation.recorded.pid }),
    cwd: observation.recorded.cwd,
    host: runtimeHostLabel(observation.recorded.launchUrl),
    held: observation.recorded.held,
    heldIsLowerBound: observation.recorded.heldIsLowerBound,
  }
  return { current, ...(saved === undefined ? {} : { saved }), ...(recorded === undefined ? {} : { recorded }) }
}

function phaseLabel(phase: RuntimeManagerPhase): string {
  if (phase === 'ready') return 'Ready'
  if (phase === 'starting') return 'Starting…'
  if (phase === 'failed') return 'Failed'
  return 'Not connected'
}

function ownershipLabel(ownership: RuntimeOwnership | undefined): string {
  return ownership ?? 'unknown'
}

function heldLabel(entry: RecordedRuntimeEntry | undefined): string {
  if (entry === undefined) return ''
  const count = String(entry.held)
  return entry.heldIsLowerBound ? `at least ${count} conversation(s)` : `${count} conversation(s)`
}

function withDetail(parts: readonly string[]): string | undefined {
  const detail = parts.filter(part => part !== '').join(' · ')
  return detail === '' ? undefined : detail
}

function item<A extends MainPickAction | RowPickAction>(label: string, action: A, description?: string, detail?: string):
  vscode.QuickPickItem & { action: A } {
  return { label, action, ...(description === undefined || description === '' ? {} : { description }),
    ...(detail === undefined || detail === '' ? {} : { detail }) }
}

/** The current connection row; a recorded runtime with the same pid merges into it. */
function currentItem(snapshot: RuntimeManagerSnapshot): MainPick {
  const current = snapshot.current
  const recorded = snapshot.recorded
  const merged = recorded !== undefined && current.pid !== undefined && recorded.pid === current.pid
  const state = current.phase === 'ready' ? ownershipLabel(current.ownership) : phaseLabel(current.phase)
  const description = withDetail([state, current.host === undefined ? '' : safeRuntimeText(current.host, 120)])
  const detail = withDetail([
    current.cwd === '' ? '' : `cwd: ${safeRuntimeText(current.cwd, 200)}`,
    current.pid === undefined ? '' : `pid ${String(current.pid)}`,
    merged ? `holding ${heldLabel(recorded)}` : '',
    current.phase === 'starting' || current.phase === 'failed' ? safeRuntimeText(current.detail, 200) : '',
  ])
  return item(`$(plug) Current connection: ${phaseLabel(current.phase)}`, 'current', description, detail)
}

function mainItems(host: RuntimeManagerHost, snapshot: RuntimeManagerSnapshot): MainPick[] {
  const items: MainPick[] = []
  // The explanation is part of the list, not a footnote: the manager must not
  // imply it can see every DSH process on the machine.
  items.push(item('$(info) Not listed: runtimes you started yourself', 'none',
    'A dsh web you launched outside this extension is never adopted or ended'))
  if (!host.workspaceOpen) {
    items.push(item('$(warning) No folder is open', 'none',
      'Open a workspace folder before starting a managed runtime'))
  }
  items.push(currentItem(snapshot))
  for (const connection of snapshot.connections ?? []) {
    const state = connection.connected ? 'Connected' : 'Not connected'
    items.push({ label: `$(server) ${safeRuntimeText(connection.label, 120)}`, action: 'connection',
      description: `${safeRuntimeText(connection.host, 120)} · ${state}`, connection })
  }
  if (snapshot.saved !== undefined) {
    items.push(item('$(cloud) Saved external runtime', 'saved',
      `attach-only · ${safeRuntimeText(snapshot.saved.host, 120)}`,
      'Saved by this extension for later windows; it is never stopped from here'))
  }
  const recorded = snapshot.recorded
  const merged = recorded !== undefined && snapshot.current.pid !== undefined && recorded.pid === snapshot.current.pid
  if (recorded !== undefined && !merged) {
    const detail = withDetail([
      recorded.cwd === '' ? '' : `cwd: ${safeRuntimeText(recorded.cwd, 200)}`,
      `holding ${heldLabel(recorded)}`,
    ])
    items.push(item(`$(server-process) Extension-started runtime${recorded.pid === undefined ? '' : `: pid ${String(recorded.pid)}`}`,
      'recorded', recorded.host === undefined ? 'started by this extension' : `started by this extension · ${safeRuntimeText(recorded.host, 120)}`, detail))
  }
  items.push(
    item('$(add) Add runtime connection…', 'add-connection', 'Save an external runtime launch URL for later windows'),
    item('$(play) Start new managed runtime', 'start-managed', 'Starts an independent DSH process this extension owns'),
    item('$(link) Connect to runtime URL…', 'connect-external', 'Attach to a runtime you started; the URL stays in memory only'),
    item('$(inspect) Diagnose session occupancy', 'diagnose', 'Report which process holds a conversation'),
    item('$(output) Show Output', 'show-output'),
  )
  return items
}

function currentActions(snapshot: RuntimeManagerSnapshot): RowPick[] {
  const current = snapshot.current
  if (current.phase === 'stopped') {
    return [
      item('$(play) Start new managed runtime', 'start-managed', 'Starts a DSH process this extension owns'),
      item('$(link) Connect to runtime URL…', 'connect-external', 'Attach to a runtime you started; the URL stays in memory only'),
      item('$(inspect) Diagnose session occupancy', 'diagnose'),
      item('$(output) Show Output', 'show-output'),
    ]
  }
  const external = current.ownership === 'external' || current.ownership === 'attached'
  return [
    item('$(debug-restart) Restart current runtime', 'restart', 'Interrupts its running conversations and starts a replacement'),
    item('$(refresh) Reconnect', 'reconnect', 'Re-establish this window\'s connection without stopping the runtime'),
    item('$(debug-disconnect) Disconnect current runtime', 'disconnect',
      external ? 'This window detaches; the external runtime keeps running' : 'Stops the extension-started runtime when this is its last window'),
    ...(external ? [] : [item('$(server-process) End extension-started runtime', 'end-current',
      'Stops the runtime and releases its conversations when no other window uses it')]),
    item('$(inspect) Diagnose session occupancy', 'diagnose'),
    item('$(output) Show Output', 'show-output'),
  ]
}

function savedActions(): RowPick[] {
  return [
    item('$(link) Connect to this saved runtime', 'connect-saved', 'Attach using the launch URL kept in the saved record'),
    item('$(save) Save to runtime connections', 'save-saved', 'Keep a reconnect entry before replacing this record'),
    item('$(trash) Forget saved runtime', 'forget-saved', 'Stop attaching to it; the process keeps running'),
    item('$(inspect) Diagnose session occupancy', 'diagnose'),
    item('$(output) Show Output', 'show-output'),
  ]
}

/** One saved connection's actions; Connect and Delete are always available. */
function connectionActions(connection: RuntimeConnectionEntry): RowPick[] {
  return [
    item(connection.connected ? '$(plug) Connected' : '$(link) Connect', 'connect-connection',
      connection.connected ? 'This window is already connected to this runtime' : `Attach to ${connection.host} using its saved URL`),
    item('$(trash) Delete saved connection', 'delete-connection', 'Remove the saved URL; the external process keeps running'),
    item('$(inspect) Diagnose session occupancy', 'diagnose'),
    item('$(output) Show Output', 'show-output'),
  ]
}

function recordedActions(): RowPick[] {
  return [
    item('$(debug-disconnect) End extension-started runtime', 'end-recorded', 'Stops the runtime this extension started; asks for confirmation'),
    item('$(inspect) Diagnose session occupancy', 'diagnose'),
    item('$(output) Show Output', 'show-output'),
  ]
}

async function confirmRestart(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage('Restart the current DSH runtime?',
    { modal: true, detail: 'This interrupts running conversations, subagents and scheduled work in that runtime. If another VS Code window shares it, the restart confirmation appears again.' },
    'Restart Runtime')
  return choice === 'Restart Runtime'
}

async function confirmEndCurrent(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage('End the extension-started DSH runtime?',
    { modal: true, detail: 'This stops the runtime and releases the conversations it holds, unless another VS Code window is still using it. A saved or external runtime is never ended here.' },
    'End Runtime')
  return choice === 'End Runtime'
}

async function confirmDisconnect(snapshot: RuntimeManagerSnapshot): Promise<boolean> {
  const ownership = snapshot.current.ownership
  const external = ownership === 'external' || ownership === 'attached'
  const detail = external
    ? 'This window disconnects only. The external runtime keeps running; this extension never stops it.'
    : 'When this is the last VS Code window using the extension-started runtime, the process stops and releases the conversations it holds. Another window still using it keeps it running.'
  const choice = await vscode.window.showWarningMessage('Disconnect from the DSH runtime?', { modal: true, detail }, 'Disconnect')
  return choice === 'Disconnect'
}

async function confirmConnectConnection(connection: RuntimeConnectionEntry): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Connect to “${safeRuntimeText(connection.label, 120)}” (${safeRuntimeText(connection.host, 120)})?`,
    { modal: true, detail: 'This window disconnects from the current runtime first. A managed runtime may stop when this is its last window; an external runtime keeps running.' },
    'Connect')
  return choice === 'Connect'
}

async function confirmDeleteConnection(connection: RuntimeConnectionEntry): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Delete saved runtime connection “${safeRuntimeText(connection.label, 120)}”?`,
    { modal: true, detail: 'Only the saved launch URL is removed. The external DSH process keeps running and can be added again later.' },
    'Delete')
  return choice === 'Delete'
}

async function confirmStartManagedSwitch(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage('Start a managed DSH runtime?',
    { modal: true, detail: 'This window disconnects from the external runtime first. The external process keeps running and both processes may share the same conversation store.' },
    'Start Managed Runtime')
  return choice === 'Start Managed Runtime'
}

/** Save a now-saved connection and immediately connect to it. */
async function connectSavedConnection(host: RuntimeManagerHost, id: string, label: string): Promise<void> {
  if (host.connectConnection === undefined) {
    void vscode.window.showInformationMessage('Connecting to a saved runtime connection is unavailable in this build.')
    return
  }
  try {
    await host.connectConnection(id)
    void vscode.window.showInformationMessage(`Connected to “${safeRuntimeText(label, 120)}”.`)
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not connect to “${safeRuntimeText(label, 120)}”: ${errorText(error)}.`)
  }
}

/** Add one saved runtime connection: URL first (password), optional label, then offer to connect. */
async function addRuntimeConnection(host: RuntimeManagerHost): Promise<void> {
  if (host.addConnection === undefined) {
    await dispatch(host, 'connect-external')
    return
  }
  const raw = await vscode.window.showInputBox({
    title: 'Add Runtime Connection',
    prompt: 'Paste the full launch URL printed by dsh web. It is stored in VS Code Secret Storage and never shown in the list.',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => {
      if (value.trim() === '') return 'Enter the launch URL printed by dsh web.'
      try { existingRuntimeUrl(value); return undefined } catch (error) {
        return error instanceof Error ? error.message : 'Paste the full launch URL.'
      }
    },
  })
  if (raw === undefined) return
  const hostName = runtimeHostLabel(existingRuntimeUrl(raw).href)
  const name = await vscode.window.showInputBox({
    title: 'Name this runtime connection',
    prompt: `Shown in the runtime list. The launch URL is never shown. Leave blank to use ${hostName}.`,
    placeHolder: hostName,
    ignoreFocusOut: true,
  })
  if (name === undefined) return
  let profile: { id: string; label: string; host: string }
  try {
    profile = await host.addConnection({ launchUrl: raw, ...(name.trim() === '' ? {} : { label: name.trim() }) })
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not save the runtime connection: ${errorText(error)}.`)
    return
  }
  const choice = await vscode.window.showInformationMessage(
    `Saved runtime connection “${safeRuntimeText(profile.label, 120)}” (${safeRuntimeText(profile.host, 120)}). Connect now?`, 'Connect', 'Later')
  if (choice !== 'Connect') return
  await connectSavedConnection(host, profile.id, profile.label)
}

/**
 * Start a genuinely new managed runtime.
 *
 * DSH reuses a recorded attach-only external runtime by default, so the legacy
 * record must be cleared first or "Start new managed" would silently reconnect
 * to the external process. The host performs the clear under the broker lock.
 */
async function startNewManaged(host: RuntimeManagerHost, snapshot: RuntimeManagerSnapshot): Promise<void> {
  const current = snapshot.current
  if (host.startManaged === undefined) {
    if (!host.workspaceOpen) { void vscode.window.showWarningMessage('Open a folder or workspace before starting a managed runtime.'); return }
    await dispatch(host, 'start-managed')
    return
  }
  if (!host.workspaceOpen) {
    void vscode.window.showWarningMessage('Open a folder or workspace before starting a managed runtime.')
    return
  }
  if (current.phase === 'ready' && (current.ownership === 'managed' || current.ownership === 'adopted')) {
    const choice = await vscode.window.showWarningMessage(
      'A managed DSH runtime is already connected.',
      { modal: true, detail: 'Starting another would replace it. Restart Runtime stops and starts the existing managed runtime instead.' },
      'Restart Runtime')
    if (choice !== 'Restart Runtime') return
    if (!await confirmRestart()) return
    await dispatch(host, 'restart')
    return
  }
  const legacy = snapshot.saved
  if (legacy !== undefined) {
    const buttons = host.saveSaved === undefined ? ['Start Managed Runtime'] : ['Save and Start', 'Start Without Saving']
    const choice = await vscode.window.showWarningMessage('Start a separate managed DSH runtime?', {
      modal: true,
      detail: 'A saved external DSH runtime is recorded, and DSH normally reuses it. Continuing clears that saved record and starts a new managed process. The external process keeps running and may share the same conversation store. Save it under Runtime Connections first if you need a reconnect entry.',
    }, ...buttons)
    if (choice === undefined) return
    if (choice === 'Save and Start') {
      try {
        const saved = await host.saveSaved!()
        void vscode.window.showInformationMessage(`Saved the external DSH runtime as “${safeRuntimeText(saved.label, 120)}” (${safeRuntimeText(saved.host, 120)}).`)
      } catch (error) {
        const message = errorText(error)
        // Already saved is not a reason to refuse the start: the reconnect entry
        // the user was about to create already exists.
        if (!/already saved|already exists/i.test(message)) {
          void vscode.window.showErrorMessage(`Could not save the external runtime first: ${message}. Nothing was started.`)
          return
        }
        void vscode.window.showInformationMessage('That external runtime is already saved under runtime connections.')
      }
    }
    try {
      await host.startManaged({ ...(legacy.key === undefined ? {} : { legacyKey: legacy.key }) })
      void vscode.window.showInformationMessage('Started a new managed DSH runtime.')
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not start the managed DSH runtime: ${errorText(error)}.`)
    }
    return
  }
  if (current.ownership === 'external' || current.ownership === 'attached') {
    if (!await confirmStartManagedSwitch()) return
  }
  try {
    await host.startManaged({})
    void vscode.window.showInformationMessage('Started a new managed DSH runtime.')
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not start the managed DSH runtime: ${errorText(error)}.`)
  }
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return safeRuntimeText(text, 400) || 'unknown error'
}

async function dispatch(host: RuntimeManagerHost, action: RuntimeManagerCommandAction): Promise<void> {
  try {
    await host.execute(action)
  } catch (error) {
    void vscode.window.showErrorMessage(`The runtime action failed: ${errorText(error)}.`)
  }
}

/** Run one row's submenu. Returns true when the manager should close. */
async function runRowActions(host: RuntimeManagerHost, snapshot: RuntimeManagerSnapshot,
  kind: 'current' | 'saved' | 'recorded' | 'connection',
  connection?: RuntimeConnectionEntry): Promise<boolean> {
  const title = kind === 'current' ? 'Current Runtime Actions'
    : kind === 'saved' ? 'Saved Runtime Actions'
      : kind === 'connection' && connection !== undefined ? `Runtime Connection: ${safeRuntimeText(connection.label, 120)}`
        : 'Extension-started Runtime Actions'
  const items = kind === 'current' ? currentActions(snapshot)
    : kind === 'saved' ? savedActions()
      : kind === 'connection' && connection !== undefined ? connectionActions(connection)
        : recordedActions()
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'Choose an action' })
  if (picked === undefined) return false
  if (picked.action === 'show-output') { host.showOutput(); return true }
  if (picked.action === 'none') return false
  if (picked.action === 'disconnect' || picked.action === 'end-current') {
    const confirmed = picked.action === 'end-current' ? await confirmEndCurrent() : await confirmDisconnect(snapshot)
    if (!confirmed) return false
    try {
      const note = await host.disconnectCurrent()
      void vscode.window.showInformationMessage(note)
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not disconnect the DSH runtime: ${errorText(error)}.`)
    }
    return false
  }
  if (picked.action === 'restart') {
    if (!await confirmRestart()) return false
    await dispatch(host, 'restart')
    return false
  }
  if (picked.action === 'start-managed') {
    await startNewManaged(host, snapshot)
    return false
  }
  if (picked.action === 'connect-connection' && connection !== undefined) {
    if (host.connectConnection === undefined) {
      void vscode.window.showInformationMessage('Connecting to a saved runtime connection is unavailable in this build.')
      return false
    }
    if (connection.connected) {
      void vscode.window.showInformationMessage(`This window is already connected to “${safeRuntimeText(connection.label, 120)}”.`)
      return false
    }
    // Switching away from a live runtime keeps the old confirmation; from an
    // idle window the user already chose this connection explicitly.
    if (snapshot.current.phase === 'ready' && !await confirmConnectConnection(connection)) return false
    await connectSavedConnection(host, connection.id, connection.label)
    return false
  }
  if (picked.action === 'delete-connection' && connection !== undefined) {
    if (host.removeConnection === undefined) {
      void vscode.window.showInformationMessage('Deleting a saved runtime connection is unavailable in this build.')
      return false
    }
    if (!await confirmDeleteConnection(connection)) return false
    try {
      const removed = await host.removeConnection(connection.id)
      void vscode.window.showInformationMessage(removed === undefined
        ? 'The saved runtime connection was already removed.'
        : `Deleted the saved runtime connection “${safeRuntimeText(removed.label, 120)}”. The external runtime keeps running.`)
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not delete the saved runtime connection: ${errorText(error)}.`)
    }
    return false
  }
  if (picked.action === 'connect-saved') {
    if (host.connectSaved === undefined) {
      void vscode.window.showInformationMessage('This saved runtime is unavailable in this build.')
      return false
    }
    try {
      await host.connectSaved()
      void vscode.window.showInformationMessage('Connecting to the saved external DSH runtime…')
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not connect to the saved DSH runtime: ${errorText(error)}.`)
    }
    return false
  }
  if (picked.action === 'save-saved') {
    if (host.saveSaved === undefined) {
      void vscode.window.showInformationMessage('Saving runtime connections is unavailable in this build.')
      return false
    }
    try {
      const saved = await host.saveSaved()
      void vscode.window.showInformationMessage(`Saved “${safeRuntimeText(saved.label, 120)}” (${safeRuntimeText(saved.host, 120)}) to runtime connections. The saved DSH record was kept.`)
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not save the runtime connection: ${errorText(error)}.`)
    }
    return false
  }
  // These row actions are handled above only when a connection row was
  // selected; without one they are inert rather than dispatched as commands.
  if (picked.action === 'connect-connection' || picked.action === 'delete-connection') return false
  await dispatch(host, picked.action)
  return false
}

/**
 * Read the manager snapshot, reporting one redacted error when it fails.
 *
 * Shared by the list and the command entry point so both start paths make the
 * same legacy-record decision from the same observation.
 */
async function readManagerSnapshot(host: RuntimeManagerHost): Promise<RuntimeManagerSnapshot | undefined> {
  try {
    return await host.snapshot()
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not read DSH runtimes: ${errorText(error)}.`)
    return undefined
  }
}

/**
 * Start new managed runtime from any entry point.
 *
 * The Command Palette command, the Webview button and the manager list all
 * reach this one flow. It observes live state first, so a legacy attach-only
 * record gets the same warning and record clearing instead of being adopted by
 * the runtime's default reuse decision.
 */
export async function startManagedRuntimeFlow(host: RuntimeManagerHost): Promise<void> {
  const snapshot = await readManagerSnapshot(host)
  if (snapshot === undefined) return
  await startNewManaged(host, snapshot)
}

/**
 * Show the native runtime list and dispatch the chosen management action.
 *
 * Selecting Escape at any step performs nothing. The list is re-read after a
 * command completes so a restart, disconnect or ended leftover runtime is
 * reflected in the next view.
 */
export async function manageRuntimes(host: RuntimeManagerHost): Promise<void> {
  for (;;) {
    const snapshot = await readManagerSnapshot(host)
    if (snapshot === undefined) return
    const picked = await vscode.window.showQuickPick(mainItems(host, snapshot), {
      title: 'DeepSeek Harness Runtimes',
      placeHolder: host.workspaceOpen
        ? 'Choose a runtime to manage, or an action'
        : 'No folder is open — open a workspace folder before starting a managed runtime',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (picked === undefined) return
    if (picked.action === 'current' || picked.action === 'saved' || picked.action === 'recorded' || picked.action === 'connection') {
      const connection = picked.action === 'connection' ? picked.connection : undefined
      if (picked.action === 'connection' && connection === undefined) continue
      if (await runRowActions(host, snapshot, picked.action, connection)) return
      continue
    }
    if (picked.action === 'none') continue
    if (picked.action === 'show-output') { host.showOutput(); return }
    if (picked.action === 'add-connection') { await addRuntimeConnection(host); continue }
    if (picked.action === 'start-managed') { await startNewManaged(host, snapshot); continue }
    await dispatch(host, picked.action)
  }
}
