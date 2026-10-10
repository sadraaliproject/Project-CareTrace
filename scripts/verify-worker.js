import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PUBLIC_ASSETS } from "../backend/prototype.js";
import { createD1Fixture } from "../tests/helpers/d1.js";
import worker from "../dist/server/index.js";

const originalFetch = globalThis.fetch;
const digest = (value) => createHash("sha256").update(value).digest("hex");
globalThis.fetch = () => {
  throw new Error("Unexpected external request in rules mode");
};
const DB = await createD1Fixture();
const env = { DB };
const origin = "https://careweave.test";
let cookie = "";
async function call(path, method = "GET", body, ownCookie = cookie) {
  const response = await worker.fetch(
    new Request(origin + path, {
      method,
      headers: {
        ...(ownCookie ? { Cookie: ownCookie } : {}),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
  const set = response.headers.get("set-cookie");
  if (set && ownCookie === cookie) cookie = set.split(";")[0];
  return response;
}
try {
  for (const asset of PUBLIC_ASSETS) {
    const response = await call("/" + asset);
    assert.equal(response.status, 200, asset);
    assert.equal(
      digest(await response.text()),
      digest(await readFile(`dist/${asset}`, "utf8")),
      asset,
    );
  }
  assert.match(await (await call("/")).text(), /workspace\.js/);
  assert.match(await (await call("/story.html")).text(), /pilot-app\.js/);
  const status = await (await call("/api/v1/status")).json();
  assert.equal(status.aiConfigured, false);
  assert.equal(status.mode, "rules");
  assert.equal(status.storage.kind, "d1");
  assert.equal(status.storage.persistent, true);
  const overviewResponse = await call("/api/v1/overview");
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.discharges, 1000);
  assert.equal(overview.barrier, 26);
  assert.ok(overview.totals.nodes > 0);
  const investigation = await call("/api/v1/investigate", "POST", {
    question:
      "Which discharged patients have a follow-up gap and a documented barrier?",
    mode: "rules",
  });
  assert.equal(investigation.status, 200);
  assert.match(investigation.headers.get("content-type"), /text\/event-stream/);
  const stream = await investigation.text();
  const payloads = stream
    .split("\n\n")
    .map((block) => {
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      return data ? JSON.parse(data.slice(6)) : null;
    })
    .filter(Boolean);
  const answer = payloads.find((entry) => entry.runId && entry.result);
  assert.ok(answer?.ok, stream.slice(-2000));
  assert.equal(answer.mode, "rules");
  assert.equal(answer.result.count, 26);
  const runs = await (await call("/api/v1/runs")).json();
  assert.ok(
    runs.runs.some(
      (run) => run.id === answer.runId || run.runId === answer.runId,
    ),
  );
  const draftResponse = await call("/api/v1/tasks", "POST", {
    patientId: "P0001",
    barrier: "transportation",
  });
  assert.ok([200, 201].includes(draftResponse.status));
  const { task } = await draftResponse.json();
  assert.equal(task.status, "draft");
  assert.ok(task.evidence.length);
  assert.equal(
    (await call(`/api/v1/tasks/${task.id}`, "PATCH", { status: "approved" }))
      .status,
    200,
  );
  const tasks = await (await call("/api/v1/tasks")).json();
  assert.equal(
    tasks.tasks.find((item) => item.id === task.id).status,
    "approved",
  );
  const otherTasks = await (
    await call("/api/v1/tasks", "GET", undefined, "")
  ).json();
  assert.equal(otherTasks.tasks.length, 0);
  for (const path of [
    "/api/agent",
    "/api/care-brief",
    "/api/audio",
    "/api/tasks",
    "/api/seed",
  ])
    assert.equal((await call(path, "POST")).status, 410);
  for (const path of [
    "/.env",
    "/app.js",
    "/server/index.js",
    "/backend/live-agent.js",
    "/server.js",
  ])
    assert.equal((await call(path)).status, 404);
  // Server credentials and agent tools never enter the browser assets.
  for (const file of PUBLIC_ASSETS.filter((name) => name.endsWith(".js"))) {
    const source = await readFile(`dist/${file}`, "utf8");
    assert.doesNotMatch(source, /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/);
    assert.equal(source.includes("api.openai.com/v1/responses"), false, file);
  }
  console.log(
    `Bundled Worker verified: ${PUBLIC_ASSETS.length} assets, migrated D1 workflow, streamed 26-patient query, durable reviewed task, isolated visitor sessions, protected server files.`,
  );
} finally {
  DB.close();
  globalThis.fetch = originalFetch;
}
