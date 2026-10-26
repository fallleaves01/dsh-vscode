# DSH 0.2.1-rc.3 实验性功能适配记录

- 适配对象：基于 `5911c16` 的工作树改动，DSH Sidebar `0.1.16` 源码。
- 运行时基线：官方 DeepSeek Harness `0.2.1-rc.3` 本地安装副本；Node.js `v26.12.0`，macOS arm64，TypeScript `6.0.3`，Vitest `4.1.11`。
- 隔离环境：独立 `DSH_HOME`；`web` profile 启用 `dsh-base`、`dsh-web-app` 及 4 个实验 bundle（session-titles、agent-team-profile、auto-review、session-search）。
- 范围与证据：13 个指定实验性根包的契约分析与扩展触点映射记录在本地审计材料中，未纳入版本库。本记录只读取 DSH 安装目录与隔离运行时，不访问用户默认 `DSH_HOME`、不连接外部服务器、不执行 Git 写操作。
- 方法与限制：以真实 HTTP RPC（`/api/<endpoint>`）、真实事件复用器（`/api/remote.mux`）和真实 Session 投影为证据；扩展侧只调用未修改的纯函数模块（用 `tsc` 编译到临时目录后 `import`），未在真实 VS Code 实例中安装并激活 VSIX。模型相关路径因隔离运行时未登录模型账户而无法端到端执行，详见第 5 节。

## 1. 覆盖矩阵

状态定义：**已适配**＝本扩展已消费该包对客户端可见的契约，并已用真实运行时数据或自动化测试验证；**部分**＝仅覆盖部分契约或仅有既有替代路径；**不适用**＝VS Code 客户端无需专属实现；**待办**＝本轮未实现。

