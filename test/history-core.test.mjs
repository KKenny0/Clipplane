import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clipPayload, MAX_CAPTURE_CONTENT_BYTES } from "../native-host/clip-core.mjs";
import {
  copyCapture,
  deleteCapture,
  listCaptureHistory,
  markCaptureProcessed,
  openCaptureBody
} from "../native-host/history-core.mjs";
import { syncCapture } from "../native-host/sync-core.mjs";

test("reading empty history does not create capture state", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-empty-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));

  const response = await listCaptureHistory({ notesDir, configDir });

  assert.deepEqual(response.history.items, []);
  assert.deepEqual(await fs.readdir(notesDir), []);
});

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

test("listCaptureHistory ignores a stale device path and resolves the managed body", async () => {
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

  assert.equal(item.content_exists, true);
  assert.equal(item.body_state, "available");
  assert.equal(item.content_path, clip.capture.content_path);
  assert.equal(item.preview, "Body");
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
    openFileImpl: async (targetPath) => opened.push(targetPath)
  });

  assert.equal(response.ok, true);
  assert.equal(response.capture_id, clip.capture.capture_id);
  assert.deepEqual(opened, [clip.capture.content_path]);
});

test("copyCapture writes a paste-ready Agent reference with the current managed path", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-copy-agent-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const copied = [];
  const clip = await clipPayload({
    inputType: "page",
    sourceUrl: "https://example.com/agent-source",
    sourceTitle: "Agent source",
    title: "Agent-ready capture",
    contentMarkdown: "Agent body"
  }, { notesDir, configDir });

  const response = await copyCapture(clip.capture.capture_id, "agent-reference", {
    notesDir,
    configDir,
    writeClipboardImpl: async (text) => copied.push(text)
  });

  assert.equal(response.ok, true);
  assert.equal(response.capture_id, clip.capture.capture_id);
  assert.equal(response.copy_mode, "agent-reference");
  assert.equal(response.byte_length, Buffer.byteLength(copied[0], "utf8"));
  assert.match(response.copied_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal("path" in response, false);
  assert.equal("text" in response, false);
  assert.equal(copied[0], [
    "Use this Clipplane capture as source material.",
    "",
    "Title: Agent-ready capture",
    "Source: https://example.com/agent-source",
    `Local Markdown file: ${clip.capture.content_path}`
  ].join("\n"));
});

test("copyCapture re-sanitizes legacy source URLs before Agent export", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-copy-secret-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const copied = [];
  const clip = await clipPayload({
    inputType: "page",
    sourceUrl: "https://example.com/reset?id=42",
    sourceTitle: "Reset",
    title: "Legacy secret",
    contentMarkdown: "Body"
  }, { notesDir, configDir });
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  const legacy = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
  legacy.source_url = "https://example.com/reset?id=42&password=hunter2&jwt=eySecret";
  await fs.writeFile(capturesPath, `${JSON.stringify(legacy)}\n`, "utf8");

  await copyCapture(clip.capture.capture_id, "agent-reference", {
    notesDir,
    configDir,
    writeClipboardImpl: async (text) => copied.push(text)
  });

  assert.match(copied[0], /id=42/);
  assert.match(copied[0], /password=%5Bredacted%5D/);
  assert.match(copied[0], /jwt=%5Bredacted%5D/);
  assert.doesNotMatch(copied[0], /hunter2|eySecret/);
});

test("copyCapture copies exact Markdown from processed captures", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-copy-content-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const body = "# 标题\n\nExact **Markdown** body.";
  const copied = [];
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/content",
    sourceTitle: "Content",
    title: "Copy content",
    contentMarkdown: body
  }, { notesDir, configDir });
  await markCaptureProcessed(clip.capture.capture_id, { notesDir, configDir });

  const response = await copyCapture(clip.capture.capture_id, "content", {
    notesDir,
    configDir,
    writeClipboardImpl: async (text) => copied.push(text)
  });

  assert.equal(response.copy_mode, "content");
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^---\nclipplane_body_format: 1/m);
  assert.match(copied[0], /# 标题\n\nExact \*\*Markdown\*\* body\./);
});

test("copyCapture rejects unsupported copy formats", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-copy-mode-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/mode",
    sourceTitle: "Mode",
    title: "Mode",
    contentMarkdown: "Body"
  }, { notesDir, configDir });

  await assert.rejects(
    copyCapture(clip.capture.capture_id, "html", { notesDir, configDir }),
    (error) => error.code === "invalid_copy_mode"
  );
});

