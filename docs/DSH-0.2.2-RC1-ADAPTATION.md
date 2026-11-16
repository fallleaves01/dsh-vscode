# DSH 0.2.2-rc.1 适配记录（侧栏 0.2.2-rc.1.4）

## 0. 元数据

| 项目 | 值 |
|---|---|
| 文档日期 | 2026-11-05（Asia/Shanghai） |
| 适配对象 | DSH Sidebar 源码 `0.2.2-rc.1.4`（`package.json:6`） |
| 运行时基线 | 官方 DeepSeek Harness `0.2.2-rc.1` |
| 仓库 HEAD | `8ff45ab`（`docs: declare automated deepseek-flash maintenance`）；本轮改动位于工作树，尚未提交 |
| 工作树改动 | 7 个 `src/` 文件、8 个 spec 文件与 1 个 fixture（本轮实现）；6 个文档与版本文件（含本记录） |
| 证据方法 | npm/GitHub 版本核验、rc.1 发布说明分类映射、rc.1 安装树契约类型阅读、工作树代码审查、定向与全量单元测试、`tsc --noEmit`、构建脚本 |
| 写入边界 | 本记录写入 `docs/`；不修改 `src/`、`tests/`、`artifacts/`；不执行 git 写操作 |
| 关联分析 | `artifacts/team/maintenance-2026-11-05/version-feature-map.md`、`gap-map.md`（工作区分析产物，不随仓库提交） |

本记录使用以下缩写：**rc.1** 指 DeepSeek Harness `0.2.2-rc.1`；**侧栏**指本 VS Code 扩展；**Webview** 指 `src/webview.ts` 生成的聊天面板前端；**宿主**指 VS Code 扩展宿主。

## 1. 结论

1. **版本无漂移。** rc.1 仍是 DeepSeek Harness 的最新候选版本，与仓库运行时基线相同；本轮不要求升级 runtime，也不要求协议迁移。
2. **本轮适配三项 rc.1 能力。** A：会话完整历史导出（复制为 Markdown）；E：会话搜索的会话 ID 大小写不敏感子串匹配；B：第三方插件包版本检查与更新。A 复用运行时的只读 HTTP 导出路由，B 复用 `pluginManager/listVersions` 与 `pluginManager/updateBundle`，二者均不改变侧栏已依赖的 wire 契约。
3. **验证边界明确。** 新增的 HTTP 导出路由与两个 plugin-manager 方法只在单元测试的 HTTP mock 层验证，并由字段白名单测试覆盖脱敏后的完整 packet；本轮未对真实 DSH runtime 执行端到端运行，也未在真实 VS Code 扩展宿主中手工冒烟。全量单元测试、`tsc --noEmit` 与构建通过。
4. **文档陈旧项已修正。** README、中文 README 与 Marketplace README 不再把 `listVersions`/`updateBundle`、Schedule 任务删除与清除已结束任务、引用文本插入描述为未实现；插件详情文档与市场条目详情仍列为未实现。

## 2. 版本核验证据

### 2.1 npm

```console
$ npm --cache /tmp/dsh-npm-cache view @deepseek-ai/dsh dist-tags --json
{ "next": "0.2.2-rc.1", "latest": "0.2.1-rc.5", "alpha": "0.2.2-alpha.3" }

$ npm --cache /tmp/dsh-npm-cache view @deepseek-ai/dsh time --json | tail -4
  "0.2.2-alpha.2": "2026-10-27T19:10:28.529Z",
  "0.2.1-rc.5": "2026-10-29T14:15:23.355Z",
  "0.2.2-alpha.3": "2026-11-03T07:48:26.202Z",
  "0.2.2-rc.1": "2026-11-04T09:20:32.310Z"
```

### 2.2 GitHub

```console
$ curl -s "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=3"
# 首条：tag_name=dsh-v0.2.2-rc.1  prerelease=true  published_at=2026-11-04T13:07:14Z
# 其余：dsh-v0.2.2-alpha.3、dsh-v0.2.1-rc.5，均早于 rc.1

$ curl -s "https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=5"
# 首项：dsh-v0.2.2-rc.1；无 0.2.2-rc.2 或更高版本
```

### 2.3 判定

| 问题 | 判定 |
|---|---|
| 最新 rc | `0.2.2-rc.1`（npm `next`、GitHub release 与 tags 三处一致） |
| 发布时间 | npm `2026-11-04T09:20:32.310Z`；GitHub release `2026-11-04T13:07:14Z` |
| 是否晚于仓库基线 | 否，两者相同；无 rc.2 或更高预发布版本 |
| 侧栏版本关系 | `0.2.2-rc.1.3` → `0.2.2-rc.1.4` 为侧栏自身版本号，其运行时基线始终为 rc.1；两者不可直接比较大小 |
| 是否要求 runtime 升级 | 否 |

以上命令于 2026-11-05T14:50+08:00 复核，与 task-1 报告（2026-11-05T14:29–14:32+08:00）结论一致。

## 3. rc.1 功能面映射摘要

rc.1 发布说明（GitHub release `dsh-v0.2.2-rc.1`，body 27,671 字符）共 73 条，按侧栏相关性分类如下：

| 发布说明节 | 条目数 | A 侧栏直接相关 | B Web-UI 专属 | C runtime/CLI/桌面 | D 协议/契约 |
|---|---|---|---|---|---|
| 新增功能 | 13 | 4 | 8 | 1 | 0 |
| 体验优化 | 31 | 5 | 17 | 8 | 1 |
| 其他变更 | 29 | 1 | 3 | 20 | 5 |
| 合计 | 73 | 10 | 28 | 29 | 6 |

A 类 10 条的覆盖状态：

| A 类条目 | 状态 | 依据或去向 |
|---|---|---|
| 聊天文本作为引用插入输入框 | 已覆盖 | 0.2.2-alpha.2.7 实现 `Quote text` 与 `src/quote-text.mts` |
| 完整历史会话复制为 Markdown | **本轮实现** | 第 4.1 节 |
| 工作步骤收起后保留助手回复 / 仅最终回答 | 未实施 | 需 transcript 分组渲染，列第 7 节 |
| 第三方插件包更新（失败回滚） | **本轮实现** | 第 4.3 节 |
| 侧栏会话悬浮卡显示工作目录 | 未实施 | `SessionSummary.cwd` 已投影，UI 未消费，列第 7 节 |
| 会话搜索不区分大小写会话 ID 子串 | **本轮实现** | 第 4.2 节 |
| 宿主确认接收后显示消息并清空草稿 | 已覆盖 | 既有 `acknowledgeDraft`/`restoreDraft` 路径 |
| 图片进入输入框即上传、单图上限 50 MiB | 部分覆盖 | 发送时内联；本地上限 32 MiB，列第 7 节 |
| 自动化任务页一次清除已结束任务 | 已覆盖 | 0.2.2-alpha.3.2 的 **Delete ended** |
| 自动化任务宿主级统一管理 | 部分覆盖 | 创建/编辑/暂停/删除已实现；预填提示与会话复用语义待核 |

统计：本轮新增 3 条，既有已覆盖 3 条，部分覆盖 2 条，未实施 2 条。B 类 28 条不复制 Web 外壳；C 类 29 条随 runtime 升级生效；D 类 6 条为插件/SDK 契约，侧栏未消费，仅作回归观察。

## 4. 本轮实施

### 4.1 A：会话复制为 Markdown

行为：会话动作菜单在 **Copy Session ID** 之后新增 **Copy Session as Markdown**。该操作仅在本窗口中打开的会话未归档时可用；其他行禁用并提示先打开会话。宿主依次校验会话属于当前 `sessions` 或 `archivedSessions`、读取运行时导出、写入剪贴板，然后由 Webview 显示 **Session copied as Markdown.**。导出由运行时格式化，包含 runtime 提供的原始日志路径，并覆盖本窗口未加载的历史，因此不等价于已加载转录窗口。

失败映射：

| 条件 | 用户可见文案 |
|---|---|
| 路由 404（旧 runtime 或非 Web profile） | This runtime does not support session Markdown export. |
| 401/403（认证过期） | DSH authentication expired. Reconnect the runtime and try again. |
| 响应超过 32 MiB 或非 Markdown | The session could not be copied as Markdown. Try again. |
| 剪贴板写入失败 | The clipboard is unavailable. |
| 会话不在当前列表 | This conversation is no longer available. |

代码触点：`src/dsh-connection.ts`（`MAX_SESSION_MARKDOWN_BYTES`、`readSessionMarkdown`：会话 ID 字符集校验、`GET /api/session.markdown?sessionId=…`、`redirect: manual`、认证 cookie、30 s 超时、content-type 校验、32 MiB 上限、404→`session-export-unavailable`、401/403→`authentication-required`）；`src/dsh-client.ts`（`sessionMarkdown`）；`src/extension.ts`（`copySessionAsMarkdown`、`sessionMarkdownFailureText`、`sessionMarkdownFailureClass`、`copy-session-markdown` 消息分发）；`src/webview.ts`（菜单项与 `session-notice` 宿主通知）。测试：`tests/dsh-connection.spec.ts`（路由、cookie、content-type、404/500 分类、超限、非法会话 ID）、`tests/extension-surface.spec.ts`（成功、列表外会话、剪贴板不可用）、`tests/webview-sessions.spec.ts`（菜单标签顺序、非当前行与归档行禁用）。

### 4.2 E：会话 ID 子串搜索

行为：目录本地过滤由“仅标题”改为“标题或会话 ID 的大小写不敏感子串匹配”；`query` 已统一小写化，合并与去重逻辑不变，仍为每条会话一行。代码触点：`src/webview.ts` 的 `matchesQuery` 与 `matching` 过滤。测试：`tests/webview-sessions.spec.ts` 新增会话 ID 子串用例，并保留标题与正文命中行为。

### 4.3 B：第三方插件包更新

