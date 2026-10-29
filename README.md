# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> **This is a personal fork of [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode)** (MIT License),
> maintained independently and pinned to a newer DeepSeek Harness release than the upstream build.
> Original work © Lixxx1. Not affiliated with DeepSeek or with the upstream project.
>
> Fork: https://github.com/fallleaves01/dsh-vscode

DSH Sidebar integrates the official DeepSeek Harness runtime with VS Code. It provides project-aware conversations, independent subagent details, explicit file references, and native change review.

*This fork is maintained with DeepSeek Flash as the coding agent.*

The current source version is **0.2.2-alpha.2**. See [CHANGELOG.md](CHANGELOG.md) for version changes. The original extension was created by [Lixxx1](https://github.com/Lixxx1).

**English** | [简体中文](README.zh.md)

[GitHub](https://github.com/fallleaves01/dsh-vscode)

[![CI](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/sidebar-0.2.0.png" alt="DSH Sidebar in the VS Code sidebar: a fixed conversation, an Auto review rejection, a subagent and changed files" width="900">
</p>

## ✨ Features

- **Conversations and history.** Stream responses, inspect tool calls, answer approvals and questions, and load earlier messages through the official DSH runtime.
- **Failed response recovery and retries.** Keep received output when a request fails, show its error code and a readable reason in chat and subagent details, and restore saved failed attempts when reopening history. Retried attempts collapse into one expandable row ("Retrying model request (1/3) · 1s", "Retried model request", "Model request retry cancelled") with retry delay and failure reason; a turn stopped by the output token limit shows DSH's cut-off notice. Retries remain separate; output that could not be saved is marked as available only in the current view.
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
- **Native debugging and keyboard access.** Enable autonomous debugging for `.vscode/launch.json`, including breakpoints, stepping, stack frames, and variables. `Cmd/Ctrl+Alt+D` opens chat, `Cmd/Ctrl+Alt+E` opens it in an editor tab, `Cmd/Ctrl+Alt+L` adds the selection, and `Cmd/Ctrl+Alt+F` requests a file fix. Chat and task details support dark, light, and high-contrast themes.

## 🧭 Reliability and diagnostics

State delivery from the runtime to the sidebar is bounded. At most one view
state is in flight; newer states collapse into the newest one, and a delivery
that has not settled after 2 s is abandoned, followed by a full snapshot. If no
newer state follows, the Host retries one full snapshot 1.5 s later, throttled
to one retry per 10 s. The Webview also asks for a snapshot after 5 s without
state in a live phase — opening, running, stopping or cancel requested — and a
startup probe covers the case where the first state itself stalls. The two
paths cover each other, so either side's stalled channel can recover the view.
Three consecutive stalled deliveries show a reload-window warning, because a
channel that keeps stalling cannot be recovered from inside the view; run
**Developer: Reload Window** if the view stays frozen after that warning.

Selecting a conversation acknowledges the click immediately with a
"Switching to …" header while the snapshot is pending, and shows a retry hint
after 10 s. A rendering failure is reported to Output and triggers a
resynchronization instead of leaving a partially rendered view.

These diagnostics are written to the local **DeepSeek Harness** Output channel
(**Show Output**): one line per conversation selection with phase and running
state, opening/opened timings, slow deliveries, stalls and resynchronization
requests. They contain conversation identifiers, phases and timings; failure
lines also include the runtime's error text. Credentials are redacted by the
existing DSH error wrapper, but review the panel before sharing it. The
extension itself has no telemetry. See [Privacy and verification](#privacy-and-verification).

Startup and switching are also bounded. The CLI version is cached per
executable, the event-stream baselines and the first conversation list start
together, and a re-resolved view or Open in Editor reuses the active
connection. Switching reuses runtime-wide account, translation and schedule
facts and per-conversation ratings instead of re-reading them; a hidden
conversation directory is not rendered, and an unrelated state patch does not
repaint the transcript.

## 📦 Install

Install the official DeepSeek Harness CLI:

```sh
npm install -g @deepseek-ai/dsh
```

Install DSH on the host where the extension runs. For Remote SSH, this is the remote host. DeepSeek Harness `0.1.2-rc.1` or newer is required. History search and Schedule need `0.2.0-rc.2` or newer; the experimental bundles are verified against `0.2.2-alpha.2`, while `0.2.1-rc.2` and `0.2.1-rc.3` remain supported. The alpha CLI itself requires Node.js 24.9 or newer.

### Published release

Download the desired `.vsix` asset from [GitHub Releases](https://github.com/fallleaves01/dsh-vscode/releases). In VS Code, run **Extensions: Install from VSIX...** and select that file. The extension ID for this fork is `fallleaves01.dsh-sidebar`.

Published assets can lag behind `main`. Build the source below if the required version is not yet attached to a release. The Marketplace listing linked by the upstream project uses its own publisher and release schedule.

### Latest development build

Build the current source using the pnpm version specified in `package.json`:

```sh
git clone https://github.com/fallleaves01/dsh-vscode.git
cd dsh-vscode
pnpm install --frozen-lockfile
pnpm run package
```

Run **Extensions: Install from VSIX...** and select the generated `dsh-vscode.vsix`. To update a source build, pull the changes and rebuild. Check the installed version in the Extensions view.

Requires VS Code 1.100 or newer and Node.js `^22.19.0` or `>=24.0.0`.

Installing community runtime plugins also requires `pnpm` on your PATH.

For a full local check run `pnpm run check`; `./build.sh` writes
`artifacts/dsh-sidebar-<version>.vsix`. Other settings include
`reuseExistingRuntime`, `rememberExternalRuntime`, `executable`, `arguments`,
`startupTimeout` and `searchBaseUrl`.

### Upgrading to 0.2.2-alpha.2

0.2.2-alpha.2 tracks DeepSeek Harness `0.2.2-alpha.2`, adds its compatibility
and reduces startup and conversation-switch latency. 0.2.1 added DSH's conversation actions and
fixed the fork boundary; 0.2.0 was the client-side reliability release for Stop
and conversation switching. Reload the VS Code window after updating; a shared
managed runtime does not need to be restarted. It requires no DSH upgrade: the
sidebar probes capabilities at runtime, so `0.2.1-rc.2`, `0.2.1-rc.3` and
`0.2.2-alpha.2` runtimes all work, and experimental bundles appear only when the
runtime serves their contracts.

## 🚀 Use

1. Open a trusted project folder in VS Code.
2. Select **DeepSeek** in the right sidebar. If it is hidden, find it under **Other Views**.
3. Configure `DEEPSEEK_API_KEY` with the key button, or run **DeepSeek Harness: Sign In to DeepSeek Account**.
4. Select New conversation to open the full chat composer. Select Model and Reasoning Effort, add explicit file references, and send a prompt. The conversation-settings menu controls Permission and agent composition; `/plan` enters Plan mode, and `/` opens official DSH commands.
5. Use Tasks to open subagent details, and the change summary to review edits. Return to the directory to search, rename, archive, or restore conversations.
6. Use the settings gear or **DeepSeek Harness: Open Settings** for runtime configuration. The plugins button manages runtime plugins and also links to the settings page.

### Optional task services

Run **DeepSeek Harness: Configure Task Services** to access the extension's `enableHistorySearch` and `enableSchedule` settings. They enable message-body search and Schedule in a standard managed DSH Web runtime. Restart that runtime to apply the change. Custom and external runtimes must expose the corresponding services in their own profile.

### Shared runtime across windows

With `reuseAcrossWindows` enabled, windows on the same host and OS account share
one DSH process for the same `DSH_HOME` and compatible launch settings, including
history search and Schedule. VS Code profiles may differ. The first window can
close while the others continue; the last normal exit stops DSH. A small helper
process owns and drains DSH output. It does not modify the DSH installation or
its user configuration, write output logs, or automatically restart DSH.

The toolbar shows **Shared** when this window has connected to an existing managed
instance; hover to see its PID. **DSH** identifies an instance started by this
window, and **External** identifies an explicitly attached runtime. Click this
control to reconnect this window. If no connection is established, **Connect** or
**Retry Connection** checks the saved runtime before starting a new one. Loading
shows the current connection, event-stream or history stage, with **Show Output**
available throughout. Logs include elapsed connection times without credentials.
Disabling `autoStart` leaves the view idle with a Connect action.

On **Linux Remote–SSH**, each window's lease and startup/shutdown operation are
bound to its verified VS Code Server process identity. An extension host left
behind by a dead server cannot keep DSH alive. Other windows with valid owners
continue to use the same instance. Server inspection reads at most eight direct
ancestors from `/proc`; it does not scan the server's files or process table.

An unexpected SSH disconnection leaves tasks running while the remote extension
host remains alive. Configure the native grace period in **local User Settings**:

```json
{
  "remote.SSH.reconnectionGraceTime": 43200
}
```

The value is in seconds; this example is 12 hours. The Remote–SSH setting currently
supports Linux remotes and requires restarting the remote VS Code Server to take
effect. The extension neither changes this setting nor restarts the server.
Normal window closure can terminate the extension host immediately; the setting
is a reconnection grace period, not a keep-running-after-close guarantee.
See [Remote–SSH release notes](https://github.com/microsoft/vscode-docs/blob/main/remote-release-notes/v1_107.md).

After all valid owners exit, the helper checks every five seconds and begins
cleanup after a 30-second grace period. It sends SIGTERM, then SIGKILL after four
seconds if needed, and bounds its wait for inherited output pipes. On POSIX it
also signals DSH's dedicated process group; tools that deliberately detach into
another group are outside this guarantee. A surviving attached window can detect
a killed helper and clean up its identified DSH process. Reopening after shutdown
loads saved history; it cannot resume an interrupted model request or tool call,
or recover events that had not reached the log before forced termination.

These are scheduling-dependent bounds, not real-time guarantees. Simultaneous
SIGKILL of the helper and every extension host leaves no running cleanup code.
On the next managed connection, the extension checks the private registry before
opening a conversation. A compatible runtime with a live helper is reused. If
the helper is confirmed dead and no valid window still uses DSH, a verified
remaining DSH process is stopped before a supervised replacement starts. Multiple
reconnecting windows serialize this recovery and share one replacement. New
helpers also persist DSH's process identity before publishing its connection URL,
so an interrupted startup can be recovered in the same way.

SIGSTOP, kernel-blocked I/O, denied signals, or unreadable identity/lease records
can prevent cleanup. A startup killed before its process identity was recorded
cannot be safely terminated automatically. Uncertain records are retained and a
competing runtime is not started. Use **Restart Runtime** or **End a Leftover
Runtime** for verified recovery; other live users require a reviewed shared
restart. External runtimes are never stopped by these mechanisms.

Launch settings must agree in both windows. Connection failures or incompatible
settings retain the existing instance and report an error. Use **Reconnect** for
one window. **Restart Runtime** can replace the recorded managed runtime with this
window's settings, including after an incompatible-settings failure. If other
windows use it, a confirmation explains that their running conversations, subagents
and scheduled work will be interrupted. Cancellation leaves running work intact.
The process and affected windows are checked again before shutdown; a replacement
starts only after the old process exits. Reload the other windows with matching
settings to connect to the replacement. External runtimes remain attach-only. Native
autonomous debugging requires a dedicated runtime because its bridge belongs to
one VS Code window. Disable autonomous debugging for shared mode.

When upgrading from before 0.1.15, finish active work, update all using windows,
and use **Restart Runtime** to replace the previous helper. Version 0.1.14 changed
the host protocol; 0.1.15 adds startup identity recording. Older helpers do not
gain these protections merely by reconnecting. The 0.1.16 connection UI update can
reuse a compatible 0.1.15 helper after reloading the updated windows.
The private registry is under `~/.dsh-vscode/runtimes/`, partitioned by host and
DSH home; migration retains a known legacy ledger so existing leases stay visible.

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

The sidebar is verified against the official DeepSeek Harness `0.2.2-alpha.2` runtime; `0.2.1-rc.2` and `0.2.1-rc.3` remain supported. Experimental bundles remain opt-in in the runtime profile; the sidebar does not enable them automatically (the Plugins page can switch them when the runtime allows writes), and each feature appears only when the runtime exposes its contract. A runtime without the feature keeps the previous behavior. The alpha release adds Web-first optional bundles (Live Share, Forge, Computer Use and personalized recommendations); they appear in the Plugins list with their platform and installation state, but this sidebar does not implement their Web panels.

The following alpha.2 surfaces are Web-only and are not implemented in this
sidebar: Live Share, Forge, Computer Use and personalized-recommendation panels;
the Statistics tab; creation, file-drag and plugin-recommendation cards. Their
tools use the generic tool card. Action-card proposals (`propose_action`) also
render as generic tool cards without the card buttons. Plugin detail documents,
version lists and bundle updates (`pluginManager/readBundleDetail`,
`listVersions`, `updateBundle`) and market entry details
(`pluginMarket/readEntryDetail`) are not implemented; use the DSH Web plugin
manager. An on-demand bundle that is not installed is not listed here; install it from the DSH plugin manager. Quoted
messages render as Markdown blockquotes; the Web selection-quote control is not
in the sidebar composer. Auto review approval reasons follow the editor
language; an Auto review *failure* (`AUTO_REVIEW_FAILED`) renders as an
ordinary tool failure. Web appearance settings (`ui-theme`, `ui-settings`,
`ui-conversation`, `ui-chat`, including `foldedReplies`, and `locale`) and the
Web default-model/default-permission settings do not apply to VS Code; model
badges are not shown, and PNG/JPEG references that predate the stored byte
length cannot be read on alpha.2. Computer Use also needs macOS and the runtime's
native CUA binary; when that binary is missing the bundle switch reports a
platform/operation failure instead of appearing enabled.

- **Auto review permission preset.** The Permission selector reads `permissionPresets/catalog`, so the experimental `auto` preset appears when the auto-review integration is mounted. It is marked `EXP` and switching to it, from the selector or by typing `/permission auto`, requires an explicit acknowledgement: it runs without a sandbox, asks the same model to review every tool call, can wrongly allow or deny actions, and uses additional tokens. A runtime that does not serve the catalogue keeps the shipped three presets.
 A tool call refused by Auto review renders as "Rejected by Auto review" in the collapsed row and "Tool was not executed. Reason: …" when expanded; a missing reason falls back to "Auto review did not authorize this action".
- **Agent Teams.** When the `agentTeam` Session projection is present, the Tasks panel shows the durable team roster with lifecycle phase and Lead/Teammate role, and the shared task board with status, readiness, blocked-by ids, owner, and write scopes. Member rows open the member conversation, and Team tool cards link to a member once its name resolves against the projection. The task board is read-only: task state is owned by the runtime and written through the Team tools.
 Member rows show the lifecycle phase and, derived from the session list, Running, Inactive, Failed or Provisioning; the projection's `phase` alone only records that the member record exists.
- **Live conversation titles.** The conversation-following title provider updates the existing `title` projection and `session/title` event. The sidebar already refreshes the title bar and conversation list from that projection, so titles change without reloading the list.
- **Experimental settings and bundle management.** The Settings page lists the runtime's optional bundles under Plugins → Experimental bundles, with their enable state, version and description; when this extension owns the runtime, a switch enables or disables one through `pluginManager/setBundleEnabled`. A running task does not block the switch: the runtime owns that decision and answers with `applied` or `restart-required`, which the page reports instead of pretending the change already applies. The switch is refused for an attached external runtime and when the runtime does not allow settings writes; the page asks for confirmation before the change. When the runtime serves the corresponding settings namespaces, the same page renders Reasoning translation (`cot-translation`: provider, target language), Voice input (`speech-to-text`: provider, language) and Plugin market (`plugin-market`: index URLs); a bundle that is not mounted hides its card. With the translation bundle mounted, expanded reasoning is translated in place through `cotTranslation/limits` and `cotTranslation/translate`, showing the translation by default with a View original toggle and a Retry action when the selected service cannot answer. Expanded reasoning is sent to that service, so it may contain private code or conversation details.

Current state of the remaining experimental bundles (full package matrix and evidence in [the alpha.2 adaptation record](docs/DSH-0.2.2-ALPHA2-ADAPTATION.md); the earlier [rc.3 record](docs/DSH-0.2.1-RC3-ADAPTATION.md) remains for comparison):

- **Session search** adds model tools such as `session_search`; they use the generic tool card, while sidebar message search continues to use the standard `session/search` RPC. Do not enable both this bundle and the `enableHistorySearch` task service without checking the runtime profile: the deployment can mount two `session-query-sqlite` rows.
- **Plugin market and voice input** expose their configuration cards as described above, but the rest of the feature UI is not implemented: no market discovery, search or install (`pluginMarket/*`), and no speech capture or transcription (`speech/*`, whose stream methods require the existing stream carrier). Reasoning translation is implemented (see above). These bundles remain opt-in and Web-first; an installed but disabled bundle changes nothing in the sidebar.
- **Persistent terminal, Ralph loops, and the badge skill** need no dedicated sidebar work: their tools and skills use the generic tool card or the existing `skills/list` view. The sidebar does not expose a persistent terminal panel. PTC nested `tool/ptc-dispatch` rows are not rendered separately; the parent tool card shows the result.
- **Git worktrees:** `create_worktree` runs as a generic tool, but the effective `workingDirectory` Session projection is not consumed yet. File-path resolution and change review still use the project root, so the sidebar does not follow a conversation that changes its working directory.
- **Agent Team profile and Inspector profile** are profile-only bundles. Agent Teams is supported through the projection and tools above; the Inspector profile is a Web DevTools surface with no Gateway RPC and is not implemented for VS Code.

### Autonomous debugging

Enable **DeepSeek Harness: Autonomous Debugging** in VS Code Settings and add a debug configuration to `.vscode/launch.json`.

DeepSeek can then start the debugger, set breakpoints, step through execution, inspect runtime values, fix the code, and verify the result directly from the sidebar.

Core conversation and settings interfaces have also passed isolated checks against DeepSeek Harness `0.2.1-rc.2`; previous validation covers `0.2.0-rc.2`, `0.1.7-rc.1` and `0.1.7-rc.2`. Experimental-bundle behavior has since been verified against isolated `0.2.1-rc.3` and `0.2.2-alpha.2` runtimes; see [the alpha.2 adaptation record](docs/DSH-0.2.2-ALPHA2-ADAPTATION.md). Recent releases added external task rows, Search / Fetch settings, custom reasoning mappings and user-message masks; see [the compatibility review](docs/GAP-ANALYSIS.md). Workdir/worktree integration still needs dedicated validation. Optional services depend on the installed runtime version and profile.

## Privacy and verification

Sent user messages hide credentials recognized by the official DSH rules. Each
value can be revealed explicitly. This is a display control: it does not redact
model requests, stored history, assistant/tool output, or an explicit Copy action.
Unrecognized secrets may remain visible.

The reliability diagnostics described above are written only to the local
Output channel and are not uploaded by this extension. The DSH settings page
also offers its own **Upload session logs with official model API requests**
option; that is a separate DSH privacy control, never enabled by this
extension. Treat the Output panel as diagnostic data: failure lines can include
the runtime's error text (for example an absolute path), so review it before
including it in an issue, screenshot, or shared log.

The extension collects no telemetry. Credential redaction covers the forms
recognized by the official DSH rules (API keys, bearer tokens, URL userinfo or
query secrets, cookie and authorization fields); it is not a guarantee that
arbitrary content cannot appear in a runtime error message.

API keys configured with the key button use VS Code SecretStorage. Remembered runtime launch URLs are stored locally with owner-only permissions and are not synchronized. File references are explicit; adding a file gives DSH access to that context, and prompts and selected context can be sent to the configured model service.

The [alpha.2 adaptation record](docs/DSH-0.2.2-ALPHA2-ADAPTATION.md), the earlier [rc.3 record](docs/DSH-0.2.1-RC3-ADAPTATION.md) and the [release review](docs/RELEASE-REVIEW-2026-10-15.md) record implementation evidence, privacy checks, test coverage and verification limits. The development-only `braces` dependency retains a version-based security alert; its local depth-limit patch covers the reported recursion failure and the dependency is excluded from the VSIX.

💬 Found a rough edge or have an idea for what should come next? [Open an issue](https://github.com/fallleaves01/dsh-vscode/issues).

## License

[MIT](LICENSE)

The DeepSeek mark in `media/deepseek.svg` and the animated tail in
`media/deepseek-tail.png` come from
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT), adapted to the VS Code theme colours.