test("copyCapture refuses a managed body that grew beyond the capture limit", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-copy-large-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/large",
    sourceTitle: "Large",
    title: "Large",
    contentMarkdown: "Body"
  }, { notesDir, configDir });
  await fs.writeFile(clip.capture.content_path, "x".repeat(MAX_CAPTURE_CONTENT_BYTES + 1), "utf8");

  await assert.rejects(
    copyCapture(clip.capture.capture_id, "content", {
      notesDir,
      configDir,
      writeClipboardImpl: async () => {}
    }),
    (error) => error.code === "capture_too_large"
  );
});

test("openCaptureBody ignores stale records pointing outside the capture body directory", async () => {
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

  const opened = [];
  await openCaptureBody(clip.capture.capture_id, {
    notesDir,
    configDir,
    openFileImpl: async (targetPath) => opened.push(targetPath)
  });
  assert.deepEqual(opened, [clip.capture.content_path]);
});

test("managed body symlinks cannot be previewed, opened, or synced", { skip: process.platform === "win32" }, async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-body-symlink-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-body-outside-"));
  const outsideBody = path.join(outsideDir, "private.md");
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/body-symlink",
    sourceTitle: "Body symlink",
    title: "Body symlink",
    contentMarkdown: "Original body"
  }, { notesDir, configDir });
  await fs.writeFile(outsideBody, "PRIVATE OUTSIDE CONTENT", "utf8");
  await fs.rm(clip.capture.content_path);
  await fs.symlink(outsideBody, clip.capture.content_path);

  const history = await listCaptureHistory({ notesDir, configDir });
  assert.equal(history.history.items[0].body_state, "unsafe");
  assert.equal(history.history.items[0].preview, "");
  await assert.rejects(
    openCaptureBody(clip.capture.capture_id, { notesDir, configDir, openFileImpl: async () => {} }),
    /symbolic link/
  );
  await assert.rejects(
    copyCapture(clip.capture.capture_id, "content", {
      notesDir,
      configDir,
      writeClipboardImpl: async () => {}
    }),
    /symbolic link/
  );
  await assert.rejects(
    syncCapture(clip.capture.capture_id, { notesDir, configDir, sinks: ["local-export"] }),
    /symbolic link/
  );
  assert.equal(await fs.readFile(outsideBody, "utf8"), "PRIVATE OUTSIDE CONTENT");
});

test("legacy absolute paths remain portable across storage roots", async () => {
  const sourceNotesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-portable-source-"));
  const sourceConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const destinationParent = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-portable-destination-"));
  const destinationNotesDir = path.join(destinationParent, "notes");
  const destinationConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const opened = [];
  const copied = [];

  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/portable",
    sourceTitle: "Portable",
    title: "Portable capture",
    contentMarkdown: "Portable body"
  }, { notesDir: sourceNotesDir, configDir: sourceConfigDir });
  const sourceSync = await syncCapture(clip.capture.capture_id, {
    notesDir: sourceNotesDir,
    configDir: sourceConfigDir,
    sinks: ["local-export"]
  });
  const capturesPath = path.join(sourceNotesDir, ".clipplane", "captures.jsonl");
  const legacy = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
  delete legacy.schema_version;
  legacy.local_path = "C:\\Users\\Alice\\Documents\\notes\\inbox.org";
  legacy.content_path = `C:\\Users\\Alice\\Documents\\notes\\.clipplane\\captures\\${clip.capture.capture_id}.md`;
  legacy.sinks.local.path = legacy.local_path;
  legacy.sinks["local-export"].path = `C:\\Users\\Alice\\Documents\\notes\\.clipplane\\sinks\\local-export\\${clip.capture.capture_id}.json`;
  await fs.writeFile(capturesPath, `${JSON.stringify(legacy)}\n{not json}\n`, "utf8");
  await fs.cp(sourceNotesDir, destinationNotesDir, { recursive: true });

  const history = await listCaptureHistory({ notesDir: destinationNotesDir, configDir: destinationConfigDir });
  const destinationBody = path.join(
    destinationNotesDir,
    ".clipplane",
    "captures",
    `${clip.capture.capture_id}.md`
  );
  assert.equal(history.history.items[0].body_state, "available");
  assert.equal(history.history.items[0].content_path, destinationBody);

  await openCaptureBody(clip.capture.capture_id, {
    notesDir: destinationNotesDir,
    configDir: destinationConfigDir,
    openFileImpl: async (targetPath) => opened.push(targetPath)
  });
  await copyCapture(clip.capture.capture_id, "agent-reference", {
    notesDir: destinationNotesDir,
    configDir: destinationConfigDir,
    writeClipboardImpl: async (text) => copied.push(text)
  });
  const destinationSync = await syncCapture(clip.capture.capture_id, {
    notesDir: destinationNotesDir,
    configDir: destinationConfigDir,
    sinks: ["local-export"]
  });
  assert.deepEqual(opened, [destinationBody]);
  assert.match(copied[0], new RegExp(escapeRegExp(destinationBody)));
  assert.equal(copied[0].includes(sourceNotesDir), false);
  assert.equal(destinationSync.capture.sinks["local-export"].path.startsWith(destinationNotesDir), true);

  const migrated = await fs.readFile(path.join(destinationNotesDir, ".clipplane", "captures.jsonl"), "utf8");
  assert.equal(migrated.includes(sourceNotesDir), false);
  assert.equal(migrated.includes(destinationNotesDir), false);
  assert.equal(migrated.includes("C:\\Users\\Alice"), false);
  assert.match(migrated, /"schema_version":3/);
  assert.match(migrated, /\{not json\}/);

  await deleteCapture(clip.capture.capture_id, { notesDir: destinationNotesDir, configDir: destinationConfigDir });
  assert.equal(await fileExists(destinationBody), false);
  assert.equal(await fileExists(clip.capture.content_path), true);
  assert.equal(await fileExists(sourceSync.capture.sinks["local-export"].path), true);
});

