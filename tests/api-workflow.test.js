import test from "node:test";
import assert from "node:assert/strict";
import { createArchivedAppServer as createAppServer } from "../backend/archive-server.js";
test("hospital HTTP workflow persists exact cohorts, evidence changes, review versions and audit", async (t) => {
  const server = createAppServer({ filename: ":memory:", apiKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, method = "GET", body) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  const boot = await api("/api/bootstrap");
  assert.equal(boot.data.patients.length, 1000);
  assert.equal(boot.data.metrics.notes, 600);
  const question =
    "Find discharged patients with follow-up gaps and transportation barriers";
  const first = await api("/api/agent", "POST", { question });
  assert.equal(first.data.ok, true);
  assert.ok(first.data.events.some((e) => e.tool === "get_evidence"));
  const task = await api("/api/tasks", "POST", {
    patientId: "P0412",
    barrier: "transportation",
  });
  assert.equal(task.status, 201);
  const note = await api("/api/patients/P0412/documents", "POST", {
    synthetic: true,
    text: "Transport arranged by SW prior to discharge.",
    date: "2026-10-10",
    note_type: "Post-discharge nurse call note",
  });
  assert.equal(note.status, 201);
  assert.equal((await api("/api/tasks")).data.tasks[0].status, "needs_review");
  assert.equal(
    (await api("/api/query", "POST", { question })).data.result.count,
    first.data.result.count - 1,
  );
  assert.equal(
    (await api("/api/runs/" + first.data.runId)).data.result.count,
    first.data.result.count,
  );
  assert.ok(
    (await api("/api/audit")).data.events.some(
      (e) => e.action === "document.ingested",
    ),
  );
  const search = await api("/api/search", "POST", { question });
  assert.ok(search.data.passages.length);
  assert.equal("count" in search.data, false);
});

