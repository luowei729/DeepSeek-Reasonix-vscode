import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { AcpClient, type AcpPermissionParams, type AcpUpdate } from "../../services/acp-client";
import { ReasonixCliService } from "../../services/reasonix-cli";
import { currentWorkspaceRoot } from "../../services/workspace-data";
import { webviewStyleRoots, webviewStyleUris } from "../../webview/assets";
import { renderKiloChatHtml } from "../../webview/chat-webview";
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
    webviewView.webview.options = {
      enableScripts: true,
      // 只允许加载构建产物中的 Webview 样式，避免 Webview 访问源码目录或任意文件。
      localResourceRoots: webviewStyleRoots(this.ctx.vscodeContext.extensionUri),
    };
    webviewView.title = "聊天";
    webviewView.description = "Reasonix";
    webviewView.webview.html = this.renderHtml(webviewView.webview);
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
      // 面板入口和侧栏入口共用同一套 dist/webview 样式资源，确保 UI 一致。
      localResourceRoots: webviewStyleRoots(this.ctx.vscodeContext.extensionUri),
    });
    this.panel.webview.html = this.renderHtml(this.panel.webview);
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

  private renderHtml(webview: vscode.Webview): string {
    // 使用 Kilo Code 风格聊天界面，并注入构建产物中的共享设计系统样式。
    return renderKiloChatHtml({
      active: this.history.getActive(),
      sessions: this.history.list(),
      provider: new ProviderStore(this.ctx).activeProvider(),
      busy: this.busy,
    }, webviewStyleUris(webview, this.ctx.vscodeContext.extensionUri));
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
    void this.panel?.webview.postMessage(message);
  }
}
