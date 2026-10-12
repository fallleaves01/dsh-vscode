# 输入区 UI 补充修正（2026-10-12）

本文记录 `0.1.1` 的修正。后续 `0.1.2` 已将文件提示改成主动添加、可移除的
引用列表，并取消当前文件和选区的自动发送，见 [文件上下文选择说明](FILE-CONTEXT-2026-10-12.md)。

用户指出日常输入区的 `standard / ptc / minimal / cordis / Locked` 和
`deep_ep/buffers/bucket.py` 占用空间过大。前一轮截图没有给主对话设置
`agentPreset` 和 `ide-context`，所以这两块没有进入视觉检查。
子任务详情截图也需要打开子任务后才会出现，不代表默认聊天界面。

查到的直接原因是：preset 和文件提示继承聊天正文的字号和行高；preset 额外加粗，
两块各占一行。只读检查还确认本机 `fallleaves01.dsh-sidebar-0.1.0` 的已安装构建
没有上一轮新任务行和欢迎按钮的代码标记。相同的 `0.1.0` 版本号掩盖了不同构建，
因此这次将插件版本提升为 `0.1.1`。该结论针对本机副本，不代表远端当前加载的副本。

## 修改

- 移除常驻的 preset／Locked 行。预设移入输入框底部盾牌按钮的“Conversation settings”菜单。
  已固定时只显示当前预设和说明；新会话仍可选 standard、ptc、minimal、cordis 等预设。
  即使 runtime 没有 permission catalog，菜单也仍然可用；运行中或切换尚未完成时禁止更换。
- 文件提示单行横向排布，固定为 **11px 字号、18px 行高**；常驻提示只显示 `bucket.py`。
  完整路径保留在悬停说明及可访问名称中，点击打开原路径，选区和诊断定位到起始行。
  选区范围、截断标记和 pinned 引用的移除操作保留。
- 附件和 Plan 标签采用同样紧凑的字号，普通聊天正文的字号仍跟随 VS Code。

## 验证与交付

- `npm run check`：类型检查、生产构建、90 个测试文件、1115 项测试通过；
  当前 macOS 下仍跳过 1 项 Windows 原生 cmd 实机测试。
- `npm run test:scroll-browser`：16 组真实 Chromium 检查通过。
  新增用户提供的预设目录和当前文件状态，在 320×400、420×800、650×800 下，
  即使正文设为 18px，文件提示仍为 11px、高度不超过 30px，发送按钮可见。
  已验证菜单中新会话预设切换和文件定位消息。
- 延续上一轮三主题、任务详情、滚动及输入回归检查。这次没有改 DSH API 和启动逻辑，
  没有重复发起模型或账号请求。
- VSIX 核对版本及构建产物，排除开发文件、截图、source map 和临时 runtime home。

本次日志保存在 `artifacts/ui-review/context-check.log`、`context-browser.log`、
`context-package.log` 和 `context-package-check.json`，前一轮日志仍然保留。

复现预览使用生产 HTML 和脚本，以及用户描述对应的测试状态；聊天正文为示例内容，
不是用户真实对话截屏。预览使用默认正文字号，18px 是单独的布局压力检查。

- [常规输入区预览](../artifacts/ui-review/composer-context.png)
- [展开设置菜单](../artifacts/ui-review/composer-settings.png)
- [安装包：dsh-sidebar-0.1.1.vsix](../artifacts/dsh-sidebar-0.1.1.vsix)

在实际使用的 VS Code 窗口执行 **Extensions: Install from VSIX…** 后
**Developer: Reload Window**，确认扩展版本为 `0.1.1`。Remote SSH 应安装到对应远端。
本轮尚未替换用户已安装的本地或远端扩展。
