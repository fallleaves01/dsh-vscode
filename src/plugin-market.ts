import * as vscode from 'vscode'
import { DshConnectionError } from './dsh-connection.js'
import { dshErrorText, dshFailure } from './dsh-errors.js'
import type {
  DshBundleInfo,
  DshBundleInstallOptions,
  DshBundleInstallResult,
  DshClient,
  DshMarketIndexSummary,
  DshMarketListingEntry,
} from './dsh-client.js'
import { runtimeIsNotOurs } from './runtime-change.js'
import type { RuntimeOwnership } from './runtime.js'
import { redactDshSecrets } from './runtime-output.js'

/**
 * The host dependencies of the two plugin-install commands.
 *
 * Kept narrow so the command modules can be driven from the extension's real
 * controller without re-deriving readiness, client identity or profile
 * ownership at each call site. `refreshSettings` re-reads an open settings
 * page: installing a bundle changes the very list that page shows.
 */
export interface PluginMarketHost {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error' | string
  readonly runtimeOwnership: RuntimeOwnership | undefined
  client(): DshClient
  refreshSettings(): void
  log(line: string): void
}

const MAX_DISPLAY = 300
const MAX_ERROR = 400

/**
 * Bound untrusted text for a picker or a notice: redact credentials, remove
 * control characters, collapse whitespace, and cap the length. Market index and
 * plugin descriptions are user-editable remote content; they are display data,
 * never instructions.
 */
export function safeMarketText(value: unknown, max = MAX_DISPLAY): string {
  if (typeof value !== 'string') return ''
  return redactDshSecrets(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max)
}

/** Localized display text for a bundle title: a string or its `en` fallback. */
function localizedText(value: unknown, max = MAX_DISPLAY): string {
  if (typeof value === 'string') return safeMarketText(value, max)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const fields = value as Record<string, unknown>
  const english = safeMarketText(fields.en, max)
  if (english !== '') return english
  for (const candidate of Object.values(fields)) {
    const text = safeMarketText(candidate, max)
    if (text !== '') return text
  }
  return ''
}

/** Title for one market index row; the URL is always the fallback. */
export function marketIndexLabel(index: DshMarketIndexSummary): string {
  return safeMarketText(index.title, 120) || safeMarketText(index.url, MAX_DISPLAY)
}

/** Title for one market plugin row. */
export function marketEntryLabel(entry: DshMarketListingEntry): string {
  return safeMarketText(entry.title, 120) || safeMarketText(entry.name, MAX_DISPLAY)
}

