import test from "node:test";
import assert from "node:assert/strict";
import { createLiveApi } from "../backend/live-api.js";
import { createLiveGraph } from "../backend/live-graph.js";
import { createSqliteLiveStore } from "../backend/live-sqlite.js";
import { LIVE_LIMITS } from "../backend/live-store.js";

const graph = createLiveGraph();
const base = "http://localhost:4173";
async function setup(options = {}) {
  const store = await createSqliteLiveStore({
    filename: ":memory:",
    limits: { ...LIVE_LIMITS, ...options.limits },
  });
  const api = createLiveApi({ graph, store, ...options });
  const request = (
    path,
    { method = "GET", body, cookie, origin = base, headers = {}, signal } = {},
  ) =>
    api(
      new Request(`${base}/api/v1${path}`, {
        method,
        headers: {
          ...(method !== "GET"
            ? { "content-type": "application/json", origin }
            : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body !== undefined
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
        signal,
      }),
    );
  const status = await request("/status");
  const cookie = status.headers.get("set-cookie").split(";")[0];
  return { store, api, request, cookie, status };
}
const parseEvents = (text) =>
  text
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({
      event: block.match(/^event: (.+)$/m)?.[1],
      data: JSON.parse(block.match(/^data: (.+)$/m)[1]),
    }));

test("status is honest without a key and public synthetic graph sources have server counts", async () => {
  const context = await setup();
  try {
    const status = await context.status.json();
    assert.equal(status.mode, "rules");
    assert.equal(status.aiConfigured, false);
    assert.deepEqual(status.storage, { kind: "sqlite", persistent: true });
    assert.match(
      context.status.headers.get("set-cookie"),
      /HttpOnly; SameSite=Strict/,
    );
    const overview = await (
      await context.request("/overview", { cookie: context.cookie })
    ).json();
    assert.equal(overview.discharges, 1000);
    assert.equal(overview.barrier, 26);
    const source = await (
      await context.request("/sources/P0001-N01", { cookie: context.cookie })
    ).json();
    assert.equal(source.patientId, "P0001");
    assert.match(source.text, /no reliable ride/);
    const detail = await (
      await context.request("/patients/P0001?asOf=2026-09-26", {
        cookie: context.cookie,
      })
    ).json();
    assert.equal(detail.patient.daysSinceDischarge, 0);
    assert.equal(
      detail.graph.edges.some((edge) => edge.type === "HAS_GAP"),
      false,
    );
    assert.equal(
      (await context.request("/patients/P0001?asOf=2026-02-31")).status,
      400,
    );
    assert.equal((await context.request("/patients/P9999")).status, 404);
    assert.equal(await context.api(new Request(`${base}/health`)), null);
  } finally {
    context.store.close();
  }
});

test("a real rules investigation streams execution, persists the answer, and isolates sessions", async () => {
  const context = await setup();
  try {
    const response = await context.request("/investigate", {
      method: "POST",
      cookie: context.cookie,
      body: {
        question: "Find patients with transportation barriers",
        mode: "rules",
      },
    });
    assert.equal(
      response.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    const events = parseEvents(await response.text());
    assert.ok(events.some((item) => item.event === "step"));
    const saved = events.find((item) => item.event === "result")?.data;
    assert.ok(saved?.runId, JSON.stringify(events));
    assert.equal(saved.mode, "rules");
    assert.equal(saved.result.count, 9);
    assert.equal(saved.datasetVersion, "2026-10-10.hospital-demo");
    const loaded = await (
      await context.request(`/runs/${saved.runId}`, { cookie: context.cookie })
    ).json();
    assert.equal(loaded.result.fingerprint, saved.result.fingerprint);
    assert.equal(
      (
        await (
          await context.request("/runs", { cookie: context.cookie })
        ).json()
      ).runs.length,
      1,
    );
    assert.equal((await context.request(`/runs/${saved.runId}`)).status, 404);
  } finally {
    context.store.close();
  }
});

test("tasks retain citations, are idempotent, require approval, and cannot cross sessions", async () => {
  const context = await setup();
  try {
    const input = { patientId: "P0001", barrier: "transportation" };
    const firstResponse = await context.request("/tasks", {
      method: "POST",
      cookie: context.cookie,
      body: input,
    });
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.task.demoOnly, true);
    assert.equal(first.task.status, "draft");
    const citation = first.task.evidence[0];
    const source = graph.source(citation.sourceId);
    assert.equal(source.text.slice(...citation.charSpan), citation.quote);
    const repeated = await (
      await context.request("/tasks", {
        method: "POST",
        cookie: context.cookie,
        body: input,
      })
    ).json();
    assert.equal(repeated.task.id, first.task.id);
    assert.equal(repeated.created, false);
    assert.equal(
      (
        await context.request(`/tasks/${first.task.id}`, {
          method: "PATCH",
          cookie: context.cookie,
          body: { status: "completed" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await context.request(`/tasks/${first.task.id}`, {
          method: "PATCH",
          body: { status: "approved" },
        })
      ).status,
      404,
    );
    const approved = await (
      await context.request(`/tasks/${first.task.id}`, {
        method: "PATCH",
        cookie: context.cookie,
        body: { status: "approved" },
      })
    ).json();
    assert.equal(approved.task.status, "approved");
    const completed = await (
      await context.request(`/tasks/${first.task.id}`, {
        method: "PATCH",
        cookie: context.cookie,
        body: { status: "completed" },
      })
    ).json();
    assert.equal(completed.task.status, "completed");
    assert.equal(
      (
        await (
          await context.request("/tasks", { cookie: context.cookie })
        ).json()
      ).tasks.length,
      1,
    );
    assert.equal(
      (
        await context.request("/tasks", {
          method: "POST",
          cookie: context.cookie,
          body: { patientId: "P0001", barrier: "food" },
        })
      ).status,
      409,
    );
  } finally {
    context.store.close();
  }
});

test("simulation is isolated from saved tasks and the authoritative graph", async () => {
  const context = await setup();
  try {
    const before = graph.query();
    const response = await context.request("/what-if", {
      method: "POST",
      cookie: context.cookie,
      body: { patientId: "P0001", barrier: "transportation" },
    });
    const simulation = await response.json();
    assert.equal(simulation.simulated, true);
    assert.equal(simulation.persisted, false);
    assert.equal(simulation.after.count, simulation.before.count - 1);
    assert.equal(graph.query().fingerprint, before.fingerprint);
    assert.equal(
      (
        await (
          await context.request("/tasks", { cookie: context.cookie })
        ).json()
      ).tasks.length,
      0,
    );
  } finally {
    context.store.close();
  }
});

test("API rejects cross-origin mutations, malformed and oversized input, and unknown fields", async () => {
  const context = await setup();
  try {
    const basic = {
      method: "POST",
      cookie: context.cookie,
      body: { question: "Find transportation barriers" },
    };
    assert.equal(
      (
        await context.request("/investigate", {
          ...basic,
          origin: "https://other.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await context.request("/investigate", {
          ...basic,
          headers: { "sec-fetch-site": "cross-site" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await context.request("/investigate", {
          ...basic,
          headers: { "content-type": "text/plain" },
        })
      ).status,
      415,
    );
    assert.equal(
      (await context.request("/investigate", { ...basic, body: "{" })).status,
      400,
    );
    assert.equal(
      (
        await context.request("/investigate", {
          ...basic,
          body: { question: "x", sql: "SELECT 1" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await context.request("/investigate", {
          ...basic,
          body: { question: "" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await context.request("/investigate", {
          ...basic,
          body: { question: "x", previousFilters: [] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await context.request("/investigate", {
          ...basic,
          body: "x".repeat(8193),
        })
      ).status,
      413,
    );
  } finally {
    context.store.close();
  }
});

test("model mode is explicit, rules mode bypasses credentials, and request budgets persist", async () => {
  const seen = [];
  const context = await setup({
    limits: { investigationsPerHour: 2 },
    config: () => ({ apiKey: "unit-test-secret", model: "test-model" }),
    agent: async ({ apiKey, onEvent }) => {
      seen.push(apiKey);
      onEvent({ type: "query", message: "Executed a test query" });
      return {
        ok: true,
        mode: apiKey ? "openai" : "rules",
        result: { count: 0 },
        answer: "No matches.",
      };
    },
  });
  try {
    const status = await context.status.json();
    assert.equal(status.aiConfigured, true);
    assert.equal(JSON.stringify(status).includes("unit-test-secret"), false);
    for (const mode of ["auto", "rules"]) {
      const response = await context.request("/investigate", {
        method: "POST",
        cookie: context.cookie,
        body: { question: "Find barriers", mode },
      });
      assert.ok(
        parseEvents(await response.text()).find(
          (item) => item.event === "result",
        ),
      );
    }
    assert.deepEqual(seen, ["unit-test-secret", null]);
    assert.equal(
      (
        await context.request("/investigate", {
          method: "POST",
          cookie: context.cookie,
          body: { question: "Find barriers" },
        })
      ).status,
      429,
    );
  } finally {
    context.store.close();
  }
});

test("failed and timed-out calls close the stream without reporting a saved success", async () => {
  for (const timeout of [false, true]) {
    let aborted = false;
    const context = await setup({
      limits: { runTimeoutMs: 20 },
      agent: async ({ signal }) => {
        if (!timeout)
          throw new Error(
            "Sensitive remote response that must not be reflected",
          );
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
    });
    try {
      const response = await context.request("/investigate", {
        method: "POST",
        cookie: context.cookie,
        body: { question: "Find barriers" },
      });
      const text = await response.text();
      const events = parseEvents(text);
      assert.equal(events.at(-1).event, "error");
      assert.equal(
        events.some((event) => event.event === "result"),
        false,
      );
      assert.equal(text.includes("Sensitive remote"), false);
      assert.equal(
        (
          await (
            await context.request("/runs", { cookie: context.cookie })
          ).json()
        ).runs.length,
        0,
      );
      if (timeout) assert.equal(aborted, true);
    } finally {
      context.store.close();
    }
  }
});

test("a disconnected stream aborts the model call and never saves a partial result", async () => {
  let abortObserved = false;
  const context = await setup({
    agent: async ({ signal, onEvent }) => {
      onEvent({ type: "start", message: "Starting" });
      return new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            abortObserved = true;
            resolve({ ok: true, mode: "rules", result: { count: 99 } });
          },
          { once: true },
        ),
      );
    },
  });
  try {
    const response = await context.request("/investigate", {
      method: "POST",
      cookie: context.cookie,
      body: { question: "Find barriers" },
    });
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(abortObserved, true);
    assert.equal(
      (
        await (
          await context.request("/runs", { cookie: context.cookie })
        ).json()
      ).runs.length,
      0,
    );
  } finally {
    context.store.close();
  }
});

test("reviewed task audio is session-owned, reads server text, and rejects arbitrary speech", async () => {
  const calls = [];
  const context = await setup({
    config: () => ({
      elevenLabsApiKey: "test-secret",
      elevenLabsVoiceId: "BellaVoice",
      fetchImpl: async (url, options) => {
        calls.push(JSON.parse(options.body));
        return new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), {
          headers: { "content-type": "audio/mpeg" },
        });
      },
    }),
  });
  try {
    const created = await (
      await context.request("/tasks", {
        method: "POST",
        cookie: context.cookie,
        body: { patientId: "P0008", barrier: "transportation" },
      })
    ).json();
    const id = created.task.id;
    const path = "/tasks/" + id;
    assert.equal(
      (
        await context.request(path + "/audio", {
          method: "POST",
          cookie: context.cookie,
          body: {},
        })
      ).status,
      409,
    );
    await context.request(path, {
      method: "PATCH",
      cookie: context.cookie,
      body: { status: "approved" },
    });
    const preview = await (
      await context.request(path + "/brief", { cookie: context.cookie })
    ).json();
    assert.match(preview.text, /fictional patient P0008/);
    assert.equal((await context.request(path + "/brief")).status, 404);
    assert.equal(
      (
        await context.request(path + "/audio", {
          method: "POST",
          cookie: context.cookie,
          body: { text: "arbitrary" },
        })
      ).status,
      400,
    );
    const audio = await context.request(path + "/audio", {
      method: "POST",
      cookie: context.cookie,
      body: {},
    });
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    assert.equal(audio.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, preview.text);
  } finally {
    await context.store.close();
  }
});

test("audio generation has a durable budget and fails honestly on invalid audio", async () => {
  const context = await setup({
    limits: { modelInvestigationsPerHour: 1 },
    config: () => ({
      elevenLabsApiKey: "test-secret",
      elevenLabsVoiceId: "BellaVoice",
      fetchImpl: async () =>
        new Response("not audio", {
          headers: { "content-type": "audio/mpeg" },
        }),
    }),
  });
  try {
    const created = await (
      await context.request("/tasks", {
        method: "POST",
        cookie: context.cookie,
        body: { patientId: "P0008", barrier: "transportation" },
      })
    ).json();
    const path = "/tasks/" + created.task.id;
    await context.request(path, {
      method: "PATCH",
      cookie: context.cookie,
      body: { status: "approved" },
    });
    const failed = await context.request(path + "/audio", {
      method: "POST",
      cookie: context.cookie,
      body: {},
    });
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).error.code, "audio_unavailable");
    assert.equal(
      (
        await context.request(path + "/audio", {
          method: "POST",
          cookie: context.cookie,
          body: {},
        })
      ).status,
      429,
    );
  } finally {
    await context.store.close();
  }
});

test("Gemini brief API validates body, evidence, service output and budget without creating tasks", async () => {
  let calls = 0;
  const context = await setup({
    config: () => ({
      geminiApiKey: "test",
      fetchImpl: async (_url, init) => {
        calls++;
        const steps = JSON.parse(JSON.parse(init.body).input).steps;
        return Response.json({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    stepIds: steps.map((s) => s.id).reverse(),
                  }),
                },
              ],
            },
          ],
        });
      },
    }),
    limits: { modelInvestigationsPerHour: 1 },
  });
  try {
    const request = (id, body = {}) =>
      context.request("/patients/" + id + "/care-brief", {
        method: "POST",
        body,
        cookie: context.cookie,
      });
    assert.equal((await request("P0009", { text: "invent" })).status, 400);
    assert.equal((await request("P9999")).status, 404);
    const response = await request("P0009");
    assert.equal(response.status, 200);
    const brief = await response.json();
    assert.equal(brief.steps.length, 4);
    assert.equal(brief.reviewRequired, true);
    for (const step of brief.steps)
      assert.equal(graph.source(step.sourceId).patientId, "P0009");
    assert.equal(calls, 1);
    assert.equal((await request("P0009")).status, 429);
  } finally {
    context.store.close();
  }
});
