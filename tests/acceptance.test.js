import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion, runQuery, patients } from '../dist/engine.js';

const question = 'Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?';

test('the hospital question selects an open follow-up gap with current evidence', () => {
  const parsed = parseQuestion(question);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.plan.diabetesAdmissionOnly, true);
  assert.equal(parsed.plan.gapOnly, true);
  assert.equal(parsed.plan.barrierPresence, 'present');
  const result = runQuery(parsed.plan);
  assert.ok(result.count > 0);
  assert.ok(result.patients.some(patient => patient.id === 'P0412'));
  for (const patient of result.patients) {
    assert.equal(patient.admission.diabetesRelated, true);
    assert.equal(patient.followUpGap.open, true);
    assert.ok(patient.barriers.length > 0);
  }
});

test('cost and discharge insulin query uses both supported conditions', () => {
  const parsed = parseQuestion('Which patients report a cost barrier and never picked up their discharge insulin?');
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(parsed.plan.barriers, ['cost']);
  assert.equal(parsed.plan.insulinNotPickedUp, true);
  const result = runQuery(parsed.plan);
  assert.ok(result.count > 0);
  for (const patient of result.patients) {
    assert.ok(patient.barriers.some(barrier => barrier.type === 'cost'));
    assert.ok(patient.medications.some(medication => medication.isInsulin && medication.newStart && !medication.pickedUp));
  }
});

test('the likely-to-return query uses the explicit derived rule', () => {
  const parsed = parseQuestion('Who is likely to return?');
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.plan.likelyToReturn, true);
  const result = runQuery(parsed.plan);
  assert.ok(result.count > 0);
  assert.ok(result.patients.every(patient => patient.likelyToReturn));
});

test('the standard discharge-call group remains separate from supported barriers', () => {
  const parsed = parseQuestion('Show patients with an open follow-up gap and no documented barrier');
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.plan.barrierPresence, 'absent');
  const result = runQuery(parsed.plan);
  assert.ok(result.count > 0);
  assert.ok(result.patients.every(patient => patient.followUpGap.open && patient.barriers.length === 0));
});

test('exact age bounds are honored or the unsupported wording is declined', () => {
  for (const [text, low, high] of [
    ['Show patients aged 65 with transportation barriers', 65, 65],
    ['Show patients aged 65 or older with transportation barriers', 65, null],
    ['Show patients aged 65 or younger with transportation barriers', null, 65],
  ]) {
    const parsed = parseQuestion(text);
    if (!parsed.ok) { assert.equal(typeof parsed.error, 'string'); continue; }
    assert.equal(parsed.plan.ageMin, low, text);
    assert.equal(parsed.plan.ageMax, high, text);
  }
});

test('unsupported clinical predicates and time windows are not answered as a different query', () => {
  for (const text of [
    'Which patients had a stroke?',
    'Show discharged patients with cancer and transportation barriers',
    'Show patients discharged in 2024 with a transportation barrier',
    'Which patients will certainly be readmitted tomorrow?',
  ]) {
    const parsed = parseQuestion(text);
    assert.equal(parsed.ok, false, text);
    assert.equal(typeof parsed.error, 'string');
  }
});

test('each current barrier is traceable to its own clinical note or coded hospital row', () => {
  for (const patient of patients) {
    for (const barrier of patient.barriers) {
      const coded = patient.socialNeeds.find(row => row.id === barrier.documentId);
      if (coded) {
        const source = coded;
        assert.ok(source, `${patient.id}: coded source must belong to the patient`);
        assert.equal(source.type, barrier.type);
      } else {
        const source = patient.notes.find(note => note.id === barrier.documentId);
        assert.ok(source, `${patient.id}: clinical note must belong to the patient`);
        assert.ok(source.text.includes(barrier.quote), `${patient.id}: evidence must be an exact source excerpt`);
        assert.equal(barrier.note_type, source.note_type);
        assert.equal(barrier.date, source.date);
      }
    }
  }
});
