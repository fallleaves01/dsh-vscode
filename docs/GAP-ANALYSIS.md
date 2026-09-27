# DSH web ↔ VS Code 插件 功能对照分析

- **对照基线**：DSH `0.1.7-rc.1`；插件 = 本目录的补丁版 `0.0.9`
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

#### ✅ 已在 0.0.10 补上

| 缺口 | 补法 |
|---|---|
| **归档不可逆**（本文档原先漏记） | 上游可归档却没有取消归档入口，归档后在 VS Code 里拿不回来。现接 `workspace/unarchiveSession`，会话菜单底部加 "Archived (n)" 折叠区 + 一键 Restore |
| **后台任务不能停** | 接 `job/kill`，运行中的任务行带 Stop → Confirm 两次点击（3 秒内），状态由 `job/list` 流收敛 |

#### P0 — 建议补，用户可感知

| 缺口 | 现状 | 补法 |
|---|---|---|
| **子代理完全不可见** | `extension.ts:878` 把 `origin === 'subagent'` 的会话**直接过滤掉**，也没有 `dsh-client-ui-subagent` 对应的目录/续接 UI | 需要新对话框：列出 subagent 会话、进入查看、续接。**注意 `subagentCatalog` 是服务端投影，插件已经在收**，所以目录本身不需要新接口 |
| **后台任务没有输出面板** | `job/list`（状态/元数据）与 `job/kill` 已接，但仍无 `job/follow`（实时输出） | 接 `job/follow`（`opened`/`output`/`status` 帧）+ 输出面板 |
| **会话不能分叉** | 无任何 `fork` 引用 | 接 `session/fork`（`{sessionId, atSeq?}` → `{sessionId}`），加"从此处分叉"入口 |

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

## 四、下一步怎么走

```sh
# 1. DSH 升级后先跑漂移审计
node tools/dsh-drift-audit.mjs '<launch url>'

# 2. 改 dsh-vscode/src/ 下对应文件
# 3. 重新构建
./build.sh
```