| # | 包 | 包类型 | 状态 | 本仓库实现与证据 | 限制 |
|---|---|---|---|---|---|
| 1 | `dsh-experimental-agent-team` | Host 服务 + Session projection | 已适配 | 新增纯视图模型 `src/agent-team-state.ts`（`agentTeamOf`/`agentTeamSummaryOf`）；投影接入 `src/extension.ts:211,2005,2344`；面板渲染 `src/webview.ts:3165-3175,3216-3272`；测试 `tests/agent-team-state.spec.ts`（10 项）与 `tests/webview-task-features.spec.ts` | 只读展示持久投影；不合并 `agent/status` 的运行中状态；任务写操作仍由模型工具完成 |
| 2 | `dsh-experimental-agent-team-profile` | 纯 profile bundle | 已适配（无需独立代码） | 运行时 `pluginInventory/list` 显示 `agent-team`、`tool-agent-team`、`ui-agent-team` 三项 `enabled=true/fiberPhase=active`；真实 `request/header` 的 42 个工具含全部 9 个 Team 工具；设置页 Plugins 分区可查看并启停该 bundle | 标准 agent preset 仍同时暴露 `subagent`、`subagent_fork`（实测），既有委派卡继续可用 |
| 3 | `dsh-experimental-auto-review` | Host 插件 | 已适配 | `src/dsh-client.ts:478` 读取 `permissionPresets/catalog`；`src/collaboration-state.ts:78,125,230,242,263` 解析目录、`EXP` 标记、选择态与风险确认；`src/extension.ts:2096,2883` 装配与确认；`src/webview.ts:2505,2893` 徽标；拒绝调用专用呈现：`tool/result` 的 `AutoReviewDeniedError`/`AUTO_REVIEW_DENIED` 投影为 `autoReviewDenied`，工具卡折叠行显示 `Rejected by Auto review`、展开显示 `Tool was not executed. Reason: …`（`src/conversation.ts`、`src/webview.ts`、`src/task-details.mts`）；审批提示优先使用 `displayReason.en`；测试 `tests/collaboration-state.spec.ts`、`tests/conversation-auto-review.spec.ts`、`tests/webview-auto-review.spec.ts`、`tests/extension-surface.spec.ts` | 审批面板不单独标注 Auto 来源（文案本身含 Auto review 字样）；拒绝/审批的端到端验证仍依赖模型凭据（当前为契约级 + 事件级覆盖） |
| 4 | `dsh-experimental-session-titles-bundle` | 纯 profile bundle | 已适配（零代码改动） | 既有 `title` projection 与 `session/title` 事件链路；真实运行时观察到 `session/title` 与 `session/title-llm-request` 事件、重命名后的 `{type:'projection', key:'title'}` 帧（`seq=3`） | LLM 标题生成需已登录模型账户；隔离环境回退为 `source.kind='fallback'`；生成失败保留旧标题 |
| 5 | `dsh-experimental-session-search` | 纯 profile bundle | 部分 | 5 个智能体工具（`session_search`、`session_trace`、`session_event_read/search/trace`）出现在真实工具目录，经通用工具卡呈现；侧栏正文搜索继续使用基础 `session/search` | 未接入工具专用卡片；与 `enableHistorySearch` 任务服务补丁存在双 SQLite 行风险（实测 `include:session-query-sqlite` 与 `include:optional-session-query-sqlite` 同时 active） |
| 6 | `dsh-experimental-cot-translation-bundle` | 纯 profile bundle | 已适配 | 设置页 Reasoning translation 卡片（`cot-translation`：`provider` 4 值、`targetLanguage`）；会话内 Thinking 按 DSH 方式翻译显示：`cotTranslation/limits` 探测能力与上限、`cotTranslation/translate` 按段落/长度分片串行请求、默认译文、View original 切换、pending spinner、失败时原文 + Retry（`src/dsh-client.ts`、`src/extension.ts` 的 `translate-reasoning` 协议、`src/webview.ts` 的 `thinking-translation` 渲染）；测试 `tests/dsh-client.spec.ts`、`tests/extension-surface.spec.ts`、`tests/webview-translation.spec.ts` | 译文按纯文本渲染（与既有 reasoning 一致；DSH 用 Markdown）；折叠 Thinking 不取消在途请求（结果入缓存，切换会话清理）；`auto` 语言按编辑器语言主子标签解析（DSH 内置仅 zh/en，本扩展可发 ja）；展开的思考内容会发送给所选翻译服务 |
| 7 | `dsh-experimental-plugin-market-bundle` | 纯 profile bundle | 部分 | 设置页新增 Plugin market 卡片（`plugin-market` namespace 的 `indexes` URL 列表，`string-list` 控件与 HTTP(S) 校验）；既有社区 registry 与 CLI 安装路径保留（`src/plugin-catalog.ts`、`src/plugin-manager.ts`） | 市场 Discover、搜索与图形化安装未实现（`pluginMarket/listIndexes|search|setIndexes` 与 `pluginManager/installBundle` 等） |
| 8 | `dsh-experimental-voice-input-bundle` | 纯 profile bundle | 部分 | 设置页新增 Voice input 卡片（`speech-to-text` namespace：`defaultProvider` 与 `language` 两个字符串字段），经 `settings/mutate` 保存；bundle 可经设置页启停 | 音频采集与转写未实现（`speech/follow|transcribe` 流经 `/api/remote.mux`、设备准备 UI） |
| 9 | `dsh-experimental-terminal-bundle` | 纯 profile bundle | 不适用 | 仅新增 6 个模型工具，通用工具卡可渲染；用户侧持久终端面板属基础 `terminal/*` RPC，不是本包的客户端契约 | 无持久终端面板；既有 bash/pwsh 卡片保持原状 |
| 10 | `dsh-experimental-tool-worktree` | 纯 profile bundle | 部分 | `create_worktree` 走通用工具卡；真实运行时存在 `workingDirectory` projection（实测等于会话工作目录） | 扩展未消费 `workingDirectory`（`src/` 0 命中）；文件解析与变更审阅仍以项目根为基准，README 已声明该集成待专项验证 |
| 11 | `dsh-experimental-badge-skill-bundle` | 纯 profile bundle | 不适用 | 技能经既有 `skills/list` 展示；运行时 `enabled=false` | 无 |
| 12 | `dsh-experimental-ralph-bundle` | 纯 profile bundle | 不适用 | `ralph` 工具走通用工具卡；工作流运行沿用既有 `tool-workflow/*` 面板；运行时 `enabled=false` | 无专用呈现，无新增客户端契约 |
| 13 | `dsh-experimental-inspector-profile` | 纯 profile bundle | 不适用 | 自带 CDP/DevTools HTTP 引导路径，不注册 Gateway RPC；运行时 `enabled=false` | VS Code 侧无对应 UI，不应复用该调试协议 |

## 2. 本轮实现要点

### 2.1 Auto Review 权限目录

1. **目录读取**：`DshClient.permissionCatalog()` 调用 `permissionPresets/catalog`（参数 `{}`，超时 10 s），任何异常或不可解析应答都解析为 `undefined`，不进入连接握手；连接建立后异步读取，运行时不含该 RPC 时保留内置三档预设（`src/dsh-client.ts:478`，`src/extension.ts:2096`）。
2. **解析与合并**：`permissionCatalogOf` 整体校验目录（无权项、重复项、缺失 `options` 均视为不可用），`permissionPresetsFromCatalog` 在目录存在时以目录为选项来源、否则回退投影 `options` 或内置预设；`custom` 不作为切换目标，`auto` 以 `experimental` 标记（`src/collaboration-state.ts:78,125`）。
3. **风险确认**：`requiresPermissionConfirmation` 对 `danger-full-access` 与 `auto` 同时要求确认；确认文案说明 Auto review 无沙箱、逐工具调用经模型复审、可能误放行/误拒绝、额外消耗 token（`src/collaboration-state.ts:230,242`）。选择器点击与键入 `/permission auto` 共用同一确认（`src/extension.ts:2883`，`src/collaboration-state.ts:263`）。
4. **呈现**：权限菜单与 `/` 命令候选为 `auto` 显示 `EXP` 徽标，`currentValue` 为 `auto` 时显示为选中项（`src/webview.ts:2505,2893`）。

