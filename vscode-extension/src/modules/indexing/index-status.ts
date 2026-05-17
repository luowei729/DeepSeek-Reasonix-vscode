import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { currentWorkspaceRoot } from "../../services/workspace-data";

export interface IndexStatus {
  workspaceRoot?: string;
  exists: boolean;
  semanticDir?: string;
  meta?: Record<string, unknown>;
  chunks: number;
  bytes: number;
  updatedAt?: string;
}

/**
 * Reads the on-disk semantic index status without importing upstream internals,
 * keeping this VS Code module independent from Reasonix source layout changes.
 */
export class IndexStatusService {
  async readStatus(workspaceRoot = currentWorkspaceRoot()): Promise<IndexStatus> {
    if (!workspaceRoot) return { exists: false, chunks: 0, bytes: 0 };

    const semanticDir = path.join(workspaceRoot, ".reasonix", "semantic");
    const metaPath = path.join(semanticDir, "index.meta.json");
    const dataPath = path.join(semanticDir, "index.jsonl");
    const exists = existsSync(metaPath) && existsSync(dataPath);
    if (!exists) return { workspaceRoot, exists: false, semanticDir, chunks: 0, bytes: 0 };

    const [metaRaw, stat] = await Promise.all([fs.readFile(metaPath, "utf8"), fs.stat(dataPath)]);
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    return {
      workspaceRoot,
      exists: true,
      semanticDir,
      meta,
      chunks: await countLines(dataPath),
      bytes: stat.size,
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
    };
  }
}

async function countLines(filePath: string): Promise<number> {
  let count = 0;
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    if (line.trim()) count += 1;
  }
  return count;
}
