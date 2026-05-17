import * as vscode from "vscode";
import { ConfigStore } from "./core/config-store";
import type { ReasonixExtensionContext } from "./core/context";
import { EventBus } from "./core/event-bus";
import { ModuleManager } from "./core/module-manager";
import { SecretStore } from "./core/secret-store";
import { ChatModule } from "./modules/chat";
import { CloudSyncModule } from "./modules/cloud-sync";
import { IndexingModule } from "./modules/indexing";
import { ModelsModule } from "./modules/models";
import { PermissionsModule } from "./modules/permissions";
import { ProvidersModule } from "./modules/providers";
import { ReviewModule } from "./modules/review";
import { SettingsModule } from "./modules/settings";
import { StatusBarModule } from "./modules/statusbar";

let manager: ModuleManager | undefined;

/**
 * Extension bootstrap only wires core services and modules. All product features
 * live under src/modules/* so future additions remain fork-friendly.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Reasonix");
  const ctx: ReasonixExtensionContext = {
    vscodeContext: context,
    output,
    eventBus: new EventBus(),
    configStore: new ConfigStore(context.globalState),
    secretStore: new SecretStore(context.secrets, context.globalState),
  };

  manager = new ModuleManager(ctx, [
    SettingsModule,
    ProvidersModule,
    ModelsModule,
    ChatModule,
    IndexingModule,
    PermissionsModule,
    ReviewModule,
    StatusBarModule,
    CloudSyncModule,
  ]);
  await manager.activateAll();
}

export async function deactivate(): Promise<void> {
  await manager?.deactivateAll();
}