test("markCaptureProcessed removes one complete Markdown capture and keeps internal history", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-process-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const first = await clipPayload({
    inputType: "page",
    sourceUrl: "https://example.com/process",
    sourceTitle: "Process",
    title: "Processed clip",
    contentMarkdown: "# Nested heading\n\nProcessed body"
  }, { notesDir, configDir });
  const second = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/keep",
    sourceTitle: "Keep",
    title: "Active clip",
    contentMarkdown: "Keep this body"
  }, { notesDir, configDir });

  const result = await markCaptureProcessed(first.capture.capture_id, { notesDir, configDir });

  assert.equal(result.lifecycle_status, "processed");
  assert.equal(await fileExists(first.capture.content_path), true);
  const inbox = await fs.readFile(path.join(notesDir, "inbox.md"), "utf8");
  assert.doesNotMatch(inbox, new RegExp(first.capture.capture_id));
  assert.doesNotMatch(inbox, /Processed body/);
  assert.match(inbox, new RegExp(second.capture.capture_id));
  assert.match(inbox, /Keep this body/);

  const active = await listCaptureHistory({ notesDir, configDir, lifecycle: "active" });
  const processed = await listCaptureHistory({ notesDir, configDir, lifecycle: "processed" });
  assert.deepEqual(active.history.items.map((item) => item.capture_id), [second.capture.capture_id]);
  assert.deepEqual(processed.history.items.map((item) => item.capture_id), [first.capture.capture_id]);
  assert.equal(processed.history.items[0].inbox_state, "missing");
  assert.ok(processed.history.items[0].processed_at);
});

test("markCaptureProcessed finishes cleanup when the user already removed the inbox entry", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-reconcile-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/reconcile",
    sourceTitle: "Reconcile",
    title: "Already removed",
    contentMarkdown: "Body"
  }, { notesDir, configDir });
  await fs.writeFile(path.join(notesDir, "inbox.md"), "# Inbox\n", "utf8");

  const before = await listCaptureHistory({ notesDir, configDir });
  assert.equal(before.history.items[0].inbox_state, "missing");

  await markCaptureProcessed(clip.capture.capture_id, { notesDir, configDir });
  const processed = await listCaptureHistory({ notesDir, configDir, lifecycle: "processed" });
  assert.equal(processed.history.items[0].capture_id, clip.capture.capture_id);
});

test("deleteCapture removes inbox entry, capture record, and source snapshot", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-delete-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const deleted = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/delete",
    sourceTitle: "Delete",
    title: "Delete me",
    contentMarkdown: "Delete body"
  }, { notesDir, configDir });
  const kept = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/keep-delete-test",
    sourceTitle: "Keep",
    title: "Keep me",
    contentMarkdown: "Keep body"
  }, { notesDir, configDir });

  const result = await deleteCapture(deleted.capture.capture_id, { notesDir, configDir });

  assert.equal(result.lifecycle_status, "deleted");
  assert.equal(result.remote_copies_affected, false);
  assert.equal(await fileExists(deleted.capture.content_path), false);
  assert.equal(await fileExists(kept.capture.content_path), true);
  const inbox = await fs.readFile(path.join(notesDir, "inbox.md"), "utf8");
  const captures = await fs.readFile(path.join(notesDir, ".clipplane", "captures.jsonl"), "utf8");
  assert.doesNotMatch(inbox, new RegExp(deleted.capture.capture_id));
  assert.match(inbox, new RegExp(kept.capture.capture_id));
  assert.doesNotMatch(captures, new RegExp(deleted.capture.capture_id));
  assert.match(captures, new RegExp(kept.capture.capture_id));
});

