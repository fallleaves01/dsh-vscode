# DSH Sidebar 🐋

> [!NOTE]
> **This is a personal fork of [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode)** (MIT License), maintained
> independently and pinned to a newer DeepSeek Harness release than the upstream build.
> Original work © Lixxx1. This fork is not affiliated with DeepSeek or with the upstream project.
>
> Fork: https://github.com/fallleaves01/dsh-vscode

DSH Sidebar integrates the official DeepSeek Harness runtime with VS Code. It provides project-aware conversations, independent subagent details, explicit file references, and native change review. This source version is **0.1.7**.

<p align="center">
  <img src="media/demo.gif" alt="DeepSeek Harness working in the VS Code sidebar">
</p>

## ✨ What you can do

- **Conversations and history.** Stream responses, inspect tool calls, answer approvals and questions, and load earlier messages through the official DSH runtime.
- **Conversation directory.** Use the directory for recent and archived conversation lists, search, rename, archive with Undo, and restore. New conversation opens the full chat composer with model, reasoning effort, agent composition, and permission controls. The top picker switches main conversations; subagents remain in the owning conversation's Tasks panel.
- **Independent subagent details.** Open a child task beside the main chat to inspect live state, its transcript, tool output, duration, and token usage. Answer approvals and questions, stop a task, or send Queue/Steer messages when the parent agent permits continuation. One-shot children have a read-only composer.
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

Install DSH on the extension host; for Remote SSH, install it on the remote host. You need VS Code 1.100 or newer and Node.js `^22.19.0` or `>=24.0.0`.

Download this fork's `.vsix` from [GitHub Releases](https://github.com/fallleaves01/dsh-vscode/releases) and run **Extensions: Install from VSIX...**. Its extension ID is `fallleaves01.dsh-sidebar`. Release assets can lag behind the source version; build from the repository when the desired version is not yet available.

## 🚀 Get started

1. Open a trusted project folder in VS Code.
2. Select **DeepSeek** in the right sidebar. If it is hidden, find it under **Other Views**.
3. Configure `DEEPSEEK_API_KEY` with the key button, or run **DeepSeek Harness: Sign In to DeepSeek Account**.
4. Select New conversation to open the full chat composer, choose Model and Reasoning Effort, add explicit file references, and send.
5. Use Tasks for child details and the compact change summary for native diff review. Return to the directory to manage conversations.

Use the conversation-settings menu for Permission and agent composition, `/plan` to enter Plan mode, `/` for official DSH commands, `@` for files and folders, and the plugins button to manage runtime extensions.

Run **DeepSeek Harness: Configure Task Services** to enable history search and Schedule in a standard managed Web runtime. Restart that runtime to apply these options. Custom and external profiles must provide the corresponding services themselves.

### DSH settings

Open the gear in the chat toolbar, or run **DeepSeek Harness: Open Settings**.
The page follows the official DSH settings cards: account status and session-log
upload, provider endpoints and model catalogs, Shell timeout/output limits,
parallel tool calls, subagent limits and allowed model routes, and web search.
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

### Autonomous debugging

Enable **DeepSeek Harness: Autonomous Debugging** in VS Code Settings and add a debug configuration to `.vscode/launch.json`.

DeepSeek can then start the debugger, set breakpoints, step through execution, inspect runtime values, fix the code, and verify the result directly from the sidebar.

Validated against DeepSeek Harness `0.2.0-rc.2`; core protocol compatibility also covers `0.1.7-rc.1` and `0.1.7-rc.2`. Optional services depend on the runtime version and profile.

## Privacy

API keys configured with the key button use VS Code SecretStorage. Remembered runtime launch URLs stay in owner-only local storage and are not synchronized. Adding file references gives DSH access to the selected context; prompts and context can be sent to the configured model service.

## 💬 Feedback

Issues for this fork: [GitHub Issues](https://github.com/fallleaves01/dsh-vscode/issues).
For the original project, see [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode).

[GitHub](https://github.com/fallleaves01/dsh-vscode)
