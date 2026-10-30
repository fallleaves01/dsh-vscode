# DSH Sidebar 🐋

> **This is a personal fork of [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode)** (MIT License), maintained
> independently and pinned to a newer DeepSeek Harness release than the upstream build.
> Original work © Lixxx1. This fork is not affiliated with DeepSeek or with the upstream project.
>
> Fork: https://github.com/fallleaves01/dsh-vscode

DSH Sidebar integrates the official DeepSeek Harness runtime with VS Code. It provides project-aware conversations, independent subagent details, explicit file references, and native change review. This source version is **0.2.2-alpha.2**.

*This fork is maintained with DeepSeek Flash as the coding agent.*

<p align="center">
  <img src="media/sidebar-0.2.0.png" alt="DSH Sidebar in the VS Code sidebar: a fixed conversation, an Auto review rejection, a subagent and changed files" width="900">
</p>

## ✨ What you can do

- **Conversations and history.** Stream responses, inspect tool calls, answer approvals and questions, and load earlier messages through the official DSH runtime.
- **Failed response recovery and retries.** Keep received output when a request fails, show its error code and a readable reason in chat and subagent details, and restore saved failed attempts when reopening history. Retried attempts collapse into one expandable row with retry delay and failure reason; a turn stopped by the output token limit shows DSH's cut-off notice. Retries remain separate; output that could not be saved is marked as available only in the current view.
- **Conversation directory.** Use the directory for recent and archived conversation lists, search, rename, archive with Undo, and restore. New conversation opens the full chat composer with model, reasoning effort, agent composition, and permission controls. The top picker switches main conversations; subagents remain in the owning conversation's Tasks panel.
- **Conversation actions.** Pin or unpin, rename, fork, archive or restore, and copy the session ID from the conversation menu. Branching a completed turn forks at that turn's own boundary, so later stopped or failed work is not copied.
- **Independent subagent details.** Click a subagent name in its tool card to enter the child conversation, or use the trailing arrow to open independent details. Inspect live state, its transcript, tool output, duration, and token usage. Answer approvals and questions, stop a task, or send Queue/Steer messages when the parent agent permits continuation. One-shot children have a read-only composer. External executions appear as informational rows without a local transcript.
- **Background tasks and task services.** Inspect bounded process output, Goal status and round limits, Schedule reminders and delivery history, and Workflow phases and job logs when the runtime exposes these services. Search conversation message bodies when history search is enabled.
- **Explicit file context.** Use `+` to search and add files or folders, remove each reference with `×`, or use typed `@` references and **Add Selection to Chat**. The current editor and selected lines are optional suggestions. Drop resources or paste images to attach them.
- **Conversation controls and queues.** Select agent composition, Permission and Plan modes, Model, and Reasoning Effort. Queue follow-up messages, steer an active task, and inspect or remove held slash commands.
- **Compact change review.** Expand the file-count and line-count summary, or open Review in VS Code's Diff Editor. Keep/Revert actions retain per-turn snapshots and are bound to their originating conversation and project; confirmation rechecks the target before a revert.
- **DeepSeek authentication.** Configure an API key or use browser account sign-in, inspect account state and balance, and sign out. Remote sign-in uses VS Code port forwarding.
- **Runtime plugins and configuration.** Discover and manage Tools, Skills, MCP integrations, Memory, and Agent Hooks. Open the settings gear for Models, Shell, Agent loop, Subagents, Web search and General settings. Add providers, edit model catalogs and manage write-only credentials through DSH.
- **Runtime recovery.** Reuse a managed runtime across VS Code windows, reconnect, diagnose conversation ownership, and end a verified leftover managed runtime. Saved external runtimes are attach-only.
- **Native debugging and keyboard access.** Enable autonomous debugging for `.vscode/launch.json`, including breakpoints, stepping, stack frames, and variables. `Cmd/Ctrl+Alt+D` opens chat, `Cmd/Ctrl+Alt+L` adds the selection, and `Cmd/Ctrl+Alt+F` requests a file fix. Chat and task details support dark, light, and high-contrast themes.

## 📦 Before you start

DSH Sidebar runs the official DeepSeek Harness CLI on your machine. Install it first:

```sh
npm install -g @deepseek-ai/dsh
```

Install DSH on the extension host; for Remote SSH, install it on the remote host. You need VS Code 1.100 or newer and Node.js `^22.19.0` or `>=24.0.0`. DeepSeek Harness `0.1.2-rc.1` or newer is required; history search and Schedule need `0.2.0-rc.2` or newer, and the experimental bundles are verified against `0.2.2-alpha.2` (`0.2.1-rc.2` and `0.2.1-rc.3` remain supported). The alpha CLI requires Node.js 24.9 or newer.