### 2.2 Agent Teams

1. **纯视图模型**：`src/agent-team-state.ts` 对 `agentTeam` 投影做防御性校验，丢弃重复/非法成员与任务，派生 `blocked` 与完成计数，成员按 Lead 优先排序，任务按 `in_progress`→`pending`→`completed` 排序（同状态按 `task-N` 数字序）；无 I/O、无 `vscode` 依赖、不抛错。
2. **投影接入**：`ChatViewState.team` 为 `AgentTeamView | null`；会话加载与 `session/projection` 帧（`payload.key === 'agentTeam'`）都更新该字段，切换会话时清空（`src/extension.ts:211,2005,2344`）。
3. **面板渲染**：Tasks 面板新增 `Team` 名册与 `Shared tasks` 任务板；名册显示角色与**会话运行态**（Running/Inactive）以及 `provisioning/failed` 生命周期阶段——投影的 `phase` 只表示成员记录已建立，运行态来自会话列表的 `running` 标志，Lead 行同规则；点击成员行打开其会话；任务板显示状态、`ready`/`blocked`、`blockedBy`、owner 与 write scopes，只读（`src/webview.ts` 的 `renderTaskPanel`）。
4. **工具引用**：`subagent-tools.ts` 识别 `spawn_teammate`、`list_agents`，以及按成员名寻址的 `send_message`/`interrupt_agent`（rc.3 Team 工具使用 `target` 而非 `agent_id`）；Webview 用 `agentTeam.members` 把成员名解析为会话 id，解析失败时退回通用工具卡而非死链（`src/subagent-tools.ts:29,85`，`src/webview.ts:1575`）。

### 2.3 会话标题实时刷新

标题链路无需代码改动：控制流的 `{type:'projection', key:'title'}` 帧到达后，扩展改写会话摘要并重发列表（`src/extension.ts:2328-2340` 既有实现）；`session/title` 事件由历史投影合并。本轮只用真实 rc.3 运行时验证了该链路（见 3.3）。

### 2.4 事件流容错

`$events` 与 `session/control` 两个共享 carrier 的未知顶层帧类型由抛错改为忽略并输出限流诊断：每个流最多报告 16 种不同类型，超出后只报告一次抑制消息；帧类型标签经控制字符屏蔽与长度限制，不携带载荷（`src/dsh-session-feed.ts:13,522,573,672`）。已知帧类型的严格载荷校验保持不变。

### 2.5 实验性插件设置入口

1. **实验 bundle 启停**：设置页 Plugins 分区在只读 inventory 之外新增 Experimental bundles 区。数据来自 `pluginManager/listBundles`，由 `publicBundles()` 白名单投影（丢弃图标 data URL、来源路径与原始诊断）；开关经 `pluginManager/setBundleEnabled` 写入。写入前依次校验：运行时归属（外部 attach-only 运行时只读）、profile 可写、用户确认。运行中的对话或任务**不**阻止修改：宿主侧不检查运行状态，只按 HMR 返回 `applied` 或 `restart-required`，页面据此呈现。结果按 `ChangeResult.application` 呈现：`applied` 立即生效，`restart-required` 明确提示重启运行时，`overridden`/`failed`/`cancelled` 显示原因，不复用通用的“已保存”文案。
2. **实验设置卡片**：复用既有的 `settings/describe` + `settings/mutate` 路径，新增三个声明式卡片与可达标签页：Reasoning translation（`cot-translation`：`provider` 下拉、`targetLanguage`）、Voice input（`speech-to-text`：`defaultProvider`、`language`）、Plugin market（`plugin-market`：`indexes` URL 列表）。字段类型扩展为 `select` 与 `string-list`；写入前校验枚举归属、HTTP(S) 端点、去重与数量上限。bundle 未启用时对应 namespace 缺失，卡片与标签页自动隐藏。
3. **事件刷新**：`plugin-manager/changed` 与 `permission-presets/catalog-changed` 由事件流转发到宿主，分别触发设置面板防抖刷新与权限目录重读，运行期启停后无需重连即可反映。

## 3. 验证记录

### 3.1 自动化测试

命令：`./node_modules/.bin/vitest run`

| 指标 | 数值 |
|---|---|
| 测试文件 | 117（116 通过，1 失败） |
| 测试用例 | 1649（1647 通过，1 失败，1 跳过） |
| 耗时 | Duration 9–10 s（多次复跑） |

唯一失败为既有沙箱限制：`tests/diff-review.spec.ts:787` 向 `$HOME/dsh-open-file-spec.tmp` 写入时返回 `EPERM`。该测试文件不在本轮改动清单内，失败与 rc.3 适配无关；Vitest 因此以退出码 1 结束。新增测试文件三个：`tests/agent-team-state.spec.ts`（10 项）、`tests/dsh-session-feed.spec.ts`（16 项）、`tests/extension-surface.spec.ts`（5 项）；另在 `tests/settings-page-state.spec.ts`、`tests/settings-panel.spec.ts`、`tests/settings-page.spec.ts`、`tests/dsh-session-feed.spec.ts`、`tests/collaboration-state.spec.ts`、`tests/dsh-client.spec.ts`、`tests/discovery-controller.spec.ts`、`tests/subagent-tools.spec.ts`、`tests/webview-policy.spec.ts`、`tests/webview-subagent-cards.spec.ts`、`tests/webview-task-features.spec.ts` 中扩充用例。

