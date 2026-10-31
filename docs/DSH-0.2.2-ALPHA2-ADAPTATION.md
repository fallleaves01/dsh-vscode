# DSH 0.2.2-alpha.2 适配记录

- 适配对象：DSH Sidebar `0.2.2-alpha.2` 源码。
- 运行时基线：官方 DeepSeek Harness `0.2.2-alpha.2` 全局安装副本（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`）。
- 对照基线：`0.2.1-rc.3`（`/tmp/dsh-rc3`）与 `0.2.1-rc.2` 生成契约；`0.2.0-rc.2`、`0.1.7-rc.1/rc.2` 为更早的验证记录。
- 隔离环境：独立 `HOME`、`DSH_HOME`、`DSH_AGENTS_HOME`，`--host 127.0.0.1 --port 0 --no-open`；不访问用户默认 DSH home，不连接外部服务。
- 证据方法：包级/typert 描述符 diff、真实 HTTP/WS RPC 探针、真实 `session/follow` 与图片读取、隔离 alpha.2 与 rc.3 双基线回归、全量单元测试与 `tsc`/构建、独立对抗审查与隐私审计。

## 1. 结论

`0.2.2-alpha.2` 的协议变化以加法为主，没有删除或改写侧栏依赖的 RPC 方法。适配后，同一份请求路径同时兼容 `0.2.2-alpha.2`、`0.2.1-rc.2` 与 `0.2.1-rc.3`：

| 变化 | 适配方式 | 旧宿主行为 |
|---|---|---|
| `session/follow` 新增 `activate?: boolean`（alpha.2 省略即 passive） | 请求固定携带 `activate: true`（超集字段） | 网关非严格解码剥离未知字段；旧宿主仍自动激活，行为不变 |
| `session/attachment` 请求由 `{sessionId, attachmentId}` 改为 `{sessionId, attachment: ImageAttachmentRef}` | 同一请求同时携带 `attachmentId` 与完整 `attachment`（含 `bytes`、尺寸、原始尺寸） | 旧宿主读取 `attachmentId` 并剥离嵌套字段 |
| `session/fork` 子会话不再写 `parentSession` meta | 侧栏本来就只用 `origin === 'subagent'` 判定子代理血缘；fork 子会话继续作为独立会话 | rc.3 历史 fork 即使带 `parentSession` 也不会被嵌套 |
| 新增 `llm/models-updated`、`plugin-manager/update-state` 转发事件 | 映射为既有的 `host/models-changed` / `host/plugins-changed` 失效通知；不转发 payload | 旧宿主不发送这些事件 |
| BundleInfo/ChangeResult 新字段（`listedByDefault`、`updatable`、`failedAt`、`unsupported-platform`） | 类型与插件页投影新增字段；`listedByDefault:false` 的 bundle 仍可切换（`setBundleEnabled` 接受）；仅 on-demand 未安装 bundle 无开关；页面不显示 `Updatable` 文案（`updatable` 仅投影保留），`failedAt` 仅类型保留；平台不支持在状态行提示 | 旧字段缺省时按原有行为显示 |
| 新增 optional bundle（liveshare、forge、CUA、personalized recommendations） | 只作为运行时 bundle 行出现；侧栏不实现其 Web 面板；未知投影/事件安全忽略 | 无影响 |
| Background jobs 管理界面（`dsh-client-ui-jobs` / `dsh-api-job-controller`） | **完成**：Running/Finished 分组、Finished 本地 Clear、live `progress`/duration、`job/follow` 行内有界输出（gap/error 提示、Copy command）、Stop 两击状态机（armed/pending/failed 内联）、Escape 关闭并回焦、Project/This chat 两档；`JobItem` 投影 `progress`、`outputTotal`、`outputEarliest`；Project 档可观察其他已知会话的 job | 运行时不提供 jobs 服务时不显示菜单；未知 job 或已断连 runtime 报 "background task is no longer available"；旧宿主无该 UI |
| CLI 预发布版本 | `--no-open` 版本解析接受 `alpha`/`beta`/build metadata；`0.1.0` 的 `rc.8` 阈值保持 | 旧版本解析行为不变 |
| alpha CLI 要求 Node.js `>= 24.9.0` | 文档说明；扩展宿主自身的 Node 版本要求不变 | 不适用 |

## 2. 代码触点

- `src/launch.ts`：通用 SemVer 预发布解析，`0.2.2-alpha.2`/`-beta`/build 正确追加 `--no-open`。
- `src/dsh-session-feed.ts`：`session/follow` 请求携带 `activate: true`；模型/插件失效事件映射。
- `src/dsh-client.ts`：`ImageAttachmentRef` 与双代超集附件请求；bundle 新字段类型。
- `src/conversation.ts`：图片投影保留 `bytes`/`originalDimensions`（alpha.2 附件校验需要）。
- `src/extension.ts`：完整图片引用传给 `hydrateImages`；bytes 缺失时脱敏诊断并允许单图失败；bundle 字段透传。
- `src/settings-page-state.ts`、`src/settings-page.mts`、`src/settings-panel.ts`：bundle 新字段投影、开关可见性、平台不支持/未安装说明。
- `src/jobs.ts`：`JobItem` 投影 `progress`、`outputTotal`、`outputEarliest`；`src/extension.ts`：`killJob` 去重、`openJobOutput`/`closeJobOutput` 的 `job/follow` 生命周期与 Project 已知 job 校验；`src/webview.ts`：Background jobs 菜单、分组/Clear、行内输出、两击 Stop、Escape 回焦。

## 3. 验证记录

- 全量测试：本轮 jobs/隐私修复后 123 个文件、1919 passed / 1 skipped / 0 failed；`tsc --noEmit` 与 `node scripts/build.mjs` 通过。
- 真实 alpha.2：冷/热会话打开、`session/follow` 成功、prompt 完成、停止/取消、fork（无/有 atSeq）、pin/archive、Agent Teams、live title、translation、permission presets 均通过，0 客户端错误。
- 真实 rc.3：同一超集请求通过（`activate` 被剥离、旧 `attachmentId` 有效），无严格解码拒绝。
- 附件：alpha.2 对完整引用（含 `bytes`）成功读取真实 PNG；无 bytes 的旧引用返回 `gateway/input-invalid`，侧栏按单图 "Image unavailable." 处理并记录脱敏诊断，不崩溃。
- Bundle：alpha.2 24 个（16 optional、2 个 on-demand missing），rc.3 20 个；开关可见性/说明与字段投影通过。
- 性能：隔离基准显示启动主要由 DSH 进程 URL 就绪（1.3–1.5 s）支配；本次扩展侧优化覆盖版本缓存、去除重复 contract probe、事件流与首屏列表并发、延迟 sweep/job 扫描、幂等视图复用、切换 RPC 收敛、隐藏会话目录不渲染与无关状态补丁不重绘。A/B 详见提交记录与构建说明。
- 修复复验：`listedByDefault:false` 的 hidden bundle 开关恢复（仅 on-demand 未安装项无开关）、过期 `0.2.1-rc.3` 文案更正、不可达 `Updatable` 标签移除、Auto review `displayReason` 按编辑器语言选择；定向 settings/extension-surface 测试与全量回归通过。
- Background jobs 复验：`tests/webview-jobs.spec.ts` 覆盖 Running/Finished 分组、默认折叠、Clear、progress/duration、Copy command、gap/error、二击 Stop 的 armed/pending/failed、Escape 回焦；`tests/discovery-controller.spec.ts` 覆盖 Project 档观察其他会话已知 job、未知 job/断连错误；全量回归通过。

## 4. 限制与残余

- 未在真实 VS Code 扩展宿主中采集完整启动墙钟 A/B；启动收益由隔离运行时 RPC 计数、单测和真实冒烟交叉验证。
- alpha.2 对缺少 `bytes` 的旧附件引用严格拒绝；这类历史图片只能显示失败占位，不能恢复（信息缺失，非侧栏可修复）。
- `llm/models-updated` 的真实触发路径未在本次探针中复现；映射由单元测试覆盖。
- 新 Web-first optional bundle（liveshare、forge、CUA、personalized recommendations）没有 VS Code 侧栏面板；它们只会出现在插件清单中。
- fork 子会话不再携带 `parentSession`，标题是它与源会话的主要可见区分；侧栏不额外重命名。
- 浏览器滚动锚定/`content-visibility` 未在真实 Chromium 中验证；当前采用低风险的渲染跳过方案。
- Web 面板未实现：Live Share、Forge、Computer Use、personalized recommendations、Statistics、creation/file-drag/plugin recommendations。
- action card 提议仅以通用工具卡显示，无卡片按钮；引用消息按 Markdown blockquote 显示，无选中引用控件。
- 未实现插件详情/版本/升级（`readBundleDetail`/`listVersions`/`updateBundle`）与市场条目详情（`readEntryDetail`）；on-demand 未安装 bundle 无开关。
- Web 外观/默认设置不适用：`ui-*`、`locale`、`ui-chat`（含 `foldedReplies`）、`agent-default-model`、`permission.defaultPreset`；模型 badge 不显示。
- `AUTO_REVIEW_FAILED` 按普通工具失败呈现；缺少 `bytes` 的旧图片引用无法读取；PTC 嵌套 `tool/ptc-dispatch` 明细不单独显示。
- 跨窗口 feedback 缓存的失效、schedule 缓存的会话集合过滤、延迟 markRead 的失败回滚等列为后续 Low 项。

## 5. 已知缺口（未实现，来自 2026-10-31 扫描）

下表是 DSH Web 已有、但本侧栏**未实现**的管理交互；与上文已完成的 Background jobs 菜单区分。证据来自 SCAN-C（`artifacts/team/dsh-ui-feature-inventory.md`）与 SCAN-B（`artifacts/team/jobs-extension-map.md`），DSH 基线为 `0.2.2-alpha.2`。

| 缺口 | DSH 侧证据/行为 | 本扩展现状 |
|---|---|---|
| Schedule 任务删除 | `dsh-client-ui-schedule`：reminder 行/详情 `Delete task` → `Delete this task?` 确认；`schedule/delete({sessionId,id})`（`dsh-schedule/lib/typert.host.js`） | 侧栏仅目录与投递历史，无删除按钮；客户端只调用 `schedule/catalog` |
| Schedule 批量清理 inactive | 同一包：`Clear inactive tasks ({count})?`、`Clear tasks`/`Cancel`，调用 `schedule/deleteInactive()` 并读回 catalog | 无清理入口 |
| 运行中会话“停止并归档” | `dsh-client-ui-workspace`：归档被拒后 Modal `Stop and archive this session?`，列出 turn/subagent/job/schedule，确认后 `workspace/archiveSession({stopActivity:true})` | 菜单在 running 时禁用归档并提示先停止；无停止并归档流程 |
| 通用 slash command 风险门控 | `dsh-client-ui-commands`：命令选项携带 `RiskConfirmation`，acknowledge 复选框未勾选不可确认；Host 选项透传 | 仅 `/permission auto`/Full access 的专用确认；无通用命令选项/风险门控 |
| Task Details 命令栏/完整保留输出 | `dsh-client-ui-jobs`：TerminalBlock `command=job.label`、`copyText=job.label`、`spillPaths`/完整输出入口 | 行内 Background jobs 面板已有 Copy command；独立 Task Details 仍无命令行栏、无 spill/full-output 链接，Copy output 仅为有界尾部 |
| Live Share 停止分享确认 | `dsh-experimental-liveshare`：`Stop sharing?` + acknowledge，停止 relay | Live Share 面板整体 Web-only，未实现 |
| Forge 合并确认 | `dsh-experimental-client-ui-forge`：merge/squash/rebase 后 `Confirm merge`，head SHA 变化需重新确认 | Forge 面板整体 Web-only，未实现 |

## 6. 兼容性

`0.2.2-alpha.2` 不是最低要求。侧栏的版本下限仍为 `0.1.2-rc.1`；`0.2.1-rc.2`、`0.2.1-rc.3` 与 `0.2.2-alpha.2` 使用同一套超集请求与能力探测。实验性 bundle 仍由 runtime profile 决定是否启用，侧栏不代为启用。
