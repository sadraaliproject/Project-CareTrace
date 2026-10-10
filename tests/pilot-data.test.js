import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AS_OF, rawPatients, provenance } from '../dist/pilot-data.js';
import { readNote } from '../dist/pilot-reader.js';
import { noteLabels, patientLabels, readerFreeze } from '../dist/pilot-labels.js';
import { generatePilot, wordingCatalog } from '../scripts/generate-pilot-data.js';
import { NOTE_TYPES } from '../dist/ontology.js';

const dayDifference = (earlier, later = AS_OF) => Math.round((Date.parse(later.slice(0, 10)) - Date.parse(earlier.slice(0, 10))) / 86400000);

test('pilot generation reproduces the checked-in records and isolated answer key', () => {
  const generated = generatePilot();
  assert.deepEqual(generated.rawPatients, rawPatients);
  assert.deepEqual(generated.noteLabels, noteLabels);
  assert.deepEqual(generated.patientLabels, patientLabels);
  assert.equal(rawPatients.length, 1000);
  assert.equal(new Set(rawPatients.map(p => p.id)).size, 1000);
  assert.ok(rawPatients.every(p => p.age >= 18));
  assert.ok(rawPatients.every(p => dayDifference(p.admission.dischargeDate) >= 0 && dayDifference(p.admission.dischargeDate) < 90));
});

test('authored scenario proportions are selective and add up without entering the graph builder', () => {
  const diabetes = rawPatients.filter(p => p.admission.diabetesRelated);
  const gap = patientLabels.filter(p => p.openFollowUpGap);
  const documented = gap.filter(p => p.trueBarrierTypes.length);
  assert.equal(diabetes.length, 150);
  assert.equal(gap.length, 60);
  assert.equal(documented.length, 27);
  assert.equal(gap.length - documented.length, 33);
  assert.ok(documented.every(p => p.trueBarrierTypes.length <= 2));
  assert.equal(documented.filter(p => p.trueBarrierTypes.length === 2).length, 4);
  const ids = new Set(documented.map(p => p.patientId));
  assert.equal(rawPatients.filter(p => ids.has(p.id) && p.socialNeeds.length).length, 5);
  assert.ok(rawPatients.filter(p => ids.has(p.id) && dayDifference(p.admission.dischargeDate) < 30).length >= documented.length / 2);
  const counts = Object.fromEntries(['transportation', 'cost', 'food', 'health_literacy'].map(type => [type, documented.filter(p => p.trueBarrierTypes.includes(type)).length]));
  assert.deepEqual(counts, { transportation: 9, cost: 11, food: 6, health_literacy: 5 });
  assert.equal(rawPatients.reduce((total, p) => total + p.emergencyVisits.length, 0), 6);
});

test('clinical notes have complete metadata, varied language and credible event chronology', () => {
  const ids = new Set();
  const sentences = new Set();
  const labels = new Map(noteLabels.map(row => [row.noteId, row]));
  for (const patient of rawPatients.filter(p => p.admission.diabetesRelated)) {
    assert.ok(patient.notes.length >= 3 && patient.notes.length <= 5);
    assert.ok(Date.parse(patient.admission.admit_datetime) < Date.parse(patient.admission.discharge_datetime));
    for (const note of patient.notes) {
      assert.ok(!ids.has(note.id)); ids.add(note.id);
      assert.ok(note.author_role && /^[A-Z]{2}$/.test(note.author_initials) && note.unit && note.written_datetime);
      assert.equal(note.date, note.written_datetime.slice(0, 10));
      assert.equal(note.daysFromDischarge, -dayDifference(note.date, patient.admission.dischargeDate) || 0);
      const parsed = readNote(note);
      assert.ok(parsed.sentences.length >= 3 && parsed.sentences.length <= 6, note.id);
      for (const text of labels.get(note.id).evidenceSentences) {
        assert.ok(!sentences.has(text), `Repeated active wording: ${text}`);
        sentences.add(text);
      }
    }
    for (const visit of patient.appointments) assert.ok(visit.date <= AS_OF, 'A completed visit or no-show cannot be in the future');
    for (const visit of patient.emergencyVisits) assert.ok(visit.date > patient.appointments[0].date && visit.date <= AS_OF);
  }
  assert.equal(ids.size, noteLabels.length);
  for (const [type, byNote] of Object.entries(wordingCatalog)) for (const name of NOTE_TYPES) {
    assert.equal(new Set(byNote[name]).size, 8);
    const nameTerms = type === 'health_literacy' ? /health|literacy/i : type === 'food' ? /food|insecurity/i : new RegExp(type, 'i');
    assert.ok(byNote[name].filter(text => !nameTerms.test(text)).length >= 8 / 3);
  }
});

test('featured patient can be selected from multiple candidates using only computed evidence', () => {
  const candidates = rawPatients.filter(p => {
    const days = dayDifference(p.admission.dischargeDate);
    const active = p.notes.flatMap(note => readNote(note).assertions).filter(a => a.status === 'active');
    const types = new Set(active.map(a => a.type));
    return days >= 8 && days <= 20 && p.admission.principalDiagnosis === 'Diabetic ketoacidosis'
      && p.labs.some(l => l.code === '4548-4' && l.value > 9)
      && p.appointments.some(a => a.status === 'no_show')
      && p.medications.some(m => m.name === 'Insulin glargine' && m.newStart && !m.pickedUp)
      && types.size === 1 && types.has('transportation') && !p.socialNeeds.length
      && active.some(a => a.note_type === 'Bedside nursing note' && a.daysFromDischarge < 0);
  });
  assert.ok(candidates.length >= 3);
});

test('the frozen reader is isolated from labels and produces inspectable source spans', async () => {
  const source = (await readFile(new URL('../dist/pilot-reader.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), readerFreeze.sha256);
  assert.equal(provenance.frozenReaderSha256, readerFreeze.sha256);
  assert.ok(!/pilot-labels|pilot-data|generate-pilot-data/.test(source));
  for (const patient of rawPatients) for (const note of patient.notes) {
    for (const assertion of readNote(note).assertions) {
      assert.equal(note.text.slice(...assertion.char_span), assertion.quote);
      assert.equal(assertion.documentId, note.id);
      assert.ok(assertion.confidence >= 0 && assertion.confidence <= 1);
    }
  }
});

test('evaluation includes difficult context and computes actual note-level mistakes', () => {
  const hard = noteLabels.filter(l => !['active', 'routine'].includes(l.category));
  assert.ok(hard.length >= 40);
  for (const category of ['negation', 'resolved', 'third_party', 'clinical', 'historical']) assert.ok(hard.filter(l => l.category === category).length >= 8);
  const labels = new Map(noteLabels.map(l => [l.noteId, l]));
  const totals = { tp: 0, fp: 0, fn: 0 };
  for (const patient of rawPatients) for (const note of patient.notes) {
    const expected = new Set(labels.get(note.id).expectedActiveTypes);
    const observed = new Set(readNote(note).assertions.filter(a => a.status === 'active').map(a => a.type));
    for (const type of Object.keys(wordingCatalog)) {
      if (observed.has(type) && expected.has(type)) totals.tp++;
      if (observed.has(type) && !expected.has(type)) totals.fp++;
      if (!observed.has(type) && expected.has(type)) totals.fn++;
    }
  }
  assert.ok(totals.tp > 0 && totals.fp > 0 && totals.fn > 0);
  assert.equal(totals.tp + totals.fn, noteLabels.reduce((count, row) => count + row.expectedActiveTypes.length, 0));
});
