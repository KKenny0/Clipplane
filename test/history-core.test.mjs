import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clipPayload } from "../native-host/clip-core.mjs";
import { listCaptureHistory, openCaptureBody } from "../native-host/history-core.mjs";

test("listCaptureHistory returns recent captures with warnings for bad jsonl lines", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));

  const first = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/one",
    sourceTitle: "One",
    title: "First",
    contentMarkdown: "First body"
  }, { notesDir, configDir });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const second = await clipPayload({
    inputType: "page",
    sourceUrl: "https://news.example/two",
    sourceTitle: "Two",
    title: "Second",
    contentMarkdown: "Second body"
  }, { notesDir, configDir });

  await fs.appendFile(
    path.join(notesDir, ".clipplane", "captures.jsonl"),
    "{not json}\n",
    "utf8"
  );

  const response = await listCaptureHistory({ notesDir, configDir, limit: 1 });

  assert.equal(response.ok, true);
  assert.equal(response.history.items.length, 1);
  assert.equal(response.history.items[0].capture_id, second.capture.capture_id);
  assert.equal(response.history.items[0].source_host, "news.example");
  assert.equal(response.history.items[0].content_exists, true);
  assert.equal(response.history.items[0].body_state, "available");
  assert.equal(response.history.items[0].preview, "");
  assert.equal(response.history.items[0].content_path.includes(notesDir), true);
  assert.deepEqual(response.history.warnings, [{ line: 3, code: "invalid_json" }]);
  assert.notEqual(first.capture.capture_id, second.capture.capture_id);
});

test("listCaptureHistory marks missing capture bodies without failing", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-missing-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/missing",
    sourceTitle: "Missing",
    title: "Missing body",
    contentMarkdown: "Body"
  }, { notesDir, configDir });

  await fs.rm(clip.capture.content_path);

  const response = await listCaptureHistory({ notesDir, configDir });

  assert.equal(response.history.items.length, 1);
  assert.equal(response.history.items[0].content_exists, false);
  assert.equal(response.history.items[0].body_state, "missing");
  assert.equal(response.history.items[0].preview, "");
});

test("listCaptureHistory returns a bounded preview for selection bodies", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-preview-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const body = `Selected text\n\n${"x".repeat(800)}`;
  await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/preview",
    sourceTitle: "Preview",
    title: "Selection preview",
    contentMarkdown: body
  }, { notesDir, configDir });

  const response = await listCaptureHistory({ notesDir, configDir });
  const item = response.history.items[0];

  assert.equal(item.input_type, "selection");
  assert.equal(item.body_state, "available");
  assert.equal(item.preview.length, 500);
  assert.match(item.preview, /^Selected text\n\nx+/);
});

test("listCaptureHistory exposes selected-area metadata and a bounded preview", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-element-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  await clipPayload({
    inputType: "element",
    extractionMethod: "element",
    sourceUrl: "https://example.com/card",
    sourceTitle: "Card feed",
    title: "Card",
    contentMarkdown: `Selected area\n\n${"x".repeat(800)}`
  }, { notesDir, configDir });

  const response = await listCaptureHistory({ notesDir, configDir });
  const item = response.history.items[0];

  assert.equal(item.input_type, "element");
  assert.equal(item.extraction_method, "element");
  assert.equal(item.preview.length, 500);
});

test("listCaptureHistory marks unsafe body paths without exposing them", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-unsafe-list-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/unsafe-list",
    sourceTitle: "Unsafe list",
    title: "Unsafe list body",
    contentMarkdown: "Body"
  }, { notesDir, configDir });

  const unsafe = {
    ...clip.capture,
    content_path: path.join(os.tmpdir(), "outside-clipplane-list.md")
  };
  await fs.writeFile(
    path.join(notesDir, ".clipplane", "captures.jsonl"),
    `${JSON.stringify(unsafe)}\n`,
    "utf8"
  );

  const response = await listCaptureHistory({ notesDir, configDir });
  const item = response.history.items[0];

  assert.equal(item.content_exists, false);
  assert.equal(item.body_state, "unsafe");
  assert.equal(item.content_path, "");
  assert.equal(item.preview, "");
});

test("openCaptureBody opens only capture files inside notes dir", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-open-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const opened = [];
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/open",
    sourceTitle: "Open",
    title: "Open body",
    contentMarkdown: "Body"
  }, { notesDir, configDir });

  const response = await openCaptureBody(clip.capture.capture_id, {
    notesDir,
    configDir,
    openFolderImpl: async (targetPath) => opened.push(targetPath)
  });

  assert.equal(response.ok, true);
  assert.equal(response.capture_id, clip.capture.capture_id);
  assert.deepEqual(opened, [clip.capture.content_path]);
});

test("openCaptureBody rejects stale records pointing outside the capture body directory", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-unsafe-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/unsafe",
    sourceTitle: "Unsafe",
    title: "Unsafe body",
    contentMarkdown: "Body"
  }, { notesDir, configDir });

  const unsafe = {
    ...clip.capture,
    content_path: path.join(os.tmpdir(), "outside-clipplane.md")
  };
  await fs.writeFile(
    path.join(notesDir, ".clipplane", "captures.jsonl"),
    `${JSON.stringify(unsafe)}\n`,
    "utf8"
  );

  await assert.rejects(
    () => openCaptureBody(clip.capture.capture_id, { notesDir, configDir, openFolderImpl: async () => {} }),
    /outside the Clipplane notes folder/
  );
});
