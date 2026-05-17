import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../../core/context";
import { currentWorkspaceRoot, projectHash } from "../../services/workspace-data";
import { BackupBuilder } from "./backup-builder";
import { CloudSyncStore } from "./cloud-sync-store";
import { CryptoService } from "./crypto-service";
import { GitHubClient } from "./github-client";
import { requestEncryptionPassword } from "./password-dialog";
import { RestoreService } from "./restore-service";
import { SyncScheduler } from "./sync-scheduler";
import type { ChunkManifest, CloudSyncConfig, EncryptedBackupEnvelope } from "./sync-types";

const CHUNK_SIZE = 900_000;

/**
 * Coordinates configuration, encryption, GitHub upload/download, and restore.
 * The controller is intentionally UI-command based for the first implementation
 * so the module stays small and fork-friendly while still supporting new machines.
 */
export class CloudSyncController implements vscode.Disposable {
  private readonly store: CloudSyncStore;
  private readonly crypto = new CryptoService();
  private readonly builder: BackupBuilder;
  private readonly restoreService: RestoreService;
  private readonly scheduler = new SyncScheduler();
  private disposables: vscode.Disposable[] = [];
  private unlockedPassword: string | undefined;

  constructor(private readonly ctx: ReasonixExtensionContext) {
    this.store = new CloudSyncStore(ctx);
    this.builder = new BackupBuilder(ctx);
    this.restoreService = new RestoreService(ctx);
  }

  register(): void {
    this.disposables = [
      vscode.commands.registerCommand("reasonix.cloudSync.configure", () => this.configure()),
      vscode.commands.registerCommand("reasonix.cloudSync.syncNow", () => this.syncNow()),
      vscode.commands.registerCommand("reasonix.cloudSync.unlock", () => this.unlock()),
      vscode.commands.registerCommand("reasonix.cloudSync.restore", () => this.restoreLatest()),
      vscode.commands.registerCommand("reasonix.cloudSync.restoreSnapshot", () => this.restoreSnapshot()),
      // Settings webview can save config without going through configure(); keep
      // the auto-sync scheduler aligned with those inline form changes.
      this.ctx.eventBus.on<CloudSyncConfig>("cloudSync.configChanged", (config) => this.scheduler.start(config, () => this.syncNow({ silent: true }))),
    ];
    this.ctx.vscodeContext.subscriptions.push(...this.disposables);
    this.scheduler.start(this.store.getConfig(), () => this.syncNow({ silent: true }));
  }

  dispose(): void {
    this.scheduler.stop();
    for (const item of this.disposables) item.dispose();
  }

  async configure(): Promise<void> {
    const current = this.store.getConfig();
    const repoUrl = await vscode.window.showInputBox({
      title: "Reasonix GitHub 云同步仓库",
      prompt: "输入 GitHub 仓库地址，例如 https://github.com/user/reasonix-backup 或 user/reasonix-backup。建议使用 private 仓库。",
      value: current.repoUrl,
      ignoreFocusOut: true,
    });
    if (!repoUrl) return;

    const token = await vscode.window.showInputBox({
      title: "GitHub Token",
      prompt: "输入具有目标仓库 Contents Read/Write 权限的 Token。Token 将保存在 VS Code SecretStorage，并会被加密备份到云端。",
      password: true,
      ignoreFocusOut: true,
      value: await this.store.getGithubToken(),
    });
    if (!token) return;

    const branch =
      (await vscode.window.showInputBox({
        title: "同步分支",
        value: current.branch || "main",
        ignoreFocusOut: true,
      })) || "main";

    const remotePath =
      (await vscode.window.showInputBox({
        title: "云端备份目录",
        value: current.remotePath || ".reasonix-cloud-sync",
        ignoreFocusOut: true,
      })) || ".reasonix-cloud-sync";

    const auto = await vscode.window.showQuickPick(
      [
        { label: "关闭自动同步", value: false },
        { label: "开启自动同步（当前 VS Code 会话解锁后生效）", value: true },
      ],
      { title: "自动同步" },
    );
    if (!auto) return;

    const next: CloudSyncConfig = { repoUrl, branch, remotePath, autoSync: auto.value };
    const client = new GitHubClient(repoUrl, token, branch);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Reasonix 正在测试 GitHub 连接" },
      () => client.testConnection(),
    );

