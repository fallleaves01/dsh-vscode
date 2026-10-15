# DSH web ↔ VS Code 插件 功能对照分析

- **最新代码与安全复核：2026-10-15（0.1.7）**，见 [设置页实现与检查](#设置页-017-实施补充)。会话目录与新建流程的 0.1.6 修正见 [会话 UI 记录](CONVERSATION-UI-2026-10-14.md#016-补充修正2026-10-15)，此前差异操作保护见 [0.1.5 复核](RELEASE-REVIEW-2026-10-15.md)。
- **设置页面实现：2026-10-15（0.1.7）**，见下方本机 DSH `0.2.0-rc.2` 对照。原文将 `credentials/*` 归为“不需要”的结论不适用于多提供商设置；DeepSeek 的 SecretStorage 入口不能代替 DSH 的全部凭据引用管理。
- **最新本地复核：2026-10-12**，见 [发布前代码与安全复核（0.1.3）](RELEASE-REVIEW-2026-10-12.md)、[主动选择文件上下文（0.1.2）](FILE-CONTEXT-2026-10-12.md)、[输入区 UI 补充修正](COMPOSER-UI-2026-10-12.md) 和 [UI 优化与完整回归检查](UI-AUDIT-2026-10-10.md)；功能对照的 2026-10-04 记录见下方“本轮维护”。后面的第一至七节保留旧版本审计记录；其中“核心链路完整对齐”“无需改代码”等结论只适用于当时覆盖的用例，不能当作当前无 bug 的保证。
- **对照基线**：DSH `0.1.7-rc.2`（本文正文即该基线）；**当前支持基线**：DSH `0.2.0-rc.2`（复核见第六节）；插件 = 本目录的补丁版 `0.0.9`
- **rc.1 → rc.2 漂移审计**：见本文档第五节；**rc.2 → 0.2.0-rc.2** 见第六节（均无破坏性变更）
- **插件上游**：[Lixxx1/dsh-vscode](https://github.com/Lixxx1/dsh-vscode)
- **方法**
  - DSH 侧：解析 `dsh-api-*/lib/typert.host.js` 的 manifest，并**实机探测**（临时起一个 `dsh web` 随机端口实例，对 73 个候选接口用空参数调用，按错误码区分"接口不存在"=HTTP 404 / "参数不对但接口存在"=各种 `*-invalid`）
  - 插件侧：源码 grep + 统计它**实际调用**的接口

---

## DSH 设置页面集成范围：2026-10-15

本节依据本机已安装的官方 `@deepseek-ai/dsh@0.2.0-rc.2` 中 `dsh-settings`、`dsh-api-settings-controller` 以及 Models、Shell、Agent loop 等设置页面的说明与类型定义，对照本仓库的 `runtime-settings.ts`、`runtime-settings-picker.ts`、`plugin-manager.ts` 和 `dsh-client.ts`。0.1.7 已按官方设置页范围实现独立页面；下面的原始对照记录作为实施背景保留。当前实现与验证见本节末尾的补充记录。

| 官方设置能力 | 插件现状 | 需要补充 |
|---|---|---|
| 独立设置导航与分组 | 位于插件管理器中的命名空间／字段选择器 | 专用设置页和直接入口；按可用命名空间显示分组 |
| 多模型提供商、端点、协议和模型目录 | 可选择已配置模型；复杂设置主要依赖通用 JSON 输入 | 提供商增加／编辑／移除表单，模型 ID、显示名、上下文与输出上限、输入类型的结构化编辑 |
| 提供商 API 密钥 | DeepSeek 专用 SecretStorage 入口；未接入通用 credentials RPC | `credentials/describe`、`set`、`unset`，只显示配置状态；密钥通过只写路径提交 |
| 从端点获取模型 | 未调用 `llm/discoverModels` | 用户显式发起查询，可搜索并选择返回的模型；查询本身不保存配置 |
| Shell、Agent loop、Subagent、Web search 等参数 | 部分可通过设置选择器修改，缺少专用表单和清晰入口 | 使用服务端 schema、有效值、继承值与覆盖状态生成控件；保存、取消和逐项恢复默认 |
| 并发修改、动态可用性与读写范围 | 有 `expectedRevision` 和 settings 更新事件；选择器可刷新 | 整页共享快照；冲突保留草稿；连接或 runtime 变化取消旧请求；只读部署禁用保存 |
| 外观、键位和桌面专属功能 | VS Code 与 DSH 桌面壳分别拥有相应状态 | 映射到 VS Code 原生设置或明确显示宿主能力限制，避免提供不能生效的选项 |

实施顺序：先提供独立设置页及共享读写状态，再完成 Models／凭据编辑，随后补齐官方插件参数页和未知命名空间的通用表单。字段修改通过 DSH 官方接口持久化，不通过模型生成配置文件。模型编辑以路径增量写入，保留未展示字段；凭据保存失败应单独报告，不能把已成功的设置写入误报为整体未执行。

边界需按官方契约处理：Settings 只暴露可唯一定位的活动 profile 条目中声明为 volatile 的字段；普通启动组合字段和嵌套 Include 不属于该表单范围。自带设置页可能声明 `autoGenerate: false`，该标记不撤销配置读写，但说明需要专用呈现。新版该服务的可编辑字段按 `applies: live` 报告；不能仅因保存设置而重启 runtime。旧版本的 restart 字段仍须检查进程归属和运行中任务。

凭据保持只写，不进入 profile 明文、界面持久化状态、日志或模型提示。当前保存的外部 runtime 仍按 attach-only 规则处理；新页面不能隐式写入外部进程的配置或替其重启。设置页验收应覆盖保存与重置、冲突与断线、切换 runtime 后的旧回执、秘密字段和模型目录中的未展示字段保留。

---

## 设置页 0.1.7 实施补充

聊天工具栏齿轮、命令面板 `DeepSeek Harness: Open Settings` 和插件管理器打开同一
独立页面。实际表单按官方页面选择字段，不展示只在 YAML 中可改的全部配置。

- General：DeepSeek 账户状态／登录退出、会话日志上传，及 VS Code 原生外观与快捷键入口。
- Models：官方／第三方与自定义 API，端点、协议、模型 ID／名称／容量／文本与图片类型，
  只写凭据、模型查询候选选择、恢复模型默认值，以及仅用户层提供商的移除。
- Shell 与 Agent loop：命令超时、单流输出上限、并行工具调用数。
- Subagents：委派深度、活动容量、是否允许指定模型、精确模型路由；已保存但当前不可用的路由仍可移除。
- Web search：提供商密钥、端点和每次请求的搜索次数上限。

表单暂存修改并按 namespace revision 保存；每次写入校验客户端归属。并发修改保留草稿，
runtime／项目变化清空旧草稿。提供商设置已成功而凭据失败时，重试只更新凭据。
设置页不会因为保存 live 字段而重启 runtime；外部 attach-only 连接保持只读。

凭据通过 `credentials/describe|set|unset` 访问，describe 只投影 configured/writable。
本地默认提供方把值存入 `$DSH_HOME/.credentials.yaml`，POSIX 文件权限为 0600；
profile 仅记录引用，Webview 不持久化密钥。该文件不是加密保管库，也不能隔离同 OS 用户的
工具；本仓库与 VSIX 明确排除该文件及备份。原有 SecretStorage 入口用于扩展启动环境
中的 DeepSeek 密钥，环境提供的引用在设置页按官方契约显示为只读。

最终本机检查：97 个测试文件通过，1246 项通过、1 项平台测试跳过；类型检查和生产
构建通过。原有会话浏览器回归 20 组通过，设置页浏览器回归 6 组通过；设置页覆盖
三种主题与 320／420／900px，包括展开的模型编辑卡片。新增历史端点内嵌凭据的值与
继承占位符脱敏，字段保存／重置只涉及官方页面显示的字段。

真实官方 runtime 检查使用临时 HOME 与 DSH_HOME，已验证保存／重置、过期修订拒绝、
提供商增删改、凭据读写清除、独立私有凭据文件权限，以及本地 HTTP 模型列表查询。
模型请求数为 0。截图、测试日志与打包／隐私复核结果保存于忽略目录
`artifacts/ui-review/settings-017/`。实际 VS Code 和 Remote SSH 安装后的完整验收仍需单独执行。

---

## UI 优化与回归：2026-10-10

主对话、Tasks 和独立详情统一视觉样式，补充三主题、窄侧栏、短窗口和键盘焦点检查。
本轮修复 POSIX 官方 DSH 在旧 PATH 下启动失败、停止任务 NaN 耗时、嵌套缩进、
详情控件卸载监听及异常正文响应五处问题。89 个测试文件、1108 项测试、类型检查、
构建、真实 Chromium 和隔离官方 runtime 检查通过。完整覆盖与验收边界见
[检查报告](UI-AUDIT-2026-10-10.md)。

## 本轮维护：2026-10-04

基线分别核实：本机官方 DSH CLI 和 [npm latest](https://www.npmjs.com/package/@deepseek-ai/dsh) 均为 `0.2.0-rc.2`；官方 [GitHub master 的 CLI 清单](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/package.json) 是 `0.2.1-alpha.1`。插件清单版本是 `0.1.0`。开发分支的 UI 和契约用于判断方向，不能直接当成已经发布的产品承诺。

### 本轮已修复的可复现问题

| 问题 | 成因与影响 | 本轮修复 |
|---|---|---|
| 后台任务刚出现就消失 | `job/list` 初始行只发送给 UI，没有进入 feed 缓存；激活会话时又用空缓存覆盖。旧测试模拟的 control baseline 含有旧式 `jobs`，掩盖了问题 | 缓存独立 jobs 快照；测试改为真实的新 baseline 形状 |
| 切换会话后任务永远显示运行中 | 导航时直接取消旧会话的 jobs 流，结束事件再也收不到 | 有运行中／停止中的 job 时继续观察，全部结束后释放流；等待新 baseline 时不提前取消 |
| 子代理等待审批／回答，却没有可操作入口 | 请求过滤只接受当前会话或已手动发送的会话，把未打开的子代理请求交给后续 handler | 按明确的父子血缘或持久化 catalog 识别后代，缓存请求并显示 attention；无关会话仍不接管 |
| 清理阶段使 restart 永久等待 | launch contribution 的异步 `dispose` 没有截止时间，重启串行等待同一个永不完成的 Promise | 等待清理最多 5 秒，失败显示错误并取消启动；保留原清理过程，完成后才允许重试 |
| 终止失败却误报停止，可能留下旧进程 | 信号抛错／强杀未退出时仍 resolve；丢失 child 句柄，broker 也可能删除仍存活的记录 | 等待实际退出；失败时保留活进程句柄／记录并拒绝 restart，避免启动替代进程 |
| 启动窗口重启会打断借用它的其他窗口 | 原路径先杀自己持有的 child，之后才检查跨窗口 lease | 终止前检查其他活跃 lease；仍被使用时只解除当前窗口连接 |

这些问题能解释插件等待、任务状态失真和特定条件下遗留进程。源码和回归测试没有建立它们与某次集群／文件系统卡顿的因果关系，也没有发现该重启路径会自动无限创建 runtime。

### 子任务界面的具体改进

主对话输入框上方新增默认展开的 **Tasks** 面板：子任务可以直接点击打开旁边的独立详情面板，不必先打开会话下拉菜单；支持嵌套子任务，并显示运行状态、待审批／待回答、正常完成、累计耗时和 token。进入后保留返回父任务入口。一次性或模式未知的子任务明确只读，宿主也拒绝无效续聊；continuable 子任务仍支持排队发送和独立停止。

同一面板显示 `todos` 计划步骤，按 pending／in progress／completed 状态更新；切换会话和重启时清空旧计划。耗时来自 `subagentTiming`，token 由四个不重叠的 usage 桶相加。官方并未给所有非正常结束提供可靠分类，因此界面只把明确正常完成标记为 Completed，其余闲置状态显示 Idle，避免把取消或异常误写成成功。[官方 subagent UI 契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-subagent/README.md)

### 后续补齐：此前列出的八项缺口

以下接入已实现，操作与运行条件见 [任务功能使用说明](TASK-FEATURES.md)。

| 原优先级 | 功能 | 当前实现 |
|---|---|---|
| P1 | 后台 job 输出详情 | 独立 `job/follow`，stdout/stderr/log、进度、最终状态、保留缺口；每面板 128 KiB／1024 片段上限 |
| P1 | 子任务与主对话同时查看 | 可复用的独立详情面板；会话历史、审批／回答、Queue／Steer／Stop；主对话导航保持观察 |
| P1 | 子任务恢复提示 | 按父 `agentAvailable` 门控，父任务空闲仍可续聊，释放后给出恢复说明 |
| P2 | jobs 断线和全局观察 | 项目已有会话基线扫描，并发等待最多 8 个；运行中持续观察；失败标记可能过期并提供 Refresh |
| P2 | Goal | 专用目标视图，阶段／轮数预算／activation／阻塞原因；创建、编辑、暂停、恢复、完成、清空；CAS 防止旧操作覆盖 |
| P2 | Schedule | 项目提醒目录、下一次／上次投递、历史分页和 retention 提示；仍使用 runtime 工具创建或管理提醒 |
| P2 | Workflow | durable run/member/outcome、阶段分组、独立成员详情；实时 phase/log 通过后台输出查看 |
| P2 | 正文搜索 | 服务端会话正文命中与摘要；归档恢复；项目过滤、全 runtime 20 命中上限说明、旧请求隔离 |

实机发现标准 Web profile 默认没有开放 Schedule，也未启用正文搜索。插件增加两项默认关闭的可选设置：`enableSchedule` 和 `enableHistorySearch`，由用户启用并重启 managed runtime；外部／自定义 runtime 使用自己的配置。用全新临时 DSH_HOME 加载配置层后，Goal 读取、Schedule 目录、正文搜索和独立 follow 均通过；没有发起模型请求。

依据：[job 观察接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/job-controller/README.md)、[subagent UI](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-subagent/README.md)、[Goal](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/goal/README.md)、[Schedule](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/schedule/schedule/README.md)、[Workflow](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/workflow/README.md)，并与本目录源码的实际调用和状态渲染交叉检查。

会话分叉、取消归档、job 停止已经有代码和入口，旧章节仍列为缺口的地方应以本轮源码为准。终端、文件树和路径打开优先使用 VS Code 原生能力；Code Mode、deferred loading 等 runtime 内部能力也不能仅因没有专门按钮就判定插件不支持。

### 验证范围

新增用例覆盖 jobs 初始快照与导航后结束、嵌套子代理请求、只读模式、耗时与 token、todo 切换、终止拒绝、强杀后不退出、清理超时和共享 child 的 lease。真实 Chromium 检查 320／420／650px 下的面板布局、详情导航、返回及折叠，同时运行原滚动回归。完整测试、类型检查和构建结果见本轮交付说明。

前一轮维护检查：82 个测试文件通过，1030 项测试通过、1 项跳过；TypeScript 类型检查和生产构建通过；真实 Chromium 回归通过。安装包为 `artifacts/dsh-sidebar-0.1.0-maintenance.vsix`，三种宽度的界面截图也保存在 `artifacts/`。

后续补齐的最终检查：88 个测试文件通过，1100 项测试通过、1 项跳过；类型检查、生产构建和真实 Chromium 回归通过。隔离官方 runtime 只读接口检查通过。安装包为 `artifacts/dsh-sidebar-0.1.0-task-features.vsix`；使用说明见 [TASK-FEATURES.md](TASK-FEATURES.md)，截图包括 `task-features.png`、`subagent-details.png` 和 `job-output.png`。

上述前一轮包是本地代码维护结果，尚未在真实 VS Code 多窗口和远程集群里进行端到端验收，也没有发起付费模型请求。保留现有未提交改动；本轮没有升级 DSH、覆盖已安装插件或发布 Marketplace。

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
| `primitives` 排版（markdown 工作表 / `DisclosureRow` / `StatsPills` / 回合尾部） | webview 直接用 DSH 的度量：正文 `--dsh-content-font-*`、段间 16px、列表缩进 18px、0.5px 细线表格、24px 工具披露行、28px 回合动作行、composer dock 统计胶囊（`conversation-scroll.browser.mjs` 逐项量测） |
| `tool` | `tool-presentation.ts` / `tool-diff.ts` 工具卡片 |
| `deliverables` | `diff-review.ts` 改动文件分组 + **回复内文件引用可点击跳转**（`webview.ts:514` → `open-file` → `showTextDocument` 带行号） |
| `plan` | `collaboration-state.ts` `planModeStateOf` / `effectivePlanMode` |
| `permission-presets` | `collaboration-state.ts` `permissionPresetsOf` |
| `agent-preset`（选择部分） | `agent-presets.ts` + `agentPresets/list\|select` |
| `model-selection` | 模型 + 推理强度选择器；模型多时可搜索（0.2.0 对齐：子序列匹配 + 上下键 + Enter） |
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

**rc.2 带来的新能力（已接入三项）**

| 新增 | 落地情况 |
|---|---|
| `dsh-client-shortcuts` + `dsh-client-ui-shortcuts` | ✅ 已补上插件侧的 VS Code 键位（`Cmd/Ctrl+Alt+D/E/L/F`）；DSH 那套是浏览器 UI 的，插件对应物就是 keybindings |
| `dsh-llm-deepseek` 拆成 `dsh-llm-deepseek-api-key` + `dsh-llm-deepseek-account` | ✅ 已接入账号登录：`account/getState|getProfile|getBalance|startSignIn|cancelSignIn|signOut`，并在 `deepseek-account/signed-out|session-expired|model-sign-in-required`、`credentials/record-updated` 事件上刷新 |
| 新错误码 | ✅ 已映射为可操作文案（`session/provider-credentials-unavailable` 等），并识别内联在文本里的 `namespace/name:` 前缀（`api-session/error` 只发文本） |
| `time-context` + `schedule` | 未接入（Schedule 宿主行默认 disabled） |

**两处语义变化（已确认不破坏，但值得记住）**

1. `ModelCatalog.routableProviders` 语义收紧为"至少有一个当前可用模型的路由"。本插件用它决定
   `routable`，进而决定输入框是否可用。实测无凭证时该数组仍含 `deepseek-official`，输入框不受影响；
   只有某 provider 真的零模型时才会禁用输入框（这比 rc.1 更正确）。
2. `session/selectModel` 改为**后台**持久化默认模型，返回值不再等待落盘。本插件只用返回的规范化选择。

## 六、rc.2 → 0.2.0-rc.2 漂移审计（结论：无破坏性变更，无需改代码）

同样的两件工具，外加对**真实运行环境**的只读探测：

```sh
node tooling/dsh-contract-diff.mjs 0.1.7-rc.2 0.2.0-rc.2        # 只读 npm registry
node tooling/dsh-drift-audit.mjs '<用户真机 0.2.0-rc.2 的 URL>'    # 只读，未做任何变更调用
node tooling/dsh-live-compat.mjs '<隔离 HOME 起的 0.2.0-rc.2>'   # 会建会话/上传/登出，必须在隔离 HOME 跑
```

**契约层**：`dsh-api-session-controller` 的 4 个 result schema 各新增一个投影
`userQuestions`，**没有删除、没有改名**；其余 8 个包（jobs / workspace / settings /
file-upload / subagent / agent-presets / commands / plugin-inventory）完全一致。

**`userQuestions` 是否需要适配：不需要。** `dsh-tool-ask-user` 的 `Config.mode` 默认
`legacy`，届时 `userQuestions` 恒为空视图；只有显式配置 `mode: timed` 的运行时才会产生
`open` / `continued` 状态的问题，而那种状态下客户端的应答路径从 waterfall 事件换成
`userQuestions/answer`、并用 `userQuestions/attachWait` 重新挂wait。用户真机未启用该模式
（`~/.dsh/profiles` 里没有相关配置），所以本插件现有的 waterfall 应答路径就是 0.2.0 的默认路径。
若将来要支持 timed 模式，需要：读 `userQuestions` 投影 + 接这两个 Remote 方法 + 呈现
`intent.kind === 'plan-review'`。

**行为层（审计工具发现的真实校验变化）**：`session/page` 现在会**拒绝**超过会话 cursor 的
`throughSeq`（`gateway/bad-request: session page through seq … is past cursor …`）。本插件
`DshSessionFeed.page()` 传的正是 follow 快照的 cursor，因此不受影响 —— 已在注释与测试里钉住。

**实测结果**（用户真机 0.2.0-rc.2，322 个已存会话）：

- HTTP 接口 7/7 OK：`session/modelCatalog`、`agentPresets/list`、`pluginInventory/list`、
  `settings/describe`、`commands/list`、`skills/list`、`session/page`
- mux 流 4/4 OK：`$events` ready、`session/control` baseline、`workspace/follow` baseline、
  `session/follow` snapshot（`projections.asOfSeq === cursor`）
- `dsh-live-compat.mjs`（本插件真实客户端代码）**24/24 touchpoints OK**，观察到的帧类型
  `host/session-added`、`host/settings-changed`、`mux:session/jobs`、`mux:session/projection`
  都在 `acceptFrame` 的处理范围内
- 顺带修掉两个**工具自身的假失败**：`dsh-url-check.mjs` 只认 `Location: /`（0.2.0 回 `./`，
  客户端两者都收），`dsh-drift-audit.mjs` 用 `throughSeq: 1e9` 探测分页（现被合法拒绝）

## 七、下一步怎么走

```sh
# 1. DSH 升级后先跑漂移审计
node tooling/dsh-drift-audit.mjs '<launch url>'

# 2. 改 dsh-vscode/src/ 下对应文件
# 3. 重新构建
./build.sh
```
