import test from "node:test";
import assert from "node:assert/strict";
import { rawPatients } from "../dist/pilot-data.js";
import {
  createPilotGraph,
  daysBetween,
  queryText,
  AS_OF,
} from "../dist/pilot-engine.js";
import { ontology } from "../dist/ontology.js";

test("pilot joins are selective, disjoint by primary barrier, and stable across fresh graphs", () => {
  const graphs = Array.from({ length: 3 }, () => createPilotGraph(rawPatients));
  const funnel = graphs[0].funnel();
  assert.equal(funnel.discharges, rawPatients.length);
  assert.ok(funnel.gaps < funnel.diabetes / 2);
  assert.ok(funnel.barrier < funnel.gaps / 2);
  assert.equal(funnel.barrier + funnel.standard, funnel.gaps);
  assert.equal(
    funnel.groups.reduce((sum, group) => sum + group.count, 0),
    funnel.barrier,
  );
  assert.equal(
    new Set(funnel.groups.flatMap((group) => group.patientIds)).size,
    funnel.barrier,
  );
  assert.deepEqual(graphs[1].funnel(), funnel);
  assert.deepEqual(graphs[2].totals(), graphs[0].totals());
  assert.equal(AS_OF, "2026-10-10");
});

test("every graph endpoint exists, follows the ontology, and links back to a source", () => {
  const graph = createPilotGraph(rawPatients);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  assert.equal(nodes.size, graph.nodes.length);
  assert.equal(
    new Set(graph.edges.map((edge) => edge.id)).size,
    graph.edges.length,
  );
  for (const node of nodes.values())
    assert.ok(node.source.table && node.source.row, node.id);
  for (const edge of graph.edges) {
    assert.ok(nodes.has(edge.source) && nodes.has(edge.target), edge.id);
    assert.ok(
      ontology.paths.some(
        ([from, relationship, to]) =>
          from === nodes.get(edge.source).type &&
          relationship === edge.type &&
          to === nodes.get(edge.target).type,
      ),
      edge.id,
    );
    if (edge.type === "REPORTED_BARRIER")
      assert.ok(edge.note_id && edge.evidence_sentence && edge.confidence > 0);
  }
  assert.equal(
    Object.keys(graph.totals().byNodeType).length,
    ontology.nodeTypes.length,
  );
  assert.equal(
    Object.values(graph.totals().byEdgeType).reduce((a, b) => a + b, 0),
    graph.edges.length,
  );
});

test("featured patient is chosen from facts and survives reordering and a temporary resolution", () => {
  const graph = createPilotGraph(rawPatients);
  const patient = graph.getPatient(graph.featuredId);
  assert.ok(patient);
  assert.ok(
    patient.daysSinceDischarge >= 8 && patient.daysSinceDischarge <= 20,
  );
  assert.match(patient.admission.principalDiagnosis, /ketoacidosis|dka/i);
  assert.equal(patient.barriers.length, 1);
  assert.equal(patient.primary_barrier, "transportation");
  assert.equal(patient.socialNeeds.length, 0);
  assert.ok(
    patient.barriers[0].evidence_sources.some(
      (source) =>
        /bedside/i.test(source.note_type) &&
        source.date < patient.admission.dischargeDate,
    ),
  );
  const shifted = createPilotGraph(rawPatients.slice(1));
  assert.ok(shifted.featuredId && shifted.featuredId !== graph.featuredId);
  graph.setResolved(patient.id, "transportation");
  assert.equal(graph.featuredId, patient.id);
});

test("rewind hides future outcomes, pickup records, notes and derived gaps", () => {
  const graph = createPilotGraph(rawPatients),
    patient = graph.getPatient(graph.featuredId);
  const rewind = graph.patientGraph(patient.id, {
    asOf: patient.admission.dischargeDate,
  });
  assert.ok(!rewind.nodes.some((node) => node.type === "FollowUpGap"));
  assert.ok(
    !rewind.edges.some(
      (edge) =>
        edge.type === "LIKELY_TO_RETURN" && patient.daysSinceDischarge > 0,
    ),
  );
  assert.ok(
    rewind.nodes
      .filter((node) => node.type === "Appointment")
      .every((node) => node.properties.status === "scheduled"),
  );
  assert.ok(
    rewind.nodes
      .filter((node) => node.type === "Medication")
      .every((node) => node.properties.pickupDate === null),
  );
  assert.ok(
    rewind.nodes
      .filter((node) => node.type === "ClinicalNote")
      .every((node) => node.properties.date <= patient.admission.dischargeDate),
  );
  const today = graph.patientGraph(patient.id);
  assert.ok(today.nodes.some((node) => node.type === "FollowUpGap"));
  assert.ok(today.nodes.length <= 50);
  assert.equal(
    daysBetween(patient.admission.dischargeDate),
    patient.daysSinceDischarge,
  );
});

