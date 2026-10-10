// Exercise the exact bundled Worker with the documented free-tier D1 bounds.
// This cannot prove a remote deployment is healthy, but catches SQL patterns
// that permissive SQLite-only mocks hide.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(await readFile('backend/schema.sql', 'utf8'));
const LIMITS = { queries: 50, parameters: 100, sqlBytes: 100000, valueBytes: 2000000 };
const encoder = new TextEncoder();
const observed = [];
let requestState = null, injectFailureAt = null;
const guard = (sql, params) => {
  assert.ok(requestState, 'Every statement must belong to an HTTP request.');
  requestState.queries++;
  if (requestState.queries > LIMITS.queries) throw new Error(`D1 query limit exceeded: ${requestState.queries} > ${LIMITS.queries} statements in ${requestState.path}`);
  if (injectFailureAt === requestState.queries) throw new Error('Injected database failure to verify atomic rollback.');
  if (params.length > LIMITS.parameters) throw new Error(`D1 bound parameter limit exceeded: ${params.length} > ${LIMITS.parameters}`);
  if (encoder.encode(sql).byteLength > LIMITS.sqlBytes) throw new Error('D1 SQL statement exceeds 100 KB.');
  for (const parameter of params) if (typeof parameter === 'string' && encoder.encode(parameter).byteLength > LIMITS.valueBytes) throw new Error('D1 bound string exceeds 2 MB.');
};
function prepared(sql, params = []) {
  const execute = fn => {
    try { guard(sql, params); return fn(db.prepare(sql)); }
    catch (error) { requestState.errors.push(error.message); throw error; }
  };
  return {
    bind: (...values) => prepared(sql, values),
    all: async () => execute(statement => ({ success: true, results: statement.all(...params) })),
    first: async column => execute(statement => { const row = statement.get(...params); return column ? row?.[column] ?? null : row || null; }),
    run: async () => execute(statement => ({ success: true, meta: statement.run(...params) })),
  };
}
const DB = {
  prepare: sql => prepared(sql),
  async batch(statements) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
};
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  requestState = { path, method, queries: 0, errors: [] };
  const response = await worker.fetch(new Request('https://careweave.test' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { DB });
  observed.push(requestState);
  return response;
}
async function jsonRequest(path, body, method) {
  const response = await request(path, body, method), payload = await response.json();
  assert.ok(response.ok, `${path} returned ${response.status}: ${payload.error || ''}; database: ${requestState.errors.join('; ')}`);
  return payload;
}
const counts = () => Object.fromEntries(['patients', 'documents', 'assertions', 'graph_nodes', 'graph_edges', 'tasks', 'runs'].map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
try {
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const page = await request('/'); assert.equal(page.status, 200); assert.match(await page.text(), /Careweave/);
  const library = await request('/vendor/cytoscape.min.js'); assert.equal(library.status, 200);
  // Failure part-way through the seed write must not create half a patient graph.
  const emptyCounts = counts();
  injectFailureAt = 5;
  const failedSeed = await request('/api/seed', { offset: 0 });
  assert.equal(failedSeed.status, 500, 'Injected seed failure should be reported.');
  assert.ok(requestState.errors.some(message => message.includes('Injected database failure')));
  assert.deepEqual(counts(), emptyCounts, 'Seed write must roll back all related rows on failure.');
  injectFailureAt = null;
  let seed = await jsonRequest('/api/seed');
  let attempts = 0;
  while (!seed.complete) {
    assert.ok(++attempts <= 110, 'Seed must progress instead of entering an infinite retry loop.');
    const before = seed.count;
    seed = await jsonRequest('/api/seed', { offset: seed.nextOffset ?? seed.count });
    assert.ok(seed.count > before, 'Every normal seed batch must advance the persisted count.');
  }
  assert.equal(seed.count, 1000);
  const fullCounts = counts();
  assert.equal(fullCounts.documents, 3000);
  // An already completed first/last batch may be retried after a lost response.
  for (const offset of [0, 990, 1000]) {
    const retry = await jsonRequest('/api/seed', { offset });
    assert.equal(retry.count, 1000); assert.equal(retry.complete, true);
    assert.deepEqual(counts(), fullCounts, 'Idempotent seed retries must not duplicate records.');
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const result = await jsonRequest('/api/agent', { question: 'Find diabetic patients overdue for A1c tests with transportation barriers.' });
  assert.equal(result.result.count, 82);
  const graph = await jsonRequest('/api/graph?mode=patient&patientId=P0412');
  assert.equal(graph.nodes.length, 9);
  const populationGraph = await jsonRequest('/api/graph?mode=population&limit=420');
  assert.ok(populationGraph.nodes.length > 100);
  const bootstrap = await jsonRequest('/api/bootstrap');
  assert.equal(bootstrap.patients.length, 1000);
  const beforePlanning = counts();
  const defaults = await jsonRequest('/api/simulate/defaults');
  const simulated = await jsonRequest('/api/simulate', { ...defaults, budget: 350 });
  assert.equal(simulated.population.total, 1000);
  assert.ok(simulated.optimized.allBarriersAddressed > 0);
  assert.ok(simulated.optimized.budgetUsed <= 350);
  assert.equal(simulated.hypothetical, true);
  for (const id of simulated.graphOverlay.nodes) assert.ok(db.prepare('SELECT id FROM graph_nodes WHERE id=?').get(id), `Simulation node ${id} exists`);
  for (const id of simulated.graphOverlay.edges) assert.ok(db.prepare('SELECT id FROM graph_edges WHERE id=?').get(id), `Simulation edge ${id} exists`);
  const proof = await jsonRequest('/api/proof', {});
  assert.equal(proof.summary.total, 14); assert.equal(proof.summary.passed, 14);
  assert.equal(proof.repeatability.passed, true); assert.equal(proof.repeatability.count, 82);
  assert.equal(proof.evidenceCoverage.passed, true); assert.equal(proof.evidenceCoverage.verified, 82);
  assert.deepEqual(counts(), beforePlanning, 'Proof and resource simulation must not change persistent state.');
  const task = await jsonRequest('/api/tasks', { patientId: 'P0412', barrier: 'transportation' });
  const approved = await jsonRequest(`/api/tasks/${task.id}`, { version: task.version, status: 'approved' }, 'PATCH');
  assert.equal(approved.sent, false);
  await jsonRequest('/api/patients/P0412/documents', { text: 'Patient no longer needs transportation help and now has reliable rides.', date: '2026-10-10', synthetic: true });
  const after = await jsonRequest('/api/query', { question: 'Find diabetic patients overdue for A1c tests with transportation barriers.' });
  assert.equal(after.result.count, 81);
  const tasks = await jsonRequest('/api/tasks');
  assert.equal(tasks.tasks.find(item => item.id === task.id).status, 'needs_review');
  const afterProof = await jsonRequest('/api/proof', {});
  assert.equal(afterProof.repeatability.count, 81); assert.equal(afterProof.evidenceCoverage.verified, 81);
  const afterSimulation = await jsonRequest('/api/simulate', { patientIds: ['P0412'], barriers: ['transportation'] });
  assert.equal(afterSimulation.optimized.patientsReached, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const metrics = await jsonRequest('/api/ml/metrics');
  assert.equal(metrics.testSize, 40);
  assert.equal((await request('/.env')).status, 404);
  const successful = observed.filter(item => !item.errors.length), maxQueries = Math.max(...successful.map(item => item.queries));
  const seedMax = Math.max(...successful.filter(item => item.path === '/api/seed').map(item => item.queries));
  assert.ok(maxQueries <= LIMITS.queries);
  console.log(`Bundled Worker verified: foreign keys ON; 50-statement D1 invocation limit; 100-parameter SQL limit; atomic/idempotent 1,000-patient seed; cohort 82 → 81; task invalidation; live proof and simulation; source isolation. Maximum statements/request: ${maxQueries}; seed: ${seedMax}.`);
} finally { db.close(); }
