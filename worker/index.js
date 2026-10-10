import assets from "../.sites-runtime/assets.json";
import { prototypeResponse } from "../backend/prototype.js";
import { createLiveApi } from "../backend/live-api.js";
import { createLiveGraph } from "../backend/live-graph.js";
import { createD1LiveStore } from "../backend/live-store.js";
let graph;
const runtimes = new WeakMap();
export default {
  async fetch(request, env = {}) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/v1/")) {
      if (!env.DB)
        return Response.json(
          { ok: false, error: "The workspace database is unavailable." },
          { status: 503 },
        );
      let handle = runtimes.get(env.DB);
      if (!handle) {
        graph ||= createLiveGraph();
        handle = createLiveApi({
          graph,
          store: createD1LiveStore(env.DB),
          config: () => ({
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_MODEL || "gpt-4.1-mini",
            elevenLabsApiKey: env.ELEVENLABS_API_KEY,
            elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID,
            elevenLabsModel: env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
            hosted: true,
          }),
        });
        runtimes.set(env.DB, handle);
      }
      try {
        return await handle(request);
      } catch {
        return Response.json(
          {
            ok: false,
            error: "The workspace is temporarily unavailable. Please retry.",
          },
          { status: 503 },
        );
      }
    }
    const response = prototypeResponse(path, request.method);
    if (response) return response;
    const asset = assets[path === "/" ? "/index.html" : path];
    if (!asset) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : asset.content, {
      headers: {
        "Content-Type": asset.type,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      },
    });
  },
};
