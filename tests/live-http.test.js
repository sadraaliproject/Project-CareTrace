import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createAppServer } from "../server.js";

async function listen(options) {
  const server = createAppServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const close = (server) => new Promise((done) => server.close(done));

test("HTTP investigation and reviewed task survive a local server restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "careweave-live-http-"));
  const options = {
    filename: join(directory, "workspace.sqlite"),
    apiKey: null,
    fetchImpl: () => {
      throw new Error("Rules mode must not call an external service");
    },
  };
  let running = await listen(options);
  t.after(async () => {
    await close(running.server);
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
    assert.ok(absolute.split(sep).at(-1).startsWith("careweave-live-http-"));
    await rm(absolute, { recursive: true, force: true });
  });
  const statusResponse = await fetch(running.url + "/api/v1/status");
  const cookie = statusResponse.headers.get("set-cookie").split(";")[0];
  const status = await statusResponse.json();
  assert.equal(status.mode, "rules");
  assert.deepEqual(status.storage, { kind: "sqlite", persistent: true });
  const send = (path, body) =>
    fetch(running.url + path, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: running.url,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const streamed = await send("/api/v1/investigate", {
    question:
      "Which discharged patients have a follow-up gap and a documented barrier?",
    mode: "rules",
  });
  assert.equal(streamed.status, 200);
  const events = (await streamed.text())
    .split("\n\n")
    .map((block) => {
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      return data ? JSON.parse(data.slice(6)) : null;
    })
    .filter(Boolean);
  const answer = events.find((event) => event.runId && event.result);
  assert.equal(answer?.result?.count, 26);
  const draft = await (
    await send("/api/v1/tasks", {
      patientId: "P0001",
      barrier: "transportation",
    })
  ).json();
  assert.equal(draft.task.status, "draft");
  const approved = await fetch(running.url + `/api/v1/tasks/${draft.task.id}`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: running.url,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "approved" }),
  });
  assert.equal(approved.status, 200);
  await close(running.server);
  running = await listen(options);
  const restored = await fetch(running.url + "/api/v1/tasks", {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.equal(restored.tasks[0].id, draft.task.id);
  assert.equal(restored.tasks[0].status, "approved");
  const run = await fetch(running.url + `/api/v1/runs/${answer.runId}`, {
    headers: { Cookie: cookie },
  }).then((response) => response.json());
  assert.equal(run.result.fingerprint, answer.result.fingerprint);
  assert.equal(
    (await fetch(running.url + `/api/v1/runs/${answer.runId}`)).status,
    404,
  );
  assert.equal(
    (await fetch(running.url + "/backend/prompts/investigator.js")).status,
    404,
  );
});
