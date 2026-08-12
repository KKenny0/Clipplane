import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyTags,
  cleanCapturedMarkdown,
  clipPayload,
  MAX_CAPTURE_CONTENT_BYTES,
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

test("oversized captures fail before any local file is written", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-oversized-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const payload = {
    sourceUrl: "https://example.com/large",
    title: "Large page",
    contentMarkdown: "x".repeat(MAX_CAPTURE_CONTENT_BYTES + 1)
  };

  await assert.rejects(
    clipPayload(payload, { notesDir, configDir }),
    (error) => error.code === "capture_too_large" && /Selection or Element/.test(error.message)
  );
  assert.deepEqual(await fs.readdir(notesDir), []);
});

test("frontmatter overhead cannot leave a record for a near-limit capture", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-render-limit-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  await assert.rejects(
    clipPayload({ sourceUrl: "https://example.com/near-limit", sourceTitle: "x".repeat(500), contentMarkdown: "x".repeat(MAX_CAPTURE_CONTENT_BYTES - 100) }, { notesDir, configDir }),
    (error) => error.code === "capture_too_large"
  );
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  await assert.rejects(fs.access(capturesPath), (error) => error.code === "ENOENT");
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

  const inbox = await fs.readFile(path.join(notesDir, "inbox.md"), "utf8");
  assert.match(inbox, /^# Inbox/m);
  assert.match(inbox, /## Agent Notes/);
  assert.match(inbox, /- Method: `fallback`/);
  assert.match(inbox, /^# Agent Notes$/m);
  assert.equal(await fileExists(first.capture.content_path), true);

  const captures = await fs.readFile(path.join(notesDir, ".clipplane", "captures.jsonl"), "utf8");
  assert.equal(captures.trim().split(/\r?\n/).length, 1);
  const record = JSON.parse(captures.trim());
  assert.equal(record.schema_version, 3);
  assert.equal("org_heading" in record, false);
  assert.equal("org_timestamp" in record, false);
  assert.equal("local_path" in record, false);
  assert.equal("content_path" in record, false);
  assert.equal("path" in record.sinks.local, false);
  assert.equal(captures.includes(notesDir), false);
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
  const inbox = await fs.readFile(path.join(notesDir, "inbox.md"), "utf8");
  assert.match(inbox, /- Method: `element`/);
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

  const inbox = await fs.readFile(path.join(notesDir, "inbox.md"), "utf8");
  assert.doesNotMatch(inbox, /To view keyboard shortcuts/);
  assert.match(inbox, /^## Article$/m);
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
  const migrated = JSON.parse(captures.trim());
  assert.equal(migrated.schema_version, 3);
  assert.equal("local_path" in migrated, false);
  assert.equal("content_path" in migrated, false);
  assert.equal("path" in migrated.sinks.local, false);
});

test("clipPayload keeps a new record separate from an unterminated invalid line", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-invalid-eof-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const stateDir = path.join(notesDir, ".clipplane");
  const capturesPath = path.join(stateDir, "captures.jsonl");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(capturesPath, "{not json}", "utf8");

  const result = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/invalid-eof",
    sourceTitle: "Invalid EOF",
    title: "Invalid EOF",
    contentMarkdown: "New capture body"
  }, { notesDir, configDir });

  const lines = (await fs.readFile(capturesPath, "utf8")).trim().split(/\r?\n/);
  assert.equal(lines[0], "{not json}");
  assert.equal(JSON.parse(lines[1]).capture_id, result.capture.capture_id);
});

test("re-clipping a future-schema duplicate cannot recreate its missing body", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-future-duplicate-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const payload = {
    inputType: "selection",
    sourceUrl: "https://example.com/future-duplicate",
    sourceTitle: "Future duplicate",
    title: "Future duplicate",
    contentMarkdown: "Future body"
  };
  const first = await clipPayload(payload, { notesDir, configDir });
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  const inboxPath = path.join(notesDir, "inbox.md");
  const futureRecord = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
  futureRecord.schema_version = 4;
  futureRecord.future_state = { preserved: true };
  await fs.writeFile(capturesPath, `${JSON.stringify(futureRecord)}\n`, "utf8");
  await fs.rm(first.capture.content_path);
  const capturesBefore = await fs.readFile(capturesPath, "utf8");
  const inboxBefore = await fs.readFile(inboxPath, "utf8");

  await assert.rejects(
    clipPayload(payload, { notesDir, configDir }),
    (error) => error.code === "unsupported_capture_schema" && /newer Clipplane Host/.test(error.message)
  );

  assert.equal(await fileExists(first.capture.content_path), false);
  assert.equal(await fs.readFile(capturesPath, "utf8"), capturesBefore);
  assert.equal(await fs.readFile(inboxPath, "utf8"), inboxBefore);
});

