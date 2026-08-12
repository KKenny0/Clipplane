import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..");
const readabilitySource = await fs.readFile(
  path.join(rootDir, "node_modules", "@mozilla", "readability", "Readability.js"),
  "utf8"
);
const normalizerSource = await fs.readFile(path.join(rootDir, "extension", "src", "dom-normalizer.js"), "utf8");
const captureSource = await fs.readFile(path.join(rootDir, "extension", "src", "page-capture.js"), "utf8");

test("page capture prefers Readability and excludes layout noise", async () => {
  const html = await readFixture("article.html");
  const payload = captureFromHtml(html, "https://example.com/article");

  assert.equal(payload.inputType, "page");
  assert.equal(payload.extractionMethod, "readability");
  assert.match(payload.contentMarkdown, /local tool earns trust/i);
  assert.match(payload.contentMarkdown, /\[implementation guide\]\(https:\/\/example\.com\/guide\)/);
  assert.doesNotMatch(payload.contentMarkdown, /Primary navigation|Newsletter Subscribe|Recommended stories/i);
  assert.equal(typeof payload.author, "string");
  assert.equal(typeof payload.publishedAt, "string");
  assert.equal(typeof payload.description, "string");
  assert.equal(payload.siteName || "example.com", "example.com");
});

test("page capture falls back for short pages without dropping the content", async () => {
  const html = await readFixture("short-page.html");
  const payload = captureFromHtml(html, "https://example.com/short");

  assert.equal(payload.inputType, "page");
  assert.equal(payload.extractionMethod, "fallback");
  assert.match(payload.contentMarkdown, /One compact update/);
  assert.match(payload.contentMarkdown, /\[Read details\]\(https:\/\/example\.com\/details\)/);
});

test("all capture modes receive deterministic page metadata", () => {
  const dom = createDom(`
    <title>Metadata page</title>
    <meta name="author" content="Ada Lovelace">
    <meta property="article:published_time" content="2026-08-12">
    <meta name="description" content="A useful description">
    <meta property="og:site_name" content="Example Notes">
    <p id="body">Selected metadata text.</p>
  `, "https://example.com/metadata");
  const range = dom.window.document.createRange();
  range.selectNodeContents(dom.window.document.querySelector("#body"));
  dom.window.getSelection().addRange(range);
  for (const payload of [
    dom.window.__clipplaneCapture.capture("selection"),
    dom.window.__clipplaneCapture.captureElement(dom.window.document.querySelector("#body"))
  ]) {
    assert.equal(payload.author, "Ada Lovelace");
    assert.equal(payload.publishedAt, "2026-08-12");
    assert.equal(payload.description, "A useful description");
    assert.equal(payload.siteName, "Example Notes");
  }
});

test("fallback capture keeps the content root and removes page chrome", async () => {
  const html = await readFixture("fallback-noise.html");
  const dom = createDom(html, "https://example.com/compact");
  const content = dom.window.__clipplaneDom.captureFallback(dom.window.document, dom.window.location.href);

  assert.match(content.markdown, /local notes should stay inspectable/i);
  assert.match(content.markdown, /\[implementation details\]\(https:\/\/example\.com\/details\)/);
  assert.match(content.markdown, /\| State \| Meaning \|/);
  assert.match(content.markdown, /\| Local \| Saved before sync \|/);
  assert.doesNotMatch(content.markdown, /Home Explore|Accept cookies|Subscribe now|hidden draft|display-none|aria-hidden|Related stories|Privacy Terms|Share this/i);
});

