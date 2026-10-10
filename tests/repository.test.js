import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteRepository } from '../backend/sqlite.js';
import { createRepository } from '../backend/repository.js';
import { parseQuestion, runQuery, patients, getMetrics } from '../dist/engine.js';

const headline = 'Find diabetic patients missing A1c tests with transportation barriers';
async function seeded() { const repository = await createSqliteRepository({ filename: ':memory:' }); await repository.seed(); return repository; }

test('SQL cohorts, counts, exclusions and fingerprints agree with the independent in-memory baseline', async t => {
  const repo = await seeded(); t.after(() => repo.close());
  const questions = [headline, 'Show patients with medication cost and food insecurity barriers', 'Which patients over 65 have resolved transportation barriers?', 'Show all patients with any barriers', 'Find diabetic patients with elevated A1c and food insecurity', 'Show diabetic patients with refill gaps over 30 days', 'Find all patients age 50', 'Show top 10 oldest diabetic patients with open care gaps', 'Show all patients with transportation including resolved'];
  for (const question of questions) {
    const parsed = parseQuestion(question); assert.equal(parsed.ok, true, question);
    const sql = await repo.query(parsed.plan), baseline = runQuery(parsed.plan);
    assert.equal(sql.count, baseline.count, question);
    assert.deepEqual(sql.patients.map(p => p.id), baseline.patients.map(p => p.id), question);
    assert.equal(sql.excludedResolved, baseline.excludedResolved, question);
    assert.deepEqual(sql.groups, baseline.groups, question);
    assert.equal(sql.fingerprint, baseline.fingerprint, question);
  }
  const result = await repo.query(parseQuestion(headline).plan);
  assert.equal(result.count, 82);
  assert.ok(result.sql.text.includes('EXISTS(SELECT 1 FROM assertions'));
  assert.ok(result.sql.parameters.includes('transportation'));
  assert.equal(result.sql.text.includes("'transportation'"), false);
  const metrics = await repo.metrics(), baselineMetrics = getMetrics();
  for (const key of ['population','diabetes','openGaps','actionable','documents','nodes','edges','evidence','hiddenBarriers','resolved']) assert.equal(metrics[key], baselineMetrics[key], key);
});

test('result limits affect display only; invalid plans cannot change SQL scope', async t => {
  const repo = await seeded(); t.after(() => repo.close());
  const plan = parseQuestion(headline).plan;
  const result = await repo.query({ ...plan, limit: 3 });
  assert.equal(result.count, 82); assert.equal(result.patients.length, 3);
  await assert.rejects(() => repo.query({ ...plan, barriers: ["transportation'); DROP TABLE patients;--"] }), /Invalid/);
  await assert.rejects(() => repo.query({ ...plan, extraFilter: true }), /Invalid/);
  assert.equal((await repo.metrics()).population, 1000);
  assert.equal((await repo.listPatients({ search: "%' OR 1=1 --" })).count, 0);
});

test('new evidence changes SQL cohort and graph and invalidates approval', async t => {
  const repo = await seeded(); t.after(() => repo.close());
  const plan = parseQuestion(headline).plan, before = await repo.query(plan);
  const task = await repo.createTask({ patientId: 'P0412', barrier: 'transportation' });
  const approved = await repo.updateTask(task.id, { version: task.version, status: 'approved' });
  assert.equal(approved.status, 'approved'); assert.equal(approved.sent, false);
  const ingestion = await repo.addDocument('P0412', { text: 'Patient no longer needs transportation help and now has reliable rides.', type: 'Judge synthetic follow-up', date: '2026-10-10', synthetic: true });
  assert.deepEqual(ingestion.changedBarriers, ['transportation']);
  const after = await repo.query(plan);
  assert.equal(after.count, before.count - 1);
  assert.equal(after.patients.some(p => p.id === 'P0412'), false);
  assert.notEqual(after.fingerprint, before.fingerprint);
  const stale = await repo.getTask(task.id);
  assert.equal(stale.status, 'needs_review'); assert.equal(stale.version, 3);
  await assert.rejects(() => repo.updateTask(task.id, { version: approved.version, status: 'completed' }), /changed/);
  await assert.rejects(() => repo.updateTask(task.id, { version: stale.version, status: 'approved' }), /Cannot change/);
  await assert.rejects(() => repo.createTask({ patientId: 'P0412', barrier: 'transportation' }), /active, source-backed/);
  const graph = await repo.getGraph({ patientId: 'P0412' });
  const evidence = graph.edges.find(e => e.type === 'EVIDENCES' && e.target === 'barrier:transportation');
  assert.equal(evidence.status, 'resolved'); assert.equal(evidence.source, ingestion.document.id);
  assert.ok(graph.nodes.some(n => n.id === ingestion.document.id));
  assert.equal((await repo.getDocument(ingestion.document.id)).text, ingestion.document.text);
});

