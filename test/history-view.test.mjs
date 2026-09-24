import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHistoryView } from "../extension/src/history-view.js";

function mount({ history, confirmResult = true, historyProblem = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <span id="status"></span>
    <div id="warning" hidden></div>
    <div id="list"></div>
    <button data-history-filter="active">Active</button>
    <button data-history-filter="processed">Processed</button>
  </body></html>`, { url: "https://clipplane.test/" });
  const { window } = dom;
  globalThis.document = window.document;

  const sent = [];
  const notifications = [];
  const state = { unavailable: 0, history };

  const hostLink = {
    send: async (message) => {
      sent.push(message);
      if (message.type === "history") {
        if (historyProblem) {
          return { response: { ok: false, error: { code: historyProblem, message: "boom" } }, problem: historyProblem };
        }
        return { response: { ok: true, history: state.history }, problem: null };
      }
      return { response: { ok: true }, problem: null };
    }
  };

  const view = createHistoryView({
    elements: {
      list: window.document.querySelector("#list"),
      status: window.document.querySelector("#status"),
      warning: window.document.querySelector("#warning"),
      filterButtons: [...window.document.querySelectorAll("[data-history-filter]")]
    },
    hostLink,
    confirm: () => confirmResult,
    notify: (message, isError) => notifications.push({ message, isError }),
    onHostUnavailable: () => { state.unavailable += 1; },
    hostAvailable: () => true
  });

  return { window, view, sent, notifications, state, hostLink };
}

const ITEMS = [
  {
    capture_id: "synced-selection",
    title: "Synced selection",
    source_host: "example.com",
    input_type: "selection",
    extraction_method: "selection",
    clipped_at: "2026-09-01T00:00:00.000Z",
    tags: ["ai"],
    sync_status: "synced",
    lifecycle_status: "active",
    inbox_state: "present",
    content_exists: true,
    preview: "Preview text"
  },
  {
    capture_id: "failed-page",
    title: "Failed page",
    source_host: "example.org",
    input_type: "page",
    extraction_method: "readability",
    clipped_at: "2026-09-02T00:00:00.000Z",
    tags: [],
    sync_status: "sync_failed",
    lifecycle_status: "active",
    inbox_state: "present",
    content_exists: true
  },
  {
    capture_id: "processed-page",
    title: "Processed page",
    source_host: "example.net",
    input_type: "page",
    extraction_method: "readability",
    clipped_at: "2026-09-03T00:00:00.000Z",
    tags: [],
    sync_status: "local_saved",
    lifecycle_status: "processed",
    inbox_state: "missing",
    content_exists: true
  }
];

test("the history view renders items, states, and scoped manage menus", async () => {
  const { window, view } = mount({ history: { items: ITEMS, warnings: [] } });
  await view.load();

  const list = window.document.querySelector("#list");
  const rows = list.querySelectorAll(".history-item");
  assert.equal(rows.length, 3);
  assert.equal(window.document.querySelector("#status").textContent, "3 active");

  const synced = rows[0];
  assert.equal(synced.querySelector(".history-state").textContent, "Synced");
  assert.match(synced.querySelector(".history-preview").textContent, /Preview text/);
  assert.equal(synced.querySelector("[data-action='copy-agent']").disabled, false);
  const manage = synced.querySelector(".history-manage");
  assert.equal(manage.querySelector("summary").getAttribute("aria-label"), "Manage Synced selection");

  assert.ok(rows[1].querySelector("[data-action='retry-sync']"), "sync failures expose a retry");
  assert.ok(!rows[0].querySelector("[data-action='retry-sync']"), "synced items do not");
  assert.ok(!rows[2].querySelector("[data-action='mark-processed']"), "processed items hide the process action");
  assert.ok(rows[2].querySelector("[data-action='delete-capture']"), "processed items keep deletion");
});

test("copy actions send the right message and notify once", async () => {
  const { window, view, sent, notifications } = mount({ history: { items: [ITEMS[0]], warnings: [] } });
  await view.load();

  const button = window.document.querySelector("[data-action='copy-agent']");
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve));

  assert.deepEqual(sent.find((message) => message.type === "copy_capture"), {
    type: "copy_capture",
    captureId: "synced-selection",
    mode: "agent-reference"
  });
  assert.deepEqual(notifications, [
    { message: "Agent reference copied. Paste it into your Agent session.", isError: false }
  ]);
});

test("destructive actions confirm first and reload afterwards", async () => {
  const refused = mount({ history: { items: [ITEMS[0]], warnings: [] }, confirmResult: false });
  await refused.view.load();
  refused.window.document.querySelector("[data-action='delete-capture']")
    .dispatchEvent(new refused.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(refused.sent.filter((message) => message.type === "delete_capture").length, 0);

  const accepted = mount({ history: { items: [ITEMS[0]], warnings: [] }, confirmResult: true });
  await accepted.view.load();
  accepted.window.document.querySelector("[data-action='delete-capture']")
    .dispatchEvent(new accepted.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve));

  assert.equal(accepted.sent.filter((message) => message.type === "delete_capture").length, 1);
  assert.equal(accepted.sent.filter((message) => message.type === "history").length, 2, "history reloads after deletion");
  assert.deepEqual(accepted.notifications.at(-1), {
    message: "Local note permanently deleted. External copies were not changed.",
    isError: false
  });
});

test("escape closes an open manage menu and refocuses its summary", async () => {
  const { window, view } = mount({ history: { items: [ITEMS[0]], warnings: [] } });
  await view.load();

  const manage = window.document.querySelector(".history-manage");
  manage.setAttribute("open", "");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  assert.equal(manage.hasAttribute("open"), false);
  assert.equal(window.document.activeElement, manage.querySelector("summary"));
});

test("host problems on load surface through the unavailable hook", async () => {
  const { view, state } = mount({ historyProblem: "host-outdated" });
  await view.load();
  assert.equal(state.unavailable, 1);
});