test("deleteCapture also permanently removes a processed capture", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-delete-processed-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/delete-processed",
    sourceTitle: "Delete processed",
    title: "Processed",
    contentMarkdown: "Body"
  }, { notesDir, configDir });
  await markCaptureProcessed(clip.capture.capture_id, { notesDir, configDir });

  await deleteCapture(clip.capture.capture_id, { notesDir, configDir });

  assert.equal(await fileExists(clip.capture.content_path), false);
  const history = await listCaptureHistory({ notesDir, configDir, lifecycle: "all" });
  assert.equal(history.history.items.length, 0);
});

test("lifecycle operations reject duplicate inbox IDs without deleting content", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-duplicate-inbox-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/duplicate-inbox",
    sourceTitle: "Duplicate",
    title: "Duplicate",
    contentMarkdown: "Body"
  }, { notesDir, configDir });
  const inboxPath = path.join(notesDir, "inbox.md");
  await fs.appendFile(inboxPath, `\n<!-- clipplane:capture:start id="${clip.capture.capture_id}" -->\n## Duplicate copy\n\nBody\n<!-- clipplane:capture:end id="${clip.capture.capture_id}" -->\n`, "utf8");

  await assert.rejects(
    () => deleteCapture(clip.capture.capture_id, { notesDir, configDir }),
    /Multiple inbox entries/
  );

  assert.equal(await fileExists(clip.capture.content_path), true);
  const inbox = await fs.readFile(inboxPath, "utf8");
  assert.equal(inbox.match(new RegExp(clip.capture.capture_id, "g")).length, 4);
});

test("history resumes a processing operation left by an interrupted host", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-recovery-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/recovery",
    sourceTitle: "Recovery",
    title: "Recovery",
    contentMarkdown: "Body"
  }, { notesDir, configDir });
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  const record = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
  record.lifecycle_status = "processing";
  record.lifecycle_started_at = new Date().toISOString();
  await fs.writeFile(capturesPath, `${JSON.stringify(record)}\n`, "utf8");

  const active = await listCaptureHistory({ notesDir, configDir, lifecycle: "active" });
  const processed = await listCaptureHistory({ notesDir, configDir, lifecycle: "processed" });

  assert.equal(active.history.items.length, 0);
  assert.equal(processed.history.items[0].capture_id, clip.capture.capture_id);
  assert.doesNotMatch(await fs.readFile(path.join(notesDir, "inbox.md"), "utf8"), new RegExp(clip.capture.capture_id));
});

test("history leaves future-schema lifecycle records and managed files unchanged", async () => {
  for (const lifecycleStatus of ["processing", "deleting"]) {
    const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), `clipplane-future-${lifecycleStatus}-`));
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
    const clip = await clipPayload({
      inputType: "selection",
      sourceUrl: `https://example.com/future-${lifecycleStatus}`,
      sourceTitle: `Future ${lifecycleStatus}`,
      title: `Future ${lifecycleStatus}`,
      contentMarkdown: `Future ${lifecycleStatus} body`
    }, { notesDir, configDir });
    const sync = await syncCapture(clip.capture.capture_id, {
      notesDir,
      configDir,
      sinks: ["local-export"]
    });
    const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
    const inboxPath = path.join(notesDir, "inbox.md");
    const record = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
    record.schema_version = 4;
    record.lifecycle_status = lifecycleStatus;
    record.lifecycle_started_at = new Date().toISOString();
    record.future_state = { preserved: true };
    await fs.writeFile(capturesPath, `${JSON.stringify(record)}\n`, "utf8");

    const before = {
      captures: await fs.readFile(capturesPath, "utf8"),
      inbox: await fs.readFile(inboxPath, "utf8"),
      body: await fs.readFile(clip.capture.content_path, "utf8"),
      localExport: await fs.readFile(sync.capture.sinks["local-export"].path, "utf8")
    };

    const history = await listCaptureHistory({ notesDir, configDir, lifecycle: "all" });

    assert.equal(history.history.items[0].capture_id, clip.capture.capture_id);
    assert.deepEqual(history.history.warnings, [{
      capture_id: clip.capture.capture_id,
      code: "lifecycle_recovery_failed"
    }]);
    assert.equal(await fs.readFile(capturesPath, "utf8"), before.captures);
    assert.equal(await fs.readFile(inboxPath, "utf8"), before.inbox);
    assert.equal(await fs.readFile(clip.capture.content_path, "utf8"), before.body);
    assert.equal(
      await fs.readFile(sync.capture.sinks["local-export"].path, "utf8"),
      before.localExport
    );
  }
});

