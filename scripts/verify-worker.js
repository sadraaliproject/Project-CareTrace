import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PUBLIC_ASSETS } from "../backend/prototype.js";
import worker from "../dist/server/index.js";

const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("Unexpected external request");
};
try {
  for (const asset of PUBLIC_ASSETS) {
    const response = await worker.fetch(
      new Request(`https://careweave.test/${asset}`),
    );
    assert.equal(response.status, 200, asset);
    assert.equal(
      await response.text(),
      await readFile(`dist/${asset}`, "utf8"),
      asset,
    );
  }
  const index = await worker.fetch(new Request("https://careweave.test/"));
  assert.match(await index.text(), /pilot-app\.js/);
  const status = await worker.fetch(
    new Request("https://careweave.test/api/status"),
  );
  assert.equal((await status.json()).externalRequests, false);
  for (const path of [
    "/api/agent",
    "/api/care-brief",
    "/api/audio",
    "/api/tasks",
    "/api/seed",
  ])
    for (const method of ["GET", "POST"])
      assert.equal(
        (
          await worker.fetch(
            new Request(`https://careweave.test${path}`, { method }),
          )
        ).status,
        410,
      );
  for (const path of [
    "/.env",
    "/app.js",
    "/care-studio.js",
    "/hospital-data.js",
    "/server.js",
    "/backend/api.js",
  ])
    assert.equal(
      (await worker.fetch(new Request(`https://careweave.test${path}`))).status,
      404,
    );
  const bundle = await readFile("dist/server/index.js", "utf8");
  for (const secret of [
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "ELEVENLABS_API_KEY",
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "api.elevenlabs.io",
  ])
    assert.equal(
      bundle.includes(secret),
      false,
      `${secret} excluded from active bundle`,
    );
  console.log(
    `Bundled Worker verified: all ${PUBLIC_ASSETS.length} assets match source; retired APIs disabled; no external requests; no environment secret access.`,
  );
} finally {
  globalThis.fetch = originalFetch;
}