test("resolving an edge recomputes groups, keeps its evidence and reset restores the graph", () => {
  const graph = createPilotGraph(rawPatients),
    before = graph.funnel(),
    patient = graph.getPatient(graph.featuredId);
  const savedEdge = graph.edges.find(
    (edge) => edge.source === patient.id && edge.type === "REPORTED_BARRIER",
  );
  assert.equal(graph.setResolved(patient.id, patient.primary_barrier), true);
  assert.equal(graph.funnel().barrier, before.barrier - 1);
  assert.equal(graph.funnel().standard, before.standard + 1);
  assert.ok(
    !graph
      .query({ id: "main" })
      .patients.some((item) => item.id === patient.id),
  );
  const resolvedEdge = graph.edges.find((edge) => edge.id === savedEdge.id);
  assert.equal(resolvedEdge.resolved, true);
  assert.equal(resolvedEdge.active, false);
  assert.equal(resolvedEdge.evidence_sentence, savedEdge.evidence_sentence);
  assert.equal(graph.setResolved("does-not-exist", "cost"), false);
  graph.reset();
  assert.deepEqual(graph.funnel(), before);
});

test("questions produce distinct shapes and emergency returns are joined to actual rows", () => {
  const graph = createPilotGraph(rawPatients);
  assert.equal(graph.query({ id: "units" }).shape, "units");
  assert.equal(
    graph.query({ id: "units" }).rows.reduce((sum, row) => sum + row.count, 0),
    graph.patients.filter(
      (patient) => patient.admission.diabetesRelated && patient.barriers.length,
    ).length,
  );
  assert.equal(graph.query({ id: "before-discharge" }).shape, "noteTypes");
  const returns = graph.query({ id: "ed-returns" });
  assert.equal(returns.shape, "returns");
  for (const row of returns.rows) {
    const patient = graph.getPatient(row.patientId);
    assert.ok(
      patient.emergencyVisits.some(
        (visit) => visit.id === row.returnId && visit.date === row.returnDate,
      ),
    );
    assert.ok(row.daysToReturn > 0);
    assert.equal(
      row.daysToReturn,
      daysBetween(row.missedVisitDate, row.returnDate),
    );
    assert.equal(row.source.table, "emergency_department_visits");
  }
  assert.equal(graph.query({ id: "main", ageMin: 121 }).count, 0);
  for (const id of [
    "main",
    "cost",
    "return-risk",
    "units",
    "before-discharge",
    "ed-returns",
    "transportation",
    "food",
    "health-literacy",
    "dual",
    "within30",
    "standard",
    "uncoded",
    "no-pickup",
    "all",
  ]) {
    const answer = graph.query({ id });
    assert.equal(
      answer.count,
      new Set(answer.patients.map((patient) => patient.id)).size,
    );
    assert.match(queryText({ id }), /MATCH/);
  }
});

test("a resolved coded need does not become a current barrier", () => {
  const raw = structuredClone(
    rawPatients.find((patient) => !patient.notes.length),
  );
  raw.socialNeeds = [
    {
      id: `${raw.id}-Z01`,
      type: "cost",
      code: "Z59.86",
      date: raw.admission.dischargeDate,
      display: "Financial difficulty",
      resolved: true,
    },
  ];
  const graph = createPilotGraph([raw]);
  assert.equal(graph.patients[0].barriers.length, 0);
  assert.ok(
    !graph.edges.some(
      (edge) => edge.type === "REPORTED_BARRIER" && edge.active,
    ),
  );
});

