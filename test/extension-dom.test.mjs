import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("popup exposes one primary Host recovery action and a structured result", async () => {
  const document = await loadDocument("extension/popup.html");
  const hostPanel = document.querySelector("#host-panel");
  assert.ok(hostPanel);
  assert.equal(hostPanel.querySelectorAll(".host-primary").length, 1);
  assert.equal(hostPanel.querySelector(".host-primary").id, "install-host");
  assert.ok(hostPanel.querySelector("details.manual-setup"));

  const result = document.querySelector("#result");
  assert.equal(result.getAttribute("aria-live"), "polite");
  assert.ok(result.querySelector("#result-title"));
  assert.ok(result.querySelector("#result-detail"));
  assert.ok(result.querySelector("#result-primary"));
});

test("onboarding presents install, restart, and verification as ordered steps", async () => {
  const document = await loadDocument("extension/onboarding.html");
  assert.deepEqual(
    [...document.querySelectorAll(".setup-step")].map((step) => step.id),
    ["step-install", "step-restart", "step-check"]
  );
  assert.equal(document.querySelector("#host-state").getAttribute("aria-live"), "polite");
  assert.match(document.querySelector("#first-capture").textContent, /Save locally first/);
});

test("settings follows tab and keyboard accessibility structure", async () => {
  const document = await loadDocument("extension/settings.html");
  assert.equal(document.querySelector(".skip-link").getAttribute("href"), "#main-content");

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  assert.equal(tabs.length, 3);
  for (const tab of tabs) {
    const panel = document.querySelector(`#${tab.getAttribute("aria-controls")}`);
    assert.ok(panel);
    assert.equal(panel.getAttribute("role"), "tabpanel");
  }
});

test("extension styles avoid broad transitions and honor reduced motion", async () => {
  for (const file of ["brand.css", "popup.css", "onboarding.css", "settings.css"]) {
    const css = await readFile(path.join(rootDir, "extension", file), "utf8");
    assert.doesNotMatch(css, /transition\s*:\s*all\b/i, `${file} must not transition every property`);
    assert.match(css, /prefers-reduced-motion/, `${file} must honor reduced motion`);
  }
});

async function loadDocument(relativePath) {
  const html = await readFile(path.join(rootDir, relativePath), "utf8");
  return new JSDOM(html).window.document;
}
