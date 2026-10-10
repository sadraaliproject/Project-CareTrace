import { createServer } from 'node:http';
import { readFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './backend/api.js';
import { createSqliteRepository } from './backend/sqlite.js';

const root = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createAppServer(options = {}) {
  const { fetchImpl = fetch, filename = resolve(root, 'data/careweave.sqlite') } = options;
  let repositoryPromise;
  const getRepository = () => repositoryPromise ||= createSqliteRepository({ filename }).then(async repo => { await repo.seed(); return repo; });
  const config = () => {
    // Keys added during the preview become available on the next request.
    if (!process.env.OPENAI_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
    return { apiKey: Object.hasOwn(options, 'apiKey') ? options.apiKey : process.env.OPENAI_API_KEY, model: options.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini', fetchImpl };
  };
  const api = createApi({ getRepository, config, storage: 'sqlite' });
  const publicRoot = resolve(root, 'dist');
  const server = createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, `http://127.0.0.1:${req.socket.localPort}`);
      if (url.pathname.startsWith('/api/')) {
        const init = { method: req.method, headers: req.headers };
        if (!['GET', 'HEAD'].includes(req.method)) {
          const chunks = []; let length = 0;
          for await (const chunk of req) { length += chunk.length; if (length > 12000) return json(413, { ok: false, error: 'Request is too large.' }); chunks.push(chunk); }
          init.body = Buffer.concat(chunks);
        }
        const response = await api(new Request(url, init));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) for await (const chunk of response.body) { if (res.destroyed) break; res.write(chunk); }
        res.end();
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Method not allowed.' });
      const decoded = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      if (decoded.includes('\\') || decoded.split('/').some(segment => segment.startsWith('.') || segment === 'server')) return json(403, { error: 'Forbidden.' });
      const path = resolve(publicRoot, '.' + decoded);
      if (!path.startsWith(publicRoot + sep)) return json(403, { error: 'Forbidden.' });
      if (!(await stat(path)).isFile()) return json(404, { error: 'Not found.' });
      const content = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, { ok: false, error: 'Resource unavailable.' });
      else res.end();
    }
  });
  server.on('close', () => { repositoryPromise?.then(repo => repo.close()).catch(() => {}); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const vendor = resolve(root, 'dist/vendor');
  await mkdir(vendor, { recursive: true });
  try { await copyFile(resolve(root, 'node_modules/cytoscape/dist/cytoscape.min.js'), resolve(vendor, 'cytoscape.min.js')); }
  catch { console.error('Run npm install to enable the interactive graph library.'); }
  const port = Number(process.env.PORT || 4173);
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => console.log(`Careweave ready: http://127.0.0.1:${port}\nPersistent SQLite backend · synthetic data only\nOpenAI: ${process.env.OPENAI_API_KEY ? 'configured' : 'add OPENAI_API_KEY to .env to enable live tool calling'}`));
  server.on('error', error => { console.error(`Unable to start Careweave: ${error.message}`); process.exitCode = 1; });
}
