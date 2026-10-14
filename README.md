# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> **This is a personal fork of [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode)** (MIT License),
> maintained independently and pinned to a newer DeepSeek Harness release than the upstream build.
> Original work © Lixxx1. Not affiliated with DeepSeek or with the upstream project.
>
> Fork: https://github.com/fallleaves01/dsh-vscode

DSH Sidebar integrates the official DeepSeek Harness runtime with VS Code. It provides project-aware conversations, independent subagent details, explicit file references, and native change review.

The current source version is **0.1.6**. See [CHANGELOG.md](CHANGELOG.md) for version changes. The original extension was created by [Lixxx1](https://github.com/Lixxx1).

**English** | [简体中文](README.zh.md) | [日本語](README.ja.md)

[GitHub](https://github.com/fallleaves01/dsh-vscode)

[![CI](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/demo.gif" alt="DeepSeek Harness in the VS Code sidebar">
</p>

## ✨ Features

- **Conversations and history.** Stream responses, inspect tool calls, answer approvals and questions, and load earlier messages through the official DSH runtime.
- **Conversation directory.** Use the directory for recent and archived conversation lists, search, rename, archive with Undo, and restore. New conversation opens the full chat composer with model, reasoning effort, agent composition, and permission controls. The top picker switches main conversations; subagents remain in the owning conversation's Tasks panel.
- **Independent subagent details.** Open a child task beside the main chat to inspect live state, its transcript, tool output, duration, and token usage. Answer approvals and questions, stop a task, or send Queue/Steer messages when the parent agent permits continuation. One-shot children have a read-only composer.
- **Background tasks and task services.** Inspect bounded process output, Goal status and round limits, Schedule reminders and delivery history, and Workflow phases and job logs when the runtime exposes these services. Search conversation message bodies when history search is enabled.
- **Explicit file context.** Use `+` to search and add files or folders, remove each reference with `×`, or use typed `@` references and **Add Selection to Chat**. The current editor and selected lines are optional suggestions. Drop resources or paste images to attach them.
- **Conversation controls and queues.** Select agent composition, Permission and Plan modes, Model, and Reasoning Effort. Queue follow-up messages, steer an active task, and inspect or remove held slash commands.
- **Compact change review.** Expand the file-count and line-count summary, or open Review in VS Code's Diff Editor. Keep/Revert actions retain per-turn snapshots and are bound to their originating conversation and project; confirmation rechecks the target before a revert.
- **DeepSeek authentication.** Configure an API key or use browser account sign-in, inspect account state and balance, and sign out. Remote sign-in uses VS Code port forwarding.
- **Runtime plugins and configuration.** Discover and manage Tools, Skills, MCP integrations, Memory, and Agent Hooks. The plugin manager also provides a runtime-settings picker for the namespaces exposed by DSH.
- **Runtime recovery.** Reuse a managed runtime across VS Code windows, reconnect, diagnose conversation ownership, and end a verified leftover managed runtime. Saved external runtimes are attach-only.
- **Native debugging and keyboard access.** Enable autonomous debugging for `.vscode/launch.json`, including breakpoints, stepping, stack frames, and variables. `Cmd/Ctrl+Alt+D` opens chat, `Cmd/Ctrl+Alt+L` adds the selection, and `Cmd/Ctrl+Alt+F` requests a file fix. Chat and task details support dark, light, and high-contrast themes.

## 📦 Install

Install the official DeepSeek Harness CLI:

```sh
npm install -g @deepseek-ai/dsh
```

Install DSH on the host where the extension runs. For Remote SSH, this is the remote host.

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

## 🚀 Use

1. Open a trusted project folder in VS Code.
2. Select **DeepSeek** in the right sidebar. If it is hidden, find it under **Other Views**.
3. Configure `DEEPSEEK_API_KEY` with the key button, or run **DeepSeek Harness: Sign In to DeepSeek Account**.
4. Select New conversation to open the full chat composer. Select Model and Reasoning Effort, add explicit file references, and send a prompt. The conversation-settings menu controls Permission and agent composition; `/plan` enters Plan mode, and `/` opens official DSH commands.
5. Use Tasks to open subagent details, and the change summary to review edits. Return to the directory to search, rename, archive, or restore conversations.
6. Use the plugins button to manage runtime plugins or open the existing runtime-settings picker.

### Optional task services

Run **DeepSeek Harness: Configure Task Services** to access the extension's `enableHistorySearch` and `enableSchedule` settings. They enable message-body search and Schedule in a standard managed DSH Web runtime. Restart that runtime to apply the change. Custom and external runtimes must expose the corresponding services in their own profile.

### Autonomous debugging

Enable **DeepSeek Harness: Autonomous Debugging** in VS Code Settings and add a debug configuration to `.vscode/launch.json`.

DeepSeek can then start the debugger, set breakpoints, step through execution, inspect runtime values, fix the code, and verify the result directly from the sidebar.

Validated against DeepSeek Harness `0.2.0-rc.2`; core protocol compatibility also covers `0.1.7-rc.1` and `0.1.7-rc.2`. Optional services depend on the installed runtime version and profile.

## Privacy and verification

API keys configured with the key button use VS Code SecretStorage. Remembered runtime launch URLs are stored locally with owner-only permissions and are not synchronized. File references are explicit; adding a file gives DSH access to that context, and prompts and selected context can be sent to the configured model service.

The [0.1.5 review](docs/RELEASE-REVIEW-2026-10-15.md) records bug fixes, privacy checks, test coverage, and verification limits. The development-only `braces` dependency retains a version-based security alert; its local depth-limit patch covers the reported recursion failure and is excluded from the VSIX with the dependency.

💬 Found a rough edge or have an idea for what should come next? [Open an issue](https://github.com/fallleaves01/dsh-vscode/issues).

## License

[MIT](LICENSE)

The DeepSeek mark in `media/deepseek.svg` and the animated tail in
`media/deepseek-tail.png` come from
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT), adapted to the VS Code theme colours.
