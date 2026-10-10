import test from "node:test";
import assert from "node:assert/strict";
import {
  createLiveGraph,
  defaultFilters,
  validateFilters,
} from "../backend/live-graph.js";
import { AS_OF } from "../dist/pilot-data.js";

const graph = createLiveGraph();

test("live graph preserves the measured hospital funnel and exact stable cohort", () => {
  const overview = graph.overview();
  assert.deepEqual(
    [overview.discharges, overview.diabetes, overview.gaps, overview.barrier],
    [1000, 150, 60, 26],
  );
  const first = graph.query();
  const second = graph.query();
  assert.equal(first.count, 26);
  assert.equal(first.ids.length, first.count);
  assert.equal(new Set(first.ids).size, first.count);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(
    first.groups.reduce((sum, group) => sum + group.count, 0),
    first.count,
  );
  assert.ok(first.execution.edgesVisited > 1000);
  assert.equal(first.execution.patientsScanned, 1000);
  assert.equal(first.asOf, AS_OF);
});

test("filters compose independently with any/all barrier semantics, unit and exact ages", () => {
  const either = graph.query({
    barriers: ["cost", "transportation"],
    barrierMode: "any",
  });
  const both = graph.query({
    barriers: ["cost", "transportation"],
    barrierMode: "all",
  });
  assert.ok(either.count > both.count);
  assert.ok(both.count > 0);
  assert.ok(
    both.patients.every((patient) =>
      ["cost", "transportation"].every((type) =>
        patient.barriers.some((barrier) => barrier.type === type),
      ),
    ),
  );
  const witness = both.patients[0];
  const narrowed = graph.query({
    barriers: ["cost", "transportation"],
    barrierMode: "all",
    ageMin: witness.age,
    ageMax: witness.age,
    unit: witness.unit,
  });
  assert.ok(narrowed.ids.includes(witness.id));
  assert.ok(
    narrowed.patients.every(
      (patient) => patient.age === witness.age && patient.unit === witness.unit,
    ),
  );
  assert.equal(
    graph.query({ barriers: ["cost", "transportation"] }).fingerprint,
    graph.query({ barriers: ["transportation", "cost", "cost"] }).fingerprint,
  );
});

test("no-barrier, uncoded, insulin and emergency joins use recorded facts", () => {
  assert.equal(graph.query({ barrierPresence: "absent" }).count, 34);
  const uncoded = graph.query({ uncodedOnly: true });
  assert.equal(uncoded.count, 21);
  assert.ok(
    uncoded.ids.every((id) => graph.getPatient(id).socialNeeds.length === 0),
  );
  const insulin = graph.query({ barriers: ["cost"], insulinNotPickedUp: true });
  assert.equal(insulin.count, 11);
  assert.ok(
    insulin.ids.every((id) =>
      graph
        .getPatient(id)
        .medications.some(
          (row) => row.newStart && row.isInsulin && !row.pickedUp,
        ),
    ),
  );
  assert.equal(
    graph.query({ barrierPresence: "any", gapOnly: false, edReturn: true })
      .count,
    6,
  );
  assert.equal(graph.query({ within30: true }).count, 19);
});

test("large results are exact while samples and graphs remain bounded", () => {
  const all = graph.query(
    { diabetesAdmissionOnly: false, gapOnly: false, barrierPresence: "any" },
    { limit: 7 },
  );
  assert.equal(all.count, 1000);
  assert.equal(all.ids.length, 1000);
  assert.equal(all.patients.length, 7);
  assert.equal(all.sampleTruncated, true);
  assert.ok(all.graph.nodes.length <= 50);
  const ids = new Set(all.graph.nodes.map((node) => node.id));
  assert.ok(
    all.graph.edges.every(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    ),
  );
});

test("citations point to exact source text and caller mutation cannot alter the graph", () => {
  const original = graph.query();
  for (const citation of original.citations) {
    const source = graph.source(citation.sourceId);
    assert.equal(source.patientId, citation.patientId);
    if (citation.sourceKind === "note") {
      assert.ok(source.text.includes(citation.quote));
      if (citation.charSpan)
        assert.equal(source.text.slice(...citation.charSpan), citation.quote);
    }
  }
  const patient = graph.getPatient("P0001");
  patient.barriers.length = 0;
  original.ids.length = 0;
  const source = graph.source("P0001-N01");
  source.row.text = "mutated";
  assert.equal(graph.query().count, 26);
  assert.ok(graph.getPatient("P0001").barriers.length);
  assert.notEqual(graph.source("P0001-N01").row.text, "mutated");
  assert.equal(graph.source("invented"), null);
});

test("a what-if changes only an isolated graph, recomputes primary ownership and preserves original cohort", () => {
  const patient = graph
    .query({ barriers: ["cost", "transportation"], barrierMode: "all" })
    .patients.find((item) => item.primaryBarrier === "cost");
  assert.ok(patient);
  const filters = { ...defaultFilters, barriers: ["cost"] };
  const original = graph.query(filters);
  const scenario = graph.whatIf({
    patientId: patient.id,
    barrier: "cost",
    filters,
  });
  assert.equal(scenario.before.count, original.count);
  assert.equal(scenario.after.count, original.count - 1);
  assert.equal(scenario.after.primaryBarrier, "transportation");
  assert.equal(scenario.persisted, false);
  assert.equal(graph.query(filters).fingerprint, original.fingerprint);
  assert.equal(graph.getPatient(patient.id).primary_barrier, "cost");
  assert.throws(() =>
    graph.whatIf({ patientId: patient.id, barrier: "invented" }),
  );
});

test("dated patient views withhold future observations and reject invalid dates", () => {
  const graphAtDischarge = graph.patientGraph("P0001", { asOf: "2026-09-26" });
  assert.equal(graphAtDischarge.patient.followUpGap.open, false);
  assert.ok(
    graphAtDischarge.patient.notes.every((note) => note.date <= "2026-09-26"),
  );
  assert.equal(graphAtDischarge.patient.appointments[0].status, "scheduled");
  assert.equal(graph.getPatient("P0001").followUpGap.open, true);
  assert.throws(() => graph.patientGraph("P0001", { asOf: "2026-02-31" }));
  assert.throws(() => graph.patientGraph("P0001", { asOf: "2099-01-01" }));
});

test("filter validation rejects contradictory, misspelled, unbounded and injected inputs", () => {
  for (const input of [
    null,
    [],
    { sql: "DROP TABLE patients" },
    { ageMin: 70, ageMax: 20 },
    { ageMin: "65" },
    { gapOnly: "false" },
    { barrierPresence: "absent", barriers: ["cost"] },
    { barriers: ["invented"] },
    { unit: "unknown" },
  ]) {
    assert.throws(() => graph.query(input));
  }
  assert.throws(() => graph.query({}, { limit: 1000 }));
  assert.deepEqual(validateFilters({}), { ...defaultFilters, barriers: [] });
});
