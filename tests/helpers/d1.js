import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";

/** Exercise the production D1 adapter against real SQLite statements and migrations. */
export async function createD1Fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const migrationRoot = new URL("../../drizzle/", import.meta.url);
  for (const file of (await readdir(migrationRoot))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(await readFile(new URL(file, migrationRoot), "utf8"));
  }
  function statement(sql, values = []) {
    return {
      bind: (...params) => statement(sql, params),
      first: async () => database.prepare(sql).get(...values) || null,
      all: async () => ({
        results: database.prepare(sql).all(...values),
        success: true,
      }),
      run: async () => {
        const result = database.prepare(sql).run(...values);
        return {
          success: true,
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
      },
    };
  }
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const prepared of statements) results.push(await prepared.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => database.close(),
  };
}
