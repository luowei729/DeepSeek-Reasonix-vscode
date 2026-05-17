import { spawn } from "node:child_process";
import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { currentWorkspaceRoot } from "../../services/workspace-data";

export const ReviewModule: ReasonixModule = {
  id: "review",
  activate(ctx: ReasonixExtensionContext) {
    const controller = new ReviewController(ctx);
    ctx.vscodeContext.subscriptions.push(controller);
    controller.register();
  },
};

class ReviewController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly ctx: ReasonixExtensionContext) {}

  register(): void {
    this.disposables = [
      vscode.commands.registerCommand("reasonix.review.open", () => this.open()),
      vscode.commands.registerCommand("reasonix.review.refresh", () => this.refresh()),
    ];
    this.ctx.vscodeContext.subscriptions.push(...this.disposables);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  async open(): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("reasonixReview", "Reasonix Diff Review", vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
        if (message.command === "refresh") await this.refresh();
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.One);
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const root = currentWorkspaceRoot();
    const diff = root ? await gitDiff(root) : "未打开工作区。";
    if (this.panel) this.panel.webview.html = renderReviewHtml(diff, root);
  }
}

async function gitDiff(cwd: string): Promise<string> {
  // Git is invoked read-only with --no-ext-diff so user-defined diff tools do not run.
  return new Promise((resolve) => {
    const child = spawn("git", ["diff", "--no-ext-diff", "--stat", "--", ":/"], { cwd, stdio: "pipe" });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (err += chunk.toString("utf8")));
    child.on("exit", () => {
      const stat = out.trim() || "暂无未提交 diff。";
      const full = spawn("git", ["diff", "--no-ext-diff", "--", ":/"], { cwd, stdio: "pipe" });
      let fullOut = "";
      let fullErr = "";
      full.stdout.on("data", (chunk) => (fullOut += chunk.toString("utf8")));
      full.stderr.on("data", (chunk) => (fullErr += chunk.toString("utf8")));
      full.on("exit", () => resolve(`## Stat\n${stat}\n\n## Diff\n${fullOut.trim() || "暂无详细 diff。"}${err || fullErr ? `\n\n## Git warnings\n${err}${fullErr}` : ""}`));
    });
  });
}

function renderReviewHtml(diff: string, root: string | undefined): string {
  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Reasonix Diff Review</title>
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 14px; overflow:auto; }
button { padding: 6px 10px; }
.meta { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h1>Reasonix Diff / Edit Review</h1>
<p class="meta">工作区：<code>${escapeHtml(root ?? "未打开")}</code></p>
<button data-command="refresh">刷新 diff</button>
<pre>${escapeHtml(diff)}</pre>
<script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('button[data-command]').forEach((button) => button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command })));
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
