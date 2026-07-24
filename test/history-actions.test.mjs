import assert from "node:assert/strict";
import test from "node:test";
import { historyActionDisabled } from "../extension/src/history-actions.js";

test("body-dependent History actions stay disabled when content is missing", () => {
  const missing = { content_exists: false, inbox_state: "missing" };

  for (const action of ["open-body", "copy-agent", "copy-content"]) {
    assert.equal(
      historyActionDisabled(action, missing, { isBusy: false, hostAvailable: true }),
      true
    );
  }
});

test("History action state preserves host, busy, and duplicate-inbox guards", () => {
  const available = { content_exists: true, inbox_state: "present" };
  const duplicate = { content_exists: true, inbox_state: "duplicate" };

  assert.equal(historyActionDisabled("copy-agent", available, { hostAvailable: true }), false);
  assert.equal(historyActionDisabled("copy-agent", available, { hostAvailable: false }), true);
  assert.equal(historyActionDisabled("copy-agent", available, { isBusy: true, hostAvailable: true }), true);
  assert.equal(historyActionDisabled("mark-processed", duplicate, { hostAvailable: true }), true);
  assert.equal(historyActionDisabled("delete-capture", duplicate, { hostAvailable: true }), true);
  assert.equal(historyActionDisabled("retry-sync", duplicate, { hostAvailable: true }), false);
});
