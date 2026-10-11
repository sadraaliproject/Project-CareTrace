import test from "node:test";
import assert from "node:assert/strict";
import { readLiveNote, LIVE_READER_VERSION } from "../backend/live-reader.js";
import { readNote as frozenReader } from "../dist/pilot-reader.js";
import { rawPatients } from "../dist/pilot-data.js";
import { noteLabels } from "../dist/pilot-labels.js";
import { createLiveGraph } from "../backend/live-graph.js";

function patientWithNotes(texts) {
  const patient = structuredClone(rawPatients[0]);
  patient.socialNeeds = [];
  patient.notes = texts.map((text, index) => ({
    ...patient.notes[0],
    id: patient.id + "-T0" + (index + 1),
    date: index ? "2026-10-09" : "2026-09-25",
    written_datetime: index ? "2026-10-09T10:00:00Z" : "2026-09-25T10:00:00Z",
    text,
  }));
  return patient;
}

test("brief explicit resolutions and denials supersede older active barriers", () => {
  for (const text of [
    "I no longer need transportation help.",
    "Transportation has been arranged.",
    "Patient denies transportation problems.",
    "Patient now has a reliable ride to the clinic.",
  ]) {
    const patient = patientWithNotes([
      "Patient has no reliable ride to the clinic.",
      text,
    ]);
    const graph = createLiveGraph([patient]);
    assert.equal(graph.getPatient(patient.id).barriers.length, 0, text);
    assert.equal(graph.query({ barriers: ["transportation"] }).count, 0, text);
    assert.equal(
      graph.source(patient.notes[1].id).assertions[0].type,
      "transportation",
    );
    assert.ok(
      ["resolved", "negated"].includes(
        graph.source(patient.notes[1].id).assertions[0].status,
      ),
    );
    assert.equal(
      graph.getPatient(patient.id, { asOf: "2026-09-26" }).barriers.length,
      1,
    );
  }
});

test("denial in one clause does not erase a different current barrier", () => {
  for (const text of [
    "Patient denies cost concerns but has no reliable ride to the clinic.",
    "Patient has no reliable ride to the clinic; patient denies medication cost concerns.",
    "Patient has no reliable ride to the clinic, however the insulin cost problem is resolved.",
  ]) {
    const result = readLiveNote({ id: "T01", text });
    assert.deepEqual(
      result.assertions.filter((a) => a.status === "active").map((a) => a.type),
      ["transportation"],
      text,
    );
    for (const assertion of result.assertions)
      assert.equal(text.slice(...assertion.char_span), assertion.quote);
  }
});

test("a resolved clause with no outstanding ride does not invent a second active need", () => {
  const text =
    "Transport arranged by SW prior to discharge; no ride remains outstanding.";
  assert.equal(
    readLiveNote(text).assertions.filter((a) => a.status === "active").length,
    0,
  );
});

test("independent and-clauses preserve a medication cost barrier beside a transport denial", () => {
  for (const text of [
    "Patient denies transportation concerns and cannot afford insulin.",
    "Patient cannot afford insulin and denies transportation concerns.",
  ]) {
    assert.deepEqual(
      readLiveNote(text)
        .assertions.filter((a) => a.status === "active")
        .map((a) => a.type),
      ["cost"],
    );
  }
});

test("independent clauses retain family scope until explicitly returning to the patient", () => {
  const family =
    "Pt's brother lost his job and cannot afford his own medications.";
  assert.equal(
    readLiveNote(family).assertions.filter((a) => a.status === "active").length,
    0,
  );
  const mixed =
    "Her mother cannot afford her medications, but patient has no reliable ride to the clinic.";
  assert.deepEqual(
    readLiveNote(mixed)
      .assertions.filter((a) => a.status === "active")
      .map((a) => a.type),
    ["transportation"],
  );
});

test("active reader is independently versioned and frozen guided-story behavior stays intact", () => {
  const text = "I no longer need transportation help.";
  assert.equal(frozenReader(text).assertions.length, 0);
  assert.equal(readLiveNote(text).version, LIVE_READER_VERSION);
  assert.equal(readLiveNote(text).assertions[0].status, "resolved");
  assert.notEqual(readLiveNote(text).version, frozenReader(text).version);
});

test("all live assertions retain exact note spans and independent measured errors", () => {
  const labels = new Map(noteLabels.map((row) => [row.noteId, row]));
  const counts = { tp: 0, fp: 0, fn: 0 };
  for (const patient of rawPatients)
    for (const note of patient.notes) {
      const reading = readLiveNote(note);
      for (const assertion of reading.assertions) {
        assert.equal(note.text.slice(...assertion.char_span), assertion.quote);
        assert.equal(assertion.documentId, note.id);
      }
      const actual = new Set(
        reading.assertions
          .filter((a) => a.status === "active")
          .map((a) => a.type),
      );
      const expected = new Set(labels.get(note.id).expectedActiveTypes);
      for (const type of [
        "transportation",
        "cost",
        "food",
        "health_literacy",
      ]) {
        if (actual.has(type) && expected.has(type)) counts.tp++;
        if (actual.has(type) && !expected.has(type)) counts.fp++;
        if (!actual.has(type) && expected.has(type)) counts.fn++;
      }
    }
  assert.deepEqual(counts, { tp: 49, fp: 6, fn: 5 });
});