test('newer evidence prevails over an older contradictory ingestion; future records are rejected', async t => {
  const repo = await seeded(); t.after(() => repo.close());
  const result = await repo.addDocument('P0412', { text: 'Patient denies transportation problems.', date: '2026-01-01', synthetic: true });
  assert.deepEqual(result.changedBarriers, []);
  assert.equal(result.patient.barriers.find(b => b.type === 'transportation').status, 'active');
  await assert.rejects(() => repo.addDocument('P0412', { text: 'I have no transportation.', date: '2026-10-11', synthetic: true }), /on or before/);
  await assert.rejects(() => repo.addDocument('P0412', { text: 'I have no transportation.', date: '2026-02-30', synthetic: true }), /valid source date/);
  await assert.rejects(() => repo.addDocument('P0412', { text: 'I have no transportation.', date: '2026-10-10' }), /explicitly synthetic/);
});

test('task drafts persist edited content, require optimistic versions, and enforce human approval', async t => {
  const repo = await seeded(); t.after(() => repo.close());
  const task = await repo.createTask({ patientId: 'P0412', barrier: 'transportation' });
  await assert.rejects(() => repo.createTask({ patientId: 'P0412', barrier: 'transportation' }), /already exists/);
  await assert.rejects(() => repo.updateTask(task.id, { status: 'approved' }), /version/);
  await assert.rejects(() => repo.updateTask(task.id, { version: 1, status: 'completed' }), /Cannot change/);
  const edited = await repo.updateTask(task.id, { version: 1, body: 'Reviewed fictional outreach. Please confirm your transportation need.' });
  assert.equal(edited.version, 2); assert.match(edited.body, /Reviewed fictional/);
  await assert.rejects(() => repo.updateTask(task.id, { version: 1, status: 'approved' }), /changed/);
  const approved = await repo.updateTask(task.id, { version: 2, status: 'approved' });
  await assert.rejects(() => repo.updateTask(task.id, { version: 3, body: 'Change after review' }), /cannot be edited/);
  const complete = await repo.updateTask(task.id, { version: approved.version, status: 'completed' });
  assert.equal(complete.status, 'completed'); assert.equal(complete.sent, false);
  assert.ok((await repo.auditLog()).some(a => a.action === 'task.approved'));
});

test('revalidating an active changed barrier refreshes its draft and evidence', async t => {
  const repo = await seeded(); t.after(() => repo.close());
  const task = await repo.createTask({ patientId: 'P0412', barrier: 'transportation' });
  const { document } = await repo.addDocument('P0412', { text: 'The bus is unreliable and I cannot get to the clinic.', date: '2026-10-10', synthetic: true });
  const stale = await repo.getTask(task.id); assert.equal(stale.status, 'needs_review');
  const refreshed = await repo.updateTask(task.id, { status: 'pending', version: stale.version });
  assert.equal(refreshed.evidence.documentId, document.id); assert.ok(refreshed.body.includes(document.id));
  assert.equal((await repo.updateTask(task.id, { status: 'approved', version: refreshed.version })).status, 'approved');
});