行为：设置页 Plugins 区新增 **Third-party bundles**，仅列出 `updatable === true` 且 `installed === true` 的 bundle。**Check for updates** 经 `pluginManager/listVersions` 读取版本列表，显示版本号、发布时间、预发布、弃用与不兼容标记；不显示 registry URL、`attempts`、原始原因、`diagnostic` 或 `packageResult`/`logPath`。按 rc.1 契约，`PluginVersion.incompatible` 是单个 `IncompatiblePlugin{name, version, runtimeVersion, requirements}` 对象而非数组；侧栏 UI 只显示 name/version/runtimeVersion，`requirements` 在设置页投影层丢弃，不进入 Webview。已发布版本若 `bundle === false`（未声明 `dsh.bundle`），不能替换已安装 bundle，UI 将其显示为禁用并说明原因。选定版本后弹出模态确认，说明共享 web profile、使用该 profile 的其他窗口、HMR 期间插件可能停止、失败时尝试重装旧版本与网络要求。

更新经 `pluginManager/updateBundle` 提交；`step` 表示最后执行的步骤：`check`（目标检查失败，bundle 未改动）、`remove`（旧版本移除失败或取消，旧版本仍在）、`install`（安装结果；仅 HMR 路径在移除旧版后失败或取消时才出现 `restore` 恢复重装）。结果映射为五类：更新成功（updated）、需重启（restart-required）、失败且旧版本已恢复（restored）、失败且旧版本未恢复（unrestored，仅当 `restore.application` 为 `failed`/`cancelled` 时出现）、以及未改变（unchanged：更新未被接受且已安装版本保持原样）。unchanged 覆盖三种情况：`step=check` 的目标检查被拒、`step=remove` 的旧版本移除失败或取消、以及 `step=install` 且无 `restore` 的非 HMR 安装失败（旧版本仍在）。“旧版本无法恢复”告警只用于真正执行过恢复重装且该重装失败的 unrestored 路径。attach-only 外部 runtime 与只读 profile 在写前拒绝；只有最近一次列表中的版本可被安装。

代码触点：`src/dsh-client.ts`（`DshIncompatiblePlugin`、`DshBundleVersion`、`DshBundleVersionList`、`DshBundleUpdateOptions`、`DshBundleUpdateResult`、`incompatiblePluginOf`（单对象解码、requirements 有界并过滤原型键）、`bundleVersionText`（允许目标检查被拒时的空 `from`）、`listBundleVersions`、`updateBundle`（`step` 仅接受 check/remove/install），含字段白名单与长度/字符集校验）；`src/settings-page-state.ts`（`BundleVersionView`、`BundleVersionListView`、`publicBundleVersions`：单对象 incompatible 仅保留 name/version/runtimeVersion、`requirements` 与旧数组形状丢弃、`bundle` 标记、去重、上限 100、未知字段丢弃）；`src/settings-page.mts`（`renderThirdPartyBundles`、`receivedBundleVersions`、`bundle === false` 版本禁用行、`bundleUpdateCopy` 的五类文案与三种 unchanged 子文案、取消与结果状态）；`src/settings-panel.ts`（`check-bundle-versions` 与 `update-bundle` 处理、`bundleVersionFailure`、模态确认、`runtimeIsOurs`、`requireWrite`、`step` 分流、unchanged 的三条路径、`restore` 存在性判定、仅允许最近一次列表中的版本、`refresh(true)`）。测试：`tests/dsh-client.spec.ts`（解码层 12 个执行用例）、`tests/settings-page-state.spec.ts`、`tests/settings-page.spec.ts`、`tests/settings-panel.spec.ts`、`tests/settings-page.fixture.ts`。

### 4.4 版本与文档

`package.json` 版本改为 `0.2.2-rc.1.4`；`CHANGELOG.md` 新增 `[0.2.2-rc.1.4] - 2026-11-05`（Added/Changed/Fixed）；README、README.zh 与 README.marketplace 同步版本号并新增本版本说明；三份 README 的陈旧未实现清单按第 1 节第 4 条修正。

## 5. 隐私与安全设计

1. **导出内容只进剪贴板。** Markdown 不写入 Webview 状态、Output 通道、临时文件或遥测；失败时只返回固定分类文案，Output 通道仅记录白名单短分类（`[session-markdown] copy failed (not-supported|authentication|invalid-session-id|invalid-response|http|transport|cancelled|unknown)`），因此响应体、本机路径与异常原文不会外泄。
2. **导出输入与响应有界。** 会话 ID 仅接受 `^[A-Za-z0-9_-]{1,256}$`；响应要求 `text/markdown` content-type，声明长度与实际读取均受 32 MiB 限制；`redirect: manual` 防止重定向到非预期端点；404 直接降级为“不支持”，不回退到不完整内容。
3. **版本投影白名单化。** 两个 plugin-manager 结果在客户端与设置页投影层各做一次白名单化：版本行只保留版本号、发布时间（正则形状与长度上限）、tags、prerelease、deprecated、`bundle` 与单个 incompatible 对象（name/version/runtimeVersion），列表只保留 installed/versions/omitted，更新结果只保留 from/to/step 与 `result`/`restore` 的 `application`、`restartReason`、stage、`failedAt` 与短错误码；registry URL、attempts/原始 reason、diagnostic、packageResult、日志路径以及 incompatible 的 `requirements` 均被丢弃，不进入 Webview。新增的版本文本在渲染时经 `textContent` 消费并按字段截断。
4. **写路径守卫完整。** `check-bundle-versions` 与 `update-bundle` 均先经 `runtimeIsOurs`（attach-only 拒绝）与 `requireWrite()`；bundle 必须属于当前 `bundles` 且 `updatable`；更新版本必须存在于该 bundle 最近一次成功的版本列表，伪造/过期版本在写入前拒绝；确认取消不写；`step=check`/`step=remove` 与无 `restore` 的安装失败只报告 unchanged，不声称恢复失败；更新后调用 `refresh(true)` 并重读 roster。
5. **不新增数据外传面。** 会话 ID 搜索为纯客户端过滤；导出为运行时既有的只读 HTTP 面；更新由用户显式触发，不轮询 registry。

## 6. 验证记录

### 6.1 本轮命令与结果（2026-11-05T15:09–15:11+08:00，修复后最终值）

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 通过（退出码 0） |
| `node scripts/build.mjs` | 通过；输出 `dist/extension.js`、`dist/runtime-host.js` 与 Webview bundles |
| `CI=true npx vitest run --config vitest.config.ts` | **130 个测试文件通过；2470 passed / 1 skipped / 0 failed**（2471 个用例） |
| 定向 `vitest run`（`dsh-client`、`settings-page-state`、`settings-page`、`settings-panel` 四个 spec） | **4 个测试文件通过；296 passed / 0 failed** |

### 6.2 本轮测试增量

按 `git diff --name-only tests/` 统计，本轮改动覆盖 8 个 spec 文件与 1 个 fixture（`tests/settings-page.fixture.ts`，为新区块提供测试夹具）。8 个 spec 文件共新增 55 个 `it` 声明（其中 7 个为 `it.each` 参数化声明），并更新既有断言（会话菜单标签数组、设置页 `Updatable` 断言等）。其中解码层 `tests/dsh-client.spec.ts` 新增 9 个声明、12 个执行用例（1 个 `it.each` 展开 4 例）。覆盖主题：导出路由的 URL/查询参数/cookie、content-type 与会话 ID 校验、404/500 分类、32 MiB 超限；成功写剪贴板与通知、列表外会话忽略、剪贴板不可用；导出投影白名单与长度上限、版本列表去重与分页上限；第三方区块出现条件、只读与 attach-only 拒绝、确认取消、五类更新结果与 unchanged 三种子情况、单对象 incompatible（`requirements` 不进入 Webview）、`bundle === false` 版本禁用、`updateBundle.step` 的 check/remove/install 分流；会话 ID 子串搜索。

### 6.3 验证边界

- 导出路由与 plugin-manager 方法均在 HTTP mock 层验证（`fetch` stub 与客户端 stub），未连接真实 DSH runtime。
- `PluginVersion.incompatible` 的单对象形状、`bundle` 标记与 `updateBundle.step` 的 check/remove/install 分流由解码层、设置页投影与设置面板的单元测试覆盖，并与 rc.1 安装树契约证据交叉核对：`@deepseek-ai/dsh-plugin-manager/lib/types/types.d.ts`（`IncompatiblePlugin` 单对象、`PluginVersion.incompatible` 单对象、`PluginUpdateResult` 的 step 与 restore 语义）、同包 `lib/typert.host.js`（`pluginManager/listVersions`/`updateBundle` 的 Host 描述符）与 `@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`（官方 Web UI 对 check/remove/install 与 restore/kept 分支的结果呈现）。
- 未在真实 VS Code 扩展宿主中执行手工操作冒烟；设置页新区块由 DOM 级单元测试覆盖，本轮未运行 `tests/settings-page.browser.mjs` 等 Chromium 浏览器检查。
- rc.1 参考实现（`/tmp/dsh-rc1-full`）用于确认路由与 RPC 名称；参考树本身未在本轮重新安装或探针复算。
- 全量数字以本记录写入时的本地运行为准；提交前由 Lead 复跑，若并发运行引起计数波动，以提交前最后一次成功运行为准。

## 7. 残余与后续

| 未实施项 | 不实施或延后原因 | 规模 |
|---|---|---|
| 图片进入输入框即上传、单图上限对齐 50 MiB | 附件流水线回归面大，且放宽上限前必须用 40–50 MiB 图片做 Webview、宿主与 HTTP 通道端到端探针 | M–L |
| 工作步骤收起后保留助手回复 / 仅最终回答切换 | 需要 transcript 分组渲染与偏好存储，触及增量渲染、引用与复制交互 | L |
| 会话悬浮卡显示工作目录 | 需先在 `SessionItem` 投影补 `cwd`，再实现悬浮卡与无障碍名称 | S |
| 聊天文件链接的行范围终点 | `parseFileLink` 目前只返回起始行；需扩展消息形状与编辑器选区 | S |
| `pluginManager/readBundleDetail` 插件详情文档 | 富文本详情属 Web 插件页布局，侧栏投影为精简卡片 | S–M |
| `pluginMarket/readEntryDetail` 市场条目详情 | 市场发现/搜索/安装本身尚未实现，详情属同一后续面 | M |
| Live Share、Forge、Computer Use、个性化推荐、统计面板 | Web 专属面板，侧栏不复刻；仅保留 bundle 行与通用工具卡 | XL（不排期） |
| 统一右键菜单与内嵌文件树 | VS Code 原生菜单、Explorer 与编辑器已提供等价能力，有意不做 | 不适用 |
| WebSocket 压缩 | 端点限定 `127.0.0.1`，带宽收益低；建议先测量再决策 | S（先测量） |

