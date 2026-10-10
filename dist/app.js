import { AS_OF, BARRIERS, makeDraft, matchesPlan } from "./engine.js";
import { NOTE_TYPES } from "./ontology.js";
import { createGraph, graphColors } from "./graph.js";
import { createCareStudio } from "./care-studio.js";

const QUESTIONS = {
  main: "Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?",
  cost: "Which patients report a cost barrier and never picked up their discharge insulin?",
  return: "Who is likely to return?",
};
const TABLES = [
  "Admissions and discharges",
  "Problem list",
  "Lab results",
  "Discharge medications",
  "Outpatient pharmacy",
  "Appointments",
  "Emergency department visits",
  "Coded social needs",
];
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (value) => Number(value || 0).toLocaleString();
const date = (value) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
      )
    : "Not recorded";
const label = (type) =>
  BARRIERS[type]?.label ||
  (type === "standard"
    ? "Standard discharge call"
    : String(type || "").replaceAll("_", " "));
const owner = (type) => BARRIERS[type]?.owner || "Care transitions nurse";
const nextAction = (type) =>
  BARRIERS[type]?.action ||
  "Make the standard discharge call and reschedule the follow-up visit.";
const pct = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 1000) / 10}%` : "—";
const relative = (note) => {
  const days = Number(note.daysFromDischarge || 0);
  return days === 0
    ? "on discharge day"
    : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days < 0 ? "before" : "after"} discharge`;
};
const reasons = (p) =>
  (p.followUpGap?.reasons || [])
    .map((r) =>
      typeof r === "string" ? r.replaceAll("_", " ") : r.label || r.reason,
    )
    .join("; ");
const pill = (text, tone = "") =>
  `<span class="pill ${tone}">${esc(text)}</span>`;
const btn = (text, cmd, attributes = "", style = "") =>
  `<button class="btn ${style}" data-cmd="${cmd}" ${attributes} ${["save-task", "task-update", "note-commit"].includes(cmd) && state.status.access?.canWrite === false ? 'disabled title="Staff sign-in is required to change shared data"' : ""}>${text}</button>`;
const empty = (title, body) =>
  `<div class="empty"><span>✳</span><h2>${title}</h2><p>${body}</p></div>`;
const heading = (eyebrow, title, description, controls = "") =>
  `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${description}</p></div>${controls}</div>`;
const state = {
  view: "home",
  connected: false,
  status: {},
  patients: [],
  metrics: {},
  tasks: [],
  runs: [],
  question: QUESTIONS.main,
  plan: null,
  result: null,
  events: [],
  answer: "",
  elapsed: null,
  busy: false,
  error: "",
  stale: false,
  baseline: null,
  graph: null,
  graphExpanded: false,
  graphMode: "patient",
  patientId: "P0412",
  selected: null,
  page: 0,
  filter: "all",
  taskFilter: "pending",
  evaluation: null,
  proof: null,
  proofText: "Denies transportation concerns. Wife drives.",
  note: {
    patientId: "P0412",
    text: "Transport arranged by SW prior to discharge.",
    date: AS_OF,
    type: NOTE_TYPES[4],
    preview: null,
  },
  simulation: null,
  budget: 1000,
  capacity: 20,
  strategy: "optimized",
  drawer: null,
};
let graphController,
  graphRequest = 0,
  toastTimer,
  returnFocus;
