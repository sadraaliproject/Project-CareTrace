// Exercise the exact bundled Worker with the documented free-tier D1 bounds.
// This cannot prove a remote deployment is healthy, but catches SQL patterns
// that permissive SQLite-only mocks hide.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import worker from "../dist/server/index.js";
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
db.exec(await readFile("backend/schema.sql", "utf8"));
const LIMITS = {
  queries: 50,
  parameters: 100,
  sqlBytes: 100000,
  valueBytes: 2000000,
};
const encoder = new TextEncoder();
const observed = [];
let requestState = null,
  injectFailureAt = null;
const guard = (sql, params) => {
  assert.ok(requestState, "Every statement must belong to an HTTP request.");
  requestState.queries++;
  if (requestState.queries > LIMITS.queries)
    throw new Error(
      `D1 query limit exceeded: ${requestState.queries} > ${LIMITS.queries} statements in ${requestState.path}`,
    );
  if (injectFailureAt === requestState.queries)
    throw new Error("Injected database failure to verify atomic rollback.");
  if (params.length > LIMITS.parameters)
    throw new Error(
      `D1 bound parameter limit exceeded: ${params.length} > ${LIMITS.parameters}`,
    );
  if (encoder.encode(sql).byteLength > LIMITS.sqlBytes)
    throw new Error("D1 SQL statement exceeds 100 KB.");
  for (const parameter of params)
    if (
      typeof parameter === "string" &&
      encoder.encode(parameter).byteLength > LIMITS.valueBytes
    )
      throw new Error("D1 bound string exceeds 2 MB.");
};
function prepared(sql, params = []) {
  const execute = (fn) => {
    try {
      guard(sql, params);
      return fn(db.prepare(sql));
    } catch (error) {
      requestState.errors.push(error.message);
      throw error;
    }
  };
  return {
    bind: (...values) => prepared(sql, values),
    all: async () =>
      execute((statement) => ({
        success: true,
        results: statement.all(...params),
      })),
    first: async (column) =>
      execute((statement) => {
        const row = statement.get(...params);
        return column ? (row?.[column] ?? null) : row || null;
      }),
    run: async () =>
      execute((statement) => ({
        success: true,
        meta: statement.run(...params),
      })),
  };
}
const DB = {
  prepare: (sql) => prepared(sql),
  async batch(statements) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
};
async function request(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
  staff = true,
) {
  requestState = { path, method, queries: 0, errors: [] };
  const response = await worker.fetch(
    new Request("https://careweave.test" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(staff
          ? {
              "oai-authenticated-user-id": "staff-test",
              "oai-authenticated-user-email": "staff@careweave.test",
            }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB, CAREWEAVE_STAFF_EMAILS: "staff@careweave.test" },
  );
  observed.push(requestState);
  return response;
}
async function jsonRequest(path, body, method) {
  const response = await request(path, body, method),
    payload = await response.json();
  assert.ok(
    response.ok,
    `${path} returned ${response.status}: ${payload.error || ""}; database: ${requestState.errors.join("; ")}`,
  );
  return payload;
}
const counts = () =>
  Object.fromEntries(
    [
      "patients",
      "admissions",
      "conditions",
      "lab_results",
      "medications",
      "pharmacy_pickups",
      "appointments",
      "emergency_department_visits",
      "social_needs",
      "notes",
      "assertions",
      "graph_nodes",
      "graph_edges",
      "tasks",
      "runs",
    ].map((table) => [
      table,
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]),
  );
const question =
  "Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?";
try {
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Careweave/);
  const library = await request("/vendor/cytoscape.min.js");
  assert.equal(library.status, 200);
  // Failure part-way through the seed write must not create half a patient graph.
  const emptyCounts = counts();
  injectFailureAt = 5;
  const failedSeed = await request("/api/seed", { offset: 0 });
  assert.equal(
    failedSeed.status,
    500,
    "Injected seed failure should be reported.",
  );
  assert.ok(
    requestState.errors.some((message) =>
      message.includes("Injected database failure"),
    ),
  );
  assert.deepEqual(
    counts(),
    emptyCounts,
    "Seed write must roll back all related rows on failure.",
  );
  injectFailureAt = null;
  let seed = await jsonRequest("/api/seed");
  let attempts = 0;
  while (!seed.complete) {
    assert.ok(
      ++attempts <= 110,
      "Seed must progress instead of entering an infinite retry loop.",
    );
    const before = seed.count;
    seed = await jsonRequest("/api/seed", {
      offset: seed.nextOffset ?? seed.count,
    });
    assert.ok(
      seed.count > before,
      "Every normal seed batch must advance the persisted count.",
    );
  }
  assert.equal(seed.count, 1000);
  const fullCounts = counts();
  assert.equal(fullCounts.admissions, 1000);
  assert.ok(fullCounts.notes >= 450 && fullCounts.notes <= 750);
  // An already completed first/last batch may be retried after a lost response.
  for (const offset of [0, 990, 1000]) {
    const retry = await jsonRequest("/api/seed", { offset });
    assert.equal(retry.count, 1000);
    assert.equal(retry.complete, true);
    assert.deepEqual(
      counts(),
      fullCounts,
      "Idempotent seed retries must not duplicate records.",
    );
  }
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const result = await jsonRequest("/api/agent", { question });
  assert.equal(result.ok, true);
  const originalCount = result.result.count;
  assert.ok(originalCount > 0);
  assert.ok(result.result.patients.some((patient) => patient.id === "P0412"));
  for (const followUp of [
    "Which patients report a cost barrier and never picked up their discharge insulin?",
    "Who is likely to return?",
  ]) {
    const alternate = await jsonRequest("/api/agent", { question: followUp });
    assert.equal(alternate.ok, true, followUp);
    assert.ok(alternate.result.count > 0, followUp);
  }
  const graph = await jsonRequest("/api/graph?mode=patient&patientId=P0412");
  assert.ok(graph.nodes.length > 9 && graph.nodes.length <= 50);
  assert.ok(graph.edges.some((edge) => edge.type === "LIKELY_TO_RETURN"));
  const hospitalGraph = await jsonRequest(
    "/api/graph?mode=discharges&limit=50",
  );
  assert.ok(hospitalGraph.nodes.length <= 50);
  const bootstrap = await jsonRequest("/api/bootstrap");
  assert.equal(bootstrap.patients.length, 1000);
  assert.equal(bootstrap.access.canWrite, true);
  const visitorState = counts();
  assert.equal(
    (
      await request(
        "/api/tasks",
        { patientId: "P0412", barrier: "transportation" },
        "POST",
        false,
      )
    ).status,
    403,
  );
  const visitorAnswer = await (
    await request("/api/agent", { question }, "POST", false)
  ).json();
  assert.equal(visitorAnswer.result.count, originalCount);
  assert.equal(visitorAnswer.runId, null);
  assert.deepEqual(
    counts(),
    visitorState,
    "Visitor investigation must not write shared history or tasks.",
  );
  const handoff = await jsonRequest("/api/care-brief", {
    patientId: "P0412",
    language: "en",
  });
  assert.equal(handoff.engine, "local-template");
  assert.ok(handoff.evidence.length > 0 && handoff.transcript.length > 0);
  const baseline = await jsonRequest("/api/search", { question });
  assert.equal(
    Object.hasOwn(baseline, "count"),
    false,
    "Note retrieval must not pretend to provide a joined patient count.",
  );
  const beforePlanning = counts();
  const defaults = await jsonRequest("/api/simulate/defaults");
  const simulated = await jsonRequest("/api/simulate", {
    ...defaults,
    budget: 350,
  });
  assert.equal(simulated.patients.total, 1000);
  assert.ok(simulated.optimized.allBarriersAddressed > 0);
  assert.ok(simulated.optimized.budgetUsed <= 350);
  assert.equal(simulated.hypothetical, true);
  for (const id of simulated.graphOverlay.nodes)
    assert.ok(
      db.prepare("SELECT id FROM graph_nodes WHERE id=?").get(id),
      `Simulation node ${id} exists`,
    );
  for (const id of simulated.graphOverlay.edges)
    assert.ok(
      db.prepare("SELECT id FROM graph_edges WHERE id=?").get(id),
      `Simulation edge ${id} exists`,
    );
  const proof = await jsonRequest("/api/proof", {});
  assert.ok(proof.summary.total >= 5);
  assert.equal(proof.summary.passed, proof.summary.total);
  assert.equal(proof.repeatability.passed, true);
  assert.equal(proof.repeatability.count, originalCount);
  assert.equal(proof.evidenceCoverage.passed, true);
  assert.equal(proof.evidenceCoverage.verified, proof.evidenceCoverage.total);
  assert.equal(proof.repeatability.counts.length, 3);
  assert.deepEqual(
    counts(),
    beforePlanning,
    "Proof and resource simulation must not change persistent state.",
  );
  const task = await jsonRequest("/api/tasks", {
    patientId: "P0412",
    barrier: "transportation",
  });
  const approved = await jsonRequest(
    `/api/tasks/${task.id}`,
    { version: task.version, status: "approved" },
    "PATCH",
  );
  assert.equal(approved.sent, false);
  await jsonRequest("/api/patients/P0412/documents", {
    text: "Patient no longer needs transportation help and now has reliable rides.",
    note_type: "Post-discharge nurse call note",
    date: "2026-10-10",
    synthetic: true,
  });
  const after = await jsonRequest("/api/query", { question });
  assert.equal(after.result.count, originalCount - 1);
  const tasks = await jsonRequest("/api/tasks");
  assert.equal(
    tasks.tasks.find((item) => item.id === task.id).status,
    "needs_review",
  );
  const afterProof = await jsonRequest("/api/proof", {});
  assert.equal(afterProof.repeatability.count, originalCount - 1);
  assert.equal(
    afterProof.evidenceCoverage.verified,
    afterProof.evidenceCoverage.total,
  );
  const afterSimulation = await jsonRequest("/api/simulate", {
    patientIds: ["P0412"],
    barriers: ["transportation"],
  });
  assert.equal(afterSimulation.optimized.patientsReached, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const metrics = await jsonRequest("/api/ml/metrics");
  assert.ok(metrics.testSize > 0);
  assert.equal(metrics.extraction.total, 600);
  assert.ok(Number.isFinite(metrics.extraction.precision));
  assert.ok(Number.isFinite(metrics.extraction.recall));
  assert.equal((await request("/.env")).status, 404);
  assert.equal((await request("/ml/hospital-ground-truth.json")).status, 404);
  assert.equal((await request("/hospital-ground-truth.json")).status, 404);
  const successful = observed.filter((item) => !item.errors.length),
    maxQueries = Math.max(...successful.map((item) => item.queries));
  const seedMax = Math.max(
    ...successful
      .filter((item) => item.path === "/api/seed")
      .map((item) => item.queries),
  );
  assert.ok(maxQueries <= LIMITS.queries);
  console.log(
    `Bundled Worker verified: foreign keys ON; 50-statement D1 invocation limit; 100-parameter SQL limit; atomic/idempotent 1,000-patient hospital seed; cohort ${originalCount} → ${originalCount - 1}; task invalidation; live proof and simulation; source isolation. Maximum statements/request: ${maxQueries}; seed: ${seedMax}.`,
  );
} finally {
  db.close();
}
