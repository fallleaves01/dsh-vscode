import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { findVsCodeServer } from './runtime-lifetime.js'
import { nodeProcessProbe } from './runtime-broker.js'
import {
  RuntimeBroker,
  sharedRuntimeDirectory,
  describeDescriptor,
  describeLockHolders,
  sessionLockPaths,
} from './runtime-broker.js'
import { endRecordedRuntime, inspectRecordedRuntime } from './runtime-recovery.js'
import type { SubagentCatalogRead } from './subagent-catalog-state.js'
import { resolveDshHome } from './plugin-profile.js'
import type { TurnTokenUsage } from './token-usage.js'
import { DshConnectionError } from './dsh-connection.js'
import type { MessageFeedbackItem, MessageFeedbackRating } from './dsh-client.js'
import { ConversationProjector, turnFooters, type ConversationImage, type ConversationMessage, type DshEvent } from './conversation.js'
import {
  agentPresetStateOf,
  lockAgentPresetState,
  selectAgentPresetState,
  unavailableAgentPresetState,
  type AgentPresetState,
} from './agent-presets.js'
import {
  permissionConfirmationFor,
  permissionPresetsFromCatalog,
  planModeCommand,
  planModeStateOf,
  planModeWithCommandAvailability,
  typedCommandPermissionPreset,
  type PermissionCatalog,
  type PermissionPresetItem,
  type PlanModeState,
} from './collaboration-state.js'
import { configureApiKey, clearApiKey, watchDebugConfiguration } from './runtime-configuration.js'
import { DiffReviewManager, type ChangedFileGroup } from './diff-review.js'
import { dispatchChangeAction } from './change-actions.js'
import { DebugRuntimeContribution } from './debug-runtime-contribution.js'
import { TaskRuntimeContribution } from './task-runtime-contribution.js'
import { DebugSessionManager } from './debug-session-manager.js'
import { redactDshSecrets } from './runtime-output.js'
import { DirtyFileGuard } from './dirty-file-guard.js'
import { EditorContextBridge } from './editor-context-bridge.js'
import {
  DshClient,
  type CommandDescriptor,
  type DshFrame,
  type DshTranslationLimits,
  type DshTranslationProvider,
  type FileUploadReceipt,
  type HistoryEntry,
  type ImageMediaType,
  type ModelSelection,
  type PromptAttachment,
  type PromptFile,
  type PromptMode,
  type PromptImage,
  type QueueAction,
  type SessionModels,
  type SessionSummary,
  type SkillDescriptor,
} from './dsh-client.js'
import { replaceTextPreservingIdeContext, withIdeContext, type IdeContextReference, type IdeContextSnapshot, type IdeMentionCandidate } from './ide-context.js'
import {
  imageLimitsOf,
  rejectImageAttachments,
  type ImageAttachmentLimits,
  type ImageCandidate,
} from './image-limits.js'
import { jobsSnapshotOf, type JobItem } from './jobs.js'
import { todosOf, type TodoItem } from './task-state.js'
import { agentTeamOf, type AgentTeamView } from './agent-team-state.js'
import { TaskFeatureController, type TaskFeatureState, type GoalAction } from './task-feature-controller.js'
import { emptyGoalState, emptyScheduleState, emptySearchState, workflowsOf, type WorkflowRun } from './task-features.js'
import { TaskPanelManager } from './task-panels.js'
import { queueSnapshotOf, type QueuedCommandItem, type QueueItemState } from './queue.js'
import type { AssistantStreamUpdate } from './dsh-assistant-stream.js'
import { DshRuntime, type RuntimeOwnership, type RuntimeState } from './runtime.js'
import { toolWriteIntents } from './tool-write-guard.js'
import { pageConversationMessage } from './tool-output-page.js'
import { chatHtml } from './webview.js'
import { DshPluginManager } from './plugin-manager.js'
import { SettingsPanelManager } from './settings-panel.js'
import { runtimeIsNotOurs } from './runtime-change.js'
import type { PluginInventorySnapshot } from './plugin-profile.js'
import type { SettingsDescription, SettingsMutation, SettingsNamespace } from './runtime-settings.js'
import { setupKindFor, type SetupKind } from './setup-state.js'
import { earliestHistorySequence, mergeHistoryEntries, unseenHistoryEntries } from './history.js'
import { routeSlashInput, type SlashRoute } from './slash-routing.js'
import { unavailableUsageMeterState, usageMeterStateOf, type UsageMeterState } from './usage-meter.js'
import {
  diffConversationMessages,
  messageForWebview,
  messagesPatchForWebview,
  type ConversationMessagesPatch,
} from './chat-state-patch.js'
import { archivedSessionItems, parentIdOf, sessionItems, sessionTitle, type SessionItem, type SessionAttention } from './session-center.js'
import {
  accountAttemptActive,
  accountAttemptFailed,
  accountClientMetadata,
  accountStateOf,
  accountWalletText,
  unavailableAccountState,
  type AccountState,
} from './account.js'
import {
  CONVERSATION_HELD_TEXT,
  dshErrorText,
  dshFailure,
  isConversationHeld,
  NO_ROUTABLE_PROVIDER_TEXT,
  SELECTED_MODEL_UNAVAILABLE_TEXT,
} from './dsh-errors.js'
import { wireRecord } from './dsh-streams.js'
import type { DshConnection } from './dsh-connection.js'
import { canRetryConnection, reconnectAttempts } from './dsh-reconnect.js'
import { ExistingRuntimeConnectionError, existingRuntimeUrl, type RuntimeTarget } from './runtime-target.js'
import { pickExistingRuntime, pickManagedRuntime } from './runtime-picker.js'

let activeRuntime: DshRuntime | undefined

interface ReasoningEffortItem {
  id: string
  label: string
  selected: boolean
}

interface ModelItem {
  provider: string
  /** The provider's display name, so the picker can name the route it belongs to. */
  providerLabel: string
  model: string
  label: string
  selected: boolean
  reasoningEfforts: ReasoningEffortItem[]
  defaultReasoningEffort?: string
}

interface MessageMetaItem {
  id: string
  /** Unix epoch milliseconds, from the event that produced the message. */
  time: number
  /** Set on the message that carries its turn's action row. */
  turnEnd?: true
  /** The `turn/end` seq a branch from this reply may fork at. */
  forkAtSeq?: number
  /** Whether DSH would offer its branch button on this turn's closing reply. */
  forkable?: boolean
  turnUsage?: TurnTokenUsage
  /** Wall time the completed turn took, in milliseconds; absent when unknown. */
  turnDurationMs?: number
}

interface ApprovalItem {
  rpcId: string
  approvalId: string
  toolName: string
  reason?: string
}

interface QuestionOption {
  label: string
  description?: string
}

interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
}

interface QuestionRequest {
  rpcId: string
  questions: QuestionItem[]
}

interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

interface WorkspacePick extends vscode.QuickPickItem {
  action?: 'switch' | 'open'
  uri?: vscode.Uri
}

export interface ChatViewState extends TaskFeatureState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  statusText: string
  setup: SetupKind
  canReconnect: boolean
  /** Public connection metadata only; authentication URLs never enter the UI. */
  runtimeConnection: { ownership: RuntimeOwnership; pid?: number } | null
  workspaceName: string
  cwd: string
  sessions: SessionItem[]
  subagentCatalogs: Record<string, SubagentCatalogRead>
  archivedSessions: SessionItem[]
  /** Pinned conversation ids, most recently pinned first. */
  pinnedSessionIds: string[]
  /**
   * Whether this runtime serves the pinned-session list. An older workspace
   * frame omits it, and the Webview hides Pin/Unpin rather than pretending the
   * conversation is unpinned.
   */
  pinningAvailable: boolean
  /**
   * Owning conversation when the active session is itself a subagent, else
   * `null`. Never `undefined`: the Webview transport is JSON, which drops
   * undefined properties, so an absent key could never clear a stale owner.
   */
  parentSessionId: string | null
  todos: TodoItem[]
  /**
   * Agent Teams roster and shared task board for this conversation.
   *
   * `null` (never `undefined`) when the `agentTeam` projection is absent, so the
   * JSON transport can clear a stale team after switching conversations.
   */
  team: AgentTeamView | null
  /** DeepSeek account sign-in state for this runtime; carries no credential. */
  account: AccountState
  /** One human line for the account row, derived from {@link account}. */
  accountNotice: string | null
  /** Whether {@link accountNotice} reports a failure the user must act on. */
  accountFailed: boolean
  /** Why the composer is unavailable, when no model can serve a request. */
  routableNotice: string | null
  /**
   * Set while another DSH process owns this conversation.
   *
   * A single-writer conversation that is held elsewhere is a normal state, not a
   * fault: the history is readable and the composer is not. Keeping it in state
   * (rather than as a transcript notice) is what lets the sidebar say so once,
   * offer a way out, and stop repeating it on every open.
   */
  occupancyNotice: string | null
  /** A stop was admitted and the turn has not ended yet. */
  stopping: boolean
  /**
   * A stop was requested and is still being awaited after the short
   * acknowledgement window. The Stop control stays usable so it can be retried.
   */
  cancelRequested: boolean
  sessionId: string
  messages: ConversationMessage[]
  /** Per-message facts for the action row, indexed by message id. */
  messageMeta: MessageMetaItem[]
  /** Ratings already recorded for this conversation, so the row can show its choice. */
  messageFeedback: MessageFeedbackItem[]
  running: boolean
  /**
   * When the sidebar first saw this conversation running, in epoch ms, or 0.
   *
   * DSH's own client shows a live clock for the running turn. The sidebar has no
   * turn-start event to read, so it times what it witnessed: the moment the
   * session was first reported running. A conversation opened mid-turn therefore
   * counts from when it was opened.
   */
  turnStartedAt: number
  /**
   * When the runtime last sent anything for the running turn, in epoch ms, or 0.
   *
   * The clock alone cannot separate a stuck turn from a silent one, because it
   * ticks either way; the age of the newest event is what distinguishes them.
   */
  turnActivityAt: number
  routable: boolean
  /** Whether any provider can route; the model picker stays usable on this. */
  anyRoutable: boolean
  models: ModelItem[]
  approval: ApprovalItem | null
  question: QuestionRequest | null
  commands: CommandDescriptor[]
  skills: SkillDescriptor[]
  agentPreset: AgentPresetState
  usage: UsageMeterState
  imageLimits: ImageAttachmentLimits | undefined
  /**
   * Cot-translation capability of this runtime.
   *
   * `null` means the experimental bundle is not composed (or answered with an
   * unusable shape), so the UI keeps showing the original reasoning text.
   */
  translation: DshTranslationState | null
  permissions: PermissionPresetItem[]
  plan: PlanModeState
  changedFiles: ChangedFileGroup[]
  queue: QueueItemState[]
  /**
   * Slash commands this window is holding until the conversation is idle.
   *
   * Not the runtime's inbox: DSH executes a command immediately and has no way to
   * queue one, and `/compact` refuses outright while an agent is busy. Sending one
   * with Enter therefore holds it here, where the queue dock can show it, delete
   * it, or run it now.
   */
  queuedCommands: QueuedCommandItem[]
  jobs: JobItem[]
  projectJobs: Array<JobItem & { sessionId: string; sessionTitle: string }>
  jobsStatus: string | null
  childReadOnlyReason: string | null
  workflows: WorkflowRun[]
  hasMoreHistory: boolean
  loadingHistory: boolean
}

interface ChatViewStateUpdate {
  patch: Partial<Omit<ChatViewState, 'messages'>>
  messages?: ConversationMessagesPatch
}

/** What the Webview needs to request one reasoning translation. */
export interface DshTranslationState {
  /** The runtime's preferred provider; the Host normalizes it. */
  provider: DshTranslationProvider
  /** Resolved target language (`auto` follows the editor language). */
  targetLanguage: string
  /**
   * Informational: true whenever the runtime serves translation limits.
   *
   * DSH's own client uses `availableProviders` only to annotate its settings
   * form; it never refuses a translate request because a provider is missing
   * from that list. A routing failure is reported by the RPC as
   * `cotTranslation/failed` and shown as a failed translation with Retry, so
   * this field must not gate a request.
   */
  available: boolean
  /** Longest text the runtime accepts in one translate request. */
  maxTextChars: number
}

/**
 * Normalize an editor language tag for the translation service.
 *
 * The service normalizes common regional tags itself, but the sidebar sends the
 * shortened form it already understands (`zh-cn` → `zh`) and never sends empty.
 */
export function normalizedTranslationLanguage(language: string): string {
  const first = language.trim().toLowerCase().split(/[-_]/u)[0] ?? ''
  return first === '' ? 'en' : first
}

/** `auto` follows the editor language; an explicit runtime preference is kept. */
export function translationTargetLanguage(configured: string, editorLanguage: string): string {
  return configured === 'auto' ? normalizedTranslationLanguage(editorLanguage) : configured
}

/** A bare generic translation failure says nothing the UI's fixed copy does not. */
export function translationFailureText(error: unknown): string {
  const text = redactDshSecrets(dshErrorText(error)).slice(0, 300)
  const detail = text
    .replace(/^\s*cotTranslation\/failed\s*:\s*/iu, '')
    .replace(/^\s*Translation failed\s*:\s*/iu, '')
    .trim()
  return detail === '' ? 'Translation failed' : detail
}

function stateUpdate(previous: ChatViewState, next: ChatViewState): ChatViewStateUpdate | undefined {
  const patch: Partial<Omit<ChatViewState, 'messages'>> = {}
  const previousRecord = previous as unknown as Record<string, unknown>
  const nextRecord = next as unknown as Record<string, unknown>
  const patchRecord = patch as Record<string, unknown>
  for (const key of Object.keys(nextRecord)) {
    if (key !== 'messages' && previousRecord[key] !== nextRecord[key]) patchRecord[key] = nextRecord[key]
  }
  const messages = diffConversationMessages(previous.messages, next.messages)
  return Object.keys(patchRecord).length === 0 && messages === undefined
    ? undefined
    : { patch, ...(messages === undefined ? {} : { messages }) }
}

function stateForWebview(state: ChatViewState): ChatViewState {
  return { ...state, messages: state.messages.map(messageForWebview) }
}

function stateUpdateForWebview(update: ChatViewStateUpdate): ChatViewStateUpdate {
  return {
    patch: update.patch,
    ...(update.messages === undefined ? {} : { messages: messagesPatchForWebview(update.messages) }),
  }
}

function initialState(cwd: string): ChatViewState {
  return {
    phase: cwd === '' ? 'error' : 'idle',
    statusText: cwd === '' ? 'Open a project folder to start using DeepSeek Harness.' : 'Connect to DSH to open your conversations. A compatible saved runtime will be reused.',
    setup: setupKindFor(cwd, cwd === '' ? 'error' : 'loading', ''),
    canReconnect: false,
    runtimeConnection: null,
    workspaceName: path.basename(cwd),
    cwd,
    sessions: [],
    subagentCatalogs: {},
    archivedSessions: [],
    pinnedSessionIds: [],
    pinningAvailable: false,
    parentSessionId: null,
    todos: [],
    team: null,
    account: unavailableAccountState(),
    accountNotice: null,
    accountFailed: false,
    routableNotice: null,
    occupancyNotice: null,
    stopping: false,
    cancelRequested: false,
    sessionId: '',
    messages: [],
    messageMeta: [],
    messageFeedback: [],
    running: false,
    turnStartedAt: 0,
    turnActivityAt: 0,
    routable: cwd !== '',
    anyRoutable: cwd !== '',
    models: [],
    approval: null,
    question: null,
    commands: [],
    skills: [],
    agentPreset: unavailableAgentPresetState(),
    usage: unavailableUsageMeterState(),
    imageLimits: undefined,
    translation: null,
    permissions: [],
    plan: planModeStateOf(undefined),
    changedFiles: [],
    queue: [],
    queuedCommands: [],
    jobs: [],
    projectJobs: [], jobsStatus: null, childReadOnlyReason: null, workflows: [],
    goal: emptyGoalState(), schedules: emptyScheduleState(), historySearch: emptySearchState(),
    hasMoreHistory: false,
    loadingHistory: false,
  }
}

