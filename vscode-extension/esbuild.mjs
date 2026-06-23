import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  sourcesContent: false,
});

// VSIX 打包会排除 src/**，所以 Webview 共享 CSS 必须随构建复制到 dist。
const stylesOut = join(root, "dist", "webview", "styles");
await mkdir(stylesOut, { recursive: true });
for (const name of ["design-system.css", "codicons.css"]) {
  await copyFile(join(root, "src", "webview", "styles", name), join(stylesOut, name));
}
