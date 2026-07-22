import test from "node:test";
import assert from "node:assert/strict";

import {
  getUiState,
  nextTabIndex,
  resolveClipUiState,
  resolveHostUiState,
  stateClassName
} from "../extension/src/ui-state.js";

test("local success is distinct from external sync success", () => {
  assert.equal(resolveClipUiState({ ok: true, capture: {} }).key, "saved-local");
  assert.equal(resolveClipUiState({ ok: true, duplicate: true, capture: {} }).key, "duplicate");
  assert.equal(resolveClipUiState({ ok: true, capture: {}, sync: { status: "sync_failed" } }).key, "saved-local-sync-failed");
});

test("sync consent keeps the confirmed local copy visible", () => {
  const state = resolveClipUiState({
    ok: true,
    capture: {},
    sync: {
      status: "sync_skipped",
      error: { code: "sync_consent_required" }
    }
  });

  assert.equal(state.key, "consent-required");
  assert.match(state.title, /Note saved/);
  assert.equal(state.action, "Open Sync settings");
});

test("re-clipping processed content reports that it returned to the inbox", () => {
  const state = resolveClipUiState({ ok: true, duplicate: true, reactivated: true });
  assert.equal(state.key, "reactivated");
  assert.equal(state.title, "Returned to your inbox");
  assert.equal(state.action, "Open note");
});

test("missing and outdated Hosts have separate recovery states", () => {
  assert.equal(resolveHostUiState({ ok: false, error: { code: "host_unavailable" } }).key, "host-missing");
  assert.equal(resolveHostUiState({ ok: false, error: { code: "host_outdated" } }).key, "host-outdated");
  assert.equal(resolveHostUiState({ ok: true, host_version: "0.6.0" }).detail, "Local Host 0.6.0 is ready.");
});

test("unsupported pages never resolve to a saved state", () => {
  const state = resolveClipUiState({
    ok: false,
    error: { code: "unsupported_page", message: "Chrome internal pages are unsupported." }
  });

  assert.equal(state.key, "unsupported");
  assert.equal(state.tone, "warning");
});

test("state classes preserve semantic tone", () => {
  assert.equal(stateClassName("result-card", getUiState("saved-local")), "result-card is-ready");
  assert.equal(stateClassName("result-card", getUiState("error")), "result-card is-error");
});

test("tab navigation follows the ARIA keyboard pattern", () => {
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
  assert.equal(nextTabIndex("Enter", 0, 3), null);
});
