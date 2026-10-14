# Changelog

Notable changes to DSH Sidebar, newest first. Entries before 0.1.0 predate this
file; `git log` is the record for those.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [SemVer](https://semver.org/). The sidebar is distributed as a
VSIX — see the README for installing one.

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
