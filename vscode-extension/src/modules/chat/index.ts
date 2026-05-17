import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { AcpClient, type AcpPermissionParams, type AcpUpdate } from "../../services/acp-client";
import { ReasonixCliService } from "../../services/reasonix-cli";
import { currentWorkspaceRoot } from "../../services/workspace-data";
import { PermissionStore } from "../permissions/permission-store";
import {
  makeProviderId,
  normalizeReasoningEffort,
  normalizeThinkingMode,
  ProviderStore,
  type ProviderConfig,
} from "../providers/provider-store";
import { ChatHistoryStore, type ChatSessionRecord } from "./history-store";

const CHAT_VIEW_ID = "reasonix.chatView";

interface WebviewMessage {
  command?: string;
  text?: string;
  sessionId?: string;
  data?: Partial<ProviderConfig> & { apiKey?: string };
}

export const ChatModule: ReasonixModule = {
  id: "chat",
  activate(ctx: ReasonixExtensionContext) {
    const controller = new ChatController(ctx);
    ctx.vscodeContext.subscriptions.push(controller);
    controller.register();
  },
};

class ChatController implements vscode.Disposable, vscode.WebviewViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private view: vscode.WebviewView | undefined;
  private acp: AcpClient | undefined;
  private acpSessionId: string | undefined;
  private activeHistoryId: string | undefined;
  private busy = false;
  private disposables: vscode.Disposable[] = [];
  private readonly history: ChatHistoryStore;
  private readonly permissions: PermissionStore;
  /** Buffered thinking content — emitted as collapsible panel before the first message chunk. */
  private thinkingBuf = "";

  constructor(private readonly ctx: ReasonixExtensionContext) {
    // Stores are constructed after ctx assignment so TS initialization order is safe.
    this.history = new ChatHistoryStore(ctx);
    this.permissions = new PermissionStore(ctx);
  }

  register(): void {
    this.disposables = [
      // Default chat command now focuses the sidebar view, matching Kilo Code's side-panel workflow.
      vscode.commands.registerCommand("reasonix.openChat", () => this.openView()),
      // Keep a panel command as an escape hatch for users who prefer editor-area chat.
      vscode.commands.registerCommand("reasonix.openChatPanel", () => this.openPanel()),
      vscode.commands.registerCommand("reasonix.chat.newSession", () => this.newHistorySession()),
      vscode.commands.registerCommand("reasonix.chat.selectSession", () => this.pickHistorySession()),
      vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, this, {
        // Retain context so streaming output and typed draft stay visible when users switch tabs.
        webviewOptions: { retainContextWhenHidden: true },
      }),
      this.ctx.eventBus.on("provider.changed", () => this.resetAcp("供应商已变更，下次发送会重启 Reasonix ACP 会话。")),
      this.ctx.eventBus.on("model.changed", () => this.resetAcp("模型已变更，下次发送会重启 Reasonix ACP 会话。")),
    ];
    this.ctx.vscodeContext.subscriptions.push(...this.disposables);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.title = "聊天";
    webviewView.description = "Reasonix";
    webviewView.webview.html = this.renderHtml();
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleWebviewMessage(message));
    webviewView.onDidDispose(() => {
      // Disposing the UI should not kill the ACP process mid-response; extension dispose handles cleanup.
      this.view = undefined;
    });
    this.postState();
  }

  dispose(): void {
    this.acp?.close();
    for (const item of this.disposables) item.dispose();
  }

  async openView(): Promise<void> {
    if (!this.history.getActive()) await this.newHistorySession(false);
    try {
      // VS Code automatically creates `<viewId>.focus` for contributed views.
      await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
      this.postState();
    } catch {
      // If a host does not expose the focus command, fall back to a normal panel instead of failing silently.
      await this.openPanel();
    }
  }

  async openPanel(): Promise<void> {
    if (!this.history.getActive()) await this.newHistorySession(false);
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.postState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel("reasonixChat", "Reasonix Chat", vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.webview.html = this.renderHtml();
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleWebviewMessage(message));
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    if (message.command === "send" && message.text) await this.sendPrompt(message.text);
    if (message.command === "cancel") this.cancel();
    if (message.command === "newSession") await this.newHistorySession();
    if (message.command === "pickSession") await this.pickHistorySession();
    if (message.command === "selectSession" && message.sessionId) await this.selectHistorySession(message.sessionId);
    if (message.command === "configureProvider") {
      // Open the in-webview modal and send fresh provider data so the form never
      // shows stale model/mode values after QuickPick changes.
      this.postState();
      this.post({ type: "openSettings", provider: new ProviderStore(this.ctx).activeProvider() });
      return;
    }
    if (message.command === "selectModel") {
      await vscode.commands.executeCommand("reasonix.models.select");
      this.postState();
    }
    if (message.command === "selectMode") {
      await vscode.commands.executeCommand("reasonix.models.selectMode");
      this.postState();
    }
    if (message.command === "openSettings") await vscode.commands.executeCommand("reasonix.openSettings");
    if (message.command === "openIndexing") await vscode.commands.executeCommand("reasonix.indexing.open");
    if (message.command === "openPermissions") await vscode.commands.executeCommand("reasonix.permissions.open");
    if (message.command === "openReview") await vscode.commands.executeCommand("reasonix.review.open");
    if (message.command === "syncNow") await vscode.commands.executeCommand("reasonix.cloudSync.syncNow");
    // Save provider from the inline settings form; empty API Key means preserve
    // the existing SecretStorage value instead of deleting a working token.
    if (message.command === "saveProvider" && message.data) {
      const store = new ProviderStore(this.ctx);
      const active = store.activeProvider();
      const next: ProviderConfig = {
        id: active.name === (message.data.name?.trim() || active.name) ? active.id : makeProviderId(message.data.name || active.name),
        name: message.data.name?.trim() || active.name,
        baseUrl: message.data.baseUrl?.trim() || active.baseUrl,
        model: message.data.model?.trim() || active.model,
        reasoningEffort: normalizeReasoningEffort(message.data.reasoningEffort),
        thinking: normalizeThinkingMode(message.data.thinking),
      };
      await store.saveProvider(next, message.data.apiKey?.trim() || undefined);
      const provider = store.activeProvider();
      await this.ctx.eventBus.emit("provider.changed", provider);
      this.postState();
      this.post({ type: "providerSaved", provider });
    }
  }

  private async newHistorySession(reveal = true): Promise<void> {
    const provider = new ProviderStore(this.ctx).activeProvider();
    const session = await this.history.create(provider.name, provider.model);
    this.activeHistoryId = session.id;
    this.resetAcp("已创建新聊天会话。 ");
    if (reveal) await this.openView();
    this.postState();
  }

  private async pickHistorySession(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      this.history.list().map((session) => ({ label: session.title, description: session.model, detail: session.updatedAt, session })),
      { title: "选择 Reasonix 聊天会话" },
    );
    if (picked) await this.selectHistorySession(picked.session.id);
  }

  private async selectHistorySession(sessionId: string): Promise<void> {
    await this.history.setActive(sessionId);
    this.activeHistoryId = sessionId;
    this.resetAcp("已切换聊天历史；下一次发送会新建 ACP 运行会话。 ");
    this.postState();
  }

  private async sendPrompt(text: string): Promise<void> {
    if (this.busy) {
      this.post({ type: "error", message: "当前仍在回复中，请等待完成或先取消。" });
      return;
    }

    const activeProvider = new ProviderStore(this.ctx).activeProvider();
    const historySession = this.history.getActive() ?? (await this.history.create(activeProvider.name, activeProvider.model));
    this.activeHistoryId = historySession.id;
    await this.history.append(historySession.id, "user", text);

    this.busy = true;
    this.thinkingBuf = ""; // Reset thinking buffer for the new turn
    this.postState();
    this.post({ type: "assistantStart" });
    await this.history.append(historySession.id, "assistant", "");
    try {
      const sessionId = await this.ensureAcpSession();
      const result = await this.acp!.prompt(sessionId, text);
      this.post({ type: "assistantDone", stopReason: result.stopReason });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.history.append(historySession.id, "system", `[错误] ${message}`);
      this.post({ type: "error", message });
    } finally {
      this.busy = false;
      this.postState();
    }
  }

  private cancel(): void {
    if (this.acpSessionId) this.acp?.cancel(this.acpSessionId);
    this.post({ type: "status", message: "已请求取消当前 Reasonix 回复。" });
  }

  private async ensureAcpSession(): Promise<string> {
    if (this.acp && this.acpSessionId) return this.acpSessionId;

    const providerStore = new ProviderStore(this.ctx);
    const provider = providerStore.activeProvider();
    const apiKey = await providerStore.activeApiKey();
    if (!apiKey) {
      // Keep configuration inside the sidebar instead of opening top-bar input
      // boxes; users can save the token and send again.
      this.post({ type: "openSettings", provider });
      throw new Error("未配置 API Key。请在侧栏“设置”表单中保存 Token 后重试。");
    }

    const launch = new ReasonixCliService(this.ctx).acpLaunch(provider.model);
    const env = await providerStore.environment();
    this.acp = new AcpClient({
      ...launch,
      env,
      onUpdate: (params) => this.handleAcpUpdate(params.update),
      onPermission: (params) => this.handlePermission(params),
      onStderr: (line) => this.ctx.output.appendLine(`[reasonix-acp] ${line}`),
    });

    this.post({ type: "status", message: `启动 Reasonix ACP · ${provider.name} / ${provider.model}` });
    await this.acp.initialize();
    const session = await this.acp.newSession(currentWorkspaceRoot());
    this.acpSessionId = session.sessionId;
    this.post({ type: "status", message: `会话已就绪：${session.sessionId}` });
    return session.sessionId;
  }

  private async handlePermission(params: AcpPermissionParams) {
    const auto = this.permissions.match(params);
    if (auto) return { outcome: { outcome: "selected" as const, optionId: auto.optionId } };

    const picked = await vscode.window.showQuickPick(
      params.options.map((option) => ({ label: option.name, description: option.kind, option })),
      {
        title: params.toolCall.title ?? "Reasonix 权限请求",
        placeHolder: JSON.stringify(params.toolCall.rawInput ?? {}, null, 2).slice(0, 500),
        ignoreFocusOut: true,
      },
    );
    if (!picked) return { outcome: { outcome: "cancelled" as const } };

    if (picked.option.kind.includes("always")) {
      await this.permissions.addRuleFromPermission(params, picked.option.optionId, picked.option.kind.includes("allow") ? "allow" : "reject");
      vscode.window.showInformationMessage("Reasonix 已保存该权限规则，可在 Permissions 页面管理。 ");
    }
    return { outcome: { outcome: "selected" as const, optionId: picked.option.optionId } };
  }

  private async handleAcpUpdate(update: AcpUpdate): Promise<void> {
    const historyId = this.activeHistoryId ?? this.history.getActive()?.id;
    if (update.sessionUpdate === "agent_message_chunk") {
      // Flush any buffered thinking before the first real message so the user sees reasoning.
      if (this.thinkingBuf) { this.post({ type: "thinkingEnd", text: this.thinkingBuf }); this.thinkingBuf = ""; }
      if (historyId) await this.history.updateLastAssistant(historyId, update.content.text);
      this.post({ type: "assistantDelta", text: update.content.text });
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk") {
      this.thinkingBuf += update.content.text;
      // Stream thinking into the feed immediately so it is visible while reasoning runs.
      this.post({ type: "thinkingChunk", text: update.content.text });
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      const text = `${update.kind ?? "tool"}: ${update.title ?? update.toolCallId}`;
      if (historyId) await this.history.append(historyId, "tool", text);
      this.post({ type: "tool", message: text });
      return;
    }
    if (update.sessionUpdate === "tool_call_update") {
      const content = update.content?.map((item) => item.content.text).join("\n") ?? update.status ?? "updated";
      const text = `${update.toolCallId}: ${content}`;
      if (historyId) await this.history.append(historyId, "tool", text);
      this.post({ type: "tool", message: text });
      return;
    }
    if (update.sessionUpdate === "plan") {
      const text = `Plan:\n${update.entries.map((entry) => `- [${entry.status}] ${entry.content}`).join("\n")}`;
      if (historyId) await this.history.append(historyId, "tool", text);
      this.post({ type: "tool", message: text });
    }
  }

  private resetAcp(message: string): void {
    this.acp?.close();
    this.acp = undefined;
    this.acpSessionId = undefined;
    this.post({ type: "status", message });
    this.postState();
  }

  private postState(): void {
    this.post({
      type: "state",
      active: this.history.getActive(),
      sessions: this.history.list(),
      provider: new ProviderStore(this.ctx).activeProvider(),
      busy: this.busy,
    });
  }

  private renderHtml(): string {
    return renderChatHtml(new ProviderStore(this.ctx).activeProvider(), this.history.getActive(), this.history.list());
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
    void this.panel?.webview.postMessage(message);
  }
}

