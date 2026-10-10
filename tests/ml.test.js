import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  trainModel,
  validateCorpus,
  classifyWithModel,
  getMlMetrics,
  predictText,
  extractWithModel,
  LABELS,
} from "../backend/ml.js";

const corpus = JSON.parse(
  readFileSync(new URL("../ml/corpus.json", import.meta.url), "utf8"),
);
const mockExtraction = (assertions) => async () => ({
  ok: true,
  json: async () => ({
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: JSON.stringify({ assertions }) },
        ],
      },
    ],
  }),
});

test("training is reproducible and held-out content cannot change learned parameters", () => {
  const first = trainModel(corpus),
    second = trainModel(corpus);
  assert.deepEqual(first, second);
  const changed = structuredClone(corpus);
  changed.test[0].text =
    "A completely new held out example with vocabulary absent from training.";
  assert.deepEqual(trainModel(changed), first);
  assert.equal(first.trainSize, 50);
  assert.equal(first.algorithm, "multinomial-naive-bayes");
  assert.ok(first.vocabulary.some((word) => word.startsWith("b:")));
});

test("duplicate text across splits is detected", () => {
  const changed = structuredClone(corpus);
  changed.test[0].text = changed.train[0].text;
  assert.throws(() => validateCorpus(changed), /Duplicate/);
});

test("held-out metrics are calculated from individual predictions and their confusion matrix", () => {
  const metrics = getMlMetrics();
  assert.equal(metrics.testSize, 20);
  assert.equal(metrics.trainSize, 50);
  assert.equal(
    metrics.accuracy,
    metrics.examples.filter((row) => row.correct).length /
      metrics.examples.length,
  );
  assert.equal(
    Object.values(metrics.confusion)
      .flatMap(Object.values)
      .reduce((sum, value) => sum + value, 0),
    20,
  );
  assert.ok(metrics.accuracy > 1 / LABELS.length);
  assert.ok(
    metrics.accuracy < 1,
    "This held-out fixture includes errors; do not relabel or conceal them.",
  );
  assert.match(metrics.limitation, /not.*independently validated/i);
});

test("classifier uses learned features and produces normalized uncalibrated rankings", () => {
  const model = trainModel(corpus);
  const transportation = classifyWithModel(
    "My broken car leaves me without a ride to the clinic.",
    model,
  );
  const food = classifyWithModel(
    "I am hungry and the cupboards have no food or groceries.",
    model,
  );
  assert.equal(transportation[0].type, "transportation");
  assert.equal(food[0].type, "food");
  assert.ok(
    Math.abs(transportation.reduce((sum, p) => sum + p.score, 0) - 1) < 1e-10,
  );
});

test("patient-scope, uncertainty, and negation rules remain separate from model scores", () => {
  for (const text of [
    "Patient denies transportation problems.",
    "Her mother cannot afford the medication copay.",
    "If the patient needs transportation help, provide a resource list.",
  ]) {
    const result = predictText(text);
    assert.equal(result.predictions.length, 5);
    assert.equal(
      result.assertions.filter((a) => a.status === "active").length,
      0,
    );
    assert.match(result.assertionMethod, /Separate deterministic/);
    assert.match(result.scoreMeaning, /not clinical confidence/);
  }
  const resolved = predictText("I no longer need transportation help.");
  assert.equal(resolved.assertions.length, 0);

  const lost = predictText("I no longer have a ride.");
  assert.equal(lost.assertions[0].status, "active");
  assert.equal(lost.guardrails.resolved, false);
});

test("live extraction is unavailable without a key and does not make a network call", async () => {
  const result = await extractWithModel({
    text: "I cannot afford the medication copay.",
    fetchImpl: () => {
      throw new Error("Unexpected call");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /No model key/);
});

test("model extraction accepts exact patient evidence and rejects invented source text", async () => {
  const text = "I have no transportation to my appointments.";
  const result = await extractWithModel({
    text,
    patientId: "P0412",
    apiKey: "test",
    fetchImpl: mockExtraction([
      {
        type: "transportation",
        status: "active",
        scope: "patient",
        quote: text,
      },
      {
        type: "cost",
        status: "active",
        scope: "patient",
        quote: "I cannot afford medications.",
      },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.assertions.length, 1);
  assert.equal(result.assertions[0].quote, text);
  assert.equal(result.assertions[0].patientId, "P0412");
  assert.equal(result.assertions[0].quoteValidated, true);
  assert.equal(result.rejected.length, 1);
});

test("a model cannot strip surrounding denial or family context from an exact substring", async () => {
  for (const [text, quote, type] of [
    [
      "Patient denies transportation problems.",
      "transportation problems",
      "transportation",
    ],
    [
      "Her mother cannot afford the medication copay.",
      "cannot afford the medication copay",
      "cost",
    ],
  ]) {
    const result = await extractWithModel({
      text,
      apiKey: "test",
      fetchImpl: mockExtraction([
        { type, status: "active", scope: "patient", quote },
      ]),
    });
    assert.equal(result.ok, true);
    assert.equal(result.assertions.length, 0);
    assert.equal(result.rejected.length, 1);
  }
});

test("a generic denial cannot become a model-invented resolved history", async () => {
  const text = "Patient denies transportation problems.";
  const result = await extractWithModel({
    text,
    apiKey: "test",
    fetchImpl: mockExtraction([
      {
        type: "transportation",
        status: "resolved",
        scope: "patient",
        quote: text,
      },
    ]),
  });
  assert.equal(result.assertions.length, 0);
});
