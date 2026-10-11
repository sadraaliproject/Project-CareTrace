import { rawPatients, AS_OF } from "./pilot-data.js";
import { createPilotGraph } from "./pilot-engine.js";
import { readNote } from "./pilot-reader.js";
import { BARRIERS, ontology } from "./ontology.js";
import * as support from "./pilot-support.js";
import { createPilotCanvas, pilotGraphColors } from "./pilot-graph.js";

const $ = (s) => document.querySelector(s);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (n) => Number(n || 0).toLocaleString("en-US");
const percent = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");
const date = (value) =>
  value
    ? new Date(String(value).slice(0, 10) + "T12:00:00Z").toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
      )
    : "Not recorded";
const time = (value) =>
  value
    ? `${date(value)} · ${String(value).slice(11, 16) || "Time not recorded"}`
    : "Not recorded";
const dayDiff = (a, b) =>
  Math.round(
    (Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) /
      86400000,
  );
const marker = (text) => `<span class="source-marker">${escape(text)}</span>`;
const button = (label, action, extra = "", tone = "") =>
  `<button class="control ${tone}" data-action="${action}" ${extra}>${label}</button>`;
const labels = (type) =>
  BARRIERS[type]?.label ||
  (type === "standard"
    ? "Standard discharge call"
    : String(type || "").replaceAll("_", " "));
const action = (type) =>
  BARRIERS[type]?.action ||
  "Call to check the discharge plan and arrange the missed follow-up visit.";
const owner = (type) => BARRIERS[type]?.owner || "Care transitions nurse";
const SCREENS = [
  {
    id: "systems",
    short: "One patient",
    title: "Three systems, one patient",
    eyebrow: "01 / Connect the story",
    sub: "Every missed visit has a story. Find the part the chart could not tell you.",
  },
  {
    id: "building",
    short: "Build the graph",
    title: "A connected picture of care",
    eyebrow: "02 / Assemble the evidence",
    sub: "Hospital rows and the words in a chart become one connected view.",
  },
  {
    id: "search",
    short: "What search finds",
    title: "What can a search actually see?",
    eyebrow: "03 / A fair comparison",
    sub: "Read the closest notes. Then look at what is still missing.",
  },
  {
    id: "reading",
    short: "Read the note",
    title: "The reason was in the nurse’s words",
    eyebrow: "04 / Read in context",
    sub: "A sentence matters only when it describes this patient, now.",
  },
  {
    id: "investigation",
    short: "The investigation",
    title: "Follow the evidence, one step at a time",
    eyebrow: "05 / The CareTrace investigator",
    sub: "Start with what happened. Keep going until there is something the care team can do.",
  },
  {
    id: "discharges",
    short: "Every discharge",
    title: "One patient’s story. Every discharge.",
    eyebrow: "06 / Find the people behind the list",
    sub: "The same route finds the people who need a different next step.",
  },
  {
    id: "answer",
    short: "The answer",
    title: "The right next step, for the right person",
    eyebrow: "07 / From evidence to action",
    sub: "Every person belongs to one primary group. Extra needs stay visible.",
  },
  {
    id: "rewind",
    short: "Discharge-day rewind",
    title: "We could have seen this before they left",
    eyebrow: "08 / Rewind the chart",
    sub: "Move through time to see which facts were already available at the bedside.",
  },
  {
    id: "monday",
    short: "Monday morning",
    title: "A work list the team can use",
    eyebrow: "09 / Make the next call count",
    sub: "Give each person a clear next step and each team a list it can act on.",
  },
];
const graph = createPilotGraph(rawPatients);
const notes = rawPatients.flatMap((p) =>
  p.notes.map((n) => ({ ...n, patientId: p.id, patient_id: p.id })),
);
const prepared = await support.loadPrepared().catch((error) => {
  document.querySelector("#app").innerHTML =
    '<div class="pilot-load-error" role="alert"><h1>The workspace could not finish loading.</h1><p>A prepared route file is unavailable. Reload the page to try again.</p><button class="control primary" id="reload-workspace">Reload CareTrace</button></div>';
  document
    .querySelector("#reload-workspace")
    .addEventListener("click", () => location.reload());
  throw error;
});
const plans = Array.isArray(prepared.plans)
  ? prepared.plans
  : prepared.plans?.plans || [];
const evaluation = support.evaluateNotes(rawPatients);
let searchIndex = support.buildSearchIndex(notes);
const state = {
  screen: 0,
  engine: true,
  paused: false,
  step: -1,
  events: [],
  current: null,
  plan: plans.find((p) => p.id === "main") || plans[0],
  patientId: graph.featuredId,
  k: 5,
  tab: "trace",
  overlay: false,
  menu: false,
  sheet: false,
  collapsed: false,
  consoleHeight: 250,
  readingIndex: 0,
  rewind: AS_OF,
  closest: false,
  queryText: "",
  selected: null,
  modal: null,
  stage: "question",
  presentation: false,
};
let canvas,
  timer,
  stageTimers = [],
  thoughtTimer,
  searchResult;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const patient = () =>
  graph.patients.find((p) => p.id === state.patientId) || graph.patients[0];
const planQuestion = (p) =>
  p?.question ||
  p?.title ||
  p?.label ||
  "Find open follow-up gaps with a documented barrier";
const query = () =>
  graph.query(state.plan?.filters || { id: state.plan?.id || "main" });
const mainResult = () => graph.query({ id: "main" });
const activeEvent = () =>
  state.events[Math.min(state.step, state.events.length - 1)];
const eventsShown = () => state.events.slice(0, Math.max(0, state.step + 1));
const sourceText = (b) => b?.evidence_sentence || b?.quote || "";
const activeBarriers = (p) =>
  (p?.barriers || []).filter(
    (b) => !b.resolved && (!b.status || b.status === "active"),
  );
const bedsideEvidence = (p) =>
  activeBarriers(p)
    .flatMap((b) => b.evidence_sources || [b])
    .find(
      (b) =>
        b.sourceKind === "note" &&
        /bedside/i.test(b.note_type) &&
        String(b.written_datetime || b.date) < p.admission.discharge_datetime,
    ) || activeBarriers(p).find((b) => b.sourceKind === "note");
const primaryNote = (p) =>
  p.notes.find((n) => n.id === bedsideEvidence(p)?.note_id) ||
  p.notes.find((n) => /bedside/i.test(n.note_type)) ||
  p.notes[0];