建议后续顺序：先完成 S 规模的会话悬浮卡工作目录与文件链接行范围终点；再评估插件详情/市场条目详情；图片即时上传与 50 MiB 对齐需先完成隔离 runtime 探针；工作步骤折叠留待独立渲染轮次。

## 8. 证据索引

| 证据 | 位置 |
|---|---|
| 本轮实现差异 | `git diff`（相对 HEAD `8ff45ab`）：7 个 `src/` 文件、8 个 spec 文件与 1 个 fixture |
| 导出连接层 | `src/dsh-connection.ts:14`、`:235` |
| 导出客户端封装 | `src/dsh-client.ts:1062` |
| 导出宿主动作 | `src/extension.ts:383`、`:395`、`:1895`、`:5526` |
| 菜单与搜索过滤 | `src/webview.ts:1460`、`:1572` |
| 插件版本解码与 RPC | `src/dsh-client.ts:313`、`:324`、`:370`、`:408`、`:424`、`:441`、`:457`、`:475`、`:1093`、`:1108` |
| 版本投影 | `src/settings-page-state.ts:138`、`:166` |
| 版本 UI 与结果文案 | `src/settings-page.mts:539`、`:564`、`:590` |
| 版本写路径与确认 | `src/settings-panel.ts:42`、`:283`、`:305`、`:342` |
| rc.1 插件更新契约 | `/tmp/dsh-rc1-full/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/types.d.ts`（`IncompatiblePlugin` 31-38、`PluginVersion` 235-249、`PluginUpdateResult` 289-300）；同包 `lib/typert.host.js`；`dsh-client-ui-plugin-manager/lib/client.js:4894-4930`（官方 UI 结果分支） |
| 版本核验原始报告 | `artifacts/team/maintenance-2026-11-05/version-feature-map.md`（第 2、3 节） |
| 功能面映射原始报告 | 同上第 3 节；`gap-map.md` 第 2–6 节 |
| 历史适配记录 | `docs/DSH-0.2.2-ALPHA2-ADAPTATION.md`、`docs/DSH-0.2.1-RC3-ADAPTATION.md` |

## 9. 维护轮次 2026-11-06（侧栏 0.2.2-rc.1.5）

### 9.1 版本核验

| 项目 | 值 |
|---|---|
| 核验日期 | 2026-11-06（Asia/Shanghai） |
| 本轮 npm 复核 | `npm --cache /tmp/dsh-npm-cache view @deepseek-ai/dsh dist-tags --json` → `{"latest":"0.2.2-rc.1","alpha":"0.2.2-alpha.3","next":"0.2.2-rc.1"}` |
| npm 发布时间 | `0.2.2-rc.1` = 2026-11-04T09:20:32.310Z（未变） |
| packument `time.modified` | 2026-11-05T13:21:52.829Z（2026-11-05 21:21:52 +08:00） |
| GitHub Release | `dsh-v0.2.2-rc.1`，published_at 2026-11-04T13:07:14Z（未变） |
| 最新 rc / 是否存在 rc.2 | 0.2.2-rc.1 / 否 |
| 版本漂移 | 无 |

**`latest` 通道变化说明。** 上一轮（2026-11-05）dist-tags 为 `latest=0.2.1-rc.5`、`next=0.2.2-rc.1`；本轮 `latest` 提升为 0.2.2-rc.1。版本清单仍为 42 项且末项仍为 0.2.2-rc.1，`time` 中 rc.1 的发布时间未变，GitHub 无新 release，因此判定为 dist-tag 通道提升，不是新版本发布。用户影响：`npm install -g @deepseek-ai/dsh` 解析 `latest`，默认安装现为 0.2.2-rc.1（此前为 0.2.1-rc.5）。侧栏支持矩阵已覆盖 rc.1，因此不需要 runtime 升级或协议变更。命令与完整输出见 `artifacts/team/maintenance-2026-11-06/round-analysis.md` 第 2 节。

### 9.2 实施项与代码触点

本轮实施 2026-11-05 审核报告与轮次分析确认的残留项，分为 Batch A（会话/文件链接/通知）与 Batch B（第三方 bundle 更新）。

**A. 会话行工作目录（F）**

- `src/session-center.ts:34` 的 `SessionItem` 增加可选 `cwd`；`:191` 的 `toSessionItem` 只在 `SessionSummary.cwd` 为非空字符串时投影，缺省或空白字符串不写入。
- `src/webview.ts:1507` 的会话行在存在 `cwd` 时把工作目录加入 `main.title` 与 `aria-label`（归档行的恢复提示同样携带）；无 `cwd` 时保持原 tooltip 与无障碍名称。
- VS Code 侧不实现自绘悬浮卡；原生 `title` 工具提示与无障碍名称为等价承载面。该值仅用于本地显示，不写入日志、Output 通道、遥测或持久化状态。

**B. 文件链接语义（I，按 rc.1 parity）**

- `src/markdown.mts:135` 的 `parseFileLink` 按 DSH `0.2.2-rc.1` 参考解析器语义处理：
  - 哈希片段仅接受 `#L5`、`#L5-L9`；结束行只参与合法性校验，不向下游传播。
  - 冒号后缀接受 `path:5`、`path:5:3`、`path:5-9`；列与范围终点只参与匹配与校验，不向下游传播。
  - 无效片段或无效值（`#L5:3`、`#L0`、`#L2-L1`、`#5` 等）容忍为打开原文件、不选中，链接不丢失。
  - 路径、URL、共享路径与控制字符规则不变：含 `?` 的目标拒绝；decode 失败拒绝；控制字符拒绝；`//` 或 `\\` 共享路径拒绝；非 Windows 盘符的 URL scheme 拒绝。
- 与 rc.1 解析器的次序差异：侧栏在路径校验之前剥除冒号后缀（`src/markdown.mts:148`），因此裸相对路径 `a.ts:42` 可作为合法链接；rc.1 解析器要求绝对拼写并拒绝同一形式。该差异由代码注释说明，属于既有规则次序。
- 下行链路只传播起始行：`src/webview.ts:1839` 的 `fileButton` 仅发送 `line`；`src/extension.ts:5933` 的 `open-file` 分发只接受整数 `line`；`src/diff-review.ts:547` 的 `openFile` 在起始行定位，不选中范围、不定位列。本轮不实现范围选中与列定位，与 rc.1 参考解析器只传播起始行的语义一致。

**C. 会话 Markdown 导出失败文案（Minor-1）**

- `src/extension.ts:383` 的 `sessionMarkdownFailureText` 对 `session-export-unavailable`（HTTP 404）改为中性文案："The conversation could not be copied as Markdown. The runtime may not support this export, or the conversation may no longer exist."。该文案取代第 4.1 节失败映射表中 0.2.2-rc.1.4 的旧 404 文案。
- 失败时 `src/extension.ts:5534` 向 Webview 发送 `session-notice` 并携带 `tone: 'error'`。

**D. 失败通知停留时长（Minor-2）**

- `src/webview.ts:1395` 的 `showSessionNotice(text, tone)`：`tone === 'error'` 时停留 4000 ms，默认 1600 ms；`src/webview.ts:196` 新增 `.session-notice.error` 样式；宿主消息处理在 `src/webview.ts:6762` 透传 `tone`。

**E. 第三方 bundle 更新残留清理（Minor-3/4/5/6/7/8）**

- Minor-3：`src/settings-panel.ts:57` 定义封闭重启原因集合，成功分支（`:357`）仅下传白名单内、长度受限的 `restartReason`；`src/settings-page.mts:23` 的 `RESTART_REASON_TEXT` 按官方含义映射五种原因，未知值不显示，回退通用重启句。
- Minor-4：`src/settings-page.mts:586` 起，unchanged 文案在 `from` 为空时使用 "the installed bundle is unchanged"，check/remove/install 三个分支一致，不再出现重复的 "remains installed"。
- Minor-5：`src/dsh-client.ts:421` 的 `bundleUpdateResultOf` 要求 `to` 非空，空值返回 `invalid-response`；`from` 仍允许空串（目标检查被拒路径）。
- Minor-6：`src/dsh-client.ts:307` 与 `src/settings-page-state.ts:132` 的过滤正则改为 `/[\p{Cc}\p{Cf}]/gu`，覆盖 C0、C1 与 Unicode 格式字符（含双向覆盖），保留非 ASCII 文本与长度上限。
- Minor-7：`src/settings-page.mts:837` 在版本检查成功后删除该 bundle 的旧 `bundleResults`，避免新版本列表与旧更新结果并存。
- Minor-8：`src/settings-ui.ts:129-131` 为 `.bundle-version` 与 `.version-number` 增加 flex 对齐、间距与等宽版本号样式，不引入外部资源。

### 9.3 隐私与安全

1. `cwd` 仅作为本地 tooltip 与无障碍名称内容，不进入日志、Output 通道、遥测或持久化状态；无 `cwd` 时行为不变。
2. 文件链接的容错不扩大路径校验面：无效片段只影响“是否携带起始行”，目标路径仍经同一 URL/共享路径/控制字符/decode 校验；下游只接受整数起始行，越界由既有 `openFile` 夹取逻辑处理。
3. 导出 404 的中性文案不回显响应体、本机路径或异常原文；Output 通道仍只记录白名单短分类（见第 5 节第 1 条）。
4. C1/Cf 过滤移除双向覆盖字符，避免 runtime 提供的显示文本重排界面；重启原因只接受封闭集合，页面文案由页面自身持有，wire 文本不进入界面。
5. 本轮不新增网络出口、持久化或遥测。

### 9.4 验证记录

