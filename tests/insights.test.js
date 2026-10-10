import test from "node:test";
import assert from "node:assert/strict";
import {
  getSimulationDefaults,
  simulateResources,
  simulateFromRepository,
  validateScenario,
} from "../backend/insights.js";
import { createSqliteRepository } from "../backend/sqlite.js";
import { patients } from "../dist/engine.js";
test("both planning strategies obey exact budgets, contacts, capacity and verified evidence", () => {
  const scenario = {
    budget: 100.01,
    contactCapacity: 7,
    capacities: { transportation: 2, cost: 3, food: 4, health_literacy: 1 },
    costs: {
      transportation: 10.01,
      cost: 10.02,
      food: 10.03,
      health_literacy: 7.05,
    },
  };
  const result = simulateResources({ patients, scenario });
  assert.equal(result.patients.total, 1000);
  for (const p of [result.optimized, result.baseline]) {
    assert.ok(p.patientsReached <= 7);
    assert.ok(p.budgetUsed <= 100.01);
    assert.equal(
      new Set(p.allocations.map((a) => a.patientId)).size,
      p.allocations.length,
    );
    for (const [type, used] of Object.entries(p.capacityUsed))
      assert.ok(used <= scenario.capacities[type]);
    for (const a of p.allocations)
      assert.ok(
        a.evidence.every((e) => {
          const source = patients.find((p) => p.id === a.patientId);
          return [...source.notes, ...source.socialNeeds].some(
            (n) =>
              n.id === e.documentId && (n.text || n.display).includes(e.quote),
          );
        }),
      );
  }
  assert.equal(result.hypothetical, true);
  assert.match(result.assumptions.join(" "), /not guaranteed optimal/);
});
test("simulation repeatability is independent of input order and rejects unsupported parameters", () => {
  const a = simulateResources({ patients }),
    b = simulateResources({ patients: [...patients].reverse() });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(a.optimized, b.optimized);
  for (const scenario of [
    { budget: -1 },
    { contactCapacity: 1001 },
    { costs: { unknown: 10 } },
    { patientIds: ["invalid"] },
  ])
    assert.throws(() => validateScenario(scenario));
  assert.ok(getSimulationDefaults().contactCapacity > 0);
});
test("simulation reads persisted updates and cannot substitute stale original evidence", async (t) => {
  const repo = await createSqliteRepository({ filename: ":memory:" });
  t.after(() => repo.close());
  await repo.seed();
  const before = await simulateFromRepository(repo, { patientIds: ["P0412"] });
  await repo.addDocument("P0412", {
    synthetic: true,
    date: "2026-10-10",
    text: "Transport arranged by SW prior to discharge.",
    note_type: "Post-discharge nurse call note",
  });
  const after = await simulateFromRepository(repo, { patientIds: ["P0412"] });
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.ok(
    after.optimized.allocations.every(
      (a) => !a.addressedBarriers.includes("transportation"),
    ),
  );
});
test("unverified source quotations never allocate a hospital resource", () => {
  const copy = structuredClone(patients.find((p) => p.id === "P0412"));
  for (const barrier of copy.barriers)
    barrier.quote = "not present in any authoritative source";
  const result = simulateResources({ patients: [copy] });
  assert.equal(result.optimized.totalActions, 0);
  assert.ok(result.patients.unverifiedActionsExcluded > 0);
});
