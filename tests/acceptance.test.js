import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion, runQuery, patients } from '../dist/engine.js';

// Independently selected natural-language cases. For optional syntax, a visible
// refusal is acceptable; executing a different cohort is not.
function faithfulOrRejected(question, verify) {
  const result = parseQuestion(question);
  if (!result.ok) {
    assert.equal(typeof result.error, 'string');
    return;
  }
  verify(result.plan);
}

test('the requested demo question selects missing A1c tests, not all diabetes gaps', () => {
  const parsed = parseQuestion('Find diabetic patients missing an A1c test because they cannot get transportation');
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.plan.gapType, 'overdue');
  assert.equal(parsed.plan.diabetesOnly, true);
  assert.deepEqual(parsed.plan.barriers, ['transportation']);
  assert.equal(parsed.plan.status, 'active');
  const result = runQuery(parsed.plan);
  assert.ok(result.count > 0);
  assert.ok(result.patients.every(p => p.gaps.some(g => g.type === 'a1c_overdue')));
  assert.ok(result.patients.some(p => p.id === 'P0412'));
});

test('exact and inclusive ages are honored or explicitly declined', () => {
  faithfulOrRejected('Find diabetic patients aged 65 with transportation barriers', plan => {
    assert.equal(plan.ageMin, 65);
    assert.equal(plan.ageMax, 65);
  });
  faithfulOrRejected('Find patients aged 65 or younger with transportation barriers', plan => assert.equal(plan.ageMax, 65));
  faithfulOrRejected('Find patients age 17 with cost barriers', plan => {
    assert.equal(plan.ageMin, 17);
    assert.equal(plan.ageMax, 17);
  });
});

test('all barriers is an intersection and regardless-of-gap really includes both states', () => {
  faithfulOrRejected('Find patients with all barriers', plan => {
    assert.equal(plan.barriers.length, 4);
    assert.equal(plan.barrierMode, 'all');
  });
  faithfulOrRejected('Find patients with a barrier', plan => {
    assert.equal(plan.barriers.length, 4);
    assert.equal(plan.barrierMode, 'any');
  });
  faithfulOrRejected('Find patients with transportation barriers regardless of care gaps', plan => assert.equal(plan.gapOnly, false));
  faithfulOrRejected('Find patients with transportation barriers with or without diabetes', plan => assert.equal(plan.diabetesOnly, false));
});

test('unrepresentable negation is declined instead of reversing the request', () => {
  const questions = [
    'Find patients without any barriers',
    'Find patients with no open care gaps',
    'Find patients with transportation barriers not food insecurity',
    'Find patients with transportation barriers and no medication refill gaps',
    'Find patients not diabetic with transportation barriers',
    'Find patients without an open care gap',
    'Find patients with no overdue tests and transportation barriers',
    'Find patients without medication',
    'Find patients with a completed A1c test and transportation barriers'
  ];
  for (const question of questions) {
    const result = parseQuestion(question);
    assert.equal(result.ok, false, question);
  }
});

test('unsupported mixed predicates and time windows are not silently flattened', () => {
  const questions = [
    'Find patients with current transportation and previously resolved cost barriers',
    'Find patients aged 50 to 60 or 70 to 80 with transportation barriers',
    'Find patients with transportation barriers in 2025',
    'Find patients with less than 2 barriers',
    'Find patients with food or cost and transportation barriers',
    'Find patients with current transportation and no longer cost barriers',
    'Find patients with current barriers and resolved transportation',
    'Find patients with high A1c and an overdue A1c test',
    'Find patients with transportation barriers over 50 years ago'
  ];
  for (const question of questions) {
    const result = parseQuestion(question);
    assert.equal(result.ok, false, question);
  }
});

test('negated resolution and the union of gap types are faithful or declined', () => {
  faithfulOrRejected('Find patients with transportation barriers not resolved', plan => assert.equal(plan.status, 'active'));
  faithfulOrRejected('Find patients with elevated A1c or an overdue A1c test', plan => {
    assert.equal(plan.gapOnly, true);
    assert.equal(plan.gapType, 'any');
  });
});

test('refill minimum is inclusive and strict language advances the boundary', () => {
  const strict = parseQuestion('Find diabetic patients with refill gaps over 30 days and cost barriers');
  const inclusive = parseQuestion('Find diabetic patients with refill gaps at least 30 days and cost barriers');
  assert.equal(strict.ok, true, strict.error);
  assert.equal(inclusive.ok, true, inclusive.error);
  assert.equal(strict.plan.refillMin, 31);
  assert.equal(inclusive.plan.refillMin, 30);
  assert.ok(runQuery(strict.plan).patients.every(p => p.refillGap > 30));
  assert.ok(runQuery(inclusive.plan).patients.every(p => p.refillGap >= 30));
});

test('every retained barrier assertion is traceable to its patient source document', () => {
  assert.equal(patients.length, 1000);
  assert.equal(new Set(patients.map(p => p.id)).size, 1000);
  for (const patient of patients) {
    for (const barrier of patient.barriers) {
      const document = patient.documents.find(doc => doc.id === barrier.documentId);
      assert.ok(document, `${patient.id}: missing source ${barrier.documentId}`);
      assert.ok(document.text.includes(barrier.quote), `${patient.id}: excerpt is not in its source`);
      assert.equal(barrier.date, document.date);
    }
  }
});
