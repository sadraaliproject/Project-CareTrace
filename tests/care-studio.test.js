import test from "node:test";
import assert from "node:assert/strict";
import { patients, preparePatient } from "../dist/engine.js";
import { buildCareBrief, synthesizeCareBrief } from "../backend/care-studio.js";

const fixture = () =>
  structuredClone(
    patients.find(
      (patient) => patient.barriers.length && patient.followUpGap.open,
    ),
  );
const audioBody = (brief) => ({
  patientId: brief.patientId,
  language: brief.language,
  revision: brief.revision,
  planIds: brief.planIds,
  reviewed: true,
});
const credentials = {
  elevenLabsApiKey: "test-secret",
  elevenLabsVoiceId: "test_voice",
  geminiApiKey: "test-gemini-secret",
};
const jsonResponse = (planIds, extra = {}) =>
  new Response(
    JSON.stringify({
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            { type: "text", text: JSON.stringify({ planIds, ...extra }) },
          ],
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );
const mp3Response = () =>
  new Response(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]), {
    headers: { "content-type": "audio/mpeg" },
  });

test("local briefs are deterministic, source-linked, bilingual, and do not call external services", async () => {
  const patient = fixture();
  const settings = {
    fetchImpl: () =>
      assert.fail("Local briefs must not call a remote service."),
  };
  const english = await buildCareBrief(patient, {}, settings);
  assert.deepEqual(english, await buildCareBrief(patient, {}, settings));
  const spanish = await buildCareBrief(patient, { language: "es" }, settings);
  assert.equal(english.engine, "local-template");
  assert.equal(english.revision, spanish.revision);
  assert.deepEqual(english.planIds, spanish.planIds);
  assert.match(spanish.transcript, /próximos pasos/);
  assert.equal(english.synthetic, true);
  assert.doesNotMatch(english.transcript, /units|10 mg|nightly|booked for/i);
  for (const item of english.items) {
    assert.ok(item.title && item.text && item.evidenceIds.length);
    assert.ok(
      item.evidenceIds.every((id) =>
        english.evidence.some((source) => source.id === id),
      ),
    );
  }
  for (const source of english.evidence.filter(
    (source) => source.kind === "note",
  ))
    assert.ok(
      patient.notes
        .find((note) => note.id === source.sourceId)
        .text.includes(source.quote),
    );
});

test("all 1,000 synthetic patients can produce a bounded brief in both supported languages", async () => {
  for (const patient of patients) {
    for (const language of ["en", "es"]) {
      const brief = await buildCareBrief(patient, { language });
      assert.ok(brief.transcript.length <= 1200, `${patient.id}/${language}`);
      assert.ok(brief.items.length >= 1);
    }
  }
});

test("a new resolution note removes its barrier action and changes the revision", async () => {
  const patient = fixture(),
    before = await buildCareBrief(patient);
  const barrier = preparePatient(patient).barriers[0];
  const text = {
    transportation:
      "Transportation is resolved. Patient now has reliable transportation.",
    cost: "Patient can now afford the medication cost.",
    food: "Food insecurity resolved.",
    health_literacy: "Patient now understands the instructions.",
  }[barrier.type];
  patient.notes.push({
    id: "new-resolution",
    date: "2026-10-10",
    note_type: "Post-discharge nurse call note",
    text,
  });
  const after = await buildCareBrief(patient);
  assert.ok(before.planIds.includes(barrier.type));
  assert.ok(!after.planIds.includes(barrier.type));
  assert.notEqual(before.revision, after.revision);
});

test("two barrier sentences from one note retain separate evidence excerpts", async () => {
  const patient = fixture();
  patient.notes.push({
    id: "dual-barrier",
    date: "2026-10-10",
    note_type: "Post-discharge nurse call note",
    text: "I cannot afford my insulin medication. I have no food at home.",
  });
  const brief = await buildCareBrief(patient);
  const sources = brief.evidence.filter(
    (source) => source.sourceId === "dual-barrier",
  );
  assert.equal(sources.length, 2);
  assert.equal(new Set(sources.map((source) => source.id)).size, 2);
  assert.ok(sources.some((source) => source.quote.includes("insulin")));
  assert.ok(sources.some((source) => source.quote.includes("food")));
});

