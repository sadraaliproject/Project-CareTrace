import test from 'node:test';
import assert from 'node:assert/strict';
import { AS_OF, BARRIERS, patients, parseQuestion, runQuery, extractBarriers, reconcileBarriers, makeDraft, getMetrics, evaluateExtraction, buildGraph } from '../dist/engine.js';

const query = (text, previous) => {
  const parsed = parseQuestion(text, previous);
  assert.equal(parsed.ok, true, parsed.error);
  return { ...parsed, result: runQuery(parsed.plan) };
};
const doc = (text, date = AS_OF, id = 'test-source') => ({ id, text, date, type: 'Synthetic test note' });

test('synthetic snapshot has 1,000 unique patients, 3,000 unique sources and internally consistent A1c gaps', () => {
  assert.equal(patients.length, 1000);
  assert.equal(new Set(patients.map(p => p.id)).size, 1000);
  assert.equal(new Set(patients.flatMap(p => p.documents.map(d => d.id))).size, 3000);
  assert.equal(getMetrics().diabetes, 800);
  for (const p of patients) {
    assert.equal(p.gapOpen, p.diabetes && (p.daysOverdue > 0 || p.a1c > 9));
    assert.equal(new Set(p.barriers.map(b => b.type)).size, p.barriers.length);
    assert.ok(p.documents.every(d => d.text.includes('Synthetic')));
    assert.ok(p.priority >= 0 && p.priority <= 100);
  }
  assert.ok(patients.some(p => p.diabetes && p.refillGap > 30 && !p.gapOpen), 'Refill delay alone must not create an A1c gap');
});

test('headline cohort has an exact stable count with overdue A1c and current transportation evidence', () => {
  const { plan, result } = query('Find diabetic patients missing an A1c test because they cannot get transportation');
  assert.equal(result.count, 82);
  assert.equal(result.patients.length, 82);
  assert.deepEqual(result.patients.map(p => p.id), runQuery(plan).patients.map(p => p.id));
  assert.equal(result.fingerprint, runQuery(plan).fingerprint);
  assert.equal(new Set(result.patients.map(p => p.id)).size, result.count);
  assert.ok(result.patients.every(p => p.diabetes && p.daysOverdue > 0 && p.barriers.some(b => b.type === 'transportation' && b.status === 'active')));
  assert.ok(result.excludedResolved > 0);
});

test('P0412 demonstrates a true structured-data miss and a linked document fallback', () => {
  const { result } = query('Find diabetic patients missing important tests because they cannot get transportation');
  const p = result.patients.find(p => p.id === 'P0412');
  assert.ok(p);
  assert.equal(p.structuredBarrierCode, false);
  const lookup = result.events.find(e => e.tool === 'lookup_structured_barrier');
  assert.equal(lookup.found, 0);
  const fallback = result.events.find(e => e.tool === 'retrieve_source_assertion');
  assert.ok(fallback.evidence.some(b => b.documentId === 'P0412-D02'));
  assert.equal(p.barriers.length, 1, 'A family cost problem must not become the patient’s cost barrier');
});

test('AND, OR, and result limits preserve exact total counts', () => {
  const and = query('Find patients with medication cost and food insecurity barriers').result;
  const or = query('Find patients with medication cost or food insecurity barriers').result;
  assert.equal(and.count, 15);
  assert.ok(or.count > and.count);
  assert.ok(and.patients.every(p => ['cost', 'food'].every(type => p.barriers.some(b => b.type === type && b.status === 'active'))));
  const limited = query('Show top 5 patients with open care gaps and transportation barriers').result;
  assert.equal(limited.patients.length, 5);
  assert.equal(limited.count, 123);
});

test('followups inherit clinical scope and can change the barrier or age without restart', () => {
  const first = query('Find diabetic patients missing an A1c test because they cannot get transportation');
  const second = query('Now only over 65', first.plan);
  assert.equal(second.plan.ageMin, 66);
  assert.equal(second.plan.gapType, 'overdue');
  assert.deepEqual(second.plan.barriers, ['transportation']);
  const third = query('What about food insecurity?', second.plan);
  assert.deepEqual(third.plan.barriers, ['food']);
  assert.equal(third.plan.ageMin, 66);
});