export class DshChatController implements vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<ChatViewState>()
  private readonly settingsChanges = new vscode.EventEmitter<void>()
  private readonly projector = new ConversationProjector()
  private client: DshClient | undefined
  private clientDisposables: Array<() => void> = []
  private summaries: SessionSummary[] = []
  private readonly catalogReads = new Map<string, Promise<void>>()
  private _state: ChatViewState
  private generation = 0
  private runtimeSwitchRevision = 0
  private disposed = false
  private activityRevision = 0
  private readonly runtimeActivity = new Map<string, { running: boolean; revision: number }>()
  private sessionLoadGeneration = 0
  private sessionListGeneration = 0
  private readonly discoveryRequests = new Map<string, number>()
  private readonly settingsOwners = new WeakMap<SettingsNamespace, DshClient>()
  private readonly guardedDirtyCalls = new Set<string>()
  private queueRawText = new Map<string, string>()
  private readonly attachmentResults = new Map<string, Pick<ConversationImage, 'data' | 'error'>>()
  private readonly attachmentLoads = new Map<string, Promise<void>>()
  private readonly jobsBySession = new Map<string, JobItem[]>()
  private readonly jobErrors = new Map<string, string>()
  private readonly taskFeatures = new TaskFeatureController(patch => this.publish(patch), () => this.summaries)
  /**
   * Conversations this window was told another DSH process owns.
   *
   * A single-writer conversation held elsewhere is an ordinary state, so it is
   * tracked per conversation and cleared by the first sign that this window can
   * write again — never carried across a fresh open.
   */
  private readonly occupancyHolders = new Set<string>()
  /** Launch URLs the user declined to save, so this window stops asking. */
  private readonly declinedRuntimeUrls = new Set<string>()
  /** Ratings the runtime confirmed for the open conversation, by message id. */
  private readonly feedback = new Map<string, MessageFeedbackItem>()
  /** Confirmed ratings per conversation, so switching back is not another RPC. */
  private readonly feedbackBySession = new Map<string, Map<string, MessageFeedbackItem>>()
  /** Slash commands held until a conversation is idle, in submission order. */
  private readonly queuedCommands = new Map<string, { id: string; text: string; images: readonly PromptImage[] }[]>()
  private drainingCommands = false
  private historyEntries: HistoryEntry[] = []
  private archivedSessionIds = new Set<string>()
  /** Pinned conversation ids, in workspace order: most recently pinned first. */
  private pinnedSessionIds = new Set<string>()
  /** Whether the runtime reports pinned sessions at all. */
  private pinningAvailable = false
  /**
   * Process-level permission preset catalogue.
   *
   * Runtime-scoped, not conversation-scoped: it is fetched once per connection
   * and dropped with it. While absent, the selector offers the presets DSH
   * ships, which is also what a runtime without the RPC shows.
   */
  private permissionCatalog: PermissionCatalog | undefined
  /** Monotonic cot-translation probe id: only the newest answer may publish. */
  private translationRevision = 0
  /** The connection whose cot-translation capability was already probed. */
  private translationClient: DshClient | undefined
  /** One in-flight capability probe, so start and session-ready do not race. */
  private translationProbe: { client: DshClient; promise: Promise<void> } | undefined
  /** The connection whose account state was already read. */
  private accountClient: DshClient | undefined
  /** First-ready hooks run once, after the connection work that built the UI. */
  private firstReady = false
  private readonly firstReadyHooks: Array<() => void> = []
  /** In-flight runtime start shared by concurrent callers. */
  private startTask: Promise<void> | undefined
  /** The stream baseline a concurrent first session read must wait for before ready. */
  private streamsGate: Promise<void> | undefined
  /** Whether the first-screen background job scan was already broadened. */
  private jobsScanExpanded = false
  private readonly unreadSessionIds: Set<string>
  private readonly sessionAttention = new Map<string, SessionAttention>()
  private readonly reconnectSessions = new Set<string>()
  private automaticReconnects: number[] = []
  private recovery: { abort: AbortController; task: Promise<void>; failure: Error | undefined } | undefined
  /** Refresh timer while a browser sign-in attempt is in flight. */
  private accountPoll: NodeJS.Timeout | undefined
  /** Releases the stop button if a turn never reports itself finished. */
  private stoppingDeadline: NodeJS.Timeout | undefined
  /** Which conversation the acknowledgement belongs to, so it cannot leak. */
  private stoppingSessionId: string | undefined
  /** Which conversation a post-window cancellation request belongs to. */
  private cancelRequestedSessionId: string | undefined
  /** The running-turn clock: when it started, and when it last heard anything. */
  private turnStartedAt = 0
  private turnActivityAt = 0
  private turnClockSessionId = ''
  /** Attempt whose authorize URL was already handed to the browser. */
  private openedSignInAttempt: string | undefined
  /** Polls spent on the current attempt, so a stuck attempt cannot poll forever. */
  private accountPollCount = 0

  private static readonly unreadStorageKey = 'deepseekHarness.unreadSessions'

  readonly onDidChangeState = this.changes.event
  readonly onDidChangeRuntimeSettings = this.settingsChanges.event

  /**
   * Channel for diagnostics. DSH text can quote a request URL, an
   * `Authorization` header or a `Cookie`, so every line is redacted — and
   * single-lined, so it cannot forge log lines — where it is written, instead
   * of relying on each of the call sites to remember.
   */
  private readonly output: Pick<vscode.OutputChannel, 'appendLine'>

  constructor(
    private readonly runtime: DshRuntime,
    output: vscode.OutputChannel,
    private readonly dirtyFiles: DirtyFileGuard,
    private readonly diffReviews: DiffReviewManager,
    private readonly workspaceState: vscode.Memento,
    private _cwd: string,
    private readonly extensionVersion: string,
  ) {
    this.output = { appendLine: line => { output.appendLine(diagnosticText(line)) } }
    this._state = initialState(_cwd)
    this.unreadSessionIds = new Set(workspaceState.get<string[]>(DshChatController.unreadStorageKey, []))
  }

  get cwd(): string {
    return this._cwd
  }

  get state(): ChatViewState {
    return this._state
  }

  taskClient(requireSelection = true): DshClient { if (requireSelection) this.requireReady(); return this.requireClient() }
  async resolveSubagent(parentSessionId: string, targetId: string): Promise<SessionItem> {
    const client = this.taskClient(false), cwd = this.cwd
    if (!this._state.sessions.some(item => item.id === parentSessionId && item.subagent?.mode !== 'external')) throw new Error('The owning conversation is no longer in this project.')
    const target = (): SessionItem | undefined => {
      const rows = this._state.sessions
      const directParent = rows.find(item => item.id === parentSessionId)?.parentId
      if (targetId === directParent) return rows.find(item => item.id === targetId)
      const item = rows.find(item => item.id === targetId || (item.parentId === parentSessionId && item.subagent?.executionId === targetId))
      const visited = new Set<string>()
      for (let owner = item?.parentId; owner && !visited.has(owner); owner = rows.find(row => row.id === owner)?.parentId) {
        if (owner === parentSessionId) return item
        visited.add(owner)
      }
      return undefined
    }
    let item = target()
    if (!item) { await this.refreshSubagentCatalog(parentSessionId, true); item = target() }
    if (this.client !== client || this.cwd !== cwd) throw new Error('The runtime or project changed. Reopen this task from its conversation.')
    if (!item) throw new Error(this._state.subagentCatalogs[parentSessionId]?.error
      ?? (this._state.subagentCatalogs[parentSessionId]?.status === 'migration-required'
        ? 'DSH requires history migration before this catalog can be read. Open the owning conversation in DSH and retry.'
        : 'This subagent is not present in its owning conversation. Refresh the conversation and retry.'))
    if (item.subagent?.mode === 'external') throw new Error('External tasks have no local conversation. Their results remain in the owning conversation.')
    return item
  }
  private materializeChild(sessionId: string): SessionSummary | undefined {
    const existing = this.summaries.find(item => item.sessionId === sessionId)
    if (existing) return existing.cwd === this.cwd ? existing : undefined
    const item = this._state.sessions.find(entry => entry.id === sessionId)
    if (!item?.parentId || !item.subagent || item.subagent.mode === 'external') return undefined
    const summary: SessionSummary = { sessionId, parentSessionId: item.parentId, origin: 'subagent', cwd: this.cwd,
      updatedAt: item.updatedAt, running: item.running, blank: item.blank }
    this.summaries.push(summary)
    return summary
  }
  adoptTaskSnapshot(sessionId: string, seq: number, values: Record<string, unknown>): void {
    const client = this.taskClient(false), summary = this.materializeChild(sessionId)
    if (!summary) return
    summary.projections = { values: client.adoptSessionProjections(sessionId, seq, values) }
    this.publishSessionItems()
  }
  refreshSubagentCatalog(sessionId: string, force = false): Promise<void> {
    const existing = this.catalogReads.get(sessionId)
    if (existing) return existing
    const client = this.taskClient(false), cwd = this.cwd
    const item = this._state.sessions.find(entry => entry.id === sessionId)
    if (!item || item.subagent?.mode === 'external') return Promise.resolve()
    if (!force && this._state.subagentCatalogs[sessionId]?.status === 'ready') return Promise.resolve()
    if (this.catalogReads.size >= 4) {
      this.publish({subagentCatalogs:{...this._state.subagentCatalogs,[sessionId]:{status:'error',error:'Other subagent catalogs are loading. Retry after they finish.'}}})
      return Promise.resolve()
    }
    const current = (): boolean => this.client === client && this.cwd === cwd
    const status = (read: SubagentCatalogRead): void => {
      if (current()) this.publish({ subagentCatalogs: { ...this._state.subagentCatalogs, [sessionId]: read } })
    }
    status({ status: 'loading' })
    const task = (async () => {
      try {
        const result = await client.sessionProjections(sessionId)
        if (!current()) return
        const summary = this.summaries.find(entry => entry.sessionId === sessionId) ?? this.materializeChild(sessionId)
        if (!summary) return
        if (result !== null) summary.projections = { values: { ...summary.projections?.values, ...result.values } }
        status({ status: result?.kind === 'migration-required' ? 'migration-required' : 'ready' })
        this.publishSessionItems()
      } catch (error) { status({ status: 'error', error: redactDshSecrets(dshErrorText(error)) }) }
    })()
    this.catalogReads.set(sessionId, task)
    void task.finally(() => { if (this.catalogReads.get(sessionId) === task) this.catalogReads.delete(sessionId) })
    return task
  }
  async refreshTasks(): Promise<void> {
    this.requireReady()
    this.requireClient().monitorJobs(this.summaries.map(summary => summary.sessionId), true)
    await Promise.all([this.taskFeatures.refreshGoal(), this.taskFeatures.refreshSchedules()])
  }
  async searchHistory(query: string): Promise<void> { this.requireReady(); await this.taskFeatures.search(query) }
  async scheduleHistory(sessionId: string, id: string, before?: string): Promise<void> {
    this.requireReady(); await this.taskFeatures.showScheduleHistory(sessionId, id, before)
  }
  async changeGoal(sessionId: string, action: GoalAction, ref?: { id: string; revision: number }, request?: { objective?: string; maxGoalRounds?: number }): Promise<void> {
    this.requireReady()
    const reason = this.childReadOnlyReason(sessionId)
    if (reason !== null) throw new Error(reason)
    await this.taskFeatures.changeGoal(sessionId, action, ref, request)
  }
  childReadOnlyReason(sessionId: string): string | null {
    const child = this._state.sessions.find(item => item.id === sessionId)
    if (child?.subagent === undefined) return null
    if (child.subagent.mode === 'external') return 'External tasks have no local conversation. View their results in the owning conversation.'
    if (child.subagent.mode !== 'continuable') return 'This child is read-only. Continue the work in its owning conversation.'
    const parent = this.summaries.find(item => item.sessionId === child.parentId)
    if (parent?.agentAvailable !== true) return 'The owning agent is unavailable. Open its conversation and send a message to resume it, then return to this child.'
    return null
  }
  async sendToChild(sessionId: string, text: string, mode: PromptMode = 'queue'): Promise<void> {
    const client = this.taskClient(false); const child = this._state.sessions.find(item => item.id === sessionId)
    if (!child?.parentId || !child.subagent) throw new Error('This child is no longer in the project.')
    const reason = this.childReadOnlyReason(sessionId)
    if (reason !== null) throw new Error(reason)
    if (!text.trim()) return
    await client.prompt(sessionId, text.trim(), [], mode, child.parentId)
  }
  async stopChild(sessionId: string): Promise<void> {
    const client = this.taskClient(false); const child = this._state.sessions.find(item => item.id === sessionId)
    if (!child?.parentId) throw new Error('This child is no longer in the project.')
    if (child.subagent?.mode === 'external') throw new Error('Manage this external task from its owning conversation.')
    await client.interruptSubagent(sessionId, child.parentId)
  }
  async answerTaskRequest(sessionId: string, rpcId: string, answer: Record<string, unknown>): Promise<void> {
    const client = this.taskClient(false)
    if (!this._state.sessions.some(item => item.id === sessionId)) throw new Error('This child is no longer in the current project.')
    const pending = client.pendingRequests(sessionId).find(item => item.rpcId === rpcId)
    if (!pending) throw new Error('This request is no longer pending.')
    if (pending.event === 'approval/request' && answer.outcome !== 'allowed-once' && answer.outcome !== 'rejected') throw new Error('Invalid approval answer.')
    if (pending.event === 'user-questions/request') {
      const questions = Array.isArray(pending.request.questions) ? pending.request.questions : []
      const answers = Array.isArray(answer.answers) ? answer.answers : []
      const ids = new Set(questions.flatMap(item => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).id === 'string' ? [(item as Record<string, unknown>).id as string] : []))
      if (answers.length !== ids.size || answers.some(item => typeof item !== 'object' || item === null || !ids.delete(String((item as Record<string, unknown>).id)))) throw new Error('Every question needs exactly one answer.')
      if (answers.some(item => { const value = item as Record<string, unknown>; return !Array.isArray(value.selected) || value.selected.some(option => typeof option !== 'string') || (value.custom !== undefined && typeof value.custom !== 'string') })) throw new Error('Invalid question answer.')
    }
    const result = await client.respond(rpcId, pending.event === 'approval/request' ? { sessionId, approvalId: rpcId, outcome: answer.outcome } : { sessionId, answer: { answers: answer.answers } })
    if (!result.accepted) throw new Error('The runtime no longer accepts this answer.')
  }

  get runtimeOwnership(): RuntimeOwnership | undefined {
    const state = this.runtime.state
    return state.kind === 'ready' ? state.ownership : undefined
  }

  /** Includes hidden, archived and other-workspace sessions on this runtime. */
  get hasRunningTasks(): boolean {
    return this._state.running || this.summaries.some(summary => summary.running)
      || [...this.runtimeActivity.values()].some(activity => activity.running)
      || [...this.jobsBySession.values()].some(jobs => jobs.some(job => job.status === 'running' || job.status === 'stopping'))
  }

  get isDisposed(): boolean { return this.disposed }

  /** The banner text for a conversation another DSH process owns, or null. */
  private occupancyNoticeFor(sessionId: string): string | null {
    return this.occupancyHolders.has(sessionId) ? CONVERSATION_HELD_TEXT : null
  }

  /**
   * Record that this conversation is owned elsewhere.
   *
   * Reported once, as state rather than as a transcript notice: the condition
   * stays true until something changes it, so repeating it per action would be
   * noise. The sign-in and unroutable notices work the same way.
   */
  private markConversationHeld(sessionId: string): void {
    if (sessionId === '' || this.occupancyHolders.has(sessionId)) return
    this.occupancyHolders.add(sessionId)
    this.output.appendLine(`[chat] conversation ${sessionId} is held by another DSH process; it is readable but not writable from this window`)
    if (sessionId === this._state.sessionId) this.publish({ occupancyNotice: CONVERSATION_HELD_TEXT })
  }

  /**
   * Clear it, because this window just proved it can write to the conversation.
   *
   * Called from every path that succeeds in reaching the conversation: an accepted
   * message, a turn reported running here, or an explicit retry.
   */
  private clearConversationHeld(sessionId: string): void {
    if (!this.occupancyHolders.delete(sessionId)) return
    this.output.appendLine(`[chat] conversation ${sessionId} is writable from this window again`)
    if (sessionId === this._state.sessionId) this.publish({ occupancyNotice: null })
  }

  /** Conversations the most recent runtime stop released, for the restart report. */
  get releasedSessions(): number { return this.runtime.releasedSessions }

  /** Opaque connection identity for deferred plugin/settings completion checks. */
  get runtimeIdentity(): object | undefined {
    return this.runtime.state.kind === 'ready' ? this.runtime.connection : undefined
  }

  publish(patch: Partial<ChatViewState>): void {
    this._state = { ...this._state, ...patch }
    this.changes.fire(this._state)
    if (!this.firstReady && this._state.phase === 'ready') {
      this.firstReady = true
      // Idle deferral: the hooks may take a lock or spawn a process, which must
      // not compete with the first conversation render or its RPCs.
      for (const hook of this.firstReadyHooks.splice(0)) setTimeout(hook, 1_500)
    }
  }

  observeRuntime(state: RuntimeState): void {
    if (state.kind === 'stopped' || state.kind === 'failed') {
      this.cancelRecovery()
      ++this.generation
      this.disconnectClient()
      for (const summary of this.summaries) summary.running = false
      this.clearLiveControls()
      this.publish({ canReconnect: false, runtimeConnection: null, ...this.runningPatch(false), messages: this.resetToDurableMessages() })
    }
    if (state.kind === 'starting') this.publish({ phase: 'loading', runtimeConnection: null, statusText: redactDshSecrets(state.detail), setup: null })
    if (state.kind === 'ready') this.publish({ runtimeConnection: { ownership: state.ownership,
      ...(state.pid === undefined ? {} : { pid: state.pid }) } })
    if (state.kind === 'failed') {
      // The banner is as visible as the channel, and a launch failure can quote
      // the URL it failed on.
      const detail = redactDshSecrets(state.message)
      this.publish({
        phase: 'error',
        statusText: detail,
        setup: state.reason === 'runtime-auth' ? 'runtime-auth' : setupKindFor(this.cwd, 'error', detail),
      })
    }
    if (state.kind === 'stopped') {
      this.publish({ phase: 'error', statusText: 'DeepSeek Harness stopped.', setup: null })
    }
  }

  async start(target?: RuntimeTarget): Promise<void> {
    if (this.disposed) return
    // A second start while one is in flight joins it instead of racing it: two
    // view resolutions and an explicit Reconnect would otherwise restart the
    // whole runtime chain, which is what made opening the sidebar feel slow.
    if (this.startTask === undefined) {
      this.startTask = this.startNow(target).finally(() => { this.startTask = undefined })
    }
    return this.startTask
  }

  /**
   * Start only when there is no live connection to reuse.
   *
   * A newly resolved view or an Open in Editor call is not a reason to tear
   * down a healthy runtime: the new surface asks for a snapshot itself. The
   * explicit commands (Reconnect, Restart) and the error phase still call
   * `start()`, and an in-flight start is joined rather than duplicated.
   */
  async ensureStarted(target?: RuntimeTarget): Promise<void> {
    if (this.disposed) return
    if (this.startTask !== undefined) return this.startTask
    if (target !== undefined) return this.start(target)
    // Phase is irrelevant here: a ready runtime with a live client is healthy
    // even while a conversation is loading or a previous load left an error on
    // screen. Restarting it for a new view would kill the live runtime; the new
    // surface receives the current state (including that error) instead.
    if (this.runtime.state.kind === 'ready' && this.client !== undefined) {
      this.output.appendLine('[chat] reusing the active DSH connection for a new surface')
      // Re-fire the state so a surface that just loaded scripts receives it.
      this.publish({})
      return
    }
    return this.start()
  }

  /**
   * Run one callback after the first ready state.
   *
   * Used for work that must not delay the first paint (stale runtime-record
   * sweeping); the delayed call keeps the startup chain free of lock contention.
   */
  afterFirstReady(callback: () => void, fallbackMs = 15_000): void {
    if (this.firstReady) { setTimeout(callback, 0); return }
    const run = (): void => {
      const index = this.firstReadyHooks.indexOf(run)
      if (index === -1) return
      this.firstReadyHooks.splice(index, 1)
      clearTimeout(timer)
      callback()
    }
    this.firstReadyHooks.push(run)
    // A runtime that never becomes ready must still get the cleanup once.
    const timer = setTimeout(run, fallbackMs)
    timer.unref?.()
  }

  private async startNow(target?: RuntimeTarget): Promise<void> {
    this.streamsGate = undefined
    // Starting again — a restart, or the view being re-created — must not move
    // the user to a different conversation. The id is captured before the reset
    // below clears it, because clearing it is what made the reload fall through
    // to "newest conversation".
    const previousSessionId = this._state.sessionId
    ++this.runtimeSwitchRevision
    this.cancelRecovery()
    this.reconnectSessions.clear()
    this.automaticReconnects = []
    const generation = ++this.generation
    this.disconnectClient()
    this.projector.reset([])
    this.diffReviews.clear()
    this.guardedDirtyCalls.clear()
    this.queueRawText.clear()
    this.attachmentResults.clear()
    this.attachmentLoads.clear()
    this.jobsBySession.clear()
    this.historyEntries = []
    this.publish({
      phase: this.cwd === '' ? 'error' : 'loading',
      statusText: this.cwd === '' ? 'Open a project folder to start using DeepSeek Harness.' : 'Connecting to DSH; checking for a compatible existing runtime…',
      setup: this.cwd === '' ? 'workspace' : null,
      canReconnect: false,
      runtimeConnection: null,
      messages: [],
      sessions: [],
      archivedSessions: [],
      pinnedSessionIds: [],
      pinningAvailable: false,
      sessionId: '',
      running: false,
      stopping: false,
      cancelRequested: false,
      turnStartedAt: 0,
      turnActivityAt: 0,
      routable: this.cwd !== '',
      anyRoutable: this.cwd !== '',
      models: [],
      approval: null,
      question: null,
      commands: [],
      skills: [],
      agentPreset: unavailableAgentPresetState(),
      usage: unavailableUsageMeterState(),
      translation: null,
      permissions: [],
      plan: planModeStateOf(undefined),
      changedFiles: [],
      queue: [],
      jobs: [],
      todos: [],
      team: null,
      hasMoreHistory: false,
      loadingHistory: false,
    })
    if (this.cwd === '') return
    const connectingAt = Date.now()
    try {
      await this.runtime.start(this.cwd === '' ? undefined : vscode.Uri.file(this.cwd), target)
      if (generation !== this.generation) return
      this.output.appendLine(`[chat] runtime connected after ${Date.now() - connectingAt} ms; opening event streams`)
      const connection = this.runtime.connection
      if (connection === undefined) throw new Error('DSH did not establish an authenticated connection.')
      this.observeRuntime(this.runtime.state)
      const client = this.connectClient(connection)
      this.publish({ canReconnect: true, statusText: 'Connected to DSH. Opening event streams…' })
      // The stream baselines and the first conversation list are independent
      // reads: start both, so the list RTT overlaps the baseline subscription
      // instead of following it. `loadSessions` awaits the same baseline through
      // `refreshArchivedSessions`, and every await is guarded by generation.
      const streamsReady = client.startStreams()
      this.streamsGate = streamsReady
      // Optional capabilities: never part of the connect handshake, so a
      // runtime that does not serve them still opens the conversation.
      void this.loadPermissionCatalog(client)
      void this.loadTranslation(client)
      const sessionsReady = this.loadSessions(previousSessionId === '' ? undefined : previousSessionId)
      // When the stream baseline fails first, the list promise is abandoned by
      // the catch below; attach a handler now so it cannot reject unhandled. The
      // success path still awaits it and surfaces its own failure.
      sessionsReady.catch(() => undefined)
      await streamsReady
      if (generation !== this.generation || this.client !== client) return
      this.output.appendLine(`[chat] event streams ready after ${Date.now() - connectingAt} ms; loading saved conversations`)
      this.publish({ statusText: 'Connected to DSH. Loading saved conversations…' })
      this.streamsGate = undefined
      await sessionsReady
      if (generation === this.generation && this._state.phase === 'ready') {
        this.output.appendLine(`[chat] conversation ready after ${Date.now() - connectingAt} ms`)
      }
    } catch (error) {
      this.streamsGate = undefined
      if (generation !== this.generation) return
      const message = redactDshSecrets(error instanceof Error ? error.message : String(error))
      this.output.appendLine(`[chat] ${message}`)
      this.publish({ phase: 'error', statusText: message,
        setup: error instanceof ExistingRuntimeConnectionError ? 'runtime-auth' : setupKindFor(this.cwd, 'error', message) })
    }
  }

  async restart(target?: RuntimeTarget): Promise<boolean> {
    if (this.disposed) return false
    const revision = ++this.runtimeSwitchRevision
    const plan = target === undefined ? await this.runtime.prepareRestart() : undefined
    if (this.disposed || revision !== this.runtimeSwitchRevision) return false
    if (plan !== undefined && plan.otherWindows.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `Restart the shared DSH runtime? ${String(plan.otherWindows.length)} other VS Code window(s) are using it. This interrupts all running conversations, subagents and scheduled work in that runtime. The replacement uses this window's settings. Other windows will need to reload with matching settings.`,
        { modal: true }, 'Restart Shared Runtime')
      if (choice !== 'Restart Shared Runtime') return false
    }
    if (this.disposed || revision !== this.runtimeSwitchRevision) return false
    if (target === undefined) await this.runtime.assertCanRestart(plan)
    if (this.disposed || revision !== this.runtimeSwitchRevision) return false
    this.cancelRecovery()
    ++this.generation
    this.disconnectClient()
    this.publish({ phase: 'loading', statusText: 'Restarting DeepSeek Harness…', canReconnect: false })
    try {
      await this.runtime.stop(false, target === undefined, plan)
    } catch (error) {
      // A stop that fails used to leave the sidebar on a loading screen, which
      // offers no controls at all: nothing published again, so only the view
      // title could try. The retry belongs where the user is looking.
      if (revision === this.runtimeSwitchRevision) {
        this.publish({
          phase: 'error',
          setup: null,
          canReconnect: this.runtime.state.kind === 'ready',
          ...this.runningPatch(false),
          statusText: `Could not restart DeepSeek Harness: ${redactDshSecrets(dshErrorText(error))}`,
        })
      }
      throw error
    }
    if (revision !== this.runtimeSwitchRevision) return false
    // A start that was still in flight when the user hit Restart is now
    // superseded: wait for it to settle so it cannot be joined (and silently
    // replace the requested start/target) by the fresh start call below.
    const superseded = this.startTask
    if (superseded !== undefined) {
      try { await superseded } catch { /* superseded by this restart */ }
      if (this.disposed || revision !== this.runtimeSwitchRevision) return false
    }
    const startGeneration = this.generation + 1
    await this.start(target)
    return !this.disposed && this._state.phase === 'ready'
      && this.runtimeSwitchRevision === revision + 1 && this.generation === startGeneration
  }

  assertCanSelectRuntime(): void {
    if (this.disposed) throw new Error('The DeepSeek sidebar has closed. Reopen it before selecting a runtime.')
    if (this.cwd === '') throw new Error('Open a project folder before selecting a DSH runtime.')
    if (this._state.phase === 'loading') throw new Error('Wait for the current connection attempt to finish before selecting a runtime.')
    if (this.runtime.state.kind === 'ready' && this._state.phase !== 'ready') {
      throw new Error('Reconnect to DeepSeek Harness to check running tasks before switching projects or runtimes.')
    }
    if (this.hasRunningTasks) {
      throw new Error('Finish or stop the running DeepSeek tasks before switching runtimes.')
    }
  }

  async selectRuntime(target: RuntimeTarget): Promise<void> {
    this.assertCanSelectRuntime()
    if (target.kind === 'external') existingRuntimeUrl(target.launchUrl.href)
    this.publish({ phase: 'loading', setup: null, statusText: 'Switching DeepSeek Harness runtime…' })
    await this.restart(target)
    if (target.kind === 'external') await this.offerToRememberExternalRuntime()
  }

  /**
   * Offer to save a user-supplied runtime for every window.
   *
   * Asked explicitly, never assumed: the record holds the launch URL, which
   * authenticates that runtime, so writing it down is the user's decision. Saying
   * no costs one paste per window; saying yes is what stops each window from
   * starting yet another runtime over the same conversations.
   */
  private async offerToRememberExternalRuntime(): Promise<void> {
    const launchUrl = this.runtime.externalRuntimeUrlToRemember()
    if (launchUrl === undefined || this.declinedRuntimeUrls.has(launchUrl)) return
    if (!vscode.workspace.getConfiguration('deepseekHarness', vscode.Uri.file(this.cwd))
      .get<boolean>('rememberExternalRuntime', true)) return
    const choice = await vscode.window.showInformationMessage(
      'Remember this DSH runtime for every VS Code window? Its launch URL authenticates that runtime and will be stored on this machine, readable only by your user account.',
      'Remember', 'Not Now')
    if (choice !== 'Remember') {
      this.declinedRuntimeUrls.add(launchUrl)
      return
    }
    const remembered = await this.runtime.rememberExternalRuntime(this.cwd)
    void vscode.window.showInformationMessage(remembered
      ? 'Saved. Every window will attach to this DSH runtime from now on; "DSH: Forget the Saved Runtime" removes it.'
      : 'This DSH runtime could not be saved. See the DeepSeek Harness output for details.')
  }

  /** Rebuild subscriptions on the same runtime; never resubmit a user action. */
  reconnect(automatic = false): Promise<void> {
    if (this.recovery !== undefined) return this.recovery.task
    if (this.runtime.state.kind !== 'ready') {
      if (this.runtime.state.kind === 'failed' && this.runtime.state.reason === 'runtime-auth') {
        if (!automatic) this.publish({ phase: 'error', setup: 'runtime-auth', canReconnect: false,
          statusText: 'Use Connect Existing Runtime to retry with its launch URL.' })
        return Promise.resolve()
      }
      // A fresh window, or an unsuccessful handshake, can still have a healthy
      // shared runtime in the ledger. Retry discovery without stopping it.
      return automatic ? Promise.resolve() : this.start()
    }
    const connection = this.runtime.connection
    if (!automatic) this.automaticReconnects = []
    const generation = ++this.generation
    const selectedId = this._state.sessionId
    for (const id of this.client?.handledSessionIds ?? []) this.reconnectSessions.add(id)
    if (selectedId !== '') this.reconnectSessions.add(selectedId)
    this.disconnectClient()
    this.clearLiveControls()
    this.publish({ phase: 'loading', setup: null, canReconnect: true, statusText: 'Reconnecting to the existing DSH runtime…' })
    const recovery = { abort: new AbortController(), task: Promise.resolve(), failure: undefined as Error | undefined }
    this.recovery = recovery
    recovery.task = reconnectAttempts(async attempt => {
      if (this.runtime.state.kind !== 'ready' || this.runtime.connection !== connection) throw new Error('The DSH runtime changed. Reconnect to its new instance.')
      this.disconnectClient()
      recovery.failure = undefined
      if (automatic) {
        this.automaticReconnects = this.automaticReconnects.filter(time => Date.now() - time < 30_000)
        if (this.automaticReconnects.length >= 3) throw new Error('The DSH connection keeps dropping. Check the runtime, then reconnect manually.')
        this.automaticReconnects.push(Date.now())
      }
      this.publish({ phase: 'loading', statusText: `Reconnecting to DSH${automatic ? ` (${String(attempt)}/3)` : ''}…` })
      // A manual retry can renew an expired cookie using the existing launch URL.
      // Tokenless reused runtimes only need their subscriptions rebuilt.
      // An automatic retry never changes credentials or starts a process.
      if (!automatic && connection.canReauthenticate) await connection.reauthenticate(recovery.abort.signal)
      recovery.abort.signal.throwIfAborted()
      const client = this.connectClient(connection, [...this.reconnectSessions])
      try {
        await client.startStreams()
        recovery.abort.signal.throwIfAborted()
        void this.loadPermissionCatalog(client)
        void this.loadTranslation(client)
        await this.loadSessions(selectedId || undefined, false)
        recovery.abort.signal.throwIfAborted()
        if (recovery.failure !== undefined) throw recovery.failure
        if (this.client !== client || this._state.phase !== 'ready') throw new Error('DSH did not restore the conversation. Reconnect to try again.')
      } catch (error) {
        throw recovery.failure ?? error
      }
    }, recovery.abort.signal, automatic).catch((error: unknown) => {
      if (recovery.abort.signal.aborted || generation !== this.generation) return
      this.disconnectClient()
      this.clearLiveControls()
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[reconnect] ${message}`)
      this.publish({
        phase: 'error',
        setup: null,
        messages: this.resetToDurableMessages(),
        // Nothing is observable any more, so nothing may still be shown as running.
        ...this.runningPatch(false),
        statusText: `Could not reconnect to DSH: ${message} No tasks were resent.`,
      })
    }).finally(() => {
      if (this.recovery === recovery) this.recovery = undefined
    })
    return recovery.task
  }

  private connectClient(connection: DshConnection, requestSessions: readonly string[] = []): DshClient {
    const client = new DshClient(connection, requestSessions)
    this.client = client
    this.taskFeatures.bind(client)
    this.clientDisposables.push(
      client.onFrame(frame => {
        if (this.client !== client) return
        const type = frame.payload.type
        if (typeof type === 'string' && (type.startsWith('approval/') || type.startsWith('question/'))) {
          this.output.appendLine(`[protocol] ${type} for ${String(frame.payload.sessionId ?? 'unknown session')}`)
        }
        this.acceptFrame(frame)
      }),
      client.onError(error => {
        if (this.client !== client) return
        this.output.appendLine(`[protocol] ${error.message}`)
        for (const id of client.handledSessionIds) this.reconnectSessions.add(id)
        if (this.recovery !== undefined) {
          this.recovery.failure = error
          client.dispose()
          return
        }
        if (canRetryConnection(error) && this.runtime.state.kind === 'ready') {
          void this.reconnect(true)
        } else {
          this.disconnectClient()
          this.clearLiveControls()
          this.publish({
            phase: 'error',
            setup: null,
            messages: this.resetToDurableMessages(),
            ...this.runningPatch(false),
            statusText: `Lost the DSH event stream: ${error.message}`,
          })
        }
      }),
    )
    return client
  }

  private clearLiveControls(): void {
    ++this.sessionLoadGeneration
    this.queueRawText.clear()
    this.jobsBySession.clear()
    this.sessionAttention.clear()
    // Nothing is observable from this connection any more, so no stop it
    // acknowledged can still be pending.
    this.clearStoppingAcknowledgement()
    this.publish({ approval: null, question: null, queue: [], jobs: [], todos: [], loadingHistory: false, stopping: false, cancelRequested: false })
    this.publishSessionItems()
  }

  private resetToDurableMessages(): ConversationMessage[] {
    // Process-local assistant deltas cannot settle once their stream or runtime
    // is abandoned. Preserve only the selected session's durable history.
    this.projector.reset(this.historyEntries)
    return this.projectedMessages()
  }

  private cancelRecovery(): void {
    this.recovery?.abort.abort()
    this.recovery = undefined
  }

  async switchWorkspace(cwd: string): Promise<void> {
    if (cwd === '' || cwd === this.cwd) return
    this.assertCanSelectRuntime()
    this._cwd = cwd
    this.summaries = []
    this.projector.reset([])
    this.historyEntries = []
    this.guardedDirtyCalls.clear()
    this.publish({
      ...initialState(cwd),
      statusText: 'Switching DeepSeek Harness to this project…',
    })
    // A project switch is local to this window. Detach and re-adopt a compatible
    // shared runtime; do not turn it into a confirmed restart of other windows.
    await this.restart({ kind: 'managed' })
  }

  async newSession(expected?: { cwd: string; sessionId: string }): Promise<string | undefined> {
    this.requireReady()
    const generation = this.sessionLoadGeneration
    if (expected !== undefined && (expected.cwd !== this.cwd || expected.sessionId !== this._state.sessionId)) {
      throw new Error('The project or conversation changed. Start the draft again from the conversation list.')
    }
    const client = this.requireClient()
    const created = await client.createSession(this.cwd)
    if (this.client !== client) {
      if (expected !== undefined) throw new Error('The runtime changed before the new conversation opened. Your draft was retained.')
      return
    }
    if (expected !== undefined && (expected.cwd !== this.cwd || generation !== this.sessionLoadGeneration)) {
      throw new Error('The project or conversation changed before the new draft opened. Your text was retained.')
    }
    // The runtime created it, so it has to be opened even when another load
    // started in the meantime: a conversation with no messages does not earn a row
    // in the list, so returning quietly left the user's click as a no-op and the
    // conversation unreachable. Opening it directly is what `forkConversation`
    // does for the same reason.
    await this.loadSession(created.sessionId)
    if (expected !== undefined && (this.client !== client || this._state.sessionId !== created.sessionId || this._state.phase !== 'ready')) {
      throw new Error('The new conversation could not be opened. Your draft was retained.')
    }
    return created.sessionId
  }

  async selectSession(sessionId: string): Promise<void> {
    const began = Date.now()
    const loggedId = safeLogId(sessionId)
    this.output.appendLine(`[ui] switching to conversation ${loggedId} (from ${safeLogId(this._state.sessionId)}, phase=${this._state.phase})`)
    try {
      await this.selectSessionNow(sessionId)
      this.output.appendLine(`[ui] conversation ${loggedId} selected in ${String(Date.now() - began)} ms (phase=${this._state.phase})`)
    } catch (error) {
      this.output.appendLine(`[ui] selecting conversation ${loggedId} failed in ${String(Date.now() - began)} ms: ${diagnosticText(dshErrorText(error))}`)
      throw error
    }
  }

  private async selectSessionNow(sessionId: string): Promise<void> {
    // Deliberately not gated on the ready phase. A conversation that will not
    // open leaves the sidebar loading or failed, and switching to another one is
    // the only way out of it; `loadSession` supersedes the load in flight and
    // reports its own failure, so refusing here would only turn the escape into
    // a no-op.
    let summary = this.summaries.find(item => item.sessionId === sessionId && item.cwd === this.cwd)
      ?? this.materializeChild(sessionId)
    let refreshed = false
    if (summary === undefined || this.archivedSessionIds.has(sessionId)) {
      // The list can be stale: another window sharing this runtime may have
      // created or archived the conversation after this window last refreshed.
      // Refresh once, then tell the user why a click cannot be honoured instead
      // of leaving it as a silent no-op.
      await this.loadSessions(sessionId, false)
      refreshed = true
      summary = this.summaries.find(item => item.sessionId === sessionId && item.cwd === this.cwd)
        ?? this.materializeChild(sessionId)
      if (this.archivedSessionIds.has(sessionId)) {
        throw new Error('This conversation is archived. Restore it from the archived list to continue.')
      }
      if (summary === undefined) {
        throw new Error('This conversation is not in the current project on this runtime. Switch project or reopen it from its window.')
      }
    }
    this.markRead(sessionId, true)
    // The refresh selects the preferred conversation itself, so a successful
    // refresh has already opened the target.
    if (refreshed && this._state.sessionId === sessionId && this._state.phase === 'ready') {
      this.publishSessionItems()
      return
    }
    await this.loadSession(sessionId)
  }

  /**
   * Ask the runtime again who owns the open conversation.
   *
   * Opening a conversation is what makes the host try to resume it, so reopening
   * is the only honest way to re-check: the marker is dropped first, and the
   * host's own answer — a resume that succeeds, or the same failure again —
   * decides whether it comes back.
   */
  async retryHeldConversation(): Promise<void> {
    const sessionId = this._state.sessionId
    if (sessionId === '') return
    this.clearConversationHeld(sessionId)
    await this.selectSession(sessionId)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    this.requireReady()
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    const normalized = title.trim()
    if (summary === undefined || summary.blank || normalized === '') return
    const client = this.requireClient()
    const result = await client.renameSession(sessionId, normalized)
    if (this.client !== client) return
    summary.projections = { values: { ...summary.projections?.values, title: result.title } }
    summary.updatedAt = Date.now()
    this.publishSessionItems()
  }

  async archiveSession(sessionId: string): Promise<void> {
    this.requireReady()
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    // A subagent belongs to its parent conversation; archiving it alone would
    // delete the only path back to it without making it recoverable.
    if (summary === undefined || summary.blank || summary.origin === 'subagent') return
    const client = this.requireClient()
    const result = await client.archiveSession(sessionId)
    if (this.client !== client) return
    this.archivedSessionIds = new Set(result.archivedSessionIds)
    this.unreadSessionIds.delete(sessionId)
    this.persistUnreadSessions()
    await this.loadSessions()
  }

  /**
   * Restores an archived conversation to the active list without stealing focus
   * from whatever the user is working on.
   */
  async unarchiveSession(sessionId: string): Promise<void> {
    this.requireReady()
    if (!this.archivedSessionIds.has(sessionId)) return
    const client = this.requireClient()
    const result = await client.unarchiveSession(sessionId)
    if (this.client !== client) return
    this.archivedSessionIds = new Set(result.archivedSessionIds)
    this.publish(this.sessionItemPatch())
  }

  /** Pin a conversation to the top of the list; the Host returns the new order. */
  async pinSession(sessionId: string): Promise<void> {
    this.requireReady()
    const client = this.requireClient()
    const result = await client.pinSession(sessionId)
    if (this.client !== client) return
    this.applyPinnedSessionIds(result.pinnedSessionIds)
  }

  /** Remove a conversation from the pinned group. */
  async unpinSession(sessionId: string): Promise<void> {
    this.requireReady()
    const client = this.requireClient()
    const result = await client.unpinSession(sessionId)
    if (this.client !== client) return
    this.applyPinnedSessionIds(result.pinnedSessionIds)
  }

  private applyPinnedSessionIds(value: unknown): void {
    const pinned = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    this.pinnedSessionIds = new Set(pinned)
    this.pinningAvailable = true
    this.publishSessionItems()
  }

  /** Copy a conversation id to the clipboard; the Webview confirms the action. */
  async copySessionId(sessionId: string): Promise<void> {
    await vscode.env.clipboard.writeText(sessionId)
  }

  /**
   * Asks DSH to stop one background job. The row converges through the
   * `job/list` stream, so the authoritative state arrives on its own.
   */
  async killJob(sessionId: string, jobId: string): Promise<void> {
    const client = this.taskClient(false)
    if (!this.summaries.some(summary => summary.sessionId === sessionId)) return
    const job = this.jobsBySession.get(sessionId)?.find(item => item.id === jobId)
    if (job === undefined || (job.status !== 'running' && job.status !== 'stopping')) return
    await client.killJob(sessionId, jobId)
  }

  async loadOlderHistory(): Promise<void> {
    this.requireReady()
    if (this._state.sessionId === '' || !this._state.hasMoreHistory || this._state.loadingHistory) return
    const sessionId = this._state.sessionId
    const client = this.requireClient()
    const loadGeneration = this.sessionLoadGeneration
    const beforeSeq = earliestHistorySequence(this.historyEntries)
    if (beforeSeq === undefined) {
      this.publish({ hasMoreHistory: false })
      return
    }
    this.publish({ loadingHistory: true })
    try {
      const page = await client.history(sessionId, beforeSeq)
      if (this.client !== client || this._state.sessionId !== sessionId || loadGeneration !== this.sessionLoadGeneration) return
      const unseenEntries = unseenHistoryEntries(this.historyEntries, page.events)
      this.historyEntries = mergeHistoryEntries(this.historyEntries, unseenEntries)
      this.publish({ workflows: workflowsOf(this.historyEntries.map(entry => entry.event)) })
      this.projector.reset(this.historyEntries, true)
      this.publish({
        messages: this.projectedMessages(), ...this.messageMetaPatch(),
        changedFiles: this.diffReviews.prependHistory(sessionId, this.cwd, unseenEntries),
        hasMoreHistory: page.hasMore,
        loadingHistory: false,
      })
      this.hydrateImages(client, sessionId)
    } catch (error) {
      if (this.client === client && loadGeneration === this.sessionLoadGeneration) throw error
    } finally {
      if (this.client === client && loadGeneration === this.sessionLoadGeneration && this._state.sessionId === sessionId && this._state.loadingHistory) {
        this.publish({ loadingHistory: false })
      }
    }
  }

  async send(
    text: string,
    attachments: readonly PromptAttachment[] = [],
    ideContext?: IdeContextSnapshot,
    mode: PromptMode = 'queue',
  ): Promise<void> {
    this.requireReady()
    const normalized = text.trim()
    if ((normalized === '' && attachments.length === 0) || this._state.sessionId === '') return
    const client = this.requireClient()
    const sessionId = this._state.sessionId
    const generation = this.sessionLoadGeneration
    const readOnlyReason = this.childReadOnlyReason(sessionId)
    if (readOnlyReason !== null) throw new Error(readOnlyReason)
    const images = attachments.filter((attachment): attachment is PromptImage => attachment.type === 'image')
    const { route: slash, command } = await this.resolveInput(normalized)
    if (this.client !== client || generation !== this.sessionLoadGeneration || this._state.phase !== 'ready') throw new Error('The conversation changed. Check its history before sending again.')
    const currentReadOnlyReason = this.childReadOnlyReason(sessionId)
    if (currentReadOnlyReason !== null) throw new Error(currentReadOnlyReason)
    if (slash.kind === 'command') {
      if (attachments.length > 0 && (command?.input?.attachments ?? command?.input?.images) !== true) {
        const imagesOnly = images.length === attachments.length
        throw new Error(`${slash.token} does not accept ${imagesOnly ? 'image attachments' : 'attachments'}; remove them first.`)
      }
      if (images.length !== attachments.length) {
        throw new Error(`${slash.token} cannot use file attachments; remove them first.`)
      }
      // A command sent with Enter while a turn owns the agent waits for it, the
      // way a queued message does. Executing it now is what `/compact` cannot
      // survive: it refuses while the agent is busy, so the user got a failed
      // command node instead of a compaction. Cmd/Ctrl+Enter still runs it now.
      if (mode === 'queue' && this._state.running) {
        this.holdCommand(sessionId, normalized, images)
        return
      }
      await this.runCommand(client, sessionId, normalized, images, slash.token)
      return
    }
    await client.prompt(
      sessionId,
      slash.kind === 'skill' || ideContext === undefined ? normalized : withIdeContext(normalized, ideContext),
      attachments,
      mode,
      // A subagent child is delivered through its parent; the session list is
      // the only place that lineage is known, and it is refreshed on load.
      this._state.parentSessionId ?? undefined,
    )
    if (this.client !== client) return
    this.clearConversationHeld(sessionId)
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    if (summary !== undefined) summary.blank = false
    if (generation === this.sessionLoadGeneration) this.publish({ agentPreset: lockAgentPresetState(this._state.agentPreset) })
  }

  async slashRoute(text: string): Promise<SlashRoute> {
    return (await this.resolveInput(text)).route
  }

  /** Execute one already-routed command line against its conversation. */
  private async runCommand(
    client: DshClient,
    sessionId: string,
    line: string,
    images: readonly PromptImage[],
    token: string,
  ): Promise<void> {
    const execution = await client.executeCommand(sessionId, line, images.length > 0 ? images : undefined)
    if (execution === undefined) throw new Error(`DeepSeek did not recognize ${token}.`)
    if (images.length > 0 && execution.result.kind === 'error') {
      throw new Error(execution.result.text ?? `${token} could not use the attached images.`)
    }
  }

  /** What the queue dock shows for one conversation's held commands. */
  private queuedCommandItems(sessionId: string): QueuedCommandItem[] {
    return (this.queuedCommands.get(sessionId) ?? []).map(command => ({
      id: command.id,
      text: command.text,
      preview: command.text.length > 200 ? command.text.slice(0, 200) + '…' : command.text,
    }))
  }

  private publishQueuedCommands(sessionId: string = this._state.sessionId): void {
    if (sessionId !== this._state.sessionId) return
    this.publish({ queuedCommands: this.queuedCommandItems(sessionId) })
  }

  /** Hold one command until its conversation is idle. */
  private holdCommand(sessionId: string, text: string, images: readonly PromptImage[]): void {
    const queue = this.queuedCommands.get(sessionId) ?? []
    queue.push({ id: randomUUID(), text, images: [...images] })
    this.queuedCommands.set(sessionId, queue)
    this.output.appendLine(`[commands] holding ${slashTokenOf(text)} until the conversation is idle`)
    this.publishQueuedCommands(sessionId)
  }

  /** Drop one held command. */
  removeQueuedCommand(sessionId: string, id: string): void {
    const queue = this.queuedCommands.get(sessionId)
    if (queue === undefined) return
    const remaining = queue.filter(command => command.id !== id)
    if (remaining.length === queue.length) return
    if (remaining.length === 0) this.queuedCommands.delete(sessionId)
    else this.queuedCommands.set(sessionId, remaining)
    this.publishQueuedCommands(sessionId)
  }

  /**
   * Run one held command now, at the user's explicit request.
   *
   * The conversation may still be busy; running it anyway is what the click asked
   * for, and the runtime's own answer — a failed command node, or the command's
   * effect — is the honest result.
   */
  async runQueuedCommand(sessionId: string, id: string): Promise<void> {
    const queue = this.queuedCommands.get(sessionId)
    const command = queue?.find(candidate => candidate.id === id)
    if (queue === undefined || command === undefined) return
    this.requireReady()
    const client = this.client
    if (client === undefined) throw new Error('DeepSeek Harness is not connected.')
    this.removeQueuedCommand(sessionId, id)
    await this.runCommand(client, sessionId, command.text, command.images, slashTokenOf(command.text))
  }

  /**
   * Run the commands held for the open conversation, in order, once it is idle.
   *
   * Only the open conversation: its queue is the one the dock shows and the one
   * whose state this window tracks, so a background conversation's held command
   * waits until it is opened. A queued message would start the next turn, so a
   * command waits for an empty runtime queue too.
   */
  private async drainQueuedCommands(): Promise<void> {
    if (this.drainingCommands) return
    this.drainingCommands = true
    try {
      for (;;) {
        const sessionId = this._state.sessionId
        const queue = this.queuedCommands.get(sessionId)
        if (this._state.phase !== 'ready' || this._state.running || this._state.queue.length > 0
          || this.childReadOnlyReason(sessionId) !== null || this.occupancyNoticeFor(sessionId) !== null) return
        const client = this.client, next = queue?.[0]
        if (client === undefined || next === undefined || queue === undefined) return
        const remaining = queue.slice(1)
        if (remaining.length === 0) this.queuedCommands.delete(sessionId)
        else this.queuedCommands.set(sessionId, remaining)
        this.publishQueuedCommands(sessionId)
        try {
          await this.runCommand(client, sessionId, next.text, next.images, slashTokenOf(next.text))
        } catch (error) {
          // Arguments may contain private text; the command name is enough to
          // identify a failed queue item, and failures must never auto-retry.
          if (this.client === client) this.output.appendLine(`[commands] ${slashTokenOf(next.text)} failed to run: ${redactDshSecrets(dshErrorText(error))}`)
          return
        }
        if (this.client !== client) return
      }
    } finally {
      this.drainingCommands = false
    }
  }

  private async resolveInput(text: string): Promise<{ route: SlashRoute; command: CommandDescriptor | undefined }> {
    if (!text.trimStart().startsWith('/')) return { route: { kind: 'prompt' }, command: undefined }
    const client = this.requireClient()
    const sessionId = this._state.sessionId
    const generation = this.sessionLoadGeneration
    // An invalidated catalog must settle before an unknown slash name can become a prompt.
    const [commands, skills] = await Promise.all([client.listCommands(sessionId), client.listSkills(sessionId)])
    if (this.client !== client || generation !== this.sessionLoadGeneration || this._state.phase !== 'ready') {
      throw new Error('The conversation changed. Send the message again in the intended conversation.')
    }
    const route = routeSlashInput(text, commands.filter(command => command.name !== 'export'), skills)
    return { route, command: route.kind === 'command' ? commands.find(command => command.name === route.name) : undefined }
  }

  async selectAgentPreset(id: string): Promise<void> {
    this.requireReady()
    const current = this._state.agentPreset
    if (!current.available || current.locked || current.busy || id === current.current) return
    if (!current.options.some(option => option.id === id)) throw new Error(`Unknown DeepSeek agent preset: ${id}`)
    const client = this.requireClient()
    const sessionId = this._state.sessionId
    const generation = this.sessionLoadGeneration
    if (sessionId === '') return
    this.publish({ agentPreset: selectAgentPresetState(current, id, true) })
    try {
      await client.selectAgentPreset(sessionId, id)
      if (this.client !== client || generation !== this.sessionLoadGeneration) return
      this.publish({
        // The sequenced projection may already include a newer selection from another client.
        agentPreset: { ...this._state.agentPreset, busy: false },
        commands: [],
        skills: [],
      })
      await Promise.all([
        this.loadCommands(client, sessionId),
        this.loadSkills(client, sessionId),
        this.loadModels(sessionId),
      ])
    } catch (error) {
      if (this.client === client && generation === this.sessionLoadGeneration) {
        const selected = this.summaries.find(item => item.sessionId === sessionId)?.agentPreset ?? current.current
        this.publish({ agentPreset: selectAgentPresetState(this._state.agentPreset, selected, false) })
      }
      throw error
    }
  }

  /**
   * Request cancellation of the active turn.
   *
   * DSH admits the request synchronously and the agent stops at its next
   * interruptible point, so the acknowledgement is published before the RPC:
   * waiting for the round trip left the button inert for up to 30 s during a
   * long tool call. A session owned by subagent routing is stopped through its
   * parent, because `session/cancel` refuses those.
   *
   * The local `running` flag can be stale when several windows share one
   * runtime: this window may have missed the status event (stale-false), or a
   * turn that already finished elsewhere can leave it true. A stop click is
   * therefore always forwarded — the Host treats an idle cancel as a safe
   * no-op — and the acknowledgement is only claimed while the turn is known to
   * be running here.
   */
  async cancel(): Promise<void> {
    const sessionId = this._state.sessionId
    if (sessionId === '') throw new Error('Open a conversation before asking DeepSeek to stop.')
    const client = this.requireClient()
    const parentSessionId = this._state.parentSessionId
    const acknowledged = this._state.running === true
    if (acknowledged) {
      // Optimistic feedback: the RPC can take seconds, but the click has landed.
      this.stoppingSessionId = sessionId
      this.cancelRequestedSessionId = sessionId
      this.clearStoppingDeadline()
      this.publish({ stopping: true, cancelRequested: true })
    }
    try {
      await (parentSessionId === null
        ? client.cancel(sessionId)
        : client.interruptSubagent(sessionId, parentSessionId))
    } catch (error) {
      if (this.client === client && this._state.sessionId === sessionId && acknowledged) {
        this.clearStoppingAcknowledgement()
        this.publish({ stopping: false, cancelRequested: false })
      }
      if (isConversationHeld(error)) {
        // Another DSH process owns the conversation. A stop from this window
        // cannot reach it, so the banner already used by the composer is the
        // honest answer instead of a silent rollback.
        this.markConversationHeld(sessionId)
        this.output.appendLine(`[cancel] ${sessionId} is held by another DSH process; the stop request was not delivered`)
        return
      }
      throw error
    }
    if (this.client !== client || this._state.sessionId !== sessionId) return
    this.output.appendLine(`[cancel] requested for ${sessionId}${parentSessionId === null ? '' : ' (subagent)'}`)
    if (!acknowledged) {
      // The click was forwarded on a stale-false flag: ask the runtime's own
      // list what it believes so a still-running turn gets its Stop control
      // back (and an idle one stays cleanly idle).
      void this.recheckRunning(sessionId)
      return
    }
    // Keep the acknowledgement and bound it. The Host ack is synchronous; only
    // the turn's own end (or the runtime's list) proves completion.
    this.stoppingSessionId = sessionId
    this.cancelRequestedSessionId = sessionId
    this.armStoppingDeadline(sessionId)
  }

  /**
   * Turn the acknowledgement into a retryable request after a short window.
   *
   * The request is cooperative, so a turn inside a long tool call legitimately
   * stays running after the Host acknowledged the cancel. At the deadline the
   * button becomes usable again as "Stop requested", and the runtime's list is
   * consulted once: if the conversation is idle there, nothing else will ever
   * clear the acknowledgement, so it is cleared here instead.
   */
  private armStoppingDeadline(sessionId: string): void {
    this.clearStoppingDeadline()
    this.stoppingDeadline = setTimeout(() => {
      this.stoppingDeadline = undefined
      if (this.stoppingSessionId !== sessionId) return
      this.stoppingSessionId = undefined
      if (this._state.sessionId !== sessionId || this._state.running !== true) return
      this.cancelRequestedSessionId = sessionId
      this.output.appendLine(`[cancel] ${sessionId} acknowledged; still running, waiting for the current step to finish`)
      this.publish({ stopping: false, cancelRequested: true })
      // Bound the wait: the Host sends no second status for an idle cancel.
      void this.recheckRunning(sessionId, true)
    }, STOPPING_ACKNOWLEDGEMENT_MS)
  }

  /**
   * Re-read the runtime's live `running` flag for one conversation.
   *
   * `session/list` reports the Host's own agent status. It is the only
   * authority that can end an acknowledgement the event stream will never
   * settle, because an idle cancel is accepted without producing any event.
   * Failures are logged, never surfaced: this is a correction of the local
   * view, not a user action of its own.
   */
  private async recheckRunning(sessionId: string, keepRequest = false): Promise<void> {
    const client = this.client
    if (client === undefined || sessionId !== this._state.sessionId) return
    const loadGeneration = this.sessionLoadGeneration
    let listed: SessionSummary | undefined
    try {
      const { items } = await client.listSessions()
      listed = items.find(item => item.sessionId === sessionId)
    } catch (error) {
      if (this.client !== client) return
      this.output.appendLine(`[cancel] Could not re-check whether ${sessionId} is still running: ${redactDshSecrets(dshErrorText(error))}`)
      return
    }
    // A conversation switch (or a newer load) owns the state now: this answer
    // belongs to a view that is no longer on screen.
    if (this.client !== client || this._state.sessionId !== sessionId || loadGeneration !== this.sessionLoadGeneration) return
    // A missing session has no live agent, so it cannot be running.
    const running = listed?.running === true
    this.runtimeActivity.set(sessionId, { running, revision: ++this.activityRevision })
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    if (summary !== undefined && summary.running !== running) {
      summary.running = running
      this.publishSessionItems()
    }
    this.stoppingSessionId = undefined
    this.clearStoppingDeadline()
    if (running) {
      if (keepRequest) this.cancelRequestedSessionId = sessionId
      this.output.appendLine(`[cancel] ${sessionId} is still running after the stop request`)
      this.publish(keepRequest
        ? { ...this.runningPatch(true, sessionId), stopping: false, cancelRequested: true }
        : this.runningPatch(true, sessionId))
      return
    }
    this.clearStoppingAcknowledgement()
    this.output.appendLine(`[cancel] ${sessionId} is no longer running`)
    this.publish(this.runningPatch(false, sessionId))
  }

  /** Withdraw a pending stop acknowledgement and any request of this turn. */
  private clearStoppingAcknowledgement(): void {
    this.stoppingSessionId = undefined
    this.cancelRequestedSessionId = undefined
    this.clearStoppingDeadline()
  }

  /** Withdraw only the deadline of a pending stop acknowledgement. */
  private clearStoppingDeadline(): void {
    if (this.stoppingDeadline === undefined) return
    clearTimeout(this.stoppingDeadline)
    this.stoppingDeadline = undefined
  }

  private runningPatch(running: boolean, sessionId: string = this._state.sessionId): Pick<ChatViewState, 'running' | 'stopping' | 'cancelRequested' | 'turnStartedAt' | 'turnActivityAt'> {
    // An acknowledgement belongs to the turn it was requested for, and a turn
    // that starts now is never that turn: clear the previous request first, or
    // a new turn inside the window inherits a disabled Stop button.
    const continuingTurn = running && this._state.running && this.turnClockSessionId === sessionId
    if (!continuingTurn) {
      this.clearStoppingAcknowledgement()
    } else {
      if (this.stoppingSessionId !== sessionId) this.stoppingSessionId = undefined
      if (this.cancelRequestedSessionId !== sessionId) this.cancelRequestedSessionId = undefined
    }
    const stopping = running && this.stoppingSessionId === sessionId
    if (!stopping) {
      this.clearStoppingDeadline()
      this.stoppingSessionId = undefined
    }
    const cancelRequested = running && this.cancelRequestedSessionId === sessionId
    if (!cancelRequested) this.cancelRequestedSessionId = undefined
    this.turnClock(running, sessionId)
    return { running, stopping, cancelRequested, turnStartedAt: this.turnStartedAt, turnActivityAt: this.turnActivityAt }
  }

  /**
   * Keep the running-turn clock honest: it starts when a turn is first reported
   * running, follows the conversation on screen, and drops to zero otherwise.
   *
   * A conversation opened while it is already running counts from the moment it
   * was opened: DSH's turn start is not part of any frame the sidebar reads, and
   * claiming an exact start it never saw would be worse than an honest lower
   * bound.
   */
  private turnClock(running: boolean, sessionId: string): void {
    if (!running) {
      this.turnStartedAt = 0
      this.turnActivityAt = 0
      this.turnClockSessionId = ''
      return
    }
    if (this.turnStartedAt === 0 || this.turnClockSessionId !== sessionId) {
      this.turnStartedAt = Date.now()
      this.turnActivityAt = this.turnStartedAt
      this.turnClockSessionId = sessionId
    }
  }

  /**
   * A frame arrived for the running turn, so it is working rather than silent.
   *
   * The clock alone cannot tell a stalled turn from a busy one, because it ticks
   * either way; this is the half that can.
   */
  private noteTurnActivity(): Pick<ChatViewState, 'turnActivityAt'> {
    if (this._state.running) this.turnActivityAt = Date.now()
    return { turnActivityAt: this.turnActivityAt }
  }

  async updateQueue(sessionId: string, itemId: string, action: 'edit' | 'remove' | 'steer', text?: string): Promise<void> {
    if (sessionId === '' || sessionId !== this._state.sessionId || this._state.phase !== 'ready') {
      throw new Error('The conversation changed. Use the queue in the current conversation.')
    }
    const item = this._state.queue.find(item => item.id === itemId)
    if (item?.placement !== 'queued') throw new Error('This message is no longer queued.')
    if (action === 'steer' && !this._state.running) throw new Error('Steering is available only while DeepSeek is running.')
    let request: QueueAction
    if (action === 'edit') {
      const replacement = text?.trim()
      if (replacement === undefined || replacement === '') throw new Error('Queued messages cannot be empty.')
      const original = this.queueRawText.get(itemId)
      if (item.text === null || original === undefined) throw new Error('Messages with attachments cannot be edited.')
      request = {
        kind: 'edit',
        content: [{
          type: 'text',
          text: replaceTextPreservingIdeContext(original, replacement),
        }],
      }
    } else {
      request = { kind: action }
    }
    await this.requireClient().updateQueue(sessionId, itemId, request)
  }

  async selectModel(selection: ModelSelection): Promise<void> {
    this.requireReady()
    const sessionId = this._state.sessionId
    const client = this.requireClient()
    const generation = this.sessionLoadGeneration
    if (sessionId === '') return
    await client.selectModel(sessionId, selection)
    if (this.client === client && generation === this.sessionLoadGeneration) await this.loadModels(sessionId)
  }

  async pluginInventory(): Promise<PluginInventorySnapshot> {
    const client = this.requireClient()
    const inventory = await client.pluginInventory()
    if (this.client !== client) throw new Error('The DSH runtime changed. Refresh the plugin inventory.')
    return inventory
  }

  async settings(): Promise<SettingsDescription> {
    const client = this.requireClient()
    const description = await client.settings()
    if (this.client !== client) throw new Error('The DSH runtime changed. Reopen runtime settings.')
    for (const namespace of description.namespaces) this.settingsOwners.set(namespace, client)
    return description
  }

  /** Bind a settings surface to the exact client that supplied its namespace. */
  settingsClient(namespace?: SettingsNamespace): DshClient {
    const client = this.requireClient()
    if (namespace && this.settingsOwners.get(namespace) !== client) throw new Error('The DSH runtime changed. Refresh settings before continuing.')
    return client
  }

  mutateSettings(namespace: SettingsNamespace, ops: SettingsMutation[]): Promise<SettingsNamespace> {
    this.requireReady()
    if (runtimeIsNotOurs(this.runtimeOwnership)) throw new Error('This external runtime is attach-only. Use a managed runtime to edit settings.')
    const client = this.requireClient()
    if (this.settingsOwners.get(namespace) !== client) throw new Error('The DSH runtime changed. Reopen runtime settings before saving.')
    // A restart-required namespace is a setting the runtime itself accepts: it
    // reports whether a restart is needed and the sidebar shows that result.
    // Refusing it here only because a turn or job is running blocked the user
    // from changing settings DSH is willing to change.
    return client.mutateSettings(namespace.ns, ops, namespace.revision)
  }

  async answerApproval(rpcId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    this.requireReady()
    if (this._state.approval?.rpcId !== rpcId || this._state.approval.approvalId !== approvalId) throw new Error('This approval is no longer pending.')
    if (this._state.sessionId === '') return
    const client = this.requireClient()
    const generation = this.sessionLoadGeneration
    await client.respond(rpcId, {
      sessionId: this._state.sessionId,
      approvalId,
      outcome,
    })
    if (this.client === client && generation === this.sessionLoadGeneration && this._state.approval?.rpcId === rpcId) this.publish({ approval: null })
  }

  async answerQuestions(rpcId: string, answers: readonly QuestionAnswer[]): Promise<void> {
    this.requireReady()
    if (this._state.sessionId === '') return
    const pending = this._state.question
    if (pending?.rpcId !== rpcId) throw new Error('This question is no longer pending.')
    const expected = new Set(pending.questions.map(question => question.id))
    if (answers.length !== expected.size || answers.some(answer => !expected.has(answer.id))) {
      throw new Error('Every DeepSeek question needs an answer.')
    }
    const client = this.requireClient()
    const generation = this.sessionLoadGeneration
    await client.respond(rpcId, {
      sessionId: this._state.sessionId,
      answer: { answers },
    })
    if (this.client === client && generation === this.sessionLoadGeneration && this._state.question?.rpcId === rpcId) this.publish({ question: null })
  }

  /**
   * @param sessionId - the conversation the failed action belonged to. The caller
   *   knows it; the visible conversation may already be a different one, and a
   *   held conversation marked on the wrong row disables an input the user can
   *   still write to.
   */
  report(error: unknown, sessionId: string = this._state.sessionId): void {
    const message = redactDshSecrets(dshErrorText(error))
    // The notice is what the user reads; the channel keeps the original text,
    // which is where an absolute path or a provider's wording belongs.
    const raw = redactDshSecrets(dshFailure(error).message)
    this.output.appendLine(`[chat] ${raw === message ? message : `${message} (${raw})`}`)
    if (isConversationHeld(error) && sessionId !== '') {
      // A held conversation says the same thing for every action the user tries,
      // so it belongs in the banner rather than as a notice per attempt.
      this.markConversationHeld(sessionId)
      return
    }
    this.projector.notice(`error:${String(Date.now())}`, message, true)
    this.publish({ messages: this.projectedMessages(), ...this.messageMetaPatch() })
  }

  dispose(): void {
    this.disposed = true
    ++this.runtimeSwitchRevision
    this.stopAccountPoll()
    this.clearStoppingDeadline()
    this.cancelRecovery()
    ++this.generation
    this.disconnectClient()
    this.changes.dispose()
    this.settingsChanges.dispose()
  }

  private requireClient(): DshClient {
    if (this.client === undefined) throw new Error('DeepSeek Harness is not connected.')
    return this.client
  }

  /**
   * Read the account state, and refresh until an in-flight sign-in settles.
   *
   * DSH exposes `account/watch`, but the sidebar polls instead: a poll is
   * bounded (it stops at a terminal phase or when the user leaves) and needs no
   * fifth baseline stream alongside `$events`, `session/control`,
   * `workspace/follow` and `session/follow`.
   */
  async refreshAccount(force = true): Promise<void> {
    const client = this.client
    if (client === undefined) {
      this.publish(this.accountPatch(unavailableAccountState()))
      return
    }
    // Account facts are runtime-wide: switching conversations must not re-read
    // them. Events and sign-in polling pass force=true to bypass this.
    if (!force && this.accountClient === client) return
    try {
      const view = await client.accountState()
      if (this.client !== client) return
      const pending = accountStateOf(view)
      let details: { profile?: unknown; balance?: unknown } = {}
      if (pending.signedIn) {
        // Profile and balance are separate reads whose failure only means the
        // sidebar shows less; neither may turn into a visible error.
        const metadata = accountClientMetadata(this.extensionVersion, vscode.env.language)
        const [profile, balance] = await Promise.all([
          client.accountProfile(metadata).catch(() => undefined),
          client.accountBalance(metadata).catch(() => undefined),
        ])
        if (this.client !== client) return
        details = { profile, balance }
      }
      const account = accountStateOf(view, details)
      this.accountClient = client
      this.publish(this.accountPatch(account))
      this.scheduleAccountPoll(account)
      await this.openAuthorizeUrl(account)
    } catch (error) {
      if (this.client !== client) return
      // A runtime without the account controller is a supported deployment; any
      // other failure is ours, and must stay distinguishable in the log rather
      // than hiding behind the same "unavailable" state.
      const failure = dshFailure(error)
      const missing = failure.message.includes('unknown method') || failure.message.includes('not found')
      this.output.appendLine(missing
        ? '[account] not available on this runtime'
        : `[account] unexpected failure (${failure.code ?? 'no code'}): ${failure.message}`)
      // Only a runtime without the account service is cached as "read": an
      // ordinary failure must be retried by the next switch or explicit call.
      if (missing) this.accountClient = client
      this.publish(this.accountPatch(unavailableAccountState()))
      this.stopAccountPoll()
    }
  }

  /** Render the account row for one state, so every publish site agrees. */
  private accountPatch(account: AccountState): Pick<ChatViewState, 'account' | 'accountNotice' | 'accountFailed'> {
    if (!account.available) return { account, accountNotice: null, accountFailed: false }
    return { account, accountNotice: ACCOUNT_NOTICE(account), accountFailed: accountAttemptFailed(account) }
  }

  /** Start browser sign-in and hand the authorize URL to the user's browser. */
  async signIn(): Promise<void> {
    this.requireReady()
    const client = this.requireClient()
    const callbackOrigin = await this.accountCallbackOrigin(client)
    if (callbackOrigin === undefined) {
      throw new Error('Sign-in needs a browser-reachable loopback address. Run DeepSeek Harness on this machine, or forward its port over SSH, then try again.')
    }
    const metadata = accountClientMetadata(this.extensionVersion, vscode.env.language)
    const view = await client.startAccountSignIn(metadata, callbackOrigin, 'desktop')
    if (this.client !== client) return
    const account = accountStateOf(view)
    this.accountPollCount = 0
    this.publish(this.accountPatch(account))
    this.scheduleAccountPoll(account)
    await this.openAuthorizeUrl(account)
  }

  /**
   * Hand the authorize URL to the browser the first time it appears.
   *
   * `startSignIn` answers with phase `initializing` and no URL: the Host mints
   * it asynchronously, so the URL arrives on a later read. Opening only what the
   * start call returned would leave the user with a button that does nothing.
   */
  private async openAuthorizeUrl(account: AccountState): Promise<void> {
    const attemptId = account.attemptId
    if (attemptId === undefined || account.authorizeUrl === undefined) return
    if (this.openedSignInAttempt === attemptId) return
    this.openedSignInAttempt = attemptId
    try {
      await vscode.env.openExternal(vscode.Uri.parse(account.authorizeUrl))
    } catch (error) {
      // The URL stays in the menu for a manual open, and polling continues.
      this.output.appendLine(`[account] could not open the sign-in page: ${dshErrorText(error)}`)
    }
  }

  async cancelSignIn(): Promise<void> {
    const attemptId = this._state.account.attemptId
    if (attemptId === undefined) return
    const client = this.requireClient()
    const view = await client.cancelAccountSignIn(attemptId)
    if (this.client !== client) return
    const account = accountStateOf(view)
    this.publish(this.accountPatch(account))
    this.scheduleAccountPoll(account)
  }

  async signOut(): Promise<void> {
    this.requireReady()
    const client = this.requireClient()
    const metadata = accountClientMetadata(this.extensionVersion, vscode.env.language)
    const view = await client.signOutAccount(metadata)
    if (this.client !== client) return
    this.publish(this.accountPatch(accountStateOf(view)))
    this.openedSignInAttempt = undefined
    this.stopAccountPoll()
  }

  /**
   * The loopback origin the Platform returns the browser to. DSH accepts only
   * `http://localhost|127.0.0.1:<port>` — "for local or SSH-forwarded login" —
   * and `asExternalUri` is what produces that form on a remote host, because it
   * registers the runtime's port with VS Code's forwarder.
   */
  private async accountCallbackOrigin(client: DshClient): Promise<string | undefined> {
    let forwarded: vscode.Uri
    try {
      forwarded = await vscode.env.asExternalUri(vscode.Uri.parse(client.runtimeOrigin.href))
    } catch {
      return undefined
    }
    let url: URL
    try {
      url = new URL(forwarded.toString(true))
    } catch {
      return undefined
    }
    if (url.protocol !== 'http:') return undefined
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return undefined
    return url.port === '' ? undefined : url.origin
  }

  private scheduleAccountPoll(account: AccountState): void {
    this.stopAccountPoll()
    if (!accountAttemptActive(account)) {
      this.accountPollCount = 0
      return
    }
    // A host that never reaches a terminal phase must not poll forever; the
    // cap is generous enough to outlast the Platform's own attempt lifetime.
    if (this.accountPollCount >= MAX_ACCOUNT_POLLS) return
    this.accountPollCount += 1
    this.accountPoll = setTimeout(() => {
      this.accountPoll = undefined
      void this.refreshAccount(true)
    }, ACCOUNT_POLL_INTERVAL_MS)
  }

  private stopAccountPoll(): void {
    if (this.accountPoll === undefined) return
    clearTimeout(this.accountPoll)
    this.accountPoll = undefined
  }

  /** Stage one dropped file against the live connection; see {@link DshClient.uploadFile}. */
  uploadFile(sessionId: string, data: string, name?: string): Promise<FileUploadReceipt> {
    return this.requireClient().uploadFile(sessionId, data, name)
  }

  private requireReady(): void {
    if (this._state.phase !== 'ready') throw new Error('DSH is not connected. Wait for the conversation to reconnect before continuing.')
  }

  private disconnectClient(): void {
    this.catalogReads.clear()
    // The catalogue belongs to the runtime, so a replacement connection reads
    // its own: keeping the old one could offer a preset the new runtime lacks.
    this.permissionCatalog = undefined
    // Same for cot-translation: a capability probe answers for one connection.
    ++this.translationRevision
    this.translationClient = undefined
    this.publish({ translation: null })
    this.accountClient = undefined
    this.feedbackBySession.clear()
    this.jobsScanExpanded = false
    // A stop acknowledgement is a fact about a connection that is going away.
    this.clearStoppingAcknowledgement()
    this.publish({ subagentCatalogs: {} })
    this.stopAccountPoll()
    this.openedSignInAttempt = undefined
    this.publish(this.accountPatch(unavailableAccountState()))
    this.runtimeActivity.clear()
    // With no client this window can see nothing running anywhere: leaving the
    // summaries saying otherwise kept a Stop button that could only fail, and
    // `hasRunningTasks` rejecting a project or runtime switch until a reconnect
    // succeeded.
    for (const summary of this.summaries) { summary.running = false; summary.agentAvailable = false }
    this.jobsBySession.clear()
    this.jobErrors.clear()
    this.taskFeatures.bind(undefined)
    ++this.sessionListGeneration
    this.sessionAttention.clear()
    for (const dispose of this.clientDisposables.splice(0)) dispose()
    const client = this.client
    this.client = undefined
    this.attachmentLoads.clear()
    // Successful images can survive a reconnect to the same runtime. Failed
    // or cancelled loads must be retried by the replacement client.
    for (const [key, result] of this.attachmentResults) {
      if (result.error !== undefined) this.attachmentResults.delete(key)
    }
    client?.dispose()
    this.publish({ projectJobs: [], jobsStatus: null, workflows: [], childReadOnlyReason: this.childReadOnlyReason(this._state.sessionId) })
    this.settingsChanges.fire()
  }

  private async loadSessions(preferredId?: string, allowCreate = true): Promise<void> {
    const client = this.requireClient()
    const cwd = this.cwd
    const listGeneration = ++this.sessionListGeneration
    const selectionGeneration = this.sessionLoadGeneration
    const activityRevision = this.activityRevision
    const [{ items }] = await Promise.all([
      client.listSessions(),
      this.refreshArchivedSessions(client, listGeneration),
    ])
    if (this.client !== client || this.cwd !== cwd || listGeneration !== this.sessionListGeneration) return
    // The list is runtime-wide, so an activity entry it does not name belongs to
    // a session the runtime no longer has. Keeping such an entry would pin
    // `hasRunningTasks` true for the rest of the connection and block settings
    // changes DSH would accept. A revision newer than this snapshot is an event
    // that arrived while the request was in flight: that session may be new, so
    // it is kept and the loop below leaves it alone.
    const listed = new Set(items.map(summary => summary.sessionId))
    for (const [sessionId, activity] of this.runtimeActivity) {
      if (!listed.has(sessionId) && activity.revision <= activityRevision) this.runtimeActivity.delete(sessionId)
    }
    for (const summary of items) {
      // A list response must not undo a status notification received while it was in flight.
      if ((this.runtimeActivity.get(summary.sessionId)?.revision ?? -1) <= activityRevision) {
        this.runtimeActivity.set(summary.sessionId, { running: summary.running, revision: activityRevision })
      }
    }
    // Subagent sessions stay in the model: they are reached through the parent
    // conversation that owns them, and hiding them here was the whole reason
    // delegated work used to be invisible.
    this.summaries = items.filter(summary => summary.cwd === cwd)
      .map(summary => ({ ...summary, running: this.runtimeActivity.get(summary.sessionId)?.running ?? summary.running }))
    if (selectionGeneration !== this.sessionLoadGeneration) {
      this.publishSessionItems()
      return
    }
    const selectable = this.summaries.filter(summary => !this.archivedSessionIds.has(summary.sessionId))
    const preferredExists = preferredId === undefined
      ? undefined
      : selectable.some(summary => summary.sessionId === preferredId) ? preferredId : undefined
    const currentExists = selectable.some(summary => summary.sessionId === this._state.sessionId)
    // Only an explicit choice or the current session may land on a subagent;
    // a fresh project should open a conversation the user actually owns.
    const topLevel = selectable.filter(summary => summary.origin !== 'subagent')
    const selectedId = preferredExists
      ?? (currentExists ? this._state.sessionId : undefined)
      ?? [...topLevel].sort((left, right) => right.updatedAt - left.updatedAt).find(summary => !summary.blank)?.sessionId
      ?? topLevel[0]?.sessionId

    if (selectedId !== undefined && this.unreadSessionIds.delete(selectedId)) this.persistUnreadSessions()
    this.publish(this.sessionItemPatch(selectedId))
    if (selectedId === undefined) {
      if (!allowCreate) throw new Error('No conversation is available to restore. Start a new conversation after reconnecting the runtime.')
      const created = await client.createSession(this.cwd)
      if (this.client !== client || listGeneration !== this.sessionListGeneration || selectionGeneration !== this.sessionLoadGeneration) return
      // Empty conversations need not appear in the catalog yet. Re-listing and
      // creating again can loop without bound; open the returned identity once.
      await this.loadSession(created.sessionId)
      return
    }
    await this.loadSession(selectedId)
  }

  private async refreshArchivedSessions(client: DshClient, listGeneration: number): Promise<void> {
    try {
      const result = await client.listWorkspaces()
      if (this.client !== client || listGeneration !== this.sessionListGeneration) return
      this.archivedSessionIds = new Set(Array.isArray(result.archivedSessionIds) ? result.archivedSessionIds : [])
      this.pinnedSessionIds = new Set(Array.isArray(result.pinnedSessionIds) ? result.pinnedSessionIds : [])
      this.pinningAvailable = result.pinningAvailable === true
    } catch (error) {
      if (this.client !== client || listGeneration !== this.sessionListGeneration) return
      this.output.appendLine(`[sessions] Archive state is unavailable in this DSH version: ${error instanceof Error ? error.message : String(error)}`)
      this.archivedSessionIds.clear()
      this.pinnedSessionIds.clear()
      this.pinningAvailable = false
    }
  }

  private sessionItemPatch(selectedId: string | undefined = this._state.sessionId): Pick<ChatViewState, 'sessions' | 'archivedSessions' | 'pinnedSessionIds' | 'pinningAvailable' | 'parentSessionId'> {
    const parentSessionId = selectedId === undefined ? undefined : parentIdOf(this.summaries, selectedId)
    return {
      sessions: sessionItems(this.summaries, this.archivedSessionIds, selectedId, this.unreadSessionIds, this.sessionAttention,
        [...this.pinnedSessionIds]),
      archivedSessions: archivedSessionItems(this.summaries, this.archivedSessionIds, this.unreadSessionIds, this.sessionAttention),
      // The Host is the authority on pins; the Webview only reads this list.
      pinnedSessionIds: [...this.pinnedSessionIds],
      pinningAvailable: this.pinningAvailable,
      // Always present, and `null` rather than `undefined`, so the JSON
      // transport carries the change and clears a stale owner.
      parentSessionId: parentSessionId ?? null,
    }
  }

  private publishSessionItems(): void {
    this.publish(this.sessionItemPatch())
    this.publish({ childReadOnlyReason: this.childReadOnlyReason(this._state.sessionId), projectJobs: this.projectJobs(), jobsStatus: [...this.jobErrors.values()].join('\n') || null })
    this.monitorJobsForList()
  }

  /**
   * Monitor the conversations the first screen can show immediately.
   *
   * Opening a job subscription per saved conversation delayed the first paint
   * on large session lists. The selected and running conversations are read
   * first; an idle pass then broadens the scan without blocking anything.
   */
  private monitorJobsForList(): void {
    const client = this.client
    if (client === undefined) return
    const first = this.jobsScanExpanded
      ? this.summaries.map(summary => summary.sessionId)
      : this.summaries
        .filter(summary => summary.running || summary.sessionId === this._state.sessionId)
        .map(summary => summary.sessionId)
    client.monitorJobs(first)
    if (this.jobsScanExpanded) return
    this.jobsScanExpanded = true
    setTimeout(() => {
      if (this.client !== client) return
      client.monitorJobs(this.summaries.map(summary => summary.sessionId))
    }, 1_500)
  }

  private projectJobs(): ChatViewState['projectJobs'] {
    const jobs = new Map<string, ChatViewState['projectJobs'][number]>()
    for (const summary of this.summaries) for (const job of this.jobsBySession.get(summary.sessionId) ?? []) {
      if (!jobs.has(job.id)) jobs.set(job.id, { ...job, sessionId: summary.sessionId, sessionTitle: sessionTitle(summary) })
    }
    return [...jobs.values()]
  }

  private markRead(sessionId: string, deferPublish = false): void {
    if (!this.unreadSessionIds.delete(sessionId)) return
    this.persistUnreadSessions()
    // The ready publication that follows a successful open carries the same
    // list, so publishing here would rebuild it twice on every switch.
    if (!deferPublish) this.publishSessionItems()
  }

  private markUnread(sessionId: string): void {
    if (this.unreadSessionIds.has(sessionId)) return
    this.unreadSessionIds.add(sessionId)
    this.persistUnreadSessions()
  }

  private persistUnreadSessions(): void {
    void this.workspaceState.update(DshChatController.unreadStorageKey, [...this.unreadSessionIds])
      .then(undefined, error => {
        this.output.appendLine(`[sessions] Could not persist unread state: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  private async loadSession(sessionId: string): Promise<void> {
    const client = this.requireClient()
    const openedAt = Date.now()
    const loggedId = safeLogId(sessionId)
    this.output.appendLine(`[chat] opening conversation ${loggedId} (phase=${this._state.phase})`)
    const loadGeneration = ++this.sessionLoadGeneration
    const sessionChanged = sessionId !== this._state.sessionId
    // Keep the last durable snapshot while reopening the same conversation.
    // A different conversation must never inherit that snapshot on failure.
    if (sessionChanged) {
      this.historyEntries = []
      this.projector.reset([])
      // A stop acknowledgement belongs to the conversation it was requested
      // in; another conversation's Stop button must never inherit it.
      this.clearStoppingAcknowledgement()
    }
    this.queueRawText.clear()
    this.publish({
      phase: 'loading',
      // While the first connection is still opening its event streams, that
      // connection status is the useful message; a session load racing it must
      // not replace it with the generic loading line.
      statusText: this.streamsGate === undefined ? 'Loading project conversation…' : this._state.statusText,
      sessionId,
      ...(sessionChanged ? { messages: [], changedFiles: [] } : {}),
      // Loading is a boundary: the previous conversation's turn is not this
      // one's, and a stale Stop must not appear while the target is resolved.
      // The loaded summary restores `running` below.
      ...this.runningPatch(false, sessionId),
      queue: [],
      todos: [],
      team: null,
      // A command held for this conversation stays held; the dock is per
      // conversation, so it is republished rather than cleared.
      queuedCommands: this.queuedCommandItems(sessionId),
      approval: null,
      question: null,
      hasMoreHistory: false,
      loadingHistory: false,
    })
    const result = await (async () => {
      // `parentIdOf` only names a parent for a genuine subagent lineage (a fork
      // records one too, and is still an ordinary session).
      const opening = await client.openSession(sessionId, parentIdOf(this.summaries, sessionId))
      if (!opening.isCurrent()) return undefined
      // Model discovery is display metadata, not a precondition for showing the
      // conversation. The cached catalogue answers synchronously; a miss is
      // filled in after `ready` by `loadModels`, so a slow model RPC can no
      // longer add up to 30 s of extra loading to every conversation switch.
      return { opening, models: client.currentModels(sessionId) }
    })().catch((error: unknown) => {
      if (this.client !== client || loadGeneration !== this.sessionLoadGeneration) return undefined
      // Opening a conversation can fail for good reasons — it was archived in
      // another window, or a subagent's owner is gone. Left in `loading`, the
      // sidebar disables send, the picker and the session list with no way back;
      // the error phase is the one that offers recovery.
      const message = redactDshSecrets(dshErrorText(error))
      this.output.appendLine(`[chat] opening conversation ${loggedId} failed after ${String(Date.now() - openedAt)} ms: ${diagnosticText(message)}`)
      // A held conversation is readable but not writable from this window; the
      // banner says so, and the error phase below still offers the way out.
      if (isConversationHeld(error)) this.markConversationHeld(sessionId)
      this.publish({
        phase: 'error',
        statusText: message,
        setup: setupKindFor(this.cwd, 'error', message),
        sessionId,
        // The state now names this conversation, so its running flags have to
        // describe it too: the previous conversation's clock and Stop button
        // outlived the switch and belonged to a turn this conversation never had.
        ...this.runningPatch(this.summaries.find(item => item.sessionId === sessionId)?.running ?? false, sessionId),
      })
      throw error
    })
    if (result === undefined || this.client !== client || loadGeneration !== this.sessionLoadGeneration || !result.opening.isCurrent()) return
    const { opening, models } = result
    const { events, hasMore } = opening
    this.projector.reset(events)
    this.historyEntries = events
    this.guardedDirtyCalls.clear()
    this.queueRawText.clear()
    // A fresh look at the conversation: whether it is still held is re-established
    // by this open's own background resume, never carried over from the last one.
    this.occupancyHolders.delete(sessionId)
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    if (summary !== undefined) {
      summary.projections = { values: opening.projections }
      if (typeof opening.projections.agentPreset === 'string') summary.agentPreset = opening.projections.agentPreset
    }
    // The list read may finish before the stream subscription; an opened
    // conversation is ready only when both are done. Guards re-check after the
    // wait, because a newer load can supersede this one meanwhile.
    const gate = this.streamsGate
    if (gate !== undefined) await gate
    if (this.client !== client || loadGeneration !== this.sessionLoadGeneration || !opening.isCurrent()) return
    this.publish({
      phase: 'ready',
      statusText: '',
      setup: null,
      sessionId,
      messages: this.projectedMessages(), ...this.messageMetaPatch(),
      ...this.runningPatch(summary?.running ?? false, sessionId),
      approval: null,
      question: null,
      commands: [],
      skills: [],
      agentPreset: unavailableAgentPresetState(),
      usage: usageMeterStateOf(summary?.projections?.values),
      todos: todosOf(summary?.projections?.values?.todos),
      // The Team projection is the data source; `agentTeamOf` folds it into the
      // sorted view the sidebar renders and rejects a malformed value.
      team: agentTeamOf(summary?.projections?.values) ?? null,
      imageLimits: imageLimitsOf(summary?.projections?.values?.imageLimits),
      permissions: permissionPresetsFromCatalog(summary?.projections?.values?.permissions, this.permissionCatalog),
      messageFeedback: (() => {
        const cached = this.feedbackBySession.get(sessionId)
        return cached === undefined ? [] : [...cached.values()]
      })(),
      plan: planModeStateOf(summary?.projections?.values?.plan),
      changedFiles: this.diffReviews.rebuild(sessionId, this.cwd, events),
      queue: [],
      queuedCommands: this.queuedCommandItems(sessionId),
      // The owner of a subagent conversation is derived from the selection, and
      // nothing else republishes it: without this, opening a subagent left the
      // previous conversation's lineage in place, so the sidebar showed the wrong
      // owner and a stop request went to the wrong session.
      ...this.sessionItemPatch(sessionId),
      jobs: this.jobsBySession.get(sessionId) ?? [],
      hasMoreHistory: hasMore,
      loadingHistory: false,
      occupancyNotice: this.occupancyNoticeFor(sessionId),
      ...(models === undefined ? {} : this.modelPatch(models)),
    })
    // Ratings belong to the conversation, and the runtime is the authority on
    // them, so they are adopted after the conversation is shown rather than
    // blocking it.
    void this.loadFeedback(client, sessionId)
    // A command held for this conversation may have been waiting for a turn that
    // already ended while the user was somewhere else.
    void this.drainQueuedCommands()
    opening.activate()
    this.taskFeatures.select(sessionId, summary?.projections?.values ?? {})
    this.publish({ childReadOnlyReason: this.childReadOnlyReason(sessionId), workflows: workflowsOf(this.historyEntries.map(entry => entry.event)) })
    this.hydrateImages(client, sessionId)
    // Account state is per-runtime, not per-conversation, so the first ready
    // conversation is what makes the account control appear at all. Explicit
    // callers (events, sign-in polling, the UI) force a fresh read.
    void this.refreshAccount(false)
    void this.loadCommands(client, sessionId)
    void this.loadSkills(client, sessionId)
    void this.loadAgentPresets(client, sessionId)
    // The translation capability is runtime-wide, but a conversation becoming
    // active is another moment where the runtime may have just enabled it.
    void this.loadTranslation(client)
    // Fire-and-forget like the other discoveries: the conversation is already
    // shown, and `loadModels` catches its own failures.
    void this.loadModels(sessionId)
    this.output.appendLine(`[chat] conversation ${loggedId} opened in ${String(Date.now() - openedAt)} ms (${String(events.length)} event(s), running=${String(summary?.running === true)})`)
  }

  private async loadCommands(client: DshClient, sessionId: string): Promise<void> {
    const current = this.discoveryRequest('commands', client, sessionId)
    try {
      const commands = await client.listCommands(sessionId)
      if (current()) {
        const visibleCommands = commands.filter(command => command.name !== 'export')
        this.publish({
          commands: visibleCommands,
          plan: planModeWithCommandAvailability(
            planModeStateOf(this.summaries.find(item => item.sessionId === sessionId)?.projections?.values?.plan),
            visibleCommands.some(command => command.name === 'plan'),
          ),
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[commands] Discovery unavailable: ${message}`)
    }
  }

  private async loadSkills(client: DshClient, sessionId: string): Promise<void> {
    const current = this.discoveryRequest('skills', client, sessionId)
    try {
      const skills = await client.listSkills(sessionId)
      if (current()) this.publish({ skills })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[skills] Discovery unavailable: ${message}`)
    }
  }

  private async loadAgentPresets(client: DshClient, sessionId: string): Promise<void> {
    const current = this.discoveryRequest('presets', client, sessionId)
    try {
      const roster = await client.listAgentPresets()
      if (!current()) return
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      this.publish({ agentPreset: agentPresetStateOf(roster.presets, summary?.agentPreset, summary?.blank ?? false, this._state.agentPreset.busy) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[agent-preset] Discovery unavailable: ${message}`)
    }
  }

  /**
   * Load the runtime's permission preset catalogue.
   *
   * The projection only names the current preset, so the catalogue is what makes
   * the experimental `auto` preset selectable. This read is intentionally not
   * awaited by the connection path: a runtime that does not serve the method, or
   * one that fails to answer, leaves the built-in presets in place and the
   * conversation opens either way.
   */
  private async loadPermissionCatalog(client: DshClient): Promise<void> {
    let catalog: PermissionCatalog | undefined
    try {
      catalog = await client.permissionCatalog()
    } catch (error) {
      // Optional capability discovery: a client or runtime that cannot serve
      // the read must leave the built-in presets in place, never fail a start.
      this.output.appendLine(`[permissions] Preset catalogue unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (this.client !== client) return
    if (catalog === undefined) {
      this.output.appendLine('[permissions] Preset catalogue unavailable; using the built-in presets.')
      return
    }
    this.permissionCatalog = catalog
    if (this._state.phase !== 'ready' || this._state.sessionId === '') return
    const summary = this.summaries.find(item => item.sessionId === this._state.sessionId)
    this.publish({ permissions: permissionPresetsFromCatalog(summary?.projections?.values?.permissions, catalog) })
  }

  /**
   * Probe the runtime's cot-translation capability.
   *
   * Translation is a client-side RPC (`cotTranslation/translate`) rather than a
   * runtime push, so the sidebar must know the preference, the text ceiling and
   * whether the preferred provider is routable before it can offer anything.
   * The probe is intentionally quiet: a runtime without the experimental bundle
   * simply leaves `translation` null.
   */
  private async loadTranslation(client: DshClient, force = false): Promise<void> {
    if (!force && this.translationClient === client) return
    if (!force && this.translationProbe?.client === client) return this.translationProbe.promise
    const probe = this.probeTranslation(client)
    this.translationProbe = { client, promise: probe }
    try { await probe } finally {
      if (this.translationProbe?.promise === probe) this.translationProbe = undefined
    }
  }

  private async probeTranslation(client: DshClient): Promise<void> {
    const revision = ++this.translationRevision
    let limits: DshTranslationLimits | undefined
    let answered = false
    try {
      limits = await client.cotTranslationLimits()
      answered = true
    } catch (error) {
      // Optional capability discovery: a client or runtime that cannot serve
      // the read must leave the original reasoning text in place, never fail a
      // conversation load.
      this.output.appendLine(`[translation] Capability probe unavailable: ${error instanceof Error ? error.message : String(error)}`)
      limits = undefined
    }
    // A late answer from a replaced connection must not resurrect a capability.
    if (this.client !== client || revision !== this.translationRevision) return
    // Resolved (with or without a capability) is worth caching; a thrown read is
    // not, so the next switch can retry a transient failure.
    if (answered) this.translationClient = client
    this.publish({ translation: this.translationStateOf(limits) })
  }

  /** Map the wire limits to the UI state; a stale probe is the caller's concern. */
  private translationStateOf(limits: DshTranslationLimits | undefined): DshTranslationState | null {
    if (limits === undefined) return null
    return {
      provider: limits.preferences.provider,
      targetLanguage: translationTargetLanguage(limits.preferences.targetLanguage, vscode.env.language),
      // The Host answers limits whenever the capability exists. `availableProviders`
      // is deliberately not consulted here: routing failures belong to the
      // translate RPC, not to a client-side pre-check.
      available: true,
      maxTextChars: limits.maxTextChars,
    }
  }

  /**
   * Translate one reasoning fragment for the open conversation.
   *
   * The provider is the runtime's preference; `sessionId` is passed so the Host
   * can cache the translation. A conversation or connection change during the
   * call is an error rather than a silent success, so the request cannot be
   * attributed to the wrong conversation.
   */
  async translateReasoning(text: string): Promise<string> {
    this.requireReady()
    const state = this._state
    const translation = state.translation
    if (translation === null) throw new Error('Reasoning translation is not available on this runtime.')
    if (state.sessionId === '') throw new Error('Open a conversation before translating.')
    if (text === '' || text.length > translation.maxTextChars) throw new Error('This reasoning section is too long to translate in one request.')
    const client = this.requireClient()
    const sessionId = state.sessionId
    const translated = await client.cotTranslationTranslate({
      text,
      targetLanguage: translation.targetLanguage,
      provider: translation.provider,
      sessionId,
    })
    if (this.client !== client || this._state.sessionId !== sessionId || this._state.phase !== 'ready') {
      throw new Error('The conversation changed before the translation completed. Try again.')
    }
    return translated
  }

  private async loadModels(sessionId: string): Promise<void> {
    const client = this.requireClient()
    const current = this.discoveryRequest('models', client, sessionId)
    try {
      const models = await client.models(sessionId)
      if (current()) this.publish(this.modelPatch(models))
    } catch (error) {
      if (current()) this.output.appendLine(`[models] Discovery unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private discoveryRequest(kind: string, client: DshClient, sessionId: string): () => boolean {
    const request = (this.discoveryRequests.get(kind) ?? 0) + 1
    this.discoveryRequests.set(kind, request)
    const generation = this.sessionLoadGeneration
    return () => this.client === client && this._state.sessionId === sessionId
      && this._state.phase === 'ready' && this.sessionLoadGeneration === generation && this.discoveryRequests.get(kind) === request
  }

  private refreshComposition(sessionId: string): void {
    if (this.client === undefined || sessionId !== this._state.sessionId || this._state.phase !== 'ready') return
    this.publish({ commands: [], skills: [], plan: { ...this._state.plan, available: false } })
    void this.loadCommands(this.client, sessionId)
    void this.loadSkills(this.client, sessionId)
    void this.loadAgentPresets(this.client, sessionId)
  }

  private modelPatch(models: SessionModels): Pick<ChatViewState, 'models' | 'routable' | 'anyRoutable' | 'routableNotice'> {
    const options: ModelItem[] = []
    for (const group of models.groups) {
      for (const model of group.models) {
        const selected = group.id === models.current.provider && model.id === models.current.model
        options.push({
          provider: group.id,
          // A group without a name still has an id, which names the route.
          providerLabel: typeof group.name === 'string' && group.name !== '' ? group.name : group.id,
          model: model.id,
          label: model.name,
          selected,
          reasoningEfforts: (model.reasoning?.efforts ?? []).map(effort => ({
            id: effort.id,
            label: effort.name,
            selected: selected && effort.id === models.current.reasoningEffort,
          })),
          ...(model.reasoning?.defaultEffort === undefined
            ? {}
            : { defaultReasoningEffort: model.reasoning.defaultEffort }),
        })
      }
    }
    return {
      models: options,
      routable: models.routable,
      anyRoutable: models.anyRoutable,
      // Naming the way out matters when one exists: with another provider
      // routable, the picker is the fix, not a sign-in.
      routableNotice: models.routable
        ? null
        : (models.anyRoutable ? SELECTED_MODEL_UNAVAILABLE_TEXT : NO_ROUTABLE_PROVIDER_TEXT),
    }
  }

  private acceptFrame(frame: DshFrame): void {
    const payload = frame.payload
    const type = typeof payload.type === 'string' ? payload.type : ''
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
    this.taskFeatures.frame(frame)
    if (frame.channel === 'mux' && type === 'session/jobs-status') {
      if (typeof payload.error === 'string') this.jobErrors.set(sessionId, payload.error)
      else this.jobErrors.delete(sessionId)
      this.publish({ jobsStatus: [...this.jobErrors.values()].join('\n') || null })
      return
    }

    if (frame.channel === 'host') {
      if (sessionId !== '' && (type === 'host/session-added' || type === 'host/session-status' || type === 'host/session-removed')) {
        this.runtimeActivity.set(sessionId, { running: type !== 'host/session-removed' && payload.running === true,
          revision: ++this.activityRevision })
      }
      if (type === 'host/settings-changed' || type === 'host/credentials-changed' || type === 'host/models-changed'
        || type === 'host/account-changed' || type === 'host/plugins-changed') {
        this.settingsChanges.fire()
        // Provider preferences, routed providers and the experimental bundle can
        // all change the cot-translation capability without a reconnect.
        if (this.client !== undefined) void this.loadTranslation(this.client, true)
      }
      if (type === 'host/permission-catalog-changed' && this.client !== undefined) void this.loadPermissionCatalog(this.client)
      if (this.client !== undefined && this._state.phase === 'ready' && this._state.sessionId !== '') {
        const activeId = this._state.sessionId
        if (type === 'host/commands-changed') void this.loadCommands(this.client, activeId)
        if (type === 'host/models-changed' || type === 'host/settings-changed' || type === 'host/credentials-changed') void this.loadModels(activeId)
        if (type === 'host/settings-changed' && payload.ns === 'agent-preset-registry') void this.loadAgentPresets(this.client, activeId)
        if (type === 'host/session-composition-changed') this.refreshComposition(sessionId)
      }
    }

    if (frame.channel === 'mux' && type === 'session/assistant-stream' && sessionId === this._state.sessionId) {
      this.projector.applyStream(payload.update as AssistantStreamUpdate)
      this.publish({ messages: this.projectedMessages(), ...this.messageMetaPatch(), ...this.noteTurnActivity() })
      return
    }

    if (frame.channel === 'mux' && type === 'session/event' && sessionId === this._state.sessionId) {
      const event = payload.event
      if (typeof event === 'object' && event !== null) {
        const dshEvent = event as DshEvent
        if (dshEvent.type === 'user/message') {
          const summary = this.summaries.find(item => item.sessionId === sessionId)
          if (summary !== undefined) {
            summary.blank = false
            summary.updatedAt = Math.max(summary.updatedAt, dshEvent.time)
            this.publishSessionItems()
          }
          this.publish({ agentPreset: lockAgentPresetState(this._state.agentPreset) })
        }
        // Live events arrive in append order: an O(1) push replaces the full
        // Map+sort merge. A replay or a late page still goes through the merge.
        const previous = this.historyEntries.at(-1)
        if (previous === undefined || dshEvent.seq > previous.event.seq) {
          this.historyEntries.push({ event: dshEvent, view: payload.view })
        } else {
          this.historyEntries = mergeHistoryEntries(this.historyEntries, [{ event: dshEvent, view: payload.view }])
        }
        if (dshEvent.type.startsWith('tool-workflow/')) this.publish({ workflows: workflowsOf(this.historyEntries.map(entry => entry.event)) })
        // Only events that can carry a tool call, a file mutation or a turn
        // boundary need the dirty-file and review scans.
        const reviewCandidate = dshEvent.type.startsWith('tool/')
          || dshEvent.type === 'assistant/message' || dshEvent.type === 'turn/end'
        const conflict = reviewCandidate ? this.dirtyConflict(dshEvent, payload.view) : undefined
        if (conflict !== undefined) void this.cancelForDirtyConflict(conflict)
        this.projector.apply(dshEvent, payload.view)
        const changed = reviewCandidate ? this.diffReviews.accept(sessionId, this.cwd, dshEvent, payload.view) : false
        if (conflict !== undefined) {
          const label = conflict.paths.length === 1
            ? `\`${conflict.paths[0] ?? 'file'}\``
            : `${String(conflict.paths.length)} files`
          this.projector.notice(
            `dirty-file:${conflict.callId}`,
            `DeepSeek stopped because ${label} has unsaved VS Code changes. Save or discard them, then retry.`,
            true,
          )
        }
        this.publish({
          messages: this.projectedMessages(), ...this.messageMetaPatch(), ...this.noteTurnActivity(),
          ...(changed ? { changedFiles: this.diffReviews.changedFiles(sessionId) } : {}),
        })
        // Only these event kinds can add an image reference; other events have
        // nothing to hydrate and would rescan the whole transcript.
        if (dshEvent.type === 'user/message' || dshEvent.type === 'assistant/message' || dshEvent.type === 'tool/result') {
          this.hydrateImages(this.requireClient(), sessionId)
        }
      }
      return
    }

    if (frame.channel === 'mux' && type === 'session/subscribed' && sessionId === this._state.sessionId) {
      this.queueRawText.clear()
      this.jobsBySession.set(sessionId, [])
      this.publish({ queue: [], jobs: [] })
      return
    }

    if (frame.channel === 'mux' && type === 'session/subscribed') {
      this.jobsBySession.set(sessionId, [])
      return
    }

    if (frame.channel === 'mux' && type === 'session/jobs') {
      const jobs = jobsSnapshotOf(payload.jobs)
      this.jobsBySession.set(sessionId, jobs)
      if (sessionId === this._state.sessionId) this.publish({ jobs })
      this.publish({ projectJobs: this.projectJobs() })
      return
    }

    if (frame.channel === 'mux' && type === 'session/queue' && sessionId === this._state.sessionId) {
      const snapshot = queueSnapshotOf(payload.items)
      this.queueRawText = snapshot.rawText
      this.publish({ queue: snapshot.items })
      return
    }

    if (frame.channel === 'mux' && type === 'approval/requested' && sessionId === this._state.sessionId) {
      if (typeof payload.approvalId !== 'string' || typeof payload.toolName !== 'string') return
      // Auto review's ask path carries a localized display reason; DSH's own
      // approval panel prefers it over the audited English `reason`.
      const display = payload.displayReason
      const displayText = wireRecord(display) && typeof display.en === 'string' && display.en.trim() !== ''
        ? display.en
        : undefined
      const reason = displayText ?? (typeof payload.reason === 'string' ? payload.reason : undefined)
      this.publish({
        approval: {
          rpcId: frame.rpcId,
          approvalId: payload.approvalId,
          toolName: payload.toolName,
          ...(reason === undefined ? {} : { reason }),
        },
      })
      return
    }

    if (frame.channel === 'mux' && type === 'approval/resolved' && sessionId === this._state.sessionId) {
      if (this._state.approval?.approvalId === payload.approvalId) this.publish({ approval: null })
      return
    }

    if (frame.channel === 'mux' && type === 'question/requested' && sessionId === this._state.sessionId) {
      if (!Array.isArray(payload.questions)) return
      const questions = payload.questions.flatMap((value): QuestionItem[] => {
        if (typeof value !== 'object' || value === null) return []
        const item = value as Record<string, unknown>
        if (typeof item.id !== 'string' || typeof item.question !== 'string') return []
        const options = Array.isArray(item.options)
          ? item.options.flatMap((option): QuestionOption[] => {
            if (typeof option !== 'object' || option === null) return []
            const candidate = option as Record<string, unknown>
            if (typeof candidate.label !== 'string') return []
            return [{
              label: candidate.label,
              ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
            }]
          })
          : []
        return [{
          id: item.id,
          question: item.question,
          ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
          ...(typeof item.header === 'string' ? { header: item.header } : {}),
          options,
          multiSelect: item.multiSelect === true,
        }]
      })
      if (questions.length > 0) this.publish({ question: { rpcId: frame.rpcId, questions } })
      return
    }

    if (frame.channel === 'mux' && type === 'question/resolved' && sessionId === this._state.sessionId) {
      if (this._state.question?.rpcId === payload.questionRpcId) this.publish({ question: null })
      return
    }

    if (frame.channel === 'mux' && type === 'session/projection') {
      this.taskFeatures.projection(sessionId, String(payload.key), payload.value)
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      if (summary !== undefined && typeof payload.key === 'string') {
        summary.projections = { values: { ...summary.projections?.values, [payload.key]: payload.value } }
      }
      // Only keys the list actually renders: title, subagent presence and
      // subagent timing. tokenUsage belongs to the open conversation's meter
      // and must not rebuild every session row.
      if ((typeof payload.value === 'string' && payload.key === 'title')
        || payload.key === 'subagentCatalog' || payload.key === 'subagent'
        || payload.key === 'subagentTiming') {
        this.publishSessionItems()
      }
      if (payload.key === 'todos' && sessionId === this._state.sessionId) {
        this.publish({ todos: todosOf(payload.value) })
      }
      if (payload.key === 'agentTeam' && sessionId === this._state.sessionId) {
        // Use the merged summary so an unrelated projection frame cannot clear
        // the roster; the frame's own value is enough when no summary exists.
        this.publish({
          team: agentTeamOf(summary?.projections?.values ?? { agentTeam: payload.value }) ?? null,
        })
      }
      if (payload.key === 'imageLimits' && sessionId === this._state.sessionId) {
        this.publish({ imageLimits: imageLimitsOf(payload.value) })
      }
      if (payload.key === 'permissions' && sessionId === this._state.sessionId) {
        this.publish({ permissions: permissionPresetsFromCatalog(payload.value, this.permissionCatalog) })
      }
      if (payload.key === 'plan' && sessionId === this._state.sessionId) {
        this.publish({ plan: planModeWithCommandAvailability(planModeStateOf(payload.value), this._state.commands.some(command => command.name === 'plan')) })
      }
      if (payload.key === 'agentPreset' && typeof payload.value === 'string') {
        if (summary !== undefined) summary.agentPreset = payload.value
        if (sessionId === this._state.sessionId) {
          this.publish({ agentPreset: selectAgentPresetState(this._state.agentPreset, payload.value, false) })
          this.refreshComposition(sessionId)
        }
      }
      if (payload.key === 'modelSelection' && sessionId === this._state.sessionId) {
        const models = this.client?.currentModels(sessionId)
        if (models !== undefined) this.publish(this.modelPatch(models))
      }
      if ((payload.key === 'tokenUsage'
        || payload.key === 'sessionStats'
        || payload.key === 'contextPressure'
        || payload.key === 'contextBreakdown')
        && sessionId === this._state.sessionId) {
        this.publish({ usage: usageMeterStateOf(summary?.projections?.values) })
      }
      return
    }

    if (frame.channel === 'host' && type === 'host/session-attention') {
      const approvals = typeof payload.approvals === 'number' ? payload.approvals : 0
      const questions = typeof payload.questions === 'number' ? payload.questions : 0
      if (approvals + questions > 0) this.sessionAttention.set(sessionId, { approvals, questions })
      else this.sessionAttention.delete(sessionId)
      this.publishSessionItems()
      return
    }

    if (frame.channel === 'host' && type === 'host/session-activity') {
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      if (summary !== undefined && typeof payload.updatedAt === 'number' && Number.isFinite(payload.updatedAt)) {
        summary.updatedAt = Math.max(summary.updatedAt, payload.updatedAt)
        summary.blank = false
        this.publishSessionItems()
      }
      return
    }

    if (frame.channel === 'host' && (type === 'host/session-status' || type === 'host/session-removed')) {
      const running = type === 'host/session-status' && payload.running === true
      // An agent this window can see running is one this window can write to.
      if (running) this.clearConversationHeld(sessionId)
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      const wasRunning = summary?.running === true
      if (summary !== undefined) {
        summary.running = running
        summary.agentAvailable = type !== 'host/session-removed'
        if (running) summary.blank = false
      }
      if (type === 'host/session-removed') {
        this.sessionAttention.delete(sessionId)
        this.jobsBySession.delete(sessionId)
        this.jobErrors.delete(sessionId)
        // Nothing will consume a command held for a conversation that is gone.
        if (this.queuedCommands.delete(sessionId)) this.publishQueuedCommands(sessionId)
        if (sessionId === this._state.sessionId) {
          this.queueRawText.clear()
          this.publish({ approval: null, question: null, queue: [], jobs: [], todos: [] })
        }
      }
      if (wasRunning && !running && sessionId !== this._state.sessionId) this.markUnread(sessionId)
      if (sessionId === this._state.sessionId) {
        this.publish(this.runningPatch(running))
        // The turn this command was waiting behind is over: run it now, unless the
        // runtime has another queued message about to start the next one.
        if (wasRunning && !running) void this.drainQueuedCommands()
      }
      this.publishSessionItems()
      return
    }

    if (frame.channel === 'host' && type === 'host/pinned-sessions-changed') {
      const pinned = Array.isArray(payload.pinnedSessionIds)
        ? payload.pinnedSessionIds.filter((value): value is string => typeof value === 'string')
        : []
      this.pinnedSessionIds = new Set(pinned)
      this.pinningAvailable = true
      this.publishSessionItems()
      return
    }

    if (frame.channel === 'host' && type === 'host/archived-sessions-changed') {
      const archived = Array.isArray(payload.archivedSessionIds)
        ? payload.archivedSessionIds.filter((value): value is string => typeof value === 'string')
        : []
      this.archivedSessionIds = new Set(archived)
      for (const id of archived) this.unreadSessionIds.delete(id)
      this.persistUnreadSessions()
      void this.loadSessions().catch(error => { this.report(error) })
      return
    }

    if (frame.channel === 'host' && type === 'host/account-changed') {
      // `deepseek-account/signed-out` and `session-expired` reach us as host
      // events; without this the sidebar would keep claiming a stale sign-in.
      void this.refreshAccount(true)
      return
    }

    if (frame.channel === 'host' && type === 'host/agent-error' && sessionId === this._state.sessionId) {
      // This channel carries text only, but DSH may prefix it with a code.
      const reported = typeof payload.message === 'string' ? payload.message : 'DeepSeek Harness reported an agent error.'
      if (isConversationHeld(reported)) {
        // Opening a conversation makes the host try to resume it. When another
        // process owns it that resume fails, which is not an error the user can
        // act on as an error — it is who holds the conversation.
        this.markConversationHeld(sessionId)
        return
      }
      const message = redactDshSecrets(dshErrorText(reported))
      this.projector.notice(`agent-error:${frame.rpcId}`, message, true)
      this.publish({ messages: this.projectedMessages(), ...this.messageMetaPatch(), ...this.runningPatch(false) })
      return
    }

    if (frame.channel === 'host' && type === 'host/session-added' && payload.cwd === this.cwd) {
      // Discovery must not steal focus or replace a snapshot currently loading.
      const existing = this.summaries.find(item => item.sessionId === sessionId)
      const summary: SessionSummary = { sessionId, cwd: this.cwd,
        ...(typeof payload.agentAvailable === 'boolean' ? { agentAvailable: payload.agentAvailable } : {}),
        updatedAt: Math.max(existing?.updatedAt ?? 0, typeof payload.updatedAt === 'number' ? payload.updatedAt : 0),
        running: payload.running === true, blank: payload.blank === true && existing?.blank !== false,
        ...(wireRecord(payload.projections) && wireRecord(payload.projections.values)
          ? { projections: { values: payload.projections.values } } : existing?.projections ? { projections: existing.projections } : {}),
        ...(typeof payload.agentPreset === 'string' ? { agentPreset: payload.agentPreset } : {}),
        ...(payload.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
        ...(typeof payload.parentSessionId === 'string' ? { parentSessionId: payload.parentSessionId } : {}) }
      if (existing === undefined) this.summaries.push(summary)
      else Object.assign(existing, summary)
      this.publishSessionItems()
    }
  }

  /**
   * The action row's data: timing for every message, and the turn fold once per
   * completed turn. Published beside the messages rather than inside them, since
   * the message shape is what the conversation contract and its tests pin.
   */
  /**
   * Record a rating, or withdraw the one that is already there.
   *
   * DSH guards every write with the version it expects, so the click has to be
   * resolved against what the runtime last confirmed. A conflict answers with the
   * authoritative item, which is exactly what to retry from, but a retry would
   * silently overrule another window's vote — so the fresh state is shown and the
   * click is not repeated.
   */
  async submitFeedback(sessionId: string, messageId: string, rating: MessageFeedbackRating): Promise<void> {
    const client = this.client
    if (client === undefined || sessionId !== this._state.sessionId) return
    let outcome: Awaited<ReturnType<DshClient['putMessageFeedback']>> | Awaited<ReturnType<DshClient['deleteMessageFeedback']>>
    try {
      const current = this.feedback.get(messageId)
      outcome = current !== undefined && current.rating === rating
        ? await client.deleteMessageFeedback(sessionId, messageId, current.version)
        : await client.putMessageFeedback(sessionId, messageId, rating, current?.version ?? null)
    } catch (error) {
      // A rating the runtime never recorded used to reject into nothing: the click
      // did nothing and said nothing, and the held-conversation case never reached
      // the banner that explains it.
      if (this.client === client) this.report(error, sessionId)
      return
    }
    if (this.client !== client || sessionId !== this._state.sessionId) return
    if (outcome.ok) {
      if ('absent' in outcome.value) this.feedback.delete(messageId)
      else this.feedback.set(messageId, outcome.value)
    } else {
      // A conflict carries the truth; adopt it rather than guess.
      if (outcome.error.current !== undefined) {
        if (outcome.error.current === null) this.feedback.delete(messageId)
        else this.feedback.set(messageId, outcome.error.current)
      }
      this.report(new DshConnectionError(outcome.error.code, outcome.error.message ?? outcome.error.code), sessionId)
    }
    if (this.feedback.size === 0) this.feedbackBySession.delete(sessionId)
    else this.feedbackBySession.set(sessionId, new Map(this.feedback))
    this.publish({ messageFeedback: [...this.feedback.values()] })
  }

  /** The latest closed turn's boundary facts, when the loaded window has one. */
  private latestTurnEnd(): { turn: number; seq: number; reasonKind: string } | undefined {
    const facts = this.projector.turnEndFacts()
    let latest: { turn: number; seq: number; reasonKind: string } | undefined
    for (const [turn, fact] of facts) {
      if (latest === undefined || turn > latest.turn) latest = { turn, seq: fact.seq, reasonKind: fact.reasonKind }
    }
    return latest
  }

  /** The newest successfully completed turn's `turn/end` seq, if any. */
  private lastSuccessfulTurnSeq(): number | undefined {
    const facts = this.projector.turnEndFacts()
    let best: { turn: number; seq: number } | undefined
    for (const [turn, fact] of facts) {
      if (fact.reasonKind !== 'completed' && fact.reasonKind !== 'max-tokens') continue
      if (best === undefined || turn > best.turn) best = { turn, seq: fact.seq }
    }
    return best?.seq
  }

  /**
   * The boundary a bare fork request should use.
   *
   * Deliberately stricter than DSH's menu: an omitted `atSeq` there means "last
   * completed-turn prefix", which includes a stopped or failed final turn. The
   * sidebar forks explicitly at the newest branchable turn's `turn/end`, falling
   * back to the last successful turn when the newest one did not complete. No
   * successful turn means the request is refused instead of creating a child
   * seeded with failure output.
   */
  private forkBoundaryOf(explicitAtSeq: number | undefined): { seq: number | undefined; refused: boolean } {
    if (explicitAtSeq !== undefined) return { seq: explicitAtSeq, refused: false }
    const latest = this.latestTurnEnd()
    if (latest === undefined) return { seq: undefined, refused: true }
    if (latest.reasonKind === 'completed' || latest.reasonKind === 'max-tokens') return { seq: latest.seq, refused: false }
    const successful = this.lastSuccessfulTurnSeq()
    return successful === undefined ? { seq: undefined, refused: true } : { seq: successful, refused: false }
  }

  /**
   * Copy the open conversation up to a point into a new one and open it.
   *
   * The child is a conversation of its own, so the list is reloaded before it is
   * selected; otherwise the selection would be refused as unknown. `atSeq` is
   * the inclusive `turn/end` seq of the turn the child may inherit; it is
   * omitted only when the caller leaves it out and the runtime's own
   * "last completed turn" boundary is safe (see `forkBoundaryOf`).
   */
  async forkConversation(sessionId: string, atSeq?: number): Promise<void> {
    const client = this.client
    if (client === undefined || sessionId !== this._state.sessionId) return
    try {
      const explicit = typeof atSeq === 'number' && Number.isFinite(atSeq) ? atSeq : undefined
      const boundary = this.forkBoundaryOf(explicit)
      if (boundary.refused) {
        this.report(new Error('This conversation has no completed turn to branch from. Finish a turn, then try again.'))
        return
      }
      const child = await client.forkSession(sessionId, boundary.seq)
      if (this.client !== client) return
      await this.loadSessions()
      if (this.client !== client) return
      // `selectSession` refuses a conversation the list does not know, and the
      // refreshed list may not carry the child yet. Opening it directly keeps the
      // click from doing nothing visible.
      if (this.summaries.some(summary => summary.sessionId === child)) await this.selectSession(child)
      else await this.loadSession(child)
    } catch (error) {
      this.report(error)
    }
  }

  /** Adopt the ratings the runtime holds for a conversation. */
  private async loadFeedback(client: DshClient, sessionId: string): Promise<void> {
    const cached = this.feedbackBySession.get(sessionId)
    if (cached !== undefined) {
      this.feedback.clear()
      for (const [messageId, item] of cached) this.feedback.set(messageId, item)
      if (sessionId === this._state.sessionId) this.publish({ messageFeedback: [...this.feedback.values()] })
      return
    }
    let outcome: Awaited<ReturnType<DshClient['messageFeedback']>>
    try {
      outcome = await client.messageFeedback(sessionId)
    } catch (error) {
      if (this.client !== client) return
      // A read nobody asked for must not put a notice in the transcript; a held
      // conversation is the one outcome that changes what the user can do, and
      // the unhandled rejection this used to produce reached no one at all.
      if (isConversationHeld(error)) this.markConversationHeld(sessionId)
      else this.output.appendLine(`[feedback] Ratings are unavailable: ${redactDshSecrets(dshErrorText(error))}`)
      return
    }
    if (this.client !== client || sessionId !== this._state.sessionId) return
    // A failed read keeps whatever is shown: wiping the ratings on a transient
    // error would tell the user their votes are gone.
    if (!outcome.ok) return
    this.feedback.clear()
    for (const item of outcome.value.items) this.feedback.set(item.messageId, item)
    // An empty answer is cheap to re-read and is the state another window can
    // change without an event; cache only the non-empty case.
    if (this.feedback.size === 0) this.feedbackBySession.delete(sessionId)
    else this.feedbackBySession.set(sessionId, new Map(this.feedback))
    this.publish({ messageFeedback: [...this.feedback.values()] })
  }

  private messageMetaPatch(): Pick<ChatViewState, 'messageMeta'> {
    const meta = this.projector.messageMeta()
    const footers = turnFooters(this.projector.messages(), meta, this.projector.turnStartTimes(), this.projector.turnEndFacts())
    const messageMeta: MessageMetaItem[] = []
    for (const [id, value] of meta) {
      messageMeta.push({ id, time: value.time, ...(footers.get(id) ?? {}) })
    }
    return { messageMeta }
  }

  private projectedMessages(): ConversationMessage[] {
    const sessionId = this._state.sessionId
    return this.projector.messages().map(message => message.images === undefined
      ? message
      : {
          ...message,
          images: message.images.map(image => ({
            ...image,
            ...this.attachmentResults.get(`${sessionId}\u0000${image.attachmentId}`),
          })),
        })
  }

  private hydrateImages(client: DshClient, sessionId: string): void {
    const images = this.projector.messages().flatMap(message => message.images ?? [])
    for (const image of images) {
      const key = `${sessionId}\u0000${image.attachmentId}`
      if (this.attachmentResults.has(key) || this.attachmentLoads.has(key)) continue
      // The whole projected reference goes to the client: alpha2 validates the
      // media type, byte length and dimensions, while rc.2/rc.3 read only the id.
      if (image.bytes === undefined) {
        this.output.appendLine(`[attachment] reference ${diagnosticText(image.attachmentId)} has no byte length; the runtime may refuse the read`)
      }
      const load = client.attachment(sessionId, image)
        .then((result) => {
          if (this.client !== client || this.attachmentLoads.get(key) !== load) return
          const attachment = result.attachment
          // The runtime answers with the stored reference; when both sides carry
          // a measurement they must agree, or the metadata shown would describe
          // a different image than the bytes.
          const mismatch = attachment.attachmentId !== image.attachmentId
            || attachment.mediaType !== image.mediaType
            || (image.bytes !== undefined && attachment.bytes !== image.bytes)
            || (attachment.width !== undefined && attachment.width !== image.width)
            || (attachment.height !== undefined && attachment.height !== image.height)
          if (mismatch) {
            throw new Error('DeepSeek Harness returned mismatched image metadata.')
          }
          this.attachmentResults.set(key, { data: result.data })
        })
        .catch((error: unknown) => {
          if (this.client !== client || this.attachmentLoads.get(key) !== load) return
          const detail = error instanceof Error ? error.message : String(error)
          this.output.appendLine(`[attachment] ${image.attachmentId}: ${detail}`)
          this.attachmentResults.set(key, { error: 'Image unavailable.' })
        })
        .finally(() => {
          if (this.attachmentLoads.get(key) !== load) return
          this.attachmentLoads.delete(key)
          if (this.client === client && this._state.sessionId === sessionId) {
            this.publish({ messages: this.projectedMessages(), ...this.messageMetaPatch() })
          }
        })
      this.attachmentLoads.set(key, load)
    }
  }

  private dirtyConflict(event: DshEvent, view?: unknown): { callId: string; paths: string[] } | undefined {
    const callIds: string[] = []
    const documents = new Map<string, vscode.TextDocument>()
    for (const intent of toolWriteIntents(event, view)) {
      if (this.guardedDirtyCalls.has(intent.callId)) continue
      const conflicts = this.dirtyFiles.conflicts(this.cwd, intent.paths)
      if (conflicts.length === 0) continue
      this.guardedDirtyCalls.add(intent.callId)
      callIds.push(intent.callId)
      for (const document of conflicts) documents.set(document.uri.fsPath, document)
    }
    if (callIds.length === 0) return undefined
    const paths = [...documents.values()]
      .map(document => path.relative(this.cwd, document.uri.fsPath) || path.basename(document.uri.fsPath))
    return { callId: callIds[0] ?? String(event.seq), paths }
  }

  private async cancelForDirtyConflict(conflict: { paths: string[] }): Promise<void> {
    try {
      await this.cancel()
    } catch (error) {
      this.output.appendLine(`[dirty-files] Could not cancel cleanly: ${error instanceof Error ? error.message : String(error)}`)
    }
    const label = conflict.paths.length === 1
      ? conflict.paths[0] ?? 'A file'
      : `${String(conflict.paths.length)} files`
    await vscode.window.showWarningMessage(
      `DeepSeek stopped: ${label} has unsaved changes.`,
      {
        modal: true,
        detail: `${conflict.paths.join('\n')}\n\nSave or discard the changes in VS Code, then retry the task.`,
      },
    )
  }

  async openFile(filePath: string, line?: number): Promise<void> {
    await this.diffReviews.openFile(this.cwd, filePath, line)
  }

  async reviewFile(filePath: string, turn?: number): Promise<void> {
    if (this._state.sessionId === '') return
    await this.diffReviews.reviewFile(this._state.sessionId, this.cwd, filePath, turn)
  }

  async reviewAll(): Promise<void> {
    if (this._state.sessionId === '') return
    await this.diffReviews.reviewAll(this._state.sessionId)
  }

  keepFile(filePath: string, turn: number): void {
    if (this._state.sessionId === '') return
    this.publish({ changedFiles: this.diffReviews.keepFile(this._state.sessionId, this.cwd, filePath, turn) })
  }

  keepAll(): void {
    if (this._state.sessionId === '') return
    this.publish({ changedFiles: this.diffReviews.keepAll(this._state.sessionId) })
  }

  async revertFile(filePath: string, turn: number): Promise<void> {
    if (this._state.sessionId === '') return
    const sessionId = this._state.sessionId, cwd = this.cwd, generation = this.sessionLoadGeneration
    const confirmed = await vscode.window.showWarningMessage(
      `Revert DeepSeek changes to ${filePath}?`,
      { modal: true, detail: 'This restores the file to its content before this turn. The revert is blocked if the file has changed since.' },
      'Revert',
    )
    if (confirmed !== 'Revert') return
    if (this._state.sessionId !== sessionId || this.cwd !== cwd || generation !== this.sessionLoadGeneration) return
    try {
      this.publish({ changedFiles: this.diffReviews.revertFile(sessionId, cwd, filePath, turn) })
      await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
      await vscode.window.showInformationMessage(`Reverted ${filePath}.`)
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async revertAll(): Promise<void> {
    if (this._state.sessionId === '') return
    const sessionId = this._state.sessionId, cwd = this.cwd, generation = this.sessionLoadGeneration
    const count = this._state.changedFiles.reduce((total, group) => total + group.files.length, 0)
    if (count === 0) return
    const confirmed = await vscode.window.showWarningMessage(
      `Revert all ${String(count)} reviewed file changes?`,
      { modal: true, detail: 'Every file is checked first. If any file has changed since DeepSeek edited it, nothing is reverted.' },
      'Revert All',
    )
    if (confirmed !== 'Revert All') return
    if (this._state.sessionId !== sessionId || this.cwd !== cwd || generation !== this.sessionLoadGeneration) return
    try {
      this.publish({ changedFiles: this.diffReviews.revertAll(sessionId) })
      await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
      await vscode.window.showInformationMessage(`Reverted changes in ${String(count)} files.`)
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }
}

type DraftImage = PromptImage & { id: string }
/** One staged file waiting for the next prompt; its receipt is the wire handle. */
type DraftFile = PromptFile & { id: string; name: string; bytes: number }

/**
 * How long the optimistic "Stopping…" acknowledgement is shown before the
 * control returns to "Stop requested".
 *
 * The Host acknowledges `session/cancel` synchronously, but the turn ends only
 * when in-flight tool work settles, which has no bounded duration. A short
 * window keeps the click responsive; a still-running turn then offers a retry
 * instead of a disabled button that looks like a hang.
 */
const STOPPING_ACKNOWLEDGEMENT_MS = 6_000

/** Bound on one diagnostic line: enough for an error, short enough for a log. */
const DIAGNOSTIC_TEXT_LIMIT = 300

/**
 * One safe OutputChannel line: redacted, single-line and bounded.
 *
 * Webview messages, runtime failures and provider errors are untrusted text.
 * The channel is a local log file, but a query token or an API key written
 * there is still a leak, and a newline would let the text forge extra log
 * lines. Both are removed here, at the channel boundary, rather than trusting
 * every call site. Absolute paths and IPs are deliberately left as they are:
 * they appear in local-only logs and are out of this change's scope.
 */
function diagnosticText(value: unknown): string {
  const redacted = redactDshSecrets(typeof value === 'string' ? value : String(value))
    // A bare provider key is not covered by the URL header/query rules.
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, '[redacted]')
    // Likewise a `Bearer` token quoted without a preceding header name.
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
  const oneLine = redacted.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return oneLine.length <= DIAGNOSTIC_TEXT_LIMIT ? oneLine : `${oneLine.slice(0, DIAGNOSTIC_TEXT_LIMIT)}…`
}

/**
 * A Webview-supplied identifier that is safe to interpolate into a log line.
 *
 * Runtime conversation ids use `A-Za-z0-9._:-`; anything else (a newline, a
 * forged log prefix) is replaced as a whole so it cannot reach the channel.
 */
function safeLogId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : '<invalid>'
}

/** First 12 characters of a conversation id; log lines never need the whole id. */
function shortSessionId(sessionId: string): string {
  const safe = safeLogId(sessionId)
  return safe === '<invalid>' ? safe : safe.slice(0, 12)
}

/**
 * Upper bound on one Host-to-Webview state delivery.
 *
 * `webview.postMessage` is a Thenable the Webview may never settle. Waiting on
 * it forever serializes every later snapshot behind it, so a conversation
 * switch and the Stop acknowledgement both become invisible. A delivery is
 * abandoned after this long; the queue continues and the next post is a full
 * snapshot.
 */
const STATE_DELIVERY_TIMEOUT_MS = 2_000

/**
 * How long the Host waits before resending a snapshot after abandoning a
 * stalled delivery with no newer state queued.
 *
 * A Webview stuck in a transition has no watchdog of its own (its
 * resynchronization timer only runs for a live turn), so without this both
 * sides can wait forever on the one state that was dropped.
 */
const STATE_DELIVERY_RECOVERY_DELAY_MS = 1_500
/** At most one proactive resend per this window: a dead channel must not loop. */
const STATE_DELIVERY_RECOVERY_THROTTLE_MS = 10_000
/** Consecutive abandoned deliveries before the user gets a visible warning. */
const STATE_STALL_WARNING_THRESHOLD = 3
/** The visible warning is shown at most once per this window. */
const STATE_STALL_WARNING_INTERVAL_MS = 10 * 60_000

/** How often the sidebar re-reads account state while a sign-in attempt is live. */
const ACCOUNT_POLL_INTERVAL_MS = 1500
/** Ceiling on polls per attempt (about ten minutes), so none can poll forever. */
const MAX_ACCOUNT_POLLS = 400

/** What each in-flight sign-in phase means to the user. */
const ACCOUNT_PHASE_TEXT: Readonly<Record<string, string>> = {
  initializing: 'Preparing sign-in…',
  'waiting-browser': 'Waiting for you to finish in the browser…',
  exchanging: 'Finishing sign-in…',
  committing: 'Finishing sign-in…',
  expired: 'Sign-in expired. Start again.',
  failed: 'Sign-in failed. Try again.',
}

/** One human line for the account row; the sidebar holds all account policy. */
function ACCOUNT_NOTICE(account: AccountState): string | null {
  if (account.signedIn) {
    const name = account.profile?.name ?? account.profile?.id ?? 'Signed in'
    const wallets = account.wallets ?? []
    return wallets.length === 0 ? name : `${name} · ${accountWalletText(wallets)}`
  }
  if (account.phase === undefined || account.phase === 'succeeded') return null
  return ACCOUNT_PHASE_TEXT[account.phase] ?? 'Signing in…'
}

/** Largest dropped file this sidebar will stage; the runtime publishes no file bound. */
const MAX_DRAFT_FILE_BYTES = 32 * 1024 * 1024
/** Upper bound on staged files per message, mirroring the image batch shape. */
const MAX_DRAFT_FILES = 8

class DshSurface implements vscode.Disposable {
  private readonly settingsPanel: SettingsPanelManager
  private readonly disposables: vscode.Disposable[]
  private readonly draftImagesBySession = new Map<string, DraftImage[]>()
  private readonly draftFilesBySession = new Map<string, DraftFile[]>()
  /**
   * Bumped whenever a send consumes a session's drafts. An upload that lands
   * after its own send must be discarded rather than handed to the next prompt.
   */
  private readonly draftGeneration = new Map<string, number>()
  /** Uploads still in flight, so a send cannot race past an unshown attachment. */
  private readonly pendingUploads = new Map<string, number>()
  private ready = false
  private pendingFocus = false
  private pendingPrompt: string | undefined
  private creatingConversation = false
  private pendingState: ChatViewState | undefined
  private postedState: ChatViewState | undefined
  private stateTimer: NodeJS.Timeout | undefined
  /** True while the drained delivery loop owns the queue. */
  private statePosting = false
  /**
   * Monotonic delivery id. Only the newest attempt may set `postedState`, so a
   * delivery that settles after its timeout cannot resurrect an older view.
   */
  private stateDeliveryGeneration = 0
  /** When the delivery currently in flight started; 0 when none is in flight. */
  private statePostStartedAt = 0
  /** Last time a slow delivery was reported, so a slow webview logs once. */
  private statePostSlowLoggedAt = 0
  /** One-shot proactive resend armed after a stall with nothing queued. */
  private deliveryRecoveryTimer: NodeJS.Timeout | undefined
  /** When the last proactive resend was attempted; throttles a dead channel. */
  private lastDeliveryRecoveryAt = 0
  /** Deliveries abandoned by the timeout in a row, for the visible warning. */
  private stalledDeliveries = 0
  /** When the user was last warned that the view stopped receiving state. */
  private stallWarnedAt = 0

  /** Wrapped below: every line this surface writes is Webview/transport text. */
  private readonly output: Pick<vscode.OutputChannel, 'appendLine' | 'show'>

  constructor(
    private readonly webview: vscode.Webview,
    private readonly controller: DshChatController,
    output: vscode.OutputChannel,
    private readonly editorContext: EditorContextBridge,
    extensionUri: vscode.Uri,
    version: string,
  ) {
    // The surface logs Webview messages and transport failures verbatim; the
    // wrapping keeps that untrusted text off a raw channel.
    this.output = {
      appendLine: line => { output.appendLine(diagnosticText(line)) },
      show: (columnOrFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean) => {
        if (typeof columnOrFocus === 'boolean') output.show(columnOrFocus)
        else output.show(columnOrFocus, preserveFocus)
      },
    }
    this.settingsPanel = new SettingsPanelManager(controller, extensionUri, version)
    const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media')
    const renderRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview')
    webview.options = { enableScripts: true, localResourceRoots: [mediaRoot, renderRoot] }
    webview.html = chatHtml(webview, webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'deepseek.svg')), {
      script: webview.asWebviewUri(vscode.Uri.joinPath(renderRoot, 'markdown.js')),
      style: webview.asWebviewUri(vscode.Uri.joinPath(renderRoot, 'katex.min.css')),
      scroll: webview.asWebviewUri(vscode.Uri.joinPath(renderRoot, 'scroll.js')),
      settings: webview.asWebviewUri(vscode.Uri.joinPath(renderRoot, 'settings-page.js')),
      tail: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'deepseek-tail.png')),
    })
    this.disposables = [
      this.settingsPanel,
      controller.onDidChangeState(state => { this.queueState(state) }),
      editorContext.onDidChange(state => { void webview.postMessage({ type: 'ide-context', state }) }),
      webview.onDidReceiveMessage(message => { this.acceptMessage(message) }),
    ]
  }

  focusPrompt(): void {
    if (!this.ready) {
      this.pendingFocus = true
      return
    }
    void this.webview.postMessage({ type: 'focus-prompt' })
  }

  setPrompt(text: string): void {
    if (!this.ready) {
      this.pendingPrompt = text
      return
    }
    void this.webview.postMessage({ type: 'set-prompt', text })
  }

  dispose(): void {
    if (this.stateTimer !== undefined) clearTimeout(this.stateTimer)
    if (this.deliveryRecoveryTimer !== undefined) clearTimeout(this.deliveryRecoveryTimer)
    for (const disposable of this.disposables) disposable.dispose()
  }

  private queueState(state: ChatViewState): void {
    this.pendingState = state
    // A new state takes over the recovery path: the normal drain will deliver
    // it, so a scheduled proactive resend would only duplicate the snapshot.
    if (this.deliveryRecoveryTimer !== undefined) {
      clearTimeout(this.deliveryRecoveryTimer)
      this.deliveryRecoveryTimer = undefined
    }
    // A delivery that has not settled for seconds is a view that stopped
    // receiving state. Report it once per window; the delivery timeout below and
    // the Webview's resynchronization watchdog are what recover the view. This
    // runs even while a delivery is in flight, which is exactly the stall case.
    if (this.ready && this.statePostStartedAt !== 0 && Date.now() - this.statePostStartedAt > STATE_DELIVERY_TIMEOUT_MS
      && Date.now() - this.statePostSlowLoggedAt > 10_000) {
      this.statePostSlowLoggedAt = Date.now()
      this.output.appendLine(`[webview] state delivery has been pending for ${String(Date.now() - this.statePostStartedAt)} ms`)
    }
    if (!this.ready || this.stateTimer !== undefined || this.statePosting) return
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined
      this.requestDrain()
    }, 16)
  }

  /**
   * Run the drain loop without letting an unexpected failure escape.
   *
   * A rejected promise here would only become an unhandled rejection. The queue
   * instead marks the view stale, so the next state is posted as a full
   * snapshot instead of a patch on an unknown base.
   */
  private requestDrain(): void {
    void this.drainState().catch(error => {
      this.postedState = undefined
      this.output.appendLine(`[webview] state drain failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /**
   * Post the newest merged state, one bounded delivery at a time.
   *
   * Only the latest state is kept while a delivery is in flight, so a stream of
   * updates cannot queue a storm of posts behind a stalled one.
   */
  private async drainState(): Promise<void> {
    if (this.statePosting) return
    this.statePosting = true
    try {
      while (this.pendingState !== undefined) {
        const state = this.pendingState
        this.pendingState = undefined
        await this.postState(state)
      }
    } finally {
      this.statePosting = false
    }
  }

  /**
   * Deliver one state snapshot, abandoning the wait after a timeout.
   *
   * The attempt keeps its own generation: a `postMessage` that settles after
   * the timeout may not publish `postedState`, because a newer delivery (or a
   * full resynchronization) already owns it. Returns whether the delivery
   * actually settled before the timeout.
   */
  private async postState(state: ChatViewState, forceFull = false): Promise<boolean> {
    const generation = ++this.stateDeliveryGeneration
    let failed = false
    const delivery = this.deliverState(state, generation, forceFull).then(
      () => true,
      error => {
        failed = true
        if (generation === this.stateDeliveryGeneration) {
          this.output.appendLine(`[webview] Could not publish state: ${error instanceof Error ? error.message : String(error)}`)
        }
        return false
      },
    )
    let timer: NodeJS.Timeout | undefined
    const stalled = new Promise<false>(resolve => {
      timer = setTimeout(() => { resolve(false) }, STATE_DELIVERY_TIMEOUT_MS)
    })
    const finished = await Promise.race([delivery, stalled])
    if (timer !== undefined) clearTimeout(timer)
    if (finished) {
      this.stalledDeliveries = 0
      return true
    }
    // A newer delivery (or a resynchronization) already owns the view: this
    // attempt is reported for diagnosis only and must not disturb the base.
    const superseded = generation !== this.stateDeliveryGeneration
    if (!superseded) {
      // A view that never acknowledges a post may still show an older state, so
      // patches can no longer be computed from `postedState`.
      ++this.stateDeliveryGeneration
      this.postedState = undefined
      this.statePostStartedAt = 0
    }
    // The stalled Thenable may settle later; `delivery` already owns its
    // rejection, and the generation guard discards its result.
    void delivery
    if (failed) return false
    if (superseded) {
      this.output.appendLine(`[webview] state delivery stalled after ${String(STATE_DELIVERY_TIMEOUT_MS)} ms (session ${shortSessionId(state.sessionId)}, phase ${state.phase}, generation ${String(generation)}); superseded by a newer delivery`)
      return false
    }
    this.stalledDeliveries += 1
    this.output.appendLine(`[webview] state delivery stalled after ${String(STATE_DELIVERY_TIMEOUT_MS)} ms (session ${shortSessionId(state.sessionId)}, phase ${state.phase}, generation ${String(generation)}); the next state is a full snapshot`)
    this.warnAboutStalledDeliveries()
    // Nothing queued means the abandoned post was the only state either side
    // had, so the Host has to resend it itself.
    if (this.pendingState === undefined && this.stateTimer === undefined) this.scheduleDeliveryRecovery()
    return false
  }

  /**
   * Resend the newest snapshot after a stall even when no new state arrives.
   *
   * This is the Host-side equivalent of the Webview's resynchronization
   * watchdog, which does not run while a switch leaves the view in `loading`.
   * One retry per stall, throttled, and always yielding to the normal drain.
   */
  private scheduleDeliveryRecovery(): void {
    if (this.deliveryRecoveryTimer !== undefined) return
    if (Date.now() - this.lastDeliveryRecoveryAt < STATE_DELIVERY_RECOVERY_THROTTLE_MS) return
    this.deliveryRecoveryTimer = setTimeout(() => {
      this.deliveryRecoveryTimer = undefined
      // A queued state, a scheduled drain or an in-flight delivery is the
      // normal recovery path; the proactive resend must not duplicate it.
      if (!this.ready || this.pendingState !== undefined || this.stateTimer !== undefined || this.statePosting) return
      this.lastDeliveryRecoveryAt = Date.now()
      const state = this.controller.state
      this.output.appendLine(`[webview] retrying the full view state after a stalled delivery (session ${shortSessionId(state.sessionId)}, phase ${state.phase})`)
      this.pendingState = state
      this.requestDrain()
    }, STATE_DELIVERY_RECOVERY_DELAY_MS)
  }

  /**
   * Tell the user when repeated stalls mean the view needs a reload.
   *
   * The Output channel already has the details; this is the one actionable
   * line a user can see when the sidebar has stopped responding entirely.
   */
  private warnAboutStalledDeliveries(): void {
    if (this.stalledDeliveries < STATE_STALL_WARNING_THRESHOLD) return
    const now = Date.now()
    if (this.stallWarnedAt !== 0 && now - this.stallWarnedAt < STATE_STALL_WARNING_INTERVAL_MS) return
    this.stallWarnedAt = now
    this.output.appendLine(`[webview] ${String(this.stalledDeliveries)} state deliveries stalled in a row; the Webview may need to be reloaded`)
    void vscode.window.showWarningMessage(
      'The sidebar is not receiving state updates from DeepSeek Harness. If the conversation stops responding, reload the window.',
    )
  }

  private async deliverState(state: ChatViewState, generation: number, forceFull: boolean): Promise<void> {
    const previous = forceFull ? undefined : this.postedState
    // A conversation switch can never ride on a patch computed for the old
    // conversation: the full snapshot also re-establishes the Webview's base.
    if (previous === undefined || previous.sessionId !== state.sessionId) {
      await this.postFullState(state, generation)
      return
    }
    await this.postStateUpdate(state, previous, generation)
  }

  private async postFullState(state: ChatViewState, generation: number): Promise<void> {
    const started = Date.now()
    this.statePostStartedAt = started
    try {
      const delivered = await this.webview.postMessage({ type: 'state', state: stateForWebview(state) })
      if (generation !== this.stateDeliveryGeneration) return
      this.postedState = delivered ? state : undefined
    } finally {
      if (generation === this.stateDeliveryGeneration) {
        this.statePostStartedAt = 0
        const elapsed = Date.now() - started
        if (elapsed > 1_500 && Date.now() - this.statePostSlowLoggedAt > 10_000) {
          this.statePostSlowLoggedAt = Date.now()
          this.output.appendLine(`[webview] full state delivery took ${String(elapsed)} ms`)
        }
      }
    }
  }

  private async postStateUpdate(state: ChatViewState, previous: ChatViewState, generation: number): Promise<void> {
    const update = stateUpdate(previous, state)
    let delivered = true
    if (update !== undefined) {
      const started = Date.now()
      this.statePostStartedAt = started
      try {
        delivered = await this.webview.postMessage({ type: 'state-update', update: stateUpdateForWebview(update) })
      } finally {
        if (generation === this.stateDeliveryGeneration) {
          this.statePostStartedAt = 0
          const elapsed = Date.now() - started
          if (elapsed > 1_500 && Date.now() - this.statePostSlowLoggedAt > 10_000) {
            this.statePostSlowLoggedAt = Date.now()
            this.output.appendLine(`[webview] state update delivery took ${String(elapsed)} ms`)
          }
        }
      }
    }
    // A delivery that settles late (or a dropped patch) must not become the base
    // of a later diff: every state after a stall is posted as a full snapshot.
    if (generation !== this.stateDeliveryGeneration) return
    if (!delivered) {
      this.postedState = undefined
      return
    }
    this.postedState = state
  }

  /**
   * Ask before switching to a preset whose effects warrant an acknowledgement.
   *
   * The Host's `/permission` command switches without any prompt; DSH's own Web
   * client gates Full access and Auto review in its UI. The sidebar therefore
   * owns the gate for both, and a declined dialog leaves the current preset on.
   */
  private async confirmPermissionPreset(value: string): Promise<boolean> {
    const confirmation = permissionConfirmationFor(value)
    if (confirmation === undefined) return true
    const answer = await vscode.window.showWarningMessage(
      confirmation.title,
      { modal: true, detail: confirmation.detail },
      confirmation.action,
    )
    return answer === confirmation.action
  }

  private async resyncState(): Promise<void> {
    const snapshot = this.controller.state
    this.pendingState = undefined
    if (this.stateTimer !== undefined) {
      clearTimeout(this.stateTimer)
      this.stateTimer = undefined
    }
    // A view asking for a snapshot is by definition not receiving the queued
    // ones: post outside the drain loop and force a full snapshot. The wait is
    // still bounded, so a stalled recovery cannot hang the message handler.
    const started = Date.now()
    this.postedState = undefined
    const delivered = await this.postState(snapshot, true).catch(error => {
      this.output.appendLine(`[webview] could not resend the view state: ${error instanceof Error ? error.message : String(error)}`)
      return false
    })
    if (delivered) this.output.appendLine(`[webview] resent the full view state in ${String(Date.now() - started)} ms`)
    else this.output.appendLine('[webview] the full view state could not be delivered; the watchdog may ask again')
  }

  private async chooseImages(): Promise<void> {
    const sessionId = this.controller.state.sessionId
    if (sessionId === '') return
    const selected = await vscode.window.showOpenDialog({
      title: 'Attach images to the DeepSeek prompt',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
    })
    if (selected === undefined) return

    const incoming: DraftImage[] = []
    for (const uri of selected) {
      const mediaType = imageMediaType(uri.fsPath)
      if (mediaType === undefined) continue
      const bytes = await vscode.workspace.fs.readFile(uri)
      incoming.push({
        id: randomUUID(),
        type: 'image',
        mediaType,
        data: Buffer.from(bytes).toString('base64'),
        name: path.basename(uri.fsPath),
      })
    }

    await this.addDraftImages(sessionId, incoming)
  }

  private async addDraftImages(sessionId: string, incoming: readonly DraftImage[]): Promise<void> {
    if (incoming.length === 0) return
    // The file dialog and the reads are async, so the open conversation can have
    // changed under them. Staging onto a conversation the user has left made the
    // pick look like it did nothing and then rode that conversation's next prompt;
    // the sibling path that takes images from the Webview guards the same way.
    if (sessionId !== this.controller.state.sessionId) return

    const draftImages = this.draftImagesFor(sessionId)
    // Answer with the runtime's own bounds before a rejected prompt spends the upload.
    const rejection = rejectImageAttachments(
      draftImages.map(candidateOf),
      incoming.map(candidateOf),
      this.controller.state.imageLimits,
    )
    if (rejection !== undefined) {
      void vscode.window.showWarningMessage(rejection)
      return
    }

    draftImages.push(...incoming)
    await this.publishDraftImages(sessionId)
  }

  private async addEncodedImages(sessionId: string, values: unknown): Promise<void> {
    if (sessionId !== this.controller.state.sessionId || !Array.isArray(values)) return
    const incoming: DraftImage[] = []
    for (const value of values) {
      const image = draftImageFromWebview(value)
      if (image !== undefined) incoming.push(image)
    }
    await this.addDraftImages(sessionId, incoming)
  }

  private async chooseWorkspace(): Promise<void> {
    const current = this.controller.state.cwd
    const folders = vscode.workspace.workspaceFolders ?? []
    const items: WorkspacePick[] = [
      ...folders.map(folder => ({
        label: `$(folder) ${folder.name}`,
        ...(folder.uri.fsPath === current ? { description: 'Current project' } : {}),
        detail: folder.uri.fsPath,
        uri: folder.uri,
        action: 'switch' as const,
      })),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      {
        label: '$(folder-opened) Open another project…',
        detail: 'Open a different folder in this VS Code window',
        action: 'open' as const,
      },
    ]
    const selected = await vscode.window.showQuickPick(items, {
      title: 'Choose DeepSeek project',
      placeHolder: 'DeepSeek reads, writes, and runs commands in this project',
    })
    if (selected === undefined) return
    if (selected.action === 'switch' && selected.uri !== undefined) {
      await this.controller.switchWorkspace(selected.uri.fsPath)
      return
    }
    if (selected.action === 'open') {
      const opened = await vscode.window.showOpenDialog({
        title: 'Open a project for DeepSeek Harness',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      })
      if (opened?.[0] !== undefined) await vscode.commands.executeCommand('vscode.openFolder', opened[0], false)
    }
  }

  private draftImagesFor(sessionId: string): DraftImage[] {
    const existing = this.draftImagesBySession.get(sessionId)
    if (existing !== undefined) return existing
    const created: DraftImage[] = []
    this.draftImagesBySession.set(sessionId, created)
    return created
  }

  private draftFilesFor(sessionId: string): DraftFile[] {
    const existing = this.draftFilesBySession.get(sessionId)
    if (existing !== undefined) return existing
    const created: DraftFile[] = []
    this.draftFilesBySession.set(sessionId, created)
    return created
  }

  /**
   * Stage files the webview handed over as bytes. This is the only path that
   * works for anything the webview cannot address as a VS Code resource: OS
   * drags in a remote window, and every drag in a browser-hosted window.
   */
  private async addEncodedFiles(sessionId: string, values: unknown): Promise<void> {
    if (!Array.isArray(values)) return
    const generation = this.draftGeneration.get(sessionId) ?? 0
    this.pendingUploads.set(sessionId, (this.pendingUploads.get(sessionId) ?? 0) + 1)
    try {
      // The guard sits inside the try on purpose: the Webview holds its own
      // send gate until this session answers, so returning before the finally
      // would disable Send for that conversation until the panel reloads.
      if (sessionId !== this.controller.state.sessionId) return
      for (const value of values) {
        const file = encodedFileFromWebview(value)
        if (file === undefined) continue
        if (file.bytes > MAX_DRAFT_FILE_BYTES) {
          void vscode.window.showWarningMessage(`“${file.name}” is larger than the ${String(MAX_DRAFT_FILE_BYTES / (1024 * 1024))} MB attachment limit.`)
          continue
        }
        if (this.draftFilesFor(sessionId).length >= MAX_DRAFT_FILES) {
          void vscode.window.showWarningMessage(`A message can carry at most ${String(MAX_DRAFT_FILES)} files.`)
          break
        }
        try {
          const receipt = await this.controller.uploadFile(sessionId, file.data, file.name)
          // A send that completed while this upload was in flight already
          // carried its attachments; this receipt belongs to nobody now.
          if ((this.draftGeneration.get(sessionId) ?? 0) !== generation) return
          this.draftFilesFor(sessionId).push({
            id: randomUUID(),
            type: 'file',
            name: receipt.file.name === '' ? file.name : receipt.file.name,
            bytes: receipt.file.bytes,
            receiptId: receipt.receiptId,
          })
        } catch (error) {
          void vscode.window.showWarningMessage(
            `Could not attach “${file.name}”: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    } finally {
      const remaining = (this.pendingUploads.get(sessionId) ?? 1) - 1
      if (remaining <= 0) this.pendingUploads.delete(sessionId)
      else this.pendingUploads.set(sessionId, remaining)
      // Publish for the owning session even if the user moved on, so the two
      // sides cannot disagree about what is attached.
      await this.publishDraftAttachments(sessionId)
    }
  }
  /**
   * Pin dropped workspace resources as context chips. Their URIs resolve on
   * whichever host runs this extension, so this also works over Remote SSH.
   */
  private async attachResources(sessionId: string, values: unknown): Promise<void> {
    if (sessionId !== this.controller.state.sessionId || !Array.isArray(values)) return
    const cwd = this.controller.state.cwd
    let pinned = 0
    let unsupported = 0
    for (const value of values) {
      const entry = typeof value === 'string' ? { uri: value } : value
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as Record<string, unknown>
      if (typeof record.uri !== 'string' || record.uri === '') continue
      let uri: vscode.Uri
      try {
        uri = vscode.Uri.parse(record.uri, true)
      } catch {
        continue
      }
      if (uri.scheme !== 'file' && !uri.scheme.startsWith('vscode-remote') && uri.scheme !== 'vscode-vfs') {
        unsupported += 1
        continue
      }
      const startLine = typeof record.startLine === 'number' && Number.isSafeInteger(record.startLine) ? record.startLine : undefined
      const endLine = typeof record.endLine === 'number' && Number.isSafeInteger(record.endLine) ? record.endLine : undefined
      if (sessionId !== this.controller.state.sessionId) return
      if (await this.editorContext.pinUri(uri, cwd, startLine === undefined ? undefined : { startLine, endLine: endLine ?? startLine }, sessionId)) {
        pinned += 1
      }
    }
    if (pinned > 0) return
    // An untitled tab or an output pane has no project path at all, which is a
    // different problem from a file that lives outside the workspace.
    void vscode.window.showWarningMessage(unsupported > 0
      ? 'Nothing was added: that item has no file in the DeepSeek project.'
      : 'Nothing was added: those items are outside the DeepSeek project.')
  }

  private async publishDraftAttachments(sessionId: string): Promise<void> {
    await this.publishDraftImages(sessionId)
    await this.webview.postMessage({
      type: 'draft-files',
      sessionId,
      files: this.draftFilesFor(sessionId).map(file => ({ id: file.id, name: file.name, bytes: file.bytes })),
      // The Webview gates Send on this, so it must be the authoritative count
      // rather than something it infers from its own hand-offs.
      uploads: this.pendingUploads.get(sessionId) ?? 0,
    })
  }

  private async publishDraftImages(sessionId: string): Promise<void> {
    await this.webview.postMessage({
      type: 'draft-images',
      sessionId,
      images: this.draftImagesFor(sessionId).map(image => ({ id: image.id, name: image.name, mediaType: image.mediaType })),
    })
  }

  private async restoreDraft(sessionId: string, requestId: number, text: string): Promise<void> {
    await this.webview.postMessage({ type: 'restore-draft', sessionId, requestId, text })
  }

  private async acknowledgeDraft(sessionId: string, requestId: number): Promise<void> {
    await this.webview.postMessage({ type: 'draft-sent', sessionId, requestId })
  }

  private acceptMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    const value = message as Record<string, unknown>
    // Diagnostics for user-initiated actions: these lines are the only record of
    // a click that never changed the view, and they are cheap (one per click).
    if (value.type === 'select-session' && typeof value.sessionId === 'string') {
      this.output.appendLine(`[ui] select conversation ${safeLogId(value.sessionId)} (from ${safeLogId(this.controller.state.sessionId)}, phase=${this.controller.state.phase}, running=${String(this.controller.state.running === true)}${this.controller.state.stopping === true ? ', stopping' : ''})`)
    } else if (value.type === 'cancel') {
      this.output.appendLine(`[ui] cancel requested (session ${safeLogId(this.controller.state.sessionId)}, phase=${this.controller.state.phase}, running=${String(this.controller.state.running === true)}, stopping=${String(this.controller.state.stopping === true)})`)
    } else if (value.type === 'retry-occupancy') {
      this.output.appendLine(`[ui] retry held conversation (session ${safeLogId(this.controller.state.sessionId)})`)
    } else if (value.type === 'new-session') {
      this.output.appendLine(`[ui] new conversation (from ${safeLogId(this.controller.state.sessionId)})`)
    }
    const run = async (): Promise<void> => {
      switch (value.type) {
        case 'webview-error':
          this.output.appendLine(`[webview] ${diagnosticText(typeof value.message === 'string' ? value.message : 'Unknown error')}`)
          return
        case 'resync':
          this.output.appendLine(`[webview] requested a state resynchronization after ${typeof value.staleMs === 'number' ? String(value.staleMs) : '?'} ms without state`)
          await this.resyncState()
          return
        case 'ready':
          this.ready = true
          await this.resyncState()
          await this.webview.postMessage({ type: 'ide-context', state: this.editorContext.viewState() })
          if (this.pendingFocus) {
            this.pendingFocus = false
            await this.webview.postMessage({ type: 'focus-prompt' })
          }
          if (this.pendingPrompt !== undefined) {
            await this.webview.postMessage({ type: 'set-prompt', text: this.pendingPrompt })
            this.pendingPrompt = undefined
          }
          return
        case 'restart': await this.controller.restart(); return
        case 'reconnect': await this.controller.reconnect(); return
        case 'connect-existing-runtime':
          await vscode.commands.executeCommand('deepseekHarness.connectExistingRuntime')
          return
        case 'start-managed-runtime':
          await vscode.commands.executeCommand('deepseekHarness.startManagedRuntime')
          return
        case 'output': this.output.show(true); return
        case 'open-settings': this.settingsPanel.openEmbedded(this.webview); return
        case 'open-workspace': await this.chooseWorkspace(); return
        case 'configure-api-key':
          await vscode.commands.executeCommand('deepseekHarness.configureApiKey')
          return
        case 'new-session': await this.controller.newSession(); return
        case 'create-conversation': {
          if (typeof value.cwd !== 'string' || typeof value.sessionId !== 'string' || typeof value.requestId !== 'string' || value.requestId.length > 128) return
          const reply = (result: { sessionId: string } | { error: string }): Thenable<boolean> => this.webview.postMessage({ type: 'conversation-created', cwd: value.cwd, requestId: value.requestId, ...result })
          if (this.creatingConversation) { await reply({ error: 'A new conversation is already being opened.' }); return }
          this.creatingConversation = true
          try {
            const sessionId = await this.controller.newSession({ cwd: value.cwd, sessionId: value.sessionId })
            if (sessionId === undefined || this.controller.state.sessionId !== sessionId || this.controller.state.cwd !== value.cwd || this.controller.state.phase !== 'ready') throw new Error('The conversation changed before the draft was ready. Your text was retained.')
            const selection = typeof value.selection === 'object' && value.selection !== null ? value.selection as Record<string, unknown> : undefined
            if (selection !== undefined) {
              if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') throw new Error('Choose a valid model for the new conversation.')
              await this.controller.selectModel({ provider: selection.provider, model: selection.model,
                ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}) })
            }
            if (this.controller.state.sessionId !== sessionId || this.controller.state.cwd !== value.cwd || this.controller.state.phase !== 'ready') throw new Error('The conversation changed before the draft was ready. Your text was retained.')
            await reply({ sessionId })
          } catch (error) {
            await reply({ error: dshErrorText(error) })
          } finally {
            this.creatingConversation = false
          }
          return
        }
        case 'select-session':
          if (typeof value.sessionId === 'string') await this.controller.selectSession(value.sessionId)
          return
        case 'open-task-details':
          if (typeof value.sessionId === 'string' && (value.kind === 'subagent' || (value.kind === 'job' && typeof value.jobId === 'string'))) {
            await vscode.commands.executeCommand('deepseekHarness.openTaskDetails', { kind: value.kind, sessionId: value.sessionId, ...(value.kind === 'job' ? { jobId: value.jobId } : {}) })
          }
          return
        case 'refresh-tasks': await this.controller.refreshTasks(); return
        case 'open-subagent': {
          if (typeof value.parentSessionId !== 'string' || typeof value.sessionId !== 'string' || typeof value.requestId !== 'string') return
          const reply = { type: 'open-subagent-result', requestId: value.requestId, parentSessionId: value.parentSessionId }
          try {
            if (this.controller.state.sessionId !== value.parentSessionId) throw new Error('The conversation changed. Open this subagent from its owning conversation.')
            const target = await this.controller.resolveSubagent(value.parentSessionId, value.sessionId)
            if (this.controller.state.sessionId !== value.parentSessionId) throw new Error('The conversation changed while opening the subagent.')
            if (value.placement === 'beside' && target.subagent) {
              const opened = await vscode.commands.executeCommand<{opened:boolean;error?:string}>('deepseekHarness.openTaskDetails', { kind: 'subagent', sessionId: target.id })
              if (opened?.opened === false) throw new Error(opened.error ?? 'The subagent detail pane could not be opened.')
            } else await this.controller.selectSession(target.id)
            await this.webview.postMessage(reply)
          } catch (error) { await this.webview.postMessage({ ...reply, error: redactDshSecrets(dshErrorText(error)) }) }
          return
        }
        case 'configure-task-services': await vscode.commands.executeCommand('deepseekHarness.configureTaskServices'); return
        case 'search-history':
          if (typeof value.query === 'string') await this.controller.searchHistory(value.query)
          return
        case 'schedule-history':
          if (typeof value.sessionId === 'string' && typeof value.id === 'string') await this.controller.scheduleHistory(value.sessionId, value.id, typeof value.before === 'string' ? value.before : undefined)
          return
        case 'goal-action': {
          if (typeof value.sessionId !== 'string' || !['create', 'edit', 'pause', 'resume', 'complete', 'clear'].includes(String(value.action))) return
          const action = value.action as GoalAction
          const ref = typeof value.id === 'string' && typeof value.revision === 'number' ? { id: value.id, revision: value.revision } : undefined
          let request: { objective: string; maxGoalRounds: number } | undefined
          if (action === 'create' || action === 'edit') {
            const current = this.controller.state.goal.value
            const objective = await vscode.window.showInputBox({ title: action === 'create' ? 'New goal' : 'Edit goal', prompt: 'What should this conversation accomplish?', value: action === 'edit' ? current?.objective ?? '' : '', validateInput: text => text.trim() ? undefined : 'Enter an objective.' })
            if (objective === undefined) return
            const rounds = await vscode.window.showInputBox({ title: 'Goal round limit', prompt: 'Maximum autonomous rounds before the goal stops continuing', value: String(current?.maxGoalRounds ?? 256), validateInput: text => Number.isSafeInteger(Number(text)) && Number(text) > 0 ? undefined : 'Enter a positive whole number.' })
            if (rounds === undefined) return
            request = { objective: objective.trim(), maxGoalRounds: Number(rounds) }
          }
          await this.controller.changeGoal(value.sessionId, action, ref, request)
          return
        }
        case 'pin-session':
        case 'unpin-session': {
          if (typeof value.sessionId === 'string') {
            const sessionId = value.sessionId
            try {
              if (value.type === 'pin-session') await this.controller.pinSession(sessionId)
              else await this.controller.unpinSession(sessionId)
            } catch (error) {
              this.controller.report(error, sessionId)
            }
          }
          return
        }
        case 'copy-session-id':
          if (typeof value.sessionId === 'string') {
            try {
              await this.controller.copySessionId(value.sessionId)
            } catch (error) {
              this.controller.report(error, value.sessionId)
            }
          }
          return
        case 'rename-session':
          if (typeof value.sessionId === 'string') {
            const session = [...this.controller.state.sessions, ...this.controller.state.archivedSessions].find(item => item.id === value.sessionId)
            if (session === undefined || session.blank) return
            const title = await vscode.window.showInputBox({
              title: 'Rename conversation',
              value: session.title,
              prompt: 'Choose a title for this DeepSeek conversation',
              validateInput: input => input.trim() === '' ? 'Enter a conversation title.' : undefined,
            })
            if (title === undefined) return
            try {
              await this.controller.renameSession(session.id, title)
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              await vscode.window.showErrorMessage(`Could not rename the conversation. ${detail} Update DSH if this method is unavailable.`)
            }
          }
          return
        case 'archive-session':
          if (typeof value.sessionId === 'string') {
            const session = this.controller.state.sessions.find(item => item.id === value.sessionId)
            if (session === undefined || session.blank || session.subagent !== undefined || session.parentId !== undefined) return
            try {
              await this.controller.archiveSession(session.id)
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              await vscode.window.showErrorMessage(`Could not archive the conversation. ${detail} Update DSH if this method is unavailable.`)
              return
            }
            const undo = await vscode.window.showInformationMessage('Conversation archived.', 'Undo')
            if (undo === 'Undo') {
              try { await this.controller.unarchiveSession(session.id) }
              catch (error) { await vscode.window.showErrorMessage(`Could not restore the conversation. ${dshErrorText(error)}`) }
            }
          }
          return
        case 'unarchive-session':
          if (typeof value.sessionId === 'string') {
            try {
              await this.controller.unarchiveSession(value.sessionId)
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              await vscode.window.showErrorMessage(`Could not restore the conversation. ${detail} Update DSH if this method is unavailable.`)
            }
          }
          return
        case 'kill-job':
          if (typeof value.sessionId === 'string' && typeof value.jobId === 'string') {
            try {
              await this.controller.killJob(value.sessionId, value.jobId)
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error)
              await vscode.window.showErrorMessage(`Could not stop the background job. ${detail} Update DSH if this method is unavailable.`)
            }
          }
          return
        case 'load-history': await this.controller.loadOlderHistory(); return
        case 'load-tool-output':
          if (typeof value.messageId === 'string' && typeof value.requestId === 'number') {
            const sessionId = this.controller.state.sessionId
            const requestedSessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
            const message = requestedSessionId === sessionId
              ? this.controller.state.messages.find(candidate => candidate.id === value.messageId)
              : undefined
            await this.webview.postMessage({
              type: 'tool-output',
              // Address the reply to the requesting session so its webview does
              // not drop a session-mismatch error and hang on the 15s timeout.
              sessionId: requestedSessionId,
              messageId: value.messageId,
              requestId: value.requestId,
              ...(message === undefined
                ? { error: requestedSessionId === sessionId ? 'Tool output is no longer available.' : 'The conversation changed before this output loaded.' }
                : { page: pageConversationMessage(message, typeof value.cursor === 'string' ? value.cursor : undefined) }),
            })
          }
          return
        case 'send':
          if (typeof value.text === 'string') {
            const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
            const requestId = typeof value.requestId === 'number' && Number.isSafeInteger(value.requestId)
              ? value.requestId
              : -1
            if (sessionId === '' || requestId < 0) return
            // A staged file that has not come back yet would be attached to the
            // wrong message, so the send waits rather than silently dropping it.
            if ((this.pendingUploads.get(sessionId) ?? 0) > 0) {
              void vscode.window.showWarningMessage('Wait for the attached file to finish uploading, then send again.')
              await this.restoreDraft(sessionId, requestId, value.text)
              return
            }
            if (this.controller.state.sessionId !== sessionId) {
              await this.restoreDraft(sessionId, requestId, value.text)
              return
            }
            // Routing splits on whitespace, so this must too. A typed preset
            // needs the same gate the menu applies: Full access and the
            // experimental Auto review are the two that ask before switching.
            const typedPreset = typedCommandPermissionPreset(value.text)
            if (typedPreset !== undefined && !(await this.confirmPermissionPreset(typedPreset))) {
              await this.restoreDraft(sessionId, requestId, value.text)
              return
            }
            let carriesIdeContext = false
            let ideContext: IdeContextSnapshot | undefined
            try {
              const slash = await this.controller.slashRoute(value.text)
              carriesIdeContext = slash.kind === 'prompt'
              ideContext = carriesIdeContext ? await this.editorContext.snapshotForPrompt(value.text) : undefined
            } catch (error) {
              await this.restoreDraft(sessionId, requestId, value.text)
              throw error
            }
            if (this.controller.state.sessionId !== sessionId) {
              await this.restoreDraft(sessionId, requestId, value.text)
              return
            }
            const mode: PromptMode = value.mode === 'steer' ? 'steer' : 'queue'
            // Everything above this point awaited: discovery, a snapshot, or a
            // modal the user sat on. Re-read the draft so a file dropped during
            // those awaits is either sent or reported, never silently wiped.
            const pendingUpload = (this.pendingUploads.get(sessionId) ?? 0) > 0
            const liveImages = this.draftImagesFor(sessionId)
            const liveAttachments: PromptAttachment[] = [...liveImages, ...this.draftFilesFor(sessionId)]
            if (pendingUpload) {
              void vscode.window.showWarningMessage('Wait for the attached file to finish uploading, then send again.')
              await this.restoreDraft(sessionId, requestId, value.text)
              return
            }
            // Limits can land after the picker ran, so the send is the last point
            // where the whole draft can be measured against what the runtime states.
            const rejection = rejectImageAttachments(
              [],
              liveImages.map(candidateOf),
              this.controller.state.imageLimits,
            )
            if (rejection !== undefined) {
              void vscode.window.showWarningMessage(rejection)
              await this.restoreDraft(sessionId, requestId, value.text)
              return
            }
            if (this.controller.state.sessionId !== sessionId) {
              await this.restoreDraft(sessionId, requestId, value.text)
              return
            }
            try {
              await this.controller.send(value.text, liveAttachments, ideContext, mode)
            } catch (error) {
              await this.restoreDraft(sessionId, requestId, value.text)
              throw error
            }
            await this.acknowledgeDraft(sessionId, requestId)
            this.draftImagesBySession.delete(sessionId)
            this.draftFilesBySession.delete(sessionId)
            // Any upload still in flight belongs to the message just sent.
            this.draftGeneration.set(sessionId, (this.draftGeneration.get(sessionId) ?? 0) + 1)
            if (carriesIdeContext) this.editorContext.clearPinned(sessionId, ideContext?.pinned)
            await this.publishDraftAttachments(sessionId)
          }
          return
        case 'translate-reasoning': {
          const requestId = typeof value.requestId === 'string' && value.requestId !== '' && value.requestId.length <= 100
            ? value.requestId
            : undefined
          // Without a correlating id there is no caller to answer.
          if (requestId === undefined) return
          const reply = (result: { ok: true; text: string } | { ok: false; error: string }): Thenable<boolean> =>
            this.webview.postMessage({ type: 'translate-reasoning-result', requestId, ...result })
          const text = typeof value.text === 'string' ? value.text : ''
          const translation = this.controller.state.translation
          // The provider list is informational only: a routing failure comes
          // back from the translate RPC and is shown as a failed translation,
          // exactly as DSH's own client does.
          if (translation === null
            || this.controller.state.sessionId === '' || this.controller.state.phase !== 'ready') {
            await reply({ ok: false, error: 'Reasoning translation is not available in this conversation.' })
            return
          }
          if (text === '' || text.length > translation.maxTextChars) {
            await reply({ ok: false, error: 'This reasoning section is too long to translate in one request.' })
            return
          }
          try {
            await reply({ ok: true, text: await this.controller.translateReasoning(text) })
          } catch (error) {
            await reply({ ok: false, error: translationFailureText(error) })
          }
          return
        }
        case 'select-permission':
          if (typeof value.permission === 'string'
            && this.controller.state.permissions.some(permission => permission.value === value.permission)) {
            if (!(await this.confirmPermissionPreset(value.permission))) {
              await this.resyncState()
              return
            }
            await this.controller.send(`/permission ${value.permission}`)
          }
          return
        case 'select-mode':
          if ((value.mode === 'normal' || value.mode === 'plan') && this.controller.state.plan.available) {
            await this.controller.send(planModeCommand(value.mode))
          }
          return
        case 'select-agent-preset':
          if (typeof value.agentPreset === 'string') await this.controller.selectAgentPreset(value.agentPreset)
          return
        case 'copy-text':
          // The Webview's own clipboard access can be refused before it has
          // focus, so the extension writes it when asked to.
          if (typeof value.text === 'string') await vscode.env.clipboard.writeText(value.text)
          return
        case 'sign-in': await this.controller.signIn(); return
        case 'sign-out': await this.controller.signOut(); return
        case 'cancel-sign-in': await this.controller.cancelSignIn(); return
        case 'attach': await this.chooseImages(); return
        case 'attach-images':
          if (typeof value.sessionId === 'string'
            && typeof value.requestId === 'number'
            && Number.isSafeInteger(value.requestId)) {
            try {
              await this.addEncodedImages(value.sessionId, value.images)
            } finally {
              await this.webview.postMessage({
                type: 'attachments-added',
                sessionId: value.sessionId,
                requestId: value.requestId,
              })
            }
          }
          return
        case 'attach-files':
          if (typeof value.sessionId === 'string') await this.addEncodedFiles(value.sessionId, value.files)
          return
        case 'attach-resources':
          if (typeof value.sessionId === 'string') {
            try { await this.attachResources(value.sessionId, value.uris) }
            finally {
              if (typeof value.requestId === 'number' && Number.isSafeInteger(value.requestId)) await this.webview.postMessage({ type: 'context-updated', sessionId: value.sessionId, requestId: value.requestId })
            }
          }
          return
        case 'attachment-error':
          if (typeof value.message === 'string') await vscode.window.showWarningMessage(value.message)
          return
        case 'choose-workspace': await this.chooseWorkspace(); return
        case 'request-mentions':
          if (typeof value.requestId === 'number' && typeof value.query === 'string') {
            const candidates = await this.editorContext.search(value.query)
            await this.webview.postMessage({
              type: 'mention-suggestions',
              requestId: value.requestId,
              query: value.query,
              candidates,
            })
          }
          return
        case 'request-context-files':
          if (typeof value.sessionId === 'string' && value.sessionId === this.controller.state.sessionId
            && typeof value.requestId === 'number' && typeof value.query === 'string') {
            let candidates: IdeMentionCandidate[] = []
            let error: string | undefined
            try { candidates = await this.editorContext.searchFiles(value.query) }
            catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
            await this.webview.postMessage({ type: 'context-files', sessionId: value.sessionId, requestId: value.requestId, query: value.query, candidates, ...(error === undefined ? {} : { error }) })
          }
          return
        case 'request-ide-context':
          if (value.sessionId === this.controller.state.sessionId) await this.webview.postMessage({ type: 'ide-context', state: this.editorContext.viewState() })
          return
        case 'add-context':
          try {
            if (typeof value.sessionId === 'string' && value.sessionId === this.controller.state.sessionId && typeof value.path === 'string') {
              const startLine = typeof value.startLine === 'number' && Number.isSafeInteger(value.startLine) && value.startLine > 0 ? value.startLine : undefined
              const endLine = typeof value.endLine === 'number' && Number.isSafeInteger(value.endLine) && value.endLine >= (startLine ?? 1) ? value.endLine : startLine
              const added = await this.editorContext.pinPath(value.path, value.sessionId, startLine === undefined ? undefined : { startLine, endLine: endLine ?? startLine })
              if (!added) void vscode.window.showWarningMessage('That file is unavailable or outside the current DeepSeek project.')
            }
          } finally {
            await this.webview.postMessage({ type: 'ide-context', state: this.editorContext.viewState() })
            await this.webview.postMessage({ type: 'context-updated', sessionId: value.sessionId, requestId: value.requestId })
          }
          return
        case 'message-feedback':
          if (typeof value.sessionId === 'string' && typeof value.messageId === 'string'
            && (value.rating === 'positive' || value.rating === 'negative')) {
            void this.controller.submitFeedback(value.sessionId, value.messageId, value.rating)
          }
          return
        case 'fork-conversation':
          if (typeof value.sessionId === 'string') {
            // The branch button sends its turn's `turn/end` seq; anything that
            // is not a finite number is treated as a bare menu fork.
            const atSeq = typeof value.atSeq === 'number' && Number.isFinite(value.atSeq) ? value.atSeq : undefined
            void this.controller.forkConversation(value.sessionId, atSeq)
          }
          return
        case 'remove-context':
          if (typeof value.id === 'string' && typeof value.sessionId === 'string' && value.sessionId === this.controller.state.sessionId) this.editorContext.removePinned(value.id, value.sessionId)
          await this.webview.postMessage({ type: 'context-updated', sessionId: value.sessionId, requestId: value.requestId })
          return
        case 'remove-attachment':
          if (typeof value.id === 'string') {
            // The chip carries its session: the user may have switched between
            // the render and the click, and splicing the wrong draft loses data.
            const sessionId = typeof value.sessionId === 'string' ? value.sessionId : this.controller.state.sessionId
            if (sessionId === '') return
            const draftImages = this.draftImagesFor(sessionId)
            const imageIndex = draftImages.findIndex(image => image.id === value.id)
            if (imageIndex >= 0) draftImages.splice(imageIndex, 1)
            const draftFiles = this.draftFilesFor(sessionId)
            const fileIndex = draftFiles.findIndex(file => file.id === value.id)
            if (fileIndex >= 0) draftFiles.splice(fileIndex, 1)
            await this.publishDraftAttachments(sessionId)
          }
          return
        case 'cancel': await this.controller.cancel(); return
        case 'queue-action':
          if (
            typeof value.sessionId === 'string'
            && typeof value.itemId === 'string'
            && (value.action === 'edit' || value.action === 'remove' || value.action === 'steer')
          ) {
            await this.controller.updateQueue(
              value.sessionId,
              value.itemId,
              value.action,
              typeof value.text === 'string' ? value.text : undefined,
            )
          }
          return
        case 'queued-command-action':
          if (typeof value.sessionId === 'string' && typeof value.commandId === 'string') {
            if (value.action === 'remove') this.controller.removeQueuedCommand(value.sessionId, value.commandId)
            else if (value.action === 'run') await this.controller.runQueuedCommand(value.sessionId, value.commandId)
          }
          return
        case 'approval':
          if (
            typeof value.rpcId === 'string'
            && typeof value.approvalId === 'string'
            && (value.outcome === 'allowed-once' || value.outcome === 'rejected')
          ) await this.controller.answerApproval(value.rpcId, value.approvalId, value.outcome)
          return
        case 'question':
          if (typeof value.rpcId === 'string' && Array.isArray(value.answers)) {
            const answers = value.answers.flatMap((answer): QuestionAnswer[] => {
              if (typeof answer !== 'object' || answer === null) return []
              const item = answer as Record<string, unknown>
              if (typeof item.id !== 'string' || !Array.isArray(item.selected) || !item.selected.every(label => typeof label === 'string')) return []
              return [{
                id: item.id,
                selected: item.selected as string[],
                ...(typeof item.custom === 'string' && item.custom.trim() !== '' ? { custom: item.custom.trim() } : {}),
              }]
            })
            await this.controller.answerQuestions(value.rpcId, answers)
          }
          return
        case 'open-link':
          if (typeof value.href === 'string') {
            const uri = vscode.Uri.parse(value.href)
            if (uri.scheme === 'http' || uri.scheme === 'https') await vscode.env.openExternal(uri)
            // A link that names a file is a file to open, not a failure: the
            // click was a deliberate one, and silently ignoring it is invisible.
            // `Uri.parse` gives a scheme-less string the `file` scheme, so a
            // bare path lands here too instead of being dropped.
            else if (uri.scheme === 'file') {
              const fragment = /^L(\d+)$/.exec(uri.fragment)?.[1]
              await this.controller.openFile(uri.fsPath, fragment === undefined ? undefined : Number(fragment))
            }
            else this.output.appendLine(`[link] Ignored a link with no handler: ${uri.scheme}:`)
          }
          return
        case 'open-file':
          if (typeof value.path === 'string') {
            if ('sessionId' in value && (value.sessionId !== this.controller.state.sessionId || value.cwd !== this.controller.state.cwd)) return
            await this.controller.openFile(
              value.path,
              typeof value.line === 'number' && Number.isInteger(value.line) ? value.line : undefined,
            )
          }
          return
        case 'review-file':
        case 'review-all':
        case 'keep-file':
        case 'keep-all':
        case 'revert-file':
        case 'revert-all':
          await dispatchChangeAction(value, this.controller)
          return
        case 'retry-occupancy': await this.controller.retryHeldConversation(); return
        case 'diagnose-occupancy': await vscode.commands.executeCommand('deepseekHarness.diagnoseOccupancy'); return
        case 'select-model':
          if (typeof value.selection === 'object' && value.selection !== null) {
            const selection = value.selection as Record<string, unknown>
            if (typeof selection.provider === 'string' && typeof selection.model === 'string') {
              await this.controller.selectModel({
                provider: selection.provider,
                model: selection.model,
                ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
              })
            }
          }
      }
    }
    // The action knows which conversation it belonged to; the user may have moved
    // to another one while it was in flight, and a failure is that conversation's.
    void run().catch(error => {
      this.controller.report(error, typeof value.sessionId === 'string' ? value.sessionId : undefined)
    })
  }
}

