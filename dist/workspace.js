import { createWorkspaceGraph } from "./workspace-graph.js";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (n) => Number(n || 0).toLocaleString("en-US");
const date = (v) =>
  v
    ? new Date(String(v).slice(0, 10) + "T12:00:00Z").toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
      )
    : "Not recorded";
const noteTime = (v) =>
  v
    ? `${date(v)}${String(v).includes("T") ? " · " + String(v).slice(11, 16) : ""}`
    : "Not recorded";
const percent = (n) => `${Math.round(Number(n || 0) * 100)}%`;
const BARRIERS = {
  transportation: {
    label: "Transportation",
    short: "Arrange a ride",
    color: "lilac",
  },
  cost: {
    label: "Medication cost",
    short: "Help with medication cost",
    color: "sand",
  },
  food: {
    label: "Food insecurity",
    short: "Connect to food support",
    color: "mint",
  },
  health_literacy: {
    label: "Health literacy",
    short: "Make instructions clearer",
    color: "blue",
  },
};
const STARTERS = [
  "Who has an open follow-up gap and a barrier we can act on?",
  "Who could not afford their new insulin?",
  "Which hospital unit has the most unaddressed barriers?",
];
const state = {
  view: "overview",
  status: null,
  overview: null,
  patient: null,
  graph: null,
  result: null,
  events: [],
  tasks: [],
  runs: [],
  agent: null,
  loading: true,
  busy: false,
  error: "",
  question: "",
  previousFilters: null,
  beat: 1,
  expanded: false,
  group: "all",
  queue: "draft",
  trace: false,
  nav: false,
  source: null,
  dialog: null,
  lastQuestion: "",
  controller: null,
  selectedNode: null,
  runId: null,
  asOf: null,
};
let graphCanvas;
let dialogReturnFocus;
let audioUrl;
let audioController;
let briefController;
function clearAudio() {
  briefController?.abort();
  briefController = null;
  audioController?.abort();
  audioController = null;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
}
const primary = (p) => p?.primary_barrier || p?.primaryBarrier;
const barriers = (p) =>
  (p?.barriers || []).filter(
    (b) => !b.resolved && (!b.status || b.status === "active"),
  );
const label = (t) => BARRIERS[t]?.label || "Standard discharge call";
const spec = (t) =>
  state.overview?.groups?.find((g) => g.type === t) || {
    label: label(t),
    owner: "Care transitions nurse",
    action: "Review the discharge plan and arrange the missed follow-up visit.",
  };
const initial = (name) =>
  String(name || "")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
const btn = (text, action, attrs = "", className = "") =>
  `<button class="w-button ${className}" data-action="${action}" ${attrs}>${text}</button>`;
