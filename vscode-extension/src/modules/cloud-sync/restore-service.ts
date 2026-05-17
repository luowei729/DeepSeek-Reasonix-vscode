import { existsSync } from "node:fs";
import path from "node:path";
import type { ReasonixExtensionContext } from "../../core/context";
import {
  WorkspaceDataService,
  type BackupPayload,
  currentWorkspaceRoot,
  reasonixHomeDir,
} from "../../services/workspace-data";
import type { RestorePreview } from "./sync-types";

/**
 * Applies decrypted backups to the current machine. It writes global files under
 * the new user's ~/.reasonix and workspace files into the opened/selected project.
 */
export class RestoreService {
  private readonly workspaceData = new WorkspaceDataService();

  constructor(private readonly ctx: ReasonixExtensionContext) {}

  preview(payload: BackupPayload, workspaceRoot = currentWorkspaceRoot()): RestorePreview {
    return {
      payload,
      globalFiles: payload.files.filter((file) => file.scope === "globalReasonix").length,
      workspaceFiles: payload.files.filter((file) => file.scope === "workspace").length,
      extensionState: payload.extensionState?.length ?? 0,
      secrets: payload.secrets?.length ?? 0,
      conflicts: this.findConflicts(payload, workspaceRoot),
    };
  }

  async restore(payload: BackupPayload, workspaceRoot = currentWorkspaceRoot()) {
    return this.workspaceData.restorePayload(
      payload,
      workspaceRoot,
      (items) => this.ctx.configStore.importTracked(items),
      (items) => this.ctx.secretStore.importTracked(items),
    );
  }

  private findConflicts(payload: BackupPayload, workspaceRoot: string | undefined): Array<{ scope: string; relativePath: string }> {
    const conflicts: Array<{ scope: string; relativePath: string }> = [];
    for (const file of payload.files) {
      const root = file.scope === "globalReasonix" ? reasonixHomeDir() : workspaceRoot;
      if (!root) continue;
      const target = path.resolve(root, file.relativePath);
      if (target.startsWith(path.resolve(root)) && existsSync(target)) conflicts.push({ scope: file.scope, relativePath: file.relativePath });
    }
    return conflicts.slice(0, 200);
  }
}