/** The `/<name>` token of an already-routed command line, for messages the user reads. */
function slashTokenOf(line: string): string {
  const token = line.trimStart().split(/\s/, 1)[0] ?? ''
  return token.startsWith('/') ? token : '/' + token
}

/** Decoded byte count of a base64 payload, without materializing the bytes again. */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(data.length / 4) * 3 - padding)
}

/** Measure a draft attachment against the runtime's published upload bounds. */
function candidateOf(image: DraftImage): ImageCandidate {
  return {
    mediaType: image.mediaType,
    bytes: base64Bytes(image.data),
    ...(image.name === undefined ? {} : { name: image.name }),
  }
}

function imageMediaType(filePath: string): ImageMediaType | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return undefined
  }
}

function draftImageFromWebview(value: unknown): DraftImage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const mediaType = candidate.mediaType
  if (mediaType !== 'image/png'
    && mediaType !== 'image/jpeg'
    && mediaType !== 'image/webp'
    && mediaType !== 'image/gif') return undefined
  if (typeof candidate.data !== 'string'
    || candidate.data === ''
    || candidate.data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(candidate.data)) return undefined
  const name = typeof candidate.name === 'string' && candidate.name.trim() !== ''
    ? candidate.name.trim()
    : undefined
  return {
    id: randomUUID(),
    type: 'image',
    mediaType,
    data: candidate.data,
    ...(name === undefined ? {} : { name }),
  }
}

