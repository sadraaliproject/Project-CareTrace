import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { rawPatients, AS_OF, provenance } from "../dist/pilot-data.js";
import { createPilotGraph } from "../dist/pilot-engine.js";
import {
  evaluateNotes,
  buildSearchIndex,
  groundTruthIds,
} from "../dist/pilot-support.js";
import { BARRIERS, ontology } from "../dist/ontology.js";

const graph = createPilotGraph(rawPatients),
  funnel = graph.funnel(),
  totals = graph.totals();
const evaluation = evaluateNotes();
const plans = JSON.parse(await readFile("dist/prepared/plans.json", "utf8"));
const main = plans.find((plan) => plan.id === "main");
const search = buildSearchIndex();
const truth = groundTruthIds();
const retrieval = [5, 20].map((k) => {
  const result = search.search(main.question, k, truth);
  return {
    k,
    right: result.right,
    wrong: result.wrong,
    uniquePatients: result.uniquePatients,
    neverRead: result.neverRead,
    noteIds: result.results.map((row) => row.noteId),
  };
});
const featured = graph.getPatient(graph.featuredId);
const source = featured.barriers
  .find((barrier) => barrier.type === "transportation")
  .evidence_sources.find((source) => /Bedside/.test(source.note_type));
const note = featured.notes.find((note) => note.id === source.note_id);
assert.equal(funnel.discharges, 1000);
assert.equal(funnel.diabetes, 150);
assert.ok(funnel.gaps >= 55 && funnel.gaps <= 65);
assert.ok(funnel.barrier < funnel.gaps / 2);
assert.equal(
  funnel.groups.reduce((sum, group) => sum + group.count, 0),
  funnel.barrier,
);
assert.equal(funnel.barrier + funnel.standard, funnel.gaps);
assert.ok(funnel.within30 >= funnel.barrier / 2);
assert.ok(funnel.preDischarge >= funnel.barrier * 0.65);
assert.ok(
  evaluation.overall.precision >= 0.8 && evaluation.overall.recall >= 0.8,
);
assert.ok(evaluation.falsePositives.length && evaluation.falseNegatives.length);
assert.ok(
  featured.daysSinceDischarge >= 8 && featured.daysSinceDischarge <= 20,
);
assert.equal(totals.baseEdgeTypes, 9);
assert.equal(Object.keys(totals.byNodeType).length, 10);
for (const plan of plans) {
  const answer = graph.query(plan.filters);
  assert.equal(
    answer.count,
    new Set(answer.patients.map((patient) => patient.id)).size,
  );
  const first = answer.patients[0] || featured;
  const trace = graph.trace(first.id, plan);
  assert.equal(trace.at(-1).answer.count, answer.count);
  for (const event of trace) {
    assert.ok(Number.isFinite(event.ms) && event.ms >= 0);
    for (const id of event.nodes)
      assert.ok(
        graph.nodes.some((node) => node.id === id),
        `Actual node exists: ${id}`,
      );
    for (const id of event.edges)
      assert.ok(
        graph.edges.some((edge) => edge.id === id),
        `Actual edge exists: ${id}`,
      );
  }
}
const resultIds = graph
  .query(main.filters)
  .patients.map((patient) => patient.id);
