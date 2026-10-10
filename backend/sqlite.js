import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRepository } from "./repository.js";

/** The application repository also runs against a D1 adapter in the hosted worker. */
export async function createSqliteRepository({
  filename = "data/careweave.sqlite",
} = {}) {
  if (filename !== ":memory:")
    await mkdir(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  const existing = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='patients'",
    )
    .get();
  if (
    existing &&
    !db
      .prepare("PRAGMA table_info(patients)")
      .all()
      .some((column) => column.name === "diabetes_admission")
  ) {
    // The requested hospital demo replaces the earlier synthetic snapshot.
    // Use the same ordered migration as the hosted database, in one transaction.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        await readFile(
          new URL("../drizzle/0001_hospital_system.sql", import.meta.url),
          "utf8",
        ),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }
  }
  db.exec(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  const adapter = {
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const output = statements.map(({ sql, params = [] }) =>
          db.prepare(sql).run(...params),
        );
        db.exec("COMMIT");
        return output;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const repository = createRepository(adapter);
  repository.close = () => db.close();
  return repository;
}