### 3.2 类型检查与构建

| 命令 | 结果 |
|---|---|
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | 退出码 0，无诊断输出 |
| `node scripts/build.mjs` | 退出码 0；产出 `dist/extension.js` 1.1 MB、`dist/runtime-host.js` 25.4 kB 及 Webview bundle（`markdown`、`scroll`、`task-details`、`settings-page`） |

`dist/` 已由 `.gitignore` 排除，构建产物不进入版本控制。

### 3.3 真实 rc.3 运行时联调

环境：独立 `DSH_HOME` 下运行 `dsh web --host 127.0.0.1 --port <port> --no-open`；启动 URL 含一次性 token，按安全惯例不在文档中记录。

| 检查项 | 真实观测结果 |
|---|---|
| `permissionPresets/catalog` | `options` = `read-only`、`workspace-write`、`danger-full-access`、`auto`；`defaultOptions` 不含 `auto`；`defaultPreset='workspace-write'` |
| 目录解析 | `permissionCatalogOf` 接受真实应答（4 个选项，名称与顺序一致）；`currentValue='auto'` 时为唯一选中项且 `experimental=true` |
| `pluginInventory/list` | 201 个 entry，`managementAvailable=true`；6 个受测模块 `enabled=true/fiberPhase=active`：`dsh-experimental-auto-review`、`dsh-experimental-agent-team`、`dsh-experimental-tool-agent-team`、`dsh-experimental-client-ui-agent-team`、`dsh-session-title-all-prompts-llm`、`dsh-tool-session-query`；基础 `dsh-session-title-first-prompt-llm` 为 `enabled=false` |
| `pluginManager/listBundles` | 20 个 bundle，其中 12 个实验 bundle；启用的恰为 profile 中 4 个（session-titles、agent-team-profile、auto-review、session-search），其余 8 个 `enabled=false` |
| `session/create` + `session/projections` | `kind='sequenced'`；投影键 21 个，含 `agentTeam`、`title`、`permissions`、`workingDirectory`；`permissions={"currentValue":"workspace-write"}` |
| `agentTeam` 真实值 | `{"members":[{"id":"session-…","name":"lead","role":"lead","phase":"active"}],"tasks":[]}`；`agentTeamOf` 解析出 1 个 Lead 成员、0 个任务 |
| `workingDirectory` 真实值 | 等于 `session/create` 传入的项目目录 |
| 事件复用器 | `$events` 收到 `ready`；`session/control` 收到 `baseline`；`session/follow` 收到快照，header `version=4`、`agentPreset='standard'` |
| 标题实时链路 | 重命名后收到 `session/control` 的 `{type:'projection', sessionId, key:'title', value:'rc3-live-title', seq:3}`；`session/follow` 快照同样携带该标题 |
| Auto review 切换链路 | `commands/execute` 的附件格式协商结果为 `submittedAttachments`；`/permission` 返回 `current preset workspace-write (available: read-only, workspace-write, danger-full-access, auto)`；`/permission auto` 返回 `preset auto` 且投影帧 `{key:'permissions', value:{currentValue:'auto'}, seq:6}` 到达，解析器将 `auto` 标记为选中且 `experimental=true`；切换回 `workspace-write` 同样生效 |
| 模型工具目录 | 真实 `request/header` 记录 42 个工具，含全部 9 个 Team 工具：`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create/list/get/update`；Team 工具参数与实现一致（`send_message` 用 `target`，`spawn_teammate` 用 `name/description/prompt/context`） |
| 标题 bundle 行为 | 真实会话记录含 `session/title`（`source.kind='fallback'`）与 `session/title-llm-request` 事件，证明 all-prompts 标题提供者已装载并参与生成 |
| 解析函数比对 | 15/15 断言通过（目录、选择态、投影、复用器基线、bundle 启用集）；Team 工具引用解析按真实 schema 形状 5/5 检查通过 |

`account/getState` 在隔离运行时返回 `signed-out`，因此 `session/prompt` 虽被接受，模型调用未产生回复；该限制不影响上述接口、投影与事件层结论。

## 4. 未覆盖项与原因

