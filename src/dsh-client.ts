import type { DshConnection } from './dsh-connection.js'
import { MAX_ATTACHMENT_RESPONSE_BYTES } from './dsh-connection.js'
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
import { goalOf, schedulesOf, type GoalView, type ScheduleEntry } from './task-features.js'

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
  /** alpha2: whether the Host lists this bundle by default; undefined on older runtimes. */
  listedByDefault?: boolean
  /** alpha2: whether `pluginManager/updateBundle` accepts this bundle; undefined means unknown. */
  updatable?: boolean
  readOnlyReason?: 'management-required' | 'unaddressable'
  meta?: { title?: unknown; description?: unknown }
  error?: { code?: string }
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
  scheduleHistory(sessionId: string, id: string, before?: string): Promise<unknown> {
    return this.call('schedule/history', { request: { sessionId, id, limit: 20, ...(before === undefined ? {} : { before }) } }, 10_000)
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
  archiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
    return this.call('workspace/archiveSession', { request: { sessionId } })
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
  executeCommand(sessionId: string, line: string, images: readonly PromptImage[] = []): Promise<CommandExecution | undefined> {
    this.feed.handleRequestsFor(sessionId)
    return this.commandTransport.execute(sessionId, line, images)
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