test("construction events finish at actual totals and expose measured execution times", () => {
  const graph = createPilotGraph(rawPatients),
    events = graph.buildEvents(),
    totals = graph.totals();
  assert.deepEqual(events.at(-1).totals, {
    nodes: totals.nodes,
    edges: totals.edges,
    notesRead: totals.notesRead,
  });
  assert.deepEqual(events.at(-1).byNodeType, totals.byNodeType);
  assert.deepEqual(events.at(-1).byEdgeType, totals.byEdgeType);
  const nodeIds = new Set(),
    edgeIds = new Set();
  let rowsRead = 0,
    sentencesRead = 0;
  for (const event of events) {
    event.nodes.forEach((id) => nodeIds.add(id));
    event.edges.forEach((id) => edgeIds.add(id));
    assert.equal(event.totals.nodes, nodeIds.size);
    assert.equal(event.totals.edges, edgeIds.size);
    rowsRead += event.rowsRead;
    sentencesRead += event.sentencesRead;
    assert.equal(event.counters.toolCalls, event.step);
    assert.equal(event.counters.nodesVisited, nodeIds.size);
    assert.equal(event.counters.edgesFollowed, edgeIds.size);
    assert.equal(event.counters.rowsRead, rowsRead);
    assert.equal(event.counters.sentencesRead, sentencesRead);
    assert.ok(
      Object.values(event.counters).every(
        (value) => Number.isInteger(value) && value >= 0,
      ),
    );
    if (event.tool === "load_table" || event.tool === "load_notes") {
      assert.equal(event.rowsRead, event.rows.length);
      assert.equal(event.sentencesRead, 0);
    }
    if (event.tool === "read_notes") {
      assert.equal(
        event.rowsRead,
        rawPatients.reduce((sum, patient) => sum + patient.notes.length, 0),
      );
      assert.equal(
        event.sentencesRead,
        rawPatients
          .flatMap((patient) => patient.notes)
          .reduce(
            (sum, note) => sum + graph.reading(note.id).sentences.length,
            0,
          ),
      );
    }
    if (event.tool === "apply_rules") {
      assert.equal(event.rowsRead, 0);
      assert.equal(event.sentencesRead, 0);
      assert.ok(event.rows.length > 0);
    }
    assert.ok(Number.isFinite(event.ms) && event.ms >= 0);
  }
});

test("trace empty lookup reroutes to real reader output and its counters match emitted events", () => {
  const graph = createPilotGraph(rawPatients),
    events = graph.trace(graph.featuredId);
  const codedIndex = events.findIndex(
    (event) => event.args.table === "coded_social_needs",
  );
  assert.ok(codedIndex >= 0);
  assert.equal(events[codedIndex].rows.length, 0);
  assert.equal(events[codedIndex].pauseMs, 1000);
  const read = events[codedIndex + 1];
  assert.equal(read.tool, "read_note");
  assert.equal(read.rerouted, true);
  assert.ok(read.reader.sentences.length && read.writes.length);
  const nodes = new Set(),
    edges = new Set();
  let rows = 0,
    sentences = 0;
  for (const event of events) {
    event.nodes.forEach((id) => nodes.add(id));
    event.edges.forEach((id) => edges.add(id));
    rows += event.rowsRead || 0;
    sentences += event.sentencesRead || 0;
    assert.deepEqual(event.counters, {
      toolCalls: event.step,
      nodesVisited: nodes.size,
      edgesFollowed: edges.size,
      rowsRead: rows,
      sentencesRead: sentences,
    });
    assert.ok(
      event.ms >= 0 && event.thought && event.observation && event.query,
    );
    if (event.tool === "read_table")
      assert.deepEqual(
        event.rows,
        graph
          .readTable(event.args.table)
          .filter(
            (row) =>
              row.patientId === graph.featuredId ||
              (event.args.table === "patients" && row.id === graph.featuredId),
          ),
      );
  }
  assert.equal(events.at(-1).answer.count, graph.query({ id: "main" }).count);
  const noNotes = graph.patients.find((patient) => !patient.notes.length);
  const empty = graph.trace(noNotes.id);
  assert.ok(
    empty.some((event) => event.tool === "read_notes" && !event.rows.length),
  );
});
