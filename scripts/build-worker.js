import { build } from "esbuild";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PUBLIC_ASSETS } from "../backend/prototype.js";

await mkdir(".sites-runtime", { recursive: true });
const assets = {};
for (const file of PUBLIC_ASSETS)
  assets["/" + file] = {
    content: await readFile(resolve("dist", file), "utf8"),
    type: file.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : file.endsWith(".css")
        ? "text/css; charset=utf-8"
        : file.endsWith(".json")
          ? "application/json; charset=utf-8"
          : "text/html; charset=utf-8",
  };
await writeFile(".sites-runtime/assets.json", JSON.stringify(assets));
await mkdir("dist/server", { recursive: true });
await build({
  entryPoints: ["worker/index.js"],
  bundle: true,
  outfile: "dist/server/index.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
console.log(
  `Built guided prototype Worker with ${PUBLIC_ASSETS.length} embedded assets. No model or database connection in the serving path.`,
);
