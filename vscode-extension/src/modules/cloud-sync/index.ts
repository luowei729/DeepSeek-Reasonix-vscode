import type { ReasonixExtensionContext } from "../../core/context";
import type { ReasonixModule } from "../../core/module";
import { CloudSyncController } from "./cloud-sync-controller";

/**
 * Cloud Sync is a self-contained module so encrypted GitHub backup/restore can
 * evolve without touching chat, ACP, provider, or indexing modules.
 */
export const CloudSyncModule: ReasonixModule = {
  id: "cloud-sync",
  activate(ctx: ReasonixExtensionContext) {
    const controller = new CloudSyncController(ctx);
    ctx.vscodeContext.subscriptions.push(controller);
    controller.register();
  },
};
