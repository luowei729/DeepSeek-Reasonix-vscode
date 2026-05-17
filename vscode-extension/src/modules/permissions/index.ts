import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { PermissionStore } from "./permission-store";

export const PermissionsModule: ReasonixModule = {
  id: "permissions",
  activate(ctx: ReasonixExtensionContext) {
    const controller = new PermissionsController(ctx);
    ctx.vscodeContext.subscriptions.push(controller);
    controller.register();
  },
};

class PermissionsController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private readonly store: PermissionStore;

  constructor(private readonly ctx: ReasonixExtensionContext) {
    // Store needs the extension context; construct it after parameter property assignment.
    this.store = new PermissionStore(ctx);
  }

  register(): void {
    this.disposables = [
      vscode.commands.registerCommand("reasonix.permissions.open", () => this.open()),
      vscode.commands.registerCommand("reasonix.permissions.clear", () => this.clear()),
    ];
    this.ctx.vscodeContext.subscriptions.push(...this.disposables);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.refresh();
      return;
    }
    this.panel = vscode.window.createWebviewPanel("reasonixPermissions", "Reasonix Permissions", vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (message: { command?: string; id?: string }) => {
      if (message.command === "delete" && message.id) await this.deleteRule(message.id);
      if (message.command === "clear") await this.clear();
    });
    this.refresh();
  }

  private refresh(): void {
    if (this.panel) this.panel.webview.html = renderPermissionsHtml(this.store.list());
  }

  private async deleteRule(id: string): Promise<void> {
    await this.store.deleteRule(id);
    this.refresh();
  }

  private async clear(): Promise<void> {
    const accepted = await vscode.window.showWarningMessage("清空所有 Reasonix VS Code 权限规则？", { modal: true }, "清空");
    if (accepted !== "清空") return;
    await this.store.clear();
    this.refresh();
  }
}

function renderPermissionsHtml(rules: Array<{ id: string; pattern: string; kind: string; decision: string; optionId: string; createdAt: string; hits: number }>): string {
  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Reasonix Permissions</title>
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 14px; margin-bottom: 12px; background: var(--vscode-sideBar-background); }
.grid { display: grid; grid-template-columns: 90px minmax(0,1fr) 90px 80px 70px; gap: 8px; align-items: center; }
.head { color: var(--vscode-descriptionForeground); font-weight: 600; }
code { color: var(--vscode-textPreformat-foreground); word-break: break-all; }
button { padding: 5px 9px; }
</style>
</head>
<body>
<h1>Reasonix 权限规则</h1>
<p>当你在权限弹窗中选择“always”类选项时，插件会保存匹配规则。规则只影响 VS Code 插件侧自动选择，仍把原始 optionId 回传给上游 ACP。</p>
<button data-command="clear">清空规则</button>
<section class="card grid head"><span>类型</span><span>匹配文本</span><span>决策</span><span>命中</span><span>操作</span></section>
${
  rules.length
    ? rules
        .map(
          (rule) => `<section class="card grid"><span>${escapeHtml(rule.kind)}</span><code>${escapeHtml(rule.pattern)}</code><span>${escapeHtml(rule.decision)}<br/>${escapeHtml(rule.optionId)}</span><span>${rule.hits}</span><button data-command="delete" data-id="${escapeHtml(rule.id)}">删除</button></section>`,
        )
        .join("")
    : '<section class="card">暂无持久化权限规则。</section>'
}
<script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('button[data-command]').forEach((button) => {
  button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command, id: button.dataset.id }));
});
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
