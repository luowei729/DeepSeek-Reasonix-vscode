import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { CloudSyncStore } from "../cloud-sync/cloud-sync-store";
import type { CloudSyncConfig } from "../cloud-sync/sync-types";
import {
  makeProviderId,
  normalizeReasoningEffort,
  normalizeThinkingMode,
  ProviderStore,
  type ProviderConfig,
} from "../providers/provider-store";

interface SettingsWebviewMessage {
  command?: string;
  provider?: Partial<ProviderConfig> & { apiKey?: string };
  cloudSync?: Partial<CloudSyncConfig> & { githubToken?: string };
}

/**
 * Settings module owns the VS Code settings page. It is deliberately separate
 * from feature controllers so each capability can evolve as its own module.
 */
export const SettingsModule: ReasonixModule = {
  id: "settings",
  activate(ctx: ReasonixExtensionContext) {
    ctx.vscodeContext.subscriptions.push(vscode.commands.registerCommand("reasonix.openSettings", () => openSettings(ctx)));
  },
};

async function openSettings(ctx: ReasonixExtensionContext): Promise<void> {
  const panel = vscode.window.createWebviewPanel("reasonixSettings", "Reasonix Settings", vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
  const cloudStore = new CloudSyncStore(ctx);
  const providerStore = new ProviderStore(ctx);
  panel.webview.html = renderSettingsHtml(cloudStore.getConfig(), providerStore.activeProvider(), !!(await cloudStore.getGithubToken()));
  panel.webview.onDidReceiveMessage(async (message: SettingsWebviewMessage) => {
    if (message.command === "saveProvider" && message.provider) {
      const active = providerStore.activeProvider();
      const next: ProviderConfig = {
        id: active.name === (message.provider.name?.trim() || active.name) ? active.id : makeProviderId(message.provider.name || active.name),
        name: message.provider.name?.trim() || active.name,
        baseUrl: message.provider.baseUrl?.trim() || active.baseUrl,
        model: message.provider.model?.trim() || active.model,
        reasoningEffort: normalizeReasoningEffort(message.provider.reasoningEffort),
        thinking: normalizeThinkingMode(message.provider.thinking),
      };
      // Empty token preserves the previous SecretStorage value; this prevents an
      // accidental settings-page save from deleting a working API key.
      await providerStore.saveProvider(next, message.provider.apiKey?.trim() || undefined);
      const saved = providerStore.activeProvider();
      await ctx.eventBus.emit("provider.changed", saved);
      await panel.webview.postMessage({ type: "providerSaved", provider: saved });
      vscode.window.showInformationMessage(`Reasonix 供应商已保存：${saved.name} / ${saved.model}`);
      return;
    }

    if (message.command === "saveCloudSync" && message.cloudSync) {
      const current = cloudStore.getConfig();
      const next: CloudSyncConfig = {
        repoUrl: message.cloudSync.repoUrl?.trim() || current.repoUrl,
        branch: message.cloudSync.branch?.trim() || current.branch || "main",
        remotePath: message.cloudSync.remotePath?.trim() || current.remotePath || ".reasonix-cloud-sync",
        autoSync: !!message.cloudSync.autoSync,
      };
      await cloudStore.saveConfig(next);
      const token = message.cloudSync.githubToken?.trim();
      if (token) await cloudStore.saveGithubToken(token);
      // Notify CloudSyncController so inline settings changes restart the
      // scheduler immediately instead of waiting for a VS Code reload.
      await ctx.eventBus.emit("cloudSync.configChanged", next);
      await panel.webview.postMessage({ type: "cloudSyncSaved", config: next, hasGithubToken: !!(await cloudStore.getGithubToken()) });
      vscode.window.showInformationMessage("Reasonix GitHub 云同步配置已保存。加密密码不会保存，备份/恢复时仍需输入。");
      return;
    }

    const map: Record<string, string> = {
      openChat: "reasonix.openChat",
      configureProvider: "reasonix.providers.configure",
      selectProvider: "reasonix.providers.select",
      selectModel: "reasonix.models.select",
      selectMode: "reasonix.models.selectMode",
      openIndexing: "reasonix.indexing.open",
      buildIndex: "reasonix.indexing.build",
      openPermissions: "reasonix.permissions.open",
      openReview: "reasonix.review.open",
      configureCloudSync: "reasonix.cloudSync.configure",
      syncNow: "reasonix.cloudSync.syncNow",
      unlock: "reasonix.cloudSync.unlock",
      restore: "reasonix.cloudSync.restore",
      restoreSnapshot: "reasonix.cloudSync.restoreSnapshot",
    };
    const command = message.command ? map[message.command] : undefined;
    if (command) await vscode.commands.executeCommand(command);
  });
}

function renderSettingsHtml(
  config: CloudSyncConfig,
  provider: ProviderConfig,
  hasGithubToken: boolean,
): string {
  const nonce = String(Date.now());
  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reasonix Settings</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; }
    h1 { margin-top: 0; }
    .tabs { display:flex; gap:8px; flex-wrap:wrap; margin: 0 0 16px; }
    .tab { padding: 7px 12px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 18px; margin-bottom: 18px; background: var(--vscode-sideBar-background); }
    .panel { display:none; } .panel.active { display:block; }
    .row { margin: 8px 0; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 12px 0; }
    label { display:block; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    input, select { width:100%; box-sizing:border-box; padding: 7px 9px; border: 1px solid var(--vscode-input-border); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: var(--vscode-font-family); }
    .muted { color: var(--vscode-descriptionForeground); }
    button { margin: 6px 8px 6px 0; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor:pointer; }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    code { color: var(--vscode-textPreformat-foreground); }
    .warn { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
    .statusLine { margin-top: 8px; color: var(--vscode-testing-iconPassed); }
  </style>
</head>
<body>
  <h1>Reasonix 设置</h1>
  <nav class="tabs">
    <button class="tab active" data-tab="chat">聊天/模型</button>
    <button class="tab" data-tab="index">代码索引</button>
    <button class="tab" data-tab="sync">云同步</button>
    <button class="tab" data-tab="security">权限/Review</button>
  </nav>

  <section class="panel active" id="tab-chat">
    <div class="card">
      <h2>聊天 / 模型</h2>
      <p class="muted">在扩展窗口内编辑供应商、模型和 DeepSeek thinking 模式；API Token 存入 VS Code SecretStorage。</p>
      <div class="grid">
        <div><label>供应商名称</label><input id="providerName" value="${escapeHtml(provider.name)}" placeholder="DeepSeek" /></div>
        <div><label>API Base URL</label><input id="providerBaseUrl" value="${escapeHtml(provider.baseUrl)}" placeholder="https://api.deepseek.com" /></div>
        <div><label>默认模型</label><input id="providerModel" value="${escapeHtml(provider.model)}" placeholder="deepseek-v4-flash" /></div>
        <div><label>API Key / Token</label><input id="providerApiKey" type="password" placeholder="留空保持已保存 Token" /></div>
        <div><label>推理深度</label><select id="providerReasoningEffort">
          <option value="default" ${selected(provider.reasoningEffort, "default")}>默认</option>
          <option value="high" ${selected(provider.reasoningEffort, "high")}>high</option>
          <option value="max" ${selected(provider.reasoningEffort, "max")}>max</option>
        </select></div>
        <div><label>思考链 thinking</label><select id="providerThinking">
          <option value="enabled" ${selected(provider.thinking, "enabled")}>开启</option>
          <option value="disabled" ${selected(provider.thinking, "disabled")}>关闭</option>
        </select></div>
      </div>
      <button class="primary" id="saveProvider">保存聊天配置</button>
      <button data-command="openChat">打开聊天窗口</button>
      <button data-command="selectProvider">切换供应商</button>
      <button data-command="selectModel">选择模型</button>
      <button data-command="selectMode">选择模式</button>
      <div id="providerStatus" class="statusLine">当前：${escapeHtml(provider.name)} / ${escapeHtml(provider.model)} · effort=${escapeHtml(provider.reasoningEffort)} · thinking=${escapeHtml(provider.thinking)}</div>
    </div>
  </section>

  <section class="panel" id="tab-index">
    <div class="card">
      <h2>代码索引</h2>
      <p>使用 Reasonix 原生 <code>reasonix index</code> 构建当前工作区语义索引，增强描述式代码搜索能力。</p>
      <button data-command="openIndexing">打开索引面板</button>
      <button data-command="buildIndex">立即构建索引</button>
      <p class="muted">索引数据位于当前项目 <code>.reasonix/semantic/</code>，云同步全量备份会加密包含该目录。</p>
    </div>
  </section>

  <section class="panel" id="tab-sync">
    <div class="card">
      <h2>GitHub 云同步备份</h2>
      <p class="warn">备份包含 API Key、API Token、配置、会话、记忆、项目 .reasonix 数据等全部 Reasonix 用户数据；上传前会加密。</p>
      <p class="warn">请牢记加密密码。插件不会保存加密密码；忘记密码将无法恢复云端备份。</p>
      <div class="grid">
        <div><label>GitHub 仓库</label><input id="syncRepoUrl" value="${escapeHtml(config.repoUrl)}" placeholder="user/reasonix-backup 或 https://github.com/user/repo" /></div>
        <div><label>GitHub Token</label><input id="syncGithubToken" type="password" placeholder="${hasGithubToken ? "已保存，留空保持" : "Contents Read/Write Token"}" /></div>
        <div><label>分支</label><input id="syncBranch" value="${escapeHtml(config.branch || "main")}" /></div>
        <div><label>云端目录</label><input id="syncRemotePath" value="${escapeHtml(config.remotePath || ".reasonix-cloud-sync")}" /></div>
        <div><label>自动同步</label><select id="syncAutoSync">
          <option value="false" ${selected(String(config.autoSync), "false")}>关闭</option>
          <option value="true" ${selected(String(config.autoSync), "true")}>开启（需本次 VS Code 会话解锁密码）</option>
        </select></div>
      </div>
      <button class="primary" id="saveCloudSync">保存云同步配置</button>
      <button data-command="unlock">解锁本次会话密码</button>
      <button data-command="syncNow">立即加密备份</button>
      <button data-command="restore">恢复 latest</button>
      <button data-command="restoreSnapshot">选择快照恢复</button>
      <div id="syncStatus" class="statusLine">仓库：${escapeHtml(config.repoUrl || "未配置")} · 分支：${escapeHtml(config.branch || "main")} · Token：${hasGithubToken ? "已保存" : "未保存"}</div>
    </div>
  </section>

  <section class="panel" id="tab-security">
    <div class="card">
      <h2>权限 / Review</h2>
      <button data-command="openPermissions">管理权限规则</button>
      <button data-command="openReview">打开 Diff / Edit Review</button>
      <p class="muted">权限规则会保存“always”类选择；Review 面板只读显示当前 git diff，便于安装验证和人工检查。</p>
    </div>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.querySelectorAll('button[data-command]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
    });
    document.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        button.classList.add('active');
        document.getElementById('tab-' + button.dataset.tab).classList.add('active');
      });
    });

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

    document.getElementById('saveCloudSync').addEventListener('click', () => {
      vscode.postMessage({
        command: 'saveCloudSync',
        cloudSync: {
          repoUrl: document.getElementById('syncRepoUrl').value.trim(),
          githubToken: document.getElementById('syncGithubToken').value.trim(),
          branch: document.getElementById('syncBranch').value.trim(),
          remotePath: document.getElementById('syncRemotePath').value.trim(),
          autoSync: document.getElementById('syncAutoSync').value === 'true',
        },
      });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'providerSaved') {
        const provider = message.provider;
        document.getElementById('providerStatus').textContent = '当前：' + provider.name + ' / ' + provider.model + ' · effort=' + provider.reasoningEffort + ' · thinking=' + provider.thinking;
        document.getElementById('providerApiKey').value = '';
      }
      if (message.type === 'cloudSyncSaved') {
        const config = message.config;
        document.getElementById('syncStatus').textContent = '仓库：' + (config.repoUrl || '未配置') + ' · 分支：' + (config.branch || 'main') + ' · Token：' + (message.hasGithubToken ? '已保存' : '未保存');
        document.getElementById('syncGithubToken').value = '';
      }
    });
  </script>
</body>
</html>`;
}

function selected(actual: string, expected: string): string {
  return actual === expected ? "selected" : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