const pending = new Set();
const studio = createCareStudio({
  api,
  toast,
  rerender: () => {
    if (state.view === "handoff") render();
  },
  onPatient: (id) => openPatient(id),
  onGraph: async (id) => {
    studio.dispose();
    state.patientId = id;
    state.graphMode = "patient";
    state.view = "home";
    await loadGraph();
    window.scrollTo({ top: 0 });
  },
});
async function api(path, body, method) {
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 5500);
}
async function operation(key, fn) {
  if (pending.has(key)) return;
  pending.add(key);
  try {
    await fn();
  } catch (error) {
    toast(error.message);
  } finally {
    pending.delete(key);
  }
}
async function refresh() {
  const data = await api("/api/bootstrap");
  state.patients = data.patients;
  state.metrics = data.metrics;
  state.tasks = data.tasks || [];
  state.runs = data.runs || [];
  state.connected = true;
  state.status = { ...state.status, ...data };
}
async function start() {
  try {
    state.status = await api("/api/status");
    let seed = await api("/api/seed"),
      attempts = 0;
    while (!seed.complete) {
      if (state.status.access?.canWrite === false)
        throw new Error(
          "The owner needs to sign in once to prepare the hospital database.",
        );
      if (++attempts > 110)
        throw new Error("Setup did not finish. Refresh to resume.");
      $("#app").innerHTML =
        `<div class="boot"><span>✳</span><h1>Preparing the hospital demo</h1><p>${num(seed.count)} of ${num(seed.total || 1000)} synthetic discharges loaded.</p></div>`;
      seed = await api("/api/seed", { offset: seed.nextOffset ?? seed.count });
    }
    await refresh();
  } catch (error) {
    state.error = error.message;
  }
  render();
  if (state.connected) {
    loadGraph();
    api("/api/ml/metrics")
      .then((value) => {
        state.evaluation = value;
        if (state.view === "proof") render();
      })
      .catch(() => {});
  }
}
const NAV = [
  ["home", "⌘", "Hospital view"],
  ["cohort", "▦", "Patients & actions"],
  ["handoff", "◉", "Patient handoff"],
  ["notes", "▤", "Clinical note lab"],
  ["proof", "✓", "Proof & accuracy"],
  ["tasks", "☷", "Care team tasks"],
  ["impact", "◎", "Resource planner"],
  ["history", "◷", "Saved investigations"],
];
function accessNotice() {
  const access = state.status.access;
  if (!access || access.mode === "local") return "";
  return access.canWrite
    ? '<div class="access-notice">Staff workspace <span>Shared note and task changes are enabled.</span></div>'
    : `<div class="access-notice">Visitor preview <span>Explore freely. Shared notes and tasks require staff access.</span><a href="${esc(access.signInPath)}" target="_top">Staff sign-in →</a></div>`;
}
function shell(content) {
  return `<aside class="sidebar"><a href="#" data-cmd="nav" data-view="home" class="brand"><span>✚</span> careweave</a><div class="brand-sub">THE FIRST 30 DAYS HOME</div><div class="nav-label">HOSPITAL CARE TRANSITIONS</div><nav aria-label="Main navigation">${NAV.map(([id, symbol, name]) => `<button class="nav-item ${state.view === id ? "active" : ""}" data-cmd="nav" data-view="${id}" aria-label="${name}" title="${name}" aria-current="${state.view === id ? "page" : "false"}"><span aria-hidden="true">${symbol}</span><span>${name}</span>${id === "tasks" && state.tasks.filter((t) => t.status === "pending").length ? `<b>${state.tasks.filter((t) => t.status === "pending").length}</b>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="connection"><i class="${state.connected ? "live" : ""}"></i><div>${state.connected ? "Hospital demo connected" : "Connection unavailable"}<small>${state.status.model ? "OpenAI configured" : "Local rules + graph tools"}</small></div></div><p>The answer was already<br>in our own notes.</p></div></aside><div class="workspace"><header class="topbar"><span><b>Northstar Hospital System</b><small>Care transitions workspace</small></span><div>${pill("100% synthetic data", "green")}<span class="snapshot">${date(AS_OF)} snapshot</span></div></header><main id="main-content">${!state.connected ? `<div class="alert">${esc(state.error || "The hospital database is unavailable.")} ${btn("Reconnect", "reload")}</div>` : ""}${content}<footer>Fictional patients. Hospital-owned sources. Human review required.<span>No calls, messages, medication changes, or bookings are sent.</span></footer></main></div>`;
}
function sourceLayers() {
  return `<div class="source-layers"><section class="source-layer structured"><div class="layer-heading"><span>▦</span><div><h2>Hospital data store</h2><p>What happened during and after the stay</p></div></div><div class="source-chips">${TABLES.map((t) => `<span>${t}</span>`).join("")}</div></section><section class="source-layer clinical"><div class="layer-heading"><span>▤</span><div><h2>Clinical notes</h2><p>What patients told our clinicians and staff</p></div></div><div class="source-chips">${NOTE_TYPES.map((t) => `<span>${t}</span>`).join("")}</div></section></div>`;
}
const nodeLabel = (type) =>
  ({
    FollowUpGap: "Follow-up gap",
    ClinicalNote: "Clinical note",
    LabResult: "Lab result",
  })[type] || type;
const rulesNotice = () =>
  '<div class="rule-note"><b>Demo rules, made visible.</b> Follow-up gaps and “likely to return” are simplified hackathon rules, not a validated readmission model. A flagged patient needs staff review.</div>';
function homeView() {
  return `${heading("WE ARE A HOSPITAL SYSTEM", "We discharged them.<br><span>Let’s help them get back on track.</span>", "We wrote down why some patients will struggle at home. Connect those notes to missed visits and medication pickup, then prepare the right follow-up.", `<div class="hero-stats"><div><strong>${num(state.patients.length)}</strong><span>adult discharges<br>in the last 90 days</span></div><div><strong>${num(state.patients.filter((p) => p.admission?.diabetesRelated).length)}</strong><span>diabetes-related<br>admissions</span></div></div>`)}<div class="behaviors"><span><b>01</b> Attend follow-up within 14 days</span><span><b>02</b> Start discharge medications</span><span><b>03</b> Check glucose at home</span><span><b>04</b> Know when to call the clinic</span></div>${sourceLayers()}<div class="investigation-grid"><section class="graph-card ${state.graphExpanded ? "expanded" : ""}"><div class="graph-top"><div class="eyebrow">FOLLOW THE CONNECTED FACTS</div><h2>${state.graphMode === "patient" ? "One patient. The full discharge story." : state.graphMode === "ontology" ? "How the hospital’s facts connect" : "The patients behind the answer"}</h2><div class="segmented">${[
    ["patient", "Patient story"],
    ["discharges", "Discharges"],
    ["ontology", "Schema"],
    ["cohort", "This answer"],
  ]
    .map(
      ([mode, name]) =>
        `<button data-cmd="graph-mode" data-mode="${mode}" class="${state.graphMode === mode ? "active" : ""}" ${mode === "cohort" && !state.result ? "disabled" : ""}>${name}</button>`,
    )
    .join(
      "",
    )}</div></div><div class="graph-meta"><span>${state.graphMode === "patient" ? esc(state.patients.find((p) => p.id === state.patientId)?.name || state.patientId) : "Hospital knowledge graph"}</span><span>${state.graph ? `${num(state.graph.nodes.length)} facts · ${num(state.graph.edges.length)} connections` : "Loading…"}</span></div><div id="graph-canvas" role="img" aria-label="Hospital evidence graph. Inspect individual facts in the directory below."></div><div class="graph-controls">${btn("−", "zoom-out", "", "icon-btn")}${btn("+", "zoom-in", "", "icon-btn")}${btn("Fit graph", "fit", "", "small")}${btn(state.graphExpanded ? "Compact graph" : "Focus graph", "graph-focus", "", "small")}</div><div class="graph-legend">${Object.entries(
    graphColors,
  )
    .map(
      ([t, color]) =>
        `<span><i style="background:${color}"></i>${nodeLabel(t)}</span>`,
    )
    .join(
      "",
    )}</div><div class="graph-foot">${state.graph?.truncated ? "A connected sample is displayed. Queries count all patient discharges." : "Every connection comes from a stored fact or a stated demo rule."}</div></section><section class="card investigator"><div class="eyebrow">THE CARE TRANSITIONS TEAM’S QUESTION</div><h2>Who needs a different kind of help?</h2><p>Search finds a sentence. The graph connects it to the discharge, visit, medication, and next action.</p><form id="query-form"><label for="question">Ask about patients after discharge</label><textarea id="question" rows="6" ${state.busy ? "readonly" : ""}>${esc(state.question)}</textarea><div class="query-buttons">${btn("1. Search notes", "search", 'type="button" ' + (state.busy || !state.connected ? "disabled" : ""), "secondary")}<button class="btn primary" type="submit" ${state.busy || !state.connected ? "disabled" : ""}>${state.busy ? "Investigating…" : "2. Connect the facts →"}</button></div></form><div class="question-examples">${btn("Open follow-up gaps", "question", 'data-question="main" ' + (state.busy ? "disabled" : ""))}${btn("Cost + insulin not picked up", "question", 'data-question="cost" ' + (state.busy ? "disabled" : ""))}${btn("Who is likely to return?", "question", 'data-question="return" ' + (state.busy ? "disabled" : ""))}</div><div class="engine-label">${state.status.model ? "OpenAI tool agent" : "Local deterministic investigator"} · database-computed counts</div>${state.error && state.connected ? `<div class="alert">${esc(state.error)}</div>` : ""}${state.result ? `<div class="answer-preview"><strong>${num(state.result.count)}</strong><span>matching patients</span><p>${esc(state.answer)}</p>${btn("Review patients & actions →", "nav", 'data-view="cohort"', "primary")}</div>` : ""}</section></div>${state.baseline ? baselineView() : ""}${state.events.length ? traceView() : ""}${directoryView()}<div class="judges-line">“The answer was already in our own notes.<br><strong>The graph is what lets us ask for it.</strong>”</div>${rulesNotice()}`;
}
function baselineView() {
  return `<section class="card padded"><div class="section-heading"><div><div class="eyebrow">1 / NOTE SEARCH</div><h2>A sentence is useful. It isn’t the whole answer.</h2></div>${pill("Passages only · no patient count", "purple")}</div><p>This search returns clinical note passages. It does not join attendance, discharge dates, and pharmacy pickup to count the patients who meet the question.</p><div class="passage-grid">${
    (state.baseline.passages || state.baseline.results || [])
      .slice(0, 4)
      .map(
        (p) =>
          `<blockquote><small>${esc(p.note_type || p.type)} · ${esc(p.patientId)}</small><p>“${esc(p.quote || p.text)}”</p>${btn("Open patient", "patient", `data-id="${esc(p.patientId)}"`, "text-btn")}</blockquote>`,
      )
      .join("") || "<p>No matching passages.</p>"
  }</div></section>`;
}
function traceView() {
  return `<section class="card padded"><div class="eyebrow">2 / ACTUAL INVESTIGATION</div><h2>Watch the reason come into focus.</h2><div class="route">${["Patient", "Admission", "FollowUpGap", "Barrier", "Action"].map((t, i) => `<span>${nodeLabel(t)}</span>${i < 4 ? "<b>→</b>" : ""}`).join("")}</div><p class="small-text">An investigation route across connected facts. Individual edges follow the allowed relationships.</p><ol class="trace-list">${state.events
    .map(
      (ev) =>
        `<li><span class="step">${ev.step}</span><div><b>${esc(ev.say || ev.tool)}</b><small>${esc(ev.tool)} · ${num(ev.found)} found</small>${btn("Inspect this step on the graph", "trace-step", `data-step="${ev.step}"`, "text-btn")}${(
          ev.evidence || []
        )
          .slice(0, 1)
          .map(
            (v) => `<blockquote>“${esc(v.quote || v.text || "")}”</blockquote>`,
          )
          .join("")}</div></li>`,
    )
    .join("")}</ol></section>`;
}
function directoryView() {
  return state.graph
    ? `<details class="card directory"><summary>Inspect graph facts <span>${num(state.graph.nodes.length)} nodes</span></summary><div class="node-list">${state.graph.nodes.map((n) => `<button data-cmd="node" data-id="${esc(n.id)}"><i style="background:${graphColors[n.type] || "#aaa"}"></i><span><b>${esc(n.label || n.name || n.id)}</b><small>${nodeLabel(n.type)} · ${esc(n.id)}</small></span></button>`).join("")}</div></details>`
    : "";
}
function standardPatients() {
  const plan = {
    ...state.plan,
    barriers: [],
    barrierPresence: "absent",
    gapOnly: true,
  };
  return state.patients.filter((p) => matchesPlan(p, plan));
}
function groupCard(type) {
  const standard = type === "standard",
    list = standard
      ? standardPatients()
      : (state.result?.patients || []).filter((p) =>
          p.barriers.some((b) => b.type === type),
        );
  return `<button class="group-card ${state.filter === type ? "selected" : ""}" data-cmd="group" data-type="${type}"><div><b>${label(type)}</b><strong>${num(state.result?.groups?.find((group) => group.type === type)?.count ?? list.length)}</strong></div><p>${esc(nextAction(type))}</p><small>${esc(owner(type))}</small>${standard ? "<em>Separate group: open follow-up gap, no documented barrier. The call checks for needs not yet recorded.</em>" : ""}</button>`;
}
const extractionMetrics = () =>
  state.evaluation?.extraction || state.evaluation?.rules || state.evaluation;
function cohortView() {
  const all =
      state.filter === "standard"
        ? standardPatients()
        : state.result?.patients || [],
    selected = ["all", "standard"].includes(state.filter)
      ? all
      : all.filter((p) => p.barriers.some((b) => b.type === state.filter)),
    sorted = [...selected].sort(
      (a, b) => (b.id === "P0412") - (a.id === "P0412"),
    ),
    page = sorted.slice(state.page * 10, state.page * 10 + 10),
    pages = Math.max(1, Math.ceil(sorted.length / 10));
  return `${heading("3 / PATIENTS, REASONS, NEXT STEPS", state.plan && !state.plan.gapOnly ? "Patients matching<br><span>your hospital question.</span>" : "Open follow-up gap<br><span>with a barrier we can act on.</span>", "Each group has a hospital action, a responsible role, and a source you can inspect.", btn("Export answer", "export-answer", state.result ? "" : "disabled"))}${state.stale ? '<div class="alert">This answer is historical or outdated. Run the question again before preparing actions.</div>' : ""}${!state.result ? `<div class="card padded"><p>Run the hospital question to build the exact cohort.</p>${btn("Find patients needing help →", "run-main", "", "primary")}</div>` : `<div class="result-metrics"><div><strong>${num(state.result.count)}</strong><span>patients in the exact answer</span></div><div><strong>${num(state.result.within30Count ?? state.result.patients.filter((p) => p.daysSinceDischarge < 30).length)}</strong><span>patients we can still reach before day 30</span></div><div><strong>${state.elapsed === null ? "Saved" : (state.elapsed / 1000).toFixed(2) + "s"}</strong><span>time to answer</span></div><div><strong>${pct(extractionMetrics()?.precision)} / ${pct(extractionMetrics()?.recall)}</strong><span>extraction precision / recall</span></div></div><div class="answer-explanation"><p>${esc(state.answer)}</p><details><summary>Inspect filters and exact query</summary><pre>${esc(JSON.stringify({ plan: state.plan, fingerprint: state.result.fingerprint, sql: state.result.sql }, null, 2))}</pre></details></div>`}<div class="groups">${Object.keys(BARRIERS).map(groupCard).join("")}${groupCard("standard")}</div>${state.result && state.result.count > state.result.patients.length ? `<div class="rule-note">Showing the first ${num(state.result.patients.length)} patients requested. The total and group counts cover every match.</div>` : ""}<div class="section-heading"><h2>${state.filter === "all" ? "Patients in this answer" : label(state.filter)}</h2><div>${btn("Show all groups", "group", 'data-type="all"', "small")}${pill(`${num(selected.length)} patients`, "green")}</div></div><div class="table-wrap"><table><thead><tr><th>Patient</th><th>Discharged</th><th>Follow-up facts</th><th>Documented barrier</th><th>Next step</th></tr></thead><tbody>${page.map((p) => `<tr><td><b>${esc(p.name)}</b><small>${p.id} · ${p.age} years</small></td><td>${date(p.admission.dischargeDate)}<small>Day ${p.daysSinceDischarge} at home</small></td><td>${esc(reasons(p) || (p.daysSinceDischarge < 14 ? "Gap assessment starts on day 14" : "No open follow-up gap"))}</td><td>${p.barriers.length ? p.barriers.map((b) => pill(label(b.type), b.type)).join(" ") : pill("No documented barrier")}</td><td>${btn("Review evidence →", "patient", `data-id="${p.id}"`, "text-btn")}</td></tr>`).join("") || '<tr><td colspan="5">No patients meet these filters.</td></tr>'}</tbody></table></div><div class="pagination">${btn("Previous", "page", 'data-delta="-1" ' + (!state.page ? "disabled" : ""), "small")}<span>Page ${state.page + 1} of ${pages}</span>${btn("Next", "page", `data-delta="1" ${state.page + 1 >= pages ? "disabled" : ""}`, "small")}</div>${rulesNotice()}`;
}
function noteView() {
  const n = state.note;
  return `${heading("A NEW PIECE OF THE DISCHARGE STORY", "When the notes change,<br><span>the next step should change too.</span>", "Preview a fictional clinical note, then add it. The graph and affected tasks are rechecked.")}<div class="two-columns"><section class="card padded"><label for="note-patient">Patient</label><select id="note-patient" ${state.busy ? "disabled" : ""}>${state.patients
    .filter((p) => p.admission.diabetesRelated)
    .map(
      (p) =>
        `<option value="${p.id}" ${n.patientId === p.id ? "selected" : ""}>${esc(p.name)} · ${p.id} · discharged ${p.admission.dischargeDate}</option>`,
    )
    .join(
      "",
    )}</select><label for="note-type">Clinical note type</label><select id="note-type" ${state.busy ? "disabled" : ""}>${NOTE_TYPES.map((t) => `<option ${t === n.type ? "selected" : ""}>${t}</option>`).join("")}</select><label for="note-date">Note date</label><input id="note-date" type="date" max="${AS_OF}" value="${n.date}" ${state.busy ? "readonly" : ""}><label for="note-text">Fictional clinical note</label><textarea id="note-text" rows="7" ${state.busy ? "readonly" : ""}>${esc(n.text)}</textarea><div class="button-row">${btn("Preview extraction", "note-preview", state.busy ? "disabled" : "", "secondary")}${btn("Add note & update graph", "note-commit", state.busy || !n.preview ? "disabled" : "", "primary")}</div><p class="small-text">Only synthetic text belongs here. Adding a note persists it; previewing does not.</p></section><section class="card padded"><div class="eyebrow">WHAT THE SENTENCE SUPPORTS</div><h2>What this note says</h2>${n.preview ? `${(n.preview.assertions || []).map((a) => `<blockquote>${pill(label(a.type), a.type)}${pill(a.status || "active")}<p>“${esc(a.quote)}”</p><small>${esc(a.note_type || n.type)} · confidence ${pct(a.confidence)}</small></blockquote>`).join("") || empty("No barrier statement identified.", "A denial, resolved need, or someone else’s situation must not create a current patient barrier.")}<details><summary>Inspect extraction output</summary><pre>${esc(JSON.stringify(n.preview, null, 2))}</pre></details>` : "<p>The accepted sentence, note type, and confidence appear here. The extractor does not receive the hidden evaluation answers.</p>"}</section></div>`;
}
function proofView() {
  const p = state.proof,
    m = extractionMetrics();
  return `${heading("LET THE EVIDENCE EARN YOUR TRUST", "Try to break the answer.", "Run one question three times, verify source sentences, and challenge the clinical language.", btn("Export proof", "export-proof", !p ? "disabled" : ""))}<div class="result-metrics"><div><strong>${pct(m?.precision)}</strong><span>extraction precision</span></div><div><strong>${pct(m?.recall)}</strong><span>extraction recall</span></div><div><strong>${num(m?.total || m?.cases || m?.documents)}</strong><span>labeled evaluation notes</span></div><div><strong>3</strong><span>consecutive database executions</span></div></div><div class="two-columns"><section class="card padded"><h2>Fixed expectations. Live execution.</h2><p>Includes a denial, a resolved need, a relative’s situation, meals held for a procedure, and a historical need.</p>${btn(state.busy ? "Running…" : "Run hospital acceptance checks", "run-proof", state.busy ? "disabled" : "", "primary")}${p ? `<div class="proof-score"><strong>${p.summary?.passed} / ${p.summary?.total}</strong><span>included checks passed</span></div>${(p.cases || []).map((c) => `<details class="proof-case"><summary><span class="${c.passed ? "pass" : "fail"}">${c.passed ? "✓" : "×"}</span>${esc(c.title || c.id)}</summary><blockquote>${esc(c.text)}</blockquote><pre>${esc(JSON.stringify({ expected: c.expected, actual: c.actual }, null, 2))}</pre></details>`).join("")}<div class="proof-result"><h3>${p.repeatability?.passed ? "Same question. Same exact count." : "Review the repeatability result."}</h3><div class="repeat-counts">${(p.repeatability?.counts || []).map((count, index) => `<span><small>Run ${index + 1}</small><b>${num(count)}</b> patients</span>`).join("")}</div><details><summary>Inspect repeatability details</summary><pre>${esc(JSON.stringify(p.repeatability, null, 2))}</pre></details></div>${p.evidenceCoverage ? `<h3>${p.evidenceCoverage.verified} / ${p.evidenceCoverage.total} sources verified</h3>` : ""}` : ""}</section><div><section class="card padded"><h2>The judge’s own sentence</h2><label for="proof-text">Fictional clinical text</label><textarea id="proof-text" rows="5" ${state.busy ? "readonly" : ""}>${esc(state.proofText)}</textarea>${btn("Inspect this sentence", "custom-proof", state.busy ? "disabled" : "", "secondary")}${p?.custom ? `<pre>${esc(JSON.stringify(p.custom, null, 2))}</pre>` : ""}</section><section class="card padded space-top"><h2>What the numbers mean</h2>${
    m?.perBarrier
      ? `<div class="table-wrap"><table><thead><tr><th>Barrier</th><th>Precision</th><th>Recall</th></tr></thead><tbody>${Object.entries(
          m.perBarrier,
        )
          .map(
            ([type, scores]) =>
              `<tr><td>${label(type)}</td><td>${pct(scores.precision)}</td><td>${pct(scores.recall)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : ""
  }<p>Precision asks whether accepted barriers match the hidden answers. Recall asks how many seeded barriers were found.</p><p>This new synthetic hospital evaluation is authored for the prototype. It is not independent clinical validation.</p><details><summary>Full evaluation and errors</summary><pre>${esc(JSON.stringify(state.evaluation, null, 2))}</pre></details><p class="small-text">A source match verifies provenance. It does not prove clinical truth or improved health.</p></section></div></div>`;
}
function taskView() {
  return `${heading("HELP THAT A HUMAN CAN REVIEW", "The care transitions team’s<br><span>next steps.</span>", "Drafts name the action, responsible role, and evidence. Approval saves a demo review; nothing is sent.", btn("Export tasks", "export-tasks"))}<div class="segmented wrap">${[
    ["pending", "Needs approval"],
    ["needs_review", "Evidence changed"],
    ["approved", "Approved"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ]
    .map(
      ([s, l]) =>
        `<button data-cmd="task-filter" data-status="${s}" class="${state.taskFilter === s ? "active" : ""}">${l} (${state.tasks.filter((t) => t.status === s).length})</button>`,
    )
    .join("")}</div><div class="task-grid">${
    state.tasks
      .filter((t) => t.status === state.taskFilter)
      .map(
        (t) =>
          `<article class="card padded"><small>${esc(t.patientId)} · ${esc(owner(t.barrier))}</small><h2>${esc(t.title)}</h2>${pill(t.status.replaceAll("_", " "))}${t.reason ? `<div class="alert">${esc(t.reason)}</div>` : ""}<p class="task-body">${esc(t.body)}</p><small>Source ${esc(t.evidence?.documentId || "Hospital follow-up facts")} · version ${t.version}</small><div class="button-row">${btn("Evidence & edit", "patient", `data-id="${t.patientId}" data-barrier="${t.barrier}"`, "secondary")}${t.status === "pending" ? btn("Approve demo task", "task-update", `data-id="${t.id}" data-status="approved"`, "primary") : t.status === "needs_review" ? btn("Recheck evidence", "task-update", `data-id="${t.id}" data-status="pending"`, "primary") : t.status === "approved" ? btn("Mark completed", "task-update", `data-id="${t.id}" data-status="completed"`, "primary") : ""}${["pending", "approved", "needs_review"].includes(t.status) ? btn("Cancel", "task-update", `data-id="${t.id}" data-status="cancelled"`, "text-btn") : ""}</div></article>`,
      )
      .join("") ||
    empty(
      "Ready for the next useful step.",
      "Inspect a patient’s evidence and prepare a task for the responsible hospital team.",
    )
  }</div>`;
}
function historyView() {
  return `${heading("AN ANSWER YOU CAN COME BACK TO", "Saved investigations.", "Replay the original count and source trail. Rerun a saved answer before acting on current evidence.")}<div class="card history-list">${state.runs.map((r) => `<button data-cmd="replay" data-id="${r.id}"><span><b>${esc(r.question)}</b><small>${date(r.createdAt)} · ${esc(r.engine)}</small></span><strong>${num(r.count)} patients →</strong></button>`).join("") || empty("No saved investigations yet.", "Ask the hospital question to save an actual execution.")}</div>`;
}
function impactView() {
  const r = state.simulation,
    s = r?.[state.strategy];
  return `${heading("MAKE LIMITED SUPPORT GO FURTHER", "What can our team support<br><span>with the resources available?</span>", "Compare two transparent planning strategies against current evidence. Hypothetical allocations do not change patient records or predict outcomes.")}<div class="impact-layout"><section class="card padded"><h2>Available resources</h2><label for="budget">Illustrative support budget: $${num(state.budget)}</label><input id="budget" type="range" min="0" max="5000" step="50" value="${state.budget}"><label for="capacity">Patients our team can contact: ${state.capacity}</label><input id="capacity" type="range" min="1" max="100" value="${state.capacity}">${btn("Compare strategies", "simulate", state.busy ? "disabled" : "", "primary")}<p class="small-text">Illustrative costs. The comparison does not predict completed visits, medication use, or a return to hospital.</p></section><section>${r ? `<div class="comparison"><div class="card padded"><small>PRIORITY-FIRST</small><strong>${r.baseline.allBarriersAddressed}</strong><span>patients with all documented needs supported</span><p>$${r.baseline.budgetUsed} allocated</p></div><div class="card padded featured"><small>BUNDLE-AWARE HEURISTIC</small><strong>${r.optimized.allBarriersAddressed}</strong><span>patients with all documented needs supported</span><p>$${r.optimized.budgetUsed} allocated</p></div></div><div class="rule-note">More complete support can mean a different priority mix. ${r.tradeoffs ? `Average demo priority: ${r.tradeoffs.optimizedAveragePriority} versus ${r.tradeoffs.baselineAveragePriority}.` : ""} This is not clinical prioritization.</div><div class="card padded"><div class="section-heading"><h2>Patients behind the plan</h2><div class="segmented"><button data-cmd="strategy" data-strategy="baseline">Priority-first</button><button data-cmd="strategy" data-strategy="optimized">Bundle-aware</button></div></div><div class="allocation-list">${(s?.allocations || []).map((a) => `<button data-cmd="patient" data-id="${a.patientId}"><b>${esc(a.name)} <small>${a.patientId}</small></b><span>${(a.addressedBarriers || []).map(label).join(" + ")}</span><strong>$${a.cost} →</strong></button>`).join("") || "<p>No support can be allocated.</p>"}</div><details><summary>Assumptions and reproducibility</summary><pre>${esc(JSON.stringify({ assumptions: r.assumptions, fingerprint: r.fingerprint }, null, 2))}</pre></details></div>` : empty("A patient may need more than a ride.", "Connect the documented needs before comparing options.")}</section></div>`;
}

function render() {
  graphController?.destroy();
  graphController = null;
  const views = {
    home: homeView,
    cohort: cohortView,
    notes: noteView,
    proof: proofView,
    tasks: taskView,
    history: historyView,
    impact: impactView,
    handoff: () =>
      studio.render({ patients: state.patients, status: state.status }),
  };
  $("#app").innerHTML = shell(
    accessNotice() + (views[state.view] || homeView)(),
  );
  bind();
  if (state.view === "home" && state.graph) drawGraph();
}
function bind() {
  $("#query-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.question = $("#question").value;
    runQuestion();
  });
  $("#question")?.addEventListener(
    "input",
    (event) => (state.question = event.target.value),
  );
  $("#proof-text")?.addEventListener(
    "input",
    (event) => (state.proofText = event.target.value),
  );
  for (const [id, key] of [
    ["note-date", "date"],
    ["note-type", "type"],
    ["note-patient", "patientId"],
  ])
    $("#" + id)?.addEventListener("change", (event) => {
      state.note[key] = event.target.value;
      state.note.preview = null;
      render();
    });
  $("#note-text")?.addEventListener("input", (event) => {
    state.note.text = event.target.value;
    state.note.preview = null;
    $('[data-cmd="note-commit"]').disabled = true;
  });
  for (const [id, key] of [
    ["budget", "budget"],
    ["capacity", "capacity"],
  ])
    $("#" + id)?.addEventListener("change", (event) => {
      state[key] = +event.target.value;
      state.simulation = null;
      render();
    });
}
async function loadGraph() {
  const request = ++graphRequest;
  try {
    let query = `mode=${state.graphMode}&limit=50`;
    if (state.graphMode === "patient") query += `&patientId=${state.patientId}`;
    if (state.graphMode === "cohort")
      query += `&patientIds=${(state.result?.patients || []).map((p) => p.id).join(",")}`;
    const graph = await api("/api/graph?" + query);
    if (request !== graphRequest) return;
    state.graph = graph;
    if (state.view === "home") render();
  } catch (error) {
    if (request === graphRequest) toast(error.message);
  }
}
function drawGraph() {
  graphController = createGraph($("#graph-canvas"), state.graph, {
    mode: state.graphMode,
    onSelect: (node) => {
      state.selected = node;
      if (node?.schemaNode || state.graphMode === "ontology") {
        toast(`${nodeLabel(node.type)}: ${node.label || node.id}`);
        return;
      }
      const patientId = node?.type === "Patient" ? node.id : node?.patientId;
      if (patientId) operation("patient", () => openPatient(patientId));
      else if (node) toast(`${nodeLabel(node.type)}: ${node.label || node.id}`);
    },
  });
}
async function runQuestion(question = state.question) {
  if (state.busy || !state.connected) return;
  state.question = question;
  state.busy = true;
  state.error = "";
  state.events = [];
  state.result = null;
  state.answer = "";
  state.page = 0;
  state.filter = "all";
  state.stale = false;
  state.graphMode = "ontology";
  render();
  const startTime = performance.now();
  try {
    await loadGraph();
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        previousPlan: state.plan,
        stream: true,
      }),
    });
    if (!response.ok) {
      const value = await response.json();
      throw new Error(value.error || "The investigation could not start.");
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      final;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop();
      for (const frame of frames) {
        const kind = frame.match(/^event: (.+)$/m)?.[1],
          raw = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (kind === "tool") {
          state.events.push(data);
          render();
          graphController?.highlight(data);
        } else if (kind === "result") final = data;
        else if (kind === "error") throw new Error(data.error);
      }
      if (done) break;
    }
    if (!final?.ok)
      throw new Error(
        final?.error || final?.answer || "No supported answer was completed.",
      );
    state.result = final.result;
    state.plan = final.plan;
    state.answer = final.answer || final.summary;
    state.events = final.events || state.events;
    state.elapsed = performance.now() - startTime;
    state.graphMode = "cohort";
    state.runs = (await api("/api/runs")).runs;
  } catch (error) {
    state.error = error.message;
    toast(error.message);
  } finally {
    state.busy = false;
    render();
    if (state.result) loadGraph();
  }
}
async function searchNotes() {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    state.baseline = await api("/api/search", { question: state.question });
  } finally {
    state.busy = false;
    render();
  }
}
function download(filename, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function sourceHtml(patient, barrier) {
  if (barrier.sourceKind === "coded" || barrier.code) {
    const row = patient.socialNeeds?.find(
      (s) => s.type === barrier.type || s.code === barrier.code,
    );
    return `<article class="evidence-card structured"><div class="eyebrow">HOSPITAL DATA STORE · CODED SOCIAL NEEDS</div><h3>${esc(row?.code || barrier.code || BARRIERS[barrier.type]?.zCode)} · ${label(barrier.type)}</h3><p>${esc(row?.display || barrier.quote)}</p><small>Row ${esc(row?.id || barrier.documentId)} · ${date(row?.date || barrier.date)}</small></article>`;
  }
  const note = patient.notes.find(
      (n) => n.id === barrier.documentId || n.id === barrier.noteId,
    ),
    text = note?.text || "",
    quote = barrier.quote || "",
    at = text.indexOf(quote);
  return `<article class="evidence-card clinical"><div class="eyebrow">CLINICAL NOTES · ${label(barrier.type)}</div><h3>${esc(note?.note_type || barrier.note_type)}, ${note ? relative(note) : date(barrier.date)}</h3><small>${esc(note?.authorRole || "Clinical staff")} · ${esc(barrier.documentId)} · confidence ${pct(barrier.confidence)}</small><blockquote>“${esc(quote)}”</blockquote><details><summary>Read the complete clinical note</summary><p class="source-text">${at >= 0 && quote ? esc(text.slice(0, at)) + `<mark>${esc(quote)}</mark>` + esc(text.slice(at + quote.length)) : esc(text)}</p></details></article>`;
}
async function openPatient(id, selectedType) {
  const patient = await api("/api/patients/" + encodeURIComponent(id));
  returnFocus = document.activeElement;
  state.drawer = patient;
  const type = selectedType || patient.barriers[0]?.type || "standard",
    existing = state.tasks.find(
      (t) =>
        t.patientId === id &&
        t.barrier === type &&
        ["pending", "approved", "needs_review"].includes(t.status),
    );
  let draft;
  try {
    draft = existing || makeDraft(patient, type);
  } catch {
    draft = null;
  }
  const actionable =
    (patient.barriers.length > 0 || patient.followUpGap?.open) && !state.stale;
  $("#overlay-root").innerHTML =
    `<div class="backdrop" data-cmd="close"></div><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="patient-title"><header><div><div class="eyebrow">${patient.id} · ${patient.age} YEARS · FICTIONAL PATIENT</div><h2 id="patient-title">${esc(patient.name)}</h2></div>${btn("×", "close", 'aria-label="Close patient details"', "icon-btn")}</header><div class="drawer-body"><div class="button-row">${pill(`Day ${patient.daysSinceDischarge} after discharge`, "green")}${pill(patient.followUpGap?.open ? "Open follow-up gap" : "No open follow-up gap")}${patient.likelyToReturn ? pill("Likely to return · demo rule", "amber") : ""}</div><section class="clinical-facts"><div class="eyebrow">HOSPITAL DATA STORE</div><h3>What our hospital’s tables show</h3><dl><dt>Admission</dt><dd>${esc(patient.admission.principalDiagnosis)}<small>${date(patient.admission.admitDate)} → ${date(patient.admission.dischargeDate)} · ${esc(patient.admission.unit)}</small></dd><dt>Admission labs</dt><dd>${patient.labs.map((l) => `${esc(l.name)}: <b>${esc(l.value)}${esc(l.unit)}</b>`).join("<br>")}</dd><dt>Follow-up visit</dt><dd>${patient.appointments.length ? patient.appointments.map((a) => `${esc(a.clinic)} · ${date(a.date)}<br>${pill(a.status.replaceAll("_", " "), a.status === "completed" ? "green" : "amber")}`).join("<br>") : "Nothing scheduled"}</dd><dt>Discharge medication / our pharmacy</dt><dd>${patient.medications.map((m) => `${esc(m.name)} ${m.newStart ? "· new start" : ""}<br>${pill(m.pickedUp ? "Picked up " + date(m.pickupDate) : "Not picked up", m.pickedUp ? "green" : "amber")}`).join("<br>")}</dd><dt>Follow-up gap reason</dt><dd>${esc(reasons(patient) || "No open reason under the demo rule")}</dd><dt>Coded social needs</dt><dd>${patient.socialNeeds?.length ? patient.socialNeeds.map((s) => `${esc(s.code)} · ${label(s.type)}`).join("<br>") : "No coded social need. Read the clinical notes for context."}</dd><dt>Emergency department returns</dt><dd>${patient.emergencyVisits?.length ? patient.emergencyVisits.map((v) => `${date(v.date)} · ${esc(v.reason || v.diagnosis)}`).join("<br>") : "No return visit recorded in this snapshot"}</dd></dl></section><section><div class="eyebrow">THE PATIENT’S REPORTED REASON</div><h3>Evidence our own staff recorded</h3>${btn("Open patient graph", "patient-graph", `data-id="${patient.id}"`, "secondary")}${btn("Prepare patient handoff →", "patient-handoff", `data-id="${patient.id}"`, "secondary")}${patient.barriers.map((b) => sourceHtml(patient, b)).join("") || '<div class="rule-note">No current barrier is documented. The standard discharge call asks what help is needed and reschedules the visit.</div>'}<details class="all-notes"><summary>All clinical notes (${patient.notes.length})</summary>${patient.notes.map((n) => `<article><b>${esc(n.note_type)} · ${relative(n)}</b><small>${esc(n.authorRole)} · ${n.id}</small><p>${esc(n.text)}</p></article>`).join("")}</details></section><section class="draft-section"><div class="eyebrow">TRANSITIONS-OF-CARE ACTION</div><h3>A useful next step, ready for review</h3><label for="task-barrier">Action to prepare</label><select id="task-barrier">${(patient.barriers.length ? patient.barriers.map((b) => b.type) : ["standard"]).map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${label(t)} · ${owner(t)}</option>`).join("")}</select><p>${esc(nextAction(type))}</p>${draft && actionable ? `<label for="task-title">Task title</label><input id="task-title" value="${esc(draft.title)}" ${existing?.status === "approved" ? "readonly" : ""}><label for="task-body">Discharge follow-up draft</label><textarea id="task-body" rows="9" ${existing?.status === "approved" ? "readonly" : ""}>${esc(draft.body)}</textarea><div class="button-row">${existing?.status === "approved" ? pill("Approval recorded", "green") : btn(existing ? "Save draft changes" : "Prepare demo task", "save-task", `data-type="${type}" ${existing ? `data-id="${existing.id}"` : ""}`, "primary")}</div>` : `<div class="rule-note">${state.stale ? "Rerun the saved question before preparing a task." : "This patient has no open follow-up gap under the demo rule."}</div>`}<p class="small-text">Human review required. No call, medication change, referral, or booking is performed.</p></section></div></section>`;
  document.body.style.overflow = "hidden";
  $("#task-barrier")?.addEventListener("change", (event) =>
    operation("patient", () => openPatient(id, event.target.value)),
  );
  $('[aria-label="Close patient details"]').focus();
}
function closeDrawer() {
  state.drawer = null;
  $("#overlay-root").innerHTML = "";
  document.body.style.overflow = "";
  if (returnFocus?.isConnected) returnFocus.focus();
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-cmd]");
  if (!target || target.disabled) return;
  event.preventDefault();
  const d = target.dataset;
  operation(d.cmd, async () => {
    if (d.cmd.startsWith("studio-")) {
      await studio.handleClick(d.cmd, target);
    } else if (d.cmd === "patient-handoff") {
      closeDrawer();
      state.view = "handoff";
      studio.open(d.id);
      render();
      window.scrollTo({ top: 0 });
    } else if (d.cmd === "nav") {
      if (state.view === "handoff" && d.view !== "handoff") studio.dispose();
      state.view = d.view;
      state.error = "";
      render();
      window.scrollTo({ top: 0 });
      if (state.view === "home" && !state.graph) loadGraph();
    } else if (d.cmd === "reload") location.reload();
    else if (d.cmd === "question") {
      if (state.busy) return;
      state.question = QUESTIONS[d.question];
      await runQuestion();
    } else if (d.cmd === "run-main") {
      state.view = "home";
      await runQuestion(QUESTIONS.main);
    } else if (d.cmd === "search") await searchNotes();
    else if (d.cmd === "graph-mode") {
      state.graphMode = d.mode;
      await loadGraph();
    } else if (d.cmd === "fit") graphController?.fit();
    else if (d.cmd === "graph-focus") {
      state.graphExpanded = !state.graphExpanded;
      render();
      $("#graph-canvas").scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    } else if (d.cmd === "trace-step") {
      const event = state.events.find((e) => e.step === +d.step);
      state.view = "home";
      state.graphMode = "ontology";
      await loadGraph();
      graphController?.highlight(event);
      $("#graph-canvas").scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    } else if (d.cmd === "zoom-in" || d.cmd === "zoom-out")
      graphController?.zoom(d.cmd === "zoom-in" ? 1.25 : 0.8);
    else if (d.cmd === "node") {
      state.selected = state.graph.nodes.find((n) => n.id === d.id);
      graphController?.select(d.id);
    } else if (d.cmd === "group") {
      state.filter = d.type;
      state.page = 0;
      render();
    } else if (d.cmd === "page") {
      state.page += +d.delta;
      render();
    } else if (d.cmd === "patient") await openPatient(d.id, d.barrier);
    else if (d.cmd === "close") closeDrawer();
    else if (d.cmd === "patient-graph") {
      state.patientId = d.id;
      state.graphMode = "patient";
      state.view = "home";
      closeDrawer();
      await loadGraph();
      window.scrollTo({ top: 0 });
    } else if (d.cmd === "save-task") {
      const body = {
        title: $("#task-title").value,
        body: $("#task-body").value,
      };
      if (d.id) {
        const task = state.tasks.find((t) => t.id === d.id);
        await api(
          "/api/tasks/" + d.id,
          { ...body, version: task.version },
          "PATCH",
        );
      } else
        await api("/api/tasks", {
          ...body,
          patientId: state.drawer.id,
          barrier: d.type,
        });
      await refresh();
      closeDrawer();
      state.view = "tasks";
      state.taskFilter = "pending";
      render();
      toast("Demo task saved for human review.");
    } else if (d.cmd === "task-filter") {
      state.taskFilter = d.status;
      render();
    } else if (d.cmd === "task-update") {
      const task = state.tasks.find((t) => t.id === d.id);
      await api(
        "/api/tasks/" + d.id,
        { status: d.status, version: task.version },
        "PATCH",
      );
      await refresh();
      render();
      toast("Demo review state saved. Nothing was sent.");
    } else if (d.cmd === "note-preview" || d.cmd === "note-commit") {
      if (state.busy) return;
      state.busy = true;
      render();
      try {
        const n = state.note;
        if (d.cmd === "note-preview")
          n.preview = await api("/api/extract", {
            text: n.text,
            date: n.date,
            type: n.type,
            note_type: n.type,
          });
        else {
          await api(`/api/patients/${n.patientId}/documents`, {
            text: n.text,
            date: n.date,
            type: n.type,
            note_type: n.type,
            synthetic: true,
          });
          await refresh();
          studio.invalidate();
          n.preview = null;
          state.stale = !!state.result;
          state.simulation = null;
          state.proof = null;
          state.graph = null;
          toast(
            "Clinical note saved. Barriers and affected tasks were rechecked.",
          );
        }
      } finally {
        state.busy = false;
        render();
      }
    } else if (d.cmd === "run-proof" || d.cmd === "custom-proof") {
      if (state.busy) return;
      state.busy = true;
      render();
      try {
        state.proof = await api(
          "/api/proof",
          d.cmd === "custom-proof" ? { text: state.proofText } : {},
        );
        state.evaluation = await api("/api/ml/metrics");
      } finally {
        state.busy = false;
        render();
      }
    } else if (d.cmd === "simulate") {
      if (state.busy) return;
      state.busy = true;
      render();
      try {
        state.simulation = await api("/api/simulate", {
          budget: state.budget,
          contactCapacity: state.capacity,
          barriers: Object.keys(BARRIERS),
        });
      } finally {
        state.busy = false;
        render();
      }
    } else if (d.cmd === "strategy") {
      state.strategy = d.strategy;
      render();
    } else if (d.cmd === "replay") {
      const run = await api("/api/runs/" + d.id);
      state.result = run.result;
      state.plan = run.plan;
      state.events = run.events || [];
      state.question = run.question;
      state.answer = run.answer || run.summary || "";
      state.stale = true;
      state.elapsed = null;
      state.view = "cohort";
      state.filter = "all";
      state.page = 0;
      render();
    } else if (d.cmd === "export-answer")
      download("hospital-answer.json", {
        question: state.question,
        plan: state.plan,
        result: state.result,
        events: state.events,
        synthetic: true,
        snapshot: AS_OF,
      });
    else if (d.cmd === "export-proof")
      download("hospital-proof.json", state.proof);
    else if (d.cmd === "export-tasks")
      download("hospital-demo-tasks.json", {
        synthetic: true,
        tasks: state.tasks,
      });
  });
});
document.addEventListener("change", (event) => {
  if (state.view === "handoff") studio.handleChange(event);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.drawer) closeDrawer();
  if (event.key === "Tab" && state.drawer) {
    const items = [
        ...document.querySelectorAll(
          ".drawer button:not([disabled]),.drawer select,.drawer input,.drawer textarea,.drawer summary",
        ),
      ],
      first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
start();
