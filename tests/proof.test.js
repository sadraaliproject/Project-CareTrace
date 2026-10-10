import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteRepository } from '../backend/sqlite.js';
import { runProof } from '../backend/proof.js';

async function seeded(t) {
  const repository = await createSqliteRepository({ filename: ':memory:' });
  t.after(() => repository.close());
  await repository.seed();
  return repository;
}

test('live proof computes adversarial outcomes, exact SQL repeatability, and source ownership', async t => {
  const repo = await seeded(t);
  const before = await repo.metrics();
  const result = await runProof(repo);
  assert.equal(result.summary.total, result.cases.length);
  assert.equal(result.summary.passed, result.cases.filter(item => item.passed).length);
  assert.equal(result.summary.passed, result.summary.total);
  assert.equal(result.repeatability.count, 82);
  assert.equal(result.repeatability.passed, true);
  assert.equal(result.evidenceCoverage.checked, 82);
  assert.equal(result.evidenceCoverage.verified, 82);
  assert.equal(result.evidenceCoverage.passed, true);
  assert.ok(result.cases.some(item => item.id === 'mixed-status' && item.actual.some(assertion => assertion.type === 'cost' && assertion.status === 'active')));
  assert.ok(result.cases.every(item => item.sourceVerified));
  assert.deepEqual(await repo.metrics(), before, 'Running proof must not alter the workspace');
});

test('repeatability and source failures are surfaced rather than hardcoded as passing', async t => {
  const repo = await seeded(t);
  let queryCalls = 0;
  const proofRepo = {
    query: async plan => {
      const result = await repo.query(plan);
      return ++queryCalls === 2 ? { ...result, fingerprint: 'CHANGED-BETWEEN-READS' } : result;
    },
    getDocuments: async ids => (await repo.getDocuments(ids)).map(document => ({ ...document, patientId: 'WRONG-PATIENT' }))
  };
  const result = await runProof(proofRepo);
  assert.equal(queryCalls, 2);
  assert.equal(result.repeatability.passed, false);
  assert.equal(result.evidenceCoverage.passed, false);
  assert.equal(result.evidenceCoverage.verified, 0);
  assert.equal(result.evidenceCoverage.issues.length, 82);
});

test('custom judge text is executed without persistence and malformed input is rejected', async t => {
  const repo = await seeded(t), before = await repo.metrics();
  const text = 'Patient has reliable transportation and cannot afford the medication copay.';
  const result = await runProof(repo, { text });
  assert.deepEqual(result.custom.assertions.map(item => [item.type, item.status]), [['cost', 'active']]);
  assert.ok(result.custom.assertions.every(item => text.includes(item.quote)));
  assert.equal(result.custom.persisted, false);
  assert.deepEqual(await repo.metrics(), before);
  for (const invalid of ['', 'x'.repeat(7001), true, {}]) await assert.rejects(() => runProof(repo, { text: invalid }), error => error.status === 400);
});

test('proof counts and coverage follow new evidence instead of memorizing the initial demo', async t => {
  const repo = await seeded(t);
  await repo.addDocument('P0412', { text: 'Patient no longer needs transportation help and now has reliable rides.', date: '2026-10-10', synthetic: true });
  const result = await runProof(repo);
  assert.equal(result.repeatability.count, 81);
  assert.equal(result.repeatability.passed, true);
  assert.equal(result.evidenceCoverage.total, 81);
  assert.equal(result.evidenceCoverage.verified, 81);
});