const graphComparison = {
  count: resultIds.length,
  right: resultIds.filter((id) => truth.has(id)).length,
  wrong: resultIds.filter((id) => !truth.has(id)).length,
  labeledTotal: truth.size,
  missed: [...truth].filter((id) => !resultIds.includes(id)),
};
const original = graph.funnel();
graph.setResolved(featured.id, "transportation");
assert.equal(graph.funnel().barrier, original.barrier - 1);
graph.reset();
assert.deepEqual(graph.funnel(), original);
const report = {
  asOf: AS_OF,
  funnel,
  totals,
  evaluation: {
    overall: evaluation.overall,
    byType: evaluation.byType,
    falsePositives: evaluation.falsePositives.map((row) => ({
      noteId: row.noteId,
      patientId: row.patientId,
      type: row.type,
    })),
    falseNegatives: evaluation.falseNegatives.map((row) => ({
      noteId: row.noteId,
      patientId: row.patientId,
      type: row.type,
    })),
  },
  retrieval,
  graphComparison,
  featured: {
    id: featured.id,
    day: featured.daysSinceDischarge,
    remaining: featured.daysRemaining,
    noteId: note.id,
    writtenAt: note.written_datetime,
    dischargeAt: featured.admission.discharge_datetime,
    author: `${note.author_role} ${note.author_initials}`,
    unit: note.unit,
    sentence: source.evidence_sentence,
    charSpan: source.char_span,
  },
  questions: plans.map((plan) => ({
    id: plan.id,
    shape: graph.query(plan.filters).shape,
    graphCount: graph.query(plan.filters).count,
    labeledCount: groundTruthIds(plan.id).size,
  })),
  provenance,
};
await writeFile(
  "docs/ENHANCEMENT_METRICS.json",
  JSON.stringify(report, null, 2) + "\n",
);
const percent = (value) => `${(value * 100).toFixed(2)}%`;
const text = `# Enhancement verification report\n\nReference date: ${AS_OF}. Generated from the committed data and current graph by \`npm run verify:pilot\`.\n\n## Funnel and action groups\n\n${funnel.discharges} discharges → ${funnel.diabetes} diabetes admissions → ${funnel.gaps} open follow-up gaps → **${funnel.barrier} with a detected current barrier**. ${funnel.standard} receive the standard follow-up call.\n\n| Primary barrier | Patients | Accountable role |\n|---|---:|---|\n${funnel.groups.map((group) => `| ${BARRIERS[group.type].label} | ${group.count} | ${group.owner} |`).join("\n")}\n\n${funnel.groups.map((group) => group.count).join(" + ")} = ${funnel.barrier}. Each patient appears in one primary group; additional needs remain visible. ${funnel.within30} of ${funnel.barrier} are within the first 30 days.\n\n## Note reader evaluation\n\nEach note/type pair is compared with a separate authored answer key. This is a synthetic development evaluation, not clinical validation. The reader was frozen before the initial measurement; eight additional context-challenge notes were then added. The provenance records both measurements.\n\n| Type | TP | FP | FN | Precision | Recall |\n|---|---:|---:|---:|---:|---:|\n| Overall | ${evaluation.overall.tp} | ${evaluation.overall.fp} | ${evaluation.overall.fn} | ${percent(evaluation.overall.precision)} | ${percent(evaluation.overall.recall)} |\n${Object.entries(
  evaluation.byType,
)
  .map(
    ([type, row]) =>
      `| ${BARRIERS[type].label} | ${row.tp} | ${row.fp} | ${row.fn} | ${percent(row.precision)} | ${percent(row.recall)} |`,
  )
  .join(
    "\n",
  )}\n\nInspect a false positive: ${evaluation.falsePositives[0].noteId}; a false negative: ${evaluation.falseNegatives[0].noteId}. The screen provides the complete note and the reader's decision.\n\n## Note search compared with the graph\n\nMain prepared question: “${main.question}”\n\n| Method | Correct unique patients | Incorrect unique patients | Total returned patients | Notes not selected |\n|---|---:|---:|---:|---:|\n${retrieval.map((row) => `| TF-IDF, k=${row.k} notes | ${row.right} | ${row.wrong} | ${row.uniquePatients} | ${row.neverRead} |`).join("\n")}\n| Graph query | ${graphComparison.right} | ${graphComparison.wrong} | ${graphComparison.count} | All ${evaluation.notesRead} read during construction |\n\nThe separate answer key contains ${truth.size} qualifying patients. The graph counts its extracted state exactly but misses ${graphComparison.missed.length} labeled patient (${graphComparison.missed.join(", ")}). An exact graph count does not make extraction perfect. Search ranks notes by actual cosine similarity; the two-dimensional map is a centered PCA projection, including the query point. Search never joins the dated visit and medicine tables.\n\n## Featured patient and earlier opportunity\n\n${featured.id}, day ${featured.daysSinceDischarge}, ${featured.daysRemaining} days remaining in the 30-day window. Selected by the documented clinical/data rules, not by a fixed ID.\n\nEvidence: ${note.id}, ${note.note_type}, ${note.written_datetime}; ${note.author_role} ${note.author_initials}; ${note.unit}.\n\n> ${source.evidence_sentence}\n\nDischarge: ${featured.admission.discharge_datetime}. The note span is ${JSON.stringify(source.char_span)}. Rewinding restricts records and status to facts known at that date.\n\n${funnel.preDischarge}/${funnel.barrier} detected patients had the barrier documented before discharge. ${funnel.missedByTables}/${funnel.barrier} would be missed by looking only at coded social needs.\n\n## Scope and verification\n\nThe active app is a browser-memory demonstration with 15 prepared question routes. Plans and explanations were authored with a language model during development; request-time work uses graph traversal, pattern reading, TF-IDF, PCA and date rules. Cypher-style text explains the actual JavaScript operation; Neo4j is not required or running. Actual call durations are measured.\n\nNo live model integrations, audio generation, staff authentication, hospital connections, external messages, or persistent shared edits are active in this version. Those are excluded by the new brief's runtime constraint. Existing integration source and regression tests remain available for future work, outside the shipped asset allowlist and serving path. The return flag and follow-up rules are simplified demonstration rules.\n\nAutomated verification covers all 15 query routes, ontology and source references, graph totals, date visibility, primary groups, real extraction errors, search ranking, resolution/reset, HTTP serving and disabled integrations. Browser layout and interaction observations are recorded separately in \`docs/UI_VERIFICATION.md\`.\n`;
await writeFile("docs/ENHANCEMENT_REPORT.md", text);
console.log(
  JSON.stringify(
    {
      funnel: {
        discharges: funnel.discharges,
        diabetes: funnel.diabetes,
        gaps: funnel.gaps,
        barrier: funnel.barrier,
        standard: funnel.standard,
      },
      groups: funnel.groups.map((group) => ({
        type: group.type,
        count: group.count,
      })),
      evaluation: evaluation.overall,
      retrieval,
      graphComparison,
      featured: report.featured,
      totals,
    },
    null,
    2,
  ),
);
