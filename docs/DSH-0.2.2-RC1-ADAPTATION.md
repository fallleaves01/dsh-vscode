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
