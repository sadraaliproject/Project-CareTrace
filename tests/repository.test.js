import test from "node:test";
import assert from "node:assert/strict";
import { createSqliteRepository } from "../backend/sqlite.js";
import { defaultPlan, validatePlan } from "../planner.js";
import { patients, runQuery, ontology } from "../dist/engine.js";
async function repository(t) {
  const r = await createSqliteRepository({ filename: ":memory:" });
  t.after(() => r.close());
  await r.seed();
  return r;
}
test("hospital SQL counts agree with independent in-memory filtering across supported dimensions", async (t) => {
  const r = await repository(t);
  for (const patch of [
    {},
    { barrierPresence: "absent" },
    { barrierPresence: "any" },
    { barriers: ["cost"] },
    { barriers: ["cost", "transportation"], barrierMode: "all" },
    { likelyToReturn: true },
    { insulinNotPickedUp: true },
    { within30: true },
    { ageMin: 66 },
    { gapOnly: false, diabetesAdmissionOnly: false, barrierPresence: "any" },
  ]) {
    const plan = { ...defaultPlan(), ...patch };
    const actual = await r.query(plan);
    assert.equal(actual.count, runQuery(plan, patients).count);
    assert.match(actual.sql.text, /SELECT p.json FROM patients/);
  }
});
test("seed is idempotent and graph relationships obey the declared ontology", async (t) => {
  const r = await repository(t);
  const before = await r.metrics();
  await r.seedPatientBatch({ offset: 0, limit: 25 });
  assert.deepEqual(await r.metrics(), before);
  assert.equal(before.discharges, 1000);
  assert.equal(before.notes, 600);
  const graph = await r.getGraph({ patientId: "P0412" });
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  for (const e of graph.edges)
    assert.ok(
      ontology.paths.some(
        ([s, r, t]) =>
          types.get(e.source) === s &&
          e.type === r &&
          types.get(e.target) === t,
      ),
    );
  const expanded = await r.expandNode(
    "barrier:transportation",
    "REPORTED_BARRIER",
  );
  assert.ok(expanded.nodes.length <= 50);
});
test("tasks require current verified sources and use optimistic versions", async (t) => {
  const r = await repository(t),
    task = await r.createTask({
      patientId: "P0412",
      barrier: "transportation",
    });
  assert.equal(task.status, "pending");
  await assert.rejects(
    () => r.createTask({ patientId: "P0412", barrier: "transportation" }),
    (e) => e.status === 409,
  );
  const approved = await r.updateTask(task.id, {
    version: task.version,
    status: "approved",
  });
  assert.equal(approved.status, "approved");
  await assert.rejects(
    () => r.updateTask(task.id, { version: task.version, status: "completed" }),
    (e) => e.status === 409,
  );
  await r.addDocument("P0412", {
    synthetic: true,
    text: "Transport arranged by SW prior to discharge.",
    date: "2026-10-10",
    note_type: "Post-discharge nurse call note",
  });
  assert.equal((await r.getTask(task.id)).status, "needs_review");
  await assert.rejects(
    () => r.updateTask(task.id, { version: 3, status: "approved" }),
    (e) => e.status === 409,
  );
});
test("standard hospital call requires an open gap and no documented barrier", async (t) => {
  const r = await repository(t);
  const p = patients.find((p) => p.followUpGap.open && !p.barriers.length);
  const task = await r.createTask({ patientId: p.id, barrier: "standard" });
  assert.equal(task.evidence.owner, "Care transitions nurse");
  assert.equal(task.sent, false);
  await assert.rejects(
    () => r.createTask({ patientId: "P0412", barrier: "standard" }),
    (e) => e.status === 409,
  );
});
test("invalid notes and arbitrary plans cannot mutate or query", async (t) => {
  const r = await repository(t);
  await assert.rejects(
    () => r.addDocument("P0412", { text: "hello" }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    () =>
      r.addDocument("P0412", {
        synthetic: true,
        text: "hello",
        date: "2027-01-01",
      }),
    (e) => e.status === 400,
  );
  assert.equal(
    validatePlan({ ...defaultPlan(), sql: "drop table patients" }),
    false,
  );
  await assert.rejects(() =>
    r.query({ ...defaultPlan(), barriers: ["unknown"] }),
  );
});
test("note search returns passages without an implied exact patient count", async (t) => {
  const r = await repository(t),
    result = await r.searchNotes("Find insulin transportation problems");
  assert.ok(result.passages.length > 0);
  assert.ok(
    result.passages.every((p) => p.documentId && p.note_type && p.text),
  );
  assert.equal("count" in result, false);
});
