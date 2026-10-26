# Changelog

Notable changes to DSH Sidebar, newest first. Entries before 0.1.0 predate this
file; `git log` is the record for those.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [SemVer](https://semver.org/). The sidebar is distributed as a
VSIX — see the README for installing one.

## [Unreleased]

## [0.1.22] - 2026-10-26

### Fixed

- Present a failed response as DSH does: the block now says `This turn failed`
  (or `Task stopped` for a signed-out or interrupted run), replaces known
  provider codes with the same wording DSH uses (`AUTH`, quota, signed-out,
  sign-in required, interrupted), keeps an unknown code as a separate
  monospace badge instead of prefixing the reason, and never renders a badge
  for `INTERRUPTED`. The failure reason no longer carries a `CODE: ` prefix.
- Decode a provider JSON error body for display. When the runtime stores a raw
  HTTP error envelope such as `{"error":{"message":"Internal Server Error",
  "code":500,...}}`, the reason becomes `Internal Server Error (HTTP 500)`;
  the runtime code still appears as its badge. The body is truncated to 2,000
  characters and passes the existing credential redaction. DSH itself shows
  the raw body, so this is a deliberate readability improvement documented in
  the adaptation notes.
- Keep the failure reason and code in step across retries and streamed
  attempts, including a late `llm/retry` failure and a message whose code was
  removed; a deferred long response refreshes its failure block too.

## [0.1.21] - 2026-10-26

### Fixed

- Acknowledge a Stop click immediately. The request used to wait for the
  `session/cancel` round trip before changing the button, and cancellation is
  cooperative, so a click could look ignored for up to the RPC timeout. The
  sidebar now enters `Stopping…` before the request, keeps that state for six
  seconds, then hands the control back as an enabled `Stop requested` button:
  DSH accepts repeated cancels, so another click is safe. A click without a
  running turn no longer leaves an acknowledgement, and a new turn or another
  conversation never inherits one.
- Open a conversation without waiting for the model catalogue. The follow
  snapshot used to be followed by a serial `session/modelCatalog` request, so a
  switch could spend two RPC timeouts in loading; the catalogue now refreshes in
  the background while the conversation becomes ready.
- Give a follow snapshot eight seconds instead of thirty and say what to do
  when it does not arrive: open the conversation again, or reconnect the
  runtime. The timeout also closes the superseded subscription, so retrying is a
  fresh read rather than a stuck state.
- Pin the snapshot wait and the Stop button's three states with tests, so a
  silent return to the long waits cannot pass the suite.

## [0.1.20] - 2026-10-26

### Fixed

- Allow changing settings while DeepSeek tasks are running, matching DSH. The
  runtime serves `settings/mutate` and `pluginManager/setBundleEnabled` without
  a running-task check: it answers with `applied` or `restart-required`, which
  the page already reports. Remove the sidebar's extra `hasRunningTasks`
  refusals for bundle switches and for restart-scoped settings; the latter was
  dead code because DSH reports every settings namespace as `live`.
- Drop stale runtime activity entries when a session list arrives. A session the
  runtime no longer lists could otherwise pin `hasRunningTasks` true for the rest
  of the connection and keep blocking settings changes the runtime accepts.
- Show Agent Teams members by their Session's live running state instead of the
  durable `phase`. The projection marks the Lead `active` for the life of the
  team, so an idle Lead read as Active; it now reads Inactive, and the roster
  reports how many members are actually running.

## [0.1.19] - 2026-10-26

### Fixed

- Keep settings operation feedback honest across retries and navigation: a new
  result with the same text is announced again, while returning to a section
  whose error was already shown does not replay it. A bundle toggle now shows
  the requested state (with an `Applying…` note) while the change is pending
  instead of reverting to the old value.
- Resolve Team tool-card links when the `agentTeam` projection arrives after the
  message was rendered, by keying only the affected cards on the member map.
- Bound runtime-provided data before it reaches the DOM: Team projections
  (50 members, 200 tasks, 256-character ids, 300/1000-character text, 20-item
  collections), the permission catalogue (16 options, 300-character copy,
  64-character values), settings string values (1024 characters) and bundle
  failure codes (64 printable characters). This prevents a hostile or runaway
  runtime payload from creating an unbounded menu or task list.
- Wait 130 s for `pluginManager/setBundleEnabled`, because the host serializes
  profile mutations under a file lock it waits up to 120 s for; the previous
  30 s client timeout could report a completed change as failed.
- Describe the permission and bundle reads as capability probes rather than
  claiming older runtimes lack them, and refresh the adaptation record's test
  count and review log.

## [0.1.18] - 2026-10-26

### Fixed

- Show settings operation results in a persistent toast above the scrolling
  body instead of only at the end of the section content, where a long plugin or
  model list pushed a failure out of view. A failure stays visible until it is
  dismissed or replaced; a confirmation fades after a short pause and is never
  repeated by later re-renders. The toast carries `role="alert"`, names the
  failure text verbatim, and can be dismissed with its close button.

## [0.1.17] - 2026-10-26

### Added

- Read the runtime's `permissionPresets/catalog` and offer the experimental
  `auto` (Auto review) preset in the Permission selector. Mark it `EXP`, select
  it when `permissions.currentValue` reports `auto`, and confirm before
  switching, because it runs without a sandbox, reviews each tool call with the
  model, and can wrongly allow or deny actions. Require the same confirmation
  for a typed `/permission auto`. A runtime that does not serve the catalogue
  keeps the shipped three presets, and a failed optional read never affects the
  connection.
- Render the Agent Teams `agentTeam` Session projection in the Tasks panel: the
  durable roster with lifecycle phase and Lead/Teammate role, and the read-only
  shared task board with status, readiness, blocked-by ids, owner and write
  scopes. Member rows open the member conversation, and Team tool cards resolve
  a member name against the projection before linking, falling back to a generic
  card instead of a dead link. Validate the untrusted projection in a new pure
  module (`src/agent-team-state.ts`).
- Recognize the DSH 0.2.1-rc.3 Team tools. `spawn_teammate` and `list_agents`
  keep their member references, and `send_message`/`interrupt_agent` accept the
  Team variant's `target` member name in addition to the Session-id form.
- Ignore unrecognized top-level `$events` and `session/control` frame types
  instead of aborting the shared event carrier. Report each distinct type once,
  cap the diagnostics per connection, and keep the strict payload checks for
  known frame types.
- List the runtime's optional bundles under Settings → Plugins and toggle one
  through `pluginManager/setBundleEnabled` when this extension owns the runtime.
  Show each bundle's enable state, version and description; refuse the toggle
  for an attached external runtime or while DeepSeek tasks are running; report a
  `restart-required` result as a restart request rather than as saved; hide the
  controls for a read-only profile. Refresh from `plugin-manager/changed`.
- Render the runtime's experimental settings namespaces as declarative cards:
  Reasoning translation (`cot-translation`: provider and target language),
  Voice input (`speech-to-text`: provider and language) and Plugin market
  (`plugin-market`: index URL list). Extend the settings field model with
  `select` and `string-list` types, validate enum membership and HTTP(S) index
  URLs before writing, and hide a card whose namespace is absent. Re-read the
  permission catalogue when `permission-presets/catalog-changed` arrives.

### Fixed

- Accept a runtime-provided permission catalogue whose entries are not the
  built-in three, including a profile-pinned `custom` value, and keep exactly
  one row selected instead of hiding the current state when no shipped preset
  matches.
- Use a single confirmation path for the Permission selector and typed
  `/permission` commands, so Full access keeps its acknowledgement and Auto
  review gains one without duplicating the dialog wording.

## [0.1.16] - 2026-10-23

### Fixed

- Distinguish connection to an existing shared runtime from process startup,
  event subscriptions and history loading. Expose Shared/External connection
  identity and PID in the toolbar, with a window-local reconnect action.
- Show an idle Connect action when automatic startup is disabled, instead of
  displaying Starting despite no connection attempt. Keep Show Output available
  during loading; add phase logs and elapsed connection timings without secrets.
- Allow manual connection retries after failed discovery or authentication without
  requiring Restart Runtime. Automatic stream recovery still never starts a process.
- Apply startupTimeout to shared operation/startup waits, instead of waiting up
  to 310 seconds for an operation lock regardless of the user's setting. Preserve
  the owner and its process when a waiting window times out.
- Fix the loading indicator's phase name and refresh recovery buttons when their
  availability changes without a new error message. Reuse compatible 0.1.15 helpers.

### Validation

- Add regressions for idle views, shared PID display, loading stages, manual retry,
  lock timeout and retry, and narrow-sidebar interaction. Retain the real DSH
  multi-process recovery suite; no model requests are sent.

## [0.1.15] - 2026-10-23

### Fixed

- Before opening a conversation through a shared managed runtime, recover a
  recorded orphan when its helper has exited and no valid window uses it. Verify
  the DSH process identity, stop it, then start one supervised replacement under
  the cross-window transition lock. Healthy compatible instances remain reusable.
- Persist startup process identity before URL publication so the next connection
  can recover interrupted startup after all managers have been killed. Preserve
  unverifiable records and never stop external runtimes or silently interrupt
  another live user. Empty process identities do not establish PID reuse.

### Validation

- Add real-process tests killing both the extension host and helper, with concurrent
  next-window recovery, reopened history, history search and Schedule, plus an
  orphan that had not published its connection URL. No model requests are sent.
- Cover PID reuse, missing identity, denied signals, cancellation, external
  runtimes and live-user conflicts with targeted unit tests.

## [0.1.14] - 2026-10-23

### Changed

- Bind Linux Remote–SSH leases and runtime operations to the verified VS Code
  Server process, in addition to each extension host. A surviving orphan extension
  host or operation can no longer retain DSH after its server exits.
- Retain the single shared runtime helper and cross-window handoff. Document
  native `remote.SSH.reconnectionGraceTime`, normal-close behavior and cleanup
  limitations without adding a second long-term retention timer or modifying DSH.
- Update the runtime-host protocol to `ipc-2`; upgrade all windows and explicitly
  restart the managed runtime to replace an older helper.

### Fixed

- Bound helper initialization, shutdown and inherited-pipe waits; terminate DSH's
  dedicated POSIX process group, escalating from SIGTERM to SIGKILL when needed.
- Let surviving attached windows detect and clean up a killed helper's identified
  DSH process, including after the creating window has closed. No automatic restart.
- Do not report the helper's exit as proof that DSH exited. Recover interrupted
  startup using the captured DSH process identity; retain uncertain records.
- Recognize Linux zombies as exited; prevent delayed cleanup from removing a
  newer startup reservation or runtime descriptor, and bound queued output.

### Validation

- Add isolated real-process fault injection and regression tests for server death,
  helper loss, blocked DSH, refused graceful shutdown, inherited pipes and PID reuse.
- Preserve real official-DSH tests for history search, Schedule, shared sessions,
  concurrent startup, cross-window restart and cleanup. No model requests are sent.

## [0.1.13] - 2026-10-22

### Fixed

- Make Restart Runtime replace an incompatible recorded managed runtime even
  when the requesting window failed before acquiring a connection or lease.
- Offer an explicit shared-restart confirmation when other windows use DSH,
  explaining task interruption and applying the requesting window's settings.
  Cancellation retains the current conversation and running work.
- Validate the reviewed process and affected windows again before shutdown;
  refuse a changed instance, new borrowers or uncertain process identity.
  Recover an unresponsive service using proved OS process identity, with the
  launch-token handshake as a fallback. Never stop user-owned external runtimes.
- Report only the actual differing configuration fields, without printing
  environment values or credentials. Report replacement failures as failures.
- Keep project switching local to the requesting window, without offering a
  global shared restart after the selected project has already changed.
- Open the newly created conversation directly when a restarted runtime has an
  empty project catalog. Do not recursively create more sessions while blank
  conversations remain absent from the list.

## [0.1.12] - 2026-10-21

### Fixed

- Make subagent tool cards directly navigable: click a child name to open its
  conversation, or the trailing arrow to open independent details. Keep original
  request/result output collapsed and available without blocking navigation.
- Retain bounded child references in compact and historical tool messages,
  including official control calls and structured code-mode activation results.
- Resolve cold children from their owning catalog and retain blank catalog-owned
  sessions. Open with the exact parent address, without guessing from labels.
- Show live child status, tokens and duration independently of the completed
  delegation call. Keep external executions informational and report opening
  errors with retry, including timeouts and stale project/runtime responses.
- Use the same primary/secondary navigation in Tasks and nested child details.

## [0.1.11] - 2026-10-20

### Fixed

- Serialize shared runtime lookup, startup, registration and last-window shutdown
  across extension hosts. Reuse compatible history-search and Schedule overlays.
- Share per host, account and DSH home across VS Code profiles. Keep legacy
  leases in their original ledger during migration; UI version changes alone no
  longer force a competing runtime.
- Retain live runtime records on connection failure or incompatible launch
  settings, and report the error without starting a second writer. Prefer a
  saved authenticated runtime over probing the conventional port.
- Prevent restart and leftover-process termination while another window uses
  the runtime. Reconnect rebuilds only the requesting window's connection.

### Added

- A runtime host that owns and drains DSH's output pipes when the spawning
  window closes. The last normal exit stops DSH; if every extension host crashes,
  dead leases trigger cleanup after a 30-second grace period. It never restarts
  DSH automatically and writes no diagnostic output files.
- Isolated multi-process coverage for simultaneous startup, shared task services,
  window exit, process crashes, reconnect, and final cleanup, without model calls.

### Security

- Keep authentication descriptors and environment-signing keys owner-only.
  Compare launcher credentials using a local HMAC without persisting their values.
  Refuse unsafe state directories and uncertain shutdown evidence.
- Keep the window-bound native debugger exclusive; sharing requires disabling
  autonomous debugging, rather than connecting another window to its bridge.

## [0.1.10] - 2026-10-20

### Changed

- Open settings as a modal inside chat, with the official DSH gear and navigation
  icons, an 800px panel, a 188px navigation column, native card measurements and
  compact controls. Keep VS Code appearance and keyboard settings as host actions.
- Group plugin settings below Built-in plugins and show a read-only inventory
  first. Keep provider keys above a collapsible Custom settings editor.
- Adapt the navigation to an icon rail in narrow sidebars, and keep long field
  hints below inputs rather than compressing them beside Reset or Clear key.

### Fixed

- Isolate every settings opening from chat messages and earlier modal replies.
  Release subscriptions and secret drafts on close; support Escape, mask click,
  focus containment and return to the invoking control.
- Keep configured-credential indicators consistent when a provider is not active.

## [0.1.9] - 2026-10-20

### Added

- Show external subagent executions as informational task rows, matching DSH;
  do not open or route them as local conversations.
- Add the official Search / Fetch API switch, separate endpoint/limit drafts,
  result counts from 1 to 50, and credentials for the selected search API.
- Edit custom Pi provider model reasoning levels and API values from the serving
  schema, preserving unshown model fields and automatic discovery when disabled.
- Mask recognized credentials in sent user text, with per-value Show/Hide controls
  in chat and task details. Use DSH 0.2.1-rc.2's matching rules; sending and explicit
  message copying retain their original contents.

### Changed

- Align credential reveal icons, switches, task-detail user bubbles, and narrow
  settings footers. Keep the active navigation item visible and keyboard-focused.
- Retain unsaved search phases after partial failure; fence credential writes
  and clears by namespace, revision, runtime identity and search selection.

### Fixed

- Handle DSH 0.2.1 workspace replacement snapshots so archived conversations
  refresh correctly, while retaining support for older archive update frames.
- Recognize current Typert method tables in the contract diagnostic tool and
  report incomplete comparisons instead of an unsupported compatibility claim.

## [0.1.8] - 2026-10-16

### Fixed

- Retain received output from failed model requests, including durable failed
  attempts restored from conversation history. Show the failure status, error
  code and reason in chat and subagent details, and keep retries separate.
- Label failed response duration as "Failed after" instead of "Completed in".

### Security

- Redact embedded URL credentials from runtime diagnostics, including the
  failure reasons displayed beside retained responses. Render errors as literal
  text and keep conversation captures and audit files out of the VSIX.

## [0.1.7] - 2026-10-15

### Added

- A dedicated settings page from the chat toolbar, command palette and plugin
  manager. Forms follow the official DSH settings cards instead of exposing all
  YAML fields: General, Models, Shell, Agent loop, Subagents and Web search.
- Provider creation/editing/removal, protocol and endpoint controls, model rows
  with capacities and input types, and selectable endpoint model discovery.
- Write-only provider/search credentials with capability checks, retained drafts
  after partial saves, and explicit confirmation before clearing a stored key.
- Shell timeout/output limits, parallel tool calls, delegation limits, allowed
  subagent model routes, account status and the official session-log upload switch.
- Browser coverage for the settings forms and isolated official-runtime checks
  for settings, credential storage, provider editing and model discovery.

### Security

- Fence writes by runtime client, namespace revision and credential reference;
  preserve unshown model/provider fields and reject stale or read-only targets.
- Clear secret drafts on runtime changes and abort outstanding model discovery
  when closing the page. Keep credential literals out of profile YAML and replies.
- Exclude DSH's separate `.credentials.yaml` store and backups from Git and VSIX.
  The official local credential provider uses owner-only files on POSIX; this is
  not an encrypted vault or isolation from tools running as the same OS user.

## [0.1.6] - 2026-10-15

### Changed

- Keep the conversation directory focused on recent/archived lists, search and
  management. New conversation opens the full chat composer with model,
  reasoning effort, agent composition, permission and attachment controls.
- Open blank conversations directly in chat. Remove the directory's simplified
  composer and automatic create/send behavior for directory drops or pastes.
- Refresh the English, Chinese, Japanese and packaged feature documentation,
  VSIX installation instructions, Remote SSH requirements and privacy notes.

### Fixed

- Wait for a matching creation receipt and ready conversation before enabling
  submission. Preserve existing drafts, reject stale project or conversation
  receipts, and avoid automatic prompt delivery after creation.
- Refresh directory selection and composer controls when creation starts or
  finishes, including returning to the current conversation after a list update.

## [0.1.5] - 2026-10-15

### Fixed

- Bind diff review, keep and revert messages to their originating conversation
  and project. Reject stale messages at the extension host, and recheck the
  conversation, project and load generation after a revert confirmation.
- Preserve text typed after a homepage draft becomes visible while its creation
  receipt is pending. Keep both drafts if sending is temporarily blocked.
- Make Enter honor the pending-send gate used by the send button, preventing
  repeated submission of image or file attachments before acknowledgement.
- Return the created conversation ID directly and verify it before model
  selection and delivery, rather than deriving the target from mutable state.

## [0.1.4] - 2026-10-14

### Changed

- Add a full conversation directory with an independent new-task composer,
  project-scoped drafts, recent/archived views, search and per-row action menus.
  Keep the top picker as a compact recent list with a View all entry point.
- Show main conversations in both lists and search results. Subagent details
  remain in Tasks; archived children retain identity and ownership metadata.
- Replace the large Changed Files card with a collapsed file-count and line-count
  summary, Review entry point, compact file rows and overflow actions. Preserve
  per-turn diff, keep and revert behavior and snapshot availability checks.
- Archive without a modal confirmation and provide Undo. Archived conversations
  support both rename and restore from the directory.

### Fixed

- Wait for the matching new conversation to open before sending a homepage
  prompt. Keep creation failures and stale project/session replies from sending
  the draft to another conversation.
- Preserve keyboard navigation, reading position and disclosure state across
  directory navigation and conversation updates.

## [0.1.3] - 2026-10-12

### Fixed

- Keep image attachments with held slash commands, serialize automatic command
  execution across overlapping idle events, and keep queue updates scoped to
  the visible conversation. Disconnected manual execution retains the queue.
- Log command names without their private arguments. Redact API keys, refresh
  tokens and credential flags, including stored or inherited keys echoed without a
  label and startup failures exposed to controller state or callers.

### Security

- Update MCP SDK, DOMPurify, Vitest and affected compatible transitive
  dependencies. Keep KaTeX on the verified 0.18.7 release and check the extension
  against VS Code 1.100 types.
- Apply a reproducible local depth-limit patch to the packager's `braces` 3.0.3
  dependency for CVE-2026-93687, whose upstream fix has not been published.
  Regression checks exercise nested strings and ASTs through compile, expand
  and stringify. This dependency and its patch are excluded from the VSIX.

## [0.1.2] - 2026-10-12

### Changed

- Make file context explicit. The composer’s add button opens a searchable,
  multi-select file/folder list; selected references have individual remove
  buttons. The current editor and selected lines are optional suggestions and
  are no longer automatically included with a prompt. Image attachment, dropped
  resources, the Add Selection command and typed `@` references remain available.

### Fixed

- Scope file picker results and mutations to their originating conversation,
  deduplicate concurrent additions, and wait for add/remove receipts before
  accepting a send, including Enter.
- Consume only the references in a successfully sent snapshot. Files added
  afterward and drafts in other conversations are preserved.

## [0.1.1] - 2026-10-12

### Changed

- Move agent composition into the composer's conversation settings menu. A fixed
  preset no longer occupies a permanent row; new conversations can still choose
  their agent composition, including runtimes with no permission catalog.
- Show editor context as a single compact 11px row of file names. Full paths stay
  in tooltips, file/selection/diagnostic references open their exact file and line,
  and pinned references retain independent removal controls.
- Include the ordinary fixed-preset/editor-file state in real-browser coverage,
  including an increased chat font size and three viewport sizes.

### Added

- A shared DSH-inspired chat/task appearance with theme-aware surfaces, compact
  task rows, clearer status and metadata, an independent task detail layout,
  visible keyboard focus, and three editable welcome prompt suggestions.
- Real-browser dark, light and high-contrast coverage across three viewport sizes
  for both the chat and task details; expanded isolated official-runtime checks.

- Independent child detail panes support live transcripts, earlier history,
  paged tool output, approvals, questions, Queue/Steer and Stop without changing
  the main conversation. Parent-agent availability gates continuation.
- Project background task discovery and bounded stdout/stderr/log output panes;
  failed watches show stale-status notices and can be refreshed.
- Goal controls with revision checks, round budgets, activation and blocked state;
  reminder catalogs and paged delivery history; durable Workflow phase/member
  progress and access to live job logs; server-side conversation body search.
- Optional managed Web runtime settings enable Schedule and first-search SQLite
  content indexing on DSH 0.2.0-rc.2+. Existing runtime configuration stays intact.
- A Tasks panel above the composer lists subagents at every depth and plan steps.
  Click a child to open an independent details pane beside the main chat.
  Rows show running, approval/question attention, normal completion, duration and
  token usage; one-shot and unknown-mode children have a read-only composer.
- Every window on a machine shares one DSH runtime: a window attaches to the
  runtime another window of this extension already started, instead of starting a
  second one. DSH holds a conversation's write lock until the process owning it
  exits, so one holder means windows stop competing for the same conversations —
  and reopening a window after a crash reattaches to the work still running there.
  Only a runtime this extension started is ever reused, identified by pid *and*
  process start time; one started with different settings is never adopted, and
  nothing this extension did not start is ever adopted or ended. Set
  `deepseekHarness.reuseAcrossWindows` to `false` to give each window a private
  runtime.
- `DeepSeek Harness: Diagnose Session Occupancy` reports which process holds the
  open conversation, and can copy the command that ends it. It only reads: a lock
  holder may be the desktop app or a `dsh web` you started yourself, neither of
  which is the extension's to terminate.
- A runtime this extension started is stopped when the last window using it closes,
  which is what actually releases the conversations it holds. One another window
  still uses is left running, and the reason is written to the runtime output. A
  runtime is only ever ended once it is proved to be the same process: by pid with
  its process start time where the platform reports one, and otherwise by
  authenticating the launch token DSH mints per process and never stores. A pid
  that cannot be proved is reported rather than signalled, because it may since
  have been reused by an unrelated process.
- `DeepSeek Harness: End a Leftover Runtime` for the case the automatic path cannot
  reach: a runtime an earlier window left behind that nothing will ever adopt —
  because it was started with different settings, or stopped answering — while it
  still holds the conversations it opened. The command says what it is holding
  before asking, and signals the process only after the runtime proves it is that
  instance. A runtime this extension did not start is out of its reach by
  construction.
- Restarting now reports how many conversations it released, since restarting a
  runtime is the only in-product way to hand them back.

- A conversation another DSH process owns is now shown as a state rather than
  reported as an error: the banner above the composer says so once, the composer is
  disabled, and two actions are offered — check again, or find the process holding
  it. The wording of the persistence layer's `SessionAlreadyOwnedError`, which the
  background resume during `follow` delivers as bare text, is recognised wherever
  it arrives, including under a generic `gateway/internal`.
- A runtime you connect to with its launch URL can be saved, so every window and
  every later session attaches to it instead of starting yet another runtime over
  the same conversations. Saving is offered and never assumed, and a saved runtime
  is **attach-only**: this extension installs nothing into it, writes no settings or
  credentials to it, and never ends it — only its owner can, by stopping the
  process. When it stops answering its record is dropped and the sidebar says so,
  rather than retrying a dead URL in every window. `DSH: Forget the Saved Runtime`
  removes it, and `deepseekHarness.rememberExternalRuntime` stops the offer.

### Security

- A reused runtime's launch URL carries its authentication token, so the record is
  written owner-only (`0600`) under the extension's global storage, and is never
  logged, shown in a notice, published to the Webview or synced. The same applies to
  a runtime you save yourself: its URL is written only after you accept the offer,
  and `DSH: Forget the Saved Runtime` removes it immediately.

### Fixed

- Launch explicitly configured official npm DSH entries directly with adjacent
  Node on POSIX hosts, or the extension host Node when unavailable, so a stale
  Remote SSH PATH cannot break the entry's `/usr/bin/env node` shebang.
- Keep stopped child durations finite when the final active timestamp is missing,
  and correct the indentation of direct and nested child tasks.
- Release task-detail control listeners on disposal and ignore unsolicited body
  responses that do not match an existing pending request.

- Preserve the initial `job/list` snapshot with newer DSH control baselines, and
  continue watching active background jobs after navigating to another session.
- Handle delegated approval and question requests while their owning conversation
  is open, including nested children discovered from persisted catalogs.
- Cancel a restart with a clear error if launch cleanup hangs or the old runtime
  cannot be terminated. Retain living process handles and broker records instead
  of reporting a successful stop and allowing replacement processes to accumulate.
- Leave a runtime running when the window that spawned it disconnects while other
  windows still hold leases for it.
- A blue file link in a reply opens the file it names. Its path was resolved
  literally against the project root, so a reply that named a file the way the
  model writes it — `rdma.cuh`, `csrc/kernels/rdma.cuh#L42`, `~/notes.md` — turned
  into `` `rdma.cuh` is not available on this machine. It may have been moved or
  deleted.`` and opened nothing. The destination of a Markdown link is now the path
  that opens (the label is only what the reader sees, including DSH's `#L42`
  fragments, and a link with no text of its own is labelled rather than left
  invisible), and a name the literal project path cannot answer for is looked up in
  the project's own index — including past the reader's own file-excludes, so a file
  that was built is still openable — asking which file was meant when the project
  holds more than one. Opening is deliberately no longer confined to the project: an
  absolute path, `~/…` or `../…` opens where it points, while review, keep and
  revert still refuse to touch anything outside it.
- A slash command sent with Enter while a task is running now waits for that task
  to finish instead of running immediately. DSH executes a command straight away
  and offers no way to queue one, so `/compact` — which refuses while an agent is
  busy — only produced a failed command node. The queue dock now shows the held
  command and offers to run it now (`Cmd`/`Ctrl`+`Enter` does the same) or drop it;
  it runs by itself when the conversation goes idle with nothing else waiting to
  start a turn.
- A message sent into an idle conversation no longer keeps saying `Sending…`. Only
  the projection's own rows describe a queue, and a message sent into a conversation
  whose turn ends at once never appears in one, so the local row now ends when the
  runtime answers at all — accepted or handed back.
- The conversation list opens in every phase, not only while a conversation is
  ready. A conversation that would not open left the sidebar loading or failed, and
  that disabled the one control that switches to another conversation — the way out
  of exactly that state. A click it accepts is reported if it cannot be honoured.
- One unexpected frame in a conversation-scoped subscription no longer takes the
  whole runtime feed down with it: that subscription fails alone, the failure is
  reported, and the sidebar stays usable. A `session/follow` that ended after its
  snapshot had been shown is reported too, instead of leaving the transcript to
  freeze in silence.
- A recorded rating fills its mark as soon as the runtime confirms it, and a turn's
  usage and clock appear when their metadata arrives, even though neither patch
  touches the message list. The queue editor keeps its text and caret while a turn
  streams, instead of being rebuilt on every keystroke.
- A turn that can no longer be observed stops being shown as running: opening a
  conversation that fails, or losing the event stream, releases its clock and its
  Stop button, and no longer blocks switching project or runtime. A conversation
  another DSH process owns is marked on the conversation whose action failed, not on
  whichever one happens to be on screen.
- A launch URL must carry a concrete port before it is handed the launch token, and
  the runtime's own output is redacted for the shapes a log line actually uses
  (`cookie="…"`, `cookie=…`, a JSON field), not only `Cookie: …`.
- A ratings read or write that fails is reported instead of rejecting into nothing;
  a failed Agent Preset selection always clears its busy state; and "New
  conversation" opens the conversation it created even if another load started
  first.

## [0.1.0] - 2026-09-29

The first release of the fork as an independent extension, on DSH 0.2.0-rc.2.

### Added

- Drag any file from the Explorer into the composer, not only images.
- Subagent conversations are visible in the session list, openable from their
  parent, and carry a bar back to it.
- Sign in with a DeepSeek account, with actionable messages when it fails.
- Rate a response, and branch the conversation from a copy of it.
- A copy button, the turn's token usage and the timestamp under every completed
  turn, and a copy button and timestamp under your own messages.
- A live turn clock: a running turn shows how long it has been running, and how
  long the runtime has been quiet.
- The thinking summary follows the newest line and counts up while the model
  thinks.
- Syntax highlighting for code blocks, with a copy button on each one.
- A searchable model picker: type to filter a long catalog, with the arrow keys
  and Enter to choose, and the provider named in each group.
- The elapsed time a completed turn took, next to its usage and timestamp.
- The action row is drawn with DSH's own icon set — copy, like, dislike, branch —
  and a recorded rating shows the filled mark, as DSH's row does.
- DSH's streaming highlight: while a turn runs, the turn clock, a streaming
  thought and a running tool's title carry a sweep across the words, next to the
  swimming tail DSH's own running row shows.
- The thinking row draws DSH's thinking mark, and every animation stops for
  `prefers-reduced-motion`.
- DSH's session statistics as pills above the composer: what the session has run
  and at what rate, then what it has spent and how much of it the cache carried,
  each with DSH's own mark and wording.
- A setting for the runtime's web search base URL, for hosts that cannot reach
  the public API.
- Default keyboard shortcuts for the sidebar commands.

### Changed

- The transcript is laid out at DSH's own measurements: one content size the
  whole conversation scales from, 16px between blocks and 32px around headings,
  18px of list indent, code at DSH's own sizes, and hairlines instead of full
  table borders. Under four columns a table fills the column, from four up it
  keeps its natural width and scrolls.
- A message is no longer introduced by a name and an avatar: your own turn is a
  bubble and the reply is the text itself, as in DSH, and the flow gap between
  rows is DSH's 6px inside a turn and 12px after a reply.
- Tool output is a disclosure row rather than a card — DSH's 24px row, a 16px
  leading mark and the detail after a dot — with the result on DSH's code
  surface, so a long turn reads as lines instead of a column of boxes.
- The turn's action row follows DSH's: 28px tall, 8px apart, 16px under the
  answer, with the bill and the clock grouped at its end as "12.3K tok" and
  "Completed in 2m 3s" — DSH's own wording, with the duration in DSH's tabular
  code face.
- A streaming reply no longer ends in a blinking block: the swimming tail in the
  live row already says the turn is working, and a caret in an answer you cannot
  type into read as an invitation to type.
- Adapt to DSH 0.2.0-rc.2; 0.1.7 runtimes stay supported.
- Collaboration modes are controlled by slash commands, as in DSH; permissions
  are the part that gets its own UI.
- A tool's output opens itself while the tool runs and folds again when it
  finishes. A tool you opened or closed yourself keeps that choice.
- The executable, its arguments and the search endpoint are per-machine
  settings, so Settings Sync never carries them to another host.

### Fixed

- Every slash command picked from the command menu did nothing.
- Enter that commits an input-method candidate — a Chinese, Japanese or dead-key
  composition — in the model search no longer switches the model by itself.
- A drag from the Explorer never reached the composer.
- Your own message had no timestamp and no copy button.
- The stop button now acknowledges the request, and works on subagents.
- Permission presets are restored, and Plan mode is left to its command.
- Expanding a long answer kept its Markdown, and escape sequences stopped being
  eaten.
- Starting the runtime again keeps the conversation you were reading.
- A conversation that cannot be opened no longer strands the sidebar, and a dead
  conversation no longer takes the whole event stream with it.
- A model that stops routing no longer disables the model picker, so you can
  switch away from it.
- A missing file is described instead of pasting a raw `ENOENT`.
- A "Keep" no longer hides the next edit to the same file in the same turn.
- Diff previews no longer hold the file text they replaced.
- Sessions that are no longer live release their state, and the sidebar list
  stops going stale.
- The model catalog is re-read when a credential is committed.

### Security

- Credential-shaped text is redacted wherever DSH text is logged or shown.
- An unauthenticated runtime on the shared loopback port is never adopted.
- The homes used to probe a runtime stay out of the published extension.
