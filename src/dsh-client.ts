import type { DshConnection } from './dsh-connection.js'
import { DshConnectionError, MAX_ATTACHMENT_RESPONSE_BYTES } from './dsh-connection.js'
import { DshRemoteApi } from './dsh-remote-api.js'
import { DshSessionFeed, type SessionOpening } from './dsh-session-feed.js'
import { wireRecord } from './dsh-streams.js'
import type { DshEvent } from './conversation.js'
import type { PluginInventorySnapshot } from './plugin-profile.js'
import type { SettingsDescription, SettingsMutation, SettingsNamespace } from './runtime-settings.js'
import type { ConfigurableProvider, CredentialState, DiscoveredModel, ModelDiscoveryRequest } from './settings-page-state.js'
import { permissionCatalogOf, type PermissionCatalog } from './collaboration-state.js'
import { RemoteRead } from './remote-read.js'
import { DshCommandTransport } from './dsh-command-transport.js'
import { goalOf, schedulesOf, type GoalView, type ScheduleCreateRequest, type ScheduleEntry, type ScheduleUpdatePatch } from './task-features.js'

/** A market index read may fetch a remote document; the install runs a package manager. */
export const PLUGIN_MARKET_TIMEOUT_MS = 60_000
/** Outlasts the host's file-lock wait and the package-manager run it starts. */
export const BUNDLE_INSTALL_TIMEOUT_MS = 300_000

export interface SessionSummary {
  sessionId: string
  /** A live parent can continue a child even while its own turn is idle. */
  agentAvailable?: boolean
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  origin?: 'subagent'
  /** Owning conversation when this session was created as a subagent. */
  parentSessionId?: string
  agentPreset?: string
  projections?: { asOfSeq?: number; values?: Record<string, unknown> }
}

export interface HistoryEntry {
  event: DshEvent
  view?: unknown
}

export type SessionProjectionRead = { kind: 'sequenced'; asOfSeq: number; values: Record<string, unknown> }
  | { kind: 'migration-required'; values: Record<string, unknown> } | null

/**
 * One profile bundle row as `pluginManager/listBundles` reports it.
 *
 * The raw row also carries an icon data URL, local install paths, patch rows and
 * raw diagnostics. `publicBundles()` in settings-page-state.ts is the projection
 * boundary that drops them, so this interface stays close to the wire shape.
 */
export interface DshBundleInfo {
  name: string
  official?: boolean
  availability?: 'profile' | 'installation' | 'missing'
  version?: string
  description?: string
  enabled?: boolean
  installed?: boolean
  optional?: boolean
  removable?: boolean
  /**
   * alpha.3: the exact package to install for an on-demand catalog entry.
   *
   * Only official entries the installation does not ship advertise it, so it is
   * the one spec an "install official plugin" flow may send; a bundle without
   * it is either installed or not installable from this extension.
   */
  installTarget?: { spec: string; version: string }
  /** alpha2: whether the Host lists this bundle by default; undefined on older runtimes. */
  listedByDefault?: boolean
  /** alpha2: whether `pluginManager/updateBundle` accepts this bundle; undefined means unknown. */
  updatable?: boolean
  readOnlyReason?: 'management-required' | 'unaddressable'
  meta?: { title?: unknown; description?: unknown }
  error?: { code?: string }
}

/** One configured plugin-market index as `pluginMarket/listIndexes` reports it. */
export interface DshMarketIndexSummary {
  url: string
  title?: string
  description?: string
  /** Last read failure; the row still names its URL so the user can fix it. */
  error?: string
}

/** The installation target of one market version. */
export interface DshMarketInstallTarget {
  spec: string
  registry?: string
}

/** One plugin version the market index lists, with its compatibility verdict. */
export interface DshMarketListingVersion {
  version: string
  install: DshMarketInstallTarget
  /** Undefined when the index omitted the verdict; the default version is authoritative. */
  compatible?: boolean
}

/** One plugin row of a plugin-market search page. */
export interface DshMarketListingEntry {
  name: string
  title?: string
  description?: string
  author?: string
  homepage?: string
  /** The version installed by default: the highest compatible one; absent when none is compatible. */
  defaultVersion?: string
  versions: DshMarketListingVersion[]
  installation?: { status: 'not-installed' | 'installed' | 'update-available' | 'different-version' | 'provided'; installedVersion?: string }
}

/** One page of `pluginMarket/search`, with display text already localized. */
export interface DshMarketSearchPage {
  url?: string
  title?: string
  entries: DshMarketListingEntry[]
  total: number
  nextOffset: number | null
}

/** Optional arguments of `pluginManager/installBundle`. */
export interface DshBundleInstallOptions {
  requestId?: string
  registry?: string
  saveExact?: boolean
}

/**
 * The profile mutation outcome `pluginManager/installBundle` returns.
 *
 * `bundle` is the installed package name and `pendingBuilds` lists packages
 * whose build scripts await approval; both are display data only. Error
 * diagnostics stay out of this type so they cannot reach a log or a Webview.
 */
export interface DshBundleInstallResult {
  changed: boolean
  application: 'applied' | 'restart-required' | 'failed' | 'cancelled' | 'overridden'
  stage?: string
  target?: string
  restartReason?: string
  bundle?: string
  version?: string
  pendingBuilds?: string[]
  error?: { code?: string }
}

/**
 * The one localization rule the market wire uses: a plain string, or a record
 * whose `en` entry is the fallback for every other language.
 */
function marketText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' ? undefined : text.slice(0, 4000)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const fields = value as Record<string, unknown>
  const english = fields.en
  if (typeof english === 'string' && english.trim() !== '') return english.trim().slice(0, 4000)
  for (const candidate of Object.values(fields)) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim().slice(0, 4000)
  }
  return undefined
}

function marketIndexOf(value: unknown): DshMarketIndexSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.url !== 'string' || row.url.trim() === '') return undefined
  const title = marketText(row.title), description = marketText(row.description)
  const error = typeof row.error === 'string' && row.error.trim() !== '' ? row.error.trim().slice(0, 1000) : undefined
  return { url: row.url,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(error === undefined ? {} : { error }) }
}

function marketIndexesOf(value: unknown): DshMarketIndexSummary[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((row): DshMarketIndexSummary[] => {
    const parsed = marketIndexOf(row)
    return parsed === undefined ? [] : [parsed]
  })
}

function marketVersionOf(value: unknown): DshMarketListingVersion | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.version !== 'string' || row.version === '') return undefined
  const install = typeof row.install === 'object' && row.install !== null ? row.install as Record<string, unknown> : undefined
  if (typeof install?.spec !== 'string' || install.spec.trim() === '') return undefined
  const registry = typeof install.registry === 'string' && install.registry !== '' ? install.registry : undefined
  const compatibility = typeof row.compatibility === 'object' && row.compatibility !== null ? row.compatibility as Record<string, unknown> : undefined
  const compatible = typeof compatibility?.compatible === 'boolean' ? compatibility.compatible : undefined
  return { version: row.version, install: { spec: install.spec, ...(registry === undefined ? {} : { registry }) },
    ...(compatible === undefined ? {} : { compatible }) }
}

function marketInstallationOf(value: unknown): DshMarketListingEntry['installation'] {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const status = row.status
  if (status !== 'not-installed' && status !== 'installed' && status !== 'update-available'
    && status !== 'different-version' && status !== 'provided') return undefined
  return { status, ...(typeof row.installedVersion === 'string' ? { installedVersion: row.installedVersion } : {}) }
}