2026-11-06T14:51–14:54+08:00（本机最终工作树；含提交前 Minor 修复与文档措辞定稿后的复跑）：

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 通过（退出码 0） |
| `node scripts/build.mjs` | 通过；输出 `dist/extension.js`、`dist/runtime-host.js` 与 Webview bundles |
| `CI=true npx vitest run --config vitest.config.ts` | **131 个测试文件通过；2516 passed / 1 skipped / 0 failed（2517 个用例）** |

- 工作树改动（相对 HEAD `6dfe717`）：代码层为 10 个 `src/` 文件、8 个已修改 spec 文件与 1 个新增 spec 文件（`tests/settings-ui.spec.ts`）；连同 6 个文档与版本文件，共 24 个已修改文件 + 1 个新增文件。
- 测试增量：9 个 spec 文件（8 个修改、1 个新增）共新增 19 个 `it` 声明（含 3 个 `it.each` 参数化声明），并在既有解析表中补充 6 个用例；展开后共 32 个新增执行用例。
- 覆盖要点：会话行 `cwd` 投影（有值/缺省/子代理）；tooltip 与 aria（有值/无值/归档）；失败通知的 error tone 与 4000 ms 停留；文件链接解析表（哈希起始行、冒号后缀、无效片段容忍、URL/查询拒绝、裸相对路径次序）；`dsh-client` 空 `to` 拒绝与 Cc/Cf 过滤；版本投影 C1/bidi 过滤；重启原因五种映射与两种回退；`from` 为空时三种 step 的中性 unchanged 文案；检查成功清除旧结果；重启原因白名单下传；版本行 CSS 断言。
- **边界声明**：本轮未对真实 DSH runtime 执行端到端运行，未在真实 VS Code 扩展宿主中手工冒烟；文件链接语义与 rc.1 参考解析器的一致性由单元测试与 rc.1 前端包（`dsh-web-frontend` 的解析函数）交叉核对；未运行 `tests/settings-page.browser.mjs` 等 Chromium 浏览器检查。

### 9.5 残余与后续

| 项目 | 说明 |
|---|---|
| 导出 404 二义性 | 侧栏无法区分“runtime 不支持导出”与“会话已不存在”；彻底消除需 runtime 在导出路由提供可区分的状态码或错误码 |
| 失败提示常驻 | 失败通知仍为约 4 秒后自动隐藏；常驻提示需要新的 UI 承载与关闭交互设计 |
| 范围选中与列定位 | 本轮与 rc.1 参考解析器一致，只打开起始行；如需范围选中或列定位，属侧栏增强，需要扩展 Webview→宿主→打开文件的消息形状并重新评估 |
| 第 7 节未实施项 | 图片进入输入框即上传与 50 MiB 对齐（M–L，需端到端探针）、工作步骤收起/仅最终回答（L，渲染架构）、`readBundleDetail`、`pluginMarket/readEntryDetail`、Web-only 面板、统一右键菜单与内嵌文件树（有意不做）、WebSocket 压缩（loopback 收益低）保持不变。第 7 节所列“会话悬浮卡显示工作目录”与“聊天文件链接的行范围终点”已在本轮以最小等价面处理：原生 tooltip/无障碍名称；范围终点与列仅校验、下游只打开起始行。 |

第 1–8 节记录 2026-11-05 轮次的事实，本节为增量记录；上一轮结论与功能映射分类表不因本轮而改变。

## 10. 维护轮次 2026-11-09（侧栏 0.2.2-rc.1.6）

### 10.1 版本核验

| 项目 | 值 |
|---|---|
| 核验日期 | 2026-11-09（Asia/Shanghai）；独立复核时间 2026-11-09T14:43:48+08:00 |
| npm dist-tags | `{"latest":"0.2.2-rc.1","alpha":"0.2.2-alpha.3","next":"0.2.2-rc.1"}` |
| npm 发布时间 | `0.2.2-rc.1` = 2026-11-04T09:20:32.310Z（未变） |
| packument `time.modified` | 2026-11-05T13:21:52.829Z（未变） |
| GitHub Release | `dsh-v0.2.2-rc.1`，published_at 2026-11-04T13:07:14Z（未变） |
| GitHub tags | 38 条，首项 `dsh-v0.2.2-rc.1` |
| npm 版本数 | 42；末项 `0.2.2-rc.1`；无 rc.2 或更高版本 |
| 判定 | **无版本漂移**；最新候选版本仍为 0.2.2-rc.1 |

本轮 dist-tags、版本集合、rc.1 发布时间、`time.modified`、GitHub Release 与 tags 均与 2026-11-06 轮次记录逐项一致；发布说明正文 SHA-256（`71662c56…`）未变。完整命令输出见 `artifacts/team/maintenance-2026-11-09/round-analysis.md` 第 2 节。因无新版本，本轮不要求 runtime 升级或协议变更。

### 10.2 实施项与代码触点

本轮实施 2026-11-06 审核与轮次分析确认的残留项，分 Batch A（插件长描述）与 Batch B（路径/通知/重启原因）。

**A. 插件长描述（`Details…`，`pluginManager/readBundleDetail`）**

- 契约（rc.1 安装树独立核验）：`readBundleDetail(name, language, options?{npmFileSources})`，结果 `{status:'found', origin:'locale'|'readme', path, markdown} | {status:'none'}`；错误码 `plugin-manager/unknown-bundle`、`invalid-language`、`detail-unavailable`。已安装 bundle 从 bundle 目录读取，无网络；官方未安装 bundle 经 npm 文件 CDN 读取；Host 不缓存；默认文档上限 `detailMaxBytes` = 1 MiB、图片上限 5 MiB、CDN 超时 15 s。
- 客户端：`src/dsh-client.ts:1199` 的 `readBundleDetail` 先校验 bundle 名（字符集与长度）、规范化 `language`（`normalizeDisplayLanguage`，`:445`：trim + 小写 + `^[a-z]{2,8}(-[a-z0-9]{1,8})*$`，不合法返回 `undefined`），再发 `pluginManager/readBundleDetail`（60 s 超时，`options.npmFileSources` 仅转发 `jsdelivr`/`unpkg`/`npmmirror` 封闭集合）。结果经 `bundleDetailOf`（`:458`）白名单化：只保留 status/origin/path/markdown，`path` 限长 500 字符，markdown 按 UTF-8 计长并在超过 `MAX_BUNDLE_DETAIL_BYTES`（`:429`，1 MiB，与 Host 默认一致）时判为 `invalid-response`；未知字段与诊断丢弃。
- 面板：`src/settings-panel.ts:272` 处理 `bundle-detail` 消息（`:285`）。bundle 必须属于当前 roster；`language` 取 `normalizeDisplayLanguage(vscode.env.language) ?? 'en'`（`:293`）；该读取是只读操作，不要求 `runtimeIsOurs`/`requireWrite`，因此只读 profile 与 attach-only 外部 runtime 也可查看。只有契约的 `{status:'none'}` 结果视为“无详情”；`plugin-manager/detail-unavailable`（存在文档但网络/体积/内容读取失败）经 `bundleDetailFailure`（`:65`）映射为 “This bundle's detail document could not be read. Try again later.”，不再误报为无详情。其余错误同样映射为固定文案：`unknown-bundle` → “This plugin is no longer in the runtime's bundle list. Refresh settings to update the list.”；旧 runtime 未提供方法（`DshConnectionError` 的 HTTP 404，或 `gateway/invocation-unavailable`、`gateway/method-not-found`、`gateway/not-found`、`gateway/route-not-found`、`gateway/unknown-method`、`unknown-method`）→ “This runtime does not provide plugin details.”；其他 → “The plugin details could not be read. Refresh and try again.”。编辑器打开失败 → “The plugin details could not be opened.”。不转发 runtime 诊断、包内路径或异常原文。
- 页面：`src/settings-page.mts:614`（Third-party bundles）与 `:704`（Experimental bundles）的卡片新增 **Details…** 按钮；两个 fieldset 仅在存在 pending 请求时锁定，因此只读/attach-only runtime 的 Details 仍可用。页面结果文案：打开成功 “Plugin details opened in the editor preview.”；无详情 “No long-form details are available for this bundle.”；失败使用面板给出的固定文案。
- 虚拟文档与预览：新增 `src/plugin-detail.ts`。自定义 scheme `dsh-plugin-detail`（`:11`）；每次打开生成不透明 token（`detail-<UUID>`），URI 形如 `dsh-plugin-detail:/plugin-details/<token>/<安全标签>.md`（`:125`），不含本机路径或包内文档路径；标签经 `\p{Cc}\p{Cf}` 剔除、路径分隔符与 `#` 替换为空格、空白折叠并截断到 80 字符（`:20`、`:23-26`），因此标题中的 `#` 不会成为 URI fragment。正文只存于内存表，最多 16 份（`:15`），超出按插入顺序淘汰，过期 URI 返回 “These plugin details are no longer available. Open the plugin details again.”（`:13`）。由于 VS Code 对同一 scheme 只保留一个内容提供者，本扩展采用进程级共享注册（`acquireDocuments` `:63` / `releaseDocuments` `:79`）：多个 `PluginDetailViewer` 共享同一 provider 注册与同一 token 表，首个 viewer 注册、最后一个 dispose 时注销并清空，重叠的设置界面可互相服务已打开文档，最后一个释放后旧 token 返回“不再可用”。`open`（`:118` 起）优先执行 `markdown.showPreview`（`:127`）；预览命令失败时回退 `window.showTextDocument(uri, { preview: true })`（`:131`）打开同一只读文档；两种编辑器都失败时删除该 token 的正文并返回错误。viewer `dispose`（`:141`）幂等，仅递减共享引用计数。
- **已知降级**：详情文档中的相对图片由 runtime 的认证路由 `GET /api/plugin-manager/detail-file` 提供；VS Code Markdown 预览无法携带 runtime 认证，也无法解析该路由，因此图片不渲染，预览与 DSH Web 详情页不一致。Markdown 原样交给预览，不抓取、不重写为 `data:` URI、不持久化；预览自身按 VS Code 的资源策略与工作区信任模型处理文档中的外部资源。

**B. 聊天文件链接路径加固（Cc/Cf）**