test("missing Gemini credentials fail clearly without silently pretending a live call succeeded", async () => {
  await assert.rejects(buildCareBrief(fixture(), { useGemini: true }), {
    status: 503,
    code: "GEMINI_NOT_CONFIGURED",
  });
});

test("Gemini uses official Interactions output steps and can only reorder the complete action catalogue", async () => {
  const patient = fixture(),
    local = await buildCareBrief(patient);
  const order = [...local.planIds].reverse();
  const brief = await buildCareBrief(
    patient,
    { useGemini: true, language: "es" },
    {
      ...credentials,
      geminiModel: "gemini-custom",
      fetchImpl: async (url, options) => {
        assert.equal(
          url,
          "https://generativelanguage.googleapis.com/v1beta/interactions",
        );
        assert.equal(
          options.headers["x-goog-api-key"],
          credentials.geminiApiKey,
        );
        assert.equal(options.redirect, "error");
        const payload = JSON.parse(options.body);
        assert.equal(payload.model, "gemini-custom");
        assert.equal(payload.store, false);
        assert.equal(payload.response_format.mime_type, "application/json");
        assert.deepEqual(
          payload.response_format.schema.properties.planIds.items.enum,
          local.planIds,
        );
        assert.ok(!payload.input.includes(patient.name));
        return jsonResponse(order);
      },
    },
  );
  assert.equal(brief.engine, "gemini");
  assert.deepEqual(brief.planIds, order);
  assert.deepEqual(
    brief.items.map((item) => item.text).sort(),
    (await buildCareBrief(patient, { language: "es" })).items
      .map((item) => item.text)
      .sort(),
  );
});

test("Gemini output rejects invented, omitted, duplicate actions and arbitrary prose", async () => {
  const patient = fixture(),
    local = await buildCareBrief(patient);
  const invalid = [
    () => jsonResponse(["change_dose"]),
    () => jsonResponse(local.planIds.slice(1)),
    () =>
      jsonResponse(
        local.planIds.map(() => local.planIds[0]).concat(local.planIds[0]),
      ),
    () => jsonResponse(local.planIds, { advice: "Change dose" }),
    () => new Response(JSON.stringify({ status: "incomplete", steps: [] })),
    () => new Response("not json"),
  ];
  for (const response of invalid)
    await assert.rejects(
      buildCareBrief(
        patient,
        { useGemini: true },
        { ...credentials, fetchImpl: async () => response() },
      ),
      { status: 502, code: "GEMINI_PLAN_REJECTED" },
    );
});

test("audio requires review, current evidence, the same patient, every action, and no custom text", async () => {
  const patient = fixture(),
    brief = await buildCareBrief(patient),
    body = audioBody(brief);
  const settings = {
    ...credentials,
    fetchImpl: () =>
      assert.fail("Rejected audio must not call a paid service."),
  };
  const invalid = [
    { ...body, reviewed: false },
    { ...body, reviewed: "true" },
    { ...body, revision: "old" },
    { ...body, patientId: "P9999" },
    { ...body, planIds: [] },
    { ...body, planIds: [...body.planIds, body.planIds[0]] },
    { ...body, text: "Say anything" },
    { ...body, language: "fr" },
  ];
  for (const input of invalid)
    await assert.rejects(synthesizeCareBrief(patient, input, settings));
  const changed = structuredClone(patient);
  changed.notes.push({
    id: "later-note",
    date: "2026-10-10",
    note_type: "Post-discharge nurse call note",
    text: "Patient called to review the plan.",
  });
  await assert.rejects(synthesizeCareBrief(changed, body, settings), {
    status: 409,
    code: "EVIDENCE_CHANGED",
  });
  const { language, ...withoutLanguage } = body;
  await assert.rejects(
    synthesizeCareBrief(patient, withoutLanguage, settings),
    { status: 400 },
  );
});