function marketEntryOf(value: unknown): DshMarketListingEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.name !== 'string' || row.name.trim() === '') return undefined
  const versions = Array.isArray(row.versions)
    ? row.versions.flatMap((version): DshMarketListingVersion[] => {
      const parsed = marketVersionOf(version)
      return parsed === undefined ? [] : [parsed]
    })
    : []
  const title = marketText(row.title), description = marketText(row.description)
  const author = typeof row.author === 'string' && row.author.trim() !== '' ? row.author.trim().slice(0, 300) : undefined
  const homepage = typeof row.homepage === 'string' && /^https?:\/\//i.test(row.homepage) ? row.homepage.slice(0, 1000) : undefined
  const installation = marketInstallationOf(row.installation)
  return { name: row.name,
    versions,
    ...(typeof row.defaultVersion === 'string' && row.defaultVersion !== '' ? { defaultVersion: row.defaultVersion } : {}),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(author === undefined ? {} : { author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(installation === undefined ? {} : { installation }) }
}

function marketPageOf(value: unknown): DshMarketSearchPage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.entries)) return undefined
  if (row.total !== undefined && (typeof row.total !== 'number' || !Number.isFinite(row.total))) return undefined
  if (row.nextOffset !== undefined && row.nextOffset !== null
    && (typeof row.nextOffset !== 'number' || !Number.isFinite(row.nextOffset))) return undefined
  const entries = row.entries.flatMap((entry): DshMarketListingEntry[] => {
    const parsed = marketEntryOf(entry)
    return parsed === undefined ? [] : [parsed]
  })
  const url = typeof row.url === 'string' ? row.url : undefined
  const title = marketText(row.title)
  return { entries, total: typeof row.total === 'number' ? row.total : entries.length, nextOffset: typeof row.nextOffset === 'number' ? row.nextOffset : null,
    ...(url === undefined ? {} : { url }), ...(title === undefined ? {} : { title }) }
}

/** Codes the bundle installer can report; unknown codes are kept bounded. */
const INSTALL_ERROR_CODES = new Set(['management-required', 'unaddressable', 'unknown-plugin', 'invalid-spec',
  'already-installed', 'ambiguous-install', 'not-bundle', 'not-removable', 'stop-profile', 'bundle-in-use',
  'stale-approval', 'incompatible-version', 'unsupported-platform', 'operation-error'])

function installResultOf(value: unknown): DshBundleInstallResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const application = row.application
  if (application !== 'applied' && application !== 'restart-required' && application !== 'failed'
    && application !== 'cancelled' && application !== 'overridden') return undefined
  let error: DshBundleInstallResult['error']
  if (row.error !== undefined) {
    if (typeof row.error !== 'object' || row.error === null) return undefined
    const cause = row.error as Record<string, unknown>
    const code = typeof cause.code === 'string' ? cause.code.replace(/[^\x20-\x7E]/gu, '').slice(0, 64) : undefined
    if (cause.code !== undefined && (code === undefined || code === '')) return undefined
    // Only the bounded, known code is kept: diagnostics may quote package output.
    if (code !== undefined && INSTALL_ERROR_CODES.has(code)) error = { code }
  }
  const pendingBuilds = Array.isArray(row.pendingBuilds)
    ? row.pendingBuilds.flatMap((name: unknown): string[] => typeof name === 'string' && name.trim() !== '' ? [name.trim().slice(0, 300)] : [])
    : undefined
  const restartReason = typeof row.restartReason === 'string' ? row.restartReason.slice(0, 100) : undefined
  const stage = typeof row.stage === 'string' ? row.stage.slice(0, 40) : undefined
  const target = typeof row.target === 'string' ? row.target.slice(0, 500) : undefined
  const bundle = typeof row.bundle === 'string' && row.bundle !== '' ? row.bundle.slice(0, 500) : undefined
  const version = typeof row.version === 'string' && row.version !== '' ? row.version.slice(0, 200) : undefined
  return { changed: typeof row.changed === 'boolean' ? row.changed : application === 'applied',
    application,
    ...(stage === undefined ? {} : { stage }),
    ...(target === undefined ? {} : { target }),
    ...(restartReason === undefined ? {} : { restartReason }),
    ...(bundle === undefined ? {} : { bundle }),
    ...(version === undefined ? {} : { version }),
    ...(pendingBuilds === undefined ? {} : { pendingBuilds }),
    ...(error === undefined ? {} : { error }) }
}

/** The profile mutation outcome `pluginManager/setBundleEnabled` returns. */
export interface DshBundleChange {
  changed: boolean
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  restartReason?: string
  stage?: string
  target?: string
  enabled?: boolean
  /** alpha2: which stage failed, for a failed change. */
  failedAt?: 'registry' | 'spec-host'
  error?: { code?: string }
}

/** Control characters are unsafe in display text; other script systems are not. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g

/** Bounded display text from runtime package metadata; control characters are dropped. */
function bundleText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(CONTROL_CHARACTERS, '').trim()
  return text === '' ? undefined : text.slice(0, limit)
}

/** Bound a wire version string, preserving an intentionally empty value (`updateBundle.from`). */
function bundleVersionText(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' ? value.replace(CONTROL_CHARACTERS, '').trim().slice(0, limit) : undefined
}

/**
 * Read one `IncompatiblePlugin` the wire reports as a single object.
 *
 * The contract's `requirements` map is retained bounded for callers that show
 * the rejected ranges; registry and diagnostic fields are absent from the wire
 * object and never fabricated here.
 */
function incompatiblePluginOf(value: unknown): DshIncompatiblePlugin | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const name = bundleText(row.name, 300), version = bundleText(row.version, 128), runtimeVersion = bundleText(row.runtimeVersion, 128)
  if (name === undefined || version === undefined || runtimeVersion === undefined) return undefined
  let requirements: Record<string, string> | undefined
  if (typeof row.requirements === 'object' && row.requirements !== null && !Array.isArray(row.requirements)) {
    const entries = Object.entries(row.requirements as Record<string, unknown>).flatMap(([key, range]): [string, string][] => {
      const label = key.replace(CONTROL_CHARACTERS, '').trim(), value = typeof range === 'string' ? range.replace(CONTROL_CHARACTERS, '').trim() : ''
      return label === '' || value === '' || label === '__proto__' || label === 'constructor' || label === 'prototype' ? [] : [[label.slice(0, 200), value.slice(0, 200)]]
    }).slice(0, 20)
    if (entries.length > 0) requirements = Object.fromEntries(entries)
  }
  return { name, version, runtimeVersion, ...(requirements === undefined ? {} : { requirements }) }
}

/** Read one mutation outcome, keeping only the bounded, known error code. */
function bundleChangeOf(value: unknown): DshBundleChange | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const application = row.application
  if (application !== 'applied' && application !== 'restart-required' && application !== 'overridden'
    && application !== 'failed' && application !== 'cancelled') return undefined
  let error: DshBundleChange['error']
  if (row.error !== undefined) {
    if (typeof row.error !== 'object' || row.error === null) return undefined
    const cause = row.error as Record<string, unknown>
    const code = bundleText(cause.code, 64)
    if (cause.code !== undefined && code === undefined) return undefined
    if (code !== undefined && INSTALL_ERROR_CODES.has(code)) error = { code }
  }
  const restartReason = bundleText(row.restartReason, 100)
  const stage = bundleText(row.stage, 40)
  const target = bundleText(row.target, 500)
  const failedAt = row.failedAt
  return { changed: typeof row.changed === 'boolean' ? row.changed : application === 'applied',
    application,
    ...(stage === undefined ? {} : { stage }),
    ...(target === undefined ? {} : { target }),
    ...(restartReason === undefined ? {} : { restartReason }),
    ...(typeof row.enabled === 'boolean' ? { enabled: row.enabled } : {}),
    ...(failedAt === 'registry' || failedAt === 'spec-host' ? { failedAt } : {}),
    ...(error === undefined ? {} : { error }) }
}