test("documentation capture keeps code and removes navigation", async () => {
  const payload = captureFromHtml(await readFixture("documentation.html"), "https://example.com/docs");
  assert.match(payload.contentMarkdown, /Save a local clip/);
  assert.match(payload.contentMarkdown, /```[\s\S]*saveLocal\(capture\)/);
  assert.doesNotMatch(payload.contentMarkdown, /Overview Installation Changelog/);
});

test("table and code pages keep structural content", async () => {
  const payload = captureFromHtml(await readFixture("table-code.html"), "https://example.com/reference");
  assert.match(payload.contentMarkdown, /\| State \| Meaning \|/);
  assert.match(payload.contentMarkdown, /saved_local/);
  assert.match(payload.contentMarkdown, /if \(localSaved\) return capture/);
});

test("dynamic shells keep activity content and remove controls", async () => {
  const payload = captureFromHtml(await readFixture("dynamic-shell.html"), "https://example.com/app");
  assert.match(payload.contentMarkdown, /Release candidate saved/);
  assert.doesNotMatch(payload.contentMarkdown, /Open menu|Projects Settings Account|Subscribe to updates/);
});

test("malformed markup degrades to meaningful safe content", async () => {
  const payload = captureFromHtml(await readFixture("malformed-markup.html"), "https://example.com/broken");
  assert.match(payload.contentMarkdown, /malformed page should still retain meaningful local content/i);
  assert.doesNotMatch(payload.contentMarkdown, /javascript:|Hidden draft/i);
});

test("page capture keeps selected text exact and does not require Readability", () => {
  const dom = createDom("<title>Document</title><p>Choose this precise text.</p>", "https://example.com/document");
  const text = dom.window.document.querySelector("p").firstChild;
  const range = dom.window.document.createRange();
  range.selectNodeContents(text);
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const payload = dom.window.__clipplaneCapture.capture("selection");
  assert.equal(payload.inputType, "selection");
  assert.equal(payload.extractionMethod, "selection");
  assert.equal(payload.contentMarkdown, "Choose this precise text.");
  assert.deepEqual(Object.keys(payload).filter((key) => ["author", "publishedAt", "description", "siteName"].includes(key)).sort(), ["author", "description", "publishedAt", "siteName"]);
});

test("element capture preserves the chosen region and omits unsafe links", () => {
  const dom = createDom(`
    <title>App board</title>
    <section id="card"><h2>Project card</h2><p>Keep this local context.</p><a href="javascript:alert(1)">Unsafe</a><a href="/detail">Details</a></section>
  `, "https://example.com/board");

  const payload = dom.window.__clipplaneCapture.captureElement(dom.window.document.querySelector("#card"));
  assert.equal(payload.inputType, "element");
  assert.equal(payload.extractionMethod, "element");
  assert.match(payload.contentMarkdown, /Keep this local context/);
  assert.match(payload.contentMarkdown, /\[Details\]\(https:\/\/example\.com\/detail\)/);
  assert.doesNotMatch(payload.contentMarkdown, /javascript:/i);
});

test("element capture keeps the highlighted card boundary while removing local controls", async () => {
  const html = await readFixture("element-card.html");
  const dom = createDom(html, "https://example.com/feed");
  const card = dom.window.document.querySelector("#card");
  card.setAttribute("data-clipplane-picker-target", "true");

  assert.equal(dom.window.__clipplaneDom.findElementTarget(card), card);
  const payload = dom.window.__clipplaneCapture.captureElement(card);
  assert.match(payload.contentMarkdown, /selected card keeps its argument/i);
  assert.match(payload.contentMarkdown, /\[Open source\]\(https:\/\/example\.com\/source\)/);
  assert.doesNotMatch(payload.contentMarkdown, /Like|Share this|hidden metadata|unrelated card/i);
});

test("element picker sends only the confirmed payload and removes its temporary style", () => {
  const dom = createDom("<title>App board</title><section id=\"card\"><p>Choose this card as local context.</p></section>", "https://example.com/board");
  const messages = [];
  dom.window.chrome = {
    runtime: {
      sendMessage(message) {
        messages.push(message);
        return Promise.resolve();
      }
    }
  };

  dom.window.__clipplaneCapture.startElementPicker("picker-test");
  assert.equal(dom.window.document.documentElement.getAttribute("data-clipplane-picker-active"), "true");
  assert.match(dom.window.document.querySelector("style").textContent, /Esc to cancel/);
  const card = dom.window.document.querySelector("#card");
  card.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "element_capture_result");
  assert.equal(messages[0].requestId, "picker-test");
  assert.equal(messages[0].payload.inputType, "element");
  assert.equal(dom.window.document.querySelectorAll("style").length, 0);
  assert.equal(dom.window.document.documentElement.hasAttribute("data-clipplane-picker-active"), false);
});

test("capture budget failures return actionable zero-write errors", () => {
  const timedOut = createDom(
    "<main><p>This page has enough content to enter the fallback capture path safely.</p></main>",
    "https://example.com/slow",
    { processingBudgetMs: 0 }
  ).window.__clipplaneCapture.capture("page");
  assert.equal(timedOut.__clipplaneError.code, "capture_timed_out");
  assert.match(timedOut.__clipplaneError.message, /Selection or Element/);

  const tooLarge = createDom(
    "<main><p>This compact page deliberately exceeds a tiny injected test budget.</p></main>",
    "https://example.com/large",
    { payloadBytes: 80 }
  ).window.__clipplaneCapture.capture("page");
  assert.equal(tooLarge.__clipplaneError.code, "capture_too_large");
  assert.match(tooLarge.__clipplaneError.message, /Selection or Element/);
});

function captureFromHtml(html, url) {
  const dom = createDom(html, url);
  return dom.window.__clipplaneCapture.capture("page");
}

function createDom(html, url, captureConfig = null) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url });
  if (captureConfig) {
    dom.window.__clipplaneCaptureConfig = captureConfig;
  }
  dom.window.eval(readabilitySource);
  dom.window.eval(normalizerSource);
  dom.window.eval(captureSource);
  return dom;
}

function readFixture(name) {
  return fs.readFile(path.join(testDir, "fixtures", name), "utf8");
}
