# Changelog

Notable changes to DSH Sidebar, newest first. Entries before 0.1.0 predate this
file; `git log` is the record for those.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [SemVer](https://semver.org/). The sidebar is distributed as a
VSIX — see the README for installing one.

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
- The model picker names the provider, which is what routing depends on.
- A setting for the runtime's web search base URL, for hosts that cannot reach
  the public API.
- Default keyboard shortcuts for the sidebar commands.

### Changed

- Adapt to DSH 0.2.0-rc.2; 0.1.7 runtimes stay supported.
- Collaboration modes are controlled by slash commands, as in DSH; permissions
  are the part that gets its own UI.
- A tool's output opens itself while the tool runs and folds again when it
  finishes. A tool you opened or closed yourself keeps that choice.
- The executable, its arguments and the search endpoint are per-machine
  settings, so Settings Sync never carries them to another host.

### Fixed

- Every slash command picked from the command menu did nothing.
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
