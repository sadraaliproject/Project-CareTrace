import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as engine from '../dist/engine.js';
import { createSqliteRepository } from '../backend/sqlite.js';
import { runAgent } from '../backend/agent.js';

const target = resolve('exports');
await mkdir(target, { recursive: true });
const write = (name, value) => writeFile(resolve(target, name), JSON.stringify(value, null, 2) + '\n');
const question = 'Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?';
const parsed = engine.parseQuestion(question);
if (!parsed.ok) throw new Error(parsed.error);
const repository = await createSqliteRepository({ filename: ':memory:' });
let execution;
try {
  await repository.seed();
  execution = await runAgent({ question, repo: repository });
  if (!execution.ok || !execution.result) throw new Error(execution.error || 'The baseline hospital investigation failed.');
} finally { repository.close(); }
const result = execution.result;
await write('synthetic-patients.json', { synthetic: true, snapshot: engine.AS_OF, patients: engine.patients });
await write('ontology.json', engine.ontology);
if (engine.buildGraph) await write('evidence-graph.json', engine.buildGraph());
await write('demo-query-audit.json', { synthetic: true, snapshot: engine.AS_OF, question, ...parsed, count: result.count, patientIds: result.patients.map(p => p.id), fingerprint: result.fingerprint, sql: result.sql, events: execution.events });
await write('replay-events.json', { synthetic: true, snapshot: engine.AS_OF, question, engine: execution.engine, count: result.count, events: execution.events });
const truth = JSON.parse(await readFile(new URL('../ml/hospital-ground-truth.json', import.meta.url), 'utf8'));
await write('extraction-evaluation.json', engine.evaluateExtraction(truth));
console.log(`Exported synthetic data, ontology, evaluation, and query audit to ${target}`);
