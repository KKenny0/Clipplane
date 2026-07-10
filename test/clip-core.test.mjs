import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyTags,
  cleanCapturedMarkdown,
  clipPayload,
  markdownToOrg,
  normalizePayload
} from "../native-host/clip-core.mjs";

test("normalizePayload rejects empty content", () => {
  assert.throws(() => normalizePayload({ contentMarkdown: "" }), /Nothing to clip/);
});

test("normalizePayload preserves an explicit element capture method", () => {
  const payload = normalizePayload({
    inputType: "element",
    extractionMethod: "element",
    sourceUrl: "https://example.com/card",
    contentMarkdown: "A selected card."
  });

  assert.equal(payload.inputType, "element");
  assert.equal(payload.extractionMethod, "element");
});

test("markdownToOrg converts headings, links, bold, and code fences", () => {
  const org = markdownToOrg("# Title\n\nSee [site](https://example.com).\n\n**Bold**\n\n```js\nconsole.log(1)\n```");
  assert.match(org, /^\*\* Title/m);
  assert.match(org, /\[\[https:\/\/example\.com\]\[site\]\]/);
  assert.match(org, /\*Bold\*/);
  assert.match(org, /#\+begin_src js/);
  assert.match(org, /#\+end_src/);
});

test("classifyTags returns at most two content tags", () => {
  assert.deepEqual(classifyTags("AI agent code API startup design"), ["ai", "tech"]);
});

test("cleanCapturedMarkdown removes page keyboard shortcut boilerplate", () => {
  const markdown = [
    "## To view keyboard shortcuts, press question markView keyboard shortcuts",
    "",
    "## Article",
    "",
    "Actual article body."
  ].join("\n");

  assert.equal(cleanCapturedMarkdown(markdown), "## Article\n\nActual article body.");
});

test("clipPayload writes inbox and skips duplicates", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-test-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const payload = {
    inputType: "page",
    sourceUrl: "https://example.com/post#section",
    sourceTitle: "Agent Notes",
    title: "Agent Notes",
    contentMarkdown: "# Agent Notes\n\nAI agent article body."
  };

  const first = await clipPayload(payload, { notesDir, configDir });
  const second = await clipPayload(payload, { notesDir, configDir });

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.capture.content_hash, first.capture.content_hash);

  const inbox = await fs.readFile(path.join(notesDir, "inbox.org"), "utf8");
  assert.match(inbox, /\* Agent Notes :ai:/);
  assert.match(inbox, /:STATUS: inbox/);
  assert.match(inbox, /:CAPTURE_METHOD: fallback/);
  assert.match(inbox, /\*\* Agent Notes/);
  assert.equal(await fileExists(first.capture.content_path), true);

  const captures = await fs.readFile(path.join(notesDir, ".clipplane", "captures.jsonl"), "utf8");
  assert.equal(captures.trim().split(/\r?\n/).length, 1);
});

test("clipPayload records capture methods for selected areas", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-element-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const result = await clipPayload({
    inputType: "element",
    extractionMethod: "element",
    sourceUrl: "https://example.com/card",
    sourceTitle: "Card feed",
    title: "A selected card",
    contentMarkdown: "A selected card with useful context."
  }, { notesDir, configDir });

  assert.equal(result.capture.input_type, "element");
  assert.equal(result.capture.extraction_method, "element");
  const inbox = await fs.readFile(path.join(notesDir, "inbox.org"), "utf8");
  assert.match(inbox, /:CAPTURE_METHOD: element/);
});

test("clipPayload does not write keyboard shortcut boilerplate into inbox", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-boilerplate-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const payload = {
    inputType: "page",
    sourceUrl: "https://x.com/example/status/1",
    sourceTitle: "Example on X",
    title: "Example on X",
    contentMarkdown: [
      "## To view keyboard shortcuts, press question markView keyboard shortcuts",
      "",
      "## Article",
      "",
      "Actual article body."
    ].join("\n")
  };

  await clipPayload(payload, { notesDir, configDir });

  const inbox = await fs.readFile(path.join(notesDir, "inbox.org"), "utf8");
  assert.doesNotMatch(inbox, /To view keyboard shortcuts/);
  assert.match(inbox, /\*\*\* Article/);
  assert.match(inbox, /Actual article body\./);
});

test("clipPayload backfills capture body for legacy duplicates", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-legacy-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const payload = {
    inputType: "selection",
    sourceUrl: "https://example.com/legacy",
    sourceTitle: "Legacy Clip",
    title: "Legacy Clip",
    contentMarkdown: "Legacy body"
  };

  const first = await clipPayload(payload, { notesDir, configDir });
  const legacy = { ...first.capture };
  delete legacy.content_path;
  await fs.rm(first.capture.content_path);
  await fs.writeFile(
    path.join(notesDir, ".clipplane", "captures.jsonl"),
    `${JSON.stringify(legacy)}\n`,
    "utf8"
  );

  const second = await clipPayload(payload, { notesDir, configDir });

  assert.equal(second.duplicate, true);
  assert.equal(await fileExists(second.capture.content_path), true);
  const captures = await fs.readFile(path.join(notesDir, ".clipplane", "captures.jsonl"), "utf8");
  assert.match(captures, /"content_path":/);
});

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