/** Read one published-version row; registry URLs and raw reasons never enter it. */
function bundleVersionOf(value: unknown): DshBundleVersion | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const version = bundleText(row.version, 128)
  if (version === undefined || !/^[0-9A-Za-z.+_-]+$/.test(version)) return undefined
  const publishedAt = typeof row.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z?$/.test(row.publishedAt)
    ? row.publishedAt.slice(0, 64) : undefined
  const tags = Array.isArray(row.tags)
    ? row.tags.flatMap((tag): string[] => { const text = bundleText(tag, 64); return text === undefined ? [] : [text] }).slice(0, 20)
    : []
  const deprecated = bundleText(row.deprecated, 300)
  // The rc.1 wire schema declares one object, not an array; a legacy array is
  // not a shape this client may present as a compatibility verdict.
  const incompatible = incompatiblePluginOf(row.incompatible)
  return { version, tags, prerelease: row.prerelease === true, bundle: row.bundle === true,
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(deprecated === undefined ? {} : { deprecated }),
    ...(incompatible === undefined ? {} : { incompatible }) }
}

/** Read a version list; a refused read keeps only its classified problem. */
function bundleVersionListOf(value: unknown): DshBundleVersionList | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (row.status === 'refused') {
    const problem = row.problem
    if (problem !== 'network' && problem !== 'unknown' && problem !== 'not-found' && problem !== 'not-updatable') return undefined
    return { status: 'refused', problem }
  }
  if (row.status !== 'listed') return undefined
  const installed = bundleText(row.installed, 128)
  if (installed === undefined || !Array.isArray(row.versions)) return undefined
  const versions = row.versions.flatMap((entry): DshBundleVersion[] => { const parsed = bundleVersionOf(entry); return parsed === undefined ? [] : [parsed] })
  const omitted = typeof row.omitted === 'number' && Number.isSafeInteger(row.omitted) && row.omitted >= 0 ? row.omitted : 0
  return { status: 'listed', installed, versions, omitted }
}

/** Read an update outcome, including the recovery reinstallation when present. */
function bundleUpdateResultOf(value: unknown): DshBundleUpdateResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  // A refused target check reports `from: ''` because no installed version was
  // resolved; that is a valid answer, not a malformed one.
  const from = bundleVersionText(row.from, 128)
  const to = bundleVersionText(row.to, 128)
  const step = row.step
  if (from === undefined || to === undefined || (step !== 'remove' && step !== 'check' && step !== 'install')) return undefined
  const result = bundleChangeOf(row.result)
  if (result === undefined) return undefined
  const restore = row.restore === undefined ? undefined : bundleChangeOf(row.restore)
  return { from, to, step, result, ...(restore === undefined ? {} : { restore }) }
}

/** One package the running DSH version rejects, as `PluginVersion` reports it. */
export interface DshIncompatiblePlugin {
  name: string
  version: string
  runtimeVersion: string
  /** Only the requirements the running version does not satisfy, keyed `engines.dsh` or by DSH peer name. */
  requirements?: Record<string, string>
}

/**
 * One published version of an updatable third-party bundle, reduced to the
 * facts a picker may show.
 *
 * The wire row also carries dist-tags, a deprecation message, and compatibility
 * requirements; registry URLs, attempt reasons and raw package-manager output
 * are deliberately absent, because they may quote local paths and are never
 * needed to choose a version.
 */
export interface DshBundleVersion {
  version: string
  publishedAt?: string
  tags: string[]
  prerelease: boolean
  deprecated?: string
  /** Whether the version declares a `dsh.bundle`; a version without one cannot replace a bundle. */
  bundle: boolean
  /** Present when the version's engines/peers reject the running DSH version. */
  incompatible?: DshIncompatiblePlugin
}

/**
 * `pluginManager/listVersions`: versions newer than the installed one, or why
 * the registry read was refused.
 */
export type DshBundleVersionList =
  | { status: 'listed'; installed: string; versions: DshBundleVersion[]; omitted: number }
  | { status: 'refused'; problem: 'network' | 'unknown' | 'not-found' | 'not-updatable' }

/** Optional arguments shared by `listVersions` and `updateBundle`. */
export interface DshBundleUpdateOptions {
  registry?: string
  requestId?: string
}

/**
 * The update outcome `pluginManager/updateBundle` reports.
 *
 * `restore` is the reinstallation of the previous version the runtime performs
 * when an HMR profile update fails or is cancelled; it is present exactly when
 * that recovery ran. Diagnostics and package-manager output stay out of this
 * type for the same reason as {@link DshBundleInstallResult}.
 */
