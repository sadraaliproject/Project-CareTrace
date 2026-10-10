import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createLiveStore } from "./live-store.js";

/** Initialize the additive workspace tables once, before accepting requests. */
export async function createSqliteLiveStore({
  filename = "data/careweave-live.sqlite",
  limits,
} = {}) {
  if (filename !== ":memory:")
    await mkdir(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    if (
      !db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='live_sessions'",
        )
        .get()
    ) {
      const migration = await readFile(
        new URL("../drizzle/0002_live_workspace.sql", import.meta.url),
        "utf8",
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(migration);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    const store = createLiveStore(
      {
        all: (sql, params = []) => db.prepare(sql).all(...params),
        get: (sql, params = []) => db.prepare(sql).get(...params),
        run: (sql, params = []) => db.prepare(sql).run(...params),
        batch(statements) {
          db.exec("BEGIN IMMEDIATE");
          try {
            const results = statements.map(({ sql, params = [] }) =>
              db.prepare(sql).run(...params),
            );
            db.exec("COMMIT");
            return results;
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        },
      },
      { kind: "sqlite", ...(limits ? { limits } : {}) },
    );
    store.close = () => db.close();
    return store;
  } catch (error) {
    db.close();
    throw error;
  }
}
