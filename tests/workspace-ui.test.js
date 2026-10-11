import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the production event handlers with controllable network timing.
// The small DOM stand-in only supplies rendering/focus targets; the application
// owns all request sequencing, dialog state, and selected-patient decisions.
const script = readFileSync(
  new URL("../dist/workspace.js", import.meta.url),
  "utf8",
)
  .replace(/^import[^\n]+\n/, "")
  .replace(
    /load\(\);\s*$/,
    `globalThis.workspace = {
    state, selectPatient, openSource, openNode, closeDialog, showDialog,
    whatIf, previewTaskAudio, prepareTask, updateTask, render, renderTrace,
    investigate
  };`,
  );

function harness() {
  const element = () => ({
    innerHTML: "",
    textContent: "",
    isConnected: true,
    focus() {},
    classList: { add() {}, remove() {} },
    querySelectorAll() {
      return [];
    },
  });
  const elements = new Map(
    ["#app", "#overlay-root", "#toast", "#overlay-root .close-button"].map(
      (name) => [name, element()],
    ),
  );
  const pending = [];
  const clicks = [];
  const timers = [];
  const downloads = [];
  const objectUrls = new Map();
  const revokedUrls = [];
  const context = vm.createContext({
    document: {
      querySelector: (name) => elements.get(name) || null,
      activeElement: element(),
      createElement(name) {
        assert.equal(name, "a");
        return {
          click() {
            downloads.push({
              filename: this.download,
              href: this.href,
              blob: objectUrls.get(this.href),
            });
          },
        };
      },
      addEventListener(name, listener) {
        if (name === "click") clicks.push(listener);
      },
    },
    window: { addEventListener() {} },
    createWorkspaceGraph: () => ({ destroy() {} }),
    fetch(path, options) {
      return new Promise((resolve, reject) => {
        pending.push({ path, options, resolve, reject });
        options?.signal?.addEventListener("abort", () =>
          reject(options.signal.reason),
        );
      });
    },
    AbortController,
    Blob,
    URL: {
      createObjectURL(blob) {
        const url = `blob:workspace-test-${objectUrls.size + 1}`;
        objectUrls.set(url, blob);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      },
    },
    TextDecoder,
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  });
  vm.runInContext(script, context);
  const app = context.workspace;
  Object.assign(app.state, {
    view: "queue",
    loading: false,
    overview: {},
    tasks: [],
  });
  return {
    app,
    pending,
    elements,
    timers,
    downloads,
    revokedUrls,
    reply(index, data, ok = true) {
      pending[index].resolve({ ok, json: async () => data });
    },
    click(dataset) {
      return clicks[0]({ target: { closest: () => ({ dataset }) } });
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const detail = (id) => ({ patient: { id }, graph: { nodes: [], edges: [] } });
const source = (id, name = id) => ({
  id,
  patientId: "P0001",
  table: "clinical_notes",
  row: { note_type: name, text: "The exact source note." },
});

test("the last selected patient wins when responses arrive in reverse order", async () => {
  const h = harness();
  const older = h.app.selectPatient("P0001");
  const newer = h.app.selectPatient("P0009");
  h.reply(1, detail("P0009"));
  await newer;
  h.reply(0, detail("P0001"));
  await older;
  assert.equal(h.app.state.patient.id, "P0009");
});

test("returning to today cannot be overwritten by a delayed historical request", async () => {
  const h = harness();
  const historical = h.app.selectPatient("P0001", "2026-09-24");
  const current = h.app.selectPatient("P0001");
  h.reply(1, detail("P0001"));
  await current;
  h.reply(0, detail("P0001"));
  await historical;
  assert.equal(h.app.state.asOf, null);
});

test("an obsolete patient failure does not report an error over a newer selection", async () => {
  const h = harness();
  const older = h.app.selectPatient("P0001");
  const newer = h.app.selectPatient("P0009");
  h.reply(1, detail("P0009"));
  await newer;
  h.pending[0].reject(new Error("obsolete connection failure"));
  await older;
  assert.equal(h.app.state.patient.id, "P0009");
  assert.equal(h.elements.get("#toast").textContent, "");
});

test("closing a pending source keeps it closed after success or failure", async () => {
  for (const fail of [false, true]) {
    const h = harness();
    const request = h.app.openSource("P0001-N05");
    h.app.closeDialog();
    if (fail) h.pending[0].reject(new Error("not available"));
    else h.reply(0, source("P0001-N05"));
    await request;
    assert.equal(h.app.state.dialog, null);
    assert.equal(h.elements.get("#overlay-root").innerHTML, "");
  }
});

test("a delayed source cannot replace a more recently opened source", async () => {
  const h = harness();
  const older = h.app.openSource("P0001-N01");
  const newer = h.app.openSource("P0001-N05");
  h.reply(1, source("P0001-N05", "Latest note"));
  await newer;
  h.reply(0, source("P0001-N01", "Earlier note"));
  await older;
  assert.equal(h.app.state.dialog.title, "Latest note");
  assert.equal(h.app.state.source.id, "P0001-N05");
});

test("opening source evidence from a trace does not replace it on later rendering", async () => {
  const h = harness();
  h.app.renderTrace();
  const request = h.app.openSource("P0001-N05");
  h.reply(0, source("P0001-N05", "Selected evidence"));
  await request;
  h.app.render();
  assert.equal(h.app.state.dialog.title, "Selected evidence");
  assert.equal(h.app.state.trace, false);
});

test("historical graph sources retain their requested date and date label", async () => {
  const h = harness();
  h.app.state.asOf = "2026-09-24";
  const request = h.app.openNode({
    id: "P0001-M01",
    type: "Medication",
    source: { key: "P0001-M01", table: "medications" },
  });
  assert.equal(h.pending[0].path, "/api/v1/sources/P0001-M01?asOf=2026-09-24");
  h.reply(0, { ...source("P0001-M01"), asOf: "2026-09-24", historical: true });
  await request;
  assert.match(h.elements.get("#overlay-root").innerHTML, /HISTORICAL RECORD/);
  assert.match(h.elements.get("#overlay-root").innerHTML, /Sep 24, 2026/);
});

test("task evidence remains current even when the main graph is historical", async () => {
  const h = harness();
  h.app.state.asOf = "2026-09-24";
  const request = h.click({ action: "source", id: "P0001-N05" });
  assert.equal(h.pending[0].path, "/api/v1/sources/P0001-N05");
  h.reply(0, { ...source("P0001-N05"), asOf: "2026-10-10", historical: false });
  await request;
  assert.doesNotMatch(
    h.elements.get("#overlay-root").innerHTML,
    /HISTORICAL RECORD/,
  );
});

test("a historical source retry keeps its original date", async () => {
  const h = harness();
  const request = h.app.openSource("P0001-N05", undefined, "2026-09-24");
  h.reply(0, { error: { message: "This note did not yet exist." } }, false);
  await request;
  assert.match(
    h.elements.get("#overlay-root").innerHTML,
    /data-as-of="2026-09-24"/,
  );
  assert.match(
    h.elements.get("#overlay-root").innerHTML,
    /This note did not yet exist/,
  );
});

test("closing a pending what-if comparison prevents a later modal", async () => {
  const h = harness();
  const request = h.app.whatIf("P0001", "transportation");
  h.app.closeDialog();
  h.reply(0, {});
  await request;
  assert.equal(h.app.state.dialog, null);
});

test("closing a pending audio preview prevents a later modal", async () => {
  const h = harness();
  const request = h.app.previewTaskAudio("task-1");
  h.app.closeDialog();
  h.reply(0, { text: "Approved brief" });
  await request;
  assert.equal(h.app.state.dialog, null);
});

test("a completed draft creation refreshes the queue without replacing a new modal", async () => {
  const h = harness();
  const request = h.app.prepareTask("P0001", "transportation");
  h.app.showDialog("Newly opened evidence", "evidence");
  h.reply(0, { task: { id: "task-1" }, created: true });
  await settle();
  h.reply(1, { tasks: [{ id: "task-1", status: "draft" }] });
  await request;
  assert.equal(h.app.state.tasks[0].id, "task-1");
  assert.equal(h.app.state.dialog.title, "Newly opened evidence");
});

test("task approval finishes and refreshes the queue without reopening a closed modal", async () => {
  const h = harness();
  h.app.showDialog("Draft task", "draft");
  const request = h.app.updateTask("task-1", "approved");
  h.app.closeDialog();
  h.reply(0, { task: { id: "task-1", status: "approved" } });
  await settle();
  h.reply(1, { tasks: [{ id: "task-1", status: "approved" }] });
  await request;
  assert.equal(h.app.state.tasks[0].status, "approved");
  assert.equal(h.app.state.dialog, null);
});

test("an investigation timeout provides a visible retry message and clears busy state", async () => {
  const h = harness();
  const request = h.app.investigate("Who needs transportation?");
  assert.equal(h.app.state.busy, true);
  h.timers[0]();
  await request;
  assert.equal(h.pending[0].options.signal.aborted, true);
  assert.equal(h.app.state.busy, false);
  assert.match(h.app.state.error, /took too long/);
  assert.match(h.elements.get("#app").innerHTML, /Retry the question/);
});

test("stopping an investigation reports cancellation separately from timeout", async () => {
  const h = harness();
  const request = h.app.investigate("Who needs transportation?");
  h.app.state.controller.abort();
  await request;
  assert.equal(h.app.state.busy, false);
  assert.match(h.app.state.error, /investigation stopped/);
  assert.doesNotMatch(h.app.state.error, /took too long/);
});

test("filtering a group selects a matching patient and removes the unrelated case while loading", async () => {
  const h = harness();
  h.app.state.patient = { id: "P0001" };
  h.app.state.graph = { nodes: [] };
  h.app.state.result = {
    result: {
      patients: [
        { id: "P0001", primaryBarrier: "transportation" },
        { id: "P0009", primaryBarrier: "cost" },
      ],
    },
  };
  const request = h.click({ action: "filter", group: "cost" });
  assert.equal(h.app.state.patient, null);
  assert.equal(h.app.state.graph, null);
  assert.equal(h.pending[0].path, "/api/v1/patients/P0009");
  h.reply(0, detail("P0009"));
  await request;
  assert.equal(h.app.state.group, "cost");
  assert.equal(h.app.state.patient.id, "P0009");
});

test("an empty group cannot leave an unrelated patient available for action", async () => {
  const h = harness();
  h.app.state.patient = { id: "P0001" };
  h.app.state.graph = { nodes: [] };
  h.app.state.result = {
    result: { patients: [{ id: "P0001", primaryBarrier: "transportation" }] },
  };
  await h.click({ action: "filter", group: "cost" });
  assert.equal(h.app.state.patient, null);
  assert.equal(h.app.state.graph, null);
  assert.equal(h.pending.length, 0);
});

test("a delayed previous patient cannot overwrite the group selected afterward", async () => {
  const h = harness();
  h.app.state.patient = { id: "P0001" };
  h.app.state.result = {
    result: {
      patients: [
        { id: "P0001", primaryBarrier: "transportation" },
        { id: "P0009", primaryBarrier: "cost" },
      ],
    },
  };
  const old = h.app.selectPatient("P0001");
  const filtered = h.click({ action: "filter", group: "cost" });
  h.reply(1, detail("P0009"));
  await filtered;
  h.reply(0, detail("P0001"));
  await old;
  assert.equal(h.app.state.patient.id, "P0009");
});

test("reopening an investigation resets a stale group filter", async () => {
  const h = harness();
  h.app.state.group = "cost";
  const request = h.click({ action: "run", id: "run-1" });
  h.reply(0, {
    ok: true,
    mode: "rules",
    question: "Transportation",
    result: {
      count: 1,
      groups: [],
      patients: [
        { id: "P0001", primaryBarrier: "transportation", daysRemaining: 14 },
      ],
    },
  });
  await settle();
  h.reply(1, detail("P0001"));
  await request;
  assert.equal(h.app.state.group, "all");
  assert.equal(h.app.state.view, "investigation");
  assert.equal(h.app.state.patient.id, "P0001");
  assert.match(h.elements.get("#app").innerHTML, /1 shown/);
});

test("the last history selection wins when run responses arrive out of order", async () => {
  const h = harness();
  const older = h.click({ action: "run", id: "old-run" });
  const newer = h.click({ action: "run", id: "new-run" });
  h.reply(1, {
    ok: true,
    question: "Latest history",
    result: {
      count: 1,
      groups: [],
      patients: [{ id: "P0009", primaryBarrier: "cost", daysRemaining: 12 }],
    },
  });
  await settle();
  h.reply(2, detail("P0009"));
  await newer;
  h.reply(0, {
    ok: true,
    question: "Earlier history",
    result: {
      count: 1,
      groups: [],
      patients: [
        { id: "P0001", primaryBarrier: "transportation", daysRemaining: 14 },
      ],
    },
  });
  await older;
  assert.equal(h.app.state.runId, "new-run");
  assert.equal(h.app.state.lastQuestion, "Latest history");
  assert.equal(h.app.state.patient.id, "P0009");
  assert.equal(h.pending.length, 3);
});

test("starting a new investigation invalidates a pending history selection", async () => {
  const h = harness();
  const history = h.click({ action: "run", id: "old-run" });
  const investigation = h.app.investigate("A completely new question");
  h.reply(0, {
    ok: true,
    question: "Earlier history",
    result: {
      count: 1,
      groups: [],
      patients: [
        { id: "P0001", primaryBarrier: "transportation", daysRemaining: 14 },
      ],
    },
  });
  await history;
  assert.equal(h.app.state.lastQuestion, "A completely new question");
  assert.equal(h.app.state.result, null);
  assert.equal(h.app.state.busy, true);
  assert.equal(h.pending.length, 2);
  h.app.state.controller.abort();
  await investigation;
});

test("a failed superseded history request does not show an irrelevant error", async () => {
  const h = harness();
  const older = h.click({ action: "run", id: "old-run" });
  const newer = h.click({ action: "run", id: "new-run" });
  h.reply(1, {
    ok: true,
    question: "Latest history",
    result: { count: 0, groups: [], patients: [] },
  });
  await newer;
  h.pending[0].reject(new Error("Older history disconnected"));
  await older;
  assert.equal(h.app.state.runId, "new-run");
  assert.equal(h.elements.get("#toast").textContent, "");
});

test("the evidence export preserves the exact result, filters, and citations with CareTrace branding", async () => {
  const h = harness();
  const result = {
    ok: true,
    mode: "openai",
    runId: "reviewed-run-42",
    question: "Which discharged patients need transportation inside 30 days?",
    answer: "9 synthetic patients match the verified graph filters.",
    filters: {
      diabetes: true,
      openGap: true,
      barriers: ["transportation"],
      within30: true,
    },
    result: {
      count: 9,
      patients: [
        {
          id: "P0001",
          name: "Mavis Labadie",
          primaryBarrier: "transportation",
        },
      ],
    },
    citations: [
      {
        patientId: "P0001",
        sourceId: "P0001-N05",
        quote: "Pt has no reliable ride to the clinic visit.",
      },
    ],
    events: [{ tool: "query_patients", count: 9 }],
  };
  h.app.state.result = result;
  h.app.state.runId = result.runId;
  await h.click({ action: "export" });
  assert.equal(h.downloads.length, 1);
  const download = h.downloads[0];
  assert.equal(download.filename, "caretrace-evidence-reviewed-run-42.json");
  assert.equal(download.blob.type, "application/json");
  const exported = JSON.parse(await download.blob.text());
  assert.deepEqual(exported, result);
  assert.equal(exported.result.count, 9);
  assert.deepEqual(exported.filters, result.filters);
  assert.deepEqual(exported.citations, result.citations);
  assert.equal(h.revokedUrls.length, 0);
  h.timers[0]();
  assert.deepEqual(h.revokedUrls, [download.href]);
});