test('empty barrier list means no barrier restriction and explicit generic barriers require evidence', () => {
  const all = query('Show all patients').result;
  assert.equal(all.count, 1000);
  const barrier = query('Show all patients with a barrier').result;
  assert.ok(barrier.count < 1000);
  assert.ok(barrier.patients.every(p => p.barriers.some(b => b.status === 'active')));
});

test('negated, family-only, and conditional statements do not create active barriers', () => {
  for (const text of [
    'Patient denies food insecurity.',
    'Patient has reliable transportation to the clinic.',
    'Her mother cannot afford the medication copay.',
    'Patient reports that her mother cannot afford the medication copay.',
    'If the patient needs transportation help, provide a resource list.',
    'Patient might have food insecurity.',
  ]) assert.deepEqual(extractBarriers(doc(text)), [], text);
  assert.deepEqual(extractBarriers(doc('I no longer need transportation help.')).map(b => [b.type, b.status]), [['transportation', 'resolved']]);
});

test('the latest patient denial supersedes active history regardless of input document order', () => {
  const old = doc('Patient cannot get a ride to the clinic.', '2026-08-01', 'old');
  const recent = doc('Patient denies transportation problems.', '2026-10-09', 'recent');
  const later = doc('I have no transportation to my appointments.', AS_OF, 'later');
  const resolved = reconcileBarriers([recent, old]);
  assert.equal(resolved[0].status, 'resolved');
  assert.equal(resolved[0].documentId, 'recent');
  const activeAgain = reconcileBarriers([recent, later, old]);
  assert.equal(activeAgain[0].status, 'active');
  assert.equal(activeAgain[0].documentId, 'later');
  assert.deepEqual(reconcileBarriers([recent]), [], 'A denial without positive history is not a newly discovered barrier');
});

test('negation is scoped to the assertion and does not suppress another real barrier', () => {
  const items = extractBarriers(doc('Patient denies transportation problems but cannot afford the medication copay.'));
  assert.deepEqual(items.map(b => [b.type, b.status]), [['cost', 'active']]);
  assert.equal(items[0].quote, 'cannot afford the medication copay.');
});

test('temporal negation distinguishes loss of a ride from resolution of transportation need', () => {
  for (const text of [
    'I no longer have a ride.',
    'The bus route no longer reaches the laboratory.',
    'Patient no longer has reliable transportation.',
    'My usual ride is no longer available for medical visits.',
    'The transportation barrier is not resolved.'
  ]) {
    const assertions = extractBarriers(doc(text));
    assert.deepEqual(assertions.map(b => [b.type, b.status]), [['transportation', 'active']], text);
    assert.equal(assertions[0].quote, text);
  }
  assert.deepEqual(extractBarriers(doc('I no longer need transportation help.')).map(b => [b.type, b.status]), [['transportation', 'resolved']]);
  assert.deepEqual(extractBarriers(doc('Patient no longer has a transportation barrier.')).map(b => [b.type, b.status]), [['transportation', 'resolved']]);
  assert.deepEqual(extractBarriers(doc('Patient no longer has food insecurity.')).map(b => [b.type, b.status]), [['food', 'resolved']]);
  assert.deepEqual(extractBarriers(doc('Patient denies transportation problems.')), []);
});

test('a later loss of access reopens a previously resolved barrier, retaining the new source', () => {
  const history = [
    doc('Patient cannot get a ride to the clinic.', '2026-07-01', 'need'),
    doc('I no longer need transportation help.', '2026-08-01', 'help-arranged'),
    doc('I no longer have a ride.', '2026-10-09', 'ride-lost')
  ];
  const barriers = reconcileBarriers(history.reverse());
  assert.equal(barriers.length, 1);
  assert.equal(barriers[0].status, 'active');
  assert.equal(barriers[0].documentId, 'ride-lost');
  assert.equal(barriers[0].quote, 'I no longer have a ride.');
});

