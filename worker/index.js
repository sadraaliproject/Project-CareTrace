import assets from "../.sites-runtime/assets.json";
import { prototypeResponse } from "../backend/prototype.js";

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
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