const api = async (path, { method = "GET", body, signal } = {}) => {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server did not return a readable response. Please retry.",
    );
  }
  if (!response.ok)
    throw new Error(
      data.error?.message ||
        data.message ||
        `The request could not finish (${response.status}).`,
    );
  return data;
};
function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 4000);
}
async function load() {
  state.loading = true;
  state.error = "";
  render();
  try {
    const status = await api("/status");
    state.status = status;
    const [overview, tasks, runs] = await Promise.all([
      api("/overview"),
      api("/tasks"),
      api("/runs"),
    ]);
    state.overview = overview;
    state.tasks = tasks.tasks || [];
    state.runs = runs.runs || [];
    if (overview.featuredId) {
      const detail = await api(
        "/patients/" + encodeURIComponent(overview.featuredId),
      );
      state.patient = detail.patient;
      state.graph = detail.graph;
    }
    state.loading = false;
    render();
  } catch (error) {
    state.error = error.message;
    state.loading = false;
    render();
  }
}
function modeBadge() {
  const text =
    state.result?.mode === "openai"
      ? "OpenAI agent"
      : state.result?.mode === "rules"
        ? "Rules engine"
        : state.status?.aiConfigured
          ? "AI configured · not yet verified"
          : "Rules engine · AI not connected";
  return `<span class="connection-badge ${state.result?.mode === "openai" ? "ai" : ""}"><i></i>${text}</span>`;
}
function render() {
  graphCanvas?.destroy();
  const taskCount = state.tasks.filter((t) => t.status === "draft").length;
  $("#app").innerHTML =
    `<div class="care-workspace"><aside class="w-sidebar ${state.nav ? "open" : ""}"><a href="/" class="w-brand"><span>✳</span><div>careweave<small>CONNECTED CARE. CLEAR NEXT STEPS.</small></div></a><div class="w-hospital"><span class="hospital-monogram">N</span><div>Northstar Hospital System<small>Care transitions workspace</small></div></div><nav aria-label="Workspace"><span class="nav-caption">YOUR WORKSPACE</span>${[
      ["overview", "◫", "Overview"],
      ["investigation", "⌕", "Investigation"],
      ["queue", "☷", "Review queue"],
      ["agent", "⌘", "How it works"],
    ]
      .map(
        ([id, icon, title]) =>
          `<button data-action="view" data-view="${id}" class="${state.view === id ? "selected" : ""}" ${state.view === id ? 'aria-current="page"' : ""}><i>${icon}</i>${title}${id === "queue" && taskCount ? `<b>${taskCount}</b>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><a href="/story.html" class="guided-link"><span>▷</span><div>Take the guided story<small>Follow one patient, then every discharge.</small></div><i>↗</i></a><div class="sidebar-bottom"><span class="connected-dot"></span> Connected to the hospital graph<small>${state.overview ? `${num(state.overview.totals?.nodes)} facts · ${num(state.overview.totals?.edges)} connections` : "Opening the care workspace…"}</small><button data-action="about">About this prototype ↗</button></div></aside><div class="w-main"><header class="w-topbar">${btn("☰", "menu", 'aria-label="Open workspace navigation"', "menu-toggle")}<div class="w-breadcrumb">Care transitions <span>/</span> <strong>${{ overview: "Overview", investigation: "Investigation", queue: "Review queue", agent: "How it works" }[state.view]}</strong></div><div class="topbar-right"><span class="demo-date">${date(state.status?.asOf || state.overview?.asOf)}</span><button class="synthetic-chip" data-action="about"><i></i>Prototype · synthetic patients</button><span class="profile-mark">NS</span></div></header><main class="w-content">${state.loading ? loadingView() : state.error && !state.overview ? errorView() : state.view === "overview" ? overviewView() : state.view === "investigation" ? investigationView() : state.view === "queue" ? queueView() : agentView()}</main><footer class="w-footer"><span>Every conclusion has a source. Every action has a human.</span><span>Nothing is sent, booked or ordered from this prototype.</span></footer></div></div>`;
  mountGraph();
  if (state.trace) renderTrace();
}
function loadingView() {
  return `<div class="workspace-loading"><div class="loading-mark">✳</div><h1>Connecting the care story.</h1><p>Opening hospital facts, clinical notes, and your review queue.</p></div>`;
}
function errorView() {
  return `<div class="workspace-error"><span>↻</span><h1>The workspace could not connect.</h1><p>${esc(state.error)}</p>${btn("Try again", "reload", "", "primary")}<a href="/story.html">Open the guided story →</a></div>`;
}
function composer(compact = false) {
  return `<form class="question-composer ${compact ? "compact" : ""}" data-question-form><label for="care-question"><span>✳</span>${state.previousFilters && state.view === "investigation" ? "Keep following the evidence" : "Ask a care-team question"}</label>${state.previousFilters && state.view === "investigation" ? `<div class="context-chip">Following this investigation ${btn("×", "clear-context", 'aria-label="Start a new investigation"', "icon-button")}</div>` : ""}<div class="composer-field"><textarea id="care-question" rows="${compact ? 2 : 2}" placeholder="${state.previousFilters ? "Now show only those still inside 30 days…" : "Who missed follow-up, and what is in their way?"}" ${state.busy ? "disabled" : ""}>${esc(state.question)}</textarea><button type="submit" class="ask-button" ${state.busy ? "disabled" : ""} aria-label="Investigate this question">↗</button></div><div class="composer-foot">${modeBadge()}<span>Answers use the hospital graph</span></div></form>`;
}
function overviewView() {
  const o = state.overview;
  return `<section class="overview-intro"><div><div class="w-eyebrow"><i></i> THE FIRST 30 DAYS HOME</div><h1>We discharged them.<br>Let’s get them <em>back on track.</em></h1><p>Connect missed visits and medication pickup with the reasons in the chart. Give the care team a clear next step.</p></div>${composer()}</section><section class="overview-stats" aria-label="Care transition overview">${[
    [o.discharges, "adult discharges", "Last 90 days"],
    [o.diabetes, "diabetes-related stays", "A focused care pathway"],
    [o.gaps, "open follow-up gaps", "An important next step missed"],
    [
      o.barrier,
      "people we can match to help",
      `${o.within30} still inside the 30-day window`,
    ],
  ]
    .map(
      ([value, title, sub], i) =>
        `<div class="${i === 3 ? "stat-emphasis" : ""}"><strong>${num(value)}</strong><span>${title}</span><small>${sub}</small></div>`,
    )
    .join(
      "",
    )}</section><div class="case-section-heading"><div><span class="w-eyebrow">START WITH ONE PERSON</span><h2>Three records. One reason to act.</h2></div><a href="/story.html">See the guided story <span>↗</span></a></div><div class="care-case-layout">${graphPanel()}${patientPanel()}</div><div class="question-suggestions-section"><span>THEN ASK ACROSS EVERY DISCHARGE</span><div>${STARTERS.map((q) => `<button data-action="starter" data-question="${esc(q)}">${esc(q)}<i>↗</i></button>`).join("")}</div></div>`;
}
function graphPanel() {
  const p = state.patient;
  return `<section class="evidence-graph-panel"><header><div><span class="graph-header-dot"></span><strong>${esc(p?.name || "Connected patient story")}</strong><small>${esc(p?.id || "")} · Connected evidence</small></div>${btn(state.expanded ? "Focus the story" : "All records", "expand", "", "quiet")}</header><div class="care-story-beats" role="group" aria-label="Explore the patient story">${[
    ["Find the gap", "0"],
    ["Reveal the reason", "1"],
    ["Prepare the next step", "2"],
  ]
    .map(
      ([text, value]) =>
        `<button data-action="beat" data-beat="${value}" class="${state.beat === Number(value) ? "active" : ""}"><span>${Number(value) + 1}</span>${text}</button>`,
    )
    .join(
      "",
    )}</div><div class="record-date-control"><span>${state.asOf ? "Record as of " + date(state.asOf) : "The record today"}</span><div><button data-action="record-date" data-date="today" class="${!state.asOf ? "selected" : ""}">Today</button><button data-action="record-date" data-date="discharge" class="${state.asOf ? "selected" : ""}">At discharge</button></div></div><div id="workspace-graph" class="workspace-graph"></div><footer><span><i class="record-dot"></i> Hospital record</span><span><i class="note-dot"></i> Clinical note</span><span><i class="action-dot"></i> Next step</span><span class="graph-help">Select a fact to open its evidence ↗</span></footer></section>`;
}
function patientPanel() {
  const p = state.patient;
  if (!p)
    return `<section class="patient-story-panel"><h2>Select a patient.</h2><p>Their connected care story will appear here.</p></section>`;
  const type = primary(p),
    barrier = barriers(p).find((b) => b.type === type) || barriers(p)[0],
    sources = barrier?.evidence_sources || [],
    bedside = sources.find((b) => /bedside/i.test(b.note_type)) || barrier,
    note = p.notes?.find(
      (n) => n.id === (bedside?.note_id || bedside?.sourceId),
    ),
    quote = bedside?.evidence_sentence || bedside?.quote || "",
    metadata = spec(type),
    days = p.daysSinceDischarge;
  const completedVisit = p.appointments?.find((a) => a.status === "completed"),
    hasGap = Boolean(p.followUpGap?.open);
  const appointment = p.appointments?.find((a) =>
      ["no_show", "no-show"].includes(a.status),
    ),
    medicine = p.medications?.find((m) => m.newStart && !m.pickedUp);
  return `<section class="patient-story-panel"><div class="patient-summary"><span class="patient-avatar">${esc(initial(p.name))}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.id)} · Age ${p.age} · ${esc(p.admission?.unit || p.unit)}</small></div><span class="window-badge">Day ${days} of 30</span></div><span class="w-eyebrow">${["WHAT HAPPENED", "WHAT WAS IN THE WAY", "THE NEXT USEFUL STEP"][state.beat]}</span><h2>${state.beat === 0 ? (hasGap ? "The plan did not make it all the way home." : "The discharge plan, connected.") : state.beat === 1 ? (type === "transportation" ? "A missed visit can start with a missing ride." : type === "cost" ? "The prescription was ready. The money was not." : type === "food" ? "Safe care starts with enough to eat." : type === "health_literacy" ? "The instructions were not clear enough." : "The chart needs a closer look.") : BARRIERS[type]?.short || "Start with the discharge call."}</h2>${state.beat === 0 ? `<div class="missed-facts"><div><span>↗</span><p><strong>${appointment ? "Follow-up visit missed" : completedVisit ? "Follow-up completed" : hasGap ? "Follow-up remains open" : "See the follow-up record"}</strong><small>${esc(appointment?.clinic || completedVisit?.clinic || "Care transitions follow-up")}${appointment ? " · " + date(appointment.date) : ""}</small></p></div><div><span>Rx</span><p><strong>${medicine ? esc(medicine.name) + " not collected" : "Review medication pickup"}</strong><small>Check what happened after the discharge prescription.</small></p></div></div>` : quote ? `<button class="evidence-snippet" data-action="source" data-id="${esc(bedside?.sourceId || bedside?.note_id)}"><span>≋ ${esc(note?.note_type || bedside?.note_type || "Clinical note")}</span><blockquote>“${esc(quote)}”</blockquote><small>${esc(note?.author_role || bedside?.authorRole || "Care team")} · ${date(note?.written_datetime || bedside?.date)} <b>↗</b></small></button>` : '<p class="no-barrier-note">No current barrier is documented. The standard discharge call is the next step.</p>'}<div class="matched-action"><span>MATCHED TO ${esc(metadata.owner).toUpperCase()}</span><p>${esc(metadata.action)}</p></div><div class="patient-actions">${type ? btn("Prepare care-team task", "prepare-task", `data-id="${esc(p.id)}" data-barrier="${esc(type)}" ${state.asOf ? 'disabled title="Return to today before preparing a task"' : ""}`, "primary") : btn("Open discharge record", "source", `data-id="${esc(p.admission?.id)}"`, "primary")}${type ? btn("What if we resolve this?", "what-if", `data-id="${esc(p.id)}" data-barrier="${esc(type)}" ${state.asOf ? 'disabled title="Return to today before simulating a change"' : ""}`, "quiet") : ""}</div>${state.status?.geminiConfigured && (type || hasGap) ? `<section class="gemini-entry"><h3>Connect the next steps</h3><p>Gemini can order a care-team brief using this patient’s linked evidence.</p>${btn("Prepare Gemini care brief", "gemini-brief", `data-id="${esc(p.id)}" ${state.asOf ? "disabled" : ""}`, "secondary")}</section>` : ""}<p class="human-note"><span>✓</span> ${state.asOf ? "Historical view. Return to today to prepare a next step." : "A person reviews every next step."}</p></section>`;
}
function investigationView() {
  const r = state.result?.ok ? state.result.result : null;
  return `<div class="investigation-heading"><div><span class="w-eyebrow">FOLLOW THE EVIDENCE</span><h1>${state.busy ? "Connecting the care story…" : r ? "A clear answer. A next step for each person." : "Start with a question worth following."}</h1><p>${state.lastQuestion ? esc(state.lastQuestion) : "Ask across the hospital records, then open any patient’s evidence."}</p></div>${state.result ? btn("Export evidence", "export", "", "secondary") : ""}</div><div class="investigation-composer-row">${composer(true)}<div class="investigation-status">${state.busy ? `<div class="working-state"><span class="activity-ring"></span><strong>${esc(state.events.at(-1)?.label || "Reading the question")}</strong><small>${state.events.length} completed tools</small>${btn("Stop", "cancel", "", "quiet")}</div>` : `<div>${modeBadge()}<p>${state.result?.mode === "openai" ? "An OpenAI agent chose tools. The graph computed the result." : "Structured rules select the route. The graph computes the result."}</p>${btn(state.events.length ? `Inspect ${state.events.length} tool calls` : "Inspect the system", "trace", "", "quiet")}</div>`}</div></div>${state.error ? `<div class="inline-error" role="alert"><strong>The investigation could not finish.</strong><p>${esc(state.error)}</p>${btn("Retry the question", "retry", "", "secondary")}${state.status?.aiConfigured ? btn("Use rules for this question", "retry-rules", "", "quiet") : ""}</div>` : ""}${r ? `<div class="answer-summary"><div class="answer-count"><strong>${num(r.count)}</strong><span>patients match</span></div><div><span class="w-eyebrow">ANSWER FROM THE CONNECTED RECORD</span><p>${esc(state.result.answer || "These patients match the question. Open a patient to review their evidence.")}</p>${r.assumptions?.length ? `<small>${esc(r.assumptions.join(" "))}</small>` : ""}</div></div>${state.result.simulation ? simulationSummary(state.result.simulation) : ""}${groupCards(r)}<div class="result-toolbar"><div><h2>The people behind the count</h2><span>${state.group === "all" ? r.patients.length : r.patients.filter((p) => primary(p) === state.group).length} shown${r.count > r.patients.length ? ` of ${num(r.count)} matches` : ""}</span></div><div>${btn("All patients", "filter", 'data-group="all"', state.group === "all" ? "active-filter" : "quiet")}${btn("Inspect tool calls", "trace", "", "quiet")}</div></div><div class="cohort-and-case"><section class="cohort-panel">${patientList(r.patients.filter((p) => state.group === "all" || primary(p) === state.group))}</section><div class="selected-care-story">${graphPanel()}${patientPanel()}</div></div>` : state.busy ? `<div class="running-evidence"><div class="subtle-spinner"></div><h2>Every completed step appears below.</h2><div>${state.events.map((e) => `<p><span>✓</span>${esc(e.label || e.tool)}<small>${Number(e.durationMs || 0).toFixed(1)} ms</small></p>`).join("")}</div></div>` : `<div class="start-investigation"><span>✳</span><h2>Ask in your own words.</h2><p>Try one of these starting points, or ask about a unit, barrier, date window, or missed next step.</p><div>${STARTERS.map((q) => `<button data-action="starter" data-question="${esc(q)}">${esc(q)} ↗</button>`).join("")}</div></div>`}`;
}
function groupCards(r) {
  const groups = (r.groups || []).filter((g) => g.count);
  return `<div class="result-groups">${groups.map((g) => `<button data-action="filter" data-group="${esc(g.type)}" class="${BARRIERS[g.type]?.color || "mint"} ${state.group === g.type ? "selected" : ""}"><div><span>${esc(g.label)}</span><strong>${g.count}</strong></div><small>${esc(g.owner)}</small><p>${esc(g.action)}</p></button>`).join("")}${r.units?.length ? `<div class="unit-breakdown"><strong>By hospital unit</strong>${r.units.map((u) => `<span>${esc(u.unit)}<b>${u.count}</b></span>`).join("")}</div>` : ""}</div>`;
}
function patientList(patients) {
  if (!patients.length)
    return '<div class="empty-panel"><h3>No patients in this group.</h3><p>Choose all patients or ask a different question.</p></div>';
  return `<div class="patient-list-header"><span>Patient / documented reason</span><span>Window</span></div>${patients.map((p) => `<button class="cohort-person ${state.patient?.id === p.id ? "selected" : ""}" data-action="patient" data-id="${esc(p.id)}"><span class="small-avatar">${esc(initial(p.name))}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.id)} · Age ${p.age}</small><span class="person-barrier">${esc(label(primary(p)))}</span></div><span class="remaining-time ${p.daysRemaining <= 5 ? "urgent" : ""}">${p.daysRemaining > 0 ? `${p.daysRemaining}<small>days left</small>` : "<small>Past<br>day 30</small>"}</span><i>›</i></button>`).join("")}`;
}
function queueView() {
  const rows = state.tasks.filter((t) => t.status === state.queue);
  return `<div class="page-intro"><span class="w-eyebrow">THE NEXT CALL, WITH CONTEXT</span><h1>Ready for a person to review.</h1><p>Evidence, a clear owner, and a draft next step. This queue is saved for your browser session.</p></div><div class="queue-summary">${[
    ["draft", "To review"],
    ["approved", "Approved"],
    ["completed", "Completed"],
  ]
    .map(
      ([key, name]) =>
        `<button data-action="queue-filter" data-status="${key}" class="${state.queue === key ? "selected" : ""}"><strong>${state.tasks.filter((t) => t.status === key).length}</strong><span>${name}</span></button>`,
    )
    .join(
      "",
    )}</div><section class="task-list">${rows.length ? rows.map((t) => `<button class="task-row" data-action="task" data-id="${esc(t.id)}"><span class="task-icon">${t.status === "completed" ? "✓" : "☷"}</span><div><span class="task-status">${esc({ draft: "REVIEW NEEDED", approved: "APPROVED FOR THE DEMO", completed: "COMPLETED IN THE DEMO" }[t.status])}</span><h3>${esc(t.title || spec(t.barrier).action)}</h3><p>${esc(t.patientId)} · ${esc(t.owner)} · ${label(t.barrier)}</p></div><span>${date(t.createdAt)}</span><i>↗</i></button>`).join("") : `<div class="queue-empty"><span>✓</span><h2>${state.queue === "draft" ? "Every useful next step starts with evidence." : "Nothing here yet."}</h2><p>Open a patient and prepare a care-team task. The draft arrives here with its source attached.</p>${btn("Find patients who need help", "starter", `data-question="${esc(STARTERS[0])}"`, "primary")}</div>`}</section><div class="queue-footnote"><span>◈</span> This is a demonstration workflow. Approving a task does not contact a patient or create a hospital order.</div>`;
}
function agentView() {
  return `<div class="page-intro"><span class="w-eyebrow">OPEN THE ENGINE</span><h1>Trust the evidence. Inspect the work.</h1><p>The agent chooses tools. The backend computes the answer and verifies the sources behind it.</p></div><div class="system-status-card">${modeBadge()}<div><h2>${state.status?.aiConfigured ? "The OpenAI connection is configured." : "Ready for your OpenAI API key."}</h2><p>${state.status?.aiConfigured ? "Run a question to verify a complete model-and-tools exchange. The actual mode appears on each result." : "The backend, graph tools, review queue, and rules mode are working. Add OPENAI_API_KEY to your local .env, then restart the local server to enable the generative agent. The published app has its own server secret setting."}</p></div></div><div class="how-grid"><section><span>01</span><h3>Ask freely</h3><p>Questions and follow-ups become validated filters or tool calls. Unclear requests are surfaced instead of silently matched to a prepared question.</p></section><section><span>02</span><h3>Compute, then explain</h3><p>The graph returns an exact count for the data it contains. Each patient retains the row or note behind the answer.</p></section><section><span>03</span><h3>Review before acting</h3><p>Draft tasks keep their evidence. A human approves the next step, and the queue preserves the review status.</p></section></div><section class="prompt-panel"><header><div><h2>The actual agent instructions</h2><p>System instructions and tool schemas used by the backend. This is not hidden model reasoning.</p></div>${btn("Load instructions", "load-agent", "", "secondary")}</header>${state.agent ? `<div class="prompt-version">${esc(state.agent.version || state.agent.promptVersion)}</div><pre>${esc(state.agent.prompt || state.agent.systemPrompt || "")}</pre><h3>Available tools</h3>${(state.agent.tools || []).map((t) => `<details><summary>${esc(t.name || t.function?.name || t.type)}</summary><pre>${esc(JSON.stringify(t, null, 2))}</pre></details>`).join("")}` : '<div class="unloaded-prompt">Load the server’s current instructions to inspect the implementation.</div>'}</section><section class="recent-runs"><h2>Recent investigations</h2>${
    state.runs.length
      ? state.runs
          .slice(0, 10)
          .map(
            (r) =>
              `<button data-action="run" data-id="${esc(r.id)}"><span>${esc(r.question)}</span><small>${r.ok === false ? "Incomplete investigation" : num(r.count) + " patients"} · ${esc(r.mode === "openai" ? "OpenAI agent" : "Rules engine")}</small>↗</button>`,
          )
          .join("")
      : "<p>Your investigations will appear here.</p>"
  }</section>`;
}
function mountGraph() {
  const host = $("#workspace-graph");
  if (!host) return;
  const types = [
      ["Patient", "Appointment", "Medication", "FollowUpGap"],
      ["Patient", "ClinicalNote", "Barrier"],
      ["Barrier", "Action"],
    ][state.beat],
    focusIds = (state.graph?.nodes || [])
      .filter((n) => types.includes(n.type))
      .map((n) => n.id);
  graphCanvas = createWorkspaceGraph(host, state.graph, {
    expanded: state.expanded,
    focusIds,
    selectedId: state.selectedNode,
    onSelect: openNode,
  });
}
async function openNode(node) {
  state.selectedNode = node.id;
  const source = node.source;
  if (
    source?.key &&
    !["barrier_catalog", "action_catalog"].includes(source.table)
  ) {
    await openSource(source.key, node);
  } else
    showDialog(
      node.label || "Graph fact",
      `<div class="source-tag">${esc(node.type)}</div>${recordHTML(node.properties || source?.row || {})}`,
    );
}
function showDialog(title, body, wide = false) {
  clearAudio();
  if (!state.dialog) dialogReturnFocus = document.activeElement;
  state.dialog = { title };
  $("#overlay-root").innerHTML =
    `<div class="w-backdrop"><section class="w-dialog ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><div><span class="w-eyebrow">CAREWEAVE / CONNECTED EVIDENCE</span><h2>${esc(title)}</h2></div>${btn("×", "close", 'aria-label="Close dialog"', "close-button")}</header><div class="w-dialog-body">${body}</div></section></div>`;
  $("#overlay-root .close-button")?.focus();
}
function closeDialog() {
  clearAudio();
  state.dialog = null;
  state.trace = false;
  $("#overlay-root").innerHTML = "";
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
  dialogReturnFocus = null;
}
function recordHTML(row) {
  return `<dl class="record-detail">${Object.entries(row)
    .filter(
      ([key, value]) =>
        value !== null &&
        value !== undefined &&
        !["text", "evidence_sources", "barriers", "notes"].includes(key),
    )
    .map(
      ([key, value]) =>
        `<div><dt>${esc(key.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt><dd>${esc(typeof value === "object" ? JSON.stringify(value) : String(value))}</dd></div>`,
    )
    .join("")}</dl>`;
}
async function openSource(id, node) {
  if (!id) return;
  showDialog(
    "Opening the source…",
    '<div class="dialog-loading">Reading the original record.</div>',
  );
  try {
    const s = await api("/sources/" + encodeURIComponent(id));
    const row = s.row || s;
    state.source = s;
    const quote =
      state.result?.citations?.find((c) => c.sourceId === id)?.quote ||
      s.assertions?.find((a) => a.status === "active")?.evidence_sentence;
    showDialog(
      row.note_type || node?.label || "Hospital record",
      `<div class="source-heading"><span class="source-tag">${esc(s.table || "Clinical note")}</span><strong>${esc(s.id || id)}</strong>${s.patientId ? `<span>${esc(s.patientId)}</span>` : ""}</div>${s.text || row.text ? `<div class="source-note-meta">${esc(row.author_role || row.authorRole || "Care team")} ${esc(row.author_initials || "")}<span>${esc(row.unit || "")} · ${noteTime(row.written_datetime || row.date)}</span></div>${quote ? `<div class="source-evidence"><small>THE SENTENCE BEHIND THE CONNECTION</small><blockquote>“${esc(quote)}”</blockquote></div>` : ""}<p class="source-full-note">${esc(s.text || row.text)}</p>` : recordHTML(row)}<details class="raw-record"><summary>Inspect the original record</summary><pre>${esc(JSON.stringify(s, null, 2))}</pre></details>`,
      true,
    );
  } catch (error) {
    showDialog(
      "The source could not open",
      `<p>${esc(error.message)}</p>${btn("Try again", "source", `data-id="${esc(id)}"`, "primary")}`,
    );
  }
}
async function selectPatient(id, asOf = null) {
  try {
    const detail = await api(
      "/patients/" +
        encodeURIComponent(id) +
        (asOf ? "?asOf=" + encodeURIComponent(asOf) : ""),
    );
    state.patient = detail.patient;
    state.graph = detail.graph;
    state.asOf = asOf;
    state.selectedNode = null;
    render();
  } catch (error) {
    toast(error.message);
  }
}
async function investigate(question, mode = "auto") {
  if (state.busy) return;
  if (!question.trim()) {
    toast("Enter a question to start the investigation.");
    return;
  }
  if (state.view === "overview") state.previousFilters = null;
  state.asOf = null;
  state.busy = true;
  state.error = "";
  state.events = [];
  state.lastQuestion = question;
  state.question = "";
  state.view = "investigation";
  state.result = null;
  state.group = "all";
  state.controller = new AbortController();
  render();
  let timer = setTimeout(() => state.controller?.abort("timeout"), 120000);
  try {
    const response = await fetch("/api/v1/investigate", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        question,
        previousFilters: state.previousFilters || undefined,
        mode,
      }),
      signal: state.controller.signal,
    });
    if (!response.ok) {
      let data = await response.json().catch(() => ({}));
      throw new Error(
        data.error?.message ||
          `The investigation could not start (${response.status}).`,
      );
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      finalResult = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop();
      for (const chunk of chunks) {
        const lines = chunk.split(/\r?\n/),
          name =
            lines
              .find((l) => l.startsWith("event:"))
              ?.slice(6)
              .trim() || "message",
          body = lines
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
        if (!body) continue;
        const data = JSON.parse(body);
        if (name === "step") {
          state.events.push(data);
          render();
        } else if (name === "result") {
          finalResult = data;
        } else if (name === "error") {
          throw new Error(
            data.error?.message ||
              data.message ||
              "The agent stopped before returning an answer.",
          );
        }
      }
    }
    if (!finalResult)
      throw new Error(
        "The connection ended before an answer arrived. Please retry.",
      );
    state.result = finalResult;
    state.events = finalResult.events || state.events;
    state.previousFilters =
      finalResult.filters || finalResult.result?.filters || null;
    state.runId = finalResult.runId;
    const id = finalResult.patientId || finalResult.result?.patients?.[0]?.id;
    if (id) {
      const detail = await api("/patients/" + encodeURIComponent(id));
      state.patient = detail.patient;
      // The patient workspace always shows the recorded facts. Temporary
      // simulation outcomes have their own clearly labeled comparison panel.
      state.graph = detail.graph;
    }
    state.runs = (await api("/runs")).runs || [];
    if (!finalResult.ok || finalResult.error)
      state.error =
        finalResult.answer ||
        finalResult.error?.message ||
        "The model could not complete this investigation. You can retry with the rules engine.";
  } catch (error) {
    state.error =
      error.name === "AbortError"
        ? "The investigation stopped. You can retry the same question."
        : error.message;
  } finally {
    clearTimeout(timer);
    state.busy = false;
    state.controller = null;
    render();
  }
}
async function prepareTask(patientId, barrier) {
  if (barrier === "standard") {
    toast("Open a documented barrier to prepare a matched care-team task.");
    return;
  }
  try {
    const data = await api("/tasks", {
      method: "POST",
      body: { patientId, barrier },
    });
    state.tasks = (await api("/tasks")).tasks || [];
    render();
    showTask(data.task);
    toast(
      data.created
        ? "Draft prepared with its evidence."
        : "This draft is already in your review queue.",
    );
  } catch (error) {
    toast(error.message);
  }
}
function showTask(task) {
  const evidence = Array.isArray(task.evidence)
    ? task.evidence
    : task.evidence
      ? [task.evidence]
      : [];
  showDialog(
    task.title || "Review care-team task",
    `<div class="task-review-meta"><span class="source-tag">${esc(task.status)}</span><strong>${esc(task.patientId)}</strong><span>${esc(task.owner)}</span></div><p class="task-draft-body">${esc(task.body)}</p><h3>Evidence attached to this draft</h3>${evidence.map((e) => `<button class="task-evidence" data-action="source" data-id="${esc(e.sourceId || e.note_id || e.id)}"><blockquote>“${esc(e.quote || e.evidence_sentence || e.text || JSON.stringify(e))}”</blockquote><small>${esc(e.noteType || e.note_type || e.sourceKind || "Source record")} · ${esc(e.sourceId || e.note_id || e.id)} ↗</small></button>`).join("")}<div class="review-notice"><span>◈</span><p>Review the evidence and wording before approving. This task stays in the demonstration; no patient is contacted.</p></div><div class="review-actions">${task.status === "draft" ? btn("Approve this draft", "task-status", `data-id="${esc(task.id)}" data-status="approved"`, "primary") : task.status === "approved" ? btn("Mark completed in demo", "task-status", `data-id="${esc(task.id)}" data-status="completed"`, "primary") : '<span class="completed-label">✓ Completed in this demonstration</span>'}${task.status !== "draft" ? btn("Return to draft", "task-status", `data-id="${esc(task.id)}" data-status="draft"`, "secondary") : btn("Keep as draft", "close", "", "secondary")}</div>`,
    true,
  );
  if (task.status !== "draft") {
    $(".w-dialog-body").insertAdjacentHTML(
      "beforeend",
      `<section class="task-audio-entry"><h3>A reviewed next step, read aloud</h3><p>Preview the exact care-team text, then generate audio. Nothing is sent to a patient.</p>${state.status?.audioConfigured ? btn("Listen to this approved brief", "audio-preview", `data-id="${esc(task.id)}"`, "secondary") : "<p>ElevenLabs is not configured on this server.</p>"}</section>`,
    );
  }
}
async function geminiBrief(id) {
  showDialog(
    "Preparing the connected care brief",
    '<p role="status">Gemini is ordering the documented next steps. The backend will check every action and source.</p>',
  );
  const controller = new AbortController();
  briefController = controller;
  try {
    const response = await fetch(
      "/api/v1/patients/" + encodeURIComponent(id) + "/care-brief",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      },
    );
    const brief = await response.json();
    if (!response.ok)
      throw new Error(
        brief.error?.message || "The care brief could not finish.",
      );
    if (controller.signal.aborted) return;
    showDialog(
      "Connected care brief for " + brief.patientName,
      `<span class="source-tag">GEMINI · ${esc(brief.model)} · REVIEW REQUIRED</span><p>${esc(brief.explanation)}</p><p>Fictional patient ${esc(brief.patientId)} · Record as of ${date(brief.asOf)}</p><ol class="gemini-steps">${brief.steps.map((step) => `<li><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p><small>Suggested care-team role: ${esc(step.owner)}</small><button class="task-evidence" data-action="source" data-id="${esc(step.sourceId)}"><blockquote>“${esc(step.quote)}”</blockquote><small>Open source ${esc(step.sourceId)} ↗</small></button>${step.barrier ? btn("Prepare this care-team task", "prepare-task", `data-id="${esc(id)}" data-barrier="${esc(step.barrier)}"`, "secondary") : ""}</li>`).join("")}</ol><details><summary>Inspect the Gemini instructions</summary><pre>${esc(brief.prompt)}</pre></details><p>A person reviews each task before approval. This brief does not create tasks, contact anyone, or arrange services.</p>`,
      true,
    );
  } catch (error) {
    if (!controller.signal.aborted)
      showDialog(
        "The Gemini brief could not finish",
        `<p>${esc(error.message)}</p><p>The original graph and task queue are unchanged.</p>`,
      );
  } finally {
    if (briefController === controller) briefController = null;
  }
}
async function previewTaskAudio(id) {
  try {
    const brief = await api("/tasks/" + encodeURIComponent(id) + "/brief");
    showDialog(
      "Listen to the reviewed care-team brief",
      `<p>This is synthetic speech from ElevenLabs. It reads the approved task; it does not contact anyone or confirm a booking.</p><h3>Exact text to be read</h3><p class="audio-transcript">${esc(brief.text)}</p>${btn("Generate audio with ElevenLabs", "audio-generate", `data-id="${esc(id)}"`, "primary")}<div id="task-audio-result" role="status" aria-live="polite"></div>`,
      true,
    );
  } catch (error) {
    toast(error.message);
  }
}
async function playTaskAudio(id, button) {
  button.disabled = true;
  const output = $("#task-audio-result");
  output.textContent = "Generating the reviewed text with ElevenLabs…";
  const controller = new AbortController();
  audioController = controller;
  try {
    const response = await fetch(
      "/api/v1/tasks/" + encodeURIComponent(id) + "/audio",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || "Audio could not be generated.");
    }
    const blob = await response.blob();
    if (!output.isConnected || controller.signal.aborted) return;
    audioUrl = URL.createObjectURL(blob);
    output.innerHTML = `<p>Generated with ElevenLabs. Use the player to listen.</p><audio controls aria-label="Approved care-team brief" src="${audioUrl}"></audio><p><a href="${audioUrl}" download="careweave-reviewed-task.mp3">Download audio</a></p>`;
    button.textContent = "Audio ready";
  } catch (error) {
    if (!output.isConnected || controller.signal.aborted) return;
    output.textContent = error.message;
    button.disabled = false;
  } finally {
    if (audioController === controller) audioController = null;
  }
}
async function updateTask(id, status) {
  try {
    const { task } = await api("/tasks/" + encodeURIComponent(id), {
      method: "PATCH",
      body: { status },
    });
    state.tasks = (await api("/tasks")).tasks || [];
    render();
    showTask(task);
    toast(
      status === "approved"
        ? "Draft approved for the demo."
        : status === "completed"
          ? "Task marked completed in the demo."
          : "Task returned to draft.",
    );
  } catch (error) {
    toast(error.message);
  }
}
function simulationSummary(data) {
  const { patientId, barrier } = data;
  const beforeType = data.before.primaryBarrier;
  const afterType = data.after.primaryBarrier;
  const remaining = barriers(data.patient).map((item) => label(item.type));
  const unchanged = data.before.count === data.after.count;
  const countExplanation = unchanged
    ? remaining.length
      ? `The count stays at ${num(data.after.count)}. ${remaining.join(" and ")} ${remaining.length === 1 ? "remains" : "remain"} documented, so this person still matches the question.`
      : `The count stays at ${num(data.after.count)} because this question’s filters still include the patient. Resolving a barrier does not remove the recorded missed next step.`
    : `The same question now matches ${num(data.after.count)} patients. This changes the matching list; it does not mean a follow-up visit has happened or a health outcome has improved.`;

  return `<section class="simulation-summary"><span class="source-tag">TEMPORARY SIMULATION · ORIGINAL RECORDS UNCHANGED</span><h3>Suppose ${esc(label(barrier).toLowerCase())} is resolved for ${esc(patientId)}</h3><div class="what-if-counts"><div><span>Matching patients now</span><strong>${num(data.before.count)}</strong></div><i>→</i><div><span>With this barrier resolved</span><strong>${num(data.after.count)}</strong></div></div><p class="what-if-reason">${esc(countExplanation)}</p><div class="what-if-routing"><div><small>CURRENT PRIORITY</small><strong>${esc(label(beforeType))}</strong><span>${esc(spec(beforeType).owner)}</span><p>${esc(spec(beforeType).action)}</p></div><i aria-hidden="true">→</i><div><small>PRIORITY IN THE SIMULATION</small><strong>${esc(afterType ? label(afterType) : "No active barrier remains")}</strong><span>${esc(spec(afterType).owner)}</span><p>${esc(spec(afterType).action)}</p></div></div><p>${esc(data.explanation || "The graph query was rerun with the selected barrier marked resolved in a temporary copy.")}</p><div class="review-notice"><span>◈</span><p>The patient graph and evidence show the original record. This comparison belongs to ${esc(patientId)}, even if you select another patient.</p></div></section>`;
}
async function whatIf(patientId, barrier) {
  showDialog(
    "What if help is arranged?",
    '<div class="dialog-loading">Recomputing the query with this barrier resolved.</div>',
  );
  try {
    const data = await api("/what-if", {
      method: "POST",
      body: { patientId, barrier, filters: state.result?.filters || undefined },
    });
    showDialog(
      "What if help is arranged?",
      simulationSummary(data) +
        btn(
          "Prepare support for " + esc(label(barrier).toLowerCase()),
          "prepare-task",
          `data-id="${esc(patientId)}" data-barrier="${esc(barrier)}"`,
          "primary",
        ),
      true,
    );
  } catch (error) {
    showDialog(
      "The comparison could not finish",
      `<p>${esc(error.message)}</p>`,
    );
  }
}
function renderTrace() {
  showDialog(
    "What the backend actually did",
    `<div class="trace-intro">${modeBadge()}<p>Completed tool calls, results and source links. Timings measure tool execution; these are not private model thoughts.</p></div>${state.events.length ? state.events.map((e, i) => `<details class="live-trace-step" ${i === state.events.length - 1 ? "open" : ""}><summary><span>${i + 1}</span><strong>${esc(e.label || e.tool)}</strong><small>${Number(e.durationMs || 0).toFixed(2)} ms</small><i>${e.status === "error" ? "!" : "✓"}</i></summary><p>${esc(e.detail || "")}</p><div class="trace-facts"><span>${e.nodes?.length || 0} nodes touched</span><span>${e.edges?.length || 0} edges followed</span>${e.count !== undefined ? `<span>${num(e.count)} results</span>` : ""}</div><pre>${esc(JSON.stringify(e, null, 2))}</pre>${e.sourceId ? btn("Open source", "source", `data-id="${esc(e.sourceId)}"`, "secondary") : ""}</details>`).join("") : "<p>Run an investigation to see the tools the backend used.</p>"}<div class="trace-footer">${btn("Inspect agent instructions", "view", 'data-view="agent"', "secondary")}</div>`,
    true,
  );
  state.trace = true;
}
function about() {
  showDialog(
    "About Careweave",
    `<p class="about-intro">Careweave helps a hospital care transitions team understand why a next step was missed, connect the evidence, and prepare a useful response.</p><h3>Real software. Fictional patients.</h3><p>The workspace uses a synthetic hospital dataset and a fixed date. The backend runs graph queries, returns source records, simulates changes, and stores this browser session’s task queue and investigation history.</p><h3>How the AI connection works</h3><p>When configured, an OpenAI agent selects validated tools and explains their results. Exact membership and counts come from the graph. Without an API key, the app uses structured rules and clearly labels that mode.</p><h3>Evidence has limits</h3><p>Clinical notes are read with a pattern-based reader. It can miss indirect language or misread a sentence. Counts are exact for the graph, while the guided story includes a separate answer-key evaluation of reading accuracy.</p><h3>Human review stays in the loop</h3><p>No calls, messages, bookings, prescriptions or hospital orders leave this prototype. Task approval demonstrates a care-team review, and what-if comparisons do not predict clinical outcomes.</p><a class="text-link" href="/story.html">Open the guided, measured prototype →</a>`,
    true,
  );
}
document.addEventListener("submit", (e) => {
  if (e.target.matches("[data-question-form]")) {
    e.preventDefault();
    investigate($("#care-question").value);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "care-question") state.question = e.target.value;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDialog();
    state.nav = false;
    $(".w-sidebar")?.classList.remove("open");
  }
  if (
    e.key === "Enter" &&
    (e.ctrlKey || e.metaKey) &&
    e.target.id === "care-question"
  ) {
    e.preventDefault();
    investigate(e.target.value);
  }
  if (e.key === "Tab" && state.dialog) {
    const focusable = [
        ...$("#overlay-root").querySelectorAll(
          'button,a[href],input,textarea,summary,[tabindex="0"]',
        ),
      ].filter((e) => !e.disabled),
      first = focusable[0],
      last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "view") {
    state.view = el.dataset.view;
    state.nav = false;
    closeDialog();
    render();
    return;
  }
  if (action === "menu") {
    state.nav = !state.nav;
    $(".w-sidebar").classList.toggle("open", state.nav);
    return;
  }
  if (action === "reload") return load();
  if (action === "about") return about();
  if (action === "close") return closeDialog();
  if (action === "starter") {
    state.previousFilters = null;
    return investigate(el.dataset.question);
  }
  if (action === "record-date")
    return selectPatient(
      state.patient.id,
      el.dataset.date === "discharge"
        ? state.patient.admission.dischargeDate
        : null,
    );
  if (action === "retry") return investigate(state.lastQuestion);
  if (action === "retry-rules") return investigate(state.lastQuestion, "rules");
  if (action === "cancel") return state.controller?.abort();
  if (action === "clear-context") {
    state.previousFilters = null;
    toast("The next question starts a new investigation.");
    render();
    return;
  }
  if (action === "beat") {
    state.beat = Number(el.dataset.beat);
    render();
    return;
  }
  if (action === "expand") {
    state.expanded = !state.expanded;
    render();
    return;
  }
  if (action === "patient") return selectPatient(el.dataset.id);
  if (action === "source") return openSource(el.dataset.id);
  if (action === "filter") {
    state.group = el.dataset.group;
    render();
    return;
  }
  if (action === "prepare-task")
    return prepareTask(el.dataset.id, el.dataset.barrier);
  if (action === "gemini-brief") return geminiBrief(el.dataset.id);
  if (action === "what-if") return whatIf(el.dataset.id, el.dataset.barrier);
  if (action === "queue-filter") {
    state.queue = el.dataset.status;
    render();
    return;
  }
  if (action === "task")
    return showTask(state.tasks.find((t) => t.id === el.dataset.id));
  if (action === "task-status")
    return updateTask(el.dataset.id, el.dataset.status);
  if (action === "audio-preview") return previewTaskAudio(el.dataset.id);
  if (action === "audio-generate") return playTaskAudio(el.dataset.id, el);
  if (action === "trace") {
    state.trace = true;
    renderTrace();
    return;
  }
  if (action === "load-agent") {
    try {
      state.agent = await api("/agent");
      render();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (action === "run") {
    try {
      state.result = await api("/runs/" + encodeURIComponent(el.dataset.id));
      state.error = state.result.ok
        ? ""
        : state.result.answer ||
          "This investigation is incomplete. Rephrase the question or retry.";
      state.events = state.result.events || [];
      state.previousFilters = state.result.filters;
      state.lastQuestion =
        state.result.question ||
        state.runs.find((r) => r.id === el.dataset.id)?.question ||
        "";
      state.view = "investigation";
      state.runId = el.dataset.id;
      const id =
        state.result.patientId || state.result.result?.patients?.[0]?.id;
      if (id) await selectPatient(id);
      else render();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (action === "export") {
    const blob = new Blob([JSON.stringify(state.result, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `careweave-evidence-${state.runId || "investigation"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Evidence export downloaded.");
  }
});
window.addEventListener("unhandledrejection", (event) => {
  toast("A request could not finish. Please retry.");
});
load();
