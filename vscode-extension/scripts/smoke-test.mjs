import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const requiredFiles = [
  "media/reasonix.svg",
  "src/modules/chat/index.ts",
  "src/modules/chat/history-store.ts",
  "src/modules/cloud-sync/cloud-sync-controller.ts",
  "src/modules/indexing/index.ts",
  "src/modules/permissions/index.ts",
  "src/modules/review/index.ts",
  "src/modules/statusbar/index.ts",
  "src/services/acp-client.ts",
];

for (const file of requiredFiles) {
  await access(path.join(root, file));
}

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const commands = new Set(pkg.contributes.commands.map((item) => item.command));
for (const command of [
  "reasonix.openChat",
  "reasonix.openChatPanel",
  "reasonix.cloudSync.restoreSnapshot",
  "reasonix.permissions.open",
  "reasonix.review.open",
  "reasonix.indexing.open",
]) {
  if (!commands.has(command)) throw new Error(`missing command: ${command}`);
}

if (!pkg.contributes.viewsContainers?.activitybar?.some((item) => item.id === "reasonix")) {
  throw new Error("missing Reasonix activity bar container");
}
if (!pkg.contributes.views?.reasonix?.some((item) => item.id === "reasonix.chatView")) {
  throw new Error("missing Reasonix sidebar chat view");
}
if (!pkg.activationEvents.includes("onView:reasonix.chatView")) {
  throw new Error("missing onView activation event");
}

console.log("reasonix-vscode smoke test passed");
