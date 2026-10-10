import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as engine from '../dist/engine.js';

const target = resolve('exports');
await mkdir(target, { recursive: true });
const write = (name, value) => writeFile(resolve(target, name), JSON.stringify(value, null, 2) + '\n');
const parsed = engine.parseQuestion('Find diabetic patients missing an A1c test because they cannot get transportation.');
if (!parsed.ok) throw new Error(parsed.error);
const result = engine.runQuery(parsed.plan);
await write('synthetic-patients.json', { synthetic: true, snapshot: engine.AS_OF, patients: engine.patients });
await write('ontology.json', engine.ontology);
if (engine.buildGraph) await write('evidence-graph.json', engine.buildGraph());
await write('demo-query-audit.json', { synthetic: true, snapshot: engine.AS_OF, question: 'Find diabetic patients missing an A1c test because they cannot get transportation.', ...parsed, count: result.count, patientIds: result.patients.map(p => p.id), fingerprint: result.fingerprint, events: result.events });
await write('extraction-evaluation.json', engine.evaluateExtraction());
console.log(`Exported synthetic data, ontology, evaluation, and query audit to ${target}`);
