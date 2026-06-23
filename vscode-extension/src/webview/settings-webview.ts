/**
 * Kilo Code 风格设置界面 Webview HTML 生成器
 * 
 * 按照截图中的 Kilo Code Settings UI 设计，包含：
 * - 左侧导航栏（15 个分类）
 * - 右侧配置面板
 * - 本地/全局配置切换
 * 
 * 保持与现有 SettingsModule 的消息协议兼容
 */

import type { WebviewStyleUris } from "./assets";
import type { ProviderConfig } from "../modules/providers/provider-store";
import type { CloudSyncConfig } from "../modules/cloud-sync/sync-types";

export interface SettingsWebviewState {
  provider: ProviderConfig;
  cloudSync: CloudSyncConfig;
  hasGithubToken: boolean;
}

/** 设置分类定义 - 匹配 Kilo Code 截图中的左侧导航 */
export const SETTINGS_CATEGORIES = [
  { id: "models", label: "模型", icon: "icon-model" },
  { id: "providers", label: "提供商", icon: "icon-provider" },
  { id: "agent-behavior", label: "智能体行为", icon: "icon-robot" },
  { id: "auto-approve", label: "自动审批", icon: "icon-approve" },
  { id: "browser", label: "浏览器", icon: "icon-browser" },
  { id: "checkpoints", label: "检查点", icon: "icon-save" },
  { id: "display", label: "显示", icon: "icon-eye" },
  { id: "autocomplete", label: "自动补全", icon: "icon-keyboard" },
  { id: "notifications", label: "通知", icon: "icon-notification" },
  { id: "context", label: "上下文", icon: "icon-context" },
  { id: "commit-message", label: "Commit Message", icon: "icon-git-commit" },
  { id: "indexing", label: "索引", icon: "icon-index" },
  { id: "experimental", label: "实验性功能", icon: "icon-experiment" },
  { id: "language", label: "语言", icon: "icon-language" },
  { id: "about", label: "关于 Kilo Code", icon: "icon-about" },
] as const;

export type SettingsCategory = typeof SETTINGS_CATEGORIES[number]["id"];

/**
 * 生成 Kilo Code 风格设置界面 HTML
 * 保持与现有 SettingsModule 的消息处理逻辑兼容
 */
export function renderKiloSettingsHtml(
  state: SettingsWebviewState,
  activeCategory: SettingsCategory = "models",
  styles?: WebviewStyleUris,
): string {
  const boot = JSON.stringify({ ...state, activeCategory }).replace(/</g, "\\u003c");
  const categories = JSON.stringify(SETTINGS_CATEGORIES).replace(/</g, "\\u003c");
  
  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kilo Settings</title>
  ${renderStyleLinks(styles)}
  <style>
    /* 基础变量 */
    :root {
      color-scheme: dark light;
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
    }
    
    /* 顶部标题栏 */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    
    .header-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
    }
    
    .header-logo {
      width: 24px;
      height: 24px;
      background: #f0db4f;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: #1a1a1a;
    }
    
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .config-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    
    .config-toggle-btn {
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      font-size: 12px;
    }
    
    .config-toggle-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    
    .config-toggle-btn:hover:not(.active) {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    
    /* 主布局 */
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    
    /* 左侧导航栏 */
    .sidebar {
      width: 200px;
      border-right: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      overflow-y: auto;
      padding: 8px 0;
    }
    
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      font-size: 13px;
      color: var(--vscode-foreground);
      cursor: pointer;
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
    }
    
    .nav-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .nav-item.active {
      background: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent);
      color: var(--vscode-foreground);
    }
    
    .nav-item.active::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--vscode-focusBorder);
      border-radius: 0 2px 2px 0;
    }

    .nav-icon {
      width: 18px;
      text-align: center;
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
    }
    
    /* 右侧内容区 */
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
    }
    
    .content-header {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    /* 设置项 */
    .setting-group {
      margin-bottom: 24px;
    }
    
    .setting-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent);
    }
    
    .setting-info {
      flex: 1;
      min-width: 0;
    }
    
    .setting-label {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    
    .setting-description {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    
    .setting-control {
      margin-left: 16px;
      flex-shrink: 0;
    }
    
    /* 表单控件 */
    .select-control {
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      cursor: pointer;
      min-width: 140px;
    }
    
    .select-control:hover {
      border-color: var(--vscode-focusBorder);
    }
    
    /* 模式选择区域 */
    .mode-section {
      margin-top: 24px;
    }
    
    .mode-section-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    
    .mode-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 30%, transparent);
    }
    
    .mode-label {
      font-size: 13px;
      color: var(--vscode-foreground);
    }
    
    /* 提供商表单 */
    .provider-form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    
    .form-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    
    .form-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    
    .form-input {
      padding: 8px 10px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 13px;
    }
    
    .form-input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    
    .save-btn {
      padding: 8px 16px;
      border-radius: 4px;
      border: none;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    
    .save-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    /* 状态提示 */
    .status-line {
      margin-top: 12px;
      font-size: 12px;
      color: var(--vscode-testing-iconPassed);
    }
    
    /* 空状态 */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
      color: var(--vscode-descriptionForeground);
    }
    
    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    
    .empty-text {
      font-size: 14px;
    }
    
    /* 响应式 */
    @media (max-width: 768px) {
      .sidebar { width: 160px; }
      .content { padding: 16px; }
      .provider-form { grid-template-columns: 1fr; }
    }
    
    @media (max-width: 480px) {
      .sidebar { display: none; }
      .content { padding: 12px; }
    }
  </style>
