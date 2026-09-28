# DSH web ↔ VS Code 插件 功能对照分析

- **对照基线**：DSH `0.1.7-rc.2`；插件 = 本目录的补丁版 `0.0.9`
- **rc.1 → rc.2 漂移审计**：见本文档第六节（结论：无破坏性变更）
- **插件上游**：[Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode)
- **方法**
  - DSH 侧：解析 `dsh-api-*/lib/typert.host.js` 的 manifest，并**实机探测**（临时起一个 `dsh web` 随机端口实例，对 73 个候选接口用空参数调用，按错误码区分"接口不存在"=HTTP 404 / "参数不对但接口存在"=各种 `*-invalid`）
  - 插件侧：源码 grep + 统计它**实际调用**的接口

---

## 一、接口层对照

插件实际用了 **24 个** Remote 接口：

```
$events  $events/result  agentPresets/list  agentPresets/select  commands/execute
commands/list  job/list  pluginInventory/list  session/attachment  session/cancel
session/control  session/create  session/follow  session/list  session/modelCatalog
session/page  session/prompt  session/rename  session/selectModel  session/updateQueue
settings/describe  settings/mutate  workspace/archiveSession  workspace/follow
（另有 skills/list，因跨行调用未被上面的统计捕获，实际使用）
```

### 存在但插件未接入

| 接口 | 说明 | 是否值得补 |
|---|---|---|
| `job/follow` (stream) | 单个 job 的**实时输出流** | ⭐ 值得 |
| `job/kill` | 终止后台任务 | ⭐ 值得 |
| `session/fork` | 从某条消息**分叉会话** | ⭐ 值得 |
| `session/search` | 服务端**全文搜索**（跨历史内容，非仅标题） | 中等 |
| `session/projections` | 直接读投影 | 不需要（现有 control 流已覆盖） |
| `session/openWorkspacePath`<br>`session/canOpenWorkspacePath`<br>`session/workspacePathApplications` | 打开工作区路径 | 不需要（VS Code 原生） |
| `terminal/*`（10 个） | DSH 自带的侧栏终端 | 不需要（VS Code 集成终端更好） |
| `credentials/*`（6 个） | DSH 的凭证管理 UI | 不需要（用 VS Code SecretStorage） |
| `directoryPicker/*` | 目录选择器 | 不需要（VS Code 原生） |
| `fileReferences/list` | 文件引用补全 | 不需要（插件自己走工作区文件系统） |
| `session/inspect`、`session/resolveAgent`、`session/workspaceDesktop`、`workspace/read` 等 | **实测 HTTP 404，0.1.7 并不存在**（属于我最初 namespace 推断错误，特此记录以免误判） | — |

---

## 二、功能层对照（DSH web 有 50+ 个 UI 模块）

### ✅ 已经对等覆盖

| DSH web 模块 | 插件对应实现 |
|---|---|
| `chat` / `conversation` | 自绘 webview 聊天视图、流式 markdown、思考折叠（本次新增） |
| `tool` | `tool-presentation.ts` / `tool-diff.ts` 工具卡片 |
| `deliverables` | `diff-review.ts` 改动文件分组 + **回复内文件引用可点击跳转**（`webview.ts:514` → `open-file` → `showTextDocument` 带行号） |
| `plan` | `collaboration-state.ts` `planModeStateOf` / `effectivePlanMode` |
| `permission-presets` | `collaboration-state.ts` `permissionPresetsOf` |
| `agent-preset`（选择部分） | `agent-presets.ts` + `agentPresets/list\|select` |
| `model-selection` | 模型 + 推理强度选择器 |
| `jobs`（列表 + 终止） | `job/list` 会话头面板 + 0.0.10 接入的 `job/kill`（两次点击确认） |
| `conversation` 的 queue | 本次接入 `inbox` 投影 |
| `commands` / `input-trigger` | `/` 命令菜单、`@` 引用菜单 |
| `reference` | `@file` / `@folder`（走 IDE 上下文桥） |
| `skill` | 技能列表 + 斜杠调用 |
| `sidebar` | `session-center.ts` 会话列表 + 标题搜索 + 注意力徽标 + **Archived 区（0.0.10）** |
| `attachment` | 图片附件（`session/attachment` + 大小限制） |
| `approval` / `user-questions` | 审批与提问的应答通道（`$events/result`） |
| `usage`（web 的上下文用量） | `usage-meter.ts` + 用量面板 |
| `plugin-manager`（部分） | 社区插件目录浏览/安装 |
| `settings`（部分） | `runtime-settings.ts` + `settings/describe\|mutate` |