/** Human-readable bundle title, falling back to the package name. */
export function officialBundleLabel(bundle: DshBundleInfo): string {
  const title = localizedText(bundle.meta?.title, 120)
  if (title !== '') return title
  const short = safeMarketText(bundle.name, MAX_DISPLAY).replace(/^@[^/]+\//, '')
  return short || safeMarketText(bundle.name, MAX_DISPLAY)
}

/**
 * The official on-demand entries this runtime can install.
 *
 * Only an official entry the current installation does not ship, and whose
 * catalog row names the exact package to install, is a candidate. Everything
 * else is either already present or not installable from a bundle spec.
 */
export function officialInstallCandidates(bundles: readonly DshBundleInfo[]): DshBundleInfo[] {
  return bundles.filter(bundle => bundle.official === true && bundle.installed !== true
    && typeof bundle.installTarget?.spec === 'string' && bundle.installTarget.spec.trim() !== '')
}

/** The install target of the entry's default compatible version. */
function defaultInstallTarget(entry: DshMarketListingEntry): { version: string; spec: string; registry?: string } | undefined {
  const version = entry.defaultVersion
  if (version === undefined || version === '') return undefined
  const listing = entry.versions.find(item => item.version === version)
  if (listing === undefined) return undefined
  return { version, spec: listing.install.spec,
    ...(listing.install.registry === undefined ? {} : { registry: listing.install.registry }) }
}

function installationText(entry: DshMarketListingEntry): string {
  const installation = entry.installation
  if (installation === undefined) return ''
  if (installation.status === 'installed') return 'Installed'
  if (installation.status === 'update-available') return 'Update available'
  if (installation.status === 'different-version') return 'Different version installed'
  if (installation.status === 'provided') return 'Provided by this installation'
  return 'Not installed'
}

function entryDetail(entry: DshMarketListingEntry): string {
  const parts = [
    safeMarketText(entry.author, 120) === '' ? '' : `by ${safeMarketText(entry.author, 120)}`,
    installationText(entry),
    safeMarketText(entry.description, MAX_DISPLAY),
  ].filter(part => part !== '')
  return parts.join(' · ').slice(0, 500)
}

function bundleDetail(bundle: DshBundleInfo): string {
  const description = localizedText(bundle.meta?.description, MAX_DISPLAY) || safeMarketText(bundle.description, MAX_DISPLAY)
  const availability = bundle.availability === 'installation' ? 'Shipped with this installation' : 'On-demand bundle'
  return [availability, description].filter(part => part !== '').join(' · ').slice(0, 500)
}

/** Read the client only after proving this window may change the profile. */
function readyClient(host: PluginMarketHost): DshClient | undefined {
  if (host.phase !== 'ready') {
    void vscode.window.showWarningMessage('DSH is not connected. Connect the runtime and try again.')
    return undefined
  }
  if (runtimeIsNotOurs(host.runtimeOwnership)) {
    void vscode.window.showWarningMessage('This external runtime is attach-only. Install plugins from the runtime that owns it, or connect a managed runtime.')
    return undefined
  }
  try {
    return host.client()
  } catch (error) {
    void vscode.window.showErrorMessage(`Plugins are unavailable: ${installedFailureText(error)}`)
    return undefined
  }
}

/**
 * Whether a failure means the runtime does not serve the plugin-market service.
 *
 * A missing remote reaches the client as HTTP 404 or, when the typert gateway
 * answers first, as `gateway/invocation-unavailable` with text such as "Unknown
 * method."; both mean "the plugin-market bundle is not enabled".
 */
function marketUnavailable(error: unknown): boolean {
  if (error instanceof DshConnectionError && error.status === 404) return true
  const failure = dshFailure(error)
  if (failure.code === 'gateway/invocation-unavailable' || failure.code === 'gateway/unknown-method'
    || failure.code === 'gateway/not-found' || failure.code === 'gateway/route-not-found') return true
  if (/HTTP\s+404\b/i.test(failure.message)) return true
  return /(?:unknown|unavailable|not found|not registered)[^\n]*plugin[-\s]?market|plugin[-\s]?market[^\n]*(?:unknown|unavailable|not found|not registered)/i.test(failure.message)
}

/** One readable line for a plugin-market read failure. */
export function marketFailureText(error: unknown): string {
  if (marketUnavailable(error)) {
    return 'The plugin market service is not available on this runtime. Enable the plugin-market bundle in the DSH profile, add an index URL in its settings, then reconnect.'
  }
  if (error instanceof DshConnectionError && error.code === 'invalid-response') {
    return 'The runtime returned an unexpected plugin market response.'
  }
  const readable = safeMarketText(dshErrorText(error), MAX_ERROR)
  return readable === '' ? 'The plugin market request failed.' : `The plugin market request failed: ${readable}`
}

/** One readable line for a bundle-install failure. */
export function installedFailureText(error: unknown): string {
  if (error instanceof DshConnectionError) {
    if (error.status === 404) return 'The bundle installer is not available on this runtime.'
    if (error.code === 'invalid-response') return 'The runtime returned an unexpected install result.'
  }
  const code = dshFailure(error).code
  if (code === 'gateway/invocation-unavailable' || code === 'gateway/unknown-method') return 'The bundle installer is not available on this runtime.'
  const readable = safeMarketText(dshErrorText(error), MAX_ERROR)
  return readable === '' ? 'the installation request failed' : readable
}

/** Explain a failed installation by its runtime error code, never its diagnostics. */
function installRefusalText(result: DshBundleInstallResult): string {
  const code = result.error?.code
  if (code === 'management-required') return 'the runtime profile is read-only; use the client that owns this profile'
  if (code === 'unaddressable') return 'the runtime cannot address that plugin'
  if (code === 'unknown-plugin') return 'the runtime does not know that plugin'
  if (code === 'invalid-spec') return 'that plugin specification is not valid'
  if (code === 'already-installed') return 'that version is already installed'
  if (code === 'ambiguous-install') return 'more than one version matched this request'
  if (code === 'not-bundle') return 'that package is not a DSH bundle'
  if (code === 'not-removable') return 'the existing version cannot be replaced'
  if (code === 'stop-profile') return 'another profile operation is running; try again'
  if (code === 'bundle-in-use') return 'the bundle is in use; restart the runtime and try again'
  if (code === 'stale-approval') return 'the build approval expired; try again'
  if (code === 'incompatible-version') return 'that version is not compatible with this runtime'
  if (code === 'unsupported-platform') return 'that version does not support this platform'
  if (code === 'operation-error') return 'the install operation failed'
  const stage = safeMarketText(result.stage, 40)
  return stage === '' ? 'the runtime could not install this plugin; check the DSH plugin manager for details'
    : `the ${stage} step failed`
}

/** Show the confirmed install, refresh settings, and describe the outcome. */
function reportInstall(host: PluginMarketHost, label: string, result: DshBundleInstallResult): void {
  const version = result.version === undefined || result.version === '' ? '' : ` ${safeMarketText(result.version, 100)}`
  if (result.application !== 'cancelled') host.refreshSettings()
  if (result.application === 'applied') {
    void vscode.window.showInformationMessage(`${label}${version} installed.`)
  } else if (result.application === 'restart-required') {
    void vscode.window.showWarningMessage(`${label}${version} installed. Restart the DSH runtime to apply it.`)
  } else if (result.application === 'overridden') {
    void vscode.window.showInformationMessage(`${label}${version} installed, but a higher-priority profile entry overrides it.`)
  } else if (result.application === 'cancelled') {
    void vscode.window.showInformationMessage(`Installation of ${label} was cancelled.`)
  } else {
    const pending = result.pendingBuilds ?? []
    const approval = pending.length === 0 ? ''
      : ` The runtime needs approval to run build scripts for: ${pending.slice(0, 5).map(name => safeMarketText(name, 120)).join(', ')}${pending.length > 5 ? ', …' : ''}.`
    void vscode.window.showErrorMessage(`Could not install ${label}: ${installRefusalText(result)}.${approval}`)
  }
  host.log(`[plugins] install ${result.application}${result.error?.code === undefined ? '' : ` (${safeMarketText(result.error.code, 64)})`}`)
}

/** Confirm name, version and spec before the shared profile is changed. */
async function confirmInstall(label: string, kind: 'Plugin' | 'Bundle', name: string, version: string, spec: string,
  description = ''): Promise<boolean> {
  const lines = [`${kind}: ${safeMarketText(name, 300)}`, `Version: ${safeMarketText(version, 100) || 'unknown'}`,
    `Spec: ${safeMarketText(spec, 500)}`]
  const summary = safeMarketText(description, 400)
  if (summary !== '') lines.push('', summary)
  lines.push('', 'This installs into the shared DSH web profile used by this runtime.')
  const choice = await vscode.window.showWarningMessage(`Install ${safeMarketText(label, 200)}${version === '' ? '' : ` ${safeMarketText(version, 100)}`}?`,
    { modal: true, detail: lines.join('\n') }, 'Install')
  return choice === 'Install'
}

/**
 * Run one installation behind a notification, returning undefined on failure.
 *
 * The client is the one the flow already read through: a reconnect in the
 * middle must fail the install instead of silently retargeting another runtime.
 */
async function runInstall(client: DshClient, label: string, spec: string,
  options: DshBundleInstallOptions): Promise<DshBundleInstallResult | undefined> {
  try {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
      title: `Installing ${safeMarketText(label, 120)}…`, cancellable: false }, () => client.installBundle(spec, options))
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not install ${label}: ${installedFailureText(error)}.`)
    return undefined
  }
}

/** Discover→configured index→query→pick→confirm→install, for the plugin market. */
export async function discoverPlugins(host: PluginMarketHost): Promise<void> {
  const client = readyClient(host)
  if (client === undefined) return
  let indexes: DshMarketIndexSummary[]
  try {
    indexes = await client.pluginMarketIndexes()
  } catch (error) {
    void vscode.window.showErrorMessage(marketFailureText(error))
    return
  }
  if (indexes.length === 0) {
    void vscode.window.showWarningMessage('No plugin market index is configured on this runtime. Add an index URL in the plugin market settings, then run this command again.')
    return
  }
  const indexPick = indexes.map(index => {
    const label = marketIndexLabel(index), url = safeMarketText(index.url, MAX_DISPLAY)
    const detail = index.error === undefined ? safeMarketText(index.description) : `Read failed: ${safeMarketText(index.error, MAX_ERROR)}`
    return { label, ...(url === label ? {} : { description: url }), ...(detail === '' ? {} : { detail }), index }
  })
  const pickedIndex = await vscode.window.showQuickPick(indexPick, { title: 'Plugin market indexes',
    placeHolder: 'Select the index to search', matchOnDescription: true, matchOnDetail: true })
  if (pickedIndex === undefined) return
  const index = pickedIndex.index
  if (index.error !== undefined) {
    void vscode.window.showWarningMessage(`The index ${marketIndexLabel(index)} could not be read: ${safeMarketText(index.error, MAX_ERROR)}. Fix its URL in the plugin market settings and try again.`)
    return
  }
  const query = await vscode.window.showInputBox({ title: 'Discover plugins', prompt: `Search ${marketIndexLabel(index)}`,
    placeHolder: 'Plugin name, keyword, or description', ignoreFocusOut: true })
  if (query === undefined) return
  let entries: DshMarketListingEntry[]
  try {
    entries = (await client.pluginMarketSearch(index.url, query)).entries
  } catch (error) {
    void vscode.window.showErrorMessage(marketFailureText(error))
    return
  }
  if (entries.length === 0) {
    const text = safeMarketText(query, 100)
    void vscode.window.showInformationMessage(text === '' ? 'No plugins matched the search.' : `No plugins matched “${text}”.`)
    return
  }
  const entryPick = entries.map(entry => {
    const label = marketEntryLabel(entry), target = defaultInstallTarget(entry)
    const description = target === undefined ? 'No compatible version'
      : safeMarketText(entry.defaultVersion, 100) === '' ? '' : `v${safeMarketText(entry.defaultVersion, 100)}`
    const detail = entryDetail(entry)
    return { label, ...(description === '' ? {} : { description }), ...(detail === '' ? {} : { detail }), entry }
  })
  const pickedEntry = await vscode.window.showQuickPick(entryPick, { title: 'Plugin market',
    placeHolder: 'Select a plugin to install', matchOnDescription: true, matchOnDetail: true })
  if (pickedEntry === undefined) return
  const entry = pickedEntry.entry
  const target = defaultInstallTarget(entry)
  if (target === undefined) {
    void vscode.window.showWarningMessage(`No compatible version of ${marketEntryLabel(entry)} is available for this runtime.`)
    return
  }
  const label = marketEntryLabel(entry)
  if (!await confirmInstall(label, 'Plugin', entry.name, target.version, target.spec, safeMarketText(entry.description))) return
  const result = await runInstall(client, label, target.spec,
    target.registry === undefined ? {} : { registry: target.registry })
  if (result !== undefined) reportInstall(host, label, result)
}

/** Install one official on-demand bundle the current installation does not ship. */
export async function installOfficialPlugin(host: PluginMarketHost): Promise<void> {
  const client = readyClient(host)
  if (client === undefined) return
  let bundles: DshBundleInfo[] | undefined
  try {
    bundles = await client.listBundles()
  } catch (error) {
    void vscode.window.showErrorMessage(`The runtime did not report its plugin bundles: ${installedFailureText(error)}.`)
    return
  }
  if (bundles === undefined) {
    void vscode.window.showWarningMessage('The runtime did not report its plugin bundles. Reconnect the runtime and try again.')
    return
  }
  const candidates = officialInstallCandidates(bundles)
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('No official plugins are available to install on this runtime.')
    return
  }
  const bundlePick = candidates.map(bundle => {
    const label = officialBundleLabel(bundle), version = safeMarketText(bundle.installTarget?.version, 100)
    const detail = bundleDetail(bundle)
    return { label, ...(version === '' ? {} : { description: `v${version}` }), ...(detail === '' ? {} : { detail }), bundle }
  })
  const pickedBundle = await vscode.window.showQuickPick(bundlePick, { title: 'Official DSH plugins',
    placeHolder: 'Select an official plugin to install', matchOnDescription: true, matchOnDetail: true })
  if (pickedBundle === undefined) return
  const bundle = pickedBundle.bundle
  const spec = bundle.installTarget?.spec
  if (typeof spec !== 'string' || spec.trim() === '') {
    void vscode.window.showWarningMessage(`The runtime did not report how to install ${officialBundleLabel(bundle)}.`)
    return
  }
  const version = safeMarketText(bundle.installTarget?.version, 100)
  const label = officialBundleLabel(bundle)
  if (!await confirmInstall(label, 'Bundle', bundle.name, version, spec.trim(),
    localizedText(bundle.meta?.description, 400) || safeMarketText(bundle.description, 400))) return
  const result = await runInstall(client, label, spec.trim(), {})
  if (result !== undefined) reportInstall(host, label, result)
}
