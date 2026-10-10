import {
  AS_OF,
  reconcileBarriers,
  parseQuestion,
  evaluateExtraction,
} from "../dist/engine.js";
import truth from "../ml/hospital-ground-truth.json" with { type: "json" };
import { predictText } from "./ml.js";
const headline =
  "Which patients discharged after a diabetes-related admission have a follow-up gap and a documented barrier?";
const cases = [
  {
    id: "transport",
    title: "A current transport obstacle",
    text: "Patient has no ride to the follow-up appointment.",
    expected: [{ type: "transportation", status: "active" }],
  },
  {
    id: "denied",
    title: "Transport is available",
    text: "Denies transportation concerns. Wife drives.",
    expected: [],
  },
  {
    id: "arranged",
    title: "Support was already arranged",
    text: "Transport arranged by SW prior to discharge.",
    expected: [],
  },
  {
    id: "family",
    title: "A relative is a different person",
    text: "Pt's brother lost his job and cannot afford his own medications.",
    expected: [],
  },
  {
    id: "procedure",
    title: "Fasting for a procedure is not food insecurity",
    text: "NPO after midnight, meals held for procedure.",
    expected: [],
  },
  {
    id: "resolved",
    title: "Past cost problems are resolved",
    text: "Previously had trouble affording strips, now has assistance in place.",
    expected: [],
  },
  {
    id: "cost",
    title: "A current medication cost obstacle",
    text: "Patient cannot afford the insulin copay and has not picked it up.",
    expected: [{ type: "cost", status: "active" }],
  },
  {
    id: "literacy",
    title: "Teach-back reveals a support need",
    text: "Patient cannot explain the insulin dose after teach-back.",
    expected: [{ type: "health_literacy", status: "active" }],
  },
];
const normalized = (items) =>
  [...new Set(items.map((item) => `${item.type}:active`))].sort();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function getExtractionMetrics() {
  return evaluateExtraction(truth);
}
/** Executes production extraction and three separate structured queries. */
export async function runProof(repo, { text } = {}) {
  if (
    text !== undefined &&
    (typeof text !== "string" || !text.trim() || text.length > 7000)
  )
    throw Object.assign(
      new Error("Enter a fictional challenge between 1 and 7,000 characters."),
      { status: 400 },
    );
  const evaluated = cases.map((c) => {
    const doc = {
      id: `proof-${c.id}`,
      date: AS_OF,
      note_type: "Bedside nursing note",
      text: c.text,
    };
    const actual = reconcileBarriers([doc], []).map((a) => ({
      ...a,
      status: "active",
    }));
    const sourceVerified = actual.every((a) => doc.text.includes(a.quote));
    return {
      ...c,
      actual,
      sourceVerified,
      passed:
        equal(normalized(actual), normalized(c.expected)) && sourceVerified,
      explanation:
        "Current patient-specific assertions are extracted from the source. Resolved, family-only and clinical look-alike statements create no barrier edge.",
    };
  });
  const parsed = parseQuestion(headline);
  if (!parsed.ok) throw new Error("The hospital proof query is unsupported.");
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await repo.query(parsed.plan));
  const last = results[2],
    counts = results.map((r) => r.count),
    fingerprints = results.map((r) => r.fingerprint),
    ids = results.map((r) => r.patients.map((p) => p.id));
  const evidence = last.patients.flatMap((p) =>
    p.barriers.map((b) => ({ ...b, patientId: p.id })),
  );
  const sources = new Map(
    (
      await repo.getDocuments([...new Set(evidence.map((b) => b.documentId))])
    ).map((n) => [n.id, n]),
  );
  const issues = evidence.flatMap((item) => {
    const source = sources.get(item.documentId);
    return source &&
      source.patientId === item.patientId &&
      source.date === item.date &&
      (source.text || source.display || "").includes(item.quote)
      ? []
      : [
          {
            patientId: item.patientId,
            documentId: item.documentId,
            reason: "Source ownership, date, or quote mismatch.",
          },
        ];
  });
  return {
    cases: evaluated,
    summary: {
      passed: evaluated.filter((c) => c.passed).length,
      total: evaluated.length,
    },
    repeatability: {
      question: headline,
      count: last.count,
      counts,
      fingerprints,
      firstFingerprint: fingerprints[0],
      secondFingerprint: fingerprints[1],
      passed:
        new Set(counts).size === 1 &&
        new Set(fingerprints).size === 1 &&
        ids.every((list) => equal(list, ids[0])),
    },
    evidenceCoverage: {
      total: evidence.length,
      checked: evidence.length,
      verified: evidence.length - issues.length,
      passed: !issues.length,
      issues,
    },
    extraction: getExtractionMetrics(),
    ...(text === undefined
      ? {}
      : {
          custom: {
            text,
            assertions: reconcileBarriers(
              [
                {
                  id: "custom-proof",
                  text,
                  date: AS_OF,
                  note_type: "Bedside nursing note",
                },
              ],
              [],
            ),
            guardrails: predictText(text).guardrails,
            persisted: false,
          },
        }),
    synthetic: true,
    snapshot: AS_OF,
    limitations: [
      "Ground truth is separately stored and manually labeled. This developer-authored evaluation is not clinical validation.",
      "Three repeat queries verify deterministic counts for the current snapshot, not future clinical outcomes.",
      "Exact source presence proves provenance, not causation. Live OpenAI planning is a separate service and is not certified by this check.",
    ],
  };
}
