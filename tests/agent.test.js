import test from "node:test";
import assert from "node:assert/strict";
import { runAgent, agentTools } from "../backend/agent.js";

import { defaultPlan } from "../planner.js";
import { patients } from "../dist/engine.js";
import { createSqliteRepository } from "../backend/sqlite.js";
const plan = () => ({ ...defaultPlan(), barriers: ["transportation"] });
const fixture = structuredClone(patients.find((p) => p.id === "P0412"));
const document = fixture.notes.find(
  (n) =>
    n.id ===
    fixture.barriers.find((b) => b.type === "transportation").documentId,
);
function repository() {
  const calls = [],
    saved = [];
  return {
    calls,
    saved,
    metrics: async () => ({ discharges: 1000 }),
    query: async (p) => {
      calls.push(["query", p]);
      return {
        patients: [fixture],
        count: 1,
        groups: [],
        fingerprint: "TEST1234",
      };
    },
    getDocument: async (id) => {
      calls.push(["document", id]);
      return { ...document, patientId: fixture.id };
    },
    expandNode: async (id, relationship) => {
      calls.push(["expand", id, relationship]);
      return {
        nodes: [
          { id: fixture.id, type: "Patient" },
          { id: document.id, type: "ClinicalNote" },
        ],
        edges: [{ source: fixture.id, target: document.id, type: "HAS_NOTE" }],
      };
    },
    saveRun: async (value) => {
      saved.push(value);
      return { id: "saved-run", ...value };
    },
  };
}
const call = (name, args = {}, n = 1) => ({
  type: "function_call",
  name,
  call_id: `call-${n}`,
  arguments: JSON.stringify(args),
});
const response = (output) => ({
  ok: true,
  json: async () => ({ status: "completed", output }),
});
function scripted(outputs) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...JSON.parse(options.body) });
    return response(outputs.shift() || []);
  };
  return { fetchImpl, requests };
}

