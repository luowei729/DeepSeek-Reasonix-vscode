# Project Plan

## 2026-06-23 12:38 +08:00 — VS Code 扩展 UI 重构

### 目标

按“VS Code 风格 + Codicons 图标 + 适度动画”统一 VS Code 扩展聊天页和设置页视觉体验，同时保持现有 ACP、Provider、索引、权限、Review、Cloud Sync 等功能协议不变。

### 范围

- `vscode-extension/src/webview/styles/design-system.css`：封装 VS Code 变量为 Reasonix Webview 设计令牌，统一颜色、间距、圆角、阴影、动画、按钮、输入框、选择框、卡片、消息气泡和状态栏。
- `vscode-extension/src/webview/styles/codicons.css`：补齐本项目实际使用的 Codicons 别名，供聊天工具栏和设置导航复用。
- `vscode-extension/src/webview/assets.ts`：集中生成 Webview 样式资源 URI。
- `vscode-extension/esbuild.mjs`：构建后复制 Webview CSS 到 `dist/webview/styles/`，确保 VSIX 运行时可加载。
- `vscode-extension/src/webview/chat-webview.ts`：欢迎页渐变卡片、消息气泡层次、工具栏 Codicons、适度 hover/淡入动画。
- `vscode-extension/src/webview/settings-webview.ts`：左侧导航 Codicons 和左边框选中态、统一表单控件、面板淡入动画。
- `vscode-extension/src/modules/chat/index.ts`、`vscode-extension/src/modules/settings/index.ts`：为 Webview 注入共享样式 URI，并限制 `localResourceRoots` 到构建产物样式目录。

### 非目标

- 不改 Reasonix 核心 CLI/ACP 逻辑。
- 不改变现有 Webview 消息协议。
- 不涉及部署凭据、GitHub Token、API Key 保存策略。
- 不更新上游 release 用 `CHANGELOG.md`，避免 fork-local UI 改动污染正式发行日志。

### 验证计划

1. `cd vscode-extension && npm run build`
2. `cd vscode-extension && npx tsc --noEmit`
3. `cd vscode-extension && npm test`
4. 如需交付 VSIX：先在根目录运行 `npm run build`，再运行 `cd vscode-extension && npm run package`

### 当前状态

- 代码实现完成。
- 验证通过：
  - 根目录 `npm run build`：通过，用于生成扩展打包依赖的 Reasonix runtime。
  - `npm --prefix /root/DeepSeek-Reasonix-vscode/vscode-extension run build`：通过，已生成 `dist/extension.js` 并复制 Webview CSS。
  - 根目录 `npx tsc --noEmit`：通过。
  - `npx tsc --noEmit -p /root/DeepSeek-Reasonix-vscode/vscode-extension/tsconfig.json`：通过。
  - `npm --prefix /root/DeepSeek-Reasonix-vscode/vscode-extension test`：通过。
  - `npm --prefix /root/DeepSeek-Reasonix-vscode/vscode-extension run package`：通过，产物为 `vscode-extension/dist/reasonix-vscode.vsix`。
