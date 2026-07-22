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
  assert.ok(result.querySelector("details#result-details #result-path"));
  assert.ok(result.querySelector("#result-primary"));
});

test("onboarding presents install, restart, and verification as ordered steps", async () => {
  const document = await loadDocument("extension/onboarding.html");
  const css = await readFile(path.join(rootDir, "extension", "onboarding.css"), "utf8");
  assert.deepEqual(
    [...document.querySelectorAll(".setup-step")].map((step) => step.id),
    ["step-install", "step-restart", "step-check"]
  );
  assert.equal(document.querySelector("#host-state").getAttribute("aria-live"), "polite");
  assert.match(document.querySelector("#first-capture").textContent, /Capture the part that matters/);
  assert.equal(document.querySelector("#download-host").hidden, true);
  assert.match(css, /\.primary\[hidden\]\s*\{\s*display:\s*none;/);
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

  const historyFilters = [...document.querySelectorAll("[data-history-filter]")];
  assert.deepEqual(historyFilters.map((button) => button.dataset.historyFilter), ["active", "processed"]);
  assert.equal(historyFilters[0].getAttribute("aria-pressed"), "true");
  assert.equal(historyFilters[1].getAttribute("aria-pressed"), "false");

  const sinkFields = [...document.querySelectorAll(".sink-fields")];
  assert.equal(sinkFields.length, 2);
  assert.ok(sinkFields.every((fields) => fields.querySelectorAll(".field").length === 2));
});

test("history keeps destructive actions inside a capture-scoped management disclosure", async () => {
  const script = await readFile(path.join(rootDir, "extension", "settings.js"), "utf8");
  assert.match(script, /manage\.className = "history-manage"/);
  assert.match(script, /manageSummary\.setAttribute\("aria-label", `Manage /);
  assert.match(script, /manageActions\.append\(remove\)/);
  assert.match(script, /actions\.append\(quickActions, manage\)/);
  assert.match(script, /closeHistoryMenusOnOutsideClick/);
  assert.match(script, /closeHistoryMenuOnEscape/);
});

test("extension styles avoid broad transitions and honor reduced motion", async () => {
  for (const file of ["brand.css", "popup.css", "onboarding.css", "settings.css"]) {
    const css = await readFile(path.join(rootDir, "extension", file), "utf8");
    assert.doesNotMatch(css, /transition\s*:\s*all\b/i, `${file} must not transition every property`);
    assert.match(css, /prefers-reduced-motion/, `${file} must honor reduced motion`);
  }
});

test("shared brand tokens follow the system color scheme without per-surface color forks", async () => {
  const brandCss = await readFile(path.join(rootDir, "extension", "brand.css"), "utf8");
  assert.match(brandCss, /color-scheme:\s*light dark/);
  assert.match(brandCss, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.match(brandCss, /--cp-on-accent:/);
  assert.match(brandCss, /--cp-warning-border:/);

  for (const file of ["popup.css", "onboarding.css", "settings.css"]) {
    const css = await readFile(path.join(rootDir, "extension", file), "utf8");
    assert.doesNotMatch(css, /oklch\(/, `${file} must consume shared semantic color tokens`);
  }
});

async function loadDocument(relativePath) {
  const html = await readFile(path.join(rootDir, relativePath), "utf8");
  return new JSDOM(html).window.document;
}
