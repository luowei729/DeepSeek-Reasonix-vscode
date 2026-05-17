import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import type { TrackedConfigValue } from "../core/config-store";
import type { TrackedSecret } from "../core/secret-store";

export type BackupScope = "globalReasonix" | "workspace";

export interface BackupFileEntry {
  /** Scope decides whether restore writes under ~/.reasonix or the selected workspace. */
  scope: BackupScope;
  /** Slash-normalized path relative to the scope root. */
  relativePath: string;
  /** Base64 keeps binary files such as semantic indexes restorable. */
  contentBase64: string;
  size: number;
  mtimeMs: number;
}

export interface BackupPayload {
  manifestVersion: 1;
  createdAt: string;
  machine: {
    platform: NodeJS.Platform;
    hostname?: string;
  };
  project: {
    hash: string;
    name: string;
    workspacePathHint?: string;
  };
  files: BackupFileEntry[];
  /** VS Code extension module settings such as provider/model/cloud-sync config. */
  extensionState: TrackedConfigValue[];
  /** API tokens stored through the extension wrapper are included only inside the encrypted payload. */
  secrets: TrackedSecret[];
}

export interface RestoreSummary {
  filesWritten: number;
  secretsWritten: number;
  targetWorkspaceRoot?: string;
}

const PROJECT_MEMORY_FILES = ["REASONIX.md", "reasonix.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md"];

export function reasonixHomeDir(): string {
  return path.join(homedir(), ".reasonix");
}

export function currentWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function projectHash(root: string | undefined): string {
  const value = root ? path.resolve(root) : "global-only";
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

/**
 * Collects Reasonix-owned user data only. It intentionally avoids backing up
 * the whole source tree, but includes all Reasonix configs, sessions, semantic
 * indexes, project .reasonix state, and root memory/instruction files.
 */
export class WorkspaceDataService {
  async buildPayload(extensionState: TrackedConfigValue[], secrets: TrackedSecret[]): Promise<BackupPayload> {
    const workspaceRoot = currentWorkspaceRoot();
    const files: BackupFileEntry[] = [];

    await this.collectDirectory(reasonixHomeDir(), "globalReasonix", "", files);

    if (workspaceRoot) {
      await this.collectDirectory(path.join(workspaceRoot, ".reasonix"), "workspace", ".reasonix", files);
      for (const name of PROJECT_MEMORY_FILES) {
        await this.collectFileIfExists(path.join(workspaceRoot, name), "workspace", name, files);
      }
    }

    return {
      manifestVersion: 1,
      createdAt: new Date().toISOString(),
      machine: {
        platform: process.platform,
        hostname: process.env.HOSTNAME || process.env.COMPUTERNAME,
      },
      project: {
        hash: projectHash(workspaceRoot),
        name: workspaceRoot ? path.basename(workspaceRoot) : "global-only",
        workspacePathHint: workspaceRoot,
      },
      files: files.sort((a, b) => `${a.scope}:${a.relativePath}`.localeCompare(`${b.scope}:${b.relativePath}`)),
      extensionState,
      secrets,
    };
  }

  async restorePayload(
    payload: BackupPayload,
    targetWorkspaceRoot: string | undefined,
    importState: (items: TrackedConfigValue[]) => Promise<void>,
    importSecrets: (items: TrackedSecret[]) => Promise<void>,
  ): Promise<RestoreSummary> {
    let filesWritten = 0;

    for (const file of payload.files) {
      const root = file.scope === "globalReasonix" ? reasonixHomeDir() : targetWorkspaceRoot;
      if (!root) continue;

      const target = safeJoin(root, file.relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(file.contentBase64, "base64"));
      filesWritten += 1;
    }

    await importState(payload.extensionState ?? []);
    await importSecrets(payload.secrets ?? []);

    return {
      filesWritten,
      secretsWritten: payload.secrets?.length ?? 0,
      targetWorkspaceRoot,
    };
  }

  private async collectDirectory(root: string, scope: BackupScope, relativeRoot: string, out: BackupFileEntry[]): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(root, entry);
      const relative = relativeRoot ? path.posix.join(toPosix(relativeRoot), entry) : entry;
      const stat = await fs.lstat(absolute);

      // Symlinks are skipped to avoid accidentally backing up data outside the user-data roots.
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await this.collectDirectory(absolute, scope, relative, out);
      } else if (stat.isFile()) {
        await this.collectFile(absolute, scope, relative, stat, out);
      }
    }
  }

  private async collectFileIfExists(absolute: string, scope: BackupScope, relative: string, out: BackupFileEntry[]): Promise<void> {
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isFile()) await this.collectFile(absolute, scope, relative, stat, out);
    } catch {
      // Missing optional project memory files are expected on many workspaces.
    }
  }

  private async collectFile(absolute: string, scope: BackupScope, relative: string, stat: { size: number; mtimeMs: number }, out: BackupFileEntry[]): Promise<void> {
    const content = await fs.readFile(absolute);
    out.push({
      scope,
      relativePath: toPosix(relative),
      contentBase64: content.toString("base64"),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/").replace(/^\/+/, "");
}

function safeJoin(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Unsafe restore path rejected: ${relative}`);
  }
  return target;
}