- `src/markdown.mts:169` 的路径校验由 C0/DEL 扩展为 `/[\p{Cc}\p{Cf}]/u`：拒绝全部 Unicode 控制与格式字符（C0、C1、`Cf`，含双向覆盖符、方向隔离符与零宽字符）。校验在 `decodeURIComponent` 之后执行，因此 `%C2%85`、`%E2%80%AE` 等转义形式同样被拒绝；合法非 ASCII 文件名与 Windows 盘符例外规则不变。
- 该加固同时覆盖哈希片段与冒号后缀两条解析路径的最终 `path`，不改变第 9.2 B 节的行号语义。

**C. 会话 Markdown 导出失败通知停留策略**

- `src/webview.ts:1392` 的 `SESSION_NOTICE_MS` = 1600 ms（确认提示）；`:1394` 的 `SESSION_NOTICE_ERROR_MAX_MS` = 15000 ms（失败提示的安全上限）。`showSessionNotice`（`:1427`）在失败时设置 `role="alert"` 与 `aria-live="assertive"`，提示保持可见直到用户下一次 `pointerdown`/`keydown`（捕获阶段监听）、被新通知替换或达到 15 s 上限；`hideSessionNotice`（`:1404`）清除计时器与监听器，并把角色恢复为 `status`/`polite`。监听器只在失败提示可见期间存在，替换时先移除旧监听器，避免叠加；Webview `pagehide` 时清理（`:1455`）。
- 归属：该打磨是 2026-11-05 审核 **Minor-2** 的后续（2026-11-06 审核报告 §4.4 已记录 4 s 实现现状），不属于 2026-11-06 审核报告第 9 节 Minor 清单。第 9.2 D 节的 4 s 策略在本轮被替换。

**D. 第三方 bundle 重启原因单一数据源**

- 重启原因白名单与文案收敛到 `src/settings-page-state.ts:135` 的 `RESTART_REASON_TEXT` / `:142` 的 `RESTART_REASON_CODES` / `:144` 的 `restartReasonText`（`Object.hasOwn` 校验，未知键与原型键拒绝）。`src/settings-panel.ts` 改为从该模块导入 `RESTART_REASON_CODES` 下传白名单码；`src/settings-page.mts:1` 改为导入 `RESTART_REASON_CODES` 与 `restartReasonText`，`:575` 通过统一函数取文案。五条文案与白名单集合逐字未变，属内部重构，用户可见行为不变。

### 10.3 隐私与安全

1. 详情正文只存在于内存虚拟文档表：不写磁盘、Output 通道、Webview 状态或遥测，不持久化；URI 只含随机 token 与净化后的标签，不泄露本机路径或包内文档路径；文档表上限 16 份，由进程级共享注册维护，在最后一个使用者释放时清空。
2. 第三方 bundle 的 Markdown 属不可信文本：仅在用户点击 **Details…** 后才读取并交给 VS Code 预览；侧栏不抓取、不预取、不重写文档中的外部资源，也不注入 HTML；预览自身的安全过滤、CSP 与工作区信任模型保持生效。需要说明的是，预览默认策略允许加载 `https:`/`data:` 图片，因此第三方文档中的远程图片可能由预览直接请求，向该主机暴露读者地址与时间信息（不涉及本地数据）；相对图片因运行时认证 detail-file 路由不可解析而不渲染。
3. 客户端只接受封闭结果形状与白名单字段：status/origin/path/markdown；`path` 限长 500、markdown 限 1 MiB（UTF-8）；bundle 名、language、CDN 源均经校验，空/畸形 language 回退 `en`；错误只显示固定分类文案，不回显诊断、包内路径或异常原文。
4. 路径 Cc/Cf 过滤在解码后执行，阻止不可见字符或双向重排隐藏链接实际打开的目标；URL、共享路径、控制字符与盘符规则未放宽。
5. 重启原因集合仅来自单一共享定义，未知值被页面过滤，wire 文本不进入界面。
6. 本轮不新增持久化、遥测或网络出口。已安装 bundle 的详情读取无网络；官方未安装 bundle 的详情读取由 runtime 经 npm 文件 CDN 完成，属用户显式触发的读取。

### 10.4 验证记录

2026-11-09T14:52–14:56+08:00（本机最终工作树；含提交前审核 Minor 修复；版本核验复核于 14:43:48）：

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 通过（退出码 0） |
| `node scripts/build.mjs` | 通过；输出 `dist/extension.js`、`dist/runtime-host.js` 与 Webview bundles |
| `CI=true npx vitest run --config vitest.config.ts` | **132 个测试文件通过；2581 passed / 1 skipped / 0 failed（2582 个用例）** |

- 代码层工作树改动（相对 HEAD `39ab491`）：6 个 `src/` 文件（其中 `src/plugin-detail.ts` 为新增）与 6 个已修改 spec 文件（另新增 `tests/plugin-detail.spec.ts`）；连同本任务 6 个文档与版本文件，工作树共 18 个已修改文件 + 2 个新增文件。
- 测试增量：7 个 spec 文件（6 个修改、1 个新增）新增 47 个 `it` 声明（含 2 个 `it.each` 参数化声明；其中新增的 `tests/plugin-detail.spec.ts` 含 14 个），并扩展既有参数化表格（路径 Cc/Cf 行等）。
- 覆盖要点：`readBundleDetail` 的 wire 参数/language 规范化/1 MiB 上限/`none`/恶意字段丢弃/CDN 源白名单/畸形结果拒绝；虚拟文档的 token 唯一性、每 token 单正文、16 份上限与淘汰、标签净化、预览失败回退文本编辑器、打开失败后正文遗忘、dispose 后拒绝；进程级共享 provider 注册（多 viewer 只注册一次、一个界面的文档可由另一个存活界面服务、逐个 dispose 后仍存活、最后一个释放时注销并清空表、再次创建重新注册且旧 token 失效）；设置页两个卡片均出现 Details、只读/attach-only 可用、无详情与失败文案；面板 roster 校验、`detail-unavailable`→读取失败文案、旧 runtime 的 6 类 gateway 码与 HTTP 404 → 不支持文案、空语言回退、不泄露 hidden-marker、面板关闭释放共享引用；标签中的 `#` 不进入 URI fragment；文件链接 Cc/Cf 字面与转义形式拒绝、合法非 ASCII 与盘符保持；失败提示交互关闭/15 s 上限/替换不叠加监听/页面销毁清理；重启原因单一数据源导出与原型键拒绝。
- **边界声明**：本轮未对真实 DSH runtime 执行端到端运行，未在真实 VS Code 扩展宿主中手工冒烟；虚拟文档与 Markdown 预览由单元测试（mock `vscode`）覆盖，未验证真实预览对第三方资源的渲染结果，也未对详情图片不渲染做视觉验证；未运行 Chromium 浏览器检查。

### 10.5 残余与后续

| 项目 | 说明 |
|---|---|
| `pluginMarket/readEntryDetail` | 市场条目详情为独立 RPC（需索引 URL 与具体版本，独立结果类型与缓存语义），属市场发现流程，仍未实现 |
| 详情图片渲染 | 需经 runtime 认证抓取 `/api/plugin-manager/detail-file` 并重写为 `data:` URI（或等价安全方案），会新增抓取、解码与注入面，需独立设计与安全评审；本轮不实施 |
| 详情文档外部资源 | 第三方 Markdown 中的远程图片可由 VS Code 预览按默认资源策略直接加载（向第三方主机暴露地址/时间，不涉及本地数据）；侧栏不抓取、不预取、不重写。若需审计或阻断外链，需独立设计（如受控 webview 或内容净化） |
| 预览生命周期取舍 | 最后一个设置界面关闭时共享 provider 注销并清空文档表，此时仍打开的详情预览标签页显示“不再可用”固定文案；若需预览在设置界面关闭后继续可读，可将注销延后到扩展停用（代价：scheme 注册常驻） |
| Web 插件管理页布局/导航 | rc.1 条目中的“改善页面布局和导航行为”属 DSH Web 页面，侧栏保持设置页卡片结构，不复刻 |
| 既有未实施项 | 第 7 节与第 9.5 节所列图片即时上传与 50 MiB 对齐、工作步骤折叠、Web-only 面板、统一右键菜单与内嵌文件树（有意不做）、WebSocket 压缩（loopback 收益低）等保持不变；本轮无新增未实施适配项 |

第 9–10 节分别记录 2026-11-06 与 2026-11-09 两个维护轮次；本节为增量记录，第 1–9 节既有事实保持不变。

## 11. 维护轮次 2026-11-13（侧栏 0.2.2-rc.2.1，运行时基线升级到 rc.2）

### 11.1 版本核验

本轮是真实版本升级：DSH 从 `0.2.2-rc.1` 升级到 `0.2.2-rc.2`，侧栏版本从 `0.2.2-rc.1.6` 升到 `0.2.2-rc.2.1`，同时继续支持 rc.1。

| 项目 | 值 |
|---|---|
| npm dist-tags（2026-11-13T15:02:49+08:00 复核） | `latest = 0.2.2-rc.1`、`next = 0.2.2-rc.2`、`alpha = 0.2.2-alpha.3` |
| rc.2 npm 发布时间 | `2026-11-12T02:16:12.076Z`（2026-11-12 10:16:12 +08:00）；`time.modified = 2026-11-12T02:16:12.425Z` |
| rc.2 GitHub Release | `dsh-v0.2.2-rc.2`，prerelease，published_at `2026-11-11T11:33:06Z`（2026-11-11 19:33:06 +08:00） |
| 提交规模 | GitHub compare `dsh-v0.2.2-rc.1...dsh-v0.2.2-rc.2`：`ahead_by = 1568`、`total_commits = 1568`，files 列表 300 条（compare API 单页上限） |
| npm 版本数 | 43；末项 `0.2.2-rc.2`；无 rc.3 或更高版本；GitHub tags 39 条，首项 `dsh-v0.2.2-rc.2` |
| 官方升级指南 | rc.2 元包 `docs/upgrade-guide/v0.2.2-rc.1` 共 19 项 |
| 判定 | **真实升级轮次**；rc.2 只在 `next` 通道，`latest` 仍为 rc.1，因此默认安装不变 |