### 🟦 插件独有（DSH web 做不到）

- **编辑器上下文注入**：活动文件 / 选中代码 / `@file` 随消息发送
- **原生 Diff 审阅**：VS Code diff 编辑器 + Keep/Revert + 脏文件保护
- **自主调试**：把 VS Code 原生调试器经本地 MCP 暴露给 DSH 当工具
- **运行时生命周期管理**：受管/外部运行时、launch URL 认证、版本闸门、断线重连
- **API key 存入 VS Code SecretStorage**

### ❌ 缺口（按建议优先级）

#### ✅ 已在 0.0.11 补上

| 缺口 | 补法 |
|---|---|
| **子代理完全不可见** | 不再过滤 `origin === 'subagent'`（`extension.ts` 两处）。子代理作为其父会话的子行嵌套出现在会话列表里，**默认展开**（折叠才是显式动作，否则等于又藏起来），父行带展开开关；当前会话若是子代理，会话菜单顶部出现"↩ 返回所属会话"面包屑。标签与生命周期取自子会话自己的 `subagent` 投影，回退到父会话的 `subagentCatalog`。支持任意委托深度（DSH 持久化 `delegationDepth`），搜索时拍平为匹配行。父不在本项目中的子代理不进列表（但仍计入运行中任务）；子代理被归档时进 Archived 区以便找回。 |
| **拖不动任意文件** | 输入框接受拖放（整窗覆盖提示 + 边框高亮），按 VS Code 自己的优先级解析载荷：`CodeEditors` → `ResourceURLs` → `application/vnd.code.uri-list` →（无系统文件时）`text/uri-list` → `dataTransfer.files`。工作区资源 pin 成上下文 chip（按会话隔离，远程/SSH 成立）；系统图片走原有图片附件；其余文件在 webview 里读字节，经 `fileUploads/upload` 拿到 receiptId，再以 `{type:'file', receiptId}` 随 prompt 发出。上传期间 Send 与 Enter 都被挡住，避免附件落到下一条消息。 |

> **拖放的两条已知取舍**
> - 通用 `text/uri-list` **不能**当资源来源：OS 拖文件会带上它，把客户端本机路径误当工作区路径（这是修过的 bug）；同时拖链接也走它，拦截了就会破坏"往输入框拖 URL"这个正常操作。现在只有 `CodeEditors`/`ResourceURLs`/`application/vnd.code.uri-list` 算资源，且 `push()` 只接受 `file:`/`vscode-remote:`/`vscode-vfs:`。
> - **fork 不是子代理**：DSH 的 `session/fork` 同样写 `parentSession`（种子血缘）但不写 `origin`，只有子代理两者都写。早期实现只看 `parentSessionId`，会把 fork 嵌进源会话、夺走它的重命名/归档入口，源会话一归档 fork 就彻底失联。现在要求 `origin === 'subagent'`。
> - **上传的 receipt 无法主动释放**：`fileUploads/upload` 是唯一暴露的方法，没有 cancel/release。移除 chip 或丢弃批次会在宿主侧留下已 staging 的内容寻址附件，只能等宿主的保留策略回收。 |

> **拖放为什么不能"取真实路径"**：`globalThis.vscode.webUtils.getPathForFile` 是 Electron
> preload 通过 contextBridge 暴露给 **VS Code 主窗口渲染进程**的（`preload.js` 里
> `exposeInMainWorld('vscode', f)` 且 `f.webUtils = { getPathForFile }`）。扩展 webview 走的是
> `preload-aux.js`，只暴露 `{ ipcRenderer, webFrame }` —— **没有 webUtils**；而 Electron 32 早已
> 移除非标准的 `File.path`（microsoft/vscode#230536 就是为此刻画的）。所以 Copilot 那套路径方案
> 是它作为内建 UI 的特权，第三方 webview 只能拿字节。
>
> 远程语义也因此分叉（bundle 里 `Bs`=desktop、`Ut`=browser）：资源管理器拖入给的是
> `vscode-remote://` URI，我们的扩展主机（`extensionKind: workspace`）就在远端，**能解析**；
> 而本机系统文件拖进远程窗口时路径是客户端本地的，远端读不到，VS Code 自己也退化成传字节。

#### ✅ 更早补上的