</head>
<body class="rx-webview">
  <div class="shell rx-shell">
    <!-- 顶部标题栏 -->
    <header class="header">
      <div class="header-title">
        <div class="header-logo">K</div>
        <span>Kilo Settings</span>
      </div>
      <div class="header-actions">
        <div class="config-toggle">
          <button class="config-toggle-btn rx-btn rx-btn-primary active" data-scope="local">本地配置</button>
          <button class="config-toggle-btn rx-btn rx-btn-secondary" data-scope="global">全局配置</button>
        </div>
      </div>
    </header>
    
    <!-- 主布局 -->
    <div class="main">
      <!-- 左侧导航栏 -->
      <nav class="sidebar" id="sidebar">
        ${SETTINGS_CATEGORIES.map(cat => `
          <button class="nav-item rx-nav-item ${cat.id === activeCategory ? 'active' : ''}" data-category="${cat.id}">
            <span class="nav-icon rx-nav-icon rx-icon ${cat.icon}" aria-hidden="true"></span>
            <span>${cat.label}</span>
          </button>
        `).join('')}
      </nav>
      
      <!-- 右侧内容区 -->
      <main class="content" id="content">
        <!-- 动态渲染内容 -->
      </main>
    </div>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    
    // 状态管理
    let state = ${boot};
    const SETTINGS_CATEGORIES = ${categories};
    let configScope = 'local'; // 'local' | 'global'
    
    // DOM 元素
    const content = document.getElementById('content');
    const sidebar = document.getElementById('sidebar');
    
    // 渲染内容面板
    function renderContent(category) {
      state.activeCategory = category;
      
      switch (category) {
        case 'models':
          renderModelsPanel();
          break;
        case 'providers':
          renderProvidersPanel();
          break;
        case 'indexing':
          renderIndexingPanel();
          break;
        case 'about':
          renderAboutPanel();
          break;
        default:
          renderEmptyPanel(category);
      }
    }
    
    // 模型设置面板 - 匹配截图
    function renderModelsPanel() {
      content.innerHTML = \`
        <section class="settings-panel rx-fade-panel">
        <h2 class="content-header">模型</h2>
        
        <div class="setting-group">
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">默认模型</div>
              <div class="setting-description">对话的主要模型</div>
            </div>
            <div class="setting-control">
              <select class="select-control rx-select" id="defaultModel">
                <option value="">未设置（使用服务器默认）</option>
              </select>
            </div>
          </div>
          
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">小模型</div>
              <div class="setting-description">用于标题生成、提交信息生成、提示词增强和其他快速任务的轻量模型</div>
            </div>
            <div class="setting-control">
              <select class="select-control rx-select" id="smallModel">
                <option value="">未设置（使用服务器默认）</option>
              </select>
            </div>
          </div>
          
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">子代理模型</div>
              <div class="setting-description">task-tool 子代理的默认模型和推理工作量。留空以继承调用代理的模型。</div>
            </div>
            <div class="setting-control">
              <select class="select-control rx-select" id="subagentModel">
                <option value="">未设置（使用服务器默认）</option>
              </select>
            </div>
          </div>
          
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">自动补全模型</div>
              <div class="setting-description">选择用于内联代码补全的模型</div>
            </div>
            <div class="setting-control">
              <select class="select-control rx-select" id="autocompleteModel">
                <option value="">未设置（使用服务器默认）</option>
              </select>
            </div>
          </div>
        </div>
        
        <div class="mode-section">
          <div class="mode-section-title">按模式选择模型</div>
          
          <div class="mode-item">
            <span class="mode-label">Code</span>
            <select class="select-control rx-select" id="modeCode">
              <option value="">未设置（使用服务器默认）</option>
            </select>
          </div>
          
          <div class="mode-item">
            <span class="mode-label">Ask</span>
            <select class="select-control rx-select" id="modeAsk">
              <option value="">未设置（使用服务器默认）</option>
            </select>
          </div>
          
          <div class="mode-item">
            <span class="mode-label">Debug</span>
            <select class="select-control rx-select" id="modeDebug">
              <option value="">未设置（使用服务器默认）</option>
            </select>
          </div>
          
          <div class="mode-item">
            <span class="mode-label">Orchestrator</span>
            <select class="select-control rx-select" id="modeOrchestrator">
              <option value="">未设置（使用服务器默认）</option>
            </select>
          </div>
          
          <div class="mode-item">
            <span class="mode-label">Plan</span>
            <select class="select-control rx-select" id="modePlan">
              <option value="">未设置（使用服务器默认）</option>
            </select>
          </div>
        </div>
        </section>
      \`;
    }
    
    // 提供商设置面板
    function renderProvidersPanel() {
      const provider = state.provider || {};
      
      content.innerHTML = \`
        <section class="settings-panel rx-fade-panel">
        <h2 class="content-header">提供商</h2>
        
        <div class="provider-form">
          <div class="form-field">
            <label class="form-label">供应商名称</label>
            <input class="form-input rx-input" id="providerName" value="\${escapeHtml(provider.name || '')}" placeholder="DeepSeek" />
          </div>
          
          <div class="form-field">
            <label class="form-label">API Base URL</label>
            <input class="form-input rx-input" id="providerBaseUrl" value="\${escapeHtml(provider.baseUrl || '')}" placeholder="https://api.deepseek.com" />
          </div>
          
          <div class="form-field">
            <label class="form-label">默认模型</label>
            <input class="form-input rx-input" id="providerModel" value="\${escapeHtml(provider.model || '')}" placeholder="deepseek-v4-flash" />
          </div>
          
          <div class="form-field">
            <label class="form-label">API Key / Token</label>
            <input class="form-input rx-input" id="providerApiKey" type="password" placeholder="留空保持已保存 Token" />
          </div>
          
          <div class="form-field">
            <label class="form-label">推理深度</label>
            <select class="select-control rx-select" id="providerReasoningEffort">
              <option value="default" \${provider.reasoningEffort === 'default' ? 'selected' : ''}>默认</option>
              <option value="high" \${provider.reasoningEffort === 'high' ? 'selected' : ''}>high</option>
              <option value="max" \${provider.reasoningEffort === 'max' ? 'selected' : ''}>max</option>
            </select>
          </div>
          
          <div class="form-field">
            <label class="form-label">思考链 (thinking)</label>
            <select class="select-control rx-select" id="providerThinking">
              <option value="enabled" \${provider.thinking === 'enabled' ? 'selected' : ''}>开启</option>
              <option value="disabled" \${provider.thinking === 'disabled' ? 'selected' : ''}>关闭</option>
            </select>
          </div>
        </div>
        
        <button class="save-btn rx-btn rx-btn-primary" id="saveProvider">保存聊天配置</button>
        <div class="status-line" id="providerStatus">当前：\${escapeHtml(provider.name || '')} / \${escapeHtml(provider.model || '')}</div>
        </section>
      \`;
      
      // 绑定保存事件
      document.getElementById('saveProvider').addEventListener('click', () => {
        vscode.postMessage({
          command: 'saveProvider',
          provider: {
            name: document.getElementById('providerName').value.trim(),
            baseUrl: document.getElementById('providerBaseUrl').value.trim(),
            model: document.getElementById('providerModel').value.trim(),
            apiKey: document.getElementById('providerApiKey').value.trim(),
            reasoningEffort: document.getElementById('providerReasoningEffort').value,
            thinking: document.getElementById('providerThinking').value,
          },
        });
      });
    }
    
    // 索引设置面板
    function renderIndexingPanel() {
      content.innerHTML = \`
        <section class="settings-panel rx-fade-panel">
        <h2 class="content-header">索引</h2>
        
        <div class="setting-group">
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">代码索引</div>
              <div class="setting-description">使用 Reasonix 原生 reasonix index 构建当前工作区语义索引，增强描述式代码搜索能力。</div>
            </div>
            <div class="setting-control">
              <button class="save-btn rx-btn rx-btn-primary" data-command="openIndexing">打开索引面板</button>
            </div>
          </div>
        </div>
        </section>
      \`;
      
      // 绑定命令
      content.querySelectorAll('[data-command]').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ command: btn.dataset.command });
        });
      });
    }
    
    // 关于面板
    function renderAboutPanel() {
      content.innerHTML = \`
        <section class="settings-panel rx-fade-panel">
        <h2 class="content-header">关于 Kilo Code</h2>
        
        <div class="empty-state rx-empty">
          <div class="empty-icon rx-empty-icon">ℹ️</div>
          <div class="empty-text rx-empty-description">Kilo Code VS Code 扩展 v0.1.0</div>
          <div class="empty-text rx-empty-description" style="margin-top: 8px; font-size: 12px;">基于 Reasonix 构建</div>
        </div>
        </section>
      \`;
    }
    
    // 空状态面板
    function renderEmptyPanel(category) {
      const cat = SETTINGS_CATEGORIES.find(c => c.id === category);
      content.innerHTML = \`
        <section class="settings-panel rx-fade-panel">
        <h2 class="content-header">\${cat ? cat.label : category}</h2>
        
        <div class="empty-state rx-empty">
          <div class="empty-icon rx-empty-icon rx-icon \${cat ? cat.icon : 'icon-settings'}" aria-hidden="true"></div>
          <div class="empty-text rx-empty-description">此设置类别正在开发中</div>
        </div>
        </section>
      \`;
    }
    
    // 导航切换
    sidebar.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        sidebar.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        renderContent(item.dataset.category);
      });
    });
    
    // 配置范围切换
    document.querySelectorAll('.config-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.config-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        configScope = btn.dataset.scope;
        vscode.postMessage({ command: 'switchConfigScope', scope: configScope });
      });
    });
    
    // 接收扩展消息
    window.addEventListener('message', (event) => {
      const message = event.data;
      
      if (message.type === 'providerSaved') {
        if (message.provider) {
          state.provider = message.provider;
          const status = document.getElementById('providerStatus');
          if (status) {
            status.textContent = '当前：' + message.provider.name + ' / ' + message.provider.model;
          }
          // 清空 API Key 输入框
          const apiKeyInput = document.getElementById('providerApiKey');
          if (apiKeyInput) apiKeyInput.value = '';
        }
      }
      
      if (message.type === 'cloudSyncSaved') {
        if (message.config) {
          state.cloudSync = message.config;
          state.hasGithubToken = message.hasGithubToken;
        }
      }
    });
    
    // 初始化
    renderContent(state.activeCategory || 'models');
    
    // HTML 转义
    function escapeHtml(value) {
      return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] || ch);
    }
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