export interface DshBundleUpdateResult {
  from: string
  to: string
  step: 'remove' | 'check' | 'install'
  result: DshBundleChange
  restore?: DshBundleChange
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Providers the cot-translation Host can route through. */
export const TRANSLATION_PROVIDERS = ['google', 'bing', 'deepseek-account', 'deepseek-official'] as const
export type DshTranslationProvider = (typeof TRANSLATION_PROVIDERS)[number]

/** `cotTranslation/limits`: the preference and the per-request text ceiling. */
export interface DshTranslationLimits {
  maxTextChars: number
  preferences: { provider: DshTranslationProvider; targetLanguage: string }
  availableProviders: DshTranslationProvider[]
}

/** One `cotTranslation/translate` request; the Host normalizes the language tag. */
export interface DshTranslationRequest {
  text: string
  targetLanguage: string
  provider?: DshTranslationProvider
  sessionId?: string
}

/** The Host's provider vocabulary; anything else is not a routable translation provider. */
function isTranslationProvider(value: unknown): value is DshTranslationProvider {
  return typeof value === 'string' && (TRANSLATION_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Validate a `cotTranslation/limits` answer.
 *
 * This is an optional capability read, so an unusable answer means "no
 * translation" rather than an error the UI has to explain.
 */
function translationLimitsOf(value: unknown): DshTranslationLimits | undefined {
  if (!wireRecord(value)) return undefined
  const limits = value
  const maxTextChars = typeof limits.maxTextChars === 'number' && Number.isFinite(limits.maxTextChars) && limits.maxTextChars > 0
    ? limits.maxTextChars
    : undefined
  const preferences = wireRecord(limits.preferences) ? limits.preferences : undefined
  const provider = preferences !== undefined && isTranslationProvider(preferences.provider) ? preferences.provider : undefined
  const targetLanguage = preferences !== undefined && typeof preferences.targetLanguage === 'string'
    && preferences.targetLanguage.trim() !== '' ? preferences.targetLanguage : undefined
  const reported = limits.availableProviders
  if (!Array.isArray(reported) || !reported.every(item => typeof item === 'string')) return undefined
  if (maxTextChars === undefined || provider === undefined || targetLanguage === undefined) return undefined
  return { maxTextChars, preferences: { provider, targetLanguage }, availableProviders: reported.filter(isTranslationProvider) }
}

/**
 * Validate the business result of `sessionFeedback/record`.
 *
 * Like the message ratings, the answer is an `{ok}` union carried inside the
 * transport's value slot, so a refusal is a value that must become a rejection.
 * Only envelope fields are read here: the feedback text cannot reach a message
 * built by this function, so it cannot reach a log through one either.
 */
function recordedSessionFeedback(result: unknown): { recorded: true } {
  if (!wireRecord(result)) {
    throw new DshConnectionError('invalid-response', 'DSH returned an unexpected session feedback result.')
  }
  if (result.ok === true) {
    const value = result.value
    if (wireRecord(value) && value.recorded === true) return { recorded: true }
    throw new DshConnectionError('invalid-response', 'DSH did not confirm the session feedback was recorded.')
  }
  if (result.ok === false) {
    const error = result.error
    const code = wireRecord(error) && typeof error.code === 'string' && error.code !== '' ? error.code : 'unknown'
    if (code === 'session-not-found') {
      throw new DshConnectionError('session-not-found', 'This conversation no longer exists in the runtime, so the feedback was not recorded.')
    }
    throw new DshConnectionError(code, `DSH did not record the session feedback (${code}).`)
  }
  throw new DshConnectionError('invalid-response', 'DSH returned an unexpected session feedback result.')
}

export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint: string; images?: boolean; attachments?: boolean }
}

export interface CommandExecution {
  commandId: string
  result: {
    kind: 'success' | 'error'
    text?: string
    sourceEventSeq?: number
  }
}

export interface SkillDescriptor {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

export interface AgentPresetDescriptor {
  id: string
  trust: 'system' | 'user'
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

export interface AgentPresetRoster {
  presets: AgentPresetDescriptor[]
  authorable: boolean
  hasDocument: boolean
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface PromptImage {
  type: 'image'
  mediaType: ImageMediaType
  data: string
  name?: string
}

export interface ImageAttachment {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

/**
 * The reference `session/attachment` accepts.
 *
 * rc.2/rc.3 require only the id; alpha2 validates the full reference (media
 * type, byte length and dimensions). The client sends both in one request.
 */
export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: ImageMediaType
  bytes?: number
  width: number
  height: number
  name?: string
  originalDimensions?: { width: number; height: number }
}

/**
 * One arbitrary file already staged by `fileUploads/upload`. The Host resolves
 * the receipt back into a durable attachment, so the prompt only carries the
 * receipt and never the bytes.
 */
export interface PromptFile {
  type: 'file'
  receiptId: string
}

/** Durable receipt for one staged file upload, scoped to the receiving Session. */
export interface FileUploadReceipt {
  receiptId: string
  file: { attachmentId: string; name: string; bytes: number }
}

export type PromptAttachment = PromptImage | PromptFile

export type PromptMode = 'queue' | 'steer'

export type QueueAction =
  | { kind: 'edit'; content: Array<{ type: 'text'; text: string }> }
  | { kind: 'remove' }
  | { kind: 'steer' }

export interface RpcReceipt {
  accepted: boolean
  reason?: 'not-pending' | 'bad-response'
}

export interface ModelOption extends ModelSelection {
  label: string
}

/** DSH's rating vocabulary for one message. */
export type MessageFeedbackRating = 'positive' | 'negative'

/** One recorded rating; `version` is the token a change or a withdrawal must quote. */
export interface MessageFeedbackItem {
  messageId: string
  rating: MessageFeedbackRating
  version: number
  createdAt: number
  updatedAt: number
}

/**
 * DSH answers these calls with a result of their own, so a rejection is a value.
 * `current` on a conflict is the authoritative item, which is what the caller
 * needs to retry against.
 */
export type MessageFeedbackOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message?: string; current?: MessageFeedbackItem | null } }

/**
 * DSH's Session-level feedback vocabulary.
 *
 * The seven categories are the whole accepted set; the Host offers them verbatim
 * so a label choice always maps to one of these wire values.
 */
export type SessionFeedbackCategory =
  | 'other'
  | 'task-result'
  | 'instruction-following'
  | 'product-interaction'
  | 'service-stability'
  | 'resource-cost'
  | 'security-privacy-permission'

/** One Session-level feedback entry. Empty text is encoded by omission. */
export interface SessionFeedbackRequest {
  text?: string
  category?: SessionFeedbackCategory
}

export interface SessionModels {
  current: ModelSelection
  /** Whether the *selected* provider can route — a send depends on this one. */
  routable: boolean
  /**
   * Whether *any* provider can route. Separate from `routable` because the two
   * answer different questions: a conversation whose selected model went away
   * cannot send, but the model picker must stay usable so the user can switch.
   */
  anyRoutable: boolean
  groups: Array<{
    id: string
    name: string
    models: Array<{
      id: string
      name: string
      reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }
    }>
  }>
  failures: Array<{ id: string; name: string; message: string }>
}

export type DshFrame =
  | { channel: 'mux'; rpcId: string; payload: Record<string, unknown> }
  | { channel: 'host'; rpcId: string; payload: Record<string, unknown> }

/** Error codes a typert boundary uses when it refuses a request shape. */
const SCHEDULE_SHAPE_CODES: ReadonlySet<string> = new Set(['gateway/input-invalid', 'gateway/arguments-invalid'])
/** Wording typert uses when the refusal is about the request shape. */
const SCHEDULE_SHAPE_WORDING = ['wire field', 'boundary validation', 'args fields do not match', 'descriptor', 'invalid request', 'request shape']

/**
 * Whether a rejected `schedule/history` call only rejected the alpha.3 request.
 *
 * alpha.3 addresses a reminder by `id`; alpha.2 requires the owning conversation
 * in `sessionId` and its typert boundary refuses the newer descriptor. The real
 * alpha.2 refusal is `gateway/input-invalid` with
 * `typert gateway: schedule/history: wire field "request" failed boundary
 * validation`; other runtime versions used `gateway/arguments-invalid` and named
 * the missing `sessionId` instead. Only a boundary/shape refusal for this exact
 * endpoint may be retried with the legacy request: transport, authentication,
 * cancellation and business failures are reported unchanged.
 */
function legacyScheduleHistoryShape(error: unknown): boolean {
  if (!(error instanceof DshConnectionError) || !SCHEDULE_SHAPE_CODES.has(error.code)) return false
  const message = error.message.toLowerCase()
  // A shape failure of another endpoint says nothing about this request.
  if (!message.includes('schedule/history')) return false
  return SCHEDULE_SHAPE_WORDING.some(wording => message.includes(wording))
}

interface ModelCatalog {
  default: ModelSelection
  routableProviders: string[]
  groups: SessionModels['groups']
  failures: SessionModels['failures']
}

/** The sidebar uses only authenticated 0.1.2 Remotes. */
export class DshClient {
  private readonly commandTransport = new DshCommandTransport((endpoint, args, timeoutMs) => this.call(endpoint, args, timeoutMs))
  private readonly api: DshRemoteApi
  private readonly feed: DshSessionFeed
  private readonly observers = new Set<DshSessionFeed>()
  private readonly lifetime = new AbortController()
  private readonly frameListeners = new Set<(frame: DshFrame) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly catalog: RemoteRead<ModelCatalog>
  private readonly commands = new Map<string, RemoteRead<CommandDescriptor[]>>()
  private readonly skills = new Map<string, RemoteRead<SkillDescriptor[]>>()
  private readonly presets: RemoteRead<AgentPresetRoster>

