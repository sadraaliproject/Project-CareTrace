import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../backend/api.js";
import { requestAccess } from "../backend/access.js";
import { createSqliteRepository } from "../backend/sqlite.js";

const staffHeaders = {
  "oai-authenticated-user-id": "verified-test-id",
  "oai-authenticated-user-email": "owner@careweave.test",
};
const request = (
  path,
  body,
  headers = {},
  method = body === undefined ? "GET" : "POST",
) =>
  new Request("https://careweave.test" + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("hosted access needs both verified identity fields and explicit staff allowlist", () => {
  const settings = {
    staffEmails: " OWNER@careweave.test,staff@careweave.test ",
  };
  assert.equal(requestAccess(request("/"), settings, "d1").canWrite, false);
  assert.equal(
    requestAccess(request("/", undefined, staffHeaders), {}, "d1").canWrite,
    false,
  );
  assert.equal(
    requestAccess(
      request("/", undefined, {
        "oai-authenticated-user-email": "owner@careweave.test",
      }),
      settings,
      "d1",
    ).canWrite,
    false,
  );
  assert.equal(
    requestAccess(
      request("/", undefined, {
        ...staffHeaders,
        "oai-authenticated-user-email": "visitor@careweave.test",
      }),
      settings,
      "d1",
    ).canWrite,
    false,
  );
  assert.equal(
    requestAccess(request("/", undefined, staffHeaders), settings, "d1")
      .canWrite,
    true,
  );
  assert.equal(requestAccess(request("/"), settings, "sqlite").mode, "local");
});

test("public writes and paid calls are denied before database or external service access", async () => {
  let touched = false;
  const api = createApi({
    storage: "d1",
    getRepository: async () => {
      touched = true;
      throw Error("Unexpected database access");
    },
    config: () => ({
      staffEmails: "owner@careweave.test",
      apiKey: "test-secret",
      geminiApiKey: "gemini-test-secret",
    }),
  });
  for (const [path, method] of [
    ["/api/seed", "POST"],
    ["/api/tasks", "POST"],
    ["/api/tasks/t1", "PATCH"],
    ["/api/tasks/t1", "DELETE"],
    ["/api/patients/P0412/documents", "POST"],
    ["/api/plan", "POST"],
  ]) {
    const result = await api(request(path, {}, {}, method));
    assert.equal(result.status, 403, path);
  }
  const status = await (await api(request("/api/status"))).json();
  assert.equal(status.access.canUsePaidAI, false);
  assert.equal(status.model, false);
  assert.equal(status.integrations.gemini.configured, true);
  assert.ok(!JSON.stringify(status).includes("test-secret"));
  assert.equal(touched, false);
});

test("visitor analysis and bilingual handoff work without changing shared state", async () => {
  const repo = await createSqliteRepository({ filename: ":memory:" });
  try {
    await repo.seed();
    const api = createApi({
      storage: "d1",
      getRepository: async () => repo,
      config: () => ({ staffEmails: "owner@careweave.test" }),
    });
    const before = await repo.listRuns();
    for (const path of ["/api/query", "/api/agent"]) {
      const result = await (
        await api(
          request(path, {
            question:
              "Which patients report a cost barrier and never picked up their discharge insulin?",
          }),
        )
      ).json();
      assert.equal(result.ok, true);
      assert.equal(result.result.count, 13);
      assert.equal(result.runId, null);
    }
    assert.deepEqual(await repo.listRuns(), before);
    const brief = await (
      await api(
        request("/api/care-brief", { patientId: "P0412", language: "es" }),
      )
    ).json();
    assert.equal(brief.engine, "local-template");
    assert.equal(brief.language, "es");
    assert.ok(brief.evidence.length > 0);
    for (const path of ["/api/care-brief", "/api/care-audio"]) {
      const denied = await api(
        request(path, { patientId: "P0412", useGemini: true }),
      );
      assert.equal(denied.status, 403);
    }
    assert.deepEqual(await repo.listRuns(), before);
    const allowed = await api(
      request(
        "/api/tasks",
        { patientId: "P0412", barrier: "transportation" },
        staffHeaders,
      ),
    );
    assert.equal(allowed.status, 201);
    const crossOrigin = await api(
      request(
        "/api/tasks",
        { patientId: "P0412", barrier: "transportation" },
        { ...staffHeaders, origin: "https://unrelated.test" },
      ),
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    repo.close();
  }
});

test("an evidence change during speech generation prevents delivery of outdated audio", async () => {
  const repo = await createSqliteRepository({ filename: ":memory:" });
  try {
    await repo.seed();
    let speechCalls = 0;
    const api = createApi({
      storage: "d1",
      getRepository: async () => repo,
      config: () => ({
        staffEmails: "owner@careweave.test",
        elevenLabsApiKey: "test-secret",
        elevenLabsVoiceId: "test-voice",
        fetchImpl: async () => {
          speechCalls++;
          await repo.addDocument("P0412", {
            text: "Patient no longer needs transportation help and now has reliable rides.",
            note_type: "Post-discharge nurse call note",
            date: "2026-10-10",
            synthetic: true,
          });
          return new Response(new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0]), {
            headers: { "Content-Type": "audio/mpeg" },
          });
        },
      }),
    });
    const brief = await (
      await api(
        request(
          "/api/care-brief",
          { patientId: "P0412", language: "en" },
          staffHeaders,
        ),
      )
    ).json();
    const result = await api(
      request(
        "/api/care-audio",
        {
          patientId: brief.patientId,
          language: brief.language,
          revision: brief.revision,
          planIds: brief.planIds,
          reviewed: true,
        },
        staffHeaders,
      ),
    );
    assert.equal(result.status, 409);
    assert.match((await result.json()).error, /changed while audio/);
    assert.equal(speechCalls, 1);
  } finally {
    repo.close();
  }
});