1. **Auto review 的实际拒绝/审批回路**：需要模型产生工具调用并触发 `tools/pre-execute` 复审；隔离运行时未登录模型账户。事件结构与目录契约已验证。
2. **真实队友创建与共享任务写入**：`spawn_teammate`/`team_task_*` 需要模型发起调用；验证了工具目录、真实投影形状与视图模型解析，未执行端到端创建。
3. **LLM 生成的会话标题文本**：同上，仅验证了投影/事件链路与 fallback 行为。
4. **未知顶层帧的真实注入**：真实 rc.3 目前只发送 `ready`/`emit`/`cancel`/`waterfall` 与 `baseline`/`queue`/`jobs`/`projection`，无法构造未知帧；容错由 `tests/dsh-session-feed.spec.ts` 的假 carrier 覆盖。
5. **VS Code 内实际渲染与交互**：未安装 VSIX、未在扩展宿主中激活；Webview 行为由 DOM 级测试覆盖，未做真实截图对比。
6. **`enableHistorySearch` 与本轮 session-search bundle 的联合运行**：真实运行时同时存在两个 `session-query-sqlite` entry；扩展补丁按 `- id: session-query-sqlite` 覆盖配置。需在启用该设置的受管运行时中复核是否形成双后端。
7. **工作目录投影消费**：`workingDirectory` 未接入，属于既有已知缺口（worktree 集成待专项验证）。

## 5. 剩余风险与建议

1. **权限目录刷新时序**：`permission-presets/catalog-changed` 已由事件流转发并在宿主侧触发目录重读；若事件早于目录读取完成到达，选择器可能短暂显示旧目录，下一次事件或重连后收敛。
2. **审批来源标识**：Auto review 拒绝触发的是标准 `approval/request`，扩展不标注来源；如需区分，只能依据 reason 文本启发式判断，不建议在高风险场景依赖。
3. **Team 面板的默认可见性**：启用 agent-team-profile 后，新建会话的 `agentTeam` 投影即含 Lead 成员，Tasks 面板会为每个会话显示 Team 小节（1 名成员）。这符合投影语义，但可能产生常驻噪声；是否只在成员数大于 1 或存在任务时显示，留待可用性评估。
4. **模型依赖路径**：在拥有模型凭据的环境中补充 Auto review 拒绝/审批、队友创建与任务板写入、标题生成的端到端验证。
5. **能力探测而非版本门控**：rc.2 与 rc.3 的实验性契约相同（契约比对记录为本地审计材料），本轮实现全部按能力探测降级：目录不存在→内置预设；投影不存在→不渲染 Team；bundle 管理 RPC 不存在→仅只读 inventory；设置 namespace 缺失→卡片隐藏。未新增版本号判断，rc.2 运行时行为保持原样。

## 6. 发布后审查与修复（0.1.19）

0.1.18 发布后，由四名独立审查员对 5911c16..9b05dd6 的改动做了分层审查：宿主/协议契约、Webview/UI、回归与发布一致性、对抗性边界。结论为「改动合理、无既有功能回归、无阻塞项」，并按发现修复如下：

| 来源 | 问题 | 修复 |
|---|---|---|
| UI 审查 | 提示条去重键在关闭后未复位，同一失败第二次被静默 | 改为按「结果代次」记录已播报消息：新结果重新播报，切换分区不重播 |
| UI 审查 | bundle 开关在请求挂起期间回显旧值，观感像未生效 | 挂起期显示请求的目标值并标注 Applying…，结果到达后以宿主状态为准 |
| UI 审查 | `agentTeam` 投影晚于工具消息到达时，团队工具卡链接不补 | 工具卡记录团队成员映射签名，签名变化时仅重渲染受影响的卡片 |
| 对抗审查 | 团队投影无数量与长度上限（2 万成员可产生数万 DOM 节点） | 成员 50、任务 200、id 256、文本 300/1000 字符、集合 20 项上限 |
| 对抗审查 | 权限目录无上限（10 万选项、1 MB 描述） | 选项 16、名称/描述 300、选项值 64 上限 |
| 对抗审查 | 设置字符串与 bundle 错误码无长度约束 | 设置字符串 1024 上限；错误码截断并剥离控制字符 |
| 宿主审查 | `setBundleEnabled` 客户端 30 s 超时短于宿主 120 s 文件锁等待 | 超时改为 130 s，并注明结果未知时由 `plugin-manager/changed` 收敛 |
| 宿主审查 | 注释称 rc.2 缺少 catalog/bundle RPC，与实测不符 | 改为能力探测表述，不绑定版本号 |
| 回归审查 | 文档测试计数滞后于实际用例数 | 更新为 1529 例 |

回归验证：全量 1529 例（1527 通过、1 既有沙箱 EPERM、1 平台跳过）；`tsc --noEmit` 0；`scripts/build.mjs` 0；新增审查回归测试 7 例。

## 7. 运行中修改设置与团队活动状态的修复（0.1.20）

用户报告：存在 active 对话时修改设置被阻止；Agent Teams 的 Lead 在工作结束后仍显示 Active。经宿主源码核对与独立验证，确认两处都是扩展侧的过度限制/错误派生，修复如下。

