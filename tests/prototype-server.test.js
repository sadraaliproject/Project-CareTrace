import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.js";

test("active local server serves the workspace, preserves the guided story and disables retired APIs", async (t) => {
  const server = createAppServer({ filename: ":memory:", apiKey: null });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${url}/api/status`).then((response) =>
    response.json(),
  );
  assert.equal(status.externalRequests, false);
  assert.equal(status.persistence, "browser-memory");
  assert.match(
    await fetch(url).then((response) => response.text()),
    /workspace\.js/,
  );
  assert.match(
    await fetch(`${url}/story.html`).then((response) => response.text()),
    /pilot-app\.js/,
  );
  for (const path of [
    "/api/agent",
    "/api/audio",
    "/api/care-brief",
    "/api/tasks",
  ])
    assert.equal((await fetch(url + path, { method: "POST" })).status, 410);
  for (const path of [
    "/.env",
    "/backend/archive-server.js",
    "/app.js",
    "/hospital-data.js",
    "/care-studio.js",
  ])
    assert.equal((await fetch(url + path)).status, 404);
  assert.equal(
    (await fetch(`${url}/pilot-data.js`, { method: "HEAD" })).status,
    200,
  );
  assert.equal((await fetch(url, { method: "POST" })).status, 405);
});