test('graph exposes complete typed data and constrained live neighborhood traversal', async t => {
  const repo = await seeded(); t.after(() => repo.close());
  const full = await repo.getGraph({ limit: 8000 });
  assert.equal(full.nodes.length, 4797); assert.equal(full.edges.length, 6632); assert.equal(full.truncated, false);
  const visible = new Set(full.nodes.map(n => n.id));
  for (const edge of full.edges) { assert.ok(visible.has(edge.source)); assert.ok(visible.has(edge.target)); }
  const sample = await repo.getGraph({ limit: 100 });
  assert.ok(sample.nodes.length <= 100); assert.equal(sample.totalNodes, 4797); assert.equal(sample.truncated, true);
  assert.ok(sample.nodes.some(n => n.type === 'Document'));
  const docs = await repo.expandNode('P0412', 'HAS_DOCUMENT');
  assert.equal(docs.edges.length, 3); assert.equal(docs.nodes.length, 4);
  await assert.rejects(() => repo.expandNode('P0412', 'PRESCRIBE_MEDICATION'), /outside the permitted ontology/);
  assert.equal((await repo.getGraph({ patientIds: patients.map(p => p.id), limit: 8000 })).nodes.length, 4797);
  assert.equal((await repo.getGraph({ mode: 'population', patientIds: [], limit: 8000 })).nodes.length, 4797);
  assert.equal((await repo.getGraph({ mode: 'cohort', patientIds: [] })).nodes.length, 0);
  const maya = await repo.getGraph({ patientId: 'P0412', mode: 'patient' });
  assert.equal(maya.nodes.length, 9); assert.equal(maya.edges.length, 9);
  assert.equal(maya.totalNodes, 9); assert.equal(maya.totalEdges, 9);
  assert.equal(maya.nodes.some(node => node.id === 'barrier:cost'), false);
  const schema = await repo.getGraph({ mode: 'ontology' }); assert.equal(schema.nodes.length, 6); assert.equal(schema.edges.length, 6);
});

test('persistent database retains tasks, runs, audit and ingested source after reopen and reseed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'careweave-repository-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'test.sqlite');
  let repo = await createSqliteRepository({ filename }); await repo.seed();
  const task = await repo.createTask({ patientId: 'P0412', barrier: 'transportation' });
  const document = await repo.addDocument('P0412', { text: 'Her mother cannot afford the medication copay.', date: '2026-10-10', synthetic: true });
  const result = await repo.query(parseQuestion(headline).plan);
  const run = await repo.saveRun({ question: headline, plan: parseQuestion(headline).plan, result, engine: 'deterministic', events: result.events });
  repo.close();
  repo = await createSqliteRepository({ filename }); await repo.seed();
  try {
    assert.equal((await repo.listTasks())[0].id, task.id);
    assert.equal((await repo.getRun(run.id)).result.fingerprint, result.fingerprint);
    assert.equal((await repo.listRuns())[0].id, run.id);
    assert.equal((await repo.getDocument(document.document.id)).text, document.document.text);
    assert.equal((await repo.metrics()).documents, 3001);
    assert.ok((await repo.auditLog()).some(a => a.action === 'document.ingested'));
  } finally { repo.close(); }
});

test('D1-compatible adapter stays within 100 binds and atomic seed batches below 80 statements', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(await readFile(new URL('../backend/schema.sql', import.meta.url), 'utf8'));
  let maximumBatch = 0;
  const checked = (sql, params = []) => { assert.ok(params.length <= 100, `Excessive bind count ${params.length}`); return db.prepare(sql); };
  const adapter = {
    all: async (sql, params = []) => checked(sql, params).all(...params),
    get: async (sql, params = []) => checked(sql, params).get(...params),
    run: async (sql, params = []) => { const r = checked(sql, params).run(...params); return { meta: { changes: r.changes } }; },
    batch: async statements => {
      maximumBatch = Math.max(maximumBatch, statements.length); assert.ok(statements.length <= 80);
      db.exec('BEGIN');
      try { const results = statements.map(({ sql, params = [] }) => checked(sql, params).run(...params)); db.exec('COMMIT'); return results; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  const repo = createRepository(adapter);
  const first = await repo.seedPatientBatch({ offset: 0, limit: 10 }); assert.equal(first.count, 10); assert.equal(first.complete, false);
  const retry = await repo.seedPatientBatch({ offset: 0, limit: 10 }); assert.equal(retry.inserted, 0);
  await repo.seed(); assert.ok(maximumBatch < 80);
  assert.equal((await repo.getGraph({ patientIds: patients.map(p => p.id), limit: 8000 })).nodes.length, 4797);
  const task = await repo.createTask({ patientId: 'P0412', barrier: 'transportation' });
  assert.equal((await repo.updateTask(task.id, { version: task.version, status: 'approved' })).status, 'approved');
});
