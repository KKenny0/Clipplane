import test from "node:test";
import assert from "node:assert/strict";

import { browserLabel, buildDiagnostics } from "../extension/src/diagnostics.js";

test("diagnostics include compatibility facts without private storage or sync data", () => {
  const output = buildDiagnostics({
    platform: { os: "mac", arch: "arm64" },
    browser: "Chrome 140",
    extensionVersion: "0.8.0",
    status: {
      ok: true,
      host_version: "0.8.0",
      protocol_version: 3,
      notes_dir: "/Users/alice/Documents/private-notes",
      notion_token: "secret",
      flomo_webhook: "https://example.invalid/private"
    }
  });

  assert.equal(output, [
    "Clipplane diagnostics",
    "OS: mac",
    "Architecture: arm64",
    "Browser: Chrome 140",
    "Extension: 0.8.0",
    "Host: 0.8.0",
    "Protocol: 3",
    "Error: none"
  ].join("\n"));
  assert.doesNotMatch(output, /alice|secret|example\.invalid|notes_dir/i);
});

test("diagnostics describe an unavailable Host without leaking its message", () => {
  const output = buildDiagnostics({
    platform: { os: "win", arch: "x86-64" },
    browser: browserLabel(null, "Mozilla/5.0 Chrome/140.0.0.0"),
    extensionVersion: "0.8.0",
    status: { ok: false, error: { code: "host_unavailable", message: "C:\\private\\path" } }
  });

  assert.match(output, /Browser: Chrome 140\.0\.0\.0/);
  assert.match(output, /Host: unavailable/);
  assert.match(output, /Protocol: unavailable/);
  assert.match(output, /Error: host_unavailable/);
  assert.doesNotMatch(output, /private/);
});