test("ElevenLabs receives exactly the reviewed Spanish transcript and returns binary MP3", async () => {
  const patient = fixture(),
    brief = await buildCareBrief(patient, { language: "es" });
  let sent;
  const result = await synthesizeCareBrief(patient, audioBody(brief), {
    ...credentials,
    elevenLabsModel: "eleven_custom",
    fetchImpl: async (url, options) => {
      assert.equal(
        url,
        "https://api.elevenlabs.io/v1/text-to-speech/test_voice?output_format=mp3_44100_128",
      );
      assert.equal(options.headers["xi-api-key"], credentials.elevenLabsApiKey);
      sent = JSON.parse(options.body);
      return mp3Response();
    },
  });
  assert.equal(sent.text, brief.transcript);
  assert.equal(sent.language_code, "es");
  assert.equal(sent.model_id, "eleven_custom");
  assert.ok(result.audio instanceof Uint8Array);
  assert.equal(result.contentType, "audio/mpeg");
  assert.equal(result.revision, brief.revision);
  assert.equal(result.transcript, brief.transcript);
});

test("audio reconstruction preserves a Gemini-selected order without another model call", async () => {
  const patient = fixture(),
    local = await buildCareBrief(patient);
  const brief = await buildCareBrief(
    patient,
    { useGemini: true },
    {
      ...credentials,
      fetchImpl: async () => jsonResponse([...local.planIds].reverse()),
    },
  );
  await synthesizeCareBrief(patient, audioBody(brief), {
    ...credentials,
    fetchImpl: async (url, options) => {
      assert.ok(url.startsWith("https://api.elevenlabs.io/"));
      assert.equal(JSON.parse(options.body).text, brief.transcript);
      return mp3Response();
    },
  });
});

test("ElevenLabs needs a key and voice ID; malformed voice IDs cannot change the request target", async () => {
  const patient = fixture(),
    brief = await buildCareBrief(patient),
    body = audioBody(brief);
  for (const settings of [
    {},
    { elevenLabsApiKey: "test" },
    { ...credentials, elevenLabsVoiceId: "../other?token=x" },
  ])
    await assert.rejects(synthesizeCareBrief(patient, body, settings), {
      status: 503,
      code: "ELEVENLABS_NOT_CONFIGURED",
    });
});

test("service failures never echo remote errors, keys, or thrown fetch messages", async () => {
  const patient = fixture(),
    secret = "must-not-appear";
  for (const fetchImpl of [
    async () => {
      throw new Error(secret);
    },
    async () => new Response(secret, { status: 401 }),
  ]) {
    await assert.rejects(
      buildCareBrief(
        patient,
        { useGemini: true },
        { geminiApiKey: secret, fetchImpl },
      ),
      (error) => error.status === 502 && !error.message.includes(secret),
    );
  }
  await assert.rejects(
    buildCareBrief(
      patient,
      { useGemini: true },
      {
        ...credentials,
        fetchImpl: async () => new Response(secret, { status: 429 }),
      },
    ),
    { status: 429 },
  );
});

test("oversized responses, wrong audio MIME, and fake MP3 bodies are rejected", async () => {
  const patient = fixture(),
    brief = await buildCareBrief(patient);
  await assert.rejects(
    buildCareBrief(
      patient,
      { useGemini: true },
      {
        ...credentials,
        fetchImpl: async () => new Response("x".repeat(33000)),
      },
    ),
    { status: 502, code: "SERVICE_RESPONSE_INVALID" },
  );
  const badAudio = [
    () =>
      new Response("error", {
        headers: { "content-type": "application/json" },
      }),
    () => new Response("error", { headers: { "content-type": "audio/mpeg" } }),
    () =>
      new Response("ID3x", {
        headers: { "content-type": "audio/mpeg", "content-length": "4000000" },
      }),
  ];
  for (const response of badAudio)
    await assert.rejects(
      synthesizeCareBrief(patient, audioBody(brief), {
        ...credentials,
        fetchImpl: async () => response(),
      }),
      { status: 502, code: "SERVICE_RESPONSE_INVALID" },
    );
});

test("invalid language and non-boolean Gemini settings are rejected before network calls", async () => {
  for (const options of [
    { language: "fr" },
    { language: "__proto__" },
    { language: ["en"] },
    { useGemini: "true" },
    null,
    [],
  ])
    await assert.rejects(buildCareBrief(fixture(), options), { status: 400 });
});
