/**
 * Kilo Code 风格聊天界面 Webview HTML 生成器
 * 
 * 按照截图中的 Kilo Code UI 设计，包含：
 * - 顶部 Tab 栏（KILO CODE, CODEX, QODER CN, 聊天）
 * - 欢迎界面（Logo、描述、最近会话）
 * - 底部输入区（模型选择器、操作图标）
 * - Worktree 选择器
 * 
 * 保持与现有 ChatModule 的消息协议兼容
 */

import type { WebviewStyleUris } from "./assets";
import type { ChatSessionRecord } from "../modules/chat/history-store";
import type { ProviderConfig } from "../modules/providers/provider-store";

export interface ChatWebviewState {
  active: ChatSessionRecord | undefined;
  sessions: ChatSessionRecord[];
  provider: ProviderConfig;
  busy: boolean;
}

/**
 * 生成 Kilo Code 风格聊天界面 HTML
 * 保持与现有 ChatController 的消息处理逻辑兼容
 */
export function renderKiloChatHtml(state: ChatWebviewState, styles?: WebviewStyleUris): string {
  const boot = JSON.stringify(state).replace(/</g, "\\u003c");
  
  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kilo Code Chat</title>
  ${renderStyleLinks(styles)}
  <style>
    /* 基础变量 - 使用 VS Code 主题色 */
    :root {
      color-scheme: dark light;
      --kilo-yellow: #f0db4f;
      --kilo-yellow-dark: #d4c03a;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
    }
    
    .shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      min-width: 0;
    }
    
    /* 顶部 Tab 栏 - 匹配 Kilo Code 截图 */
    .tabbar {
      display: flex;
      align-items: center;
      gap: 0;
      min-height: 36px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 0 8px;
    }
    
    .tab {
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      border: none;
      background: transparent;
      text-transform: uppercase;
      position: relative;
    }
    
    .tab:hover {
      color: var(--vscode-foreground);
    }
    
    .tab.active {
      color: var(--vscode-foreground);
    }
    
    .tab.active::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--vscode-focusBorder);
    }
    
    /* 主内容区 */
    .main {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    /* 欢迎界面 - 匹配 Kilo Code 截图 */
    .welcome {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow: auto;
    }
    
    .welcome.hidden { display: none; }
    
    .logo {
      width: 64px;
      height: 64px;
      background: var(--kilo-yellow);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
    }
    
    .welcome-title {
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      line-height: 1.6;
      margin-bottom: 24px;
      max-width: 320px;
    }
    
    /* 最近会话列表 */
    .recent-section {
      width: 100%;
      max-width: 360px;
      margin-bottom: 16px;
    }
    
    .recent-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    
    .recent-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .recent-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }
    
    .recent-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .recent-item-title {
      font-size: 13px;
      color: var(--vscode-foreground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    
    .recent-item-time {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-left: 12px;
    }
    
    /* 操作按钮 */
    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
    }
    
    .btn-history {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 13px;
      cursor: pointer;
    }
    
    .btn-history:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .btn-feedback {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px dashed var(--vscode-focusBorder);
      background: transparent;
      color: var(--vscode-focusBorder);
      font-size: 13px;
      cursor: pointer;
    }
    
    .btn-feedback:hover {
      background: color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent);
    }
    
    /* 聊天消息区 */
    .feed-wrap {
      flex: 1;
      overflow: hidden;
      display: none;
    }
    
    .feed-wrap.active { display: flex; flex-direction: column; }
    
    .feed {
      flex: 1;
      overflow: auto;
      padding: 14px 12px 18px;
      display: flex;
      flex-direction: column;
    }
    
    .msg-row {
      display: flex;
      width: 100%;
      margin: 0 0 8px;
    }
    
    .msg-row.user { justify-content: flex-end; }
    .msg-row.assistant { justify-content: flex-start; }
    
    .msg {
      max-width: 88%;
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      border-radius: 14px;
      padding: 10px 14px;
      white-space: pre-wrap;
      line-height: 1.55;
    }
    
    .msg-row.user .msg {
      background: color-mix(in srgb, var(--vscode-button-background) 22%, var(--vscode-input-background));
      border-bottom-right-radius: 4px;
    }
    
    .msg-row.assistant .msg {
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, var(--vscode-sideBar-background));
      border-bottom-left-radius: 4px;
    }
    
    /* 工具调用状态 - 默认折叠显示 */
    .tool-call {
      margin: 4px 0;
      padding: 6px 10px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 40%, transparent);
      border: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    
    .tool-call summary {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .tool-call summary:hover {
      color: var(--vscode-foreground);
    }
    
    .tool-call .tool-content {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: pre-wrap;
      max-height: 150px;
      overflow: auto;
    }
    
    .tool-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    
    .tool-status-icon {
      font-size: 10px;
    }
    
    .tool-status.working {
      color: var(--vscode-charts-yellow);
    }
    
    .tool-status.done {
      color: var(--vscode-testing-iconPassed);
    }
    
    .msg.system { color: var(--vscode-editorError-foreground); }
    
    .msg-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    
    /* 思考面板 */
    .thinking {
      margin: 6px 0 8px;
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 60%, transparent);
    }
    
    .thinking summary {
      padding: 6px 12px;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      user-select: none;
    }
    
    .thinking .body {
      padding: 8px 14px;
      max-height: 220px;
      overflow: auto;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      white-space: pre-wrap;
      line-height: 1.5;
      border-top: 1px solid var(--vscode-panel-border);
    }
    
    /* 自动折叠开关 */
    .auto-collapse-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      border-radius: 4px;
    }
    
    .auto-collapse-toggle:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .toggle-switch {
      position: relative;
      width: 28px;
      height: 16px;
      background: var(--vscode-input-border);
      border-radius: 8px;
      transition: background 0.2s;
    }
    
    .toggle-switch.active {
      background: var(--vscode-focusBorder);
    }
    
    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    
    .toggle-switch.active::after {
      transform: translateX(12px);
    }
    
    /* 底部输入区 - 匹配 Kilo Code 截图 */
    .bottom-bar {
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    
    /* Worktree 选择器 */
    .worktree-bar {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .worktree-select {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--vscode-foreground);
      cursor: pointer;
    }
    
    .worktree-select:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    /* 输入框容器 */
    .composer {
      padding: 8px 12px 10px;
    }
    
    .composer-input {
      width: 100%;
      min-height: 44px;
      max-height: 120px;
      padding: 10px 12px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      resize: none;
      outline: none;
    }
    
    .composer-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    
    .composer-input::placeholder {
      color: var(--vscode-descriptionForeground);
    }
    
    /* 底部工具栏 */
    .composer-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      padding: 0 2px;
    }
    
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .mode-select {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--vscode-foreground);
      cursor: pointer;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
    }
    
    .mode-select:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    
    .model-select {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--vscode-foreground);
      cursor: pointer;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .model-select:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    
    .icon-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      border: none;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 14px;
    }
    
    .icon-btn:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-foreground);
    }
    
    .send-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      border: none;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 14px;
    }
    
    .send-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    /* 状态栏 */
    .status-bar {
      padding: 4px 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      border-top: 1px solid var(--vscode-panel-border);
      transition: color 0.2s;
    }
    
    .status-bar.working {
      color: var(--vscode-charts-yellow);
    }
    
    .status-bar.done {
      color: var(--vscode-testing-iconPassed);
    }
    
    /* 响应式 */
    @media (max-width: 400px) {
      .tab { padding: 8px 10px; font-size: 10px; }
      .model-select { max-width: 120px; }
    }
  </style>
