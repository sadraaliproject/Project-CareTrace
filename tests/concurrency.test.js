import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createRepository } from '../backend/repository.js';

async function sharedRepositories(t) {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  database.exec(await readFile(new URL('../backend/schema.sql', import.meta.url), 'utf8'));
  const adapter = {
    all: (sql, params = []) => database.prepare(sql).all(...params),
    get: (sql, params = []) => database.prepare(sql).get(...params),
    run: (sql, params = []) => database.prepare(sql).run(...params),
    batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params = [] }) => database.prepare(sql).run(...params));
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    }
  };
  const firstRepository = createRepository(adapter), secondRepository = createRepository(adapter);
  await firstRepository.seed();
  return { database, firstRepository, secondRepository };
}

test('independent repository instances cannot silently overwrite concurrent evidence', async t => {
  const { database, firstRepository, secondRepository } = await sharedRepositories(t);
  const attempts = await Promise.allSettled([
    firstRepository.addDocument('P0412', { text: 'Patient cannot afford the medication copay.', date: '2026-10-10', synthetic: true }),
    secondRepository.addDocument('P0412', { text: 'Patient ran out of food before the end of the month.', date: '2026-10-10', synthetic: true })
  ]);
  // A conflict may be retried automatically or rejected visibly. A successful
  // ingestion must never disappear from the patient's authoritative evidence.
  const patient = await firstRepository.getPatient('P0412');
  const storedCount = database.prepare('SELECT COUNT(*) AS count FROM documents WHERE patient_id=?').get('P0412').count;
  assert.equal(patient.documents.length, storedCount);
  const graph = await firstRepository.getGraph({ patientId: 'P0412' });
  for (const attempt of attempts) {
    if (attempt.status === 'rejected') { assert.equal(attempt.reason.status, 409); continue; }
    const id = attempt.value.document.id;
    assert.ok(patient.documents.some(document => document.id === id), `Successful source ${id} was lost`);
    assert.ok(graph.nodes.some(node => node.id === id), `Successful source ${id} is missing from the graph`);
  }
  assert.ok(attempts.some(attempt => attempt.status === 'fulfilled'));
});

test('a concurrent evidence change cannot create a task using stale active evidence', async t => {
  const { firstRepository, secondRepository } = await sharedRepositories(t);
  const [taskAttempt, ingestionAttempt] = await Promise.allSettled([
    firstRepository.createTask({ patientId: 'P0412', barrier: 'transportation' }),
    secondRepository.addDocument('P0412', {
      text: 'Patient no longer needs transportation help and now has reliable rides.',
      date: '2026-10-10', synthetic: true
    })
  ]);
  assert.equal(ingestionAttempt.status, 'fulfilled');
  const patient = await firstRepository.getPatient('P0412');
  assert.equal(patient.barriers.find(barrier => barrier.type === 'transportation').status, 'resolved');
  if (taskAttempt.status === 'rejected') assert.equal(taskAttempt.reason.status, 409);
  else {
    // Creating before ingestion is legitimate only if the ingestion then marks
    // that previously valid task stale in the same atomic evidence update.
    const task = await firstRepository.getTask(taskAttempt.value.id);
    assert.equal(task.status, 'needs_review');
    await assert.rejects(() => firstRepository.updateTask(task.id, { version: task.version, status: 'approved' }), error => error.status === 409);
  }
  assert.ok((await firstRepository.listTasks()).every(task => task.status !== 'pending' && task.status !== 'approved'));
});
