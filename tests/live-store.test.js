import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteLiveStore } from "../backend/live-sqlite.js";
import { createD1LiveStore, LIVE_LIMITS } from "../backend/live-store.js";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const draft = (id = "task-1") => ({
  id,
  patientId: "P0001",
  barrier: "transportation",
  title: "Review transport",
  body: "Review the source note.",
  owner: "Care transitions nurse",
  evidence: [{ sourceId: "P0001-N01", quote: "no reliable ride" }],
});
const result = (count = 26) => ({
  ok: true,
  mode: "rules",
  result: { count },
  answer: "Computed from the graph.",
});

test("saved tasks and investigations survive closing and reopening SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "careweave-live-"));
  const filename = join(directory, "workspace.sqlite");
  let store;
  try {
    store = await createSqliteLiveStore({ filename });
    await store.session("session-a", NOW);
    const created = await store.createTask("session-a", draft(), NOW);
    assert.equal(created.created, true);
    await store.updateTask("session-a", "task-1", "approved", NOW + 1);
    await store.saveRun(
      "session-a",
      "run-1",
      "Which patients need help?",
      result(),
      NOW,
    );
    store.close();
    store = await createSqliteLiveStore({ filename });
    assert.equal(
      (await store.getTask("session-a", "task-1")).status,
      "approved",
    );
    assert.equal((await store.getRun("session-a", "run-1")).result.count, 26);
    assert.equal((await store.listRuns("session-a")).length, 1);
    assert.equal(await store.getTask("session-b", "task-1"), null);
    assert.equal(await store.getRun("session-b", "run-1"), null);
    assert.deepEqual(await store.listTasks("session-b"), []);
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("draft creation is idempotent and task review enforces state transitions", async () => {
  const store = await createSqliteLiveStore({ filename: ":memory:" });
  try {
    await store.session("s", NOW);
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        store.createTask("s", draft(`task-${i}`), NOW),
      ),
    );
    assert.equal(attempts.filter((item) => item.created).length, 1);
    assert.equal(new Set(attempts.map((item) => item.task.id)).size, 1);
    const id = attempts[0].task.id;
    assert.equal(
      (await store.updateTask("s", id, "completed", NOW)).error,
      "invalid_transition",
    );
    assert.equal(
      (await store.updateTask("s", id, "approved", NOW)).task.version,
      2,
    );
    assert.equal(
      (await store.updateTask("s", id, "approved", NOW)).task.version,
      2,
    );
    assert.equal(
      (await store.updateTask("s", id, "draft", NOW)).task.status,
      "draft",
    );
    await store.updateTask("s", id, "approved", NOW);
    assert.equal(
      (await store.updateTask("s", id, "completed", NOW)).task.version,
      5,
    );
    assert.equal(
      (await store.updateTask("s", id, "draft", NOW)).error,
      "invalid_transition",
    );
  } finally {
    store.close();
  }
});

test("history distinguishes incomplete investigations from a successful empty query", async () => {
  const store = await createSqliteLiveStore({ filename: ":memory:" });
  try {
    await store.session("s", NOW);
    await store.saveRun(
      "s",
      "empty",
      "An empty supported query",
      result(0),
      NOW,
    );
    await store.saveRun(
      "s",
      "unsupported",
      "An unsupported question",
      {
        ok: false,
        mode: "rules",
        result: null,
        error: "UNSUPPORTED_QUESTION",
        answer: "Please narrow the question.",
      },
      NOW + 1,
    );
    await store.saveRun(
      "s",
      "interrupted",
      "A model run stopped after querying",
      {
        ok: false,
        mode: "openai",
        result: { count: 26 },
        error: "LIVE_AGENT_UNAVAILABLE",
        answer: "The investigation did not finish.",
      },
      NOW + 2,
    );
    const history = await store.listRuns("s");
    assert.deepEqual(
      history.map(({ id, ok, count }) => ({ id, ok, count })),
      [
        { id: "interrupted", ok: false, count: null },
        { id: "unsupported", ok: false, count: null },
        { id: "empty", ok: true, count: 0 },
      ],
    );
    // The full record retains its partial computation for inspection.
    assert.equal((await store.getRun("s", "interrupted")).result.count, 26);
  } finally {
    store.close();
  }
});

