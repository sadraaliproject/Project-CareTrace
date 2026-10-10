import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { rawPatients } from "../dist/pilot-data.js";
import { readNote } from "../dist/pilot-reader.js";
import { noteLabels } from "../dist/pilot-labels.js";
import {
  evaluateNotes,
  buildSearchIndex,
  groundTruthIds,
  matchQuestion,
} from "../dist/pilot-support.js";
import { ontology } from "../dist/ontology.js";

test("evaluation independently counts note/type outcomes and exposes real mistakes", () => {
  const actual = evaluateNotes();
  const notes = new Map(
    rawPatients.flatMap((patient) =>
      patient.notes.map((note) => [note.id, note]),
    ),
  );
  const counts = { tp: 0, fp: 0, fn: 0 };
  for (const label of noteLabels) {
    const active = new Set(
      readNote(notes.get(label.noteId))
        .assertions.filter((row) => row.status === "active")
        .map((row) => row.type),
    );
    for (const type of ontology.barrierTypes) {
      if (active.has(type) && label.expectedActiveTypes.includes(type))
        counts.tp++;
      if (active.has(type) && !label.expectedActiveTypes.includes(type))
        counts.fp++;
      if (!active.has(type) && label.expectedActiveTypes.includes(type))
        counts.fn++;
    }
  }
  assert.deepEqual(
    { tp: actual.overall.tp, fp: actual.overall.fp, fn: actual.overall.fn },
    counts,
  );
  assert.equal(actual.falsePositives.length, counts.fp);
  assert.equal(actual.falseNegatives.length, counts.fn);
  assert.ok(counts.fp > 0 && counts.fn > 0);
  for (const mistake of [...actual.falsePositives, ...actual.falseNegatives])
    assert.equal(mistake.note.id, mistake.noteId);
  for (const key of ["tp", "fp", "fn"])
    assert.equal(
      Object.values(actual.byType).reduce((sum, row) => sum + row[key], 0),
      counts[key],
    );
});

test("note retrieval uses text, ranks cosine scores, counts unique patients and expands k", () => {
  const index = buildSearchIndex();
  const question =
    "Which patients have transportation barriers and missed important follow-up?";
  const truth = groundTruthIds("transportation");
  const five = index.search(question, 5, truth),
    twenty = index.search(question, 20, truth);
  assert.deepEqual(
    five.results.map((row) => row.noteId),
    twenty.results.slice(0, 5).map((row) => row.noteId),
  );
  assert.equal(five.results.length, 5);
  assert.equal(twenty.neverRead, index.notes.length - 20);
  for (let i = 1; i < twenty.results.length; i++)
    assert.ok(twenty.results[i].score <= twenty.results[i - 1].score + 1e-12);
  assert.ok(
    twenty.results.every((row) => row.score >= 0 && row.score <= 1.00001),
  );
  assert.equal(
    twenty.right + twenty.wrong,
    new Set(twenty.results.map((row) => row.patientId)).size,
  );
  assert.equal(
    twenty.right,
    new Set(
      twenty.results
        .filter((row) => truth.has(row.patientId))
        .map((row) => row.patientId),
    ).size,
  );
  assert.ok(
    index.points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ),
  );
  const xMean =
    index.points.reduce((sum, point) => sum + point.x, 0) / index.points.length;
  const yMean =
    index.points.reduce((sum, point) => sum + point.y, 0) / index.points.length;
  assert.ok(
    Math.abs(xMean) < 1e-10 && Math.abs(yMean) < 1e-10,
    "PCA coordinates are centered",
  );
  assert.ok(
    Number.isFinite(five.queryPoint.x) && Number.isFinite(five.queryPoint.y),
  );
  assert.notDeepEqual(
    index.search("cost insulin copay", 5).queryPoint,
    five.queryPoint,
    "The query is projected into the fitted PCA map",
  );
  const reversed = buildSearchIndex([...index.notes].reverse()).search(
    question,
    5,
    truth,
  );
  assert.deepEqual(
    reversed.results.map((row) => row.noteId),
    five.results.map((row) => row.noteId),
    "Ranking does not depend on record order",
  );
});

test("evaluation reference sets honor different clinical and date criteria for all prepared routes", () => {
  assert.equal(groundTruthIds("all").size, rawPatients.length);
  assert.equal(
    groundTruthIds("no-pickup").size,
    rawPatients.filter(
      (p) =>
        p.admission.diabetesRelated &&
        p.medications.some((m) => m.newStart && !m.pickedUp),
    ).length,
  );
  assert.equal(
    groundTruthIds("ed-returns").size,
    rawPatients.filter(
      (p) =>
        p.admission.diabetesRelated &&
        p.appointments.some(
          (a) =>
            ["no-show", "no_show"].includes(a.status) &&
            p.emergencyVisits.some((v) => v.date > a.date),
        ),
    ).length,
  );
  assert.ok(groundTruthIds("ed-returns").size > 0);
  for (const id of groundTruthIds("within30")) {
    const patient = rawPatients.find((p) => p.id === id);
    assert.ok(
      (Date.parse("2026-10-10") - Date.parse(patient.admission.dischargeDate)) /
        86400000 <
        30,
    );
  }
  assert.ok(groundTruthIds("health-literacy").size < groundTruthIds().size);
  assert.ok(groundTruthIds("food").size < groundTruthIds().size);
});

test("prepared plans use declared edges, contain no counts, and free text is explicitly a closest route", async () => {
  const plans = JSON.parse(await readFile("dist/prepared/plans.json", "utf8"));
  assert.equal(plans.length, 15);
  assert.equal(new Set(plans.map((plan) => plan.id)).size, 15);
  for (const plan of plans) {
    assert.equal(Object.hasOwn(plan, "count"), false);
    for (const hop of plan.route)
      assert.ok(
        ontology.paths.some(
          (path) => path.join("/") === [hop.from, hop.edge, hop.to].join("/"),
        ),
      );
    assert.equal(matchQuestion(plan.question, plans).plan.id, plan.id);
    assert.equal(matchQuestion(plan.question, plans).exact, true);
  }
  const closest = matchQuestion("Who cannot afford the insulin copay?", plans);
  assert.equal(closest.exact, false);
  assert.equal(closest.plan.id, "cost");
  const readings = JSON.parse(
    await readFile("dist/prepared/reading.json", "utf8"),
  );
  for (const reading of readings)
    assert.deepEqual(reading.assertions, readNote(reading.note).assertions);
});