/** Decoded size of one base64 payload, rejecting anything that is not canonical base64. */
function canonicalBase64(value: unknown): { data: string; bytes: number } | undefined {
  if (typeof value !== 'string' || value === '' || value.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined
  return { data: value, bytes: base64Bytes(value) }
}

/** One arbitrary file dropped into the composer and read as bytes by the webview. */
function encodedFileFromWebview(value: unknown): { name: string; data: string; bytes: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const encoded = canonicalBase64(candidate.data)
  if (encoded === undefined) return undefined
  const raw = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  // The name is a display label only; the Host also sanitizes it into the leaf
  // name. Strip separators here so nothing path-shaped reaches it at all.
  const name = raw === '' ? 'attachment' : path.basename(raw.replaceAll('\\', '/')).slice(0, 200)
  return { name, data: encoded.data, bytes: encoded.bytes }
}

class DshViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private surface: DshSurface | undefined
  private pendingPrompt: string | undefined
  private pendingFocus = false

  constructor(
    private readonly controller: DshChatController,
    private readonly output: vscode.OutputChannel,
    private readonly editorContext: EditorContextBridge,
    private readonly extensionUri: vscode.Uri,
    private readonly version: string,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.surface?.dispose()
    const surface = new DshSurface(view.webview, this.controller, this.output, this.editorContext, this.extensionUri, this.version)
    this.surface = surface
    if (this.pendingFocus) {
      this.pendingFocus = false
      surface.focusPrompt()
    }
    if (this.pendingPrompt !== undefined) {
      surface.setPrompt(this.pendingPrompt)
      this.pendingPrompt = undefined
    }
    view.onDidDispose(() => {
      surface.dispose()
      if (this.surface === surface) this.surface = undefined
    })
    const autoStart = vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('autoStart', true)
    if (autoStart) void this.controller.ensureStarted()
  }

  dispose(): void {
    this.surface?.dispose()
  }

  focusPrompt(): void {
    if (this.surface === undefined) {
      this.pendingFocus = true
      return
    }
    this.surface.focusPrompt()
  }

  setPrompt(text: string): void {
    if (this.surface === undefined) {
      this.pendingPrompt = text
      return
    }
    this.surface.setPrompt(text)
  }
}