function renderChatHtml(provider: ProviderConfig, active: ChatSessionRecord | undefined, sessions: ChatSessionRecord[]): string {
  const status = providerStatus(provider);
  const boot = JSON.stringify({ active, sessions, provider }).replace(/</g, "\\u003c");
  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reasonix Chat</title>
  <style>
    :root { color-scheme: dark light; }
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .shell { display: flex; flex-direction: column; height: 100vh; min-width: 0; overflow: hidden; }
    .appbar { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 10px; border-bottom: 1px solid var(--vscode-panel-border); background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, var(--vscode-editor-background)); }
    .brand { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--vscode-descriptionForeground); }
    .divider { width: 1px; height: 16px; background: var(--vscode-panel-border); }
    .status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .feedWrap { flex: 1; overflow: hidden; background: var(--vscode-editor-background); }
    .feed { height: 100%; overflow: auto; padding: 14px 12px 18px; display: flex; flex-direction: column; }
    .msgRow { display: flex; width: 100%; margin: 0 0 8px; }
    .msgRow.user { justify-content: flex-end; }
    .msgRow.assistant { justify-content: flex-start; }
    .msg { max-width: 88%; border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent); border-radius: 14px; padding: 10px 14px; white-space: pre-wrap; line-height: 1.55; box-shadow: 0 1px 0 rgba(0,0,0,.08); }
    .msgRow.user .msg { background: color-mix(in srgb, var(--vscode-button-background) 22%, var(--vscode-input-background)); border-bottom-right-radius: 4px; }
    .msgRow.assistant .msg { background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, var(--vscode-sideBar-background)); border-bottom-left-radius: 4px; }
    .msg.tool { color: var(--vscode-textPreformat-foreground); font-size: 12px; background: var(--vscode-textCodeBlock-background); }
    .system { color: var(--vscode-editorError-foreground); }
    .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .03em; }
    /* Thinking panel — collapsible reasoning display */
    .thinking { margin: 6px 0 8px; border: 1px dashed var(--vscode-panel-border); border-radius: 10px; background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 60%, transparent); }
    .thinking summary { padding: 6px 12px; cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 12px; user-select: none; border-radius: 10px; }
    .thinking summary:hover { background: var(--vscode-list-hoverBackground); }
    .thinking .body { padding: 8px 14px; max-height: 220px; overflow: auto; color: var(--vscode-descriptionForeground); font-size: 12px; white-space: pre-wrap; line-height: 1.5; border-top: 1px solid var(--vscode-panel-border); }
    /* Inline settings modal */
    .settingsOverlay { display: none; position: absolute; inset: 0; background: rgba(0,0,0,.45); z-index: 20; align-items: center; justify-content: center; }
    .settingsOverlay.show { display: flex; }
    .settingsPanel { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border); border-radius: 12px; padding: 20px; width: 92%; max-width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,.3); max-height: 90vh; overflow: auto; }
    .settingsPanel h2 { margin: 0 0 14px; font-size: 15px; }
    .settingsPanel .field { margin: 0 0 12px; }
    .settingsPanel label { display: block; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
    .settingsPanel input, .settingsPanel select { display: block; width: 100%; box-sizing: border-box; padding: 6px 9px; border: 1px solid var(--vscode-input-border); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: var(--vscode-font-family); }
    .settingsPanel .actions { display: flex; gap: 8px; margin-top: 14px; }
    .bottom { flex: none; padding: 8px 10px 10px; border-top: 1px solid var(--vscode-panel-border); background: color-mix(in srgb, var(--vscode-sideBar-background) 92%, var(--vscode-editor-background)); }
    .sessionRow { display: flex; align-items: center; gap: 7px; min-height: 28px; margin-bottom: 7px; }
    .currentSession { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 12px; text-align: right; }
    .composerCard { border: 1px solid var(--vscode-focusBorder); border-radius: 8px; background: var(--vscode-input-background); overflow: hidden; box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
    textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; max-height: 180px; color: var(--vscode-input-foreground); background: transparent; border: 0; outline: none; padding: 10px 11px 6px; font-family: var(--vscode-font-family); }
    .composerToolbar { display: flex; align-items: center; gap: 6px; padding: 6px 7px 7px; }
    .toolGroup { display: flex; gap: 6px; min-width: 0; flex-wrap: wrap; }
    button { padding: 5px 9px; border-radius: 6px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .chip { max-width: 155px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .subtle { color: var(--vscode-descriptionForeground); }
    .sendBtn { min-width: 38px; font-weight: 700; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .spacer { flex: 1; }
    @media (max-width: 560px) {
      .brand { display: none; }
      .sessionRow { flex-wrap: wrap; }
      .currentSession { order: 4; width: 100%; text-align: left; }
      .composerToolbar { flex-wrap: wrap; }
      .sendBtn { margin-left: auto; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="appbar">
      <span class="brand">REASONIX</span>
      <span class="divider"></span>
      <span id="status" class="status">${escapeHtml(status)}</span>
      <span class="spacer"></span>
      <button data-command="toggleSettings" title="窗口内设置">设置</button>
    </header>
    <main class="feedWrap">
      <div id="feed" class="feed"></div>
    </main>
    <footer class="bottom">
      <div class="sessionRow">
        <button data-command="newSession">新会话</button>
        <button data-command="pickSession">历史会话</button>
        <button data-command="openReview" title="查看当前 Git Diff / Edit Review">Review</button>
        <span class="spacer"></span>
        <span id="currentSession" class="currentSession"></span>
      </div>
      <div class="composerCard">
        <textarea id="input" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
        <div class="composerToolbar">
          <div class="toolGroup">
            <button class="chip" data-command="configureProvider" id="providerChip">${escapeHtml(provider.name)}</button>
            <button class="chip" data-command="selectModel" id="modelChip">${escapeHtml(provider.model)}</button>
            <button class="chip" data-command="selectMode" id="modeChip">${escapeHtml(modeLabel(provider))}</button>
            <button data-command="openIndexing" title="打开代码索引">索引</button>
            <button data-command="openPermissions" title="管理权限规则">权限</button>
            <button data-command="syncNow" title="立即加密云同步">同步</button>
          </div>
          <span class="spacer"></span>
          <button class="subtle" data-command="cancel" title="取消回复">取消</button>
          <button id="send" class="sendBtn" title="发送">发送</button>
        </div>
      </div>
    </footer>
    <!-- Inline settings modal — replaces top-bar showInputBox for provider config -->
    <div id="settingsOverlay" class="settingsOverlay">
      <div class="settingsPanel">
        <h2>Reasonix 供应商配置</h2>
        <div class="field"><label>供应商名称</label><input id="cfgName" placeholder="DeepSeek" /></div>
        <div class="field"><label>API Base URL</label><input id="cfgBaseUrl" placeholder="https://api.deepseek.com" /></div>
        <div class="field"><label>API Key / Token</label><input id="cfgApiKey" type="password" placeholder="留空保持已保存 Token" /></div>
        <div class="field"><label>默认模型</label><input id="cfgModel" placeholder="deepseek-v4-flash" /></div>
        <div class="field"><label>推理深度</label><select id="cfgReasoningEffort"><option value="default">默认</option><option value="high">high</option><option value="max">max</option></select></div>
        <div class="field"><label>思考链 (thinking)</label><select id="cfgThinking"><option value="enabled">开启</option><option value="disabled">关闭</option></select></div>
        <div class="actions">
          <button id="cfgSave" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);">保存</button>
          <button data-command="toggleSettings">关闭</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const feed = document.getElementById('feed');
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    const status = document.getElementById('status');
    const currentSession = document.getElementById('currentSession');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const providerChip = document.getElementById('providerChip');
    const modelChip = document.getElementById('modelChip');
    const modeChip = document.getElementById('modeChip');
    let state = ${boot};
    let assistantBody = null;
    let assistantRow = null;
    let thinkingNode = null, thinkingBody = null;

    function providerSummary(provider) {
      if (!provider) return 'Reasonix';
      return provider.name + ' / ' + provider.model + ' · effort=' + (provider.reasoningEffort || 'default') + ' · thinking=' + (provider.thinking || 'enabled');
    }

    function modeSummary(provider) {
      if (!provider) return '模式';
      return '模式 ' + (provider.reasoningEffort || 'default') + '/' + (provider.thinking || 'enabled');
    }

    /** Keep toolbar chips and inline settings fields in sync with extension state. */
    function applyProvider(provider) {
      if (!provider) return;
      state.provider = provider;
      status.textContent = providerSummary(provider);
      providerChip.textContent = provider.name || 'Provider';
      modelChip.textContent = provider.model || 'Model';
      modeChip.textContent = modeSummary(provider);
      document.getElementById('cfgName').value = provider.name || '';
      document.getElementById('cfgBaseUrl').value = provider.baseUrl || '';
      document.getElementById('cfgModel').value = provider.model || '';
      document.getElementById('cfgReasoningEffort').value = provider.reasoningEffort || 'default';
      document.getElementById('cfgThinking').value = provider.thinking || 'enabled';
    }

    function renderState() {
      currentSession.textContent = state.active ? state.active.title + ' · ' + state.active.model : '尚无会话';
      feed.innerHTML = '';
      const messages = (state.active && state.active.messages) || [];
      if (messages.length === 0) append('assistant', 'Reasonix', '输入问题后 reasonix acp 会驱动当前工作区。', false);
      for (const msg of messages) append(msg.role, msg.role === 'user' ? '你' : 'Reasonix', msg.text, false);
      feed.scrollTop = feed.scrollHeight;
    }

    function append(kind, label, text, scroll = true) {
      const row = document.createElement('div');
      const rowKind = kind === 'user' ? 'user' : 'assistant';
      row.className = 'msgRow ' + rowKind;
      const msg = document.createElement('div');
      msg.className = 'msg ' + kind;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = label || kind;
      const body = document.createElement('div');
      body.textContent = text || '';
      msg.append(meta, body);
      row.append(msg);
      feed.append(row);
      if (scroll) feed.scrollTop = feed.scrollHeight;
      return { row, node: msg, body };
    }

    /** Create or update a collapsible thinking panel in the feed. */
    function ensureThinking() {
      if (thinkingNode) return;
      thinkingNode = document.createElement('details');
      thinkingNode.className = 'thinking';
      thinkingNode.open = false;
      const summary = document.createElement('summary');
      summary.textContent = '思考中…';
      thinkingBody = document.createElement('div');
      thinkingBody.className = 'body';
      thinkingNode.append(summary, thinkingBody);
      // Insert thinking before the assistant bubble so reasoning reads as a
      // pre-answer trail instead of appearing after the final response.
      feed.insertBefore(thinkingNode, assistantRow || null);
      feed.scrollTop = feed.scrollHeight;
    }

    function finalizeThinking(text) {
      if (!thinkingNode) return;
      const summary = thinkingNode.querySelector('summary');
      if (summary) summary.textContent = '思考过程 (' + (text || '').length + ' 字)';
      thinkingNode.open = false;
      thinkingNode = null; thinkingBody = null;
    }

    function submit() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      vscode.postMessage({ command: 'send', text });
    }

    send.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    document.querySelectorAll('button[data-command]').forEach((button) => {
      if (button.dataset.command === 'toggleSettings') {
        button.addEventListener('click', () => {
          applyProvider(state.provider);
          settingsOverlay.classList.toggle('show');
        });
        return;
      }
      button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
    });

    // Save provider from inline settings modal
    document.getElementById('cfgSave').addEventListener('click', () => {
      const data = {
        name: document.getElementById('cfgName').value.trim(),
        baseUrl: document.getElementById('cfgBaseUrl').value.trim(),
        apiKey: document.getElementById('cfgApiKey').value.trim(),
        model: document.getElementById('cfgModel').value.trim(),
        reasoningEffort: document.getElementById('cfgReasoningEffort').value,
        thinking: document.getElementById('cfgThinking').value,
      };
      if (!data.name || !data.baseUrl) return;
      vscode.postMessage({ command: 'saveProvider', data });
      settingsOverlay.classList.remove('show');
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'state') {
        state = { ...state, active: message.active, sessions: message.sessions, provider: message.provider || state.provider, busy: !!message.busy };
        applyProvider(state.provider);
        renderState();
      }
      if (message.type === 'openSettings') {
        applyProvider(message.provider || state.provider);
        settingsOverlay.classList.add('show');
      }
      if (message.type === 'assistantStart') {
        thinkingNode = null; thinkingBody = null; assistantRow = null;
        const assistant = append('assistant', 'Reasonix', '');
        assistantBody = assistant.body;
        assistantRow = assistant.row;
      }
      if (message.type === 'assistantDelta' && assistantBody) assistantBody.textContent += message.text;
      if (message.type === 'thinkingChunk') {
        ensureThinking();
        if (thinkingBody) thinkingBody.textContent += message.text;
        status.textContent = '思考中…';
      }
      if (message.type === 'thinkingEnd') {
        finalizeThinking(message.text);
        status.textContent = '思考完成 →';
      }
      if (message.type === 'assistantDone') {
        if (thinkingNode) finalizeThinking('');
        assistantRow = null;
        status.textContent = '完成 · ' + message.stopReason;
      }
      if (message.type === 'status') status.textContent = message.message;
      if (message.type === 'tool') append('assistant', 'tool', message.message);
      if (message.type === 'error') append('assistant', 'error', '[错误] ' + message.message);
      if (message.type === 'providerSaved') applyProvider(message.provider);
      feed.scrollTop = feed.scrollHeight;
    });
    renderState();
    // Pre-fill inline settings modal from the active provider
    applyProvider(state.provider);
  </script>
</body>
</html>`;
}

function providerStatus(provider: ProviderConfig): string {
  return `${provider.name} / ${provider.model} · effort=${provider.reasoningEffort} · thinking=${provider.thinking}`;
}

function modeLabel(provider: ProviderConfig): string {
  return `模式 ${provider.reasoningEffort}/${provider.thinking}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
