import type * as vscode from "vscode";
import type { ConfigStore } from "./config-store";
import type { EventBus } from "./event-bus";
import type { SecretStore } from "./secret-store";

/**
 * Shared dependency bag passed to every module. Keeping dependencies here avoids
 * direct imports between feature modules and makes future syncs with upstream
 * Reasonix less likely to conflict.
 */
export interface ReasonixExtensionContext {
  vscodeContext: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  eventBus: EventBus;
  configStore: ConfigStore;
  secretStore: SecretStore;
}