  constructor(private readonly connection: DshConnection, requestSessions: readonly string[] = []) {
    this.api = new DshRemoteApi(connection, this.lifetime.signal)
    this.catalog = new RemoteRead(() => this.call('session/modelCatalog', {}), this.lifetime.signal)
    this.presets = new RemoteRead(() => this.call('agentPresets/list', {}, 10_000), this.lifetime.signal)
    this.feed = new DshSessionFeed(connection,
      frame => {
        this.invalidateDiscovery(frame)
        for (const listener of this.frameListeners) listener(frame)
      },
      error => { for (const listener of this.errorListeners) listener(error) })
    for (const sessionId of requestSessions) this.feed.handleRequestsFor(sessionId)
  }

  get handledSessionIds(): string[] { return this.feed.handledSessionIds }
  watchRequests(sessionId: string): void { this.feed.handleRequestsFor(sessionId) }

  monitorJobs(sessionIds: readonly string[], refresh = false): void { this.feed.monitorJobs(sessionIds, refresh) }
  observeJob(sessionId: string, jobId: string, from: number, item: (frame: Record<string, unknown>) => void, fail: (error: Error) => void): () => void {
    return this.feed.observeJob(sessionId, jobId, from, item, fail)
  }
  pendingRequests(sessionId: string): Array<{ rpcId: string; event: string; request: Record<string, unknown> }> {
    return this.feed.pendingRequests(sessionId)
  }
  /** Independent read reference; it never replaces the main conversation's follow. */
  observeSession(sessionId: string, parentSessionId: string | undefined, emit: (frame: DshFrame) => void, fail: (error: Error) => void): {
    opening: Promise<SessionOpening>; page: (beforeSeq: number) => Promise<{ events: HistoryEntry[]; hasMore: boolean }>; dispose: () => void
  } {
    this.lifetime.signal.throwIfAborted()
    const observer = new DshSessionFeed(this.connection, emit, fail)
    this.observers.add(observer)
    return { opening: observer.open(sessionId, parentSessionId), page: beforeSeq => observer.page(sessionId, beforeSeq),
      dispose: () => { if (this.observers.delete(observer)) observer.dispose() } }
  }
  async goal(sessionId: string): Promise<GoalView | null> {
    const value = await this.call('goals/get', { agentId: sessionId }, 10_000), goal = goalOf(value)
    if (value !== null && value !== undefined && goal === null) throw new Error('Invalid goal returned by DSH.')
    return goal
  }
  async changeGoal(sessionId: string, action: 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'clear', ref?: { id: string; revision: number }, request?: { objective?: string; maxGoalRounds?: number }): Promise<void> {
    await this.call(`goals/${action}`, { agentId: sessionId, ...(action === 'create' || ref === undefined ? {} : { ref }), ...(request === undefined ? {} : { request }) })
  }
  async schedules(): Promise<ScheduleEntry[]> { return schedulesOf(await this.call('schedule/catalog', {}, 10_000)) }
  /**
   * Read one reminder's saved deliveries.
   *
   * alpha.3 addresses the task by id and pages with `before`; alpha.2 required
   * the owning conversation, so its request shape is retried only when the
   * runtime rejects the newer descriptor. `sessionId` is the legacy fallback
   * hint and may be unknown for a `new` target.
   */
  async scheduleHistory(sessionId: string | undefined, id: string, before?: string): Promise<unknown> {
    const page = { id, limit: 20, ...(before === undefined ? {} : { before }) }
    try { return await this.call('schedule/history', { request: page }, 10_000) }
    catch (error) {
      if (sessionId === undefined || sessionId === '' || !legacyScheduleHistoryShape(error)) throw error
      return this.call('schedule/history', { request: { sessionId, ...page } }, 10_000)
    }
  }
  /** Deliver one reminder now without consuming or moving its next occurrence. */
  scheduleRun(id: string): Promise<unknown> {
    return this.call('schedule/run', { request: { id } }, 10_000)
  }
  /**
   * Pause, resume, retime or delete one reminder.
   *
   * DSH alpha.3 replaced the old `schedule/delete`/`schedule/update` endpoints
   * with this closed edit operation; `expectedUpdatedAt` is the stored revision
   * the caller read and makes a stale edit a `schedule_conflict` instead of a
   * silent overwrite. An update patch may name a title, a prompt, a timing rule
   * or the active flag, all in one atomic write.
   */
  scheduleEdit(id: string, edit: { action: 'update'; patch: ScheduleUpdatePatch; expectedUpdatedAt?: string }
    | { action: 'delete'; expectedUpdatedAt?: string }): Promise<unknown> {
    return this.call('schedule/edit', { request: { id, ...edit } }, 10_000)
  }
  /** Create one reminder; DSH answers with its stored catalog entry. */
  createSchedule(request: ScheduleCreateRequest): Promise<unknown> {
    return this.call('schedule/create', { request }, 10_000)
  }
  /** Remove every ended reminder; answers `{ deleted: number }`. */
  scheduleDeleteInactive(): Promise<unknown> {
    return this.call('schedule/deleteInactive', {}, 10_000)
  }
  searchHistory(query: string): Promise<{ items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean }> {
    return this.call('session/search', { request: { query } }, 10_000)
  }

  onFrame(listener: (frame: DshFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }
  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => { this.errorListeners.delete(listener) }
  }
  async startStreams(): Promise<void> {
    await this.feed.start()
    // Reads made before the event subscription may have missed a Host commit.
    this.catalog.invalidate()
    this.presets.invalidate()
    for (const read of [...this.commands.values(), ...this.skills.values()]) read.invalidate()
  }
  /**
   * Open one conversation.
   * @param parentSessionId - owning conversation when this session is a
   *   subagent child, which DSH requires in the address instead of a plain id.
   */
  openSession(sessionId: string, parentSessionId?: string): Promise<SessionOpening> {
    this.presets.invalidate()
    this.invalidateSessionDiscovery(sessionId)
    return this.feed.open(sessionId, parentSessionId)
  }
  async listSessions(): Promise<{ items: SessionSummary[] }> {
    const revision = this.feed.listRevision
    const result = await this.api.listSessions()
    return { items: this.feed.summaries(result.items, revision) }
  }
  listWorkspaces(): Promise<{ archivedSessionIds: string[]; pinnedSessionIds: string[]; pinningAvailable: boolean }> { return this.feed.listWorkspaces() }
  /** Read cold catalog metadata without opening an Agent or fetching history. */
  sessionProjections(sessionId: string): Promise<SessionProjectionRead> { return this.feed.readProjections(sessionId, this.lifetime.signal) }
  adoptSessionProjections(sessionId: string, seq: number, values: Record<string, unknown>): Record<string, unknown> {
    return this.feed.adoptProjections(sessionId, seq, values)
  }
  renameSession(sessionId: string, title: string): Promise<{ title: string; seq?: number }> { return this.api.renameSession(sessionId, title) }
  /**
   * Archive one conversation.
   *
   * `stopActivity` tells DSH alpha.3 to stop the conversation's running work
   * instead of refusing the archive with `workspace/session-active`: its turn,
   * subagent descendants, owned jobs, and active schedules. The caller decides
   * when that is safe; the runtime stops them through the same paths as the
   * user's own stop actions.
   */
  archiveSession(sessionId: string, stopActivity = false): Promise<{ archivedSessionIds: string[] }> {
    return this.call('workspace/archiveSession', { request: { sessionId, ...(stopActivity ? { stopActivity: true } : {}) } })
  }
  /** DSH answers with the same `WorkspaceArchiveValue` shape as archiving does. */
  unarchiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
    return this.call('workspace/unarchiveSession', { request: { sessionId } })
  }
  /** Pin a conversation; the answer is the whole ordered pin list. */
  pinSession(sessionId: string): Promise<{ pinnedSessionIds: string[] }> {
    return this.call('workspace/pinSession', { request: { sessionId } })
  }
  /** Unpin a conversation; the answer is the whole ordered pin list. */
  unpinSession(sessionId: string): Promise<{ pinnedSessionIds: string[] }> {
    return this.call('workspace/unpinSession', { request: { sessionId } })
  }
  /** Requests one background job stop; the `job/list` stream converges the row. */
  killJob(sessionId: string, jobId: string): Promise<{ outcome: 'requested' | 'already-finished' }> {
    return this.call('job/kill', { request: { sessionId, jobId } })
  }
  createSession(cwd: string): Promise<{ sessionId: string; agentPreset?: string }> { return this.api.createSession(cwd) }
  history(sessionId: string, beforeSeq: number): Promise<{ events: HistoryEntry[]; hasMore: boolean }> { return this.feed.page(sessionId, beforeSeq) }

