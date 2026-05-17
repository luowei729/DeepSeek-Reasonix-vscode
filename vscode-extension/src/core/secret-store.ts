import type * as vscode from "vscode";

const TRACKED_SECRET_KEYS = "reasonix.trackedSecretKeys";

export interface TrackedSecret {
  key: string;
  value: string;
}

/**
 * SecretStorage wrapper. It keeps a non-secret index of keys so encrypted cloud
 * backup can include API tokens after the user explicitly asked for full backup.
 */
export class SecretStore {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly state: vscode.Memento,
  ) {}

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string, track = true): Promise<void> {
    await this.secrets.store(key, value);
    if (track) await this.trackKey(key);
  }

  async delete(key: string): Promise<void> {
    await this.secrets.delete(key);
    await this.untrackKey(key);
  }

  async exportTracked(): Promise<TrackedSecret[]> {
    const out: TrackedSecret[] = [];
    for (const key of this.trackedKeys()) {
      const value = await this.secrets.get(key);
      if (value !== undefined) out.push({ key, value });
    }
    return out;
  }

  async importTracked(secrets: TrackedSecret[]): Promise<void> {
    for (const item of secrets) {
      if (!item.key || typeof item.value !== "string") continue;
      await this.store(item.key, item.value, true);
    }
  }

  private trackedKeys(): string[] {
    return this.state.get<string[]>(TRACKED_SECRET_KEYS, []);
  }

  private async trackKey(key: string): Promise<void> {
    const next = Array.from(new Set([...this.trackedKeys(), key])).sort();
    await this.state.update(TRACKED_SECRET_KEYS, next);
  }

  private async untrackKey(key: string): Promise<void> {
    await this.state.update(
      TRACKED_SECRET_KEYS,
      this.trackedKeys().filter((item) => item !== key),
    );
  }
}
