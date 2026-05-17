import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { IndexRunner } from "./index-runner";
import { IndexStatusService, type IndexStatus } from "./index-status";

export const IndexingModule: ReasonixModule = {
  id: "indexing",
  activate(ctx: ReasonixExtensionContext) {
    const controller = new IndexingController(ctx);
    ctx.vscodeContext.subscriptions.push(controller);
    controller.register();
  },
};

class IndexingController implements vscode.Disposable {
  private readonly status = new IndexStatusService();
  private readonly runner: IndexRunner;
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private logs: string[] = [];

  constructor(private readonly ctx: ReasonixExtensionContext) {
    // Construct process runner after ctx is assigned so TypeScript and runtime
    // agree on initialization order.
    this.runner = new IndexRunner(ctx);
  }

  register(): void {
    this.disposables = [
      vscode.commands.registerCommand("reasonix.indexing.open", () => this.open()),
      vscode.commands.registerCommand("reasonix.indexing.build", () => this.start(false)),
      vscode.commands.registerCommand("reasonix.indexing.rebuild", () => this.start(true)),
      vscode.commands.registerCommand("reasonix.indexing.stop", () => this.stop()),
      vscode.commands.registerCommand("reasonix.indexing.refresh", () => this.refresh()),
    ];
    this.ctx.vscodeContext.subscriptions.push(...this.disposables);
  }

  dispose(): void {
    this.runner.stop();
    for (const item of this.disposables) item.dispose();
  }

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      await this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel("reasonixIndexing", "Reasonix Indexing", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
      if (message.command === "build") await this.start(false);
      if (message.command === "rebuild") await this.start(true);
      if (message.command === "stop") this.stop();
      if (message.command === "refresh") await this.refresh();
    });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const status = await this.status.readStatus();
    if (this.panel) this.panel.webview.html = renderIndexingHtml(status, this.runner.running, this.logs);
  }

  async start(rebuild: boolean): Promise<void> {
    const accepted = await vscode.window.showWarningMessage(
      rebuild ? "将完全重建当前工作区语义索引。旧索引会被替换。" : "将为当前工作区增量构建语义索引。",
      { modal: rebuild },
      rebuild ? "完全重建" : "开始构建",
    );
    if (accepted !== (rebuild ? "完全重建" : "开始构建")) return;

    this.logs = [];
    await this.open();
    this.postLog(rebuild ? "开始完全重建索引…" : "开始增量构建索引…");

    void vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: rebuild ? "Reasonix 正在完全重建语义索引" : "Reasonix 正在构建语义索引" },
      async () => {
        const exitCode = await this.runner.run({
          rebuild,
          onLine: (line) => this.postLog(line),
        });
        this.postLog(exitCode === 0 ? "索引任务完成。" : `索引任务退出，exit=${exitCode}`);
        await this.ctx.eventBus.emit("indexing.completed", { exitCode, rebuild });
        await this.refresh();
        if (exitCode === 0) vscode.window.showInformationMessage("Reasonix 语义索引完成。下一次 ACP 会话会自动发现索引。 ");
        else vscode.window.showErrorMessage(`Reasonix 语义索引失败，exit=${exitCode}。请查看 Indexing 面板日志。`);
      },
    );
    await this.refresh();
  }

  stop(): void {
    this.runner.stop();
    this.postLog("已请求停止索引任务。 ");
  }

  private postLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 300) this.logs = this.logs.slice(-300);
    void this.refresh();
    this.ctx.output.appendLine(`[reasonix-index] ${line}`);
  }
}

function renderIndexingHtml(status: IndexStatus, running: boolean, logs: string[]): string {
  return /* html */ `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reasonix Indexing</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 16px; margin-bottom: 14px; background: var(--vscode-sideBar-background); }
    .kv { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 8px; margin: 6px 0; }
    .k { color: var(--vscode-descriptionForeground); }
    code, pre { color: var(--vscode-textPreformat-foreground); }
    pre { white-space: pre-wrap; max-height: 360px; overflow: auto; background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 8px; }
    button { margin-right: 8px; margin-bottom: 8px; padding: 6px 10px; }
    .ok { color: var(--vscode-testing-iconPassed); }
    .warn { color: var(--vscode-editorWarning-foreground); }
  </style>
</head>
<body>
  <h1>Reasonix 代码索引</h1>
  <section class="card">
    <h2>索引状态 ${status.exists ? '<span class="ok">● 已构建</span>' : '<span class="warn">● 尚无索引</span>'}</h2>
    <div class="kv"><span class="k">工作区</span><code>${escapeHtml(status.workspaceRoot ?? "未打开工作区")}</code></div>
    <div class="kv"><span class="k">索引目录</span><code>${escapeHtml(status.semanticDir ?? "—")}</code></div>
    <div class="kv"><span class="k">分块数</span><span>${status.chunks}</span></div>
    <div class="kv"><span class="k">大小</span><span>${formatBytes(status.bytes)}</span></div>
    <div class="kv"><span class="k">模型</span><span>${escapeHtml(String(status.meta?.model ?? "—"))}</span></div>
    <div class="kv"><span class="k">Provider</span><span>${escapeHtml(String(status.meta?.provider ?? "—"))}</span></div>
    <div class="kv"><span class="k">更新时间</span><span>${escapeHtml(status.updatedAt ?? "—")}</span></div>
    <button data-command="refresh">刷新</button>
    <button data-command="build" ${running ? "disabled" : ""}>增量构建</button>
    <button data-command="rebuild" ${running ? "disabled" : ""}>完全重建</button>
    <button data-command="stop" ${running ? "" : "disabled"}>停止</button>
    <p>索引由 <code>reasonix index --dir 当前工作区 --yes</code> 驱动，不改上游源码。构建完成后，下一次聊天 ACP 会话会发现并使用 <code>semantic_search</code>。</p>
  </section>
  <section class="card">
    <h2>任务日志</h2>
    <pre>${escapeHtml(logs.length ? logs.join("\n") : "暂无日志。")}</pre>
  </section>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-command]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
    });
  </script>
</body>
</html>`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
