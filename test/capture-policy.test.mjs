import test from "node:test";
import assert from "node:assert/strict";

import { capturablePage } from "../extension/src/capture-policy.js";

test("capture policy accepts normal web and local file pages", () => {
  assert.equal(capturablePage("https://example.com/article").ok, true);
  assert.equal(capturablePage("http://localhost:3000/docs").ok, true);
  assert.equal(capturablePage("file:///Users/example/note.html").ok, true);
});

test("capture policy rejects browser internals and the Chrome Web Store", () => {
  for (const url of [
    "chrome://extensions/",
    "chrome-extension://example/settings.html",
    "https://chromewebstore.google.com/detail/example"
  ]) {
    const result = capturablePage(url);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unsupported_page");
  }
});
