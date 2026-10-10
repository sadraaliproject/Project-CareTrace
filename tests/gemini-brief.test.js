import test from "node:test";
import assert from "node:assert/strict";
import { careBriefSteps, orderCareBrief } from "../backend/gemini-brief.js";
import { createLiveGraph } from "../backend/live-graph.js";

const graph = createLiveGraph();
const steps = careBriefSteps(graph, graph.getPatient("P0009"));
const settingsFor = (output) => ({
  geminiApiKey: "fake-test-key",
  fetchImpl: async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.store, false);
    assert.equal(request.response_format.schema.additionalProperties, false);
    return Response.json({
      status: "completed",
      steps: [
        { type: "thought", content: [{ type: "text", text: "ignore" }] },
        {
          type: "model_output",
          content: [{ type: "text", text: JSON.stringify(output) }],
        },
      ],
    });
  },
});
test("care brief uses multiple barriers and individual patient sources", () => {
  assert.equal(steps.length, 4);
  for (const step of steps)
    assert.equal(graph.source(step.sourceId).patientId, "P0009");
  const patient = structuredClone(graph.getPatient("P0009"));
  patient.barriers[0].resolved = true;
  assert.equal(careBriefSteps(graph, patient).length, 3);
  patient.barriers[1].documentId = "P0001-N01";
  assert.throws(() => careBriefSteps(graph, patient), /missing_evidence/);
});
test("Gemini reorders original immutable content and ignores model thoughts", async () => {
  const ids = steps.map((s) => s.id).reverse();
  const result = await orderCareBrief(
    steps,
    settingsFor({ stepIds: ids }),
    new AbortController().signal,
  );
  assert.deepEqual(result.steps, [...steps].reverse());
  assert.strictEqual(result.steps[0], steps.at(-1));
});
test("Gemini rejects omitted, duplicate, fabricated or extra output", async () => {
  const ids = steps.map((s) => s.id);
  for (const output of [
    { stepIds: ids.slice(1) },
    { stepIds: ids.map(() => ids[0]) },
    { stepIds: [...ids.slice(1), "new_prescription"] },
    { stepIds: ids, narrative: "unsupported" },
  ]) {
    await assert.rejects(
      orderCareBrief(steps, settingsFor(output), new AbortController().signal),
      /gemini_rejected/,
    );
  }
});