test('the default ingestion note resolves transportation with its exact new source', () => {
  const text = 'Patient: My daughter now drives me to appointments. Transportation is no longer a problem.';
  const latest = doc(text, '2026-10-10', 'default-ingestion-note');
  assert.deepEqual(extractBarriers(latest).map(b => [b.type, b.status, b.quote]), [['transportation', 'resolved', 'Transportation is no longer a problem.']]);
  const reconciled = reconcileBarriers([doc('I have no transportation to my appointments.', '2026-10-07', 'previous-need'), latest]);
  assert.equal(reconciled[0].status, 'resolved');
  assert.equal(reconciled[0].documentId, 'default-ingestion-note');
  for (const [type, sentence] of [
    ['cost', 'Medication cost is no longer a barrier.'],
    ['food', 'Food access is no longer an issue.'],
    ['health_literacy', 'Understanding the instructions is no longer difficult.']
  ]) assert.deepEqual(extractBarriers(doc(sentence)).map(b => [b.type, b.status]), [[type, 'resolved']]);
});

test('the graph is a valid typed projection and graph metrics count its actual contents', () => {
  const graph = buildGraph();
  const ids = new Set(graph.nodes.map(n => n.id));
  assert.equal(ids.size, graph.nodes.length);
  assert.equal(new Set(graph.edges.map(e => e.id)).size, graph.edges.length);
  assert.ok(graph.edges.every(e => ids.has(e.source) && ids.has(e.target)));
  assert.equal(getMetrics().nodes, graph.nodes.length);
  assert.equal(getMetrics().edges, graph.edges.length);
  for (const edge of graph.edges.filter(e => e.type === 'EVIDENCES')) {
    const source = graph.nodes.find(n => n.id === edge.source);
    assert.ok(source.text.includes(edge.quote));
  }
  const one = buildGraph(['P0412']);
  assert.equal(one.nodes.filter(n => n.type === 'Patient').length, 1);
  assert.ok(one.edges.some(e => e.type === 'EVIDENCES' && e.source === 'P0412-D02'));
});

test('draft preparation requires an active barrier, cites evidence, and explicitly remains unsent', () => {
  const p = patients.find(p => p.id === 'P0412');
  const draft = makeDraft(p, 'transportation');
  assert.ok(draft.body.includes('P0412-D02'));
  assert.ok(draft.body.includes(p.barriers[0].quote));
  assert.ok(draft.body.includes('No message has been sent'));
  assert.equal(draft.intervention, BARRIERS.transportation.intervention);
  assert.throws(() => makeDraft(p, 'food'), /active/);
  assert.throws(() => makeDraft({ ...p, gapOpen: false }, 'transportation'), /open A1c/);
});

test('synthetic extraction evaluation reports actual outcomes and its validation limits', () => {
  const evaluation = evaluateExtraction();
  assert.equal(evaluation.total, 20);
  assert.equal(evaluation.cases.length, 20);
  assert.ok(evaluation.cases.every(c => typeof c.passed === 'boolean' && Array.isArray(c.actual)));
  assert.equal(evaluation.passed, evaluation.cases.filter(c => c.passed).length);
  assert.equal(evaluation.precision, evaluation.tp / (evaluation.tp + evaluation.fp));
  assert.equal(evaluation.corpus.total, 1000);
  assert.equal(evaluation.corpus.passed, 1000);
  assert.match(evaluation.note, /not independently validated/);
});

test('unsupported or ambiguous filters refuse rather than return a different cohort', () => {
  for (const question of [
    'Find female diabetic patients',
    'Find patients with A1c over 10',
    'Find patients with transportation barriers not resolved',
    'Find patients with current transportation and no longer cost barriers',
    'Find patients without medication',
    'Find patients with completed A1c tests',
    'Find patients with no overdue tests',
    'Find patients without an open care gap',
    'Find patients with high A1c and an overdue A1c test',
    'Find patients with transportation barriers over 50 years ago',
    'Find patients with refill gaps for 30 days',
    'Find top 0 patients',
    'Find patients sorted by copay amount',
  ]) assert.equal(parseQuestion(question).ok, false, question);
});