| 缺口 | 补法 |
|---|---|
| **归档不可逆**（本文档原先漏记） | 上游可归档却没有取消归档入口，归档后在 VS Code 里拿不回来。现接 `workspace/unarchiveSession`，会话菜单底部加 "Archived (n)" 折叠区 + 一键 Restore |
| **后台任务不能停** | 接 `job/kill`，运行中的任务行带 Stop → Confirm 两次点击（3 秒内），状态由 `job/list` 流收敛 |

#### P0 — 建议补，用户可感知

| 缺口 | 现状 | 补法 |
|---|---|---|
| **后台任务没有输出面板** | `job/list`（状态/元数据）与 `job/kill` 已接，但仍无 `job/follow`（实时输出） | 接 `job/follow`（`opened`/`output`/`status` 帧）+ 输出面板 |
| **会话不能分叉** | 无任何 `fork` 引用 | 接 `session/fork`（`{sessionId, atSeq?}` → `{sessionId}`，已确认存在于 0.1.7），加"从此处分叉"入口 |
| **任意文件只能拖入** | 拖放已通；附件按钮仍只挑图片 | 给 `chooseImages` 加非图片分支，走同一条 `fileUploads/upload` |

#### P1 — 看需求

| 缺口 | 说明 |
|---|---|
| 服务端会话搜索 | 现在只过滤"已加载会话的标题"；`session/search` 能搜正文 |
| 消息点赞/反馈 | DSH web 有 Like/Dislike + `/feedback`，插件 0 引用 |
| 轨迹时间线 | DSH web 的 `trajectory` 有交互式耗时总览，插件无 |
| 目标栏（Goal） | DSH web 的 `goal` 模块在输入框上方显示会话目标 |
| 定时任务（Schedule） | DSH web 会话头显示只读 Schedule 目录 |
| Agent 预设**编辑器** | 插件只能选预设，不能编辑组合 |
| 工作流运行节点 | DSH web 的 `workflow-run` 会渲染嵌套成员 |
| Cordis 动态插件卡片 | `cordis_define` 工具运行/停止开关 |

#### P2 — 不建议补（VS Code 原生更好，接进来是退步）

- 侧栏**文件树** → VS Code 资源管理器
- 侧栏**终端** → VS Code 集成终端
- 侧栏**浏览器** → VS Code Simple Browser / 外部浏览器
- **文档预览**（Office/PDF/图片/Markdown）→ VS Code 原生编辑器
- 目录选择器、凭证管理 → VS Code 原生 / SecretStorage

---

## 三、结论

**核心聊天链路已完整对齐**：会话、流式回复、工具卡片、改动审阅、文件引用跳转、排队消息、后台任务、审批提问、计划/权限模式、模型与推理强度、技能与命令 —— 都通了。

**剩下的缺口集中在"可观测性"和"会话管理"两类**，而不是聊天本身：

1. **子代理不可见**是当前最明显的信息盲区（还会主动隐藏）
2. **后台任务没有实时输出**（终止已在 0.0.10 补上）
3. **不能分叉会话**

> 0.0.10 已消掉两个死角：**归档不可逆**与**后台任务不能终止**——这两条都属于"UI 里明明有一个动作，却没有它的反向操作"，用户误触后只能去 DSH web 补救。

其余（轨迹、目标栏、定时任务、反馈、预设编辑）属于"DSH web 有、但插件形态下价值有限"的锦上添花。

另外补一句容易被忽略的**运维风险**：插件钉在 0.1.7 的内部协议上（baseline 信封、`inbox` 投影、`job/list` 拆流），DSH 仍在 rc 阶段快速演进。任何功能开发之前，先跑漂移审计确认端口是健康的。

## 四、共享服务器上的多用户隔离

在同一台服务器上多人使用时，`127.0.0.1` 是**主机级**而非用户级 —— 任何本地账号都能连到那个端口。逐项实测（隔离 `DSH_HOME` 起运行时）的结论：

**DSH 自身已经护住的（实测通过）**

| 检查 | 结果 |
|---|---|
| 未认证调 `/api/session/list` / index | **HTTP 401** |
| launch token 是否落盘 | 不落盘，纯内存；且不在 argv 里（`ps` 读不到） |
| DSH stdout（打印带 token 的 URL） | 插件用 `stdio:['pipe','pipe','pipe']` 收走，不进共享终端 |
| 插件 OutputChannel | `redactDshSecrets()` 抹掉 `?token=`/cookie/authorization |
| `$DSH_HOME/sessions/**/*.jsonl.zstd` | 目录 `0700` + 文件 `0600` |
| `storages/`、`.credentials.yaml`（签名密钥/API key） | `0700` / `0600` |

**我们自己引入过的漏洞（已修）**