Download this fork's `.vsix` from [GitHub Releases](https://github.com/fallleaves01/dsh-vscode/releases) and run **Extensions: Install from VSIX...**. Its extension ID is `fallleaves01.dsh-sidebar`. The latest release is **0.2.0**. Release assets can lag behind the source version; build from the repository with `pnpm install --frozen-lockfile && pnpm run package` when the desired version is not yet available.

## 🚀 Get started

1. Open a trusted project folder in VS Code.
2. Select **DeepSeek** in the right sidebar. If it is hidden, find it under **Other Views**.
3. Configure `DEEPSEEK_API_KEY` with the key button, or run **DeepSeek Harness: Sign In to DeepSeek Account**.
4. Select New conversation to open the full chat composer, choose Model and Reasoning Effort, add explicit file references, and send.
5. Use Tasks for child details and the compact change summary for native diff review. Return to the directory to manage conversations.

Use the conversation-settings menu for Permission and agent composition, `/plan` to enter Plan mode, `/` for official DSH commands, `@` for files and folders, and the plugins button to manage runtime extensions.

Run **DeepSeek Harness: Configure Task Services** to enable history search and Schedule in a standard managed Web runtime. Restart that runtime to apply these options. Custom and external profiles must provide the corresponding services themselves.

### Background tasks

The toolbar **Background jobs** menu mirrors the DSH Web jobs surface for the runtime's `session/jobs` rows. Choose **Project** to aggregate jobs known across project conversations, or **This chat**. Running jobs come first; **Finished** jobs are count-labelled, collapsible and can be hidden locally with **Clear** (no runtime mutation). Rows show live `progress` when available, otherwise status detail, plus elapsed duration; only live jobs or settled jobs with retained output expose the output chevron.

Expanding a row observes it with `job/follow` while open; collapsing, closing the menu, changing scope or disconnecting releases the observation. The inline panel is a bounded tail with stdout/stderr/log channels, dropped/interrupted-output notices, and **Copy command** (the command line, not the possibly truncated output). Known jobs from other project conversations can be observed from **Project**; unknown jobs report that the task is no longer available.

**Stop** is the DSH two-press interaction: the first press arms for three seconds, the second enters a disabled **Stopping…** state until the `job/list` roster converges. A rejected stop shows **Stop failed** with the reason inline for four seconds; a row that is no longer running clears the phase. Escape closes the menu and returns focus to the trigger; concurrent kill requests are deduplicated.

### Shared runtime across windows

