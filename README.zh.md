# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> **本项目是 [Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode) 的个人 fork**（MIT 协议），独立维护，跟进比上游更新的 DSH 版本。
> 原始代码版权归 Lixxx1 所有。与 DeepSeek 及上游项目无隶属关系。
>
> Fork 仓库：https://github.com/fallleaves01/dsh-vscode

DSH Sidebar 将官方 DeepSeek Harness runtime 集成到 VS Code，提供项目会话、独立子代理详情、显式文件引用和原生差异审阅。

当前源码版本为 **0.1.16**。各版本变更见 [CHANGELOG.md](CHANGELOG.md)。原始扩展由 [Lixxx1](https://github.com/Lixxx1) 创建。

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
- **失败回复恢复。** 请求失败时保留已接收内容，在聊天页和子代理详情页显示错误码与原因；重新打开历史时恢复已保存的失败尝试。重试分别保留；未能保存的输出明确标注仅在当前视图中可用。
- **完整会话目录。** 目录用于浏览和搜索最近或已归档会话，执行重命名、归档、撤销归档和恢复。点击新建会话进入完整对话页，可选择模型、思考强度、代理组合与权限。顶部列表用于切换主会话；子代理保留在所属会话的 Tasks 面板。
- **独立子代理详情。** 点击工具调用卡片中的子代理名称进入子会话，或点击右侧箭头在主会话旁打开独立详情，查看实时状态、完整记录、工具输出、耗时和 token 用量。支持审批、回答问题和停止；父代理允许继续时可发送 Queue 或 Steer 消息，单次执行的子代理输入区为只读。外部执行按官方方式显示为信息行，没有本地会话记录。
- **后台任务与任务服务。** 查看有长度限制的进程输出、Goal 状态与轮次上限、Schedule 提醒与投递历史，以及 Workflow 阶段和任务日志。功能取决于 runtime 提供的服务；启用历史搜索后可搜索消息正文。
- **显式文件上下文。** 点击 `+` 搜索并添加文件或目录，用 `×` 逐项移除；也可输入 `@` 引用或执行 **Add Selection to Chat**。当前编辑文件和选区是可选建议。支持拖入资源和粘贴图片附件。
- **会话控制与队列。** 选择代理组合、Permission、Plan、模型和推理强度；排队发送后续消息，向运行中的任务发送 Steer，并检查或删除等待执行的斜杠命令。
- **紧凑的变更审阅。** 默认折叠显示文件数与增删行数；展开查看文件，或通过 Review 打开 VS Code Diff Editor。Keep/Revert 保留逐回合快照，并校验来源会话和项目；确认回退后再次检查目标。
- **DeepSeek 认证。** 配置 API key 或使用浏览器登录，查看账户状态与余额并退出。远程登录通过 VS Code 端口转发完成。
- **runtime 插件与配置。** 查找和管理 Tools、Skills、MCP、Memory 与 Agent Hooks。聊天工具栏齿轮打开对话内设置弹窗，包含模型提供商、Shell、Agent 循环、子代理、网页搜索和通用设置。支持模型目录编辑及只写凭据管理。
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
4. 点击新建会话进入完整对话页，选择模型与推理强度，添加文件引用并发送。会话设置菜单控制权限与代理组合；使用 `/plan` 进入计划模式，输入 `/` 打开 DSH 官方命令。
5. 使用 Tasks 打开子代理详情，使用变更摘要检查改动；返回目录搜索、重命名、归档或恢复会话。
6. 点击聊天工具栏齿轮，或运行 **DeepSeek Harness: Open Settings** 调整 runtime 设置。插件管理器也提供该页面入口。

### 可选任务服务

运行 **DeepSeek Harness: Configure Task Services**，调整扩展的 `enableHistorySearch` 与 `enableSchedule` 设置。它们在标准受管 DSH Web runtime 中启用消息正文搜索与 Schedule；修改后需重启该 runtime。自定义或外部 runtime 需要在其自己的 profile 中提供相应服务。

### 多窗口共享运行时

启用 `reuseAcrossWindows` 后，同一主机、同一 OS 账号的窗口，在 `DSH_HOME` 和启动配置
一致时共用一个 DSH 进程，支持不同 VS Code 配置目录，并保留历史搜索和 Schedule。
首次启动窗口退出后，其他窗口可以继续使用；最后一个窗口正常退出时停止 DSH。
保留一个辅助进程负责读取 DSH 输出及异常清理，不修改 DSH 安装文件或用户配置，不写输出日志，也不自动重启 DSH。

顶部显示 **Shared** 表示本窗口已连接既有受管实例，悬停可查看 PID；**DSH** 表示由本窗口
启动，**External** 表示连接外部实例。点击该控件可重新连接当前窗口。尚未建立连接时，
**Connect** 或 **Retry Connection** 会先检查已有实例；没有可用实例时才按正常流程启动。
加载期间分别显示运行时连接、事件订阅和历史读取阶段，始终提供 **Show Output**；输出日志记录
各阶段累计耗时，不包含凭据。关闭 `autoStart` 时显示待连接状态，不再显示 Starting。

在 **Linux Remote–SSH** 下，每个窗口的使用记录和启动／停止操作均关联对应 VS Code Server 的
PID 与启动身份。Server 退出后，即使扩展主机残留，也不再视为有效使用者；其他 Server 下仍有
有效使用者时，实例继续运行。识别过程最多读取 `/proc` 中八级直接祖先进程，不扫描整个进程表或文件系统。

SSH 意外断线时，远程扩展主机在原生重连宽限期内继续执行。可在**本地用户 settings.json** 设置：

```json
{
  "remote.SSH.reconnectionGraceTime": 43200
}
```

单位为秒，上例为 12 小时。该 Remote–SSH 设置目前适用于 Linux 远程主机，修改后需重启
远程 VS Code Server 才生效；插件不会代为修改设置或重启 Server。正常关闭全部窗口可能立即
结束扩展主机，因此此设置不保证正常关闭后仍保留 12 小时。参见
[Remote–SSH 发布说明](https://github.com/microsoft/vscode-docs/blob/main/remote-release-notes/v1_107.md)。

所有有效使用者退出后，辅助进程每 5 秒检查一次，经过 30 秒宽限期开始清理。先发送 SIGTERM，
必要时在 4 秒后发送 SIGKILL，并限制等待后代进程持有输出管道的时间。POSIX 平台同时清理
DSH 专用进程组；主动脱离该进程组的工具不在此保证范围内。辅助进程被强制终止时，仍存活的
已连接窗口也能检测异常并清理身份已确认的 DSH。清理后可重新打开已保存历史，运行中的模型请求
和工具调用不能原地恢复；强制终止时尚未写入日志的事件也无法恢复。

这些时限依赖操作系统调度，不是实时保证。如果辅助进程和全部扩展主机同时被 SIGKILL，
就没有存活代码立即执行清理。下一次连接受管运行时，在打开会话之前先检查私有登记记录：
辅助进程仍正常运行且配置兼容时重连原实例；辅助进程已确认退出、没有其他有效使用窗口时，
核验残留 DSH 的 PID 与启动身份，先清理再启动替代实例。多个窗口同时恢复时串行处理，
共用一个替代实例。新辅助进程在连接地址发布前也记录 DSH 身份，因此启动中断可以按同样流程恢复。

SIGSTOP、内核 I/O 阻塞、信号被拒绝、身份或使用记录不可读，仍可能阻止清理。如果异常发生在
启动身份写入之前，也不能安全自动终止残留进程。无法确认时保留记录，不启动竞争实例；使用
**Restart Runtime** 或 **End a Leftover Runtime** 执行身份核验后的恢复。有其他有效使用窗口时，
需通过共享重启确认中断影响。外部、仅连接的运行时不进入自动停止路径。

两个窗口的启动配置需一致。连接失败或配置不兼容时，保留已有实例并显示错误。
单窗口连接恢复使用 **Reconnect**。**Restart Runtime** 可按当前窗口的配置替换已登记的
受管实例，包括因配置不兼容而启动失败的情况。若其他窗口仍在使用，将先确认重启会中断
该实例中的运行中对话、子代理和定时任务；取消则保留现有连接与工作。停止前再次核验
进程身份和受影响窗口，旧进程退出后才允许启动替代实例。其他窗口需使用一致配置并重新加载，以连接新实例。
外部 runtime 仍仅用于连接。
原生自主调试桥接绑定单个 VS Code 窗口，共享模式需关闭 `autonomousDebugging`。

从早于 0.1.15 的版本升级时，先完成运行中任务，在所有使用窗口更新插件，再执行 **Restart Runtime**
替换旧辅助进程。0.1.14 更新了托管协议，0.1.15 增加启动身份记录；仅重新连接旧实例不能补充这些保护。
0.1.16 的连接界面更新可在重新加载窗口后复用配置兼容的 0.1.15 辅助进程，无需为此重启 DSH。
私有登记目录为 `~/.dsh-vscode/runtimes/`，按主机与 DSH home 分区；已知旧登记目录在迁移时
继续保存原有连接记录，避免遗漏旧窗口的使用者记录。

### DSH 设置页

点击聊天工具栏齿轮可在对话内打开设置弹窗，使用官方图标、左侧导航和卡片尺寸；窄侧栏
切换为图标导航。命令 **DeepSeek Harness: Open Settings** 可在编辑器标签页中打开相同页面。页面按官方
DSH 设置卡片组织：账户状态与会话日志上传、提供商端点与模型目录、Shell 超时和
输出上限、并行工具调用数、子代理限制与可选模型，以及网页搜索。外观和快捷键使用
VS Code 原生设置入口。搜索页可选择 Messages API 或 Search / Fetch API，分别保留端点、
限制参数和只写密钥草稿。自定义 Pi 提供商的模型可按 runtime schema 编辑推理等级与 API 参数值。

提供商修改在点击保存后提交；模型查询只返回候选列表，选择后仍需保存。逐项重置恢复
继承值；冲突时保留草稿，切换 runtime 时清空旧草稿。外部 attach-only runtime 可查看设置。

在设置页录入的提供商密钥通过 DSH 凭据服务保存，默认本地文件为
`$DSH_HOME/.credentials.yaml`，POSIX 权限仅允许所有者访问。该存储独立于提供商
profile，也不同于原有的 VS Code SecretStorage 密钥。它不是加密保管库，不能隔离同一
OS 用户运行的工具。页面不会读回已存密钥；本仓库及其 VSIX 打包规则排除该凭据文件及备份。

### 自主调试

在 VS Code 设置中启用 **DeepSeek Harness: Autonomous Debugging**，并在 `.vscode/launch.json` 中添加调试配置。

之后，DeepSeek 就能直接从侧边栏启动调试器、设置断点、单步执行、检查运行时变量、修复代码并验证结果。

核心会话与设置接口已通过 DeepSeek Harness `0.2.1-rc.2` 的隔离检查；此前已验证 `0.2.0-rc.2`、`0.1.7-rc.1` 与 `0.1.7-rc.2`。0.1.9 已补齐外部任务、Search / Fetch 设置、自定义推理映射与用户消息脱敏，详见[适配记录](docs/GAP-ANALYSIS.md)。工作目录及 Worktree 集成仍需专项验证。可选服务取决于实际安装的 runtime 版本和 profile。

## 隐私与验证

已发送用户消息按官方 DSH 规则隐藏可识别的凭据，支持逐项显示或隐藏。这只控制界面显示；
不会改写模型请求、存储的历史、助手或工具输出，以及显式复制消息的内容。未被规则识别的
敏感信息仍可能显示。

通过钥匙按钮配置的 API key 使用 VS Code SecretStorage 保存。已记住的 runtime 启动 URL 保存在仅所有者可访问的本地文件中，不参与同步。文件引用由用户显式添加；添加文件会让 DSH 获得相应上下文，提示词与所选上下文可能发送到配置的模型服务。

[0.1.5 复核记录](docs/RELEASE-REVIEW-2026-10-15.md) 列出了缺陷修复、隐私检查、测试覆盖与验证限制。开发阶段使用的 `braces` 依赖仍有基于版本的安全告警；本地深度限制补丁覆盖已报告的递归失败，补丁与该依赖均不进入 VSIX。

缺陷报告与功能建议请提交至 [GitHub Issues](https://github.com/fallleaves01/dsh-vscode/issues)。

## License

[MIT](LICENSE)
