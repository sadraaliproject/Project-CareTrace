import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ASSETS, prototypeResponse } from "./backend/prototype.js";

const root = dirname(fileURLToPath(import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** The active prototype never loads environment secrets or calls external services. */
export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const response = prototypeResponse(url.pathname, req.method);
      if (response) {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(req.method === "HEAD" ? undefined : await response.text());
        return;
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!PUBLIC_ASSETS.includes(file)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const content = await readFile(resolve(root, "dist", file));
      res.writeHead(200, {
        "Content-Type": mime[extname(file)],
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Unable to load this resource.");
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4173);
  const server = createAppServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Careweave ready: http://127.0.0.1:${port}\nGuided graph prototype · synthetic patients · no API keys required`,
    ),
  );
  server.on("error", (error) => {
    console.error(`Unable to start Careweave: ${error.message}`);
    process.exitCode = 1;
  });
}
