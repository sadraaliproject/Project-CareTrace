import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createArchivedAppServer as createAppServer } from "../backend/archive-server.js";

import { defaultPlan } from "../planner.js";
const validPlan = () => ({ ...defaultPlan(), barriers: ["transportation"] });

const modelResponse = (result) => ({
  ok: true,
  json: async () => ({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(result) }],
      },
    ],
  }),
});

async function withServer(options, run) {
  const server = createAppServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const post = (base, body, extra = {}) =>
  fetch(`${base}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extra.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("keyless local mode is explicit and does not call an external service", async () => {
  let called = false;
  await withServer(
    {
      apiKey: "",
      fetchImpl: async () => {
        called = true;
      },
    },
    async (base) => {
      const status = await fetch(`${base}/api/status`).then((r) => r.json());
      assert.equal(status.model, false);
      assert.equal(status.modelName, null);
      assert.equal(status.synthetic, true);
      const response = await post(base, {
        question: "Find transportation barriers",
      });
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /deterministic/i);
      assert.equal(called, false);
    },
  );
});

test("model planning accepts and returns an inspectable structured plan", async () => {
  let sent;
  await withServer(
    {
      apiKey: "test-key-not-a-real-secret",
      model: "test-model",
      fetchImpl: async (url, options) => {
        sent = { url, options, payload: JSON.parse(options.body) };
        return modelResponse({
          ok: true,
          summary:
            "Active transportation barriers with diabetes and a follow-up gap.",
          error: null,
          suggestions: [],
          plan: validPlan(),
        });
      },
    },
    async (base) => {
      const response = await post(base, {
        question: "Find transportation barriers",
        previousPlan: validPlan(),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.equal(result.engine, "model");
      assert.equal(result.model, "test-model");
      assert.deepEqual(result.plan, validPlan());
      assert.equal(sent.url, "https://api.openai.com/v1/responses");
      assert.equal(sent.payload.store, false);
      assert.equal(sent.payload.text.format.strict, true);
      assert.deepEqual(
        JSON.parse(sent.payload.input).previousPlan,
        validPlan(),
      );
      assert.equal(
        JSON.stringify(result).includes("test-key-not-a-real-secret"),
        false,
      );
    },
  );
});

test("malformed, oversized, and unsupported input is rejected before a model call", async () => {
  let calls = 0;
  await withServer(
    {
      apiKey: "test-key",
      fetchImpl: async () => {
        calls++;
      },
    },
    async (base) => {
      for (const body of [
        "{bad-json",
        { question: "" },
        { question: "a".repeat(1501) },
        { question: "Find patients", previousPlan: { arbitrary: "filter" } },
      ]) {
        assert.equal((await post(base, body)).status, 400);
      }
      assert.equal(
        (await post(base, { question: "a".repeat(13000) })).status,
        413,
      );
      assert.equal(calls, 0);
    },
  );
});

test("cross-origin model requests and wrong API methods are rejected", async () => {
  let called = false;
  await withServer(
    {
      apiKey: "test-key",
      fetchImpl: async () => {
        called = true;
      },
    },
    async (base) => {
      assert.equal(
        (
          await post(
            base,
            { question: "Find patients" },
            { headers: { Origin: "https://unrelated.example" } },
          )
        ).status,
        403,
      );
      assert.equal((await fetch(`${base}/api/plan`)).status, 405);
      assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
      assert.equal(called, false);
    },
  );
});

test("invalid model plans never become executable results", async () => {
  for (const plan of [
    { ...validPlan(), barriers: ["location"] },
    { ...validPlan(), ageMin: 90, ageMax: 30 },
    { ...validPlan(), limit: -1 },
    { ...validPlan(), injectedField: true },
  ]) {
    await withServer(
      {
        apiKey: "test-key",
        fetchImpl: async () =>
          modelResponse({
            ok: true,
            summary: "Invalid plan",
            error: null,
            suggestions: [],
            plan,
          }),
      },
      async (base) => {
        const response = await post(base, { question: "Find patients" });
        assert.equal(response.status, 502);
        assert.match((await response.json()).error, /unsupported filters/i);
      },
    );
  }
});

test("unsupported user questions are returned as explicit model refusals", async () => {
  await withServer(
    {
      apiKey: "test-key",
      fetchImpl: async () =>
        modelResponse({
          ok: false,
          summary: "",
          error: "Location is not a supported filter.",
          suggestions: ["Find transportation barriers"],
          plan: validPlan(),
        }),
    },
    async (base) => {
      const response = await post(base, {
        question: "Which patients have a particular location?",
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.ok, false);
      assert.match(result.error, /not a supported filter/);
    },
  );
});

test("model service failure, truncation, and refusal fail visibly", async () => {
  const cases = [
    { ok: false, status: 429 },
    { ok: true, json: async () => ({ status: "incomplete", output: [] }) },
    {
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ content: [{ type: "refusal", refusal: "Declined" }] }],
      }),
    },
    {
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "not-json" }] }],
      }),
    },
  ];
  for (const mock of cases) {
    await withServer(
      { apiKey: "test-key", fetchImpl: async () => mock },
      async (base) => {
        const response = await post(base, { question: "Find patients" });
        assert.equal(response.status, 502);
        assert.equal((await response.json()).ok, false);
      },
    );
  }
});

test("static requests cannot read environment or server source outside dist", async () => {
  await withServer({ apiKey: "test-key" }, async (base) => {
    for (const path of [
      "/.env",
      "/server.js",
      "/planner.js",
      "/package.json",
      "/..%2fserver.js",
      "/..%5cserver.js",
    ]) {
      const response = await new Promise((resolve, reject) => {
        const req = request(`${base}${path}`, (result) => {
          let body = "";
          result.on("data", (chunk) => {
            body += chunk;
          });
          result.on("end", () => resolve({ status: result.statusCode, body }));
        });
        req.on("error", reject);
        req.end();
      });
      assert.ok(
        [403, 404].includes(response.status),
        `${path}: expected rejection, got ${response.status}`,
      );
      assert.equal(response.body.includes("test-key"), false);
      assert.equal(response.body.includes("createAppServer"), false);
    }
  });
});

