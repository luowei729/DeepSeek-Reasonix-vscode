import type { ReasonixExtensionContext } from "../../core/context";
import type { CloudSyncConfig } from "./sync-types";

const CONFIG_KEY = "reasonix.cloudSync.config";
export const GITHUB_TOKEN_SECRET_KEY = "reasonix.cloudSync.githubToken";

const DEFAULT_CONFIG: CloudSyncConfig = {
  repoUrl: "",
  branch: "main",
  remotePath: ".reasonix-cloud-sync",
  autoSync: false,
};

/**
 * Persists non-secret cloud sync settings. GitHub tokens live in SecretStorage;
 * the encryption password is intentionally never persisted anywhere.
 */
export class CloudSyncStore {
  constructor(private readonly ctx: ReasonixExtensionContext) {}

  getConfig(): CloudSyncConfig {
    return this.ctx.configStore.get<CloudSyncConfig>(CONFIG_KEY, DEFAULT_CONFIG);
  }

  async saveConfig(config: CloudSyncConfig): Promise<void> {
    await this.ctx.configStore.update(CONFIG_KEY, normalizeConfig(config));
  }

  async getGithubToken(): Promise<string | undefined> {
    return this.ctx.secretStore.get(GITHUB_TOKEN_SECRET_KEY);
  }

  async saveGithubToken(token: string): Promise<void> {
    await this.ctx.secretStore.store(GITHUB_TOKEN_SECRET_KEY, token, true);
  }
}

function normalizeConfig(config: CloudSyncConfig): CloudSyncConfig {
  return {
    repoUrl: config.repoUrl.trim(),
    branch: config.branch.trim() || "main",
    remotePath: config.remotePath.trim().replace(/^\/+|\/+$/g, "") || ".reasonix-cloud-sync",
    autoSync: !!config.autoSync,
  };
}