function problemPrompt(problem: IdeContextReference): string {
  return `Fix @{${problem.path}:${String(problem.startLine ?? 1)}:${String(problem.startCharacter ?? 1)}}`
}

function problemLocationFromArguments(args: readonly unknown[]): { filePath?: string; line?: number; message?: string } {
  let filePath: string | undefined
  let line: number | undefined
  let message: string | undefined
  const inspect = (value: unknown): void => {
    if (value instanceof vscode.Uri) {
      if (value.scheme === 'file') filePath ??= value.fsPath
      return
    }
    if (typeof value !== 'object' || value === null) return
    const item = value as Record<string, unknown>
    if (typeof item.message === 'string') message ??= item.message
    if (typeof item.startLineNumber === 'number') line ??= item.startLineNumber
    if (item.uri instanceof vscode.Uri) inspect(item.uri)
    if (item.resource instanceof vscode.Uri) inspect(item.resource)
    if (typeof item.range === 'object' && item.range !== null) {
      const range = item.range as Record<string, unknown>
      if (typeof range.start === 'object' && range.start !== null) {
        const start = range.start as Record<string, unknown>
        if (typeof start.line === 'number') line ??= start.line + 1
      }
    }
  }
  for (const arg of args) inspect(arg)
  return {
    ...(filePath === undefined ? {} : { filePath }),
    ...(line === undefined ? {} : { line }),
    ...(message === undefined ? {} : { message }),
  }
}