  async models(sessionId: string): Promise<SessionModels> {
    await this.catalog.read()
    return this.currentModels(sessionId) as SessionModels
  }
  currentModels(sessionId: string): SessionModels | undefined {
    const catalog = this.catalog.current
    if (catalog === undefined) return undefined
    const projection = this.feed.projectionValues(sessionId).modelSelection
    const candidate = wireRecord(projection) ? projection.next ?? projection.lastUsed : undefined
    const current: ModelSelection = wireRecord(candidate) && typeof candidate.provider === 'string' && typeof candidate.model === 'string'
      ? { provider: candidate.provider, model: candidate.model, ...(typeof candidate.reasoningEffort === 'string' ? { reasoningEffort: candidate.reasoningEffort } : {}) }
      : catalog.default
    return {
      current,
      routable: catalog.routableProviders.includes(current.provider),
      anyRoutable: catalog.routableProviders.length > 0,
      groups: catalog.groups,
      failures: catalog.failures,
    }
  }

  /**
   * Read one stored image.
   *
   * The request is a superset for two generations of the RPC: rc.2/rc.3 require
   * `attachmentId` and strip the nested reference; alpha2 requires the complete
   * `attachment` ref and ignores the legacy id. A reference that predates the
   * stored byte length is still sent in the legacy shape, where the runtime may
   * refuse it.
   */
  attachment(sessionId: string, image: ImageAttachmentRef): Promise<{ attachment: ImageAttachment; data: string }> {
    return this.call('session/attachment', {
      request: {
        sessionId,
        attachmentId: image.attachmentId,
        attachment: {
          attachmentId: image.attachmentId,
          mediaType: image.mediaType,
          ...(image.bytes === undefined ? {} : { bytes: image.bytes }),
          width: image.width,
          height: image.height,
          ...(image.name === undefined ? {} : { name: image.name }),
          ...(image.originalDimensions === undefined ? {} : { originalDimensions: image.originalDimensions }),
        },
      },
    }, 30_000, MAX_ATTACHMENT_RESPONSE_BYTES)
  }
  /**
   * Stage one arbitrary file for the next prompt. Mirrors the browser client's
   * upload fallback, so a wire caller never has to reach the HTTP route.
   */
  uploadFile(sessionId: string, data: string, name?: string): Promise<FileUploadReceipt> {
    return this.call('fileUploads/upload', {
      agentId: sessionId,
      request: { data, ...(name === undefined || name === '' ? {} : { name }) },
    }, 300_000)
  }
  /**
   * Read one session's message ratings.
   *
   * The business result is itself an `{ok}` union, so the outer envelope `call`
   * unwraps is not the answer: a failure arrives as a value, not a rejection.
   */
  messageFeedback(sessionId: string): Promise<MessageFeedbackOutcome<{ items: MessageFeedbackItem[] }>> {
    return this.call('messageFeedback/list', { request: { sessionId } })
  }

  /** Record a rating. `ifVersion: null` claims the message has none yet. */
  putMessageFeedback(sessionId: string, messageId: string, rating: MessageFeedbackRating,
    ifVersion: number | null): Promise<MessageFeedbackOutcome<MessageFeedbackItem>> {
    return this.call('messageFeedback/put', { request: { sessionId, messageId, rating, ifVersion } })
  }

  /** Withdraw a rating, guarded by the version being withdrawn. */
  deleteMessageFeedback(sessionId: string, messageId: string,
    ifVersion: number): Promise<MessageFeedbackOutcome<{ absent: true }>> {
    return this.call('messageFeedback/delete', { request: { sessionId, messageId, ifVersion } })
  }

  /**
   * Record one Session-level feedback entry.
   *
   * The request text is free-form user content: it is trimmed for the wire (an
   * empty text is omitted, per the contract) and is never logged here. Feedback
   * starts no model turn and interrupts none, so this call changes no session
   * state; the returned confirmation is the whole result.
   */
  async recordSessionFeedback(sessionId: string, request: SessionFeedbackRequest = {}): Promise<{ recorded: true }> {
    const text = typeof request.text === 'string' ? request.text.trim() : ''
    const value = await this.call<unknown>('sessionFeedback/record', {
      request: {
        sessionId,
        ...(text === '' ? {} : { text }),
        ...(request.category === undefined ? {} : { category: request.category }),
      },
    })
    return recordedSessionFeedback(value)
  }

  /**
   * Copy the conversation up to an event seq into a new one.
   *
   * `atSeq` is an inclusive cut; omitting it takes the last completed turn. The
   * child is identified only by the id returned here.
   */
  async forkSession(sessionId: string, atSeq?: number): Promise<string> {
    const value = await this.call<{ sessionId: string }>('session/fork', {
      request: { sessionId, ...(atSeq === undefined ? {} : { atSeq }) },
    })
    return value.sessionId
  }

  /**
   * Read the complete transcript as Markdown from the runtime's export route.
   *
   * The runtime formats the document, so the output matches its own copy
   * command, including the original log path. The read is an authenticated GET
   * outside the RPC contract; a runtime that does not serve it raises
   * `session-export-unavailable`, which the caller presents as "not supported".
   */
  async sessionMarkdown(sessionId: string): Promise<string> {
    return this.connection.readSessionMarkdown(sessionId)
  }

