import type { ReasonixModule } from "./module";
import type { ReasonixExtensionContext } from "./context";

/**
 * Central module lifecycle manager. New features should be registered by adding
 * one module instance here, not by expanding extension.ts with feature logic.
 */
export class ModuleManager {
  constructor(
    private readonly ctx: ReasonixExtensionContext,
    private readonly modules: ReasonixModule[],
  ) {}

  async activateAll(): Promise<void> {
    for (const mod of this.modules) {
      this.ctx.output.appendLine(`[reasonix] activating module: ${mod.id}`);
      await mod.activate(this.ctx);
    }
  }

  async deactivateAll(): Promise<void> {
    for (const mod of [...this.modules].reverse()) {
      await mod.deactivate?.();
    }
  }
}