| 问题 | 根因 | 修复 |
|---|---|---|
| 运行中无法启停实验 bundle | `set-bundle` 分支用 `hasRunningTasks` 直接拒绝；DSH 宿主 `pluginManager/setBundleEnabled` 不检查运行状态 | 删除该客户端拒绝，只保留外部 attach-only、可写、确认与结果呈现；宿主返回 `applied`/`restart-required` 由页面如实展示 |
| 运行中无法保存 `applies=restart` 的设置 | `mutateSettings()` 对 restart namespace 加了客户端拒绝；实测三个 DSH 版本的 `applies` 恒为 `live`，该分支为死逻辑 | 删除整段拒绝，直接转发宿主并呈现结果 |
| 已结束会话仍阻塞设置 | `runtimeActivity` 只按事件更新、不随会话列表清理，已消失会话可永久置 `hasRunningTasks=true` | `loadSessions()` 收到 runtime-wide 列表后清理不在列表内且 revision 不高于快照的条目；保留飞行中事件保护 |
| Lead 工作结束后仍显示 Active | 面板把投影 `phase=active`（持久生命周期，宿主对 Lead 恒为 active）直接映射为 Running | 成员状态改为按会话 `running` 判定：Running；否则 Failed/Provisioning；其余（含 active）为 Inactive。Lead 行同规则，当前会话 running 兜底 |

保留的拦截（有意为之，非设置修改）：切换运行时/项目（会结束会话）、CLI 插件安装/更新（会重启运行时）。命令行启动的运行时切换流程不受本次修改影响。

验证：独立验证者用 4 个变异确认修复被测试捕获（恢复两处拒绝 → 3 例失败；删清理 → 1 例失败；改回 phase 映射 → 5 例失败）；DSH 0.2.1-rc.3 宿主包检索无任何运行中拒绝逻辑，Web 端 TeamMemberRow 派生方式与本次修复一致（`client.js:90-92`）。全量 1536 例（1534 通过、1 既有 EPERM、1 平台跳过）；`tsc --noEmit` 0；`scripts/build.mjs` 0。

## 8. Stop 与会话切换卡顿的修复（0.1.21）

用户报告：会话进行中点击 Stop 或切换会话可能长时间“卡住”。经宿主源码核对、单元变异与真实 rc.3 运行时探针，确认原因为客户端等待方式，宿主侧 RPC 本身为毫秒级。

| 症状 | 根因 | 修复 |
|---|---|---|
| Stop 无反馈/长时间禁用 | `stopping` 在 `await session/cancel` 之后才发布（RPC 默认超时 30 s）；确认窗口 90 s；非 running 点击也会留下确认态，且可被下一 turn 继承 | RPC 之前乐观发布 `stopping`/`cancelRequested`；仅 running 时进入；窗口缩短为 6 s，到期后停止态结束、`cancelRequested` 保留且 Stop 可再次点击（宿主取消幂等）；turn 结束/新 turn/切换/失败均正确清理 |
| 切换会话长时间 loading | `loadSession` 在 follow 快照（30 s 超时）之后串行等待模型目录 RPC（另 30 s），最坏约 60 s 不进入 ready | follow 快照超时缩短为 8 s 并给出可操作错误；模型目录移出关键路径（后台刷新）；快照超时后清理 follow/stream，可重新打开 |

保留的宿主限制：取消是协作式的，turn 在长工具调用中会等待该调用结算；无公开 RPC 可强制终止，客户端只保证及时反馈与可重试。真实运行时证据：`session/cancel` 往返 0.8–1.0 ms 且 idle 重复调用返回 `accepted`；`session/follow` 快照 1.7–4.9 ms；`session/projections` 1.2–1.8 ms。

验证：独立验证者以 5 个变异确认修复被测试捕获（删除乐观发布 → 5 例失败；90 s 窗口 → 1 例；删除 running 校验 → 1 例；models 改回串行 → 2 例；超时/错误文案相关用例）；并补充固定 8 s 数值与 Stop 三态 UI 的回归测试。全量 1544 例（1542 通过、1 既有 EPERM、1 平台跳过）；`tsc --noEmit` 0；`scripts/build.mjs` 0。

## 9. 失败响应呈现对齐 DSH（0.1.22）

用户报告插件把模型失败显示为 `Response failed` 与 `SERVER: {"error":{...}}`，难以理解。核对会话事件后确认：运行时把提供方 HTTP 错误体原样存进失败原因（`code=SERVER`，`message` 为响应体 JSON），DSH 的重试器已自动重试 3 次；DSH Web 对已知 code 有本地化文案，对未知 code 显示原始 message，并把 code 单独显示。

呈现规则对齐如下（来源：`dsh-client-ui-chat` 的 failure 渲染与本地化文案）：

| 元素 | 对齐后行为 |
|---|---|
| 标题 | `This turn failed`；`ACCOUNT_SIGNED_OUT`/`INTERRUPTED` 为 `Task stopped` |
| 已知 code 文案 | `AUTH`→API key is invalid；`QUOTA`/`ACCOUNT_QUOTA`→Request quota exhausted.；`ACCOUNT_SIGNED_OUT`/`ACCOUNT_SIGN_IN_REQUIRED` 使用 DSH 原文 |
| 未知 code | 显示原始 message，并在正文右侧以独立等宽 `code` 元素显示运行时 code（`INTERRUPTED` 不显示） |
| 数据结构 | `detail` 不再拼接 `CODE: ` 前缀；新增 `failureCode` 随消息投影、Webview 与任务详情传递 |