const safeJSON = (value) => escape(JSON.stringify(value, null, 2));
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 3500);
}
function event(tool, args, run, thought, stage = "graph") {
  const start = performance.now(),
    value = run(),
    ms = performance.now() - start;
  const rows = Array.isArray(value) ? value : value?.rows || [];
  return {
    step: 0,
    tool,
    args,
    query: `${tool}(${JSON.stringify(args)})`,
    rows,
    ms,
    nodes: [],
    edges: [],
    evidence: [],
    thought,
    observation: `${number(rows.length)} rows returned.`,
    stage,
    stageSequence: [stage],
    counters: { rowsRead: rows.length },
    result: value,
  };
}
function traceFor(p) {
  const result = graph.trace(p.id, state.plan);
  return Array.isArray(result) ? result : result.events || [];
}
function selectMatchingPatient() {
  const candidates = query().patients;
  if (
    candidates.length &&
    !candidates.some((candidate) => candidate.id === state.patientId)
  )
    state.patientId = candidates[0].id;
}
function readingCases() {
  const chosen = primaryNote(patient());
  return [
    chosen,
    ...prepared.reading
      .filter((example) =>
        ["negation", "resolved", "third_party"].includes(example.kind),
      )
      .map((example) => notes.find((note) => note.id === example.noteId)),
  ].filter(Boolean);
}
function makeSequence() {
  const id = SCREENS[state.screen].id,
    p = patient(),
    trace = traceFor(p);
  if (id === "building") {
    const rows = graph.buildEvents();
    return Array.isArray(rows) ? rows : rows.events;
  }
  if (id === "reading")
    return readingCases().flatMap((note) => {
      const reader = readNote(note);
      const e = event(
        "read_note",
        { note_id: note.id },
        () => readNote(note).assertions,
        "Read the whole note before deciding what this sentence means.",
        "notes",
      );
      e.reader = reader;
      e.note = note;
      e.evidence = reader.assertions;
      e.nodes = [
        note.patientId ||
          notes.find((n) => n.id === note.id)?.patientId ||
          p.id,
        note.id,
      ];
      e.query = `READ ClinicalNote {id: ${JSON.stringify(note.id)}}\nSCORE sentences USING care_barrier_reader`;
      e.observation = reader.assertions.some((a) => a.status === "active")
        ? "The reader found a current difficulty and kept the sentence as evidence."
        : `This note does not add a current barrier: ${reader.sentences.find((s) => s.status !== "active")?.status || "no supported difficulty"}.`;
      const inspection = event(
        "inspect_sentence",
        { note_id: note.id },
        () =>
          reader.sentences.filter(
            (s) => s.outcome === "edge_created" || s.status !== "active",
          ),
        "Keep the author, date and exact words together with this conclusion.",
        "notes",
      );
      return [
        e,
        {
          ...inspection,
          reader,
          note,
          nodes: e.nodes,
          observation: e.observation,
        },
      ];
    });
  if (id === "search") {
    refreshSearch();
    return [
      event(
        "build_search_index",
        { method: "TF-IDF and PCA", notes: notes.length },
        () => {
          searchIndex = support.buildSearchIndex(notes);
          return searchIndex.points;
        },
        "Give each note a vector, then project the actual vectors into two dimensions.",
        "notes",
      ),
      event(
        "search_notes",
        { question: planQuestion(state.plan), k: state.k },
        () => {
          refreshSearch();
          return [searchResult.queryPoint];
        },
        "Place the expanded question in the same vector space as the notes.",
        "tools",
      ),
      event(
        "rank_notes",
        { question: planQuestion(state.plan), k: state.k },
        () => {
          refreshSearch();
          return searchResult.results;
        },
        "Give search its best shot by expanding the question with related barrier terms.",
        "tools",
      ),
      event(
        "read_top_notes",
        { k: state.k },
        () => rankedPassages(),
        "Only the highest-ranked passages are read.",
        "answer",
      ),
    ];
  }
  if (id === "discharges") {
    const f = graph.funnel();
    return [
      ["discharges", "Start with every adult discharge."],
      ["diabetes", "Follow the diabetes-related admissions."],
      ["gaps", "Keep the people whose follow-up is still open."],
      ["barrier", "Find a documented difficulty we can address."],
      ["groups", "Match each person to a primary action."],
    ].map(([key, thought]) =>
      event(
        "discharge_funnel",
        { stage: key },
        () => {
          const current = graph.funnel();
          return key === "groups"
            ? current.groups
            : [{ stage: key, count: current[key] }];
        },
        thought,
        "graph",
      ),
    );
  }
  if (id === "monday")
    return [
      event(
        "open_follow_up_gaps",
        {},
        () =>
          graph.patients
            .filter((p) => p.followUpGap?.open)
            .map((p) => ({ id: p.id, daysRemaining: p.daysRemaining })),
        "Start with one list of everyone who missed an important next step.",
        "store",
      ),
      event(
        "group_by_responsible_team",
        { sort: "daysRemaining ascending" },
        () => mainResult().groups,
        "Send the right work to the right team, with the least time remaining first.",
        "answer",
      ),
    ];
  if (id === "rewind")
    return [
      event(
        "patient_graph",
        { patientId: p.id, asOf: p.admission.dischargeDate },
        () =>
          graph.patientGraph(p.id, {
            asOf: p.admission.dischargeDate,
            limit: 50,
          }).nodes,
        "Return to the day this patient left the hospital.",
        "graph",
      ),
      event(
        "patient_graph",
        { patientId: p.id, asOf: AS_OF },
        () => graph.patientGraph(p.id, { asOf: AS_OF, limit: 50 }).nodes,
        "Now watch the missed next steps join facts that were already in the chart.",
        "graph",
      ),
    ];
  if (id === "answer") return trace.slice(-3);
  if (id === "systems")
    return trace.filter(
      (e) =>
        ["patients", "appointments", "outpatient_pharmacy"].includes(
          e.args?.table,
        ) ||
        ["derive_follow_up_gap", "read_note", "match_actions"].includes(e.tool),
    );
  return [
    ...(state.plan?.route || []).map((hop, i) => ({
      step: i + 1,
      tool: "show_prepared_route",
      args: { from: hop.from, edge: hop.edge, to: hop.to },
      query:
        "Prepared route: " + hop.from + " -[:" + hop.edge + "]-> " + hop.to,
      rows: [],
      nodes: [hop.from, hop.to],
      edges: ontology.paths
        .map((p, i) => ({ p, i }))
        .filter(
          ({ p }) => p[0] === hop.from && p[1] === hop.edge && p[2] === hop.to,
        )
        .map(({ i }) => "ontology-" + i),
      evidence: [],
      thought: hop.thought,
      observation:
        "Follow " + hop.edge + " from " + hop.from + " to " + hop.to + ".",
      stage: "planner",
      stageSequence: ["question", "planner"],
      prepared: true,
    })),
    ...trace,
  ];
}
function clearTimers() {
  clearTimeout(timer);
  clearTimeout(thoughtTimer);
  stageTimers.forEach(clearTimeout);
  stageTimers = [];
}
function startScreen(index, { patientId, keepPlan = true } = {}) {
  clearTimers();
  state.screen = Math.max(0, Math.min(SCREENS.length - 1, index));
  if (patientId) state.patientId = patientId;
  state.step = -1;
  state.current = null;
  state.paused = false;
  state.menu = false;
  state.events = makeSequence().map((e, i) => ({ ...e, step: i + 1 }));
  state.stage = "question";
  if (SCREENS[state.screen].id === "rewind")
    state.rewind = patient().admission.dischargeDate;
  render();
  schedule(2000);
}
function schedule(delay) {
  clearTimeout(timer);
  if (state.paused || state.step >= state.events.length - 1) return;
  const id = SCREENS[state.screen].id;
  const interval =
    id === "investigation"
      ? 1200 + (activeEvent()?.pauseMs || 0)
      : 18000 / Math.max(1, state.events.length - 1);
  timer = setTimeout(advance, delay ?? interval);
}
function advance() {
  if (state.step >= state.events.length - 1) {
    state.paused = true;
    renderControls();
    return;
  }
  state.step++;
  const e = activeEvent();
  state.stage = e?.stageSequence?.[0] || e?.stage || "graph";
  if (SCREENS[state.screen].id === "rewind")
    state.rewind = state.step === 0 ? patient().admission.dischargeDate : AS_OF;
  render();
  const seq = e?.stageSequence || [];
  seq.slice(1).forEach((s, i) =>
    stageTimers.push(
      setTimeout(
        () => {
          state.stage = s;
          renderPipeline();
        },
        (i + 1) * 300,
      ),
    ),
  );
  schedule();
}
function refreshSearch() {
  const truth = support.groundTruthIds(state.plan?.id || "main");
  searchResult = searchIndex.search(planQuestion(state.plan), state.k, truth);
}
function rankedPassages() {
  return (searchResult?.ranked || searchResult?.results || []).slice(
    0,
    state.k,
  );
}
function mapPoints() {
  return searchResult?.points || searchIndex.points || [];
}
function currentGraph() {
  const screen = SCREENS[state.screen].id,
    e = activeEvent();
  if (screen === "building" || screen === "systems") {
    const built = new Set(eventsShown().flatMap((e) => e.nodes || [])),
      builtEdges = new Set(eventsShown().flatMap((e) => e.edges || []));
    const patientRecords = graph.patientGraph(patient().id, { limit: 50 });
    const nodes = patientRecords.nodes.filter((n) => built.has(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: graph.edges.filter(
        (e) => builtEdges.has(e.id) && ids.has(e.source) && ids.has(e.target),
      ),
    };
  }
  if (
    screen === "investigation" &&
    (!e || e.stage === "question" || e.stage === "planner")
  )
    return {
      nodes: ontology.nodeTypes.map((t) => ({
        id: t,
        type: t,
        label: t,
        properties: { type: t },
        source: { kind: "ontology" },
      })),
      edges: ontology.paths.map(([from, type, to], i) => ({
        id: `ontology-${i}`,
        source: from,
        target: to,
        type,
        properties: {},
      })),
    };
  const shownPatient =
    screen === "reading"
      ? e?.note?.patientId ||
        notes.find((n) => n.id === e?.note?.id)?.patientId ||
        patient().id
      : patient().id;
  const patientRecords = graph.patientGraph(shownPatient, {
    asOf: screen === "rewind" ? state.rewind : AS_OF,
    limit: 50,
  });
  if (screen === "investigation") {
    const traversed = eventsShown().filter((event) => !event.prepared);
    const visibleNodes = new Set(
      traversed.flatMap((event) => event.nodes || []),
    );
    const visibleEdges = new Set(
      traversed.flatMap((event) => event.edges || []),
    );
    return {
      ...patientRecords,
      nodes: patientRecords.nodes.filter((node) => visibleNodes.has(node.id)),
      edges: patientRecords.edges.filter(
        (edge) =>
          visibleEdges.has(edge.id) &&
          visibleNodes.has(edge.source) &&
          visibleNodes.has(edge.target),
      ),
    };
  }
  return patientRecords;
}
function legendHTML(data) {
  const counts = {};
  (data.nodes || []).forEach(
    (n) => (counts[n.type] = (counts[n.type] || 0) + 1),
  );
  return Object.entries(counts)
    .map(
      ([t, n]) =>
        `<span><i style="background:${pilotGraphColors[t]}"></i>${escape(t)} <b>${n}</b></span>`,
    )
    .join("");
}
function render() {
  canvas?.destroy();
  clearTimeout(thoughtTimer);
  const screen = SCREENS[state.screen],
    totals = graph.totals();
  $("#app").innerHTML =
    `<div class="pilot ${state.engine ? "engine-mode" : "product-mode"} ${state.collapsed ? "console-collapsed" : ""} ${state.sheet ? "sheet-open" : ""}" style="--console-height:${state.consoleHeight}px"><aside class="workspace-nav ${state.menu ? "open" : ""}"><a class="brand" href="#systems" data-action="nav" data-index="0"><span class="brand-mark">✳</span><span>caretrace<span class="brand-sub">HOSPITAL INTELLIGENCE</span></span></a><div class="workspace-label">NORTHSTAR <span>CARE TRANSITIONS</span></div><nav aria-label="Guided flow">${SCREENS.map((s, i) => `<button class="nav-item ${i === state.screen ? "selected" : ""}" data-action="nav" data-index="${i}" ${i === state.screen ? 'aria-current="page"' : ""}><span>${String(i + 1).padStart(2, "0")}</span>${s.short}${i < state.screen ? "<i>✓</i>" : ""}</button>`).join("")}</nav><div class="nav-bottom"><span class="status-dot"></span> Connected evidence<div><strong>${number(totals.nodes)}</strong> nodes <span>·</span> <strong>${number(totals.edges)}</strong> edges</div><small>${number(totals.notesRead)} notes read</small></div></aside><div class="workspace"><header class="topbar">${button("☰", "menu", 'aria-label="Open navigation"', "menu-button")}<div class="hospital"><strong>Northstar Hospital System</strong><span>Care transitions workspace <i>·</i> ${date(AS_OF)}</span></div><div class="header-tools"><button class="prototype-chip" data-action="about"><i></i>Prototype · synthetic patients</button><div class="view-switch" role="group" aria-label="Workspace view"><button data-action="product" class="${!state.engine ? "active" : ""}" aria-pressed="${!state.engine}">Product<span> view</span></button><button data-action="engine" class="${state.engine ? "active" : ""}" aria-pressed="${state.engine}">Engine<span> view</span><kbd>E</kbd></button></div></div></header><main><div class="page-heading"><div><div class="eyebrow">${screen.eyebrow}</div><h1>${screen.title}</h1><p>${screen.sub}</p></div><div class="heading-count"><span>${String(state.screen + 1).padStart(2, "0")}</span> / ${String(SCREENS.length).padStart(2, "0")}</div></div><div class="scene"><section class="visual-panel">${visualHTML()}</section><section class="story-panel" aria-label="Patient story">${storyHTML()}</section></div><section class="engine-console" aria-label="Engine console"><div class="console-resize" role="separator" aria-label="Resize engine console" aria-orientation="horizontal" tabindex="0"></div><div class="pipeline" id="pipeline">${pipelineHTML()}</div><div class="console-tabs" role="tablist">${["trace", "query", "tables", "reader", "events"].map((t) => `<button role="tab" data-action="tab" data-tab="${t}" aria-selected="${state.tab === t}" class="${state.tab === t ? "active" : ""}">${{ trace: "Reasoning trace", query: "Query inspector", tables: "Hospital tables", reader: "Note reader", events: "Raw events" }[t]}</button>`).join("")}<span class="console-spacer"></span>${button(state.collapsed ? "Expand ↑" : "Collapse ↓", "collapse", "", "subtle")}</div><div class="console-content" id="console-content">${consoleHTML()}</div></section></main><footer class="flow-controls" id="flow-controls">${controlsHTML()}</footer></div></div>`;
  const target = $("#knowledge-canvas");
  if (target) {
    const data = currentGraph(),
      shown = eventsShown().filter(
        (e) => Boolean(e.prepared) === Boolean(activeEvent()?.prepared),
      ),
      nodes = shown.flatMap((e) => e.nodes || []),
      visited = [
        ...new Set(nodes.map((n) => (typeof n === "string" ? n : n.id))),
      ];
    canvas = createPilotCanvas(target, data, {
      mode:
        SCREENS[state.screen].id === "investigation" &&
        (!activeEvent() ||
          ["question", "planner"].includes(activeEvent().stage))
          ? "ontology"
          : "patient",
      highlight: [
        ...(activeEvent()?.nodes || []),
        ...(activeEvent()?.edges || []),
      ].map((n) => (typeof n === "string" ? n : n.id)),
      visited,
      visitedEdges: [...new Set(shown.flatMap((e) => e.edges || []))],
      onSelect: (n) => showSource(n),
      title: `${patient().name}'s connected care record`,
    });
  }
  bindResize();
  revealThought();
}
function visualHTML() {
  const id = SCREENS[state.screen].id,
    p = patient();
  if (id === "search") return searchVisual();
  if (id === "discharges") return dischargeVisual();
  if (id === "monday") return mondayVisual();
  if (id === "systems" && state.step < 0) {
    const note = primaryNote(p),
      barrier = bedsideEvidence(p) || activeBarriers(p)[0],
      visit =
        p.appointments.find((a) => a.status === "no_show") || p.appointments[0],
      med = p.medications.find((m) => m.isInsulin) || p.medications[0];
    return `<div class="panel-top"><span>THREE SEPARATE RECORDS</span>${marker("source")}</div><div class="isolated-facts"><button class="fact-card appointment" data-action="fact" data-kind="appointments"><span class="fact-icon">↗</span><small>APPOINTMENTS TABLE</small><h3>${escape(visit?.clinic || "Follow-up visit")}</h3><p>No-show</p><span>${date(visit?.date)}</span></button><button class="fact-card medication" data-action="fact" data-kind="medications"><span class="fact-icon">Rx</span><small>OUTPATIENT PHARMACY</small><h3>${escape(med?.name || "Discharge medication")}</h3><p>${med?.pickedUp ? "Picked up" : "Not picked up"}</p><span>New prescription at discharge</span></button><button class="fact-card note" data-action="fact" data-kind="note"><span class="fact-icon">≋</span><small>BEDSIDE NURSING NOTE</small><blockquote>“${escape(sourceText(barrier) || note?.text || "No note recorded")}”</blockquote><span>${escape(note?.author_role)} · ${date(note?.date)}</span></button></div><div class="visual-caption">Each system is correct. None of them knows the others exist.</div>`;
  }
  const data = currentGraph(),
    f = graph.funnel(),
    e = activeEvent();
  return `<div class="panel-top"><span>${id === "building" ? "ASSEMBLING THE KNOWLEDGE GRAPH" : id === "rewind" ? `CHART AS OF ${date(state.rewind).toUpperCase()}` : "CONNECTED PATIENT RECORD"}</span><div>${button(state.overlay ? "Hide route" : "Show route", "overlay", "", "tiny")} ${marker("graph")}</div></div><div class="graph-legend">${legendHTML(data)}</div><div class="graph-area"><div id="knowledge-canvas"></div>${state.overlay ? routeOverlay() : ""}${id === "building" ? `<div class="build-counter"><strong>${number(activeEvent()?.totals?.nodes || 0)}</strong><span>records connected in this pass</span></div>` : ""}</div>${id === "rewind" ? timelineHTML() : sourceLayers()}<div class="visual-caption">${id === "building" && state.step >= state.events.length - 1 ? `${number(graph.totals().nodes)} nodes · ${number(graph.totals().edges)} edges · ${Object.keys(graph.totals().byNodeType).length} node types · ${graph.totals().baseEdgeTypes} edge types · ${number(graph.totals().derivedEdges)} derived edges` : id === "investigation" && e?.rerouted ? "Nothing was coded, so the investigator read what the nurse wrote." : id === "systems" ? "Connected, the same three facts say what to do." : `Select any node to open its row or sentence. ${data.nodes.length} ${data.nodes.length === 1 ? "fact" : "facts"} shown.`}</div>`;
}
function sourceLayers() {
  const e = activeEvent(),
    store = e?.stage === "store" || e?.stageSequence?.includes("store"),
    note = e?.stage === "notes" || e?.reader;
  return `<div class="source-layers"><button data-action="tab" data-tab="tables" class="source-layer ${store ? "reading" : ""}"><span>▤</span><div><strong>Hospital data store</strong><small>${store ? `${e.rows?.length || 0} rows · ${escape(e.tool)}` : "Dates, visits, medication pickup"}</small></div>${store ? '<i class="source-pulse"></i>' : ""}</button><button data-action="tab" data-tab="reader" class="source-layer ${note ? "reading" : ""}"><span>≋</span><div><strong>Clinical notes</strong><small>${note ? "Reading the words in the chart" : "The reason, in the patient’s words"}</small></div>${note ? '<i class="source-pulse"></i>' : ""}</button></div>`;
}
function routeOverlay() {
  const route = state.plan?.route || state.plan?.hops || [];
  return `<div class="route-overlay"><small>PLANNED ROUTE ${marker("plan")}</small><p>${escape(
    route
      .map((h) =>
        typeof h === "string"
          ? h
          : h.to || h.node || h.nodeType || h.edge || h.relationship || "",
      )
      .filter(Boolean)
      .join(" → "),
  )}</p><small>PATH TAKEN ${marker("graph")}</small><p>${
    eventsShown()
      .map((e) => escape(e.tool))
      .join(" → ") || "Waiting to start"
  }</p>${eventsShown().some((e) => e.source?.table === "coded_social_needs" && e.noResult) ? '<span class="reroute-label">Coded social needs: no result ↘ rerouted to clinical notes</span>' : ""}</div>`;
}
function patientHeading(p = patient()) {
  return `<div class="patient-heading"><span class="avatar">${escape(
    p.name
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("") || "P",
  )}</span><div><strong>${escape(p.name)}</strong><span>${escape(p.id)} · Age ${p.age} · ${escape(p.admission.unit)}</span></div><span class="day-pill">${p.daysSinceDischarge >= 0 ? `Day ${p.daysSinceDischarge} of 30` : `${Math.abs(p.daysSinceDischarge)} days to discharge`}</span></div>`;
}
function storyHTML() {
  const id = SCREENS[state.screen].id,
    p =
      id === "rewind"
        ? graph.patientGraph(patient().id, { asOf: state.rewind, limit: 50 })
            .patient || patient()
        : patient(),
    f = graph.funnel(),
    e = activeEvent();
  if (id === "search") return searchStory();
  if (id === "answer") return answerStory();
  if (id === "monday")
    return `<div class="section-kicker">THE MORNING HUDDLE ${marker("graph")}</div><h2>Make the next call count.</h2><div class="three-metrics"><div><strong>${f.barrier}</strong><span>need a matched action</span></div><div><strong>${f.within30}</strong><span>still inside day 30</span></div><div><strong>${f.standard}</strong><span>need the standard call</span></div></div><p>One shared list becomes a clear handoff to the people who can help.</p><div class="closing-statement">The question is no longer<br><em>“Who missed a visit?”</em><br>It’s <strong>“What is in their way?”</strong></div><p class="quiet">Select a person to open the evidence behind their next step. Actions stay inside this workspace.</p>${button("Replay from the beginning", "nav", 'data-index="0"', "primary")}`;
  if (id === "discharges")
    return `<div class="section-kicker">THE SAME ROUTE, AT SCALE ${marker("graph")}</div><h2>From a discharge list<br>to a plan for each person.</h2>${funnelHTML(f)}<div class="group-mini-grid">${f.groups.map((g) => `<button data-action="group" data-type="${g.type}" style="--barrier-color:${BARRIERS[g.type]?.color}"><strong>${g.count}</strong><span>${escape(g.label)}</span><small>${escape(g.owner)}</small></button>`).join("")}</div><div class="standard-note"><strong>${f.standard} standard discharge calls</strong><span>Separate from the patients with a documented barrier.</span></div>`;
  if (id === "building")
    return `<div class="section-kicker">TWO SOURCES. ONE CONNECTED VIEW. ${marker("graph")}</div><h2>Every connection keeps its evidence.</h2><ol class="build-stages">${["Hospital tables become connected facts", "Clinical notes keep their author and date", "Current difficulties become barrier edges", "Rules identify gaps and a primary next step"].map((text, i) => `<li class="${state.step >= Math.floor((i * state.events.length) / 4) ? "done" : ""}"><span>${i + 1}</span>${text}</li>`).join("")}</ol><div class="large-stat"><strong>${number(graph.totals().nodes)}</strong><span>facts in the connected care picture</span></div><p>Nothing was copied into a new silo. Every node points back to its row or sentence.</p>${e ? `<div class="current-observation">${marker(e.stage === "notes" ? "reader" : "graph")} ${escape(e.observation)}</div>` : ""}`;
  if (id === "reading") {
    const selected =
        e?.note ||
        readingCases()[
          Math.min(
            Math.floor(Math.max(0, state.step) / 2),
            readingCases().length - 1,
          )
        ],
      reader = e?.reader || readNote(selected || {}),
      winning =
        reader.sentences.find((s) => s.outcome === "edge_created") ||
        reader.sentences.find((s) => s.status !== "active");
    return `<div class="section-kicker">READ THE WHOLE SENTENCE ${marker("note")}</div><h2>${winning?.status === "active" ? "A difficulty the team can address." : winning?.status === "resolved" ? "Help was already arranged." : "Context changes the meaning."}</h2><div class="clinical-note"><div><strong>${escape(selected?.note_type || "Clinical note")}</strong><small>${escape(selected?.author_role)} ${escape(selected?.author_initials)} · ${escape(selected?.unit)}<br>${time(selected?.written_datetime)}</small></div><p>${reader.sentences.map((s) => `<span class="${s === winning ? "winning-sentence" : state.step >= 0 ? "dim-sentence" : ""}">${escape(s.text)} </span>`).join("")}</p></div><div class="reader-verdict ${winning?.status === "active" ? "accepted" : "rejected"}">${winning?.status === "active" ? "✓ Current difficulty → evidence kept" : `↳ ${escape(winning?.status || "No supported barrier")} → no current edge`}</div>${accuracyStrip()}<div class="reader-totals"><span><strong>${evaluation.notesRead}</strong> notes read</span><span><strong>${evaluation.reportedEdges}</strong> current note assertions</span><span><strong>${evaluation.rejectedSentences}</strong> look-alike sentences rejected</span></div>${button("Inspect mistakes", "mistakes", "", "subtle")}`;
  }
  if (id === "rewind") {
    const note = primaryNote(p),
      days = dayDiff(
        p.admission.dischargeDate,
        note?.date || note?.written_datetime,
      ),
      atDischarge = state.rewind <= p.admission.dischargeDate;
    return `${patientHeading(p)}<div class="section-kicker">THE DISCHARGE-DAY REWIND ${marker("graph")}</div><h2>${atDischarge ? "The reason was already here." : "The gap opened later."}</h2><blockquote class="evidence-quote">“${escape(sourceText(bedsideEvidence(p)) || "No current barrier sentence was available on this date.")}”</blockquote><p>${!bedsideEvidence(p) ? "No current barrier had been documented by this date." : days >= 0 ? `This was already written down ${days} day${days === 1 ? "" : "s"} before ${p.sex === "F" ? "she" : "they"} went home.` : "This note was added after discharge."}</p><div class="action-callout"><small>THE BEDSIDE OPPORTUNITY</small><strong>${escape(action(p.primary_barrier))}</strong></div><div class="paired-buttons">${button("Rewind to discharge day", "rewind-discharge", "", "primary")}${button("Back to today", "rewind-today")}</div><p class="cohort-insight"><strong>${f.preDischarge} of ${f.barrier}</strong> had the reason documented in a note before they left.</p>`;
  }
  return `${patientHeading()}<div class="section-kicker">${id === "systems" ? "THE FIRST DAYS HOME" : "FOLLOW THE CARE STORY"} ${marker(e?.stage === "planner" ? "plan" : "graph")}</div><h2>${id === "systems" ? "We discharged them. Let’s help them get back on track." : e?.plain || e?.explanation || e?.observation || "Start with a question. Follow what the chart knows."}</h2>${id === "investigation" ? questionBox() : ""}<div class="story-step ${state.step >= 0 ? "entered" : ""}"><span class="step-number">${Math.max(1, state.step + 1)}</span><div><p>${escape(e?.thought || "We wrote down why some patients will struggle at home. Connect those notes to missed visits and medication pickup, then prepare the right follow-up.")}</p>${e ? `<small>${escape(e.tool)} ${marker(e.stage === "notes" ? "reader" : "graph")}</small>` : ""}</div></div>${id === "investigation" && e?.source?.table === "coded_social_needs" && e.noResult ? '<div class="empty-lookup"><strong>0 rows for this patient</strong><span>No social need was coded during the stay.</span><b>↘ Continue to clinical notes</b></div>' : ""}${state.step >= state.events.length - 2 || id === "systems" ? `<div class="action-callout"><small>${escape(owner(p.primary_barrier))}</small><strong>${escape(action(p.primary_barrier))}</strong></div>` : ""}${id === "investigation" ? `<div class="cohort-insight"><strong>${f.missedByTables} of ${f.barrier}</strong> would be missed by the data store alone.</div><div class="patient-tools">${button("Random patient", "random", "", "subtle")}${button("View the answer", "nav", 'data-index="6"', "primary")}</div>` : ""}`;
}
function funnelHTML(f) {
  return `<div class="funnel">${[
    ["discharges", "discharges"],
    ["diabetes", "diabetes-related"],
    ["gaps", "open follow-up gaps"],
    ["barrier", "with a barrier"],
  ]
    .map(
      ([k, label], i) =>
        `<div><strong>${number(f[k])}</strong><span>${label}</span>${i < 3 ? "<i>→</i>" : ""}</div>`,
    )
    .join("")}</div>`;
}
function questionBox() {
  return `<div class="question-box">${state.closest ? '<div class="closest-notice">Showing the closest prepared question</div>' : ""}<label for="question-input">Ask the CareTrace investigator</label><div><input id="question-input" value="${escape(state.queryText || planQuestion(state.plan))}" placeholder="Search the prepared questions…" autocomplete="off"/><button class="control primary" data-action="ask">Go ↗</button></div><div id="question-suggestions" class="question-suggestions" hidden></div><small>${plans.length} prepared routes · every answer recomputed from the graph</small></div>`;
}
function accuracyStrip() {
  const m = evaluation.overall || evaluation;
  return `<div class="accuracy-strip"><div><strong>${percent(m.precision)}</strong><span>precision</span></div><div><strong>${percent(m.recall)}</strong><span>recall</span></div><small>Measured against a separate note-level answer key.</small></div>`;
}
function answerStory() {
  const result = query(),
    f = graph.funnel(),
    withoutBarrier = result.patients.filter(
      (p) => !activeBarriers(p).length,
    ).length,
    groupSum = result.groups.reduce((n, g) => n + g.count, 0),
    ids = new Set(result.patients.map((p) => p.id));
  return `<div class="answer-topline"><span class="section-kicker">${state.closest ? "SHOWING THE CLOSEST PREPARED QUESTION" : "THE ANSWER"} ${marker("graph")}</span><div class="answer-number">${number(result.count)}<span>patients</span></div><p>${escape(planQuestion(state.plan))}</p></div>${questionBox()}<p class="prepared-summary">${escape((prepared.explanations[state.plan.id]?.summary || "{count} patients match this question.").replace("{count}", number(result.count)))} ${marker("plan")}</p>${state.plan.id === "main" ? funnelHTML(f) : ""}${result.shape === "units" || result.shape === "noteTypes" || result.shape === "returns" ? answerShape(result) : `<div class="answer-groups">${result.groups.map((g) => `<button data-action="group" data-type="${g.type}" style="--barrier-color:${BARRIERS[g.type]?.color}"><span>${escape(g.label)}</span><strong>${g.count}</strong><small>${escape(g.owner)}</small></button>`).join("")}</div><div class="sum-line">${result.groups.map((g) => g.count).join(" + ")}${withoutBarrier ? " + " + withoutBarrier + " without a documented barrier" : ""} = <strong>${result.count} patients</strong></div>`}${state.plan.id === "main" ? `<div class="standard-note"><strong>${f.standard} standard discharge calls</strong><span>Outside this total. No documented barrier.</span></div>` : ""}${accuracyStrip()}<div class="paired-buttons">${button("Inspect mistakes", "mistakes", "", "subtle")}${button("Compare with search", "comparison", "", "subtle")}</div><div class="answer-patients">${result.patients
    .slice(0, 5)
    .map((p) => patientRow(p))
    .join(
      "",
    )}${result.patients.length > 5 ? button(`See all ${result.patients.length} patients`, "all-patients", "", "subtle") : ""}</div>${!result.count ? '<div class="empty-state"><h3>No patients match this route.</h3><p>Choose another prepared question or reset the changes.</p></div>' : ""}`;
}
function answerShape(result) {
  const category =
    result.shape === "units"
      ? "Unit"
      : result.shape === "noteTypes"
        ? "Note type"
        : "Patient";
  return `<div class="shape-result"><strong>Same graph. Different route. No new pipeline.</strong><div class="shape-table"><div class="shape-table-head"><span>${category}</span><span>${result.shape === "returns" ? "Days to return" : "Patients"}</span></div>${result.rows.map((row, i) => `<button data-action="shape-row" data-index="${i}"><span><strong>${escape(row.unit || row.note_type || row.name || row.id)}</strong>${result.shape === "returns" ? `<small>${escape(row.patientId || row.id)} · ${date(row.returnDate)}<br>${escape(row.reason || "Emergency department visit")}</small>` : ""}</span><b>${row.count ?? row.daysToReturn ?? "—"} <i>↗</i></b></button>`).join("")}</div></div>`;
}
function patientRow(p, { evidence = false } = {}) {
  const extras = activeBarriers(p).filter((b) => b.type !== p.primary_barrier);
  return `<button class="patient-row" data-action="patient" data-id="${p.id}"><div><strong>${escape(p.id)} <span>${escape(p.name)}</span></strong><small>Age ${p.age} · ${escape(labels(p.primary_barrier))}</small>${extras.length ? `<small class="secondary-barrier">Also needed: ${extras.map((b) => escape(labels(b.type))).join(", ")}</small>` : ""}</div><span class="days-left ${p.daysSinceDischarge < 30 && p.daysRemaining <= 5 ? "urgent" : ""}">${p.daysRemaining > 0 ? `${p.daysRemaining} ${p.daysRemaining === 1 ? "day" : "days"} left` : "Outside day 30"}</span></button>`;
}
function searchVisual() {
  refreshSearch();
  const points = mapPoints(),
    ranked = rankedPassages(),
    chosen = new Set(ranked.map((r) => r.noteId || r.note?.id || r.note_id));
  const coords = points.map((p, i) => ({
    x: Number(p.x ?? p[0] ?? 0),
    y: Number(p.y ?? p[1] ?? 0),
    id: p.id || p.noteId || p.note_id || notes[i]?.id,
  }));
  const qp = searchResult.queryPoint || { x: 0, y: 0 };
  const minX = Math.min(...coords.map((p) => p.x), qp.x),
    maxX = Math.max(...coords.map((p) => p.x), qp.x),
    minY = Math.min(...coords.map((p) => p.y), qp.y),
    maxY = Math.max(...coords.map((p) => p.y), qp.y);
  const qx = 40 + ((qp.x - minX) / (maxX - minX || 1)) * 640,
    qy = 35 + ((qp.y - minY) / (maxY - minY || 1)) * 310;
  return `<div class="panel-top"><span>CLINICAL NOTE SIMILARITY</span>${marker("TF-IDF · PCA")}</div><div class="search-map"><svg viewBox="0 0 720 380" role="img" aria-label="Clinical notes projected into two dimensions with PCA"><defs><radialGradient id="map-glow"><stop stop-color="#63bfa3" stop-opacity=".18"/><stop offset="1" stop-color="#63bfa3" stop-opacity="0"/></radialGradient></defs><circle cx="365" cy="195" r="170" fill="url(#map-glow)"/>${coords.map((p) => `<circle cx="${40 + ((p.x - minX) / (maxX - minX || 1)) * 640}" cy="${35 + ((p.y - minY) / (maxY - minY || 1)) * 310}" r="${chosen.has(p.id) && state.step >= 2 ? 6 : 2.6}" class="${chosen.has(p.id) && state.step >= 2 ? "selected-point" : "note-point"}"><title>${escape(p.id)}</title></circle>`).join("")}${state.step >= 1 ? `<g transform="translate(${qx} ${qy})"><circle r="11" fill="#efd68f"/><text y="4" text-anchor="middle" fill="#183d35">?</text><text x="18" y="5" class="map-question">The question</text></g>` : ""}</svg><div class="map-key"><span><i></i>One point = one note</span><span><i class="gold"></i>The question</span><span><i class="green"></i>Selected passages</span></div></div><div class="search-k"><label for="search-k">Passages to read <strong>k = ${state.k}</strong></label><input type="range" min="5" max="100" value="${state.k}" id="search-k"/><div><span>5 passages</span><span>100 passages</span></div></div><div class="visual-caption">${number(Math.max(0, notes.length - state.k))} notes never read at this setting.</div>`;
}
function searchStory() {
  const ranked = rankedPassages(),
    m = searchResult || {};
  return `<div class="section-kicker">SEARCH’S BEST SHOT ${marker("notes")}</div><h2>A similar sentence is not the full care story.</h2><div class="search-metrics"><div><strong>${state.k}</strong><span>passages read</span></div><div><strong>${m.rightPatients ?? m.right ?? m.truePositive ?? m.tp ?? 0}<small> / ${m.totalTruth ?? 0}</small></strong><span>right patients found</span></div><div><strong>${m.wrongPatients ?? m.wrong ?? m.falsePositive ?? m.fp ?? 0}</strong><span>wrong patients included</span></div></div><p class="search-limit">Search reads notes. It never sees appointment status, discharge dates or pharmacy pickup, because those are rows.</p><div class="passage-list">${ranked
    .slice(0, 10)
    .map((r, i) => {
      const n =
        r.note ||
        notes.find((n) => n.id === (r.id || r.note_id || r.noteId)) ||
        r;
      const truth = r.isCorrect;
      return `<button class="passage" data-action="note-source" data-note="${escape(n.id)}"><span class="passage-rank">${i + 1}</span><div><strong>${escape(n.note_type || "Clinical note")} <span>${Number(r.score || r.similarity || 0).toFixed(3)}</span></strong><p>${escape(r.passage || r.text || n.text || "")}</p><small class="${truth ? "correct" : "incorrect"}">${truth ? "✓ Patient belongs in the answer" : `↳ ${escape(r.reason || "Does not establish an open follow-up gap")}`}</small></div></button>`;
    })
    .join("")}</div>`;
}
function dischargeVisual() {
  const f = graph.funnel(),
    stage = Math.min(4, Math.max(0, state.step)),
    sets = [
      graph.patients,
      graph.patients.filter((p) => p.admission.diabetesRelated),
      graph.patients.filter((p) => p.followUpGap?.open),
      mainResult().patients,
    ];
  const visible = new Set(sets[Math.min(stage, 3)].map((p) => p.id));
  return `<div class="panel-top"><span>${["ALL DISCHARGES", "DIABETES-RELATED ADMISSIONS", "OPEN FOLLOW-UP GAPS", "DOCUMENTED BARRIERS", "PRIMARY ACTION GROUPS"][stage]}</span>${marker("graph")}</div><div class="discharge-dot-map">${graph.patients.map((p) => `<button aria-label="Open ${p.id}" class="discharge-dot ${visible.has(p.id) ? "included" : "excluded"}" style="${visible.has(p.id) && stage >= 3 ? `--dot-color:${BARRIERS[p.primary_barrier]?.color || "#85bea7"}` : ""}" data-action="patient" data-id="${p.id}" title="${p.id} · ${p.name}"></button>`).join("")}</div><div class="dot-counter"><strong>${number(sets[Math.min(stage, 3)].length)}</strong><span>${["adult discharges", "diabetes-related admissions", "open follow-up gaps", "people with a documented barrier", "people with a clear next action"][stage]}</span></div><div class="visual-caption">Each dot is one person. Select any dot to follow their evidence.</div>`;
}
function mondayVisual() {
  const all = graph.patients.filter((p) => p.followUpGap?.open);
  if (state.step < 1)
    return `<div class="panel-top"><span>TODAY: ONE LIST, ONE PHONE CALL</span>${marker("graph")}</div><div class="unassigned-list">${all.map((p) => patientRow(p)).join("")}</div>`;
  const groups = mainResult().groups;
  return `<div class="panel-top"><span>OWNED NEXT STEPS</span>${marker("graph")}</div><div class="work-lists">${groups
    .map((g) => {
      const people = graph.patients
          .filter((p) => g.patientIds.includes(p.id))
          .sort((a, b) => a.daysRemaining - b.daysRemaining),
        inside = people.filter((p) => p.daysSinceDischarge < 30),
        outside = people.filter((p) => p.daysSinceDischarge >= 30);
      return `<section class="work-list" style="--barrier-color:${BARRIERS[g.type].color}"><header><span>${escape(g.owner)}</span><strong>${people.length}</strong></header><p>${escape(g.action)}</p>${inside.map((p) => `<button class="work-person" data-action="patient" data-id="${p.id}"><strong>${p.id} <span>Age ${p.age}</span></strong><span>${escape(labels(p.primary_barrier))}</span><div class="day-track"><i style="width:${(Math.max(0, p.daysRemaining) / 30) * 100}%"></i></div><small>Day ${p.daysSinceDischarge} of 30 · ${p.daysRemaining} ${p.daysRemaining === 1 ? "day" : "days"} left</small></button>`).join("")}${outside.length ? `<details><summary>Outside the window (${outside.length})</summary>${outside.map((p) => patientRow(p)).join("")}</details>` : ""}</section>`;
    })
    .join(
      "",
    )}<section class="work-list standard-work"><header><span>Standard discharge call</span><strong>${graph.funnel().standard}</strong></header><p>No documented barrier. Check the plan and arrange the missed follow-up.</p><details><summary>Show the separate call list</summary>${all
    .filter((p) => !activeBarriers(p).length)
    .map((p) => patientRow(p))
    .join("")}</details></section></div>`;
}
function timelineHTML() {
  const p = patient(),
    start = p.admission.admitDate,
    end = AS_OF,
    total = dayDiff(end, start),
    selected = dayDiff(state.rewind, start);
  const facts = [
    { label: "Admission", date: start },
    { label: "Discharge", date: p.admission.dischargeDate },
    ...p.notes.map((n) => ({ label: n.note_type, date: n.date })),
    ...p.labs.map((l) => ({
      label: l.name || l.display || "Lab result",
      date: l.date || start,
    })),
    ...p.medications.map((m) => ({
      label: "Prescription",
      date: m.prescribedDate,
    })),
    ...p.appointments.map((a) => ({
      label: a.status === "no_show" ? "No-show" : "Follow-up visit",
      date: a.date,
    })),
    {
      label: "Pickup deadline",
      date: new Date(Date.parse(p.admission.dischargeDate) + 3 * 86400000)
        .toISOString()
        .slice(0, 10),
    },
    { label: "Today", date: end },
  ].filter((f) => f.date);
  return `<div class="timeline"><div class="timeline-pins">${facts.map((f) => `<button class="timeline-pin ${f.date > state.rewind ? "future" : ""}" style="left:${Math.max(0, Math.min(100, (dayDiff(f.date, start) / total) * 100))}%" title="${f.date > state.rewind ? "Later record" : escape(f.label)} · ${date(f.date)}" data-action="rewind-date" data-date="${f.date}"><span></span><i>${f.date > state.rewind ? "Later record" : escape(f.label)}</i></button>`).join("")}</div><input type="range" id="rewind-slider" min="0" max="${total}" value="${selected}" aria-label="Chart date"/><div class="timeline-labels"><span>${date(start)}</span><strong>${date(state.rewind)}</strong><span>${date(end)}</span></div></div>`;
}
function counters() {
  const shown = eventsShown().filter((e) => !e.prepared),
    last = activeEvent();
  if (last?.counters?.toolCalls !== undefined)
    return {
      calls: last.counters.toolCalls,
      nodes: last.counters.nodesVisited,
      edges: last.counters.edgesFollowed,
      rows: last.counters.rowsRead,
      sentences: last.counters.sentencesRead,
    };
  return {
    calls: shown.length,
    nodes: new Set(
      shown
        .flatMap((e) => e.nodes || [])
        .map((n) => (typeof n === "string" ? n : n.id)),
    ).size,
    edges: new Set(
      shown
        .flatMap((e) => e.edges || [])
        .map((n) => (typeof n === "string" ? n : n.id)),
    ).size,
    rows: shown.reduce((n, e) => n + (e.rows?.length || 0), 0),
    sentences: shown.reduce(
      (n, e) => n + (e.reader?.sentences?.length || 0),
      0,
    ),
  };
}
function pipelineHTML() {
  const c = counters();
  return `<div class="pipeline-stages">${[
    ["question", "Question"],
    ["planner", "Planner"],
    ["tools", "Graph tools"],
    ["graph", "Knowledge graph"],
    ["sources", "Sources"],
    ["answer", "Answer"],
  ]
    .map(
      ([key, label], i) =>
        `<div class="pipeline-stage ${state.stage === key || (key === "sources" && ["store", "notes"].includes(state.stage)) ? "active" : ""}"><span>${i + 1}</span><strong>${label}</strong>${key === "sources" ? `<small><i class="${state.stage === "store" ? "active" : ""}">Hospital data store</i><i class="${state.stage === "notes" ? "active" : ""}">Clinical notes</i></small>` : ""}</div>${i < 5 ? '<b class="pipeline-connector">→</b>' : ""}`,
    )
    .join(
      "",
    )}</div><div class="pipeline-counters"><span><b>${c.calls}</b> tool calls</span><span><b>${c.nodes}</b> nodes visited</span><span><b>${c.edges}</b> edges followed</span><span><b>${c.rows}</b> rows read</span><span><b>${c.sentences}</b> sentences read</span></div>`;
}
function renderPipeline() {
  const el = $("#pipeline");
  if (el) el.innerHTML = pipelineHTML();
}
function consoleHTML() {
  const e = activeEvent();
  if (!e)
    return '<div class="console-wait"><span class="status-dot"></span> Ready. The first step will appear here as the sequence begins.</div>';
  if (state.tab === "events")
    return `<div class="raw-events-toolbar"><span>${eventsShown().length} events · one per step</span>${button("Copy events", "copy-events", "", "tiny")}</div><pre class="raw-events">${eventsShown()
      .map((e) => safeJSON(e))
      .join("\n")}</pre>`;
  if (state.tab === "query")
    return `<div class="query-layout"><div><div class="console-label">EXECUTED CALL ${marker("graph")} <span>${e.prepared ? "prepared route" : Number(e.ms || 0).toFixed(3) + " ms"}</span></div><pre>${escape(e.query || `${e.tool}(${JSON.stringify(e.args)})`)}</pre><small>${(e.nodes || []).length} nodes · ${(e.edges || []).length} edges touched</small></div><div><div class="console-label">RESULT ROWS · ${e.rows?.length || 0}</div>${resultTable(e.rows || [])}</div></div>`;
  if (state.tab === "tables")
    return `<div class="console-label">${escape(e.source?.table || e.table || "Hospital data store")} ${marker("row")} <span>Lookup: ${escape(JSON.stringify(e.args))}</span></div>${resultTable(e.source?.neighbors || e.neighbours || e.neighbors || e.rows || [], e.rows?.[0])}${!e.rows?.length ? '<div class="zero-rows"><strong>0 rows</strong> for this lookup key. The next step can follow the notes.</div>' : ""}`;
  if (state.tab === "reader") return readerConsole(e);
  return `<div class="trace-history">${eventsShown()
    .slice(0, -1)
    .map(
      (e) =>
        `<details><summary><span>${e.step}</span>${escape(e.observation || e.tool)} <small>${e.prepared ? "prepared route" : Number(e.ms || 0).toFixed(2) + " ms"}</small></summary><pre>${safeJSON({ tool: e.tool, args: e.args, rows: e.rows })}</pre></details>`,
    )
    .join(
      "",
    )}</div><div class="current-trace"><div><b>Thought</b>${marker("plan")}<p class="progressive-thought" data-full="${escape(e.thought || "Follow the next connection in the prepared route.")}">${escape(e.thought || "Follow the next connection in the prepared route.")}</p></div><div><b>Action</b>${marker(e.stage === "notes" ? "reader" : "graph")}<code>${escape(e.tool)}(${escape(JSON.stringify(e.args))})</code></div><div><b>Observation</b>${marker(e.stage === "notes" ? "reader" : "graph")}<p>${escape(e.observation || `${e.rows?.length || 0} rows returned.`)} <small>${e.prepared ? "prepared route" : Number(e.ms || 0).toFixed(3) + " ms"}</small></p></div></div>`;
}
function resultTable(rows, highlight) {
  if (!rows?.length) return '<div class="empty-table">0 rows</div>';
  const plain = rows.map((r) =>
      typeof r === "object" && r !== null ? r : { value: r },
    ),
    keys = [...new Set(plain.flatMap(Object.keys))].slice(0, 8);
  return `<div class="table-scroll"><table><thead><tr>${keys.map((k) => `<th>${escape(k)}</th>`).join("")}</tr></thead><tbody>${plain
    .slice(0, 100)
    .map(
      (r, i) =>
        `<tr class="${highlight && r.id === highlight.id ? "selected-row" : ""}">${keys.map((k) => `<td>${escape(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
}
function readerConsole(e) {
  const note =
    e.note ||
    patient().notes.find((n) => n.id === (e.args?.noteId || e.args?.note_id)) ||
    primaryNote(patient());
  if (!note)
    return '<div class="empty-table">This patient has no clinical notes.</div>';
  const r = e.reader?.sentences ? e.reader : readNote(note);
  const output = r.assertions.filter((a) => a.status === "active");
  return `<div class="reader-console"><div><div class="console-label">${escape(note.id)} · ${escape(note.note_type)} ${marker("reader")}</div><table class="sentence-table"><thead><tr><th>Sentence / cue</th>${Object.keys(
    BARRIERS,
  )
    .map(
      (t) =>
        `<th title="${labels(t)}">${t === "transportation" ? "Travel" : t === "health_literacy" ? "Literacy" : labels(t)}</th>`,
    )
    .join("")}</tr></thead><tbody>${r.sentences
    .map(
      (s) =>
        `<tr class="${s.outcome === "edge_created" ? "sentence-winner" : s.status !== "active" ? "sentence-reject" : ""}"><td>${escape(s.text)}<small>${escape(s.status)} · ${escape(s.reason)}</small></td>${Object.keys(
          BARRIERS,
        )
          .map((t) => `<td>${Number(s.scores[t] || 0).toFixed(2)}</td>`)
          .join("")}</tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><div><div class="console-label">STRUCTURED OUTPUT</div><pre>${safeJSON(output)}</pre>${e.writes?.length ? e.writes.map((write) => `<pre>${escape(typeof write === "string" ? write : write.query || JSON.stringify(write))}</pre>`).join("") : output.map((a) => `<pre>MATCH (p:Patient {id: ${escape(JSON.stringify(note.patientId || notes.find((n) => n.id === note.id)?.patientId || patient().id))}}), (b:Barrier {type: ${escape(JSON.stringify(a.type))}})\nMERGE (p)-[:REPORTED_BARRIER {note_id: ${escape(JSON.stringify(note.id))}, confidence: ${a.confidence}, resolved: false}]-&gt;(b)</pre>`).join("")}</div></div>`;
}
function controlsHTML() {
  const complete = state.step >= state.events.length - 1;
  return `<div class="flow-nav">${button("← Back", "back", state.screen === 0 ? "disabled" : "", "subtle")}<span>${state.screen + 1} of ${SCREENS.length}</span>${button(state.screen === SCREENS.length - 1 ? "Start again ↺" : "Next →", state.screen === SCREENS.length - 1 ? "restart" : "next", "", "primary")}</div><div class="playback-controls">${button(state.paused || complete ? "▶ Play" : "Ⅱ Pause", "pause", `aria-label="${state.paused ? "Play" : "Pause"} sequence"`, "subtle")}${button("↺ Replay", "replay", "", "subtle")}${button("Step →", "step", complete ? "disabled" : "", "subtle")}<div class="sequence-progress"><span style="width:${Math.max(0, ((state.step + 1) / state.events.length) * 100)}%"></span></div><small>${Math.max(0, state.step + 1)} / ${state.events.length}</small></div>${button(state.sheet ? "Close engine" : "Open engine", "sheet", "", "mobile-engine")}<span class="keyboard-hint">← → next screen <kbd>Space</kbd> pause</span>`;
}
function renderControls() {
  const el = $("#flow-controls");
  if (el) el.innerHTML = controlsHTML();
}
function revealThought() {
  const el = $(".progressive-thought");
  if (!el || reducedMotion) return;
  const text = el.dataset.full;
  el.textContent = "";
  let at = 0;
  const next = () => {
    if (!el.isConnected) return;
    at += 4;
    el.textContent = text.slice(0, at);
    if (at < text.length) thoughtTimer = setTimeout(next, 13);
  };
  next();
}
function bindResize() {
  const grip = $(".console-resize");
  if (!grip) return;
  grip.addEventListener("pointerdown", (e) => {
    grip.setPointerCapture(e.pointerId);
    const start = e.clientY,
      height = state.consoleHeight;
    function move(event) {
      state.consoleHeight = Math.max(
        170,
        Math.min(430, height + start - event.clientY),
      );
      $(".pilot").style.setProperty(
        "--console-height",
        `${state.consoleHeight}px`,
      );
    }
    function up() {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
    }
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
  grip.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      state.consoleHeight = Math.max(
        170,
        Math.min(430, state.consoleHeight + (e.key === "ArrowUp" ? 20 : -20)),
      );
      render();
    }
  });
}
let modalReturnFocus = null;
let modalReturnAction = null;
function modal(title, body, wide = false) {
  if (!state.modal) {
    modalReturnFocus = document.activeElement;
    modalReturnAction = modalReturnFocus?.dataset?.action
      ? { ...modalReturnFocus.dataset }
      : null;
  }
  state.modal = title;
  $("#overlay-root").innerHTML =
    `<div class="modal-backdrop"><section class="pilot-modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${escape(title)}"><header><div><span class="eyebrow">CARETRACE / EVIDENCE</span><h2>${escape(title)}</h2></div>${button("×", "close-modal", 'aria-label="Close dialog"', "modal-close")}</header><div class="modal-body">${body}</div></section></div>`;
  $("#overlay-root .modal-close")?.focus();
}
function closeModal() {
  if (!state.modal) return;
  state.modal = null;
  $("#overlay-root").innerHTML = "";
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  else if (modalReturnAction) {
    const replacement = [...document.querySelectorAll("[data-action]")].find(
      (element) =>
        Object.entries(modalReturnAction).every(
          ([key, value]) => element.dataset[key] === value,
        ),
    );
    (replacement || $("[data-action=about]"))?.focus();
  }
  modalReturnFocus = null;
  modalReturnAction = null;
}
function showSource(node) {
  if (!node) return;
  modal(
    node.label || node.id,
    `<div class="source-identity">${marker(node.type)} <strong>${escape(node.id)}</strong></div><h3>Source pointer</h3>${resultTable([node.source || { kind: "Graph-derived rule" }])}<h3>Recorded properties</h3>${resultTable([node.properties || node])}<p class="quiet">This view shows the record used to create the selected graph fact.</p>`,
  );
}
function showNote(note) {
  if (!note) return;
  modal(
    note.note_type || "Clinical note",
    `<div class="note-metadata"><strong>${escape(note.id)}</strong><p>${escape(note.author_role)} ${escape(note.author_initials)} · ${escape(note.unit)}<br>${time(note.written_datetime)}</p></div><blockquote class="full-note">${escape(note.text)}</blockquote>${readerConsole({ note })}`,
    true,
  );
}
function showPatient(id) {
  const p = graph.patients.find((p) => p.id === id);
  if (!p) return;
  const bars = [...(p.barriers || []), ...(p.resolvedBarriers || [])];
  modal(
    `${p.name} · ${p.id}`,
    `${patientHeading(p)}<p>${escape(p.primary_barrier_reason || "No current primary barrier is documented.")}</p><div class="patient-modal-actions">${button("Play this patient’s investigation", "trace-patient", `data-id="${id}"`, "primary")}${button("Rewind this patient’s chart", "rewind-patient", `data-id="${id}"`)}</div><h3>Documented difficulties</h3>${bars.length ? bars.map((b) => `<div class="patient-barrier ${b.resolved ? "is-resolved" : ""}"><div><strong>${escape(labels(b.type))}</strong>${marker(b.sourceKind === "note" ? "note" : "row")}<span>${b.resolved ? "Resolved" : b.type === p.primary_barrier ? "Primary next step" : "Also needed"}</span></div><blockquote>“${escape(sourceText(b))}”</blockquote><small>${escape(b.note_type || "Coded social need")} · ${escape(b.authorRole || "")} · ${date(b.date || b.written_datetime)}</small><p>${escape(action(b.type))}</p>${button(b.resolved ? "Restore this barrier" : "Mark as resolved", "resolve", `data-id="${id}" data-type="${b.type}" data-resolved="${b.resolved ? "false" : "true"}"`, "subtle")}</div>`).join("") : "<p>No current barrier was found. The standard discharge call is the next step.</p>"}<div class="what-if-note"><span>What if help is arranged?</span><p>Changes update this browser’s graph. They reset when you reload.</p>${button("Reset all changes", "reset", "", "subtle")}</div><h3>Clinical notes</h3>${p.notes.length ? p.notes.map((n) => `<button class="note-link" data-action="note-source" data-note="${n.id}"><strong>${escape(n.note_type)}</strong><span>${escape(n.author_role)} · ${time(n.written_datetime)}</span>↗</button>`).join("") : "<p>This patient has no clinical notes.</p>"}`,
    true,
  );
}
function showMistakes() {
  const overall = evaluation.overall || evaluation,
    per = evaluation.byType || {},
    mistakes = evaluation.mistakes || [
      ...(evaluation.falsePositives || []).map((m) => ({
        ...m,
        kind: "False positive",
      })),
      ...(evaluation.falseNegatives || []).map((m) => ({
        ...m,
        kind: "Missed barrier",
      })),
    ];
  modal(
    "Inspect the reader’s mistakes",
    `${accuracyStrip()}<p>The reader sees note text. A separate answer key scores the result after reading; it never creates graph edges.</p>${resultTable(Object.entries(per).map(([type, m]) => ({ barrier: labels(type), precision: percent(m.precision), recall: percent(m.recall), true_positive: m.tp ?? m.truePositive, false_positive: m.fp ?? m.falsePositive, missed: m.fn ?? m.falseNegative })))}<h3>False positives and missed sentences</h3>${
      (Array.isArray(mistakes)
        ? mistakes
        : [
            ...(mistakes.falsePositives || []),
            ...(mistakes.falseNegatives || []),
          ]
      )
        .map((m) => {
          const n = notes.find((n) => n.id === (m.noteId || m.note_id || m.id));
          return `<button class="mistake-card" data-action="note-source" data-note="${escape(n?.id || m.noteId || m.note_id)}"><strong>${escape(m.kind || m.outcome || m.type || "Reader mismatch")} · ${escape(labels(m.barrier || m.barrierType || m.type))}</strong><blockquote>${escape(m.sentence || m.prediction?.evidence_sentence || m.text || m.quote || n?.text || "Open the note to inspect its evidence.")}</blockquote><small>${escape(m.noteId || m.note_id || n?.id)}</small></button>`;
        })
        .join("") ||
      "<p>See the note-level evaluation export for individual differences.</p>"
    }`,
    true,
  );
}
function showComparison() {
  const truth = support.groundTruthIds(state.plan.id),
    rows = [5, 20].map((k) => {
      const r = searchIndex.search(planQuestion(state.plan), k, truth),
        m = r;
      return {
        method: `Search · ${k} passages`,
        right: m.rightPatients ?? m.right ?? m.tp,
        wrong: m.wrongPatients ?? m.wrong ?? m.fp,
        exact_count: "No",
        reads_hospital_rows: "No",
        evidence: "Retrieved notes",
      };
    });
  const found = new Set(query().patients.map((p) => p.id));
  const c = {
    right: [...found].filter((id) => truth.has(id)).length,
    wrong: [...found].filter((id) => !truth.has(id)).length,
  };
  rows.push({
    method: "Graph route",
    right: c.rightPatients ?? c.right ?? c.tp,
    wrong: c.wrongPatients ?? c.wrong ?? c.fp,
    exact_count: "Yes — graph matches",
    reads_hospital_rows: "Yes",
    evidence: "Row and note per person",
  });
  modal(
    "The same question, two ways",
    `<p>${escape(planQuestion(state.plan))}</p>${resultTable(rows.map((r) => ({ Method: r.method, "Correct patients": r.right, "Incorrect patients": r.wrong, "Exact graph count": r.exact_count, "Reads hospital rows": r.reads_hospital_rows, "Evidence per patient": r.evidence })))}<div class="evaluation-denominator"><strong>${truth.size} patients</strong> are in the separate answer key. The graph misses <strong>${truth.size - c.right}</strong> and includes <strong>${c.wrong}</strong> incorrect patients.</div><p>Graph accuracy still depends on what the note reader finds. Counts are exact for the graph; the separate answer key measures whether those people are the right ones.</p>`,
    true,
  );
}
function showAbout() {
  modal(
    "About this prototype",
    `<p class="about-lead">CareTrace connects hospital facts with the reasons hidden in clinical notes so a care transitions team can choose a useful next step.</p><h3>What runs when you use it</h3><p>Patient membership, counts, primary groups, dates, graph paths, query rows, search rankings, timings and what-if changes are computed in your browser from synthetic records. No calls, messages, bookings or orders leave this prototype.</p><h3>What was prepared</h3><p>Question routes and step explanations were prepared in advance with a language model and are replayed here. Note reading in this prototype uses a pattern-based reader. All counts are computed live from the graph. A production build would run the model at request time.</p><h3>How search is compared</h3><p>The retrieval baseline uses TF-IDF, expanded barrier terms and cosine similarity. PCA projects note vectors into two dimensions. A production build would use an embedding model. Search reads notes; the graph also reads hospital rows.</p><h3>How to read the measurements</h3><p>Precision and recall are note-level measurements against a separate answer key. The graph contains reader output and coded social needs, including their mistakes. The simplified follow-up and return rules illustrate a workflow; they are not a validated clinical risk score.</p><h3>A stable demonstration</h3><p>The synthetic chart uses a fixed seed and a fixed date, ${date(AS_OF)}. Changes made with “Mark as resolved” live in this browser’s memory and disappear on reload.</p>`,
    true,
  );
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const cmd = el.dataset.action;
  if (el.tagName === "A") e.preventDefault();
  if (cmd === "nav") return startScreen(Number(el.dataset.index));
  if (cmd === "next") return startScreen(state.screen + 1);
  if (cmd === "back") return startScreen(state.screen - 1);
  if (cmd === "restart") return startScreen(0);
  if (cmd === "pause") {
    state.paused = !state.paused;
    if (state.paused) clearTimeout(timer);
    else {
      if (state.step >= state.events.length - 1)
        return startScreen(state.screen);
      schedule(0);
    }
    renderControls();
    return;
  }
  if (cmd === "replay") return startScreen(state.screen);
  if (cmd === "step") {
    state.paused = true;
    clearTimeout(timer);
    advance();
    return;
  }
  if (cmd === "product" || cmd === "engine") {
    state.engine = cmd === "engine";
    render();
    return;
  }
  if (cmd === "menu") {
    state.menu = !state.menu;
    $(".workspace-nav").classList.toggle("open", state.menu);
    return;
  }
  if (cmd === "sheet") {
    state.sheet = !state.sheet;
    $(".pilot").classList.toggle("sheet-open", state.sheet);
    renderControls();
    return;
  }
  if (cmd === "collapse") {
    state.collapsed = !state.collapsed;
    render();
    return;
  }
  if (cmd === "tab") {
    state.tab = el.dataset.tab;
    state.collapsed = false;
    if (innerWidth < 768) state.sheet = true;
    render();
    return;
  }
  if (cmd === "overlay") {
    state.overlay = !state.overlay;
    render();
    return;
  }
  if (cmd === "about") return showAbout();
  if (cmd === "close-modal") return closeModal();
  if (cmd === "patient") return showPatient(el.dataset.id);
  if (cmd === "shape-row") {
    const result = query(),
      row = result.rows[Number(el.dataset.index)];
    if (!row) return;
    if (result.shape === "returns") return showPatient(row.patientId || row.id);
    return modal(
      row.unit || row.note_type,
      graph.patients
        .filter((p) => row.patientIds.includes(p.id))
        .map((p) => patientRow(p))
        .join(""),
      true,
    );
  }
  if (cmd === "trace-patient") {
    closeModal();
    return startScreen(4, { patientId: el.dataset.id });
  }
  if (cmd === "rewind-patient") {
    closeModal();
    return startScreen(7, { patientId: el.dataset.id });
  }
  if (cmd === "random") {
    const ps = query().patients.length ? query().patients : graph.patients;
    return startScreen(4, {
      patientId: ps[Math.floor(Math.random() * ps.length)].id,
    });
  }
  if (cmd === "all-patients")
    return modal(
      "Patients in this answer",
      query()
        .patients.map((p) => patientRow(p))
        .join(""),
      true,
    );
  if (cmd === "group") {
    const r = query(),
      g =
        r.groups.find((g) => g.type === el.dataset.type) ||
        mainResult().groups.find((g) => g.type === el.dataset.type);
    return modal(
      labels(el.dataset.type),
      `<p>${escape(action(el.dataset.type))}</p>${graph.patients
        .filter((p) => g?.patientIds.includes(p.id))
        .map((p) => patientRow(p))
        .join("")}`,
      true,
    );
  }
  if (cmd === "note-source")
    return showNote(notes.find((n) => n.id === el.dataset.note));
  if (cmd === "fact") {
    const p = patient();
    if (el.dataset.kind === "note") return showNote(primaryNote(p));
    return modal(
      el.dataset.kind === "appointments"
        ? "Appointments table"
        : "Outpatient pharmacy",
      resultTable(p[el.dataset.kind] || []),
      true,
    );
  }
  if (cmd === "mistakes") return showMistakes();
  if (cmd === "comparison") return showComparison();
  if (cmd === "resolve") {
    graph.setResolved(
      el.dataset.id,
      el.dataset.type,
      el.dataset.resolved === "true",
    );
    state.events = makeSequence();
    render();
    showPatient(el.dataset.id);
    toast("Recomputed from the graph.");
    return;
  }
  if (cmd === "reset") {
    graph.reset();
    state.events = makeSequence();
    render();
    closeModal();
    toast("Original graph restored.");
    return;
  }
  if (
    cmd === "rewind-discharge" ||
    cmd === "rewind-today" ||
    cmd === "rewind-date"
  ) {
    state.paused = true;
    clearTimeout(timer);
    state.rewind =
      cmd === "rewind-discharge"
        ? patient().admission.dischargeDate
        : cmd === "rewind-today"
          ? AS_OF
          : el.dataset.date;
    render();
    return;
  }
  if (cmd === "copy-events") {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(eventsShown(), null, 2),
      );
      toast("Events copied.");
    } catch {
      toast("Clipboard access is unavailable. The event JSON remains visible.");
    }
    return;
  }
  if (cmd === "choose-question") {
    state.plan = plans.find((p) => p.id === el.dataset.id) || state.plan;
    state.queryText = "";
    state.closest = false;
    selectMatchingPatient();
    return startScreen(4);
  }
  if (cmd === "ask") {
    const text = $("#question-input").value.trim();
    const matched = support.matchQuestion(text, plans);
    state.plan = matched?.plan || matched?.match || matched || state.plan;
    state.closest = !plans.some(
      (p) => planQuestion(p).toLowerCase() === text.toLowerCase(),
    );
    state.queryText = "";
    selectMatchingPatient();
    return startScreen(4);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search-k") {
    state.k = Number(e.target.value);
    const focus = e.target;
    render();
    $("#search-k")?.focus();
  }
  if (e.target.id === "rewind-slider") {
    state.paused = true;
    clearTimeout(timer);
    state.rewind = new Date(
      Date.parse(patient().admission.admitDate) +
        Number(e.target.value) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    render();
    $("#rewind-slider")?.focus();
  }
  if (e.target.id === "question-input") {
    state.queryText = e.target.value;
    const list = $("#question-suggestions"),
      terms = state.queryText.toLowerCase().split(/\s+/).filter(Boolean);
    const choices = plans
      .map((p) => ({
        p,
        score: terms.reduce(
          (n, t) => n + (planQuestion(p).toLowerCase().includes(t) ? 1 : 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    list.hidden = false;
    list.innerHTML = choices
      .map(
        ({ p }) =>
          `<button data-action="choose-question" data-id="${escape(p.id)}">${escape(planQuestion(p))}<span>↗</span></button>`,
      )
      .join("");
  }
});
document.addEventListener("focusin", (e) => {
  if (e.target.id === "question-input") {
    e.target.select();
    const list = $("#question-suggestions");
    list.hidden = false;
    list.innerHTML = plans
      .map(
        (p) =>
          `<button data-action="choose-question" data-id="${escape(p.id)}">${escape(planQuestion(p))}<span>↗</span></button>`,
      )
      .join("");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    $(".question-suggestions")?.setAttribute("hidden", "");
    state.menu = false;
    $(".workspace-nav")?.classList.remove("open");
    return;
  }
  if (state.modal) {
    if (e.key === "Tab") {
      const controls = [
        ...$("#overlay-root").querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ),
      ].filter((element) => !element.hidden && element.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (!controls.includes(document.activeElement) ||
          document.activeElement === first)
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (!controls.includes(document.activeElement) ||
          document.activeElement === last)
      ) {
        e.preventDefault();
        first.focus();
      }
    }
    return;
  }
  if (
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(e.target.tagName) ||
    e.target.isContentEditable
  )
    return;
  if (e.key.toLowerCase() === "e") {
    state.engine = !state.engine;
    render();
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    startScreen(Math.min(8, state.screen + 1));
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    startScreen(Math.max(0, state.screen - 1));
  }
  if (e.key === " ") {
    e.preventDefault();
    state.paused = !state.paused;
    if (state.paused) clearTimeout(timer);
    else schedule(0);
    renderControls();
  }
});
window.addEventListener("error", () => {
  toast("A view could not finish. Replay this step to retry.");
});
startScreen(
  Math.max(
    0,
    SCREENS.findIndex((s) => s.id === location.hash.slice(1)),
  ),
);
window.careweavePilot = {
  snapshot: () => ({
    screen: SCREENS[state.screen].id,
    engine: state.engine,
    step: state.step,
    events: eventsShown(),
    funnel: graph.funnel(),
    totals: graph.totals(),
    question: state.plan?.id,
    patientId: state.patientId,
    evaluation,
  }),
  graph,
};
