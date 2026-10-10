import { AS_OF, ontology, parseQuestion, extractBarriers, evaluateExtraction } from '../dist/engine.js';
import { planWithModel, validatePlan } from '../planner.js';
import { runAgent } from './agent.js';
import { predictText, getMlMetrics, extractWithModel } from './ml.js';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function input(request) {
  if (Number(request.headers.get('content-length') || 0) > 12000) throw fail('Request is too large.', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 12000) throw fail('Request is too large.', 413);
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
  catch { throw fail('Invalid JSON.'); }
}
function queryInput(body) {
  if (typeof body.question !== 'string' || body.question.trim().length < 3 || body.question.length > 1500) throw fail('Enter a question between 3 and 1,500 characters.');
  if (body.previousPlan != null && !validatePlan(body.previousPlan)) throw fail('Invalid previous query.');
  if (body.plan != null && !validatePlan(body.plan)) throw fail('Invalid query plan.');
}

/** Shared HTTP contract for the local SQLite server and hosted D1 Worker. */
export function createApi({ getRepository, config = () => ({}), storage = 'sqlite' }) {
  let modelBusy = false;
  return async function handleApi(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    try {
      if (!['GET', 'HEAD'].includes(method)) {
        const origin = request.headers.get('origin');
        const localOrigins = [`http://127.0.0.1:${url.port}`, `http://localhost:${url.port}`];
        if (origin && origin !== url.origin && !(storage === 'sqlite' && localOrigins.includes(origin))) return json({ ok: false, error: 'Cross-origin model requests are disabled.' }, 403);
      }
      const settings = config();
      if (path === '/api/status' && method === 'GET') return json({ backend: true, model: Boolean(settings.apiKey), modelName: settings.apiKey ? settings.model : null, synthetic: true, storage, snapshot: AS_OF, ml: { available: true, name: 'Careweave barrier classifier' } });
      if (path === '/api/plan') {
        if (method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
        if (!settings.apiKey) return json({ ok: false, error: 'No model key configured. The deterministic demo engine is available.' }, 503);
        const body = await input(request); queryInput(body);
        if (modelBusy) return json({ ok: false, error: 'One analysis is already running. Try again shortly.' }, 429);
        modelBusy = true;
        try { return json(await planWithModel({ ...body, ...settings })); }
        catch (error) { return json({ ok: false, error: error.message }, 502); }
        finally { modelBusy = false; }
      }
      if (path === '/api/ml/metrics' && method === 'GET') return json({ ...getMlMetrics(), rules: evaluateExtraction() });
      if ((path === '/api/ml/predict' || path === '/api/extract') && method === 'POST') {
        const body = await input(request);
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 7000) throw fail('Enter a synthetic note between 1 and 7,000 characters.');
        const ml = predictText(body.text);
        if (path.endsWith('/predict')) return json(ml);
        let model = null;
        if (body.useModel && settings.apiKey) {
          try { model = await extractWithModel({ ...body, ...settings }); }
          catch (error) { model = { ok: false, error: error.message, note: 'Local extraction is still available.' }; }
        }
        return json({ assertions: extractBarriers({ id: 'preview', text: body.text, type: body.type || 'Synthetic note', date: body.date || AS_OF }), ml, model, source: body.text, synthetic: true });
      }
      // No database initialization is needed for health, extraction, or planner endpoints.
      const repo = await getRepository();
      if (path === '/api/bootstrap' && method === 'GET') {
        const [metrics, page, tasks, runs] = await Promise.all([repo.metrics(), repo.listPatients({ limit: 1000 }), repo.listTasks(), repo.listRuns()]);
        return json({ metrics, patients: page.patients, ontology, tasks, runs, model: Boolean(settings.apiKey), modelName: settings.apiKey ? settings.model : null, storage, snapshot: AS_OF, synthetic: true });
      }
      if (path === '/api/seed' && method === 'POST') {
        const body = await input(request);
        return json(await repo.seedPatientBatch({ offset: Number(body.offset || 0), limit: 10 }));
      }
      if (path === '/api/seed' && method === 'GET') return json(await repo.seedStatus());
      if (path === '/api/graph' && method === 'GET') return json(await repo.getGraph({ mode: url.searchParams.get('mode') || 'population', patientId: url.searchParams.get('patientId'), patientIds: url.searchParams.has('patientIds') ? url.searchParams.get('patientIds').split(',').filter(Boolean) : undefined, limit: Number(url.searchParams.get('limit') || 420) }));
      if (path.startsWith('/api/graph/expand/') && method === 'GET') return json(await repo.expandNode(decodeURIComponent(path.slice('/api/graph/expand/'.length)), url.searchParams.get('relationship') || undefined));
      if (path === '/api/query' && method === 'POST') {
        const body = await input(request); queryInput(body);
        const parsed = body.plan ? { ok: true, plan: body.plan, summary: 'User-selected structured cohort filters.' } : parseQuestion(body.question, body.previousPlan);
        if (!parsed.ok) return json({ ...parsed, engine: 'deterministic-sql' });
        const result = await repo.query(parsed.plan);
        const run = await repo.saveRun({ question: body.question, ...parsed, result, engine: 'deterministic-sql', events: result.events });
        return json({ ...parsed, result, engine: 'deterministic-sql', runId: run.id });
      }
      if (path === '/api/agent' && method === 'POST') {
        const body = await input(request); queryInput(body);
        if (modelBusy) return json({ ok: false, error: 'One analysis is already running. Try again shortly.' }, 429);
        modelBusy = true;
        const perform = async onEvent => {
          const result = await runAgent({ question: body.question, previousPlan: body.previousPlan, repo, ...settings, onEvent });
          if (result.ok && result.result && !result.runId) {
            const run = await repo.saveRun({ question: body.question, ...result });
            result.runId = run.id;
          }
          return result;
        };
        if (body.stream) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
              try { send('result', await perform(event => send('tool', event))); }
              catch (error) { send('error', { ok: false, error: error.message }); }
              finally { modelBusy = false; controller.close(); }
            }
          });
          return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
        }
        try { return json(await perform(() => {})); }
        catch (error) { return json({ ok: false, error: error.message }, 502); }
        finally { modelBusy = false; }
      }
      let match;
      if ((match = path.match(/^\/api\/patients\/([^/]+)\/documents$/)) && method === 'POST') return json(await repo.addDocument(decodeURIComponent(match[1]), await input(request)), 201);
      if ((match = path.match(/^\/api\/patients\/([^/]+)$/)) && method === 'GET') { const patient = await repo.getPatient(decodeURIComponent(match[1])); return patient ? json(patient) : json({ error: 'Patient not found.' }, 404); }
      if (path === '/api/patients' && method === 'GET') return json(await repo.listPatients({ limit: Number(url.searchParams.get('limit') || 50), offset: Number(url.searchParams.get('offset') || 0) }));
      if ((match = path.match(/^\/api\/documents\/([^/]+)$/)) && method === 'GET') { const doc = await repo.getDocument(decodeURIComponent(match[1])); return doc ? json(doc) : json({ error: 'Document not found.' }, 404); }
      if (path === '/api/tasks' && method === 'GET') return json({ tasks: await repo.listTasks() });
      if (path === '/api/tasks' && method === 'POST') return json(await repo.createTask(await input(request)), 201);
      if ((match = path.match(/^\/api\/tasks\/([^/]+)$/)) && method === 'PATCH') return json(await repo.updateTask(decodeURIComponent(match[1]), await input(request)));
      if ((match = path.match(/^\/api\/tasks\/([^/]+)$/)) && method === 'DELETE') return json(await repo.removeTask(decodeURIComponent(match[1]), Number(url.searchParams.get('version')) || undefined));
      if (path === '/api/runs' && method === 'GET') return json({ runs: await repo.listRuns() });
      if ((match = path.match(/^\/api\/runs\/([^/]+)$/)) && method === 'GET') { const run = await repo.getRun(decodeURIComponent(match[1])); return run ? json(run) : json({ error: 'Run not found.' }, 404); }
      if (path === '/api/audit' && method === 'GET') return json({ events: await repo.auditLog({ limit: 100 }) });
      if (path === '/api/export' && method === 'GET') {
        const page = await repo.listPatients({ limit: 1000 });
        return json({ synthetic: true, asOf: AS_OF, patients: page.patients, graph: await repo.getGraph({ mode: 'population', limit: 1000 }), runs: await repo.listRuns(), tasks: await repo.listTasks(), audit: await repo.auditLog({ limit: 1000 }) });
      }
      return json({ ok: false, error: 'Unknown endpoint.' }, 404);
    } catch (error) {
      return json({ ok: false, error: error.status ? error.message : 'The backend could not complete this request.' }, error.status || 500);
    }
  };
}
