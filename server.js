import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planWithModel, validatePlan } from './planner.js';

const root = dirname(fileURLToPath(import.meta.url));
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createAppServer({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-4.1-mini', fetchImpl = fetch } = {}) {
  const publicRoot = resolve(root, 'dist');
  let modelBusy = false;
  return createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/status' && req.method === 'GET') return json(200, { model: Boolean(apiKey), modelName: apiKey ? model : null, synthetic: true, snapshot: '2026-10-10' });
      if (url.pathname === '/api/plan') {
        if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST.' });
        const allowed = [`http://127.0.0.1:${req.socket.localPort}`, `http://localhost:${req.socket.localPort}`];
        if (req.headers.origin && !allowed.includes(req.headers.origin)) return json(403, { ok: false, error: 'Cross-origin model requests are disabled.' });
        if (!apiKey) return json(503, { ok: false, error: 'No model key configured. The deterministic demo engine is available.' });
        if (modelBusy) return json(429, { ok: false, error: 'One analysis is already running. Try again shortly.' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 12000) return json(413, { ok: false, error: 'Question is too large.' });
        }
        let input;
        try { input = JSON.parse(body); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
        if (typeof input.question !== 'string' || input.question.trim().length < 3 || input.question.length > 1500) return json(400, { ok: false, error: 'Enter a question between 3 and 1,500 characters.' });
        if (input.previousPlan != null && !validatePlan(input.previousPlan)) return json(400, { ok: false, error: 'Invalid previous query.' });
        if (modelBusy) return json(429, { ok: false, error: 'One analysis is already running. Try again shortly.' });
        modelBusy = true;
        try { return json(200, await planWithModel({ ...input, apiKey, model, fetchImpl })); }
        catch (error) { return json(502, { ok: false, error: error.name === 'TimeoutError' ? 'Model request timed out. The deterministic engine is still available.' : error.message }); }
        finally { modelBusy = false; }
      }
      if (url.pathname.startsWith('/api/')) return json(404, { ok: false, error: 'Unknown endpoint.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Method not allowed.' });
      const path = resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(publicRoot + sep)) return json(403, { error: 'Forbidden.' });
      if (!(await stat(path)).isFile()) return json(404, { error: 'Not found.' });
      const content = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      json(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400, { error: 'Resource unavailable.' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => console.log(`Careweave ready: http://127.0.0.1:${port}\nQuery engine: ${process.env.OPENAI_API_KEY ? 'model + deterministic execution' : 'deterministic demo (no API key required)'}`));
  server.on('error', error => { console.error(`Unable to start Careweave: ${error.message}`); process.exitCode = 1; });
}
