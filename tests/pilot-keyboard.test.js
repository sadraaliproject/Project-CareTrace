import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(
  new URL("../dist/pilot-app.js", import.meta.url),
  "utf8",
);
const modalCode = script.slice(
  script.indexOf("let modalReturnFocus"),
  script.indexOf("function showSource"),
);
const keyboardCode = script.slice(
  script.indexOf('document.addEventListener("keydown", (e) => {'),
  script.indexOf('window.addEventListener("error"'),
);

function harness() {
  let handler;
  let scheduled = 0;
  const document = {
    activeElement: null,
    addEventListener(_, listener) {
      handler = listener;
    },
  };
  const control = () => ({
    isConnected: true,
    hidden: false,
    getClientRects: () => [1],
    focus() {
      document.activeElement = this;
    },
  });
  const opener = control();
  const first = control();
  const last = control();
  document.activeElement = opener;
  const overlay = { innerHTML: "", querySelectorAll: () => [first, last] };
  const state = { modal: null, paused: false, menu: false };
  const context = vm.createContext({
    document,
    state,
    timer: 1,
    $: (selector) =>
      selector === "#overlay-root"
        ? overlay
        : selector.endsWith(".modal-close")
          ? first
          : null,
    escape: (text) => text,
    button: () => "<button>Close</button>",
    clearTimeout() {},
    schedule() {
      scheduled++;
    },
    renderControls() {},
    render() {},
    startScreen() {},
  });
  vm.runInContext(
    modalCode + keyboardCode + ";globalThis.ui = {modal,closeModal};",
    context,
  );
  return {
    document,
    state,
    opener,
    first,
    last,
    ui: context.ui,
    key(key, target = { tagName: "DIV" }, shiftKey = false) {
      const event = {
        key,
        target,
        shiftKey,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      handler(event);
      return event;
    },
    scheduled: () => scheduled,
  };
}

test("guided story dialogs contain Tab focus and return focus to their opener", () => {
  const h = harness();
  h.ui.modal("Evidence", "Source text");
  assert.equal(h.document.activeElement, h.first);
  assert.equal(h.key("Tab", {}, true).prevented, true);
  assert.equal(h.document.activeElement, h.last);
  assert.equal(h.key("Tab").prevented, true);
  assert.equal(h.document.activeElement, h.first);
  h.ui.modal("Another source", "Replacement dialog");
  h.key("Escape");
  assert.equal(h.state.modal, null);
  assert.equal(h.document.activeElement, h.opener);
});

test("Space on a focused control keeps its native action instead of pausing the story", () => {
  const h = harness();
  for (const tagName of ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(h.key(" ", { tagName }).prevented, false);
    assert.equal(h.state.paused, false);
  }
  assert.equal(h.key(" ").prevented, true);
  assert.equal(h.state.paused, true);
});

test("dialog focus returns to the current control after the animation replaces its opener", () => {
  const h = harness();
  h.opener.dataset = { action: "about" };
  h.ui.modal("Evidence", "Source text");
  h.opener.isConnected = false;
  const replacement = {
    dataset: { action: "about" },
    focus() {
      h.document.activeElement = this;
    },
  };
  h.document.querySelectorAll = () => [replacement];
  h.key("Escape");
  assert.equal(h.document.activeElement, replacement);
});

test("typing or dialog keys cannot navigate the underlying story", () => {
  const h = harness();
  assert.equal(
    h.key(" ", { tagName: "DIV", isContentEditable: true }).prevented,
    false,
  );
  h.ui.modal("Evidence", "Source text");
  assert.equal(h.key(" ").prevented, false);
  assert.equal(h.state.paused, false);
  assert.equal(h.scheduled(), 0);
});