在 DSH 行为之外，本扩展额外将提供方 JSON 错误体解码为人类可读文本：仅当 message 是 JSON 对象且含非空 `error.message` 时，取该文本，并在 `error.code`/`error.status` 为数字时追加 ` (HTTP <n>)`；结果截断 2000 字符并经凭据脱敏。DSH 本体会原样显示 JSON，因此这是有意的信息增强，不改变未知 code 的原文回退规则。

验证：独立验证者用真实（脱敏）`turn/end` 事件完成 projector→Webview→task-details 三段断言，并以 5 个变异确认修复被测试捕获；全量 1558 例（1556 通过、1 既有 EPERM、1 平台跳过）；`tsc --noEmit` 0；`scripts/build.mjs` 0。未对齐项（既有缺口）：输出 token 上限提示行、turn 级错误行结构，留待后续。

## 10. 重试过程行与输出上限提示（0.1.23）

补齐 0.1.22 遗留的两个对齐缺口。DSH 语义核对依据 `dsh-client-ui-chat` 0.2.1-rc.3：重试节点按 `retryId` 关联（`client.js:5275-5346`、`5522-5529`、`10020-10110`），输出上限提示由 `turn/end.reason.kind === 'max-tokens'` 产生（`10565-10628`、`5377-5395`）。

| 功能 | 行为 |
|---|---|
| 重试过程行 | 每个 `retryId` 折叠为一条可展开行，显示最后一条 attempt：`Retrying model request (1/3) · 1s`（进行中）、`Retried model request`（已开始）、`Model request retry cancelled`（turn 结束时仍未开始）；上限为 `mode==='normal'` 时的 `maxRetries`，否则 `∞`；展开显示 `Retry delay: {四舍五入}ms` 与 `Failure reason:`（已知 code 优先使用 DSH 文案，未知 code 回退解码后的原因） |
| 空 attempt 抑制 | 无可见输出的失败 attempt 不再各生成一个空回复气泡；仅保留最终 attempt 的失败块。有文本的失败 attempt 仍保留（本扩展既有增强） |
| 输出上限提示 | `max-tokens` 结束的 turn 在回复后显示警告行：`Output token limit reached` + DSH 原文提示 `The reply was cut off; earlier output is preserved in the conversation. Send "continue" to let the model resume.` |
| 迟到事件 | `llm/retry-started` 缺失 retry 号、号码不匹配或链已 cancelled 时忽略；`turn/end` 后不再重新打开已取消链 |
| 行动作行 | 重试行或上限提示位于回复之后时，关闭回复的复制/评分行动作行仍保持常显（不被末项判定隐藏） |

与 DSH 的有意差异（均为实现取舍，行为语义一致）：

1. 秒数为事件时刻的静态快照（`max(1, ceil(delayMs/1000))`），不实现 DSH 的 250 ms 倒计时刷新。
2. 重试行与上限提示逐消息渲染，不复刻 DSH 的 turn-process 分组/折叠层级与合成 seq 锚点；上限提示位于内嵌行动作行之后（DSH 位于行动作行之前）。
3. 重试失败原因沿用 0.1.22 的解码与脱敏增强；DSH 重试行只显示原始 message。
4. 失败 attempt 的可见文本保留（DSH 丢弃重试 attempt 的全部流式输出）。

验证：独立验证者以真实（脱敏）重试序列完成 projector→聊天 Webview→任务详情三段断言（空 attempt 删除、单重试行、最后 attempt 状态、失败块、上限提示、行动作行可见性），7 项变异中 6 项被捕获，并补充固定「同 retry 号仅 state 变化」更新的回归用例。全量 1581 例（1579 通过、1 既有 EPERM、1 平台跳过）；`tsc --noEmit` 0；`scripts/build.mjs` 0。

## 11. 实验性插件适配审计与 Thinking 翻译（0.1.24）

用户询问“新增的实验性插件是否全适配”。审计结论：**并非全部**。按“客户端可见契约是否被消费”统计：8 个包已完整覆盖或无需专属 UI，5 个包仍有部分缺口。

| 类别 | 包 | 说明 |
|---|---|---|
| 完整/无需 UI | agent-team、agent-team-profile、session-titles、session-search、terminal（工具）、badge-skill、ralph、inspector | 侧栏已消费可见投影/工具；inspector 为 Web-only CDP，不适用于 VS Code；session-search 无专属 UI（Web 同为工具调用），仅保留双 SQLite 配置风险 |
| 本轮补齐 | cot-translation | 会话内 Thinking 翻译（见下） |
| 部分 | plugin-market、voice-input、tool-worktree、auto-review | market：仅 indexes 设置，缺 Discover/搜索/安装（RPC 齐备）；voice-input：仅设置，缺麦克风采集/设备准备/流式转写；tool-worktree：未消费 `workingDirectory` 投影（文件/审阅路径仍以项目根为基准）；auto-review：缺 “Rejected by Auto review” 专用呈现（按通用工具错误显示） |

