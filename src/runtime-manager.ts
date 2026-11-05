import * as vscode from 'vscode'
import type { RuntimeOwnership, RuntimeState } from './runtime.js'
import { redactDshSecrets } from './runtime-output.js'

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

/** A saved attach-only runtime: host only, never a launch URL. */
export interface SavedRuntimeEntry {
  host: string
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
}

/** One action the manager can dispatch to an existing runtime command. */
export type RuntimeManagerCommandAction = 'start-managed' | 'connect-external' | 'restart'
  | 'reconnect' | 'end-recorded' | 'forget-saved' | 'diagnose'

type RowPickAction = RuntimeManagerCommandAction | 'disconnect' | 'end-current' | 'show-output' | 'none'
type MainPickAction = RuntimeManagerCommandAction | 'current' | 'saved' | 'recorded' | 'show-output' | 'none'

interface RowPick extends vscode.QuickPickItem {
  action: RowPickAction
}

interface MainPick extends vscode.QuickPickItem {
  action: MainPickAction
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
}

const MAX_TEXT = 300

/** Raw runtime facts the host observes; the snapshot below is the safe projection. */
export interface RuntimeManagerObservation {
  runtime: RuntimeState
  cwd: string
  /** A recorded attach-only runtime, if any. Its launch URL is projected to host:port. */
  saved?: { launchUrl: string }
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
  const saved = observation.saved === undefined ? undefined : { host: runtimeHostLabel(observation.saved.launchUrl) }
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
    item('$(play) Start new managed runtime', 'start-managed', 'Starts a DSH process this extension owns'),
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
    item('$(trash) Forget saved runtime', 'forget-saved', 'Stop attaching to it; the process keeps running'),
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
  action: 'current' | 'saved' | 'recorded'): Promise<boolean> {
  const title = action === 'current' ? 'Current Runtime Actions'
    : action === 'saved' ? 'Saved Runtime Actions' : 'Extension-started Runtime Actions'
  const items = action === 'current' ? currentActions(snapshot)
    : action === 'saved' ? savedActions() : recordedActions()
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
  if (picked.action === 'start-managed' && !host.workspaceOpen) {
    void vscode.window.showWarningMessage('Open a folder or workspace before starting a managed runtime.')
    return false
  }
  await dispatch(host, picked.action)
  return false
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
    let snapshot: RuntimeManagerSnapshot
    try {
      snapshot = await host.snapshot()
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not read DSH runtimes: ${errorText(error)}.`)
      return
    }
    const picked = await vscode.window.showQuickPick(mainItems(host, snapshot), {
      title: 'DeepSeek Harness Runtimes',
      placeHolder: host.workspaceOpen
        ? 'Choose a runtime to manage, or an action'
        : 'No folder is open — open a workspace folder before starting a managed runtime',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (picked === undefined) return
    if (picked.action === 'current' || picked.action === 'saved' || picked.action === 'recorded') {
      if (await runRowActions(host, snapshot, picked.action)) return
      continue
    }
    if (picked.action === 'none') continue
    if (picked.action === 'show-output') { host.showOutput(); return }
    if (picked.action === 'start-managed' && !host.workspaceOpen) {
      void vscode.window.showWarningMessage('Open a folder or workspace before starting a managed runtime.')
      continue
    }
    await dispatch(host, picked.action)
  }
}
