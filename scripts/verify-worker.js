// Exercise the exact bundled Worker with an in-memory D1-shaped SQLite adapter.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
const db = new DatabaseSync(':memory:');
db.exec(await readFile('backend/schema.sql', 'utf8'));
const DB = {
  prepare(sql) {
    return { bind(...params) {
      const statement = db.prepare(sql);
      return {
        all: async () => ({ results: statement.all(...params) }),
        first: async () => statement.get(...params) || null,
        run: async () => ({ meta: statement.run(...params) })
      };
    } };
  },
  async batch(statements) {
    db.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
};
async function request(path, body) {
  return worker.fetch(new Request('https://careweave.test' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), { DB });
}
try {
  const page = await request('/'); assert.equal(page.status, 200); assert.match(await page.text(), /Careweave/);
  const library = await request('/vendor/cytoscape.min.js'); assert.equal(library.status, 200);
  let seed = await (await request('/api/seed')).json();
  while (!seed.complete) seed = await (await request('/api/seed', { offset: seed.nextOffset || seed.count })).json();
  assert.equal(seed.count, 1000);
  const result = await (await request('/api/agent', { question: 'Find diabetic patients overdue for A1c tests with transportation barriers.' })).json();
  assert.equal(result.result.count, 82);
  const graph = await (await request('/api/graph?mode=patient&patientId=P0412')).json();
  assert.equal(graph.nodes.length, 9);
  const metrics = await (await request('/api/ml/metrics')).json();
  assert.equal(metrics.testSize, 40);
  assert.equal((await request('/.env')).status, 404);
  console.log('Bundled Worker verified: static graph library, D1 seeding1,000, cohort82, patient pathway9, held-out ML40, source isolation.');
} finally { db.close(); }
