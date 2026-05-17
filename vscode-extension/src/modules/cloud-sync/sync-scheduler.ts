import type { CloudSyncConfig } from "./sync-types";

/**
 * Simple timer wrapper for future automatic backup. The controller owns the
 * actual sync operation so this scheduler remains reusable and testable.
 */
export class SyncScheduler {
  private timer: NodeJS.Timeout | undefined;

  start(config: CloudSyncConfig, sync: () => Promise<void>): void {
    this.stop();
    if (!config.autoSync) return;

    // A conservative interval avoids surprising GitHub API usage while still backing up active work.
    this.timer = setInterval(() => {
      void sync();
    }, 30 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
