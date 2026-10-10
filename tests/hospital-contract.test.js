import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { AS_OF, patients, ontology, BARRIERS, parseQuestion, evaluateExtraction, extractBarriers } from '../dist/engine.js';
import { createSqliteRepository } from '../backend/sqlite.js';
import { runAgent } from '../backend/agent.js';

const headline = 'Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?';
const day = 86400000;
const nodeTypes = ['Patient', 'Admission', 'Condition', 'LabResult', 'Medication', 'Appointment', 'FollowUpGap', 'ClinicalNote', 'Barrier', 'Action'];
const baseEdges = ['HAD_ADMISSION', 'HAS_CONDITION', 'HAS_RESULT', 'PRESCRIBED_AT_DISCHARGE', 'HAS_APPOINTMENT', 'HAS_NOTE', 'HAS_GAP', 'REPORTED_BARRIER', 'ADDRESSED_BY'];

test('the hospital migration removes the earlier synthetic records and creates every current table', async t => {
  const database = new DatabaseSync(':memory:'); t.after(() => database.close());
  database.exec('PRAGMA foreign_keys=ON');
  database.exec(await readFile(new URL('../drizzle/0000_broad_proemial_gods.sql', import.meta.url), 'utf8'));
  const columns = database.prepare('PRAGMA table_info(patients)').all();
  database.prepare(`INSERT INTO patients VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(column => /int|real/i.test(column.type) ? 0 : column.name === 'json' ? '{}' : 'previous-synthetic-record'));
  database.exec(await readFile(new URL('../drizzle/0001_hospital_system.sql', import.meta.url), 'utf8'));
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const table of ['metadata', 'patients', 'admissions', 'conditions', 'lab_results', 'medications', 'pharmacy_pickups', 'appointments', 'emergency_department_visits', 'social_needs', 'notes', 'assertions', 'graph_nodes', 'graph_edges', 'tasks', 'runs', 'audit']) assert.ok(tables.has(table), table);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM patients').get().count, 0);
  assert.deepEqual(database.prepare('PRAGMA table_info(patients)').all().map(column => column.name).sort(), ['id', 'name', 'age', 'sex', 'diabetes_admission', 'followup_gap', 'insulin_not_picked_up', 'likely_to_return', 'days_since_discharge', 'priority', 'json'].sort());
  assert.equal([...tables].includes('documents'), false);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('hospital seed has 1,000 adult Synthea identities and one recent index admission each', () => {
  assert.equal(patients.length, 1000);
  assert.equal(new Set(patients.map(patient => patient.id)).size, 1000);
  assert.equal(new Set(patients.map(patient => patient.syntheaId)).size, 1000);
  const eligible = patients.filter(patient => patient.admission.diabetesRelated);
  assert.equal(eligible.length, 150);
  for (const patient of patients) {
    assert.ok(patient.age >= 18, patient.id);
    assert.ok(patient.syntheaId, patient.id);
    const since = (Date.parse(AS_OF) - Date.parse(patient.admission.dischargeDate)) / day;
    assert.ok(Number.isInteger(since) && since >= 0 && since <= 90, patient.id);
    assert.ok(patient.admission.hospital, patient.id);
    assert.ok(patient.admission.dischargingPhysician, patient.id);
    assert.ok(Date.parse(patient.admission.admitDate) <= Date.parse(patient.admission.dischargeDate), patient.id);
  }
  const noteTypes = new Set();
  for (const patient of eligible) {
    assert.ok(patient.notes.length >= 3 && patient.notes.length <= 5, patient.id);
    assert.ok(patient.labs.some(lab => /a1c|hba1c/i.test(lab.name)), patient.id);
    assert.ok(patient.medications.length > 0, patient.id);
    assert.ok(patient.appointments.length > 0, patient.id);
    for (const note of patient.notes) {
      noteTypes.add(note.note_type);
      assert.equal(note.patientId, patient.id);
      assert.ok(note.authorRole);
      assert.equal(note.daysFromDischarge, (Date.parse(note.date) - Date.parse(patient.admission.dischargeDate)) / day);
    }
  }
  assert.deepEqual([...noteTypes].sort(), ['Bedside nursing note', 'Physician progress note', 'Social work and case management note', 'Discharge summary', 'Post-discharge nurse call note'].sort());
  const withBarrier = patients.filter(patient => patient.barriers.length);
  const codedShare = withBarrier.filter(patient => patient.socialNeeds.length).length / withBarrier.length;
  assert.ok(codedShare >= 0.1 && codedShare <= 0.3, `Coded social needs should cover roughly one in five: ${codedShare}`);
});

test('hospital ontology preserves ten node types and nine base relationships plus one inferred relationship', () => {
  assert.deepEqual([...ontology.nodeTypes].sort(), [...nodeTypes].sort());
  const edges = ontology.relationships;
  for (const edge of baseEdges) assert.ok(edges.includes(edge), edge);
  assert.deepEqual(ontology.inferredRelationships, ['LIKELY_TO_RETURN']);
  assert.equal(edges.filter(type => type !== 'LIKELY_TO_RETURN').length, 9);
  assert.equal(Object.keys(BARRIERS).length, 4);
  for (const barrier of Object.values(BARRIERS)) {
    assert.ok(barrier.action); assert.ok(barrier.owner); assert.ok(barrier.behavior); assert.ok(barrier.zCode);
  }
});

test('P0412 connects the brief story to a bedside source without a coded social need', async t => {
  const repo = await createSqliteRepository({ filename: ':memory:' }); t.after(() => repo.close()); await repo.seed();
  const patient = await repo.getPatient('P0412');
  assert.equal(patient.age, 67);
  assert.match(patient.admission.principalDiagnosis, /DKA|ketoacidosis/i);
  assert.equal(patient.labs.find(lab => /a1c|hba1c/i.test(lab.name)).value, 11.2);
  assert.equal(patient.socialNeeds.length, 0);
  assert.ok(patient.appointments.some(visit => visit.status === 'no-show' && (Date.parse(visit.date) - Date.parse(patient.admission.dischargeDate)) / day === 10));
  assert.ok(patient.medications.some(medication => medication.newStart && medication.isInsulin && !medication.pickedUp));
  const source = patient.notes.find(note => note.daysFromDischarge === -2 && /bedside/i.test(note.note_type));
  assert.ok(source); assert.match(source.text, /no way to (?:get to|reach)/i);
  const graph = await repo.getGraph({ patientId: patient.id, mode: 'patient', limit: 50 });
  const edge = graph.edges.find(item => item.type === 'REPORTED_BARRIER' && item.source === patient.id);
  assert.ok(edge); assert.equal(edge.note_type, source.note_type);
  assert.ok(graph.nodes.length <= 50);
});

test('three database executions have the same exact answer and every result has owned evidence', async t => {
  const repo = await createSqliteRepository({ filename: ':memory:' }); t.after(() => repo.close()); await repo.seed();
  const parsed = parseQuestion(headline); assert.equal(parsed.ok, true, parsed.error);
  const runs = [];
  for (let index = 0; index < 3; index++) runs.push(await repo.query(parsed.plan));
  assert.ok(runs[0].count > 0);
  assert.equal(new Set(runs.map(run => run.count)).size, 1);
  assert.equal(new Set(runs.map(run => run.fingerprint)).size, 1);
  assert.ok(runs[0].sql.text);
  for (const patient of runs[0].patients) {
    assert.ok(patient.barriers.length);
    for (const barrier of patient.barriers) {
      const source = await repo.getDocument(barrier.documentId);
      assert.equal(source.patientId, patient.id);
      assert.ok((source.text || source.display || '').includes(barrier.quote));
    }
  }
});

test('the three judging questions walk different real relationships and the note reroute follows the missing coded row', async t => {
  const repo = await createSqliteRepository({ filename: ':memory:' }); t.after(() => repo.close()); await repo.seed();
  const main = await runAgent({ question: headline, repo });
  assert.equal(main.ok, true, main.error);
  const traversed = execution => new Set(execution.events.filter(event => event.tool === 'expand_node').flatMap(event => event.edges.map(edge => edge.type)));
  assert.ok(traversed(main).has('HAS_GAP'));
  const missingCode = main.events.findIndex(event => /no.*(?:z.?code|coded social need)/i.test(event.say));
  const noteWalk = main.events.findIndex(event => event.tool === 'expand_node' && event.edges.some(edge => edge.type === 'HAS_NOTE'));
  assert.ok(missingCode >= 0, 'The actual source check must expose the missing coded row.');
  assert.ok(noteWalk > missingCode, 'The investigation must check for a coded row before turning to the notes.');
  const cost = await runAgent({ question: 'Which patients report a cost barrier and never picked up their discharge insulin?', repo });
  assert.equal(cost.ok, true, cost.error);
  assert.ok(traversed(cost).has('PRESCRIBED_AT_DISCHARGE'));
  const inferred = await runAgent({ question: 'Who is likely to return?', repo });
  assert.equal(inferred.ok, true, inferred.error);
  for (const relationship of ['LIKELY_TO_RETURN', 'HAS_RESULT', 'HAS_APPOINTMENT', 'PRESCRIBED_AT_DISCHARGE']) assert.ok(traversed(inferred).has(relationship), relationship);
});

test('all five deliberately difficult sentences produce no current graph assertion', () => {
  for (const text of [
    'Denies transportation concerns. Wife drives.',
    'Transport arranged by SW prior to discharge.',
    "Pt's brother lost his job and cannot afford his own medications.",
    'NPO after midnight, meals held for procedure.',
    'Previously had trouble affording strips, now has assistance in place.',
  ]) assert.equal(extractBarriers(text).filter(assertion => assertion.status === 'active').length, 0, text);
});

test('extraction is measured against a separate seed truth file containing hard cases', async () => {
  const truth = JSON.parse(await readFile(new URL('../ml/hospital-ground-truth.json', import.meta.url), 'utf8'));
  assert.ok(truth.cases.length >= 450);
  assert.ok(truth.cases.some(item => item.expected.length === 0));
  assert.equal(truth.provenance.selectedAdults, 1000);
  assert.match(truth.provenance.source, /Synthea/);
  assert.match(truth.provenance.archiveSha256, /^[a-f0-9]{64}$/);
  const report = evaluateExtraction(truth);
  assert.ok(report);
  assert.deepEqual(Object.keys(report.perBarrier).sort(), Object.keys(BARRIERS).sort());
  for (const metrics of Object.values(report.perBarrier)) {
    assert.ok(Number.isFinite(metrics.precision) && metrics.precision >= 0 && metrics.precision <= 1);
    assert.ok(Number.isFinite(metrics.recall) && metrics.recall >= 0 && metrics.recall <= 1);
  }
  assert.equal(Object.values(report.perBarrier).reduce((sum, metrics) => sum + metrics.truePositive, 0), report.truePositive);
  assert.equal(Object.values(report.perBarrier).reduce((sum, metrics) => sum + metrics.falsePositive, 0), report.falsePositive);
  assert.equal(Object.values(report.perBarrier).reduce((sum, metrics) => sum + metrics.falseNegative, 0), report.falseNegative);
  const encoded = JSON.stringify(report);
  assert.match(encoded, /precision/i); assert.match(encoded, /recall/i);
});
