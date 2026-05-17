import type * as vscode from "vscode";

const TRACKED_CONFIG_KEYS = "reasonix.trackedConfigKeys";

export interface TrackedConfigValue {
  key: string;
  value: unknown;
}

/**
 * Small typed wrapper around VS Code globalState. Feature modules use this
 * instead of reaching into mementos directly so settings remain centralized.
 */
export class ConfigStore {
  constructor(private readonly state: vscode.Memento) {}

  get<T>(key: string, fallback: T): T {
    return this.state.get<T>(key, fallback);
  }

  async update<T>(key: string, value: T, track = true): Promise<void> {
    await this.state.update(key, value);
    // Track keys written by modules so encrypted Cloud Sync can restore plugin
    // settings on a new machine without reaching into VS Code internals.
    if (track) await this.trackKey(key);
  }

  exportTracked(): TrackedConfigValue[] {
    return this.trackedKeys()
      .map((key) => ({ key, value: this.state.get(key) }))
      .filter((item) => item.value !== undefined);
  }

  async importTracked(items: TrackedConfigValue[]): Promise<void> {
    for (const item of items) {
      if (!item.key) continue;
      await this.update(item.key, item.value, true);
    }
  }

  private trackedKeys(): string[] {
    return this.state.get<string[]>(TRACKED_CONFIG_KEYS, []);
  }

  private async trackKey(key: string): Promise<void> {
    if (key === TRACKED_CONFIG_KEYS) return;
    const next = Array.from(new Set([...this.trackedKeys(), key])).sort();
    await this.state.update(TRACKED_CONFIG_KEYS, next);
  }
}
