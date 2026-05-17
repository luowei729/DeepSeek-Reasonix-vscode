import type { ReasonixExtensionContext } from "../../core/context";
import { WorkspaceDataService, type BackupPayload } from "../../services/workspace-data";

/**
 * Builds the full plaintext manifest before encryption. This is deliberately
 * isolated so future modules can add more data sources without touching GitHub IO.
 */
export class BackupBuilder {
  private readonly workspaceData = new WorkspaceDataService();

  constructor(private readonly ctx: ReasonixExtensionContext) {}

  async buildFullBackup(): Promise<BackupPayload> {
    const extensionState = this.ctx.configStore.exportTracked();
    const secrets = await this.ctx.secretStore.exportTracked();
    return this.workspaceData.buildPayload(extensionState, secrets);
  }
}