test("atomic rate reservations enforce per-session and shared model budgets", async () => {
  const store = await createSqliteLiveStore({
    filename: ":memory:",
    limits: { ...LIVE_LIMITS, investigationsPerHour: 3, modelRunsPerDay: 4 },
  });
  try {
    for (const id of ["a", "b", "c"]) await store.session(id, NOW);
    const requests = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.reserveRun("a", `a-${i}`, true, NOW),
      ),
    );
    assert.equal(requests.filter(Boolean).length, 3);
    assert.equal(await store.reserveRun("b", "b-1", true, NOW), true);
    assert.equal(await store.reserveRun("c", "c-1", true, NOW), false);
    assert.equal(await store.reserveRun("c", "c-2", false, NOW), true);
    assert.equal(
      await store.reserveRun("a", "a-next", false, NOW + 3600001),
      true,
    );
    assert.equal(
      await store.reserveRun("c", "c-next-day", true, NOW + 86400000),
      true,
    );
  } finally {
    store.close();
  }
});

test("run retention and expiration remove old session state", async () => {
  const store = await createSqliteLiveStore({
    filename: ":memory:",
    limits: { ...LIVE_LIMITS, retainedRuns: 3, sessionDays: 1 },
  });
  try {
    await store.session("a", NOW);
    for (let i = 0; i < 7; i++)
      await store.saveRun("a", `run-${i}`, "Question", result(i), NOW + i);
    assert.deepEqual(
      (await store.listRuns("a")).map((item) => item.id),
      ["run-6", "run-5", "run-4"],
    );
    await store.createTask("a", draft(), NOW);
    assert.equal(await store.hasSession("a", NOW + 86400001), false);
    await store.session("b", NOW + 86400001);
    assert.deepEqual(await store.listTasks("a"), []);
    assert.deepEqual(await store.listRuns("a"), []);
  } finally {
    store.close();
  }
});

test("model hourly budget does not prevent further rules investigations", async () => {
  const store = await createSqliteLiveStore({
    filename: ":memory:",
    limits: { ...LIVE_LIMITS, modelInvestigationsPerHour: 2 },
  });
  try {
    await store.session("a", NOW);
    assert.equal(await store.reserveRun("a", "m-1", true, NOW), true);
    assert.equal(await store.reserveRun("a", "m-2", true, NOW), true);
    assert.equal(await store.reserveRun("a", "m-3", true, NOW), false);
    assert.equal(await store.reserveRun("a", "rules-1", false, NOW), true);
    assert.equal(await store.reserveRun("a", "rules-2", false, NOW), true);
    assert.equal(
      await store.reserveRun("a", "next-hour", true, NOW + 3600001),
      true,
    );
  } finally {
    store.close();
  }
});

test("D1 adapter executes single prepared statements and atomic batches without request-time DDL", async () => {
  // Execute the real generated migration into a separate database, like hosting.
  const { readFile } = await import("node:fs/promises");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(
    await readFile(
      new URL("../drizzle/0002_live_workspace.sql", import.meta.url),
      "utf8",
    ),
  );
  const statements = [];
  const wrap = (sql, params = []) => ({
    bind: (...values) => wrap(sql, values),
    async first() {
      return db.prepare(sql).get(...params) ?? null;
    },
    async all() {
      return { results: db.prepare(sql).all(...params) };
    },
    async run() {
      return {
        meta: { changes: Number(db.prepare(sql).run(...params).changes) },
      };
    },
  });
  const d1 = {
    prepare(sql) {
      assert.equal(sql.includes(";"), false);
      statements.push(sql);
      return wrap(sql);
    },
    async batch(items) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const output = await Promise.all(items.map((item) => item.run()));
        db.exec("COMMIT");
        return output;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  try {
    const store = createD1LiveStore(d1);
    assert.equal(store.kind, "d1");
    await store.session("s", NOW);
    assert.equal(await store.reserveRun("s", "r", false, NOW), true);
    await store.saveRun("s", "r", "Question", result(), NOW);
    assert.equal((await store.getRun("s", "r")).result.count, 26);
    assert.equal((await store.listRuns("s"))[0].ok, true);
    await store.createTask("s", draft(), NOW);
    assert.equal((await store.listTasks("s")).length, 1);
    assert.equal(
      statements.some((sql) => /CREATE|ALTER|DROP/.test(sql)),
      false,
    );
  } finally {
    db.close();
  }
});