  async pluginInventory(): Promise<PluginInventorySnapshot> {
    const value = await this.call<PluginInventorySnapshot>('pluginInventory/list', {})
    // A runtime that renamed or dropped the array would otherwise throw a
    // TypeError out of a picker, hiding the real message ("inventory
    // unavailable"). An empty list is what the caller can act on.
    return { ...value, entries: Array.isArray(value?.entries) ? value.entries : [] }
  }
  /**
   * Read the profile's bundle layers, including optional bundles that are off.
   *
   * `pluginInventory/list` reports only mounted entries, so this read is the
   * only way the settings page can offer an experimental bundle before it is
   * enabled. A runtime that does not serve the method resolves `undefined`, and
   * the caller keeps the read-only inventory.
   */
  async listBundles(): Promise<DshBundleInfo[] | undefined> {
    try {
      const value = await this.call<unknown>('pluginManager/listBundles', {}, 10_000)
      return Array.isArray(value) ? value.filter(item => typeof item === 'object' && item !== null) as DshBundleInfo[] : undefined
    } catch {
      return undefined
    }
  }
  /**
   * List the published versions newer than one installed third-party bundle.
   *
   * Only a bundle `listBundles` marks `updatable` accepts this read; the
   * runtime answers `refused/not-updatable` for anything else instead of
   * failing, so the caller can show that refusal as copy. The registry that
   * answered is not published to the caller: it is infrastructure detail and
   * its URL may carry credentials.
   */
  async listBundleVersions(name: string): Promise<DshBundleVersionList> {
    if (!/^[A-Za-z0-9@/_.:+~-]{1,512}$/.test(name)) throw new DshConnectionError('invalid-spec', 'Invalid bundle name.')
    const value = await this.call<unknown>('pluginManager/listVersions', { name }, 60_000)
    const list = bundleVersionListOf(value)
    if (list === undefined) throw new DshConnectionError('invalid-response', 'DSH pluginManager/listVersions returned an unexpected result.')
    return list
  }
  /**
   * Replace one installed third-party bundle with a published version.
   *
   * The runtime checks the target first and, on an HMR profile, reinstalls the
   * previous version when the installation fails or is cancelled; `restore`
   * reports that recovery. The caller must confirm before invoking this: the
   * request changes the shared web profile and may stop running plugins.
   */
  async updateBundle(name: string, version: string, options: DshBundleUpdateOptions = {}): Promise<DshBundleUpdateResult> {
    if (!/^[A-Za-z0-9@/_.:+~-]{1,512}$/.test(name)) throw new DshConnectionError('invalid-spec', 'Invalid bundle name.')
    if (!/^[0-9A-Za-z.+_-]{1,128}$/.test(version)) throw new DshConnectionError('invalid-spec', 'Invalid bundle version.')
    const wire = {
      ...(options.registry === undefined || options.registry === '' ? {} : { registry: options.registry }),
      ...(options.requestId === undefined || options.requestId === '' ? {} : { requestId: options.requestId }),
    }
    const value = await this.call<unknown>('pluginManager/updateBundle',
      { name, version, ...(Object.keys(wire).length === 0 ? {} : { options: wire }) }, BUNDLE_INSTALL_TIMEOUT_MS)
    const result = bundleUpdateResultOf(value)
    if (result === undefined) throw new DshConnectionError('invalid-response', 'DSH pluginManager/updateBundle returned an unexpected result.')
    return result
  }
  /**
   * Select or deselect one bundle layer while retaining its installed files.
   *
   * The host serializes profile mutations under a file lock it waits up to
   * 120 s for, and a concurrent install can hold that lock; the client timeout
   * must outlast the host's own wait, or a completed change would be reported
   * as a failure. A late `plugin-manager/changed` still reconciles the UI.
   */
  setBundleEnabled(name: string, enabled: boolean): Promise<DshBundleChange> {
    return this.call<DshBundleChange>('pluginManager/setBundleEnabled', { name, enabled }, 130_000)
  }
  /**
   * List the plugin-market indexes configured in the runtime profile.
   *
   * A runtime without the `plugin-market` service answers HTTP 404; the caller
   * turns that into "enable the bundle or configure an index" rather than a
   * protocol error. A malformed body is refused, never displayed.
   */
  async pluginMarketIndexes(): Promise<DshMarketIndexSummary[]> {
    const value = await this.call<unknown>('pluginMarket/listIndexes', {}, PLUGIN_MARKET_TIMEOUT_MS)
    const indexes = marketIndexesOf(value)
    if (indexes === undefined) throw new DshConnectionError('invalid-response', 'DSH pluginMarket/listIndexes returned an unexpected result.')
    return indexes
  }
  /**
   * Search one configured index for plugins matching free text.
   *
   * The query is fixed to the first page ordered by relevance: the VS Code
   * entry installs one plugin, it does not browse paginated results.
   */
  async pluginMarketSearch(url: string, text: string): Promise<DshMarketSearchPage> {
    const query = {
      ...(text.trim() === '' ? {} : { text: text.trim() }),
      sort: { kind: 'relevance' as const }, offset: 0, limit: 20,
    }
    const value = await this.call<unknown>('pluginMarket/search', { url, query }, PLUGIN_MARKET_TIMEOUT_MS)
    const page = marketPageOf(value)
    if (page === undefined) throw new DshConnectionError('invalid-response', 'DSH pluginMarket/search returned an unexpected result.')
    return page
  }
  /**
   * Install one bundle spec into the runtime profile.
   *
   * The host serializes profile mutations under a file lock it waits up to
   * 120 s for and then runs the package manager, so the client timeout is
   * deliberately longer than either bound. The caller must confirm with the
   * user before invoking this: the request changes the shared web profile.
   */
  async installBundle(spec: string, options: DshBundleInstallOptions = {}): Promise<DshBundleInstallResult> {
    const wire = {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(options.registry === undefined || options.registry === '' ? {} : { registry: options.registry }),
      ...(options.saveExact === undefined ? {} : { saveExact: options.saveExact }),
    }
    const value = await this.call<unknown>('pluginManager/installBundle',
      { spec, ...(Object.keys(wire).length === 0 ? {} : { options: wire }) }, BUNDLE_INSTALL_TIMEOUT_MS)
    const result = installResultOf(value)
    if (result === undefined) throw new DshConnectionError('invalid-response', 'DSH pluginManager/installBundle returned an unexpected result.')
    return result
  }
  /** Origin of the runtime this client is bound to; used for the sign-in callback. */
  get runtimeOrigin(): URL { return this.connection.baseUrl }

