import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patients, ontology, BARRIERS, AS_OF, deriveFollowUp, deriveLikelyReturn, extractBarriers, reconcileBarriers, parseQuestion, runQuery, buildGraph, evaluateExtraction, sourceProvenance } from '../dist/engine.js';

const anchor = () => structuredClone(patients.find(patient => patient.id === 'P0412'));
const truth = JSON.parse(readFileSync(new URL('../ml/hospital-ground-truth.json', import.meta.url)));
const active = text => extractBarriers(text).filter(assertion => assertion.status === 'active').map(assertion => assertion.type).sort();

test('source is 1,000 distinct adult Synthea identities, with an auditable allowlisted import', () => {
  assert.equal(patients.length, 1000);
  assert.equal(new Set(patients.map(patient => patient.syntheaId)).size, 1000);
  assert.ok(patients.every(patient => patient.age >= 18));
  assert.equal(sourceProvenance.availableAdults, 8740);
  assert.match(sourceProvenance.archiveSha256, /^[a-f0-9]{64}$/);
  assert.ok(patients.every(patient => patient.admission.dischargeDate <= AS_OF && patient.daysSinceDischarge >= 0 && patient.daysSinceDischarge <= 90));
  assert.equal(patients.filter(patient => patient.admission.diabetesRelated).length, 150);
});

test('day 14 is eligible and day 13 is not', () => {
  const patient = anchor();
  patient.admission.dischargeDate = '2026-09-27';
  assert.equal(deriveFollowUp(patient).eligible, false);
  patient.admission.dischargeDate = '2026-09-26';
  assert.equal(deriveFollowUp(patient).eligible, true);
  assert.equal(deriveFollowUp(patient).open, true);
  patient.admission.diabetesRelated = false;
  assert.equal(deriveFollowUp(patient).open, false);
});

test('a completed visit on day 14 and medication pickup on day 3 meet both boundaries', () => {
  const patient = anchor();
  patient.admission.dischargeDate = '2026-09-10';
  patient.appointments = [{ date: '2026-09-24', status: 'completed' }];
  patient.medications = [{ newStart: true, pickedUp: true, pickupDate: '2026-09-13' }];
  assert.deepEqual(deriveFollowUp(patient).reasons, []);
  patient.appointments[0].date = '2026-09-25';
  assert.deepEqual(deriveFollowUp(patient).reasons, ['follow_up_not_completed_within_14_days']);
  patient.appointments[0].date = '2026-09-24';
  patient.medications[0].pickupDate = '2026-09-14';
  assert.deepEqual(deriveFollowUp(patient).reasons, ['new_medication_not_picked_up_within_3_days']);
});

test('missing, cancelled, and missed appointments are not completed visits', () => {
  for (const status of ['scheduled', 'cancelled', 'no-show']) {
    const patient = anchor();
    patient.appointments[0].status = status;
    assert.ok(deriveFollowUp(patient).reasons.includes('follow_up_not_completed_within_14_days'));
  }
  const patient = anchor();
  patient.appointments = [];
  assert.ok(deriveFollowUp(patient).reasons.includes('follow_up_not_completed_within_14_days'));
});

test('late pickup stays a timing gap, but picked-up insulin cannot trigger the inferred edge', () => {
  const patient = anchor();
  patient.medications[0].pickedUp = true;
  patient.medications[0].pickupDate = '2026-08-15';
  assert.ok(deriveFollowUp(patient).reasons.includes('new_medication_not_picked_up_within_3_days'));
  assert.equal(deriveLikelyReturn(patient), false);
});

test('the inferred edge requires every independent fact and A1c strictly above nine', () => {
  assert.equal(deriveLikelyReturn(anchor()), true);
  const changes = [
    patient => { patient.labs[0].value = 9; },
    patient => { patient.appointments[0].status = 'completed'; },
    patient => { patient.medications[0].pickedUp = true; },
    patient => { patient.medications[0].newStart = false; },
    patient => { patient.barriers = []; },
    patient => { patient.admission.diabetesRelated = false; },
  ];
  for (const change of changes) { const patient = anchor(); change(patient); assert.equal(deriveLikelyReturn(patient), false); }
  const patient = anchor();
  patient.appointments[0] = { date: '2026-09-15', status: 'completed' };
  assert.equal(deriveLikelyReturn(patient), false);
});

test('all five intentional hard cases create no active reported edge', () => {
  const cases = truth.cases.filter(item => !['routine-note', 'current-patient-barrier'].includes(item.category));
  assert.equal(cases.length, 60);
  assert.equal(new Set(cases.map(item => item.category)).size, 5);
  for (const item of cases) assert.deepEqual(active(item.text), [], item.category);
});

test('independent barrier clauses preserve their own status and exact source spans', () => {
  const text = 'Transportation is resolved and I cannot afford the insulin prescription.';
  const assertions = extractBarriers(text);
  assert.deepEqual(assertions.map(value => [value.type, value.status]), [['transportation', 'resolved'], ['cost', 'active']]);
  assert.ok(assertions.every(assertion => text.includes(assertion.quote)));
  assert.deepEqual(active('Pt cannot afford food.'), ['food']);
  assert.deepEqual(active('Pt has reliable transportation and cannot afford the insulin prescription.'), ['cost']);
  assert.deepEqual(active('Has not picked up insulin. States it was $90 at the counter and she left it.'), ['cost']);
});