后续优先级建议：1) plugin-market 完整闭环；2) tool-worktree `workingDirectory` 整合；3) auto-review 呈现打磨；voice-input 属最大单项新功能，建议单独立项评估。持久终端面板属基础 `terminal/*` RPC，不在这批实验包内。

### 11.1 Thinking 翻译实现（cot-translation）

翻译由客户端 RPC 驱动，运行时不会推送译文。实现路径：

1. **能力探测**：连接/会话打开/设置与凭据事件后调用 `cotTranslation/limits`（10 s，失败即视为能力不存在），读取 `maxTextChars`、`preferences.provider`、`preferences.targetLanguage` 与 `availableProviders`；`auto` 目标语言在宿主侧按 `vscode.env.language` 归一化（zh-cn→zh 等）。
2. **分片与请求**：Thinking 展开后按 DSH 算法分片（空行分段；超过上限按 UTF-16 切分，不切开代理对、尽量在空白处截断，后缀空白只用于显示）；完整且非空且未缓存的片段按消息串行请求 `cotTranslation/translate`（60 s），跨消息并发；请求携带 provider、解析后的目标语言与当前会话 id（命中宿主持久缓存）。
3. **展示**：默认显示译文；未完成片段显示原文并显示 pending spinner（aria-label “Translating reasoning”）；工具条按钮在 “View original / View translation” 间切换；失败时整段回退原文并显示 “Translation failed. Showing the original.” 与 Retry（重试从第一个未缓存片段继续）。`availableProviders` 只用于设置表单标注，不阻止请求（与 DSH 一致）；provider 调用失败由上述失败态呈现。
4. **缓存与清理**：片段译文按文本缓存；provider/目标语言/上限变化时清空；会话切换、消息移除与断连时清理在途请求状态。

已知差异（有意）：译文按纯文本渲染（侧栏既有 reasoning 为纯文本，XSS 安全）；折叠 Thinking 不取消在途请求（结果入缓存，避免重复请求）；`auto` 语言可解析出 zh/en 之外的标签（DSH 内置仅 zh/en）；固定 60 s 超时替代取消式等待。

验证：独立验证者以真实运行时完成 `limits`/`translate` 实测（Bing 返回中文译文、Google 在本机失败），并以真实 limits 值与真实译文完成宿主→Webview 边界 E2E（三段逐段替换、toggle、失败→Retry、会话切换清理），7 项变异全部被捕获。全量 1618 例（1616 通过、1 既有 EPERM、1 平台跳过，115 个测试文件）；`tsc --noEmit` 0；`scripts/build.mjs` 0。

## 12. Auto review 拒绝的专用呈现（0.1.25）

此前 Auto review 拒绝一次工具调用时，侧栏把 `AUTO_REVIEW_DENIED` 当普通工具失败显示原始错误文本。DSH 的客户端对该事实有专用文案，本轮补齐。

| 环节 | 行为 |
|---|---|
| 事件识别 | `tool/result` 的 `data.error` 为 `{ name: 'AutoReviewDeniedError', code: 'AUTO_REVIEW_DENIED', reason?: string }` 时识别为拒绝；其它错误码/仅 `isError` 仍按普通工具失败 |
| 投影 | `ConversationMessage.autoReviewDenied = { reason: string \| null }`（reason 去空白后为空则 null）；`failed=true`、`detail='Rejected by Auto review'`，原始结果文本仍保留供诊断 |
| 工具卡 | 折叠行状态显示 `Rejected by Auto review`（标题仍是工具名/参数摘要）；展开显示 `Tool was not executed. Reason: {reason}`，无原因时 `Auto review did not authorize this action`；不展示原始错误文本；details 保持可折叠、失败时默认展开 |
| 任务详情 | 同一文案替换原始输出（纯文本渲染） |
| 审批提示 | `approval/requested` 的 `displayReason.en` 优先作为提示文案（Auto review 的 ask 路径会给出本地化原因），缺失或形状非法时回退 `reason` |
| 安全 | 原因与文案全部经 textContent 渲染；迟到的原因更新触发重渲染，不残留旧原因 |

与 DSH 的差异（有意/已知）：未实现审批面板的来源徽标（DSH 也只显示本地化 displayReason 文案）；拒绝与审批的真实端到端路径仍需模型凭据，当前覆盖到契约与事件级。其余文案（`Rejected by Auto review`、`Tool was not executed. Reason: …`、fallback）与 DSH en locale 逐字一致。

验证：独立验证者以真实 wire 形状事件完成 projector→Webview→任务详情 E2E，并对 6 处实现做变异验证；全量 1649 例（1647 通过、1 既有 EPERM、1 平台跳过，117 个测试文件）；`tsc --noEmit` 0；`scripts/build.mjs` 0。
