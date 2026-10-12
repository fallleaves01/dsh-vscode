# 任务与子代理功能（2026-10-04）

本轮补齐上次审计列出的八项接入缺口。插件版本仍为 `0.1.0`，交付包使用独立文件名，以保留上次维护包。功能契约与本机官方 DSH `0.2.0-rc.2` 的源码、Typert manifest 交叉核实。

| 功能 | 入口与行为 |
|---|---|
| 子任务并排详情 | 点击输入框上方 Tasks 的子任务行，在编辑器旁打开独立面板。再次点击复用同一面板；主对话不切换，主对话导航也不取消详情观察 |
| 子任务操作 | 面板支持较早消息分页、Thinking、工具输出分页、文件链接、审批、回答问题、Queue、Steer、Stop。Open in chat 可进入原聊天界面使用附件和图片等能力 |
| 恢复提示 | continuable 子任务读取父 agent 的 `agentAvailable`；父任务空闲仍可续聊，父 agent 被释放才显示恢复说明。一次性或未知模式只读，运行中仍能停止 |
| 后台输出 | 顶栏 Background jobs → Project / This chat → Output。独立 `job/follow` 显示 stdout、stderr、log、进度和最终状态，Copy output 复制当前保留的尾部 |
| 项目后台任务 | 扫描当前项目已有会话，包含未访问的会话；并发等待初始快照最多 8 个。运行中的 owner / job 保持观察，闲置会话读取快照后释放。失败明确提示状态可能过期，Refresh 可重试 |
| Goal | Goal & reminders 显示目标、阶段、轮数上限、已开始轮数、进程内 activation 和阻塞原因；支持新建、编辑、暂停、恢复、完成、清空，写操作携带 id/revision 防止覆盖新目标 |
| Schedule | 项目目录显示提醒内容、状态、下一次投递、上次投递；Delivery history 按游标分页，显示保留期限、记录上限和缺失／裁剪提示 |
| Workflow | Tasks 显示已加载历史中的 workflow、阶段分组、成员和记录的结果；点击成员打开详情，View workflow output 可选择对应后台任务查看实时 phase/log。缺失的历史明确标记 Partial history |
| 正文搜索 | 会话选择器搜索框同时过滤标题并请求服务端正文搜索，显示摘要。归档命中提供 Restore；跨项目结果被过滤，旧查询不能覆盖新查询 |

## 默认 runtime 的可选服务

实机检查确认，官方 `0.2.0-rc.2` 标准 Web profile 默认不开正文搜索，且未挂载 Schedule 服务。仅有接口 manifest 或 npm 包，并不表示它已经在当前进程中提供服务。Goal 读取和独立会话观察流默认可用。

插件启动的标准 Web runtime 可以通过 **Configure task services** 打开设置，按需启用：

- `deepseekHarness.enableHistorySearch`：第一次搜索时才打开内存 SQLite 索引；重启进程后索引重新建立。首次搜索可能需要读取历史文件。
- `deepseekHarness.enableSchedule`：挂载官方 Schedule 服务，读取并运行其已有持久化提醒。若自定义配置已挂载 Schedule，应保持此设置关闭，避免重复挂载。

两项默认关闭，需重启 DSH 应用设置；设置不会自动终止正在运行的任务。插件生成私有、稳定路径的临时配置层，保留原有启动参数和调试集成。没有修改现有 DSH_HOME、现有 profile 或本机 VS Code 设置。

外部 runtime 使用自己的配置。可参考 [dsh-task-services.patch.yml](dsh-task-services.patch.yml)，在 **Web 应用参数之前**传入配置层，例如：

```sh
dsh web --patch /absolute/path/to/dsh-task-services.patch.yml --port 0 --no-open
```

该配置层适用于 `0.2.0-rc.2+` 标准 Web profile。自定义 profile 应在自身配置中启用相应服务；已经挂载 Schedule 时去掉示例的 insert 段。插件不会修改或重启外部 runtime。

## 状态与资源边界

- 后台输出观察不调用模型的 read/collect，不推进模型读取游标。每个面板最多保留 **128 KiB、1024 个非空片段**；服务器保留缺口、片段丢失和本地裁剪都会显示提示。Copy output 并非完整日志导出。
- 关闭、重连、刷新和切换项目会释放或替换观察流；重连只恢复观察，不重发消息、不自动创建子任务或重启 runtime。
- Goal 使用发布版的 **round budget**，没有臆造 token budget。目标阶段可持久化，activation 为当前进程内状态；是否继续由 runtime 决定。
- Schedule 历史表示消息已经持久化投递到会话 inbox，不代表模型已经执行完成。此轮提供目录和历史视图；创建／修改提醒仍使用 runtime 的 Schedule 工具。
- Workflow 成员来自持久化 `tool-workflow/*` 事件，实时 phase/log 来自 job 输出。没有假设 workflow run id 等于 job id，也不会按同名任务自动挑选输出流。仅加载部分会话历史时，列表不代表完整运行记录。
- 服务端正文搜索最多返回整个 runtime 的 20 个会话命中，再按当前项目过滤；hasMore 时缩小查询范围，不宣称已经穷尽本项目历史。

## 验证

回归测试覆盖异步旧响应、Goal CAS、投递历史游标、输出字节／片段上限、父 agent 可用性、未访问会话 jobs 发现、观察流清理、主对话切换、独立审批／回答／发送及草稿保留。真实 Chromium 覆盖 320／420／650px 和 400px 高度布局，以及独立面板阅读位置、草稿和原生 Enter。

`npm run test:task-runtime` 启动全新临时 DSH_HOME、加载示例配置层，验证 Goal 读取、Schedule 目录、正文搜索和独立 follow；结束后清理进程和临时目录。没有发送 prompt 或创建 Goal，没有发起付费模型请求。

仍需安装后在实际 VS Code／Remote SSH 使用环境验收。已完成的浏览器、协议和隔离 runtime 检查不能等同于真实集群端到端验证。

最终结果：88 个测试文件、1100 项通过、1 项跳过；TypeScript、构建、真实 Chromium 及隔离 runtime 冒烟通过。交付包：`artifacts/dsh-sidebar-0.1.0-task-features.vsix`。