`reuseExistingRuntime` 默认 `true`，探测 `127.0.0.1:3080` 后只要 `session/list` 返回 200 就**静默收养**该端点。而真 DSH 永远要求 token（未认证必然 401），所以 `ready` 这个分支只可能被冒充者命中：同一台机器上的其他用户先占用 3080、对 `session/list` 回 `{"items":[]}`，我们的侧栏就会把 prompt、代码、附件全部发给它，它还能伪造审批和 diff。

修法：`runtime.ts` 不再收养未认证端点，改为记录一条日志并启动自己管理的运行时；仍然保留 `401 → 提示粘贴 launch URL` 这条对真 DSH 有用的路径。回归测试在旧代码上会失败（`expected [] to have a length of 1`），在新代码上通过。

**注意**：`dsh web --host 0.0.0.0` 被上游**硬性拒绝**（`dsh-web-app/lib/startup.js:40`，理由是那等于把 RCE 暴露到网络）。所以远程私有访问不该靠监听端口，而应走 VS Code 自带的端口转发隧道（`Open in Browser` 已经用 `vscode.env.asExternalUri`）或 SSH 隧道。

## 五、rc.1 → rc.2 漂移审计（结论：无破坏性变更）

用 `tooling/dsh-contract-diff.mjs 0.1.7-rc.1 0.1.7-rc.2`（比对两个已发布版本的 RPC 契约面）+
`tooling/dsh-live-compat.mjs '<url>'`（拿本插件**真实客户端代码**打一个跑着的 rc.2）审计。

**RPC 方法层**：新增 **1 个**方法 `session/initializeDefaultModel`，**没有删除、没有改名**。

**Schema 层**（本插件消费的包里全部差异）：

| 接口 | 变化 | 影响 |
|---|---|---|
| `session/initializeDefaultModel` | 新增（result `z.void()`） | 无（未使用） |
| `workspace/initializeDefault` | 参数 schema 被移除 | 无（未调用） |
| `agentPresets/list` | result **删除** `modeSelectionEnabled` | 无（本插件从不读取该字段） |
| 其余全部接口 | schema 完全一致 | — |

`dsh-typert-protocol`（信封/错误协议）**完全一致**；`dsh-client-file-upload`、`dsh-subagent`、
`dsh-api-job-controller`、`dsh-api-settings-controller` 的 schema 也完全一致 —— 也就是我们刚做的
拖放上传与子代理可见性两个功能不受影响。

**实测**：`dsh-live-compat.mjs` 用插件自身代码打通 **19/19** 项（认证、`$events` baseline、
`session/list|create|follow|page|rename|cancel|selectModel`、投影、`commands/list`、`skills/list`、
`fileUploads/upload`、`workspace/archiveSession|unarchiveSession|follow`、`agentPresets/list`、
`settings/describe`、`pluginInventory/list`），并观测到 `host/session-added`、
`host/archived-sessions-changed`、`session/projection`、`session/jobs` 帧正常流动。

**rc.2 带来的新能力（未接入，属功能而非适配）**

| 新增 | 说明 |
|---|---|
| `dsh-client-shortcuts` + `dsh-client-ui-shortcuts` | 键盘快捷键面板 —— 之前 GAP 里"插件无 keybindings"的对应物 |
| `time-context` + `schedule` | Schedule 宿主行（默认 disabled），配 `schedule/changed` 事件 |
| `dsh-llm-deepseek` 拆成 `dsh-llm-deepseek-api-key` + `dsh-llm-deepseek-account` | 账号登录式鉴权；新增 `deepseek-account/session-expired`、`deepseek-account/model-sign-in-required` 事件 |
| 新错误码 | `session/provider-credentials-unavailable`、`session/provider-models-unavailable` |

**两处语义变化（已确认不破坏，但值得记住）**

1. `ModelCatalog.routableProviders` 语义收紧为"至少有一个当前可用模型的路由"。本插件用它决定
   `routable`，进而决定输入框是否可用。实测无凭证时该数组仍含 `deepseek-official`，输入框不受影响；
   只有某 provider 真的零模型时才会禁用输入框（这比 rc.1 更正确）。
2. `session/selectModel` 改为**后台**持久化默认模型，返回值不再等待落盘。本插件只用返回的规范化选择。

## 六、下一步怎么走

```sh
# 1. DSH 升级后先跑漂移审计
node tools/dsh-drift-audit.mjs '<launch url>'

# 2. 改 dsh-vscode/src/ 下对应文件
# 3. 重新构建
./build.sh
```
