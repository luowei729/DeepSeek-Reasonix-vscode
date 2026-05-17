import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { ReasonixExtensionContext } from "../../core/context";
import { ReasonixCliService } from "../../services/reasonix-cli";
import { ProviderStore } from "../providers/provider-store";

export interface IndexRunOptions {
  rebuild?: boolean;
  model?: string;
  onLine?: (line: string) => void;
}

/**
 * Runs `reasonix index` as a child process. Keeping this process-based avoids
 * importing upstream internals and preserves a clean fork boundary.
 */
export class IndexRunner {
  private child: ChildProcessWithoutNullStreams | undefined;

  constructor(private readonly ctx: ReasonixExtensionContext) {}

  get running(): boolean {
    return !!this.child;
  }

  async run(opts: IndexRunOptions): Promise<number> {
    if (this.child) throw new Error("已有索引任务正在运行。");

    const providerStore = new ProviderStore(this.ctx);
    const launch = new ReasonixCliService(this.ctx).indexLaunch({ rebuild: opts.rebuild, model: opts.model });
    const env = await providerStore.environment();

    return new Promise<number>((resolve, reject) => {
      this.child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: { ...process.env, ...env },
        stdio: "pipe",
      });

      const stdout = createInterface({ input: this.child.stdout });
      stdout.on("line", (line) => opts.onLine?.(line));

      const stderr = createInterface({ input: this.child.stderr });
      stderr.on("line", (line) => opts.onLine?.(line));

      this.child.on("error", (err) => {
        this.child = undefined;
        reject(err);
      });

      this.child.on("exit", (code, signal) => {
        this.child = undefined;
        const exitCode = code ?? (signal ? 130 : 1);
        resolve(exitCode);
      });
    });
  }

  stop(): void {
    if (!this.child) return;
    this.child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  }
}