说明：npm dist-tags 与 `time` 于 2026-11-13T15:02:49+08:00 独立复核；GitHub API 在最终复核时被速率限制，GitHub 数据采用本轮分析报告在 2026-11-13T14:32–14:35 的核验记录与 `/tmp` 原始响应（`gh-releases-20261113.json`、`gh-tags-20261113.json`、`rc1-rc2-compare.json`），见 `artifacts/team/maintenance-2026-11-13/upgrade-guide-matrix.md` 第 2 节与 `wire-delta.md` 第 2 节。

### 11.2 19 项升级指南适用性摘要

| 类别 | 指南条目 | 本轮处理 |
|---|---|---|
| 协议级直接（P0） | #12 `plugin-update-method`：`BundleInfo.updatable` 改为 `update: 'registry' \| 'git'`；新增 `unexpected-package` | A；不处理会导致第三方 bundle 更新区块在 rc.2 整体消失 |
| 协议级直接（P1） | #18 `web-search-billing`：`web-deepseek-api` 字段与凭据来源变化 | B；设置页新计费项、隐藏旧端点字段、更新提示 |
| 用户可见副作用（P1） | #3 `archive-worktrees`：归档时可能删除干净 Git 工作树 | 仅文档与升级提示（11.3 G、README）；侧栏不管理工作树 |
| 显示/说明层 | #4 `attachment-error-codes`、#15 `subagent-interrupt-default`、#16 `terminal-backend-cleanup-error` | F 补新错误码文案；#15/#16 走通用失败路径，无专用逻辑 |
| 不适用（13 项） | `account-notification-fields`、`account-remote-provider`、CUA 3 项、Forge 3 项、`dsh-doc-skill`、`runtime-context-reminders`、`session-append-overloads`、`terminal-bundle-sidebar-backend`、`window-drag-regions` | 侧栏不消费对应表面；账号余额字段经 wire 核对未变 |
| 指南外协议级（P0） | rc.2 移除 `subagents/interruptByParent`，改为 `subagents/interruptByUser`（见 `wire-delta.md` §3.3） | D；不处理会导致停止子代理失败 |

### 11.3 A–G 实施内容与代码触点

**A. 插件更新契约（`updatable` → `update`）**

- `src/dsh-client.ts:71-77`：`DshBundleInfo` 同时保留 rc.1 的 `updatable?: boolean` 与 rc.2 的 `update?: 'registry' | 'git'`；`:256-259` 的安装错误码白名单加入 `unexpected-package`。
- `src/settings-page-state.ts:69-127`：`BundleView` 增加 `update`；`publicBundles` 把 `update` 与 rc.1 `updatable` 归一为同一对字段（`updatable: update === 'registry'`），因此 rc.2 的 registry 行仍显示更新入口，Git 行以 `updatable: false` 加 `update: 'git'` 进入页面。
- `src/settings-page.mts:600-670`：Third-party bundles 过滤条件为 `updatable === true || update === 'git'`；registry 行保留 **Check for updates**、版本列表与更新；Git 行显示只读说明（`:630`），不调用 `listVersions`。
- `src/settings-panel.ts:357`、`:380`：两条写路径仍以 `updatable === true` 为守卫，即只允许 registry 来源更新；`:38` 为 `unexpected-package` 提供独立解释。`src/dsh-errors.ts:77` 同步错误文案。
- 未实现：`updateBundle` 的 `options.spec` 与 Git 版本更新（见 11.8）。

**B. Web 搜索计费**

- `src/settings-page-state.ts:285-292`：`web-deepseek-api` 表单新增 `searchBilling`、`fetchBilling` 两个 `select` 字段及说明；rc.1 schema 不含这两个键时由既有动态表单逻辑自动隐藏。`:336-338` 增加 `auto`/`account`/`api-key` 三个选项标签（Automatic、Signed-in DeepSeek account、DeepSeek API key）。
- `src/settings-page.mts:314-327`：rc.2 下 API Key 提示为“No key is configured; the signed-in DeepSeek account can be used when the billing setting allows it.”；rc.1 无计费字段，保留原提示“only conversations using a DeepSeek Account model can search”。端点与计数的说明只附加到对应字段；rc.2 未声明的旧端点字段不渲染。
- 兼容：`searchSelectionMutations` 写入的 provider id 集合在 rc.2 仍有效；rc.2 默认搜索提供方改为 `deepseek-search-api`，既有开关会显示为已启用。

**C. AgentTeam 投影 v7 与团队开关**

- `src/agent-team-state.ts:59-126`：`AgentTeamView` 增加可选 `enabled`；`agentTeamOf`（`:83`）接受两种形状——存在 `members` 数组时走 rc.1 名册路径（逐字段行为不变）；存在布尔 `enabled` 时走 rc.2 选择路径，队友行由 `catalogMembersOf`（`:211`）从 `subagentCatalog` 派生（仅 continuable 本地子代理；名称缺失时回退会话 ID；结果排序）。rc.2 下 `{enabled:false, tasks:[]}` 视为无内容，面板保持隐藏。
- `src/dsh-client.ts:1156-1162`：新增 `setAgentTeamEnabled`，发送 `agentTeams/setEnabled { agentId, enabled }`（wire 键为 `agentId`）；rc.1 的未知方法失败由调用方分类为“不支持”。
- `src/extension.ts:479-491` 的 `teamToggleFailure` 把失败分为 `unsupported` / `not-found` / `failed` 三类固定文案；`:2024-2044` 的 `setTeamEnabled` 校验当前会话、忽略重复点击（`teamBusy`）、输出通道只记录分类；`:5687-5699` 处理 `set-team-enabled` 消息。
- `src/webview.ts:4590-4695`：任务面板在 rc.2 下按 `enabled` 决定可见性（`:4593`），渲染 **Team on**/**Team off**、**Enable team**/**Disable team** 按钮（`:4665-4685`，按钮在 `:4672` 创建并带 `aria-pressed` 与 busy 状态）；rc.1 名册路径不渲染该控件。摘要行在 rc.2 下显示 `Team on · n members · x/y tasks done`（`:4608`）。

**D. 子代理停止 RPC 兼容**

- `src/dsh-client.ts:1398-1416`：`interruptSubagent` 先调用 `subagents/interruptByUser { childSessionId }`；仅当失败属于“方法缺失”类（`MISSING_RPC_CODES`，见 `:846-866`；含 gateway 未知方法、`gateway/method-unavailable`、HTTP 404；不再把泛化的 not implemented 文本当作方法缺失）时回退到 rc.1 的 `subagents/interruptByParent { childSessionId, parentSessionId, mode: 'continuable' }`。两种形状都要求返回 `{accepted:true}`；传输失败不触发回退。
- 调用点保持原签名：任务面板停止与子会话取消无需改动，rc.1 与 rc.2 均可用。

**E. 具名子代理与工具寻址**

- `src/subagent-tools.ts:22-40`：`send_message` / `interrupt_agent` 先认 rc.1 `agent_id`，再认 rc.2 `agent`（名称，返回 `memberName` 供渲染层解析），最后认旧 Team `target`；`:44-46` 明确 `wait_agent` 与 `team_task_*` 不产生子代理链接。
- `:134-160`：`list_agents` 同时解析 rc.2 的 `{name, status, description}` 行、旧 `{target}`/`members` 行，以及渲染文本 `name [status] — description`；`activation` 的 rc.2 `name` 被收集为待解析名称。
- `src/extension.ts:212-221` 定义 `SubagentCatalogItem`；`:447-473` 的 `subagentCatalogItemsOf` 只保留 id/name/mode，上限 200 行、名称 300 字符；该投影随 `ChatViewState` 下发（`:233`），并在会话读取与 `subagentCatalog` 投影帧时刷新（`:898`、`:3794-3808`）。
- `src/webview.ts:2211-2225` 用 Team 名册与 `subagentCatalogItems` 合并出“名称 → 会话 ID”映射；`:3420-3435` 的 `teamLinkKey` 把目录也纳入重绘依据，使晚到的目录能重新解析已绘制的工具卡；无法解析的名称保持普通工具卡，不生成死链。

**F. 小项**

- `src/dsh-errors.ts:77-97`：新增 `unexpected-package` 与附件/图片准入错误码的可读文案（附件与图片码共 17 个，另有 `unexpected-package` 一个）。
- `src/webview.ts:3265-3268`：失败行补充 `INVALID_IMAGE`、`IMAGE_TOO_LARGE` 与 `ATTACHMENT_*` 前缀文案；未知码沿用原回退。
- `src/settings-page.mts:498`：自定义提供商协议标签增加 `google-generative-ai → Gemini API`；协议选项本身来自运行时 schema，rc.1 不显示该项。

**G. 双版本兼容策略**

- rc.2 只发布在 `next`；`latest` 仍为 rc.1，因此默认安装仍是 rc.1，侧栏必须同时兼容两者。
- 所有受影响的解码保留 rc.1 字段回退：bundle `updatable`、Team `members`、`interruptByParent`、旧 `list_agents` 行形状均继续可用；rc.2 新增字段在 rc.1 上缺失时按原行为处理。
- 设置页按运行时 schema 渲染：rc.2 的 `searchBilling`/`fetchBilling` 只在 schema 声明时出现，rc.1 的旧端点字段只在 schema 声明时出现。
- 能力缺口在调用时检测并转为固定文案：Team 开关在 rc.1 显示“不支持”，子代理停止只在方法缺失时回退。
- 归档工作树行为属 runtime 行为变化，侧栏不添加确认步骤，只在升级说明与功能说明中提示，避免夸大侧栏的控制能力。

### 11.4 真实 rc.2 运行时探针

环境与方法：隔离 `HOME=/tmp/probe-rc2/home`、`DSH_HOME=/tmp/probe-rc2/dsh`，运行时为 `@deepseek-ai/dsh@0.2.2-rc.2` 的 `lib/bin.js`，命令 `web --host 127.0.0.1 --port 0 --no-open`，Node v26.12.0；探针脚本 `probe.mjs`、`probe-team.mjs` 通过启动 URL token 认证后调用 HTTP RPC。完整记录见 `artifacts/team/maintenance-2026-11-13/rc2-runtime-probe.md`。

