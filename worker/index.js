import { createApi } from '../backend/api.js';
import { createD1Repository } from '../backend/d1.js';
import assets from '../.sites-runtime/assets.json';
let currentDatabase, api;
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      if (!env.DB) return Response.json({ error: 'The database binding is unavailable.' }, { status: 503 });
      if (!api || currentDatabase !== env.DB) {
        currentDatabase = env.DB;
        const repo = createD1Repository(env.DB);
        api = createApi({ getRepository: async () => repo, config: () => ({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-4.1-mini' }), storage: 'd1' });
      }
      return api(request);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = assets[path === '/' ? '/index.html' : path];
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.content, { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' } });
  }
};
