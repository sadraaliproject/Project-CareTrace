import test from "node:test";
import assert from "node:assert/strict";
import { createSqliteRepository } from "../backend/sqlite.js";
import { runProof, getExtractionMetrics } from "../backend/proof.js";
test("hospital proof executes three equal SQL counts and verifies authoritative source ownership", async (t) => {
  const r = await createSqliteRepository({ filename: ":memory:" });
  t.after(() => r.close());
  await r.seed();
  const proof = await runProof(r);
  assert.equal(proof.repeatability.counts.length, 3);
  assert.equal(proof.repeatability.passed, true);
  assert.equal(proof.evidenceCoverage.passed, true);
  assert.ok(proof.evidenceCoverage.total > 0);
  assert.equal(proof.summary.passed, proof.summary.total);
  const metrics = getExtractionMetrics();
  assert.equal(metrics.total, 600);
  assert.equal(metrics.hardCases.passed, metrics.hardCases.total);
  assert.ok(metrics.precision >= 0 && metrics.precision <= 1);
});
test("custom proof runs extraction but never assigns a fabricated expected answer", async (t) => {
  const r = await createSqliteRepository({ filename: ":memory:" });
  t.after(() => r.close());
  await r.seed();
  const result = await runProof(r, {
    text: "NPO after midnight, meals held for procedure.",
  });
  assert.deepEqual(result.custom.assertions, []);
  assert.equal(result.custom.persisted, false);
  assert.equal("passed" in result.custom, false);
});