test('a later resolved note removes a prior assertion and does not create a reported edge', () => {
  const notes = [
    { id: 'N1', date: '2026-08-04', note_type: 'Bedside nursing note', text: 'Pt has no ride to the clinic.' },
    { id: 'N2', date: '2026-08-05', note_type: 'Social work and case management note', text: 'Transport arranged by SW prior to discharge.' },
  ];
  assert.deepEqual(reconcileBarriers(notes), []);
  assert.equal(reconcileBarriers(notes.slice(0, 1))[0].documentId, 'N1');
});

test('coded social needs are valid source-linked assertions, with no extra graph node type', () => {
  const values = reconcileBarriers([], [{ id: 'Z1', type: 'transportation', code: 'Z59.82', display: 'Transportation', date: '2026-08-04' }]);
  assert.equal(values[0].sourceKind, 'coded');
  assert.equal(values[0].documentId, 'Z1');
  assert.equal(values[0].note_type, 'Coded social need');
});

test('three consecutive queries return the same computed exact count and source-linked graph', () => {
  const plan = parseQuestion('Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on?');
  const runs = Array.from({ length: 3 }, () => runQuery(plan));
  assert.equal(runs[0].count, 78);
  assert.ok(runs.every(run => run.fingerprint === runs[0].fingerprint && run.count === runs[0].count));
  const graph = buildGraph(runs[0].patients);
  for (const edge of graph.edges.filter(edge => edge.type === 'REPORTED_BARRIER')) {
    assert.ok(edge.documentId && edge.note_type && edge.quote);
    const patient = patients.find(value => value.id === edge.patientId);
    assert.ok(edge.sourceKind === 'coded' ? patient.socialNeeds.some(row => row.id === edge.documentId && row.display === edge.quote) : patient.notes.some(note => note.id === edge.documentId && note.text.includes(edge.quote)));
  }
});

test('the fifth group and unscripted insulin question have independent query semantics', () => {
  const standard = runQuery(parseQuestion('Patients with an open follow-up gap and no documented barrier'));
  assert.equal(standard.count, 51);
  assert.ok(standard.patients.every(patient => !patient.barriers.length));
  const plan = parseQuestion('Which patients report a cost barrier and never picked up their discharge insulin?').plan;
  assert.equal(plan.gapOnly, false);
  assert.equal(plan.insulinNotPickedUp, true);
  assert.deepEqual(plan.barriers, ['cost']);
  assert.ok(runQuery(plan).patients.every(patient => patient.barriers.some(value => value.type === 'cost') && patient.medications.some(value => value.isInsulin && !value.pickedUp)));
  const second = parseQuestion('Of those also with food insecurity', parseQuestion('Transportation barriers')).plan;
  assert.equal(second.barrierMode, 'all');
  assert.deepEqual(second.barriers, ['transportation', 'food']);
});

test('the ten node types and nine base relationships are exact, with inference separate', () => {
  assert.equal(ontology.nodeTypes.length, 10);
  assert.equal(ontology.relationships.length, 9);
  assert.deepEqual(ontology.inferredRelationships, ['LIKELY_TO_RETURN']);
  const graph = buildGraph();
  assert.deepEqual(new Set(graph.nodes.map(node => node.type)), new Set(ontology.nodeTypes));
  assert.deepEqual(new Set(graph.edges.map(edge => edge.type)), new Set([...ontology.relationships, ...ontology.inferredRelationships]));
  for (const edge of graph.edges) assert.ok(graph.nodes.some(node => node.id === edge.source) && graph.nodes.some(node => node.id === edge.target));
  assert.equal(Object.keys(BARRIERS).length, 4);
});

test('precision and recall are recomputed from hidden labels, including hard cases', () => {
  const result = evaluateExtraction(truth);
  assert.equal(result.total, 600);
  assert.equal(result.truePositive, 127);
  assert.equal(result.falsePositive, 0);
  assert.equal(result.falseNegative, 0);
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 1);
  assert.deepEqual(result.hardCases, { passed: 60, total: 60 });
  const altered = structuredClone(truth);
  altered.cases.find(item => item.expected.length).expected = [];
  assert.ok(evaluateExtraction(altered).precision < result.precision);
});

test('per-barrier precision and recall expose individual misses without hiding them in the aggregate', () => {
  const result = evaluateExtraction({ cases: [
    { text: 'Patient has no ride to the clinic.', expected: [{ type: 'transportation', status: 'active' }], category: 'current-patient-barrier' },
    { text: 'Patient has no ride to the clinic.', expected: [], category: 'routine-note' },
    { text: 'Reviewed discharge instructions.', expected: [{ type: 'cost', status: 'active' }], category: 'current-patient-barrier' },
  ] });
  assert.deepEqual(result.perBarrier.transportation, { precision: 0.5, recall: 1, truePositive: 1, falsePositive: 1, falseNegative: 0 });
  assert.deepEqual(result.perBarrier.cost, { precision: 0, recall: 0, truePositive: 0, falsePositive: 0, falseNegative: 1 });
  assert.equal(Object.values(result.perBarrier).reduce((sum, metrics) => sum + metrics.truePositive, 0), result.truePositive);
  assert.equal(Object.values(result.perBarrier).reduce((sum, metrics) => sum + metrics.falsePositive, 0), result.falsePositive);
  assert.equal(Object.values(result.perBarrier).reduce((sum, metrics) => sum + metrics.falseNegative, 0), result.falseNegative);
});