Windows on the same host, OS account and DSH home share one managed DSH process
when their launch settings agree, including history search and Schedule. The first
window can close while others continue; the last normal exit stops DSH. A runtime
host cleans up after all extension hosts crash, with a 30-second grace period and
checks every five seconds. It never restarts DSH automatically or stores output logs.
The toolbar shows **Shared** for an existing managed instance, with its PID in the
tooltip and a reconnect action. Loading distinguishes runtime connection, event
streams and history, and offers **Show Output**. With `autoStart` disabled, use
**Connect**; **Retry Connection** can rediscover a saved runtime after a failed
handshake without restarting a healthy process.
On Linux Remote–SSH, leases and operations also track the owning VS Code Server:
an extension host left behind by a dead server cannot retain DSH. Unexpected SSH
disconnections follow the native `remote.SSH.reconnectionGraceTime` (seconds,
local User Settings; restart the remote Server to apply). Normal window closure
may stop the extension host immediately. The helper force-terminates an unresponsive
DSH after four seconds and bounds waits for inherited output pipes. Surviving
attached windows can recover a killed helper. No DSH installation/configuration
changes are needed. If the helper and every extension host are killed, the next
managed connection checks for leftovers before opening a conversation. It reuses
a supervised compatible instance, or verifies and stops an orphan with no live
users before starting one replacement. Concurrent windows serialize recovery;
saved history can be reopened, but interrupted work cannot resume in place.
New helpers also record startup identity before URL publication. Missing identity,
kernel-blocked I/O, or denied signals can prevent cleanup; uncertain records are
retained without starting a competing process. See the
[lifecycle details](https://github.com/fallleaves01/dsh-vscode#shared-runtime-across-windows).
Connection failures and incompatible settings report errors without a second
writer. Use Reconnect for one window. Restart Runtime can replace an incompatible
recorded managed instance with the requesting window's settings. When other windows
use it, confirmation explains that running conversations, subagents and scheduled
work will be interrupted. Cancellation preserves running work. The process and
affected windows are rechecked; the old process must exit before a replacement
starts. External runtimes remain attach-only.
Disable autonomous debugging for shared mode. Upgrades from before 0.1.15 require
replacing the helper after active work finishes. Version 0.1.16 can reuse a compatible
0.1.15 helper after the updated windows reload; this UI update requires no DSH restart.

### Reliability and diagnostics

State delivery from the runtime to the sidebar is bounded. At most one view
state is in flight; newer states collapse into the newest, and a delivery that
has not settled after 2 s is abandoned and replaced by a full snapshot. If no
newer state follows, one full snapshot is retried 1.5 s later (at most once per
10 s). The Webview also asks for a snapshot after 5 s without state in a live
phase, including loading and stopping, and a startup probe covers a stalled
first state. Three consecutive stalls show a reload-window warning; a channel
that keeps stalling cannot be recovered from inside the view.

Selecting a conversation acknowledges the click immediately with a
"Switching to …" header and offers a retry after 10 s. A rendering failure is
reported to Output and triggers a resynchronization.

Diagnostics go to the local **DeepSeek Harness** Output channel only: a line
per conversation selection with phase and running state, opening/opened timings,
slow deliveries, stalls and resyncs. They contain conversation ids, phases and
timings plus the runtime's error text on failure lines; credential-shaped text
is redacted, but review the panel before sharing it. The extension has no
telemetry. See [Privacy and verification](https://github.com/fallleaves01/dsh-vscode#privacy-and-verification).

Startup and switching are also bounded: the CLI version is cached, the event
streams and first conversation list start together, a re-resolved view reuses
the active connection, and switches reuse runtime-wide facts and per-
conversation ratings. A hidden conversation directory is not rendered, and an
unrelated state patch does not repaint the transcript.

### DSH settings

The chat gear opens settings inside the conversation as a modal, with the official
DSH navigation icons, section layout, provider cards, and a narrow-sidebar icon rail.
The command **DeepSeek Harness: Open Settings** offers the same page in an editor tab.
The page follows the official DSH settings cards: account status and session-log
upload, provider endpoints and model catalogs, Shell timeout/output limits,
parallel tool calls, subagent limits and allowed model routes, and web search.
Search supports the official Messages API or the paired Search / Fetch APIs,
with separate endpoints, limits, and write-only credentials. Custom Pi provider
models offer a reasoning-level/API-value table when the runtime schema supports it.
Appearance and keyboard shortcuts use VS Code's native settings.

Provider changes are staged until Save. Model lookup returns selectable
candidates without storing them. Per-field Reset restores inherited values;
conflicts retain drafts, and a changed runtime clears drafts before accepting
new writes. External attach-only runtimes remain available for inspection.

Provider keys entered on this page use DSH's credential service, whose default
local store is `$DSH_HOME/.credentials.yaml` with owner-only permissions on POSIX.
This is separate from the provider profile and from the extension's existing
SecretStorage key. It is not an encrypted vault or an isolation boundary against
tools running as the same OS user. Stored key values are never read back into the
page, and this repository and its VSIX exclude the credential file and backups.

### DSH 0.2.2-alpha.2 experimental features

The sidebar is verified against DeepSeek Harness `0.2.2-alpha.2`; `0.2.1-rc.2`
and `0.2.1-rc.3` remain supported. Experimental bundles remain opt-in in the
runtime profile; the sidebar does not enable them automatically (the Plugins page can switch
them when the runtime allows writes), and each feature appears only when the
runtime exposes its contract. The alpha release
adds Web-first optional bundles (Live Share, Forge, Computer Use and
personalized recommendations); they appear in the Plugins list with their
platform and installation state, but this sidebar does not implement their Web
panels.

The following alpha.2 surfaces are Web-only and are not implemented in this
sidebar: Live Share, Forge, Computer Use and personalized-recommendation panels;
the Statistics tab; creation, file-drag and plugin-recommendation cards. Their
tools use the generic tool card. Action-card proposals (`propose_action`) render
as generic tool cards without the card buttons. Plugin detail documents, version
lists and bundle updates (`pluginManager/readBundleDetail`, `listVersions`,
`updateBundle`) and market entry details (`pluginMarket/readEntryDetail`) are
not implemented; use the DSH Web plugin manager. An on-demand bundle that is not
installed is not listed here; install it from the DSH plugin manager. Quoted messages render as Markdown blockquotes;
the Web selection-quote control is not in the sidebar composer. Auto review
approval reasons follow the editor language; an Auto review *failure*
(`AUTO_REVIEW_FAILED`) renders as an ordinary tool failure. Web appearance
settings (`ui-*`, `locale`, including `foldedReplies`) and Web
default-model/default-permission settings do not apply to VS Code. Model badges
are not shown, and PNG/JPEG references without a stored byte length cannot be
read on alpha.2. PTC nested `tool/ptc-dispatch` rows are not rendered
separately; the parent tool card shows the result. Computer Use also needs macOS and the runtime's native CUA
binary; without it the bundle switch reports a platform/operation failure.

DSH Web management surfaces not implemented here are Schedule task deletion and
clearing inactive tasks (`schedule/delete`, `schedule/deleteInactive`), stopping
and archiving a running conversation (`workspace/archiveSession` with
`stopActivity`), generic slash-command option risk confirmation, and the Task
Details command bar with full retained-output links. Live Share stop-sharing and
Forge merge confirmations remain Web-only with their panels. Background jobs
themselves are implemented in the **Background jobs** menu above.

- **Auto review permission preset.** When the runtime serves
  `permissionPresets/catalog`, the Permission selector offers an `EXP`-marked
  `auto` preset. Switching to it, from the menu or with `/permission auto`,
  requires explicit confirmation: it runs without a sandbox, has the same model
  review every tool call, can wrongly allow or deny actions, and uses extra
  tokens. A tool call it refuses renders as "Rejected by Auto review" with the
  reason when expanded.
- **Agent Teams.** With the `agentTeam` Session projection, Tasks shows the
  durable roster and shared task board; the board is read-only and owned by the
  runtime. Member rows show their phase and Running/Inactive.
- **Live conversation titles.** Titles refresh from the `title` projection
  without reloading the conversation list.
- **Experimental settings and bundle management.** Settings → Plugins →
  Experimental bundles lists optional runtime bundles and, for a managed
  runtime, switches them through `pluginManager/setBundleEnabled`. A running
  task does not block the switch; the runtime answers `applied` or
  `restart-required`. Reasoning translation is implemented in place through
  `cotTranslation/limits` and `cotTranslation/translate`, with the translation
  shown by default and a View original action; plugin market discovery/search/
  install and speech capture/transcription are not implemented. Worktree
  `workingDirectory` is not consumed yet, and the sidebar exposes no persistent
  terminal panel. Enabling the session-search bundle with `enableHistorySearch`
  can mount two `session-query-sqlite` rows; check the runtime profile. See the
  [alpha.2 adaptation record](https://github.com/fallleaves01/dsh-vscode/blob/main/docs/DSH-0.2.2-ALPHA2-ADAPTATION.md).

### Autonomous debugging

Enable **DeepSeek Harness: Autonomous Debugging** in VS Code Settings and add a debug configuration to `.vscode/launch.json`.

DeepSeek can then start the debugger, set breakpoints, step through execution, inspect runtime values, fix the code, and verify the result directly from the sidebar.

Core conversation and settings interfaces have also passed isolated checks against DeepSeek Harness `0.2.1-rc.2`; previous validation covers `0.2.0-rc.2`, `0.1.7-rc.1` and `0.1.7-rc.2`. Recent releases added external tasks, Search / Fetch settings, custom reasoning mappings and user-message masks. Workdir/worktree integration still needs dedicated validation. Optional services depend on the runtime version and profile.

## Privacy

Sent user messages hide credentials recognized by the official DSH rules. Each
value can be revealed explicitly. This is a display control: it does not redact
model requests, stored history, assistant/tool output, or an explicit Copy action.
Unrecognized secrets may remain visible.

API keys configured with the key button use VS Code SecretStorage. Remembered runtime launch URLs stay in owner-only local storage and are not synchronized. Adding file references gives DSH access to the selected context; prompts and context can be sent to the configured model service.

The reliability diagnostics are written only to the local Output channel and
are not uploaded by this extension. The DSH settings page also offers its own
**Upload session logs with official model API requests** option, a separate DSH
privacy control that this extension never enables. Failure lines can include
runtime error text such as an absolute path; review the panel before sharing it.
The extension collects no telemetry. Credential redaction covers the forms the
official DSH rules recognize; it does not guarantee that arbitrary content
cannot appear in a runtime error message.

## 💬 Feedback

Issues for this fork: [GitHub Issues](https://github.com/fallleaves01/dsh-vscode/issues).
For the original project, see [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode).

[GitHub](https://github.com/fallleaves01/dsh-vscode)

## License

[MIT](https://github.com/fallleaves01/dsh-vscode/blob/main/LICENSE). The DeepSeek
mark in `media/deepseek.svg` and the animated tail in `media/deepseek-tail.png`
come from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT), adapted to the VS Code theme colours.