test("re-clipping processed content reactivates the existing capture", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-reactivate-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const payload = {
    inputType: "selection",
    sourceUrl: "https://example.com/reactivate",
    sourceTitle: "Reactivate",
    title: "Reactivate",
    contentMarkdown: "Same body"
  };
  const first = await clipPayload(payload, { notesDir, configDir });
  await markCaptureProcessed(first.capture.capture_id, { notesDir, configDir });

  const second = await clipPayload(payload, { notesDir, configDir });
  const active = await listCaptureHistory({ notesDir, configDir, lifecycle: "active" });
  const processed = await listCaptureHistory({ notesDir, configDir, lifecycle: "processed" });
  const inbox = await fs.readFile(path.join(notesDir, "inbox.md"), "utf8");

  assert.equal(second.duplicate, true);
  assert.equal(second.reactivated, true);
  assert.deepEqual(active.history.items.map((item) => item.capture_id), [first.capture.capture_id]);
  assert.equal(processed.history.items.length, 0);
  assert.equal(inbox.match(new RegExp(first.capture.capture_id, "g")).length, 2);
});

test("history finishes a reactivation interrupted after its journal record", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-reactivation-recovery-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/reactivation-recovery",
    sourceTitle: "Reactivation recovery",
    title: "Reactivation recovery",
    contentMarkdown: "Recovered reactivation body"
  }, { notesDir, configDir });
  await markCaptureProcessed(clip.capture.capture_id, { notesDir, configDir });
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  const record = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
  record.lifecycle_status = "reactivating";
  record.lifecycle_started_at = new Date().toISOString();
  await fs.writeFile(capturesPath, `${JSON.stringify(record)}\n`, "utf8");

  const active = await listCaptureHistory({ notesDir, configDir, lifecycle: "active" });
  const recovered = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());

  assert.deepEqual(active.history.items.map((item) => item.capture_id), [clip.capture.capture_id]);
  assert.equal("lifecycle_status" in recovered, false);
  assert.match(await fs.readFile(path.join(notesDir, "inbox.md"), "utf8"), /Recovered reactivation body/);
});

test("deleteCapture removes a Clipplane-managed local export", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-delete-export-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/delete-export",
    sourceTitle: "Delete export",
    title: "Delete export",
    contentMarkdown: "Exported body"
  }, { notesDir, configDir });
  const sync = await syncCapture(clip.capture.capture_id, { notesDir, configDir, sinks: ["local-export"] });
  const exportPath = sync.capture.sinks["local-export"].path;
  assert.equal(await fileExists(exportPath), true);

  await deleteCapture(clip.capture.capture_id, { notesDir, configDir });

  assert.equal(await fileExists(exportPath), false);
});

test("deleteCapture rejects a capture directory that resolves outside the notes folder", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-symlink-notes-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-symlink-outside-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/symlink",
    sourceTitle: "Symlink",
    title: "Symlink",
    contentMarkdown: "Protected body"
  }, { notesDir, configDir });
  const bodiesDir = path.join(notesDir, ".clipplane", "captures");
  const outsideBody = path.join(outsideDir, path.basename(clip.capture.content_path));
  await fs.writeFile(outsideBody, "outside body", "utf8");
  await fs.rm(bodiesDir, { recursive: true });
  await fs.symlink(outsideDir, bodiesDir, process.platform === "win32" ? "junction" : "dir");

  await assert.rejects(
    () => deleteCapture(clip.capture.capture_id, { notesDir, configDir }),
    /resolves outside/
  );

  assert.equal(await fs.readFile(outsideBody, "utf8"), "outside body");
});

test("lifecycle rewrites preserve restrictive file modes", { skip: process.platform === "win32" }, async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-history-mode-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/mode",
    sourceTitle: "Mode",
    title: "Mode",
    contentMarkdown: "Body"
  }, { notesDir, configDir });
  const inboxPath = path.join(notesDir, "inbox.md");
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  await fs.chmod(inboxPath, 0o600);
  await fs.chmod(capturesPath, 0o600);

  await markCaptureProcessed(clip.capture.capture_id, { notesDir, configDir });

  assert.equal((await fs.stat(inboxPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(capturesPath)).mode & 0o777, 0o600);
});

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