  /**
   * Account state. The Host owns the OAuth exchange and never returns a token,
   * so every account call here is safe to publish to the Webview.
   */
  accountState(): Promise<unknown> { return this.call('account/getState', {}, 15_000) }
  accountProfile(client: Record<string, unknown>): Promise<unknown> {
    return this.call('account/getProfile', { client }, 20_000)
  }
  accountBalance(client: Record<string, unknown>): Promise<unknown> {
    return this.call('account/getBalance', { client }, 20_000)
  }
  /**
   * Begin browser sign-in.
   * @param client - identity DSH forwards to the Platform.
   * @param callbackOrigin - loopback HTTP origin the Platform returns the
   *   browser to. DSH accepts only `localhost`/`127.0.0.1` with an explicit port,
   *   which is exactly what VS Code's forwarded URI provides for a remote runtime.
   */
  startAccountSignIn(
    client: Record<string, unknown>,
    callbackOrigin: string,
    loginSource: 'web' | 'desktop',
  ): Promise<unknown> {
    return this.call('account/startSignIn', { client, callbackOrigin, loginSource }, 30_000)
  }
  cancelAccountSignIn(attemptId: string): Promise<unknown> {
    return this.call('account/cancelSignIn', { attemptId }, 20_000)
  }
  signOutAccount(client: Record<string, unknown>): Promise<unknown> {
    return this.call('account/signOut', { client }, 30_000)
  }
  async settings(): Promise<SettingsDescription> {
    const value = await this.call<SettingsDescription>('settings/describe', {})
    return { ...value, namespaces: Array.isArray(value?.namespaces) ? value.namespaces : [] }
  }
  mutateSettings(ns: string, ops: SettingsMutation[], expectedRevision: number): Promise<SettingsNamespace> {
    return this.call('settings/mutate', { ns, ops, expectedRevision })
  }
  listLlmProviders(): Promise<{ id: string; name: string }[]> { return this.call('llm/listProviders', {}) }
  listConfigurableProviders(): Promise<ConfigurableProvider[]> { return this.call('llm/listConfigurableProviders', {}) }
  describeCredentials(refs: string[]): Promise<Record<string, CredentialState>> { return this.call('credentials/describe', { refs }) }
  setCredential(ref: string, value: string): Promise<void> { return this.call('credentials/set', { ref, value }) }
  unsetCredential(ref: string): Promise<void> { return this.call('credentials/unset', { ref }) }
  discoverModels(settingsNs: string, request: ModelDiscoveryRequest, signal?: AbortSignal): Promise<DiscoveredModel[]> {
    return this.connection.call('llm/discoverModels', { settingsNs, request }, 30_000,
      signal ? AbortSignal.any([this.lifetime.signal, signal]) : this.lifetime.signal)
  }
  prompt(
    sessionId: string,
    text: string,
    attachments: readonly PromptAttachment[] = [],
    mode: PromptMode = 'queue',
    parentSessionId?: string,
  ): Promise<{ accepted: true }> {
    this.feed.handleRequestsFor(sessionId)
    return this.api.prompt(sessionId, text, attachments, mode, parentSessionId)
  }
  respond(rpcId: string, value: unknown): Promise<RpcReceipt> { return this.feed.respond(rpcId, value) }
  cancel(sessionId: string): Promise<{ accepted: true }> { return this.api.cancel(sessionId) }
  /**
   * Stop a subagent by naming its parent.
   *
   * `session/cancel` is refused for a session owned by subagent routing
   * (`session/agent-busy`), so a child is interrupted through `subagents/*`.
   * `mode` is a required discriminator, not a claim about the child.
   */
  interruptSubagent(childSessionId: string, parentSessionId: string): Promise<{ accepted: true }> {
    return this.call('subagents/interruptByParent', { childSessionId, parentSessionId, mode: 'continuable' })
  }
  updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<{ accepted: true }> { return this.api.updateQueue(sessionId, itemId, action) }
  selectModel(sessionId: string, selection: ModelSelection): Promise<{ selected: ModelSelection }> {
    return this.call('session/selectModel', { request: { sessionId, ...selection } })
  }
  listCommands(sessionId: string): Promise<CommandDescriptor[]> {
    let read = this.commands.get(sessionId)
    if (read === undefined) {
      read = new RemoteRead(() => this.call('commands/list', { agentId: sessionId }, 10_000), this.lifetime.signal)
      this.commands.set(sessionId, read)
    }
    return read.read()
  }
  listSkills(sessionId: string): Promise<SkillDescriptor[]> {
    let read = this.skills.get(sessionId)
    if (read === undefined) {
      read = new RemoteRead(async () => (await this.call<{ skills: SkillDescriptor[] }>(
        'skills/list', { request: { sessionId } }, 10_000)).skills, this.lifetime.signal)
      this.skills.set(sessionId, read)
    }
    return read.read()
  }
  /**
   * Read the runtime's process-level permission preset catalogue.
   *
   * The `permissions` session projection carries only the current value, so this
   * read is the only way the experimental `auto` preset becomes selectable.
   * Runtimes that do not serve the method, a timeout, or an unparseable answer
   * all resolve `undefined`: the caller keeps the presets DSH ships, and an
   * optional capability read never affects the connection.
   */
  async permissionCatalog(): Promise<PermissionCatalog | undefined> {
    try {
      return permissionCatalogOf(await this.call('permissionPresets/catalog', {}, 10_000))
    } catch {
      return undefined
    }
  }
  listAgentPresets(): Promise<AgentPresetRoster> { return this.presets.read() }
  /**
   * Read the runtime's cot-translation capability.
   *
   * The translation itself is a client-side RPC, so a runtime without the
   * experimental bundle (or with a malformed answer) reports no capability and
   * the sidebar keeps the original reasoning text.
   */
  async cotTranslationLimits(): Promise<DshTranslationLimits | undefined> {
    try {
      return translationLimitsOf(await this.call('cotTranslation/limits', {}, 10_000))
    } catch {
      return undefined
    }
  }
  /** Translate one reasoning fragment; failures are the caller's to explain. */
  async cotTranslationTranslate(request: DshTranslationRequest): Promise<string> {
    const translated = await this.call<unknown>('cotTranslation/translate', {
      request: {
        text: request.text,
        targetLanguage: request.targetLanguage,
        ...(request.provider === undefined ? {} : { provider: request.provider }),
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      },
    }, 60_000)
    if (typeof translated !== 'string' || translated.trim() === '') throw new Error('DSH returned no translated text.')
    return translated
  }
  async selectAgentPreset(sessionId: string, agentPreset: string): Promise<{ agentPreset: string }> {
    const selected = await this.call<string>('agentPresets/select', { agentId: sessionId, agentPreset })
    this.invalidateSessionDiscovery(sessionId)
    return { agentPreset: selected }
  }
  executeCommand(sessionId: string, line: string, attachments: readonly PromptAttachment[] = []): Promise<CommandExecution | undefined> {
    this.feed.handleRequestsFor(sessionId)
    return this.commandTransport.execute(sessionId, line, attachments)
  }
  dispose(): void {
    this.lifetime.abort()
    for (const observer of this.observers) observer.dispose()
    this.observers.clear()
    this.feed.dispose()
    this.frameListeners.clear()
    this.errorListeners.clear()
    this.commands.clear()
    this.skills.clear()
  }
  private invalidateSessionDiscovery(sessionId: string): void {
    this.commands.get(sessionId)?.invalidate()
    this.skills.get(sessionId)?.invalidate()
  }
  private invalidateDiscovery(frame: DshFrame): void {
    const payload = frame.payload
    if (payload.type === 'host/commands-changed') for (const read of this.commands.values()) read.invalidate()
    // A removed session keeps neither its cached catalogs nor its entries: both
    // are re-read if that conversation is opened again.
    if (payload.type === 'host/session-removed' && typeof payload.sessionId === 'string') {
      this.commands.delete(payload.sessionId)
      this.skills.delete(payload.sessionId)
    }
    // `host/account-changed` is how a committed credential arrives: signing in or
    // out changes which providers can route, so the catalog has to be re-read or
    // the composer stays disabled (and, after sign-out, stays wrongly enabled).
    if (payload.type === 'host/models-changed' || payload.type === 'host/settings-changed'
      || payload.type === 'host/credentials-changed' || payload.type === 'host/account-changed') this.catalog.invalidate()
    // The roster lives in the `agent-preset-registry` entry, which is the id DSH
    // reports for its settings section.
    if (payload.type === 'host/settings-changed' && payload.ns === 'agent-preset-registry') this.presets.invalidate()
    if ((payload.type === 'host/session-composition-changed'
      || (payload.type === 'session/projection' && payload.key === 'agentPreset')) && typeof payload.sessionId === 'string') {
      this.invalidateSessionDiscovery(payload.sessionId)
    }
  }
  private call<T>(endpoint: string, args: Record<string, unknown>, timeoutMs = 30_000,
    maxResponseBytes?: number): Promise<T> {
    return this.connection.call(endpoint, args, timeoutMs, this.lifetime.signal, maxResponseBytes)
  }
}
