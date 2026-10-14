# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> **本项目是 [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode) 的个人 fork**（MIT 协议），独立维护，跟进比上游更新的 DSH 版本。
> 原始代码版权归 Lixxx1 所有。与 DeepSeek 及上游项目无隶属关系。
>
> Fork 仓库：https://github.com/fallleaves01/dsh-vscode

DSH Sidebar 将官方 DeepSeek Harness runtime 集成到 VS Code，提供项目会话、独立子代理详情、显式文件引用和原生差异审阅。

当前源码版本为 **0.1.5**。各版本变更见 [CHANGELOG.md](CHANGELOG.md)。原始扩展由 [Lixxx1](https://github.com/Lixxx1) 创建。

[English](README.md) | **简体中文** | [日本語](README.ja.md)

[GitHub](https://github.com/fallleaves01/dsh-vscode)

[![CI](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/fallleaves01/dsh-vscode/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/demo.gif" alt="VS Code 侧边栏中的 DeepSeek Harness">
</p>

## ✨ 功能

- **会话与历史。** 通过官方 DSH runtime 接收流式回复、检查工具调用、处理审批与问题，并加载较早的消息。
- **完整会话目录。** 可在目录输入区开始任务，搜索最近或已归档会话，执行重命名、归档、撤销归档和恢复。顶部列表用于切换主会话；子代理保留在所属会话的 Tasks 面板。
- **独立子代理详情。** 在主会话旁打开子任务，查看实时状态、完整记录、工具输出、耗时和 token 用量。支持审批、回答问题和停止；父代理允许继续时可发送 Queue 或 Steer 消息，单次执行的子代理输入区为只读。
- **后台任务与任务服务。** 查看有长度限制的进程输出、Goal 状态与轮次上限、Schedule 提醒与投递历史，以及 Workflow 阶段和任务日志。功能取决于 runtime 提供的服务；启用历史搜索后可搜索消息正文。
- **显式文件上下文。** 点击 `+` 搜索并添加文件或目录，用 `×` 逐项移除；也可输入 `@` 引用或执行 **Add Selection to Chat**。当前编辑文件和选区是可选建议。支持拖入资源和粘贴图片附件。
- **会话控制与队列。** 选择代理组合、Permission、Plan、模型和推理强度；排队发送后续消息，向运行中的任务发送 Steer，并检查或删除等待执行的斜杠命令。
- **紧凑的变更审阅。** 默认折叠显示文件数与增删行数；展开查看文件，或通过 Review 打开 VS Code Diff Editor。Keep/Revert 保留逐回合快照，并校验来源会话和项目；确认回退后再次检查目标。
- **DeepSeek 认证。** 配置 API key 或使用浏览器登录，查看账户状态与余额并退出。远程登录通过 VS Code 端口转发完成。
- **runtime 插件与配置。** 查找和管理 Tools、Skills、MCP、Memory 与 Agent Hooks。插件管理器还提供 runtime 设置选择器，用于编辑 DSH 暴露的设置命名空间。
- **runtime 恢复。** 多个 VS Code 窗口复用受管 runtime，支持重连、会话占用诊断，以及停止已验证身份的遗留受管进程。已保存的外部 runtime 仅用于连接。
- **原生调试与键盘操作。** 可对 `.vscode/launch.json` 启用自主调试，管理断点、单步执行、调用栈和变量。`Cmd/Ctrl+Alt+D` 打开会话，`Cmd/Ctrl+Alt+L` 添加选区，`Cmd/Ctrl+Alt+F` 请求修复文件。会话与任务详情支持深色、浅色和高对比度主题。

## 📦 安装

先安装官方 DeepSeek Harness CLI：

```sh
npm install -g @deepseek-ai/dsh
```

DSH 应安装在扩展实际运行的主机上；使用 Remote SSH 时，应安装在远程主机上。

### 发布版

从 [GitHub Releases](https://github.com/fallleaves01/dsh-vscode/releases) 下载所需版本的 `.vsix` 附件，然后在 VS Code 命令面板运行 **Extensions: Install from VSIX...** 并选择该文件。本项目的扩展 ID 为 `fallleaves01.dsh-sidebar`。

发布附件可能晚于 `main`。如所需版本尚未提供附件，请按下方步骤构建源码。上游 Marketplace 扩展使用其自己的发布者和版本计划。

### 最新开发版

使用 `package.json` 指定的 pnpm 版本构建当前源码：

```sh
git clone https://github.com/fallleaves01/dsh-vscode.git
cd dsh-vscode
pnpm install --frozen-lockfile
pnpm run package
```

运行 **Extensions: Install from VSIX...** 并选择生成的 `dsh-vscode.vsix`。更新源码构建时，拉取最新代码并重新构建；已安装版本可在扩展视图中检查。

需要 VS Code 1.100 或更新版本，以及 Node.js `^22.19.0` 或 `>=24.0.0`。

安装社区 runtime 插件还需要确保 `pnpm` 已加入 PATH。

## 🚀 使用

1. 在 VS Code 中打开一个受信任的项目文件夹。
2. 在右侧选择 **DeepSeek**。如果没有显示，可以在 **其他视图** 中找到它。
3. 点击钥匙按钮配置 `DEEPSEEK_API_KEY`，或运行 **DeepSeek Harness: Sign In to DeepSeek Account** 登录。
4. 从会话目录开始任务，选择模型与推理强度，添加文件引用并发送。会话设置菜单控制 Permission、Plan 和代理组合；输入 `/` 使用 DSH 官方命令。
5. 使用 Tasks 打开子代理详情，使用变更摘要检查改动；返回目录搜索、重命名、归档或恢复会话。
6. 使用标题栏插件按钮管理 runtime 插件，或打开现有的 runtime 设置选择器。

### 可选任务服务

运行 **DeepSeek Harness: Configure Task Services**，调整扩展的 `enableHistorySearch` 与 `enableSchedule` 设置。它们在标准受管 DSH Web runtime 中启用消息正文搜索与 Schedule；修改后需重启该 runtime。自定义或外部 runtime 需要在其自己的 profile 中提供相应服务。

### 自主调试

在 VS Code 设置中启用 **DeepSeek Harness: Autonomous Debugging**，并在 `.vscode/launch.json` 中添加调试配置。

之后，DeepSeek 就能直接从侧边栏启动调试器、设置断点、单步执行、检查运行时变量、修复代码并验证结果。

已针对 DeepSeek Harness `0.2.0-rc.2` 验证；核心协议兼容性也覆盖 `0.1.7-rc.1` 与 `0.1.7-rc.2`。可选服务取决于实际安装的 runtime 版本和 profile。

## 隐私与验证

通过钥匙按钮配置的 API key 使用 VS Code SecretStorage 保存。已记住的 runtime 启动 URL 保存在仅所有者可访问的本地文件中，不参与同步。文件引用由用户显式添加；添加文件会让 DSH 获得相应上下文，提示词与所选上下文可能发送到配置的模型服务。

[0.1.5 复核记录](docs/RELEASE-REVIEW-2026-10-15.md) 列出了缺陷修复、隐私检查、测试覆盖与验证限制。开发阶段使用的 `braces` 依赖仍有基于版本的安全告警；本地深度限制补丁覆盖已报告的递归失败，补丁与该依赖均不进入 VSIX。

缺陷报告与功能建议请提交至 [GitHub Issues](https://github.com/fallleaves01/dsh-vscode/issues)。

## License

[MIT](LICENSE)
