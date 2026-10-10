import { readFile, writeFile } from 'node:fs/promises';
import { trainModel, evaluateModel } from '../backend/ml.js';

const corpus = JSON.parse(await readFile(new URL('../ml/corpus.json', import.meta.url), 'utf8'));
const model = trainModel(corpus);
const metrics = evaluateModel(model, corpus);
await writeFile(new URL('../ml/model.json', import.meta.url), JSON.stringify(model, null, 2) + '\n');
await writeFile(new URL('../ml/evaluation.json', import.meta.url), JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify({ model: model.name, trainSize: model.trainSize, testSize: metrics.testSize, accuracy: metrics.accuracy, macroF1: metrics.macroF1, trainingHash: model.trainingHash, note: metrics.limitation }, null, 2));
