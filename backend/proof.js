import { AS_OF, extractBarriers, reconcileBarriers, parseQuestion } from '../dist/engine.js';
import { predictText } from './ml.js';

const assertion = (type, status = 'active') => ({ type, status });
const headline = 'Find diabetic patients missing A1c tests with transportation barriers';
const cases = [
  { id: 'direct', title: 'A direct, current obstacle', text: 'I have no transportation to my appointments.', expected: [assertion('transportation')] },
  { id: 'denial', title: 'A denial does not invent a barrier', text: 'Patient denies transportation problems.', expected: [] },
  { id: 'resolution', title: 'No longer needing help means resolved', text: 'I no longer need transportation help.', expected: [assertion('transportation', 'resolved')] },
  { id: 'lost-access', title: 'No longer having a ride means active', text: 'I no longer have a ride.', expected: [assertion('transportation')] },
  { id: 'unresolved', title: 'Not resolved is still active', text: 'The transportation barrier is not resolved.', expected: [assertion('transportation')] },
  { id: 'family', title: 'A relative is a different person', text: 'Her mother cannot get a ride and cannot afford the medication copay.', expected: [] },
  { id: 'conditional', title: 'Possible future need is not current evidence', text: 'If the patient cannot get transportation and cannot afford medication, discuss resources.', expected: [] },
  { id: 'mixed-status', title: 'One resolved barrier, one active barrier', text: 'Transportation is resolved and I cannot afford the medication copay.', expected: [assertion('transportation', 'resolved'), assertion('cost')] },
  { id: 'scoped-denial', title: 'Negation stays with its own barrier', text: 'Patient denies transportation problems and cannot afford medication.', expected: [assertion('cost')] },
  { id: 'scoped-access', title: 'Reliable transportation does not erase cost evidence', text: 'Patient has reliable transportation and cannot afford the medication copay.', expected: [assertion('cost')] },
  { id: 'food-cost', title: 'Food affordability is not medication cost', text: 'Patient cannot afford food.', expected: [assertion('food')] },
  { id: 'two-people', title: 'Separate the relative from the patient', text: 'Her mother cannot get transportation and the patient cannot afford medication.', expected: [assertion('cost')] },
  { id: 'source-order', title: 'Source dates beat input order', documents: [
    { id: 'proof-new', date: '2026-10-09', text: 'Patient denies transportation problems.' },
    { id: 'proof-old', date: '2026-08-01', text: 'Patient cannot get a ride to the clinic.' }
  ], expected: [assertion('transportation', 'resolved')], explanation: 'Reconciliation reads the source dates. The newer denial supersedes the older active statement, even when documents arrive in reverse order.' },
  { id: 'reopened', title: 'A lost ride reopens a resolved barrier', documents: [
    { id: 'proof-active', date: '2026-07-01', text: 'Patient cannot get a ride to the clinic.' },
    { id: 'proof-resolved', date: '2026-08-01', text: 'I no longer need transportation help.' },
    { id: 'proof-reopened', date: '2026-10-09', text: 'I no longer have a ride.' }
  ], expected: [assertion('transportation')] }
];

const normalized = values => [...new Set(values.map(value => `${value.type}:${value.status}`))].sort();
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = message => Object.assign(new Error(message), { status: 400 });

/** Execute the same extractor, reconciliation and SQL repository used by the app. */
export async function runProof(repo, { text } = {}) {
  if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 7000)) throw fail('Enter a synthetic challenge between 1 and 7,000 characters.');
  const evaluated = cases.map(testCase => {
    const documents = (testCase.documents || [{ id: `proof-${testCase.id}`, date: AS_OF, text: testCase.text }]).map(document => ({ ...document, type: 'Synthetic proof challenge' }));
    const assertions = testCase.documents ? reconcileBarriers(documents) : extractBarriers(documents[0]);
    const actual = assertions.map(({ type, status, quote, documentId, date }) => ({ type, status, quote, documentId, date }));
    const sourceVerified = actual.every(item => documents.some(document => document.id === item.documentId && document.text.includes(item.quote)));
    return {
      id: testCase.id, title: testCase.title,
      text: testCase.text || documents.map(document => `${document.date}: ${document.text}`).join('\n'),
      expected: testCase.expected, actual,
      passed: equal(normalized(testCase.expected), normalized(actual)) && sourceVerified,
      sourceVerified, explanation: testCase.explanation || 'Expected labels were manually specified. Actual labels and exact source quotes are computed by the production extraction rules for this run.'
    };
  });

  const { plan } = parseQuestion(headline);
  const first = await repo.query(plan), second = await repo.query(plan);
  const firstIds = first.patients.map(patient => patient.id), secondIds = second.patients.map(patient => patient.id);
  const repeatability = {
    question: headline, count: second.count, firstCount: first.count, secondCount: second.count,
    firstFingerprint: first.fingerprint, secondFingerprint: second.fingerprint,
    passed: first.count === second.count && first.fingerprint === second.fingerprint && equal(firstIds, secondIds)
  };

  // Fetch authoritative source rows separately; do not accept a highlighted
  // excerpt solely because it was copied into a query result.
  const evidence = second.patients.flatMap(patient => patient.barriers
    .filter(barrier => barrier.type === 'transportation' && barrier.status === 'active')
    .map(barrier => ({ patientId: patient.id, ...barrier })));
  const documentIds = [...new Set(evidence.map(item => item.documentId))];
  // One bounded SQL request avoids one database query per patient on hosted D1.
  const sources = new Map((await repo.getDocuments(documentIds)).map(document => [document.id, document]));
  const issues = evidence.flatMap(item => {
    const source = sources.get(item.documentId);
    const verified = source && source.patientId === item.patientId && source.id === item.documentId && source.date === item.date && typeof item.quote === 'string' && item.quote.length > 0 && source.text.includes(item.quote);
    return verified ? [] : [{ patientId: item.patientId, documentId: item.documentId, reason: 'Source ownership, date, or exact quotation could not be verified.' }];
  });
  const evidenceCoverage = { total: evidence.length, checked: evidence.length, verified: evidence.length - issues.length, passed: issues.length === 0, issues };
  let custom;
  if (text !== undefined) {
    const prediction = predictText(text);
    custom = { text, assertions: extractBarriers({ id: 'custom-proof', text, date: AS_OF, type: 'Synthetic proof challenge' }), guardrails: prediction.guardrails, persisted: false };
  }
  return {
    cases: evaluated, summary: { passed: evaluated.filter(testCase => testCase.passed).length, total: evaluated.length },
    repeatability, evidenceCoverage, ...(custom ? { custom } : {}), synthetic: true, snapshot: AS_OF,
    limitations: [
      'These manually curated synthetic challenges are developer regression checks, not an independent clinical evaluation or a guarantee for arbitrary language.',
      'This proof executes deterministic extraction and SQL queries. It does not certify OpenAI planning or live service availability.',
      'Repeatability applies to these two reads of the current snapshot. Concurrent source changes can legitimately change the result.',
      'A source match verifies provenance and patient ownership; it does not establish clinical truth or causation. No notes, tasks, or patient records are changed.'
    ]
  };
}
