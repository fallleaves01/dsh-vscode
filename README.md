# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> **This is a personal fork of [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode)** (MIT License),
> maintained independently and pinned to a newer DeepSeek Harness release than the upstream build.
> Original work © Lixxx1. Not affiliated with DeepSeek or with the upstream project.
>
> Fork: https://github.com/fallleaves01/dsh-vscode

Bring DeepSeek Harness into the same place you write code. dsh-vscode gives DSH a Claude Code/Codex-style right sidebar that already understands your project, active file, and selected code.

Ask DeepSeek to inspect, change, and verify code without switching between your editor, terminal, and a separate chat window.

👋 Originally built by [Lixxx1](https://github.com/Lixxx1), who wanted DSH right beside the editor. This fork continues that work against a newer DSH runtime.

**English** | [简体中文](README.zh.md) | [日本語](README.ja.md)

[GitHub](https://github.com/fallleaves01/dsh-vscode)

[![CI](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/demo.gif" alt="DeepSeek Harness in the VS Code sidebar">
</p>

## ✨ Features

- **Autonomous VS Code debugging.** Let DeepSeek launch the current project from `.vscode/launch.json`, manage breakpoints, step through execution, and inspect stack frames and local variables using VS Code's native debugger.
- **Official DSH inside VS Code.** Sessions, streaming responses, tool calls, approvals, and follow-up questions run through the official DSH runtime.
- **Project-aware editor context.** The active file, selected code, and `@file` or `@folder` references travel with your prompt.
- **Session controls where you need them.** Switch Permission and Plan modes, choose Model and Reasoning Effort, or steer an active task.
- **Native review and safe revert.** Review changes in VS Code's Diff Editor, Keep or Revert edits, and stop DSH before it overwrites a file with unsaved changes.
- **Sign in with your DeepSeek account.** Start browser sign-in from the sidebar, see your profile and balance, and sign out again — no API key needed. Works on a remote host too, by forwarding the runtime's port.
- **Drag anything in.** Drop a file from the Explorer to reference it, an image to attach it, or any other file to upload it. Subagent sessions appear nested under the conversation that spawned them.
- **Keyboard-first.** `Cmd/Ctrl+Alt+D` opens the sidebar, `Cmd/Ctrl+Alt+L` adds the selection, `Cmd/Ctrl+Alt+F` fixes the file you are in.
- **Extend DSH from the sidebar.** Discover and manage Tools, Skills, MCP integrations, Memory, and Agent Hooks loaded by DSH.

## 📦 Install

Install the official DeepSeek Harness CLI:

```sh
npm install -g @deepseek-ai/dsh
```

Then choose the extension channel that fits you:

### Published release

Open **Extensions** in VS Code, search for **DSH Sidebar**, and select **Install**. (The Marketplace listing is the upstream one; this fork is installed from a VSIX.)

### Latest development build

To try features already available on `main` but not yet published, build and install the latest VSIX:

```sh
git clone https://github.com/fallleaves01/dsh-vscode.git
cd dsh-vscode
pnpm install --frozen-lockfile
pnpm run package
```

In VS Code, run **Extensions: Install from VSIX...** from the Command Palette and select `dsh-vscode.vsix`. Development builds move faster and may be less stable; pull the latest changes and rebuild the VSIX to update. The Extensions view shows the version you have installed, and `CHANGELOG.md` records what each release changed.

Requires VS Code 1.100 or newer and Node.js `^22.19` or `>=24`.

Installing community runtime plugins also requires `pnpm` on your PATH.

## 🚀 Use

1. Open a trusted project folder in VS Code.
2. Select **DeepSeek** in the right sidebar. If it is hidden, find it under **Other Views**.
3. Use the key button to configure `DEEPSEEK_API_KEY`.
4. Choose the Permission mode, Model, and Reasoning Effort, then start working. Use the Shield menu for Permission and Plan modes, `/` for official DSH commands, and `@` to add files or folders.
5. Use the plugins button in the sidebar title to search, install, inspect, or remove community runtime plugins.

### Autonomous debugging

Enable **DeepSeek Harness: Autonomous Debugging** in VS Code Settings and add a debug configuration to `.vscode/launch.json`.

DeepSeek can then start the debugger, set breakpoints, step through execution, inspect runtime values, fix the code, and verify the result directly from the sidebar.

Targets DeepSeek Harness `0.2.0-rc.2`, and is wire-compatible with `0.1.7-rc.1` and `0.1.7-rc.2` (upstream v0.0.5 targets `0.1.5-rc.1`).

💬 Found a rough edge or have an idea for what should come next? [Open an issue](https://github.com/fallleaves01/dsh-vscode/issues).

## License

[MIT](LICENSE)

The DeepSeek mark in `media/deepseek.svg` and the animated tail in
`media/deepseek-tail.png` come from
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT), adapted to the VS Code theme colours.