实测结论：

1. `settings/describe` 的 `web-deepseek-api` schema 字段为 `count`、`searchRequestsPerSecond`、`sendOriginalQuestion`、`searchBilling`、`fetchBilling`、`searchBaseURL`、`searchApiKeyEnv`、`fetchBaseURL`、`fetchApiKeyEnv`；`searchBilling`/`fetchBilling` 为 `auto|account|api-key` 联合类型，默认 `auto`；旧 `baseURL`/`apiKeyEnv`/`apiKey` 不再是 schema 字段。
2. `pluginManager/listBundles` 的默认 profile 返回 23 行；安装型与可选 bundle 行不含 `update`，也不含 rc.1 的 `updatable`；`pluginManager/listVersions {name:'@deepseek-ai/dsh-base'}` 返回 `refused / not-updatable`，与侧栏对非可更新 bundle 的处理一致。
3. 新建会话的 `agentTeam` 投影为 `{enabled:false, tasks:[]}`（无 members）；调用 `agentTeams/setEnabled { agentId:<sid>, enabled:true }` 成功，随后投影为 `{enabled:true, tasks:[]}`；对不存在会话调用返回 `session/not-found`。
4. 同一运行时暴露 `subagents/interruptByUser`；`subagentCatalog` 投影为空数组（新会话无子代理），catalog 条目在 rc.2 viewSchema 中新增可选 `name`。
5. 其他记录：`imageLimits` 默认单图 50 MiB、每消息 20 张、单消息 200 MiB、6400 万像素、单边 65535；`llm-pi-ai` 设置 schema 含模型请求重试配置（侧栏本轮不新增该 UI）。

边界：

- 探针只调用非模型 RPC，未执行任何模型对话轮次；未在真实 VS Code 扩展宿主中手工冒烟，也未验证浏览器渲染与自动加载等 UI 行为。
- 默认 profile 未安装第三方 registry bundle，因此 `update: 'registry'` 的正向更新路径由 rc.2 契约类型与单元测试覆盖；探针确认的是字段缺失形态与 `listVersions` 拒绝行为。
- 归档工作树清理为用户可见副作用，未在探针中执行归档操作；该行为依据官方升级指南与 wire 报告记录。

### 11.5 隐私与安全

1. 子代理目录投影仅保留 id、可选名称（≤300 字符）与模式（≤40 字符），最多 200 行，只用于“名称 → 会话 ID”的本地链接解析；不写入日志、Output 通道或遥测，也不持久化；随视图状态下发的只有这些有界字段。
2. Team 开关只对当前打开的会话执行，校验会话 ID、忽略重复点击，输出通道只记录 `unsupported`/`not-found`/`failed` 分类，不显示 runtime 原始错误文本。
3. 子代理停止对两种 RPC 都要求 `{accepted:true}`；只有明确的方法缺失信号才回退，传输失败不会被误判为旧运行时。
4. 新错误码（附件、图片、plugin 包不符）只使用固定文案，不回显包名、路径、诊断或异常原文；既有未知码回退不变。
5. 归档工作树清理不在侧栏代码中实现，侧栏不读取或删除工作目录；升级说明明确提示“分支与提交保留、需要保留目录时应开启工作树服务的 `retainOnArchive`”。
6. 本轮未新增网络出口、持久化或遥测；搜索计费与 Gemini 协议标签均为显示层。

### 11.6 验证记录

2026-11-13T15:02–15:16+08:00（本机最终工作树；版本复核于 15:02:49，审核后修复与复跑于 15:07–15:16）：

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 通过（退出码 0） |
| `node scripts/build.mjs` | 通过；输出 `dist/extension.js`、`dist/runtime-host.js` 与 Webview bundles |
| `CI=true npx vitest run --config vitest.config.ts` | **132 个测试文件通过；2632 passed / 1 skipped / 0 failed（2633 个用例）** |

- 代码层工作树改动（相对 HEAD `f50018e`）：19 个已修改文件（9 个 `src/` 文件、10 个 `tests/` 文件，含 `tests/settings-page.fixture.ts`），无新增文件；另有本任务 6 个文档与版本文件。
- 测试增量：10 个测试文件（含 1 个 fixture）中，9 个 spec 文件共新增 49 个 `it` 声明（其中 1 个 `it.each` 展开 3 例），并在既有参数化表格中补充用例；全量执行用例净增 51（2581 → 2632）。
- 覆盖要点：`update`/`updatable` 两种 bundle 行形状与 registry/Git 分流；`unexpected-package` 白名单与文案；rc.2 计费字段只在 schema 声明时出现、旧端点字段隐藏；AgentTeam rc.1 名册与 rc.2 选择双形状、catalog 派生成员、开关成功/重复点击/不支持/会话消失/通用失败；`interruptByUser` 首选与 `interruptByParent` 回退（含 404、gateway 码、文本提示三类），传输失败不回退；具名子代理的 `agent`/`name` 寻址、`list_agents` 新旧行形状、目录晚到后的工具卡重解析、`team_task_*`/`wait_agent` 不产生链接；Gemini 协议标签；附件/图片错误码文案。
- 审核后修复：独立审核发现 1 项 Major（团队开关 busy 状态未纳入任务面板重绘条件，开关在 RPC 返回后可能停留于 “Updating team…” 禁用态），已把 `teamBusy` 纳入 `src/webview.ts` 的重绘快照与触发条件，并补真实 `state-update` patch 路径测试。随后处理 4 项 Minor：rc.1 搜索提示不再引用不存在的计费设置；子代理中断回退分类收窄（补 `gateway/method-unavailable`，不再把泛化 not implemented 文本当方法缺失，并补 gateway/internal 不重试用例）；子代理目录不再暴露 external/unknown 行（无本地会话可打开）；catalog 投影帧缺少 summary 时不再清空已渲染的团队视图。残留 2 项 Minor（teamToggleFailure 未复用缺失方法分类，rc.1 不渲染开关故无用户可见影响；webview 附件文案与扩展侧表重复且无独立测试）记录为后续项。
- **边界声明**：本轮未执行真实模型对话轮次的端到端运行，未在真实 VS Code 扩展宿主中手工冒烟；真实运行时验证限于 11.4 的非模型 RPC 探针；未运行浏览器渲染检查。

### 11.7 延后项

| 项目 | 说明 |
|---|---|
| Git spec bundle 更新 | 需要 Git spec 输入与 `updateBundle` 的 `spec` 参数；页面本轮只读提示，避免调用失败的半功能 |
| 插件索引 Star/周下载量 | 由索引 `metadata.sortKeys` 携带而非 wire 字段；侧栏解码白名单丢弃，展示属产品增强 |
| 模型请求重试设置 UI | rc.2 设置 schema 已含重试配置，侧栏 Models 页本轮不新增编辑 UI |
| 工作树审阅 UI | 属 DSH Web 的 Forge/变更请求面板，侧栏使用 VS Code 原生 diff |
| 聊天自动加载更早消息 | Web 聊天行为改进；侧栏已有手动加载历史入口 |
| 聊天代码差异着色/语言高亮 | Web UI 渲染增强；侧栏自绘 diff，另立项 |
| Agent 终端面板 | Web 专属终端面板，侧栏不实现 |
| MCP 动态注册 UI | 运行时管理能力，侧栏插件清单动态读取即可 |
| 账号通知 UI | Web 账号通知入口，侧栏账号面板本轮不新增 |
| Office/CUA/Live Share/Stagehand | Web/桌面专属面板，侧栏不实现 |
| 图片 50 MiB 上限与“进入输入框即上传” | 仍受本地草稿上限与附件流水线约束，需端到端探针后另行实施 |
| `web/listProviders` 与 `web/providers-changed` | rc.2 新增提供方枚举与事件；侧栏搜索开关仍用运行时 schema，本轮不消费 |
| 继续生成（空 content prompt）与 `conversationContinuation` | 新能力，需失败 Turn 的 UI 与本地空文本守卫调整，另行实施 |
| `subagents/prompt` 旧字段清理 | 侧栏仍发送 `parentSessionId`/`mode`，rc.2 非严格解码会忽略；不影响功能，后续清理 |

第 9–11 节分别记录 2026-11-06、2026-11-09 与 2026-11-13 三个维护轮次；本节为增量记录，第 1–10 节既有事实保持不变。

## 12. 维护轮次 2026-11-16（侧栏 0.2.2-rc.3.1，运行时升级到 rc.3）

### 12.1 版本核验

| 项目 | 值 |
|---|---|
| npm dist-tags（2026-11-16T14:33:48+08:00 复核） | `latest = 0.2.2-rc.1`、`next = 0.2.2-rc.3`、`alpha = 0.2.2-alpha.3` |
| rc.3 npm 发布时间 | `2026-11-13T08:05:45.455Z`（2026-11-13 16:05:45 +08:00）；`time.modified = 2026-11-13T08:05:45.849Z` |
| rc.3 GitHub Release | `dsh-v0.2.2-rc.3`，prerelease，published_at `2026-11-13T07:56:55Z`（2026-11-13 15:56:55 +08:00）；发布说明正文 704 字符 |
| 提交规模 | compare `dsh-v0.2.2-rc.2...dsh-v0.2.2-rc.3`：`ahead_by = 6`、`total_commits = 6`；files 列表 300 条（compare API 单页上限，主要由 release 提交的包版本号变更构成） |
| 标签 | GitHub tags 40 条，首项 `dsh-v0.2.2-rc.3`；npm 版本 44 项，无 rc.4 或更高版本 |
| 官方升级指南 | rc.3 元包 `docs/upgrade-guide/` 目录末项为 `v0.2.2-rc.1`，**没有 `v0.2.2-rc.2` 目录或条目**：rc.2 → rc.3 无官方 API 级升级指南 |
| 判定 | 真实版本升级；rc.3 只在 `next` 通道，`latest` 仍为 rc.1，默认安装不变 |

