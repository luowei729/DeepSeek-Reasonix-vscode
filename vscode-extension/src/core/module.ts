import type { ReasonixExtensionContext } from "./context";

/**
 * Feature modules implement this small contract so new VS Code features can be
 * added as isolated folders without changing the extension bootstrap logic.
 */
export interface ReasonixModule {
  /** Stable id used for logs and future module-level settings. */
  id: string;
  /** Activate registers commands, views, timers, and event handlers. */
  activate(ctx: ReasonixExtensionContext): Promise<void> | void;
  /** Deactivate lets a module dispose timers or long-running resources. */
  deactivate?(): Promise<void> | void;
}