test("no key uses the labeled deterministic parser and real repository result", async () => {
  const repo = repository();
  const result = await runAgent({
    question:
      "Find discharged patients with transportation barriers and follow-up gaps",
    repo,
    fetchImpl: () => {
      throw new Error("Unexpected network call");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.engine, "deterministic");
  assert.equal(result.result.count, 1);
  assert.match(result.answer, /Found 1 matching fictional/);
  assert.equal(repo.calls.filter((row) => row[0] === "query").length, 2);
  assert.equal(repo.saved.length, 1);
  assert.ok(
    result.events.every(
      (event) => event.step && event.tool && Array.isArray(event.nodes),
    ),
  );
});

test("real tool-loop protocol queries, traverses, reads evidence and finalizes an exact cohort", async () => {
  const repo = repository(),
    emitted = [];
  const script = scripted([
    [call("get_ontology", {}, 1)],
    [call("query_patients", { plan: plan() }, 2)],
    [call("expand_node", { id: "P0412", relationship: "HAS_NOTE" }, 3)],
    [call("get_evidence", { documentId: document.id }, 4)],
    [call("build_cohort", { plan: plan() }, 5)],
  ]);
  const result = await runAgent({
    question: "Find follow-up gaps and transportation barriers",
    repo,
    apiKey: "test-secret",
    fetchImpl: script.fetchImpl,
    onEvent: (event) => emitted.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.engine, "model-agent");
  assert.equal(result.rounds, 5);
  assert.equal(result.result.count, 1);
  assert.deepEqual(
    result.events.map((event) => event.tool),
    [
      "get_ontology",
      "query_patients",
      "expand_node",
      "get_evidence",
      "build_cohort",
    ],
  );
  assert.equal(result.events[3].evidence[0].quote, document.text);
  assert.equal(emitted.length, 5);
  assert.equal(repo.calls.filter((row) => row[0] === "query").length, 2);
  assert.equal(script.requests[0].store, false);
  assert.equal(script.requests[0].parallel_tool_calls, false);
  assert.ok(
    script.requests[4].input.some(
      (item) =>
        item.type === "function_call_output" && item.call_id === "call-4",
    ),
  );
  assert.equal(JSON.stringify(repo.saved).includes("test-secret"), false);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
});

test("the bounded tool contract exposes no message, approval, SQL, or code tool", () => {
  assert.deepEqual(
    agentTools.map((tool) => tool.name),
    [
      "get_ontology",
      "query_patients",
      "expand_node",
      "get_evidence",
      "build_cohort",
    ],
  );
  for (const tool of agentTools) {
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
  }
});

test("unsupported deterministic questions do not execute a repository query", async () => {
  const repo = repository();
  const result = await runAgent({
    question: "Find patients with a specific postal code",
    repo,
  });
  assert.equal(result.ok, false);
  assert.equal(repo.calls.length, 0);
});

test("an extra SQL field or unobserved document is rejected before access", async () => {
  const repo = repository();
  const script = scripted([
    [call("get_ontology")],
    [
      call("query_patients", {
        plan: { ...plan(), sql: "DELETE FROM patients" },
      }),
    ],
    [call("get_evidence", { documentId: "unobserved" })],
    [],
  ]);
  const result = await runAgent({
    question: "Find transportation barriers",
    repo,
    apiKey: "test",
    fetchImpl: script.fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(repo.calls.length, 0);
  assert.equal(result.events.filter((event) => event.rejected).length, 2);
});

test("a cohort cannot finalize without inspecting its required source or with changed filters", async () => {
  for (const finalPlan of [plan(), { ...plan(), ageMin: 65 }]) {
    const repo = repository();
    const script = scripted([
      [call("get_ontology")],
      [call("query_patients", { plan: plan() })],
      [call("build_cohort", { plan: finalPlan })],
      [],
    ]);
    const result = await runAgent({
      question: "Find transportation barriers",
      repo,
      apiKey: "test",
      fetchImpl: script.fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.result, null);
    assert.ok(result.events.some((event) => event.rejected));
    assert.equal(repo.calls.filter((row) => row[0] === "query").length, 1);
  }
});

test("model narrative cannot invent an answer without executed tools", async () => {
  const repo = repository();
  const script = scripted([
    [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "There are 9999 patients and everyone should receive treatment.",
          },
        ],
      },
    ],
  ]);
  const result = await runAgent({
    question: "Find transportation barriers",
    repo,
    apiKey: "test",
    fetchImpl: script.fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.equal(result.answer.includes("9999"), false);
  assert.equal(repo.calls.length, 0);
});

test("run budgets stop a looping or oversized tool batch", async () => {
  const repo = repository();
  const script = scripted(
    Array.from({ length: 12 }, () => [call("get_ontology")]),
  );
  const rounds = await runAgent({
    question: "Find transportation barriers",
    repo,
    apiKey: "test",
    fetchImpl: script.fetchImpl,
  });
  assert.equal(rounds.ok, false);
  assert.equal(script.requests.length, 12);
  const batch = scripted([
    Array.from({ length: 13 }, (_, i) => call("get_ontology", {}, i)),
  ]);
  const calls = await runAgent({
    question: "Find transportation barriers",
    repo,
    apiKey: "test",
    fetchImpl: batch.fetchImpl,
  });
  assert.equal(calls.ok, false);
  assert.equal(calls.events.length, 12);
  assert.match(calls.error, /twelve-tool-call/);
});

test("configured upstream failure is explicit and never labeled a successful model run", async () => {
  const repo = repository();
  const result = await runAgent({
    question: "Find transportation barriers",
    repo,
    apiKey: "test",
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.engine, "model-agent");
  assert.equal(result.result, null);
  assert.equal(repo.calls.length, 0);
  assert.match(result.error, /401/);
});

test("a model cannot inspect more than fifty graph nodes", async () => {
  const repo = repository();
  repo.expandNode = async () => ({
    nodes: Array.from({ length: 51 }, (_, index) => ({
      id: `oversized-${index}`,
      type: "Patient",
    })),
    edges: [],
  });
  const script = scripted([
    [call("get_ontology")],
    [call("query_patients", { plan: plan() })],
    [call("expand_node", { id: "P0412", relationship: "HAS_NOTE" })],
    [],
  ]);
  const result = await runAgent({
    question: "Find follow-up gaps and transportation barriers",
    repo,
    apiKey: "test",
    fetchImpl: script.fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.events.some((event) => event.rejected && /50-node/.test(event.say)),
  );
  assert.ok(
    !result.events.some((event) => event.nodes?.includes("oversized-50")),
  );
});

test("hospital question changes the executed route and a missing code triggers the note detour", async (t) => {
  const repo = await createSqliteRepository({ filename: ":memory:" });
  t.after(() => repo.close());
  await repo.seed();
  const main = await runAgent({
    question:
      "Find discharged patients with follow-up gaps and transportation barriers",
    repo,
  });
  assert.equal(main.ok, true);
  const missing = main.events.findIndex((event) =>
    event.say.startsWith("No matching Z code"),
  );
  const notes = main.events.findIndex(
    (event) =>
      event.tool === "expand_node" &&
      event.edges.some((edge) => edge.type === "HAS_NOTE"),
  );
  assert.ok(
    missing >= 0 && notes > missing,
    "The coded check must precede actual note traversal.",
  );
  const cost = await runAgent({
    question: "Find patients with new insulin not picked up and cost barriers",
    repo,
  });
  assert.equal(cost.ok, true);
  const costLinks = cost.events
    .filter((event) => event.tool === "expand_node")
    .flatMap((event) => event.edges.map((edge) => edge.type));
  assert.ok(costLinks.includes("PRESCRIBED_AT_DISCHARGE"));
  assert.equal(costLinks.includes("HAS_APPOINTMENT"), false);
  const returns = await runAgent({
    question: "Show patients likely to return",
    repo,
  });
  assert.equal(returns.ok, true);
  const returnLinks = returns.events
    .filter((event) => event.tool === "expand_node")
    .flatMap((event) => event.edges.map((edge) => edge.type));
  for (const type of [
    "HAS_RESULT",
    "HAS_APPOINTMENT",
    "PRESCRIBED_AT_DISCHARGE",
    "LIKELY_TO_RETURN",
  ])
    assert.ok(returnLinks.includes(type), type);
  for (const result of [main, cost, returns]) {
    assert.ok(result.events.length <= 12);
    const nodes = new Set(
      result.events
        .filter((event) => event.tool === "expand_node")
        .flatMap((event) => event.nodes),
    );
    assert.ok(nodes.size <= 50);
    assert.ok(
      result.events.some(
        (event) =>
          event.tool === "expand_node" &&
          event.edges.some((edge) => edge.type === "ADDRESSED_BY"),
      ),
    );
  }
});