    await this.store.saveConfig(next);
    await this.store.saveGithubToken(token);
    this.scheduler.start(next, () => this.syncNow({ silent: true }));
    vscode.window.showInformationMessage("Reasonix GitHub 云同步配置已保存。");
  }

  async unlock(): Promise<void> {
    const password = await requestEncryptionPassword({ purpose: "unlock", confirm: true });
    if (!password) return;
    this.unlockedPassword = password;
    vscode.window.showInformationMessage("Reasonix 云同步已在当前 VS Code 会话中解锁。密码未保存，重启后需要重新输入。 ");
  }

  async syncNow(opts: { silent?: boolean } = {}): Promise<void> {
    try {
      const { config, client } = await this.ensureClient();
      const password = await this.ensurePassword(opts.silent ? "silent" : "prompt-confirm");
      if (!password) return;

      if (!opts.silent) {
        const accepted = await vscode.window.showWarningMessage(
          "本次备份会包含 Reasonix 用户数据中的 API Key、API Token、会话、记忆、语义索引等全部数据；上传到 GitHub 前会使用你的加密密码加密。请确认你记得该密码。",
          { modal: true },
          "开始加密备份",
        );
        if (accepted !== "开始加密备份") return;
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Reasonix 正在加密并同步备份" },
        async (progress) => {
          progress.report({ message: "收集本机 Reasonix 用户数据" });
          const payload = await this.builder.buildFullBackup();
          progress.report({ message: `加密 ${payload.files.length} 个文件、${payload.extensionState.length} 个插件配置和 ${payload.secrets.length} 个扩展密钥` });
          const envelope = await this.crypto.encrypt(payload, password);
          progress.report({ message: "上传加密备份到 GitHub" });
          await this.uploadEnvelope(
            client,
            config,
            payload.project.hash,
            envelope,
            payload.files.length,
            payload.extensionState.length,
            payload.secrets.length,
          );
          await this.ctx.eventBus.emit("cloudSync.syncCompleted", {
            files: payload.files.length,
            extensionState: payload.extensionState.length,
            secrets: payload.secrets.length,
          });
        },
      );
      if (!opts.silent) vscode.window.showInformationMessage("Reasonix 加密云备份已同步到 GitHub。");
    } catch (err) {
      await this.ctx.eventBus.emit("cloudSync.syncFailed", { error: String(err) });
      this.ctx.output.appendLine(`[reasonix][cloud-sync] sync failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      if (!opts.silent) vscode.window.showErrorMessage(`Reasonix 云同步失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async restoreLatest(): Promise<void> {
    try {
      const { config, client } = await this.ensureClient(true);
      const password = await requestEncryptionPassword({ purpose: "restore", confirm: false });
      if (!password) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Reasonix 正在下载并解密云备份" },
        async (progress) => {
          progress.report({ message: "读取 GitHub latest 备份清单" });
          const envelope = await this.downloadLatestEnvelope(client, config);
          progress.report({ message: "使用加密密码解密备份" });
          const payload = await this.crypto.decrypt(envelope, password);
          const targetWorkspace = await this.resolveRestoreWorkspace(payload.files.filter((file) => file.scope === "workspace").length);
          const preview = this.restoreService.preview(payload, targetWorkspace);
          const conflicts = preview.conflicts?.length ?? 0;
          const accepted = await vscode.window.showWarningMessage(
            `即将恢复 Reasonix 备份：全局文件 ${preview.globalFiles} 个，项目文件 ${preview.workspaceFiles} 个，插件配置 ${preview.extensionState} 个，扩展密钥 ${preview.secrets} 个；检测到 ${conflicts} 个本地同路径文件会被覆盖。`,
            { modal: true },
            "恢复备份",
          );
          if (accepted !== "恢复备份") return;

          progress.report({ message: "写入本机配置、Token、记忆、会话和项目数据" });
          const summary = await this.restoreService.restore(payload, targetWorkspace);
          this.unlockedPassword = password;
          await this.ctx.eventBus.emit("cloudSync.restoreCompleted", summary);
          vscode.window.showInformationMessage(
            `Reasonix 备份恢复完成：写入 ${summary.filesWritten} 个文件，恢复 ${summary.secretsWritten} 个扩展密钥。`,
          );
        },
      );
    } catch (err) {
      this.ctx.output.appendLine(`[reasonix][cloud-sync] restore failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      vscode.window.showErrorMessage(`Reasonix 恢复备份失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async restoreSnapshot(): Promise<void> {
    try {
      const { config, client } = await this.ensureClient(true);
      const snapshots = await this.listSnapshotManifests(client, config);
      if (snapshots.length === 0) throw new Error("没有找到可恢复的历史快照。 ");
      const picked = await vscode.window.showQuickPick(
        snapshots.map((snapshot) => ({ label: snapshot.name, description: snapshot.path, snapshot })),
        { title: "选择 Reasonix 云端快照" },
      );
      if (!picked) return;
      const password = await requestEncryptionPassword({ purpose: "restore", confirm: false });
      if (!password) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Reasonix 正在恢复指定云端快照" },
        async (progress) => {
          progress.report({ message: picked.snapshot.path });
          const envelope = await this.downloadEnvelopeFromManifestPath(client, picked.snapshot.path);
          const payload = await this.crypto.decrypt(envelope, password);
          const targetWorkspace = await this.resolveRestoreWorkspace(payload.files.filter((file) => file.scope === "workspace").length);
          const preview = this.restoreService.preview(payload, targetWorkspace);
          const accepted = await vscode.window.showWarningMessage(
            `恢复快照 ${picked.snapshot.name}：全局文件 ${preview.globalFiles} 个，项目文件 ${preview.workspaceFiles} 个，插件配置 ${preview.extensionState} 个，扩展密钥 ${preview.secrets} 个；将覆盖 ${preview.conflicts?.length ?? 0} 个本地同路径文件。`,
            { modal: true },
            "恢复该快照",
          );
          if (accepted !== "恢复该快照") return;
          const summary = await this.restoreService.restore(payload, targetWorkspace);
          this.unlockedPassword = password;
          await this.ctx.eventBus.emit("cloudSync.restoreCompleted", summary);
          vscode.window.showInformationMessage(`Reasonix 快照恢复完成：写入 ${summary.filesWritten} 个文件，恢复 ${summary.secretsWritten} 个扩展密钥。`);
        },
      );
    } catch (err) {
      this.ctx.output.appendLine(`[reasonix][cloud-sync] snapshot restore failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      vscode.window.showErrorMessage(`Reasonix 恢复快照失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async ensureClient(allowConfigure = false): Promise<{ config: CloudSyncConfig; client: GitHubClient }> {
    let config = this.store.getConfig();
    let token = await this.store.getGithubToken();

    if (allowConfigure && (!config.repoUrl || !token)) {
      await this.configure();
      config = this.store.getConfig();
      token = await this.store.getGithubToken();
    }

    if (!config.repoUrl) throw new Error("未配置 GitHub 备份仓库。请先运行 Reasonix: Open Settings 或 Reasonix: Cloud Sync Configure。");
    if (!token) throw new Error("未配置 GitHub Token。请先配置云同步。 ");
    return { config, client: new GitHubClient(config.repoUrl, token, config.branch) };
  }

  private async ensurePassword(mode: "silent" | "prompt-confirm"): Promise<string | undefined> {
    if (this.unlockedPassword) return this.unlockedPassword;
    if (mode === "silent") {
      this.ctx.output.appendLine("[reasonix][cloud-sync] auto sync skipped because encryption password is not unlocked for this VS Code session.");
      return undefined;
    }
    const password = await requestEncryptionPassword({ purpose: "sync", confirm: true });
    this.unlockedPassword = password;
    return password;
  }

  private async uploadEnvelope(
    client: GitHubClient,
    config: CloudSyncConfig,
    project: string,
    envelope: EncryptedBackupEnvelope,
    payloadFileCount: number,
    payloadStateCount: number,
    payloadSecretCount: number,
  ): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = config.remotePath.replace(/^\/+|\/+$/g, "");
    const text = JSON.stringify(envelope);
    const chunks = splitChunks(text, CHUNK_SIZE);
    const manifest: ChunkManifest = {
      version: 1,
      kind: "reasonix-cloud-sync-chunked",
      createdAt: new Date().toISOString(),
      projectHash: project,
      payloadFileCount,
      payloadStateCount,
      payloadSecretCount,
      chunks: chunks.map((chunk, index) => ({
        path: `${base}/chunks/${stamp}-${String(index).padStart(5, "0")}.txt`,
        sha256: sha256(chunk),
        size: Buffer.byteLength(chunk, "utf8"),
      })),
    };

    for (let index = 0; index < chunks.length; index += 1) {
      await client.putText(manifest.chunks[index]!.path, chunks[index]!, `reasonix cloud sync chunk ${stamp} ${index + 1}/${chunks.length}`);
    }

    const manifestText = JSON.stringify(manifest, null, 2);
    await client.putText(`${base}/latest.enc.json`, manifestText, "reasonix cloud sync latest backup");
    await client.putText(`${base}/projects/${project}/latest.enc.json`, manifestText, `reasonix cloud sync latest backup for ${project}`);
    await client.putText(`${base}/projects/${project}/snapshots/${stamp}.enc.json`, manifestText, `reasonix cloud sync snapshot ${stamp}`);
  }

  private async downloadLatestEnvelope(client: GitHubClient, config: CloudSyncConfig): Promise<EncryptedBackupEnvelope> {
    const base = config.remotePath.replace(/^\/+|\/+$/g, "");
    const currentProject = projectHash(currentWorkspaceRoot());
    const candidates = [`${base}/latest.enc.json`, `${base}/projects/${currentProject}/latest.enc.json`];
    let manifestFile = null as Awaited<ReturnType<GitHubClient["getText"]>>;

    for (const candidate of candidates) {
      manifestFile = await client.getText(candidate);
      if (manifestFile) break;
    }
    if (!manifestFile) throw new Error("GitHub 仓库中没有找到 Reasonix latest 备份。 ");

    return this.readEnvelopeFromManifestText(client, manifestFile.content);
  }

  private async downloadEnvelopeFromManifestPath(client: GitHubClient, manifestPath: string): Promise<EncryptedBackupEnvelope> {
    const manifestFile = await client.getText(manifestPath);
    if (!manifestFile) throw new Error(`备份清单不存在：${manifestPath}`);
    return this.readEnvelopeFromManifestText(client, manifestFile.content);
  }

  private async readEnvelopeFromManifestText(client: GitHubClient, manifestText: string): Promise<EncryptedBackupEnvelope> {
    const manifest = JSON.parse(manifestText) as ChunkManifest;
    if (manifest.kind !== "reasonix-cloud-sync-chunked") throw new Error("不支持的 Reasonix 备份清单格式。");

    const parts: string[] = [];
    for (const chunk of manifest.chunks) {
      const file = await client.getText(chunk.path);
      if (!file) throw new Error(`备份分片缺失：${chunk.path}`);
      if (sha256(file.content) !== chunk.sha256) throw new Error(`备份分片校验失败：${chunk.path}`);
      parts.push(file.content);
    }
    return JSON.parse(parts.join("")) as EncryptedBackupEnvelope;
  }

  private async listSnapshotManifests(client: GitHubClient, config: CloudSyncConfig): Promise<Array<{ name: string; path: string }>> {
    const base = config.remotePath.replace(/^\/+|\/+$/g, "");
    const currentProject = projectHash(currentWorkspaceRoot());
    const entries = await client.listDirectory(`${base}/projects/${currentProject}/snapshots`);
    return entries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".enc.json"))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 50)
      .map((entry) => ({ name: entry.name.replace(/\.enc\.json$/, ""), path: entry.path }));
  }

  private async resolveRestoreWorkspace(workspaceFiles: number): Promise<string | undefined> {
    if (workspaceFiles === 0) return undefined;
    const root = currentWorkspaceRoot();
    if (root) return root;

    const picked = await vscode.window.showOpenDialog({
      title: "选择要恢复项目级 Reasonix 数据的文件夹",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "选择恢复目录",
    });
    return picked?.[0]?.fsPath;
  }
}

function splitChunks(value: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out.length > 0 ? out : [""];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
