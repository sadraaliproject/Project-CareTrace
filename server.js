import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ASSETS, prototypeResponse } from "./backend/prototype.js";
import { createLiveApi } from "./backend/live-api.js";
import { createLiveGraph } from "./backend/live-graph.js";
import { createSqliteLiveStore } from "./backend/live-sqlite.js";

const root = dirname(fileURLToPath(import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const commonHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

/** Serves the workspace and its durable API; the original story remains available. */
export function createAppServer(options = {}) {
  let runtime;
  const envFile = resolve(root, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const settings = () => {
    return {
      apiKey: Object.hasOwn(options, "apiKey")
        ? options.apiKey
        : process.env.OPENAI_API_KEY,
      model: options.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
      elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
      fetchImpl: options.fetchImpl || fetch,
      hosted: false,
    };
  };
  const initialize = () =>
    (runtime ||= (async () => {
      const store =
        options.store ||
        (await createSqliteLiveStore({
          filename:
            options.filename || resolve(root, "data/careweave-live.sqlite"),
        }));
      const graph = options.graph || createLiveGraph();
      return {
        store,
        handle: createLiveApi({ graph, store, config: settings }),
      };
    })());
  const server = createServer(async (req, res) => {
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    const send = async (response) => {
      res.writeHead(response.status, {
        ...commonHeaders,
        ...Object.fromEntries(response.headers),
      });
      if (req.method !== "HEAD" && response.body) {
        for await (const chunk of response.body) {
          if (res.destroyed) break;
          res.write(chunk);
        }
      }
      res.end();
    };
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/v1/")) {
        const init = {
          method: req.method,
          headers: req.headers,
          signal: abort.signal,
        };
        if (!["GET", "HEAD"].includes(req.method)) {
          const chunks = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 16000) {
              await send(
                Response.json(
                  {
                    error: {
                      code: "BODY_TOO_LARGE",
                      message: "Request is too large.",
                    },
                  },
                  { status: 413 },
                ),
              );
              return;
            }
            chunks.push(chunk);
          }
          init.body = Buffer.concat(chunks);
        }
        const { handle } = await initialize();
        await send(await handle(new Request(url, init)));
        return;
      }
      const response = prototypeResponse(url.pathname, req.method);
      if (response) {
        await send(response);
        return;
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!PUBLIC_ASSETS.includes(file)) {
        await send(new Response("Not found", { status: 404 }));
        return;
      }
      const content = await readFile(resolve(root, "dist", file));
      await send(
        new Response(content, {
          headers: {
            "Content-Type": mime[extname(file)],
            "Cache-Control": "no-cache",
          },
        }),
      );
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(503, {
        ...commonHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          ok: false,
          error: "The workspace is temporarily unavailable. Please retry.",
        }),
      );
      options.onError?.(error);
    }
  });
  server.on("close", () => {
    runtime
      ?.then(({ store }) => {
        if (!options.store) store.close?.();
      })
      .catch(() => {});
  });
  // Initialize storage during startup; requests await the same readiness promise.
  server.ready = initialize();
  server.ready.catch((error) => options.onError?.(error));
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = createAppServer();
  const port = Number(process.env.PORT || 4173);
  await server.ready;
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Careweave ready: http://127.0.0.1:${port}\nLive workspace · SQLite persistence · synthetic patients`,
    ),
  );
  server.on("error", (error) => {
    console.error(`Unable to start Careweave: ${error.message}`);
    process.exitCode = 1;
  });
}
