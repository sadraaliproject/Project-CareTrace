import { createRepository } from "./repository.js";
export function createD1Repository(database) {
  const prepare = (sql, params = []) => database.prepare(sql).bind(...params);
  return createRepository({
    all: async (sql, params) => (await prepare(sql, params).all()).results,
    get: (sql, params) => prepare(sql, params).first(),
    run: (sql, params) => prepare(sql, params).run(),
    batch: (statements) =>
      database.batch(statements.map(({ sql, params }) => prepare(sql, params))),
  });
}