test("a mixed-schema store is rejected before repairing a portable duplicate", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-mixed-schema-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const future = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/future-record",
    sourceTitle: "Future record",
    title: "Future record",
    contentMarkdown: "Unrelated future body"
  }, { notesDir, configDir });
  const duplicatePayload = {
    inputType: "selection",
    sourceUrl: "https://example.com/portable-duplicate",
    sourceTitle: "Portable duplicate",
    title: "Portable duplicate",
    contentMarkdown: "Portable duplicate body"
  };
  const duplicate = await clipPayload(duplicatePayload, { notesDir, configDir });
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  const inboxPath = path.join(notesDir, "inbox.md");
  const records = (await fs.readFile(capturesPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  records.find((record) => record.capture_id === future.capture.capture_id).schema_version = 4;
  await fs.writeFile(capturesPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  await fs.rm(duplicate.capture.content_path);
  const capturesBefore = await fs.readFile(capturesPath, "utf8");
  const inboxBefore = await fs.readFile(inboxPath, "utf8");
  const futureBodyBefore = await fs.readFile(future.capture.content_path, "utf8");

  await assert.rejects(
    clipPayload(duplicatePayload, { notesDir, configDir }),
    (error) => error.code === "unsupported_capture_schema"
  );

  assert.equal(await fileExists(duplicate.capture.content_path), false);
  assert.equal(await fs.readFile(capturesPath, "utf8"), capturesBefore);
  assert.equal(await fs.readFile(inboxPath, "utf8"), inboxBefore);
  assert.equal(await fs.readFile(future.capture.content_path, "utf8"), futureBodyBefore);
});

test("new captures use a timestamp plus a full random UUID", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-random-id-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const result = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/random-id",
    sourceTitle: "Random ID",
    title: "Random ID",
    contentMarkdown: "Random ID body"
  }, { notesDir, configDir });

  assert.match(result.capture.capture_id, /^\d{8}T\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("re-clipping refuses an unfinished processing or deleting operation", async () => {
  for (const lifecycleStatus of ["processing", "deleting"]) {
    const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), `clipplane-pending-${lifecycleStatus}-`));
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
    const payload = {
      inputType: "selection",
      sourceUrl: `https://example.com/pending-${lifecycleStatus}`,
      sourceTitle: "Pending",
      title: "Pending",
      contentMarkdown: "Pending body"
    };
    const first = await clipPayload(payload, { notesDir, configDir });
    const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
    const record = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
    record.lifecycle_status = lifecycleStatus;
    record.lifecycle_started_at = new Date().toISOString();
    await fs.writeFile(capturesPath, `${JSON.stringify(record)}\n`, "utf8");

    await assert.rejects(
      clipPayload(payload, { notesDir, configDir }),
      (error) => error.code === "capture_lifecycle_pending"
    );
    assert.equal(await fileExists(first.capture.content_path), true);
  }
});

test("a failed creating recovery cannot be reported as a successful duplicate", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-creating-failure-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const payload = {
    inputType: "selection",
    sourceUrl: "https://example.com/creating-failure",
    sourceTitle: "Creating failure",
    title: "Creating failure",
    contentMarkdown: "Creating failure body"
  };
  await clipPayload(payload, { notesDir, configDir });
  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  const record = JSON.parse((await fs.readFile(capturesPath, "utf8")).trim());
  record.lifecycle_status = "creating";
  record.lifecycle_started_at = new Date().toISOString();
  await fs.writeFile(capturesPath, `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`, "utf8");

  await assert.rejects(
    clipPayload(payload, { notesDir, configDir }),
    (error) => error.code === "lifecycle_recovery_failed"
  );
});

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
