import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "..");
const repoRoot = path.resolve(extensionRoot, "..");
const stagedRoot = path.join(extensionRoot, "reasonix");

async function mustExist(target) {
  try {
    await stat(target);
  } catch {
    throw new Error(`${target} is missing. Run npm run build at the repository root before packaging the VSIX.`);
  }
}

await mustExist(path.join(repoRoot, "dist", "cli", "index.js"));
await rm(stagedRoot, { recursive: true, force: true });
await mkdir(stagedRoot, { recursive: true });

// Stage only runtime assets needed by the VSIX. Keeping this as a copy step
// avoids changing the upstream package layout or root package.json.
await cp(path.join(repoRoot, "dist"), path.join(stagedRoot, "dist"), { recursive: true });
await cp(path.join(repoRoot, "data"), path.join(stagedRoot, "data"), { recursive: true });
await cp(path.join(repoRoot, "package.json"), path.join(stagedRoot, "package.json"));
await cp(path.join(repoRoot, "README.md"), path.join(stagedRoot, "README.md"));
await cp(path.join(repoRoot, "LICENSE"), path.join(stagedRoot, "LICENSE"));

console.log(`Staged Reasonix runtime into ${stagedRoot}`);