async function chooseProblem(editorContext: EditorContextBridge, args: readonly unknown[] = []): Promise<IdeContextReference | undefined> {
  const location = problemLocationFromArguments(args)
  const direct = location.filePath === undefined
    ? editorContext.problemAtActiveEditor()
    : editorContext.problemForLocation(location.filePath, location.line, location.message)
  if (direct !== undefined) return direct
  const problems = editorContext.problems()
  const items: Array<vscode.QuickPickItem & { problem: IdeContextReference }> = problems.map(problem => ({
    label: `$(error) ${problem.path}:${String(problem.startLine ?? 1)}`,
    description: problem.severity === 'warning' ? 'Warning' : 'Error',
    detail: problem.message ?? '',
    problem,
  }))
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Send a Problem to DeepSeek',
    placeHolder: problems.length === 0 ? 'No workspace errors or warnings' : 'Choose a diagnostic',
  })
  return picked?.problem
}

export function activate(context: vscode.ExtensionContext): void {
  const workspace = vscode.workspace.workspaceFolders?.[0]
  const output = vscode.window.createOutputChannel('DeepSeek Harness', { log: true })
  const debugSessions = workspace === undefined ? undefined : new DebugSessionManager()
  const debugRuntime = workspace === undefined || debugSessions === undefined
    ? undefined
    : new DebugRuntimeContribution(context, debugSessions, output)
  // Records and leases only ever describe runtimes this extension started. DSH
  // itself writes no pidfile or port file, so a `dsh web` the user launched is
  // invisible here and can never be adopted, listed or ended by this extension.
  const storagePath = context.globalStorageUri?.fsPath ?? ''
  const broker = storagePath !== '' && path.isAbsolute(storagePath)
    ? new RuntimeBroker({ stateDir: sharedRuntimeDirectory(resolveDshHome()), legacyStateDir: path.join(storagePath, 'dsh-runtimes'),
      ...(process.platform === 'linux' && vscode.env.remoteName === 'ssh-remote'
        ? { serverOwner: () => findVsCodeServer(nodeProcessProbe()) } : {}) })
    : undefined
  // Stale-record sweeping needs the transition lock, which the first start also
  // takes; running it after the first ready keeps the lock out of the startup
  // chain without skipping the cleanup. Activation without a ready runtime runs
  // it once, immediately, so the records are never left unexamined.
  const sweep = (): void => {
    void (async () => {
      if (broker === undefined) return []
      const lock = await broker.acquireTransition()
      try { return await broker.sweep() } finally { lock.release() }
    })().then(removed => {
      // Only records whose process is provably gone are removed; nothing is ever
      // terminated here, so a leftover runtime that is still alive keeps running.
      for (const file of removed) output.appendLine(`[runtime] discarded a stale runtime record: ${file}`)
    }).catch(error => {
      output.appendLine(`[runtime] could not sweep stale runtime records: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  const reuseAcrossWindows = vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('reuseAcrossWindows', true)
  // The broker is always handed over: `reuseAcrossWindows` gates only attaching to a
  // runtime *this extension* started, while a runtime the user asked us to remember
  // is theirs to share and is honoured regardless.
  const runtime = new DshRuntime(context, output, new TaskRuntimeContribution(context, debugRuntime), broker, reuseAcrossWindows,
    { script: path.join(context.extensionUri.fsPath, 'dist', 'runtime-host.js') })
  activeRuntime = runtime

  if (workspace === undefined) {
    output.appendLine('[chat] Open a folder or workspace before using DeepSeek Harness.')
  }
  const cwd = workspace?.uri.fsPath ?? ''
  const diffReviews = new DiffReviewManager()
  const controller = new DshChatController(runtime, output, new DirtyFileGuard(), diffReviews, context.workspaceState, cwd,
    String(context.extension.packageJSON.version ?? ''))
  controller.afterFirstReady(sweep)
  const settingsPanel = new SettingsPanelManager(controller, context.extensionUri, String(context.extension.packageJSON.version ?? ''))
  context.subscriptions.push(settingsPanel)
  const pluginManager = new DshPluginManager(context, controller, output, () => settingsPanel.open())
  const editorContext = new EditorContextBridge(() => controller.cwd, () => controller.state.sessionId)
  const provider = new DshViewProvider(controller, output, editorContext, context.extensionUri, String(context.extension.packageJSON.version ?? ''))
  const panels = new Set<{ panel: vscode.WebviewPanel; surface: DshSurface }>()
  const taskPanels = new TaskPanelManager(controller, context.extensionUri)
  context.subscriptions.push(taskPanels, vscode.commands.registerCommand('deepseekHarness.openTaskDetails', (value: unknown) => {
    if (typeof value !== 'object' || value === null) return
    const address = value as Record<string, unknown>
    try {
      if (address.kind === 'subagent' && typeof address.sessionId === 'string') taskPanels.open({ kind: 'subagent', sessionId: address.sessionId })
      else if (address.kind === 'job' && typeof address.sessionId === 'string' && typeof address.jobId === 'string') taskPanels.open({ kind: 'job', sessionId: address.sessionId, jobId: address.jobId })
      else return {opened:false,error:'Invalid task address.'}
      return {opened:true}
    } catch (error) { const message=dshErrorText(error); void vscode.window.showErrorMessage(message); return {opened:false,error:message} }
  }))

  context.subscriptions.push(
    output,
    runtime,
    controller,
    diffReviews,
    editorContext,
    provider,
    ...(debugSessions === undefined ? [] : [debugSessions]),
  )
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('dsh-diff', diffReviews))
  context.subscriptions.push(runtime.onDidChangeState(state => { controller.observeRuntime(state) }))
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(
    'deepseekHarness.chat',
    provider,
    { webviewOptions: { retainContextWhenHidden: true } },
  ))

  const openChat = async (): Promise<void> => {
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.focusPrompt()
  }

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openChat', openChat))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openSettings', () => settingsPanel.open()))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openInEditor', async () => {
    const panel = vscode.window.createWebviewPanel(
      'deepseekHarness.editor',
      'DeepSeek Harness',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    const entry = { panel, surface: new DshSurface(panel.webview, controller, output, editorContext, context.extensionUri, String(context.extension.packageJSON.version ?? '')) }
    panels.add(entry)
    panel.onDidDispose(() => {
      entry.surface.dispose()
      panels.delete(entry)
    })
    await controller.ensureStarted()
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.signIn', async () => {
    await controller.signIn().catch(error => { void vscode.window.showErrorMessage(dshErrorText(error)) })
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.signOut', async () => {
    await controller.signOut().catch(error => { void vscode.window.showErrorMessage(dshErrorText(error)) })
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.restart', async () => {
    try {
      if (!await controller.restart()) return
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      return
    }
    // Restarting is the only in-product way to hand conversations back, because
    // DSH releases one only when its owner exits. Say so when it freed something.
    const released = controller.releasedSessions
    if (released > 0) {
      void vscode.window.showInformationMessage(`DeepSeek Harness restarted, releasing ${String(released)} conversation(s) it was holding.`)
    }
  }))

  /**
   * End a runtime this extension started in an earlier window.
   *
   * This is the manual half of the release story: the automatic path only ends a
   * runtime when no window is left using it. Nothing here can reach a runtime this
   * extension did not start, and a runtime whose process cannot be proved is
   * reported instead of signalled.
   */
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.forgetSavedRuntime', async () => {
    if (broker === undefined) {
      await vscode.window.showInformationMessage('This window keeps no record of DSH runtimes.')
      return
    }
    const lock = await broker.acquireTransition()
    try {
      const saved = broker.readDescriptor()
      if (saved === undefined || saved.manageable) {
        await vscode.window.showInformationMessage('No saved DSH runtime is on record. (A runtime this extension started is not a saved runtime; "DSH: End a Leftover Runtime" ends one of those.)')
        return
      }
      broker.clearDescriptor()
    } finally { lock.release() }
    output.appendLine('[runtime] forgot the saved DSH runtime; the process itself is untouched')
    await vscode.window.showInformationMessage('Forgot the saved DSH runtime. It keeps running — only this extension stops attaching to it.')
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.endLeftoverRuntime', async () => {
    if (broker === undefined) {
      await vscode.window.showInformationMessage('This window keeps no record of DSH runtimes.')
      return
    }
    const recorded = await inspectRecordedRuntime(broker, resolveDshHome())
    if (recorded.state === 'none' || recorded.state === 'gone') {
      await vscode.window.showInformationMessage(
        'No DSH runtime started by this extension is on record. A runtime you started yourself — the desktop app, or a `dsh web` in a terminal — is not managed here; "DSH: Diagnose Session Occupancy" finds what holds a conversation.')
      return
    }
    if (recorded.state === 'attach-only') {
      await vscode.window.showInformationMessage(`The recorded DSH runtime (${describeDescriptor(recorded.descriptor)}) is attach-only and is never ended from here.`)
      return
    }
    const { descriptor, held } = recorded
    const where = descriptor.cwd === '' ? '' : `, started in ${descriptor.cwd}`
    const count = recorded.heldIsLowerBound ? `at least ${String(held)}` : String(held)
    const choice = await vscode.window.showWarningMessage(
      `End the DSH runtime this extension started?\n\n${describeDescriptor(descriptor)}${where}. It is holding ${count} conversation(s); ending it releases them so the desktop app or another instance can use them.`,
      { modal: true }, 'End It')
    if (choice !== 'End It') return
    const result = await endRecordedRuntime(broker, descriptor)
    output.appendLine(`[runtime] ${result.ended ? 'ended' : `did not end (${result.reason})`} ${describeDescriptor(descriptor)}; ${count} conversation(s) released`)
    if (result.ended) {
      await vscode.window.showInformationMessage(`Ended the DSH runtime: ${count} conversation(s) released.`)
      return
    }
    if (result.reason === 'in-use' || result.reason === 'replaced') {
      await vscode.window.showWarningMessage(result.reason === 'in-use'
        ? 'This DSH runtime is still in use by a VS Code window. Close the using windows before ending it.'
        : 'The recorded DSH runtime changed while the confirmation was open. Nothing was stopped; inspect it again.')
      return
    }
    await vscode.window.showWarningMessage(result.reason === 'unproved'
      ? `That DSH runtime did not answer with its own launch token, so it was left alone — the process with pid ${String(descriptor.pid)} may not be it any more. "DSH: Diagnose Session Occupancy" reports what holds a conversation now.`
      : `The runtime was asked to end but pid ${String(descriptor.pid)} is still there. See the DeepSeek Harness output for details.`)
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.reconnect', async () => {
    await controller.reconnect().catch(error => { void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)) })
  }))
  let runtimePickerBusy = false
  const chooseRuntime = async (kind: 'external' | 'managed'): Promise<void> => {
    if (runtimePickerBusy) return
    runtimePickerBusy = true
    try {
      if (kind === 'external') await pickExistingRuntime(controller)
      else await pickManagedRuntime(controller)
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not select the DSH runtime.')
    } finally {
      runtimePickerBusy = false
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.connectExistingRuntime', () => chooseRuntime('external')))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.startManagedRuntime', () => chooseRuntime('managed')))
  if (workspace !== undefined) {
    context.subscriptions.push(watchDebugConfiguration(controller, workspace.uri, output))
  }
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.managePlugins', async () => {
    await pluginManager.show().catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      output.appendLine(`[plugins] ${message}`)
      void vscode.window.showErrorMessage(message, 'Show Output').then(choice => {
        if (choice === 'Show Output') output.show(true)
      })
    })
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.addSelection', async () => {
    if (!editorContext.pinSelection()) {
      void vscode.window.showInformationMessage('Select code in the current DeepSeek project first.')
      return
    }
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.focusPrompt()
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.fixWithDeepSeek', async () => {
    const problem = editorContext.problemAtActiveEditor()
    let prompt: string
    if (problem !== undefined) {
      prompt = problemPrompt(problem)
    } else if (editorContext.pinSelection()) {
      prompt = 'Fix the selected code.'
    } else {
      const activeFile = editorContext.viewState().availableFile
      if (activeFile === undefined) {
        void vscode.window.showInformationMessage('Open a file in the current DeepSeek project first.')
        return
      }
      const mention = activeFile.path.includes(' ') ? `@{${activeFile.path}}` : `@${activeFile.path}`
      prompt = `Fix the issue in ${mention}.`
    }
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.setPrompt(prompt)
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.sendProblem', async (...args: unknown[]) => {
    const problem = await chooseProblem(editorContext, args)
    if (problem === undefined) return
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.setPrompt(problemPrompt(problem))
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.showOutput', () => { output.show(true) }))
  /**
   * Read-only occupancy report for the open conversation.
   *
   * DSH returns a lock only when its owner exits, so when a conversation is held
   * elsewhere the user needs to know *which* process holds it. This reports that
   * and offers the command to run; it never terminates anything, because the
   * holder may be the desktop app or a `dsh web` the user started themselves.
   */
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.diagnoseOccupancy', async () => {
    const sessionId = controller.state.sessionId
    if (sessionId === '') {
      await vscode.window.showInformationMessage('Open a conversation first — this reports which process is holding it.')
      return
    }
    const home = resolveDshHome()
    const locks = sessionLockPaths(home, sessionId)
    output.appendLine(`[occupancy] conversation ${sessionId}: ${String(locks.length)} lock file(s) under ${home}`)
    if (process.platform === 'win32') {
      output.appendLine('[occupancy] Windows cannot report which process holds a lock file.')
      await vscode.window.showInformationMessage(
        'Windows cannot report which process holds a conversation. Quit the other DSH instance — the desktop app, another VS Code window, or a `dsh web` in a terminal — then reconnect.')
      return
    }
    const reports = await Promise.all(locks.map(async lock => await describeLockHolders(lock)))
    const holders = reports.flatMap(report => report.holders)
    for (const holder of holders) output.appendLine(`[occupancy] held by pid ${String(holder.pid)} (${holder.command})`)
    if (holders.length === 0 && reports.some(report => !report.available)) {
      output.appendLine('[occupancy] the process listing tool is unavailable, so the holder could not be identified')
      await vscode.window.showInformationMessage(
        'This conversation is held by another DSH instance, but this machine cannot list the process holding it. Quit the other DSH instance — the desktop app, another VS Code window, or a `dsh web` in a terminal.')
      return
    }
    if (holders.length === 0) {
      output.appendLine('[occupancy] no running process holds it')
      await vscode.window.showInformationMessage(locks.length === 0
        ? 'No DSH instance has this conversation open, so nothing is holding it.'
        : 'No running process holds this conversation. A lock file stays behind after its holder exits; that is normal.')
      return
    }
    const summary = holders.map(holder => `${holder.command} (pid ${String(holder.pid)})`).join(', ')
    const choice = await vscode.window.showWarningMessage(
      `This conversation is held by: ${summary}. DSH releases a conversation only when its owner exits, so ending that process is the only way to free it.`,
      'Copy kill command', 'Show Output')
    if (choice === 'Copy kill command') {
      await vscode.env.clipboard.writeText(`kill ${holders.map(holder => String(holder.pid)).join(' ')}`)
    } else if (choice === 'Show Output') output.show(true)
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openInBrowser', async () => {
    try {
      await runtime.start(controller.cwd === '' ? undefined : vscode.Uri.file(controller.cwd))
      const uri = vscode.Uri.parse(runtime.connection.browserUrl().href)
      await vscode.env.openExternal(await vscode.env.asExternalUri(uri))
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.configureApiKey', async () => {
    await configureApiKey(controller, context.secrets, output)
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.configureTaskServices', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:fallleaves01.dsh-sidebar enable')
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.clearApiKey', async () => {
    await clearApiKey(controller, context.secrets, output)
  }))

  const welcomeKey = 'deepseekHarness.welcome.openChat.v1'
  if (workspace !== undefined && context.globalState.get<boolean>(welcomeKey) !== true) {
    void (async () => {
      try {
        await context.globalState.update(welcomeKey, true)
        const choice = await vscode.window.showInformationMessage(
          'DSH Sidebar is ready in VS Code’s right sidebar.',
          'Open DSH Sidebar',
        )
        if (choice === 'Open DSH Sidebar') await openChat()
      } catch (error) {
        output.appendLine(`[onboarding] ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }
}

export async function deactivate(): Promise<void> {
  const runtime = activeRuntime
  activeRuntime = undefined
  await runtime?.stop()
}
