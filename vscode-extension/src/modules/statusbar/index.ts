import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { CloudSyncStore } from "../cloud-sync/cloud-sync-store";
import { IndexStatusService } from "../indexing/index-status";
import { ProviderStore } from "../providers/provider-store";

export const StatusBarModule: ReasonixModule = {
  id: "statusbar",
  activate(ctx: ReasonixExtensionContext) {
    const controller = new StatusBarController(ctx);
    ctx.vscodeContext.subscriptions.push(controller);
    controller.activate();
  },
};

class StatusBarController implements vscode.Disposable {
  private readonly modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  private readonly indexItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 89);
  private readonly syncItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 88);
  private readonly status = new IndexStatusService();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly ctx: ReasonixExtensionContext) {}

  activate(): void {
    this.modelItem.command = "reasonix.models.select";
    this.indexItem.command = "reasonix.indexing.open";
    this.syncItem.command = "reasonix.openSettings";
    this.disposables = [
      this.modelItem,
      this.indexItem,
      this.syncItem,
      this.ctx.eventBus.on("provider.changed", () => this.refresh()),
      this.ctx.eventBus.on("model.changed", () => this.refresh()),
      this.ctx.eventBus.on("indexing.completed", () => this.refresh()),
      this.ctx.eventBus.on("cloudSync.syncCompleted", () => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
    ];
    this.ctx.vscodeContext.subscriptions.push(...this.disposables);
    this.modelItem.show();
    this.indexItem.show();
    this.syncItem.show();
    void this.refresh();
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  private async refresh(): Promise<void> {
    const provider = new ProviderStore(this.ctx).activeProvider();
    const sync = new CloudSyncStore(this.ctx).getConfig();
    const index = await this.status.readStatus();
    this.modelItem.text = `$(hubot) ${provider.model}`;
    this.modelItem.tooltip = `Reasonix Provider: ${provider.name}\n${provider.baseUrl}`;
    this.indexItem.text = index.exists ? `$(database) Index ${index.chunks}` : "$(database) Index —";
    this.indexItem.tooltip = index.exists ? `Reasonix semantic index\n${index.semanticDir}\nchunks: ${index.chunks}` : "Reasonix semantic index 未构建";
    this.syncItem.text = sync.repoUrl ? "$(cloud-upload) Sync" : "$(cloud) Sync —";
    this.syncItem.tooltip = sync.repoUrl ? `Cloud Sync: ${sync.repoUrl}\n${sync.branch}/${sync.remotePath}` : "Reasonix Cloud Sync 未配置";
  }
}
