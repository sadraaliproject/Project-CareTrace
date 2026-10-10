/** One SQL statement per operation; D1 batches and SQLite batches are atomic. */
export const LIVE_LIMITS = Object.freeze({
  investigationsPerHour: 60,
  modelInvestigationsPerHour: 12,
  modelRunsPerDay: 50,
  investigationsPerDay: 500,
  retainedRuns: 20,
  tasksPerSession: 100,
  sessionDays: 30,
  maxQuestionCharacters: 1200,
  requestBytes: 8192,
  runTimeoutMs: 45000,
});

const DAY = 86400000;
const iso = (value) => new Date(value).toISOString();
const parseTask = (row) =>
  row
    ? {
        id: row.id,
        patientId: row.patient_id,
        barrier: row.barrier,
        title: row.title,
        body: row.body,
        owner: row.owner,
        evidence: JSON.parse(row.evidence_json),
        status: row.status,
        version: row.version,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        demoOnly: true,
      }
    : null;
const changed = (result) =>
  Number(result?.changes ?? result?.meta?.changes ?? 0);

export function createLiveStore(
  adapter,
  { kind = "sqlite", limits = LIVE_LIMITS } = {},
) {
  const store = {
    kind,
    persistent: true,
    limits,
    async session(id, now = Date.now()) {
      // Expired state and budget reservations are reclaimed on the next visit.
      await adapter.batch([
        { sql: "DELETE FROM live_usage WHERE expires_at <= ?", params: [now] },
        {
          sql: "DELETE FROM live_sessions WHERE expires_at <= ?",
          params: [now],
        },
        {
          sql: "INSERT INTO live_sessions (id, created_at, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
          params: [id, now, now + limits.sessionDays * DAY],
        },
      ]);
      return { id };
    },
    async hasSession(id, now = Date.now()) {
      return Boolean(
        await adapter.get(
          "SELECT id FROM live_sessions WHERE id = ? AND expires_at > ?",
          [id, now],
        ),
      );
    },
    async reserveRun(sessionId, id, modelRun, now = Date.now()) {
      const hour = now - 3600000;
      const day = Math.floor(now / DAY) * DAY;
      // The check and reservation are one write statement, preventing concurrent
      // requests from both observing the final available slot.
      const result = await adapter.run(
        `INSERT INTO live_usage (id, session_id, model_run, created_at, expires_at)
        SELECT ?, ?, ?, ?, ? WHERE
        (SELECT count(*) FROM live_usage WHERE session_id = ? AND created_at > ?) < ?
        AND (SELECT count(*) FROM live_usage WHERE created_at >= ?) < ?
        AND (? = 0 OR (SELECT count(*) FROM live_usage WHERE session_id = ? AND model_run = 1 AND created_at > ?) < ?)
        AND (? = 0 OR (SELECT count(*) FROM live_usage WHERE model_run = 1 AND created_at >= ?) < ?)`,
        [
          id,
          sessionId,
          modelRun ? 1 : 0,
          now,
          now + 2 * DAY,
          sessionId,
          hour,
          limits.investigationsPerHour,
          day,
          limits.investigationsPerDay,
          modelRun ? 1 : 0,
          sessionId,
          hour,
          limits.modelInvestigationsPerHour,
          modelRun ? 1 : 0,
          day,
          limits.modelRunsPerDay,
        ],
      );
      return changed(result) === 1;
    },
    async saveRun(sessionId, id, question, result, now = Date.now()) {
      await adapter.batch([
        {
          sql: "INSERT INTO live_runs (id, session_id, question, mode, count, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          params: [
            id,
            sessionId,
            question,
            result.mode,
            result.result?.count ?? 0,
            JSON.stringify(result),
            now,
          ],
        },
        {
          sql: "DELETE FROM live_runs WHERE session_id = ? AND id NOT IN (SELECT id FROM live_runs WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)",
          params: [sessionId, sessionId, limits.retainedRuns],
        },
      ]);
      return { ...result, runId: id, createdAt: iso(now) };
    },
    async listRuns(sessionId) {
      const rows = await adapter.all(
        "SELECT id, question, mode, count, json_extract(result_json, '$.ok') AS ok, created_at FROM live_runs WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
        [sessionId, limits.retainedRuns],
      );
      return rows.map((row) => ({
        id: row.id,
        question: row.question,
        mode: row.mode,
        ok: row.ok === 1,
        count: row.ok === 1 ? row.count : null,
        createdAt: iso(row.created_at),
      }));
    },
    async getRun(sessionId, id) {
      const row = await adapter.get(
        "SELECT result_json, created_at FROM live_runs WHERE session_id = ? AND id = ?",
        [sessionId, id],
      );
      return row
        ? {
            ...JSON.parse(row.result_json),
            runId: id,
            createdAt: iso(row.created_at),
          }
        : null;
    },
    async listTasks(sessionId) {
      return (
        await adapter.all(
          "SELECT * FROM live_tasks WHERE session_id = ? ORDER BY updated_at DESC, id DESC",
          [sessionId],
        )
      ).map(parseTask);
    },
    async getTask(sessionId, id) {
      return parseTask(
        await adapter.get(
          "SELECT * FROM live_tasks WHERE session_id = ? AND id = ?",
          [sessionId, id],
        ),
      );
    },
    async createTask(sessionId, draft, now = Date.now()) {
      const result = await adapter.run(
        `INSERT INTO live_tasks (id, session_id, patient_id, barrier, title, body, owner, evidence_json, status, version, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?
        WHERE (SELECT count(*) FROM live_tasks WHERE session_id = ?) < ?
        ON CONFLICT(session_id, patient_id, barrier) DO NOTHING`,
        [
          draft.id,
          sessionId,
          draft.patientId,
          draft.barrier,
          draft.title,
          draft.body,
          draft.owner,
          JSON.stringify(draft.evidence),
          now,
          now,
          sessionId,
          limits.tasksPerSession,
        ],
      );
      const row = await adapter.get(
        "SELECT * FROM live_tasks WHERE session_id = ? AND patient_id = ? AND barrier = ?",
        [sessionId, draft.patientId, draft.barrier],
      );
      if (!row) return { task: null, created: false, limitReached: true };
      return { task: parseTask(row), created: changed(result) === 1 };
    },
    async updateTask(sessionId, id, status, now = Date.now()) {
      const task = await store.getTask(sessionId, id);
      if (!task) return { task: null, error: "not_found" };
      if (task.status === status) return { task };
      const allowed = {
        draft: ["approved"],
        approved: ["draft", "completed"],
        completed: [],
      };
      if (!allowed[task.status].includes(status))
        return { task, error: "invalid_transition" };
      const result = await adapter.run(
        "UPDATE live_tasks SET status = ?, version = version + 1, updated_at = ? WHERE session_id = ? AND id = ? AND version = ?",
        [status, now, sessionId, id, task.version],
      );
      if (!changed(result))
        return { task: await store.getTask(sessionId, id), error: "conflict" };
      return { task: await store.getTask(sessionId, id) };
    },
  };
  return store;
}

export function createD1LiveStore(database, options = {}) {
  if (!database?.prepare || !database?.batch)
    throw new Error("Durable database binding is required.");
  const prepare = (sql, params = []) => database.prepare(sql).bind(...params);
  return createLiveStore(
    {
      all: async (sql, params) => (await prepare(sql, params).all()).results,
      get: (sql, params) => prepare(sql, params).first(),
      run: (sql, params) => prepare(sql, params).run(),
      batch: (statements) =>
        database.batch(
          statements.map(({ sql, params }) => prepare(sql, params)),
        ),
    },
    { ...options, kind: "d1" },
  );
}
