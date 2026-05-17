import { existsSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import type { ReasonixExtensionContext } from "../core/context";
import { currentWorkspaceRoot } from "./workspace-data";

export interface ReasonixCliLaunch {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Resolves the least-invasive way to run Reasonix. The VSIX bundles the built
 * root dist, but development sessions can fall back to the repo dist folder.
 */
export class ReasonixCliService {
  constructor(private readonly ctx: ReasonixExtensionContext) {}

  acpLaunch(model: string): ReasonixCliLaunch {
    const workspace = this.workspaceRoot();
    return this.launch(["acp", "--dir", workspace, "--model", model], workspace);
  }

  indexLaunch(opts: { rebuild?: boolean; model?: string; yes?: boolean } = {}): ReasonixCliLaunch {
    const workspace = this.workspaceRoot();
    const args = ["index", "--dir", workspace];
    if (opts.rebuild) args.push("--rebuild");
    if (opts.model) args.push("--model", opts.model);
    // The VS Code UI owns confirmation, so non-interactive indexing should skip CLI prompts.
    if (opts.yes !== false) args.push("--yes");
    return this.launch(args, workspace);
  }

  private launch(reasonixArgs: string[], cwd: string): ReasonixCliLaunch {
    const config = vscode.workspace.getConfiguration("reasonix");
    const cliPath = config.get<string>("cliPath")?.trim();

    if (cliPath) return { command: cliPath, args: reasonixArgs, cwd };

    const node = config.get<string>("nodePath")?.trim() || "node";
    const bundled = path.join(this.ctx.vscodeContext.extensionPath, "reasonix", "dist", "cli", "index.js");
    const dev = path.resolve(this.ctx.vscodeContext.extensionPath, "..", "dist", "cli", "index.js");
    const entry = existsSync(bundled) ? bundled : dev;
    return { command: node, args: [entry, ...reasonixArgs], cwd };
  }

  private workspaceRoot(): string {
    return currentWorkspaceRoot() ?? this.ctx.vscodeContext.extensionPath;
  }
}