说明：npm dist-tags、`time` 与 GitHub Release/tags/compare 于 2026-11-16T14:33:48+08:00 独立复核（GitHub API 本轮可用），升级指南目录核对使用 rc.3 元包 `/tmp/dsh-rc3-pkg/package`。分析产物见 `artifacts/team/maintenance-2026-11-16/version-analysis.md`、`wire-delta.md` 与 `rc3-runtime-probe.md`。

### 12.2 6 个提交逐条影响

| 提交 | 内容 | 对侧栏的影响 |
|---|---|---|
| `68f83cc992` | fix(ci): cache the verified bubblewrap archive and bound its download | 仅 CI 工作流与脚本，不涉及扩展 |
| `bbad94f927` | Merge PR #8383（release-0.2.2-ci-bubblewrap-cache） | 合并提交，同上 |
| `ac904e118e` | Merge PR #8385（restart-status-cwd / Windows 桌面应用内更新修复） | 仅 `apps/desktop/installer` 与桌面测试，不涉及扩展 |
| `b8c33a1504` | feat(experimental): 导入 DeepSeek 官网对话导出为会话 (#8342) | 新增可选 bundle 与 Web 客户端导入界面；侧栏只按通用逻辑列出 bundle，不实现导入 UI |
| `4c1cf20cb1` | release(dsh): 0.2.2-rc.3 | 全仓包版本号升级，无接口变化 |
| `38a6a5c965` | Merge PR #8397（worktree-release-dsh-0.2.2-rc.3） | 合并提交，同上 |

### 12.3 升级指南缺失说明

rc.3 元包的升级指南目录包含 `v0.1.7-rc.2` 至 `v0.2.2-rc.1` 各版本，没有 `v0.2.2-rc.2`。因此 rc.2 → rc.3 没有官方 API 级升级动作；这一结论与 12.4 的契约比对一致。需要说明的是，“没有指南条目”只表示官方未声明破坏性 API 变更，不代表零差异；本节的差异核验以安装树逐文件比对为准。

### 12.4 契约比对结论

对 `/tmp/dsh-trees/rc2` 与 `/tmp/dsh-trees/rc3` 的安装树做逐文件比对（只统计宿主侧 `lib/` 与 `.d.ts` 的语义差异）：

- `dsh-plugin-manager`、`dsh-agent-team`、`dsh-subagent`、`dsh-tool-subagent-control` 的 `lib/` 无差异；`dsh-api-settings-controller`、`dsh-error` 无差异。
- `dsh-api-session-controller/lib/typert.host.js` 只有一处差异：`RemoteErrorDetailsMap` 的声明文本新增 `'deepseekChatImport/owner-only': {};`；该端点不在侧栏消费面内，RPC 形状与错误码集合未变。
- `dsh-session-log-export/lib/index.js` 只有一处变更 hunk（第 300 行附近）：zip 会话导出对不可读或缺失的附件改为容忍，并写入缺失附件清单；`/api/session.markdown` 路由代码（同一文件的 `SESSION_MARKDOWN_EXPORT_PATH` 与处理函数）不在变更 hunk 内，逐字相同。
- `pluginManager/listBundles` 行数从 23 变为 24，新行为完整 bundle 行：`name`、`official: true`、`availability: "installation"`、`version: "0.2.2-rc.3"`、`description`、本地化 `meta.title`/`meta.description`/`meta.icon`、`enabled: false`、`installed: false`、`optional: true`、`removable: false`、`rows` 与 `overrides`；没有 `update`/`updatable` 字段（该 bundle 不可更新）。

结论：**没有必须的侧栏源码适配**；本轮实现改动仅为测试。

### 12.5 24 行 bundle 变化与侧栏兼容测试

- 页面渲染路径：`src/settings-page.mts:693` 用 `bundle.optional` 过滤出 Experimental bundles（`:695` 输出区块标题）；`:704` 的卡片标签为 `bundle.title ?? bundle.name.replace(/^@deepseek-ai\/dsh-/, '')`（真实行有本地化标题，因此显示“DeepSeek chat import”），`:714` 的状态行显示 `Disabled · v0.2.2-rc.3 · Provided by this installation`；**Details…** 按钮与启用开关沿用既有逻辑。新行没有 `update`/`updatable` 字段，因此更新区块不处理它，Experimental bundles 卡片正好覆盖它。
- 投影路径：`src/settings-page-state.ts` 的 `publicBundles` 只按白名单读取 `name/official/optional/availability/installed/enabled/title/version/description/...`，未知字段丢弃；新行在侧栏投影中表现为一个未安装、未启用的可选 bundle。
- 测试改动（实施任务，不在本文件写作用域内）：`tests/settings-page.fixture.ts` 新增 `chatImportBundleFixture()`（按真实 rc.3 行形状，含本地化 `meta`、版本与 `rows`）与 `chatImportPageState()`；`tests/settings-page.spec.ts` 新增 1 个 it，断言新 bundle 出现在 Experimental bundles、卡片显示“DeepSeek chat import”与 `v0.2.2-rc.3`、状态为 Disabled/Provided by this installation、**Details…** 可用且启用开关发送精确的 `set-bundle` 请求（含 `Applying…` 与 `Bundle updated.` 结果）。该用例只新增 1 个执行用例，不改生产代码。

### 12.6 真实运行时探针

环境：隔离 `HOME=/tmp/probe-rc3/home`、`DSH_HOME=/tmp/probe-rc3/dsh`；运行时为 `@deepseek-ai/dsh@0.2.2-rc.3` 的 `lib/bin.js`；`web --host 127.0.0.1 --port 0 --no-open`；Node v26.12.0；探针脚本通过启动 URL token 认证后调用 HTTP RPC。

实测结论：

1. `settings/describe` 返回 22 个命名空间，与 rc.2 相同；`web-deepseek-api` 的 rc.2 计费字段继续存在。新导入插件提供部署配置（`maxSessions`、`maxUploadBytes`、`maxEntryBytes`、`maxTitleBytes`），不新增用户设置命名空间。
2. `pluginManager/listBundles` 返回 24 行；新增行为带本地化标题与版本的可选 bundle 行（`enabled: false`、`installed: false`、`optional: true`），其余 23 行与 rc.2 形状一致。对该 bundle 调用 `pluginManager/setBundleEnabled {name, enabled: true}` 返回 `{changed:true, application:"applied"}`，随后该行 `enabled: true`，再调用 `enabled: false` 也成功；这验证了侧栏启用开关在真实 rc.3 runtime 上对新增 bundle 可用。
3. 新建会话的 projection keys 与 rc.2 相同（22 个），`agentTeam` 为 `{enabled:false,tasks:[]}`；`agentTeams/setEnabled {agentId,enabled:true}` 调用成功并变为 `{enabled:true,tasks:[]}`；`imageLimits` 默认值与 rc.2 相同。
4. `GET /api/session.markdown?sessionId=…` 返回 200、`text/markdown; charset=utf-8`，会话 Markdown 复制路径在 rc.3 下可用。

边界：探针只做非模型 RPC，未执行真实模型对话轮次；未在真实 VS Code 扩展宿主中手工冒烟；未验证导入 UI 的实际导入流程（该界面属 DSH Web 客户端插件）。

### 12.7 隐私与安全

1. 本轮生产代码没有改动，没有新增网络出口、持久化位置或遥测；唯一实现改动是测试夹具与渲染测试。
2. 新 bundle 行包含 `name`、本地化 `meta.title`/`meta.description`/`meta.icon`、`version`、`description`、`rows` 与安装/启用标志；侧栏投影按白名单读取，不读取导入文件、不访问 DeepSeek 服务，也不显示诊断或路径。导入功能的数据流（上传 DeepSeek 导出的压缩包、写入会话）完全在 DSH Web 客户端插件与 runtime 内部完成，不在本扩展功能面内。
3. 既有契约与错误分类未变，`/api/session.markdown` 的只读、仅剪贴板、固定失败文案等边界继续有效（见第 4、5 节）。
4. 桌面更新语句与 CI 缓存变化不改变扩展的信任边界。

### 12.8 验证记录

2026-11-16T14:33–14:36+08:00（本机最终工作树；版本复核于 14:33:48）：

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 通过（退出码 0） |
| `node scripts/build.mjs` | 通过；输出 `dist/extension.js`、`dist/runtime-host.js` 与 Webview bundles |
| `CI=true npx vitest run --config vitest.config.ts` | **132 个测试文件通过；2633 passed / 1 skipped / 0 failed（2634 个用例）** |

- 工作树改动：实施任务 2 个测试文件（`tests/settings-page.fixture.ts`、`tests/settings-page.spec.ts`），加上本任务的 6 个文档与版本文件；无 `src/` 改动。
- 测试增量：在 0.2.2-rc.2.1 已提交基线（2632 个通过用例）上新增 1 个执行用例，全量为 2633。
- 覆盖要点：rc.3 可选 bundle 行在 Experimental bundles 中的出现、包名回退标签、未安装/未启用状态、Details 可用、启用请求与结果文案；其余既有用例全部通过，证明 rc.1/rc.2 双形状行为未受本轮影响。
- **边界声明**：本轮未执行真实模型对话轮次的端到端运行，未在真实 VS Code 扩展宿主中手工冒烟；真实运行时验证限于 12.6 的非模型 RPC 探针；未验证导入 UI 的导入流程。

### 12.9 延后项

| 项目 | 说明 |
|---|---|
| DeepSeek 会话导入 UI | 属 DSH Web 客户端插件功能（上传导出包、预览与写入会话）；侧栏仅列出可选 bundle，不实现导入界面 |
| 其余既有延后项 | 沿用第 11.8 节：Git spec bundle 更新、插件索引 Star/周下载量、模型请求重试设置 UI、工作树审阅 UI、聊天自动加载更早消息、聊天代码差异着色、Agent 终端面板、MCP 动态注册 UI、账号通知 UI、Office/CUA/Live Share/Stagehand、图片 50 MiB 与即时上传、`web/listProviders` 与 `web/providers-changed`、继续生成（空 content prompt）与 `conversationContinuation`、`subagents/prompt` 旧字段清理 |

第 9–12 节分别记录 2026-11-06、2026-11-09、2026-11-13 与 2026-11-16 四个维护轮次；本节为增量记录，第 1–11 节既有事实保持不变。
