import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRepository } from './repository.js';

/** The application repository also runs against a D1 adapter in the hosted worker. */
export async function createSqliteRepository({ filename = 'data/careweave.sqlite' } = {}) {
  if (filename !== ':memory:') await mkdir(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  const adapter = {
    all: (sql, params = []) => db.prepare(sql).all(...params),
    get: (sql, params = []) => db.prepare(sql).get(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const output = statements.map(({ sql, params = [] }) => db.prepare(sql).run(...params));
        db.exec('COMMIT');
        return output;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const repository = createRepository(adapter);
  repository.close = () => db.close();
  return repository;
}