</head>
<body class="rx-webview">
  <div class="shell rx-shell">
    <!-- 顶部 Tab 栏 -->
    <nav class="tabbar">
      <button class="tab active" data-tab="kilo">KILO CODE</button>
      <button class="tab" data-tab="codex">CODEX</button>
      <button class="tab" data-tab="qoder">QODER CN</button>
      <button class="tab" data-tab="chat">聊天</button>
      <span style="flex: 1;"></span>
      <!-- 自动折叠开关 -->
      <div class="auto-collapse-toggle" id="autoCollapseToggle" title="自动折叠思考过程">
        <span>自动折叠</span>
        <div class="toggle-switch active" id="autoCollapseSwitch"></div>
      </div>
    </nav>
    
    <!-- 主内容区 -->
    <div class="main">
      <!-- 欢迎界面 -->
      <div class="welcome rx-welcome-gradient" id="welcome">
        <section class="welcome-card rx-welcome-card rx-card rx-animate-fade-in">
        <div class="logo">R</div>
        <div class="welcome-title">
          Kilo Code 是一个 AI 编程助手。让它帮你构建功能、修复 bug 或解释代码库。
        </div>
        
        <!-- 最近会话 -->
        <div class="recent-section" id="recentSection">
          <div class="recent-label">最近</div>
          <div class="recent-list" id="recentList"></div>
        </div>
        
        <!-- 操作按钮 -->
        <div class="action-buttons">
          <button class="btn-history rx-btn rx-btn-ghost rx-toolbar-button" id="btnHistory">
            <span class="rx-icon icon-history" aria-hidden="true"></span> 显示历史
          </button>
          <button class="btn-feedback rx-btn rx-btn-secondary rx-toolbar-button" id="btnFeedback">
            <span class="rx-icon icon-comment" aria-hidden="true"></span> 反馈与支持
          </button>
        </div>
        </section>
      </div>
      
      <!-- 聊天消息区 -->
      <div class="feed-wrap" id="feedWrap">
        <div class="feed" id="feed"></div>
      </div>
    </div>
    
    <!-- 底部输入区 -->
    <div class="bottom-bar">
      <!-- Worktree 选择器 -->
      <div class="worktree-bar">
        <div class="worktree-select rx-toolbar-button" id="worktreeSelect">
          <span class="rx-icon icon-branch" aria-hidden="true"></span> 新 Worktree <span class="rx-icon icon-dropdown" aria-hidden="true"></span>
        </div>
      </div>
      
      <!-- 输入框 -->
      <div class="composer">
        <textarea 
          class="composer-input rx-input" 
          id="input" 
          placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
        ></textarea>
        
        <!-- 底部工具栏 -->
        <div class="composer-toolbar">
          <div class="toolbar-left">
            <button class="mode-select rx-toolbar-button" id="modeSelect">
              <span class="rx-icon icon-code" aria-hidden="true"></span> Code <span class="rx-icon icon-dropdown" aria-hidden="true"></span>
            </button>
            <button class="model-select rx-toolbar-button" id="modelSelect">
              <span class="rx-icon icon-model" aria-hidden="true"></span> <span id="modelLabel">Alibaba (China) / Qwen3.7 Max</span> <span class="rx-icon icon-dropdown" aria-hidden="true"></span>
            </button>
          </div>
          <div class="toolbar-right">
            <button class="icon-btn rx-icon-button" id="btnDocs" title="文档" aria-label="文档"><span class="rx-icon icon-docs" aria-hidden="true"></span></button>
            <button class="icon-btn rx-icon-button" id="btnApprove" title="自动审批" aria-label="自动审批"><span class="rx-icon icon-approve" aria-hidden="true"></span></button>
            <button class="icon-btn rx-icon-button" id="btnTools" title="工具" aria-label="工具"><span class="rx-icon icon-tools" aria-hidden="true"></span></button>
            <button class="icon-btn rx-icon-button" id="btnVoice" title="语音输入" aria-label="语音输入"><span class="rx-icon icon-voice" aria-hidden="true"></span></button>
            <button class="send-btn rx-icon-button" id="sendBtn" title="发送" aria-label="发送"><span class="rx-icon icon-send" aria-hidden="true"></span></button>
          </div>
        </div>
      </div>
      
      <!-- 状态栏 -->
      <div class="status-bar rx-status-bar" id="statusBar">就绪</div>
    </div>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    
    // 状态管理
    let state = ${boot};
    let assistantBody = null;
    let assistantRow = null;
    let thinkingNode = null;
    let thinkingBody = null;
    let autoCollapseEnabled = true; // 默认开启自动折叠
    
    // DOM 元素
    const welcome = document.getElementById('welcome');
    const feedWrap = document.getElementById('feedWrap');
    const feed = document.getElementById('feed');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const statusBar = document.getElementById('statusBar');
    const recentList = document.getElementById('recentList');
    const recentSection = document.getElementById('recentSection');
    const modelLabel = document.getElementById('modelLabel');
    
    // 渲染最近会话列表
    function renderRecentSessions() {
      const sessions = state.sessions || [];
      const recent = sessions.slice(0, 5); // 只显示最近 5 个
      
      if (recent.length === 0) {
        recentSection.style.display = 'none';
        return;
      }
      
      recentSection.style.display = 'block';
      recentList.innerHTML = recent.map(session => {
        const time = formatTimeAgo(session.updatedAt);
        return \`
          <div class="recent-item" data-session-id="\${session.id}">
            <span class="recent-item-title">\${escapeHtml(session.title)}</span>
            <span class="recent-item-time">\${time}</span>
          </div>
        \`;
      }).join('');
      
      // 绑定点击事件
      recentList.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', () => {
          const sessionId = item.dataset.sessionId;
          vscode.postMessage({ command: 'selectSession', sessionId });
        });
      });
    }
    
    // 格式化相对时间
    function formatTimeAgo(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return '今天';
      if (diffDays === 1) return '昨天';
      if (diffDays < 7) return \`\${diffDays}天前\`;
      if (diffDays < 30) return \`\${Math.floor(diffDays / 7)}周前\`;
      return \`\${Math.floor(diffDays / 30)}月前\`;
    }
    
    // 更新界面状态
    function updateUI() {
      // 更新模型标签
      if (state.provider) {
        modelLabel.textContent = \`\${state.provider.name} / \${state.provider.model}\`;
      }
      
      // 判断是否显示欢迎界面
      const hasMessages = state.active && state.active.messages && state.active.messages.length > 0;
      
      if (hasMessages) {
        welcome.classList.add('hidden');
        feedWrap.classList.add('active');
        renderMessages();
      } else {
        welcome.classList.remove('hidden');
        feedWrap.classList.remove('active');
        renderRecentSessions();
      }
      
      // 更新发送按钮状态
      sendBtn.disabled = state.busy;
    }
    
    // 渲染消息列表
    function renderMessages() {
      feed.innerHTML = '';
      const messages = (state.active && state.active.messages) || [];
      
      for (const msg of messages) {
        appendMessage(msg.role, msg.role === 'user' ? '你' : 'Kilo', msg.text, false);
      }
      
      feed.scrollTop = feed.scrollHeight;
    }
    
    // 添加消息
    function appendMessage(kind, label, text, scroll = true) {
      const row = document.createElement('div');
      const rowKind = kind === 'user' ? 'user' : 'assistant';
      row.className = 'msg-row rx-animate-fade-in ' + rowKind;
      
      const msg = document.createElement('div');
      msg.className = 'msg rx-message ' + (rowKind === 'user' ? 'rx-message-user ' : 'rx-message-assistant ') + kind;
      
      const meta = document.createElement('div');
      meta.className = 'msg-meta rx-message-meta';
      meta.textContent = label || kind;
      
      const body = document.createElement('div');
      body.textContent = text || '';
      
      msg.append(meta, body);
      row.append(msg);
      feed.append(row);
      
      if (scroll) feed.scrollTop = feed.scrollHeight;
      return { row, body };
    }
    
    // 添加工具调用状态（默认折叠）
    function appendToolCall(toolName, detail, isWorking = true) {
      const row = document.createElement('div');
      row.className = 'msg-row assistant rx-animate-fade-in';
      
      const toolCall = document.createElement('details');
      toolCall.className = 'tool-call rx-tool-call';
      toolCall.open = false; // 默认折叠
      
      const summary = document.createElement('summary');
      const statusIcon = document.createElement('span');
      statusIcon.className = 'tool-status-icon rx-icon ' + (isWorking ? 'icon-loading' : 'icon-done');
      
      const statusText = document.createElement('span');
      statusText.className = 'tool-status ' + (isWorking ? 'working' : 'done');
      statusText.textContent = isWorking ? '编辑中' : '已完成';
      
      const toolNameSpan = document.createElement('span');
      toolNameSpan.textContent = ' · ' + toolName;
      
      summary.append(statusIcon, statusText, toolNameSpan);
      
      const content = document.createElement('div');
      content.className = 'tool-content rx-tool-call-content';
      content.textContent = detail || '';
      
      toolCall.append(summary, content);
      row.append(toolCall);
      feed.append(row);
      feed.scrollTop = feed.scrollHeight;
      
      return { row, toolCall, summary, statusText, statusIcon };
    }
    
    // 确保思考面板存在
    function ensureThinking() {
      if (thinkingNode) return;
      
      thinkingNode = document.createElement('details');
      thinkingNode.className = 'thinking rx-thinking rx-animate-fade-in';
      // 根据自动折叠设置决定初始状态
      thinkingNode.open = !autoCollapseEnabled;
      
      const summary = document.createElement('summary');
      summary.textContent = '思考中…';
      
      thinkingBody = document.createElement('div');
      thinkingBody.className = 'body rx-thinking-body';
      
      thinkingNode.append(summary, thinkingBody);
      feed.insertBefore(thinkingNode, assistantRow || null);
      feed.scrollTop = feed.scrollHeight;
    }
    
    // 完成思考
    function finalizeThinking(text) {
      if (!thinkingNode) return;
      
      const summary = thinkingNode.querySelector('summary');
      if (summary) summary.textContent = '思考过程 (' + (text || '').length + ' 字)';
      // 根据自动折叠设置决定最终状态
      thinkingNode.open = !autoCollapseEnabled;
      thinkingNode = null;
      thinkingBody = null;
    }
    
    // 发送消息
    function submit() {
      const text = input.value.trim();
      if (!text || state.busy) return;
      
      input.value = '';
      vscode.postMessage({ command: 'send', text });
    }
    
    // Tab 切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const tabName = tab.dataset.tab;
        vscode.postMessage({ command: 'switchTab', tab: tabName });
      });
    });
    
    // 显示历史
    document.getElementById('btnHistory').addEventListener('click', () => {
      vscode.postMessage({ command: 'pickSession' });
    });
    
    // 反馈与支持
    document.getElementById('btnFeedback').addEventListener('click', () => {
      vscode.postMessage({ command: 'openSettings' });
    });
    
    // Worktree 选择
    document.getElementById('worktreeSelect').addEventListener('click', () => {
      vscode.postMessage({ command: 'newWorktree' });
    });
    
    // 模式选择
    document.getElementById('modeSelect').addEventListener('click', () => {
      vscode.postMessage({ command: 'selectMode' });
    });
    
    // 模型选择
    document.getElementById('modelSelect').addEventListener('click', () => {
      vscode.postMessage({ command: 'selectModel' });
    });
    
    // 工具栏按钮
    document.getElementById('btnDocs').addEventListener('click', () => {
      vscode.postMessage({ command: 'openDocs' });
    });
    
    document.getElementById('btnApprove').addEventListener('click', () => {
      vscode.postMessage({ command: 'openPermissions' });
    });
    
    document.getElementById('btnTools').addEventListener('click', () => {
      vscode.postMessage({ command: 'openTools' });
    });
    
    document.getElementById('btnVoice').addEventListener('click', () => {
      vscode.postMessage({ command: 'voiceInput' });
    });
    
    // 自动折叠开关
    const autoCollapseToggle = document.getElementById('autoCollapseToggle');
    const autoCollapseSwitch = document.getElementById('autoCollapseSwitch');
    
    autoCollapseToggle.addEventListener('click', () => {
      autoCollapseEnabled = !autoCollapseEnabled;
      autoCollapseSwitch.classList.toggle('active', autoCollapseEnabled);
      
      // 立即应用到所有已存在的思考面板
      document.querySelectorAll('.thinking').forEach(node => {
        // 只折叠已完成的思考面板（有"思考过程"文字的）
        const summary = node.querySelector('summary');
        if (summary && summary.textContent.includes('思考过程')) {
          node.open = !autoCollapseEnabled;
        }
      });
      
      vscode.postMessage({ 
        command: 'toggleAutoCollapse', 
        enabled: autoCollapseEnabled 
      });
    });
    
    // 发送按钮
    sendBtn.addEventListener('click', submit);
    
    // 输入框快捷键
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    
    // 接收扩展消息
    window.addEventListener('message', (event) => {
      const message = event.data;
      
      if (message.type === 'state') {
        state = {
          ...state,
          active: message.active,
          sessions: message.sessions,
          provider: message.provider || state.provider,
          busy: !!message.busy
        };
        updateUI();
      }
      
      if (message.type === 'assistantStart') {
        thinkingNode = null;
        thinkingBody = null;
        assistantRow = null;
        
        const assistant = appendMessage('assistant', 'Kilo', '');
        assistantBody = assistant.body;
        assistantRow = assistant.row;
        
        welcome.classList.add('hidden');
        feedWrap.classList.add('active');
      }
      
      if (message.type === 'assistantDelta' && assistantBody) {
        assistantBody.textContent += message.text;
        feed.scrollTop = feed.scrollHeight;
      }
      
      if (message.type === 'thinkingChunk') {
        ensureThinking();
        if (thinkingBody) thinkingBody.textContent += message.text;
        statusBar.textContent = '思考中…';
        statusBar.className = 'status-bar rx-status-bar working';
      }
      
      if (message.type === 'thinkingEnd') {
        finalizeThinking(message.text);
        statusBar.textContent = '思考完成';
        statusBar.className = 'status-bar rx-status-bar done';
      }
      
      if (message.type === 'assistantDone') {
        if (thinkingNode) finalizeThinking('');
        assistantRow = null;
        statusBar.textContent = '完成 · ' + (message.stopReason || '');
        statusBar.className = 'status-bar rx-status-bar done';
        state.busy = false;
        sendBtn.disabled = false;
      }
      
      if (message.type === 'status') {
        statusBar.textContent = message.message;
        statusBar.className = 'status-bar rx-status-bar';
      }
      
      if (message.type === 'tool') {
        // 解析工具调用消息，显示为折叠状态
        const toolMsg = message.message || '';
        let toolName = 'tool';
        let detail = '';
        let isWorking = true;
        
        // 解析工具名称和状态
        if (toolMsg.includes(':')) {
          const parts = toolMsg.split(':');
          toolName = parts[0].trim();
          detail = parts.slice(1).join(':').trim();
        } else {
          detail = toolMsg;
        }
        
        // 判断是否完成
        if (detail.includes('in_progress') || detail.includes('working')) {
          isWorking = true;
          detail = detail.replace(/in_progress|working/g, '').trim();
        } else if (detail.includes('done') || detail.includes('completed') || detail.includes('success')) {
          isWorking = false;
          detail = detail.replace(/done|completed|success/g, '').trim();
        }
        
        appendToolCall(toolName, detail, isWorking);
      }
      
      if (message.type === 'error') {
        appendMessage('assistant', 'error', '[错误] ' + message.message);
        state.busy = false;
        sendBtn.disabled = false;
      }
      
      if (message.type === 'providerSaved') {
        if (message.provider) {
          state.provider = message.provider;
          modelLabel.textContent = \`\${message.provider.name} / \${message.provider.model}\`;
        }
      }
      
      if (message.type === 'openSettings') {
        vscode.postMessage({ command: 'openSettings' });
      }
    });
    
    // 初始化
    updateUI();
  </script>
</body>
</html>`;
}

function renderStyleLinks(styles?: WebviewStyleUris): string {
  if (!styles) return "";
  return `<link rel="stylesheet" href="${escapeHtml(styles.designSystemCss)}" />\n  <link rel="stylesheet" href="${escapeHtml(styles.codiconsCss)}" />`;
}

/** HTML 转义 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
