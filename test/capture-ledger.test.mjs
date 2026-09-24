import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_CAPTURE_CONTENT_BYTES, openCaptureLedger, recoverPendingCaptures } from "../native-host/capture-ledger.mjs";
import { writeNewCaptureBody } from "../native-host/capture-record.mjs";
import { appendCaptureRecord, readCaptureStore } from "../native-host/capture-store.mjs";
import { appendMarkdownInboxEntry, readMarkdownInboxIds } from "../native-host/inbox-markdown.mjs";
import { prepareCaptureStorage } from "../native-host/inbox-migration.mjs";
import { getDefaultPaths } from "../native-host/paths.mjs";

test("the ledger factory resolves paths and reports a clean recovery", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-open-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  await prepareCaptureStorage(getDefaultPaths(notesDir, { configDir }), { create: true });

  const ledger = await openCaptureLedger({ notesDir, configDir });

  assert.equal(ledger.paths.inboxPath, path.join(notesDir, "inbox.md"));
  assert.ok(ledger.config);
  assert.deepEqual(await ledger.recoverPending(), []);
});

test("creating records recover from a body or disappear when no body was written", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-create-recovery-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const recoverable = { ...sampleCapture("recoverable"), lifecycle_status: "creating", lifecycle_started_at: new Date().toISOString() };
  const empty = { ...sampleCapture("empty"), lifecycle_status: "creating", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, recoverable);
  await appendCaptureRecord(paths.capturesPath, empty);
  await writeNewCaptureBody(paths, recoverable.capture_id, "Recover this body");

  const warnings = await recoverPendingCaptures(paths);

  assert.deepEqual(warnings, []);
  const records = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.deepEqual(records.map((record) => record.capture_id), [recoverable.capture_id]);
  assert.equal("lifecycle_status" in records[0], false);
  assert.match(await fs.readFile(paths.inboxPath, "utf8"), /Recover this body/);
});

test("reactivating records return to active with their inbox entry restored", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-reactivate-recovery-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = {
    ...sampleCapture("back-again"),
    lifecycle_status: "reactivating",
    lifecycle_started_at: new Date().toISOString(),
    processed_at: "2026-08-01T00:00:00.000Z"
  };
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Still here");

  const warnings = await recoverPendingCaptures(paths);

  assert.deepEqual(warnings, []);
  const [record] = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.equal("lifecycle_status" in record, false);
  assert.equal("processed_at" in record, false);
  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).get(capture.capture_id), 1);
});

test("processing records finish as processed and leave the inbox", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-process-recovery-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = { ...sampleCapture("stuck-processing"), lifecycle_status: "processing", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Pending body");
  await appendMarkdownInboxEntry(paths.inboxPath, capture, "Pending body");

  const warnings = await recoverPendingCaptures(paths);

  assert.deepEqual(warnings, []);
  const [record] = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.equal(record.lifecycle_status, "processed");
  assert.ok(record.processed_at);
  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).has(capture.capture_id), false);
});

test("deleting records finish deletion across record, body, and inbox", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-delete-recovery-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = { ...sampleCapture("stuck-deleting"), lifecycle_status: "deleting", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Doomed body");
  await appendMarkdownInboxEntry(paths.inboxPath, capture, "Doomed body");

  const warnings = await recoverPendingCaptures(paths);

  assert.deepEqual(warnings, []);
  const records = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.deepEqual(records, []);
  await assert.rejects(fs.access(path.join(paths.captureBodiesDir, `${capture.capture_id}.md`)), (error) => error.code === "ENOENT");
  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).has(capture.capture_id), false);
});

test("unrecoverable records surface as lifecycle warnings instead of throwing", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-recovery-warning-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = { ...sampleCapture("broken"), lifecycle_status: "creating", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, capture);
  await appendCaptureRecord(paths.capturesPath, capture);

  const warnings = await recoverPendingCaptures(paths);

  assert.deepEqual(warnings, [
    { capture_id: capture.capture_id, code: "lifecycle_recovery_failed" },
    { capture_id: capture.capture_id, code: "lifecycle_recovery_failed" }
  ]);
});

test("list summarizes the record/body/inbox triple and normalizes the lifecycle filter", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-list-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const selection = sampleCapture("listed-selection");
  selection.input_type = "selection";
  selection.extraction_method = "selection";
  const processed = { ...sampleCapture("listed-processed"), lifecycle_status: "processed", processed_at: "2026-08-12T03:00:00.000Z" };
  await appendCaptureRecord(paths.capturesPath, selection);
  await appendCaptureRecord(paths.capturesPath, processed);
  await writeNewCaptureBody(paths, selection.capture_id, "# Preview\n\nSelection body text");
  await writeNewCaptureBody(paths, processed.capture_id, "# Processed body");
  await appendMarkdownInboxEntry(paths.inboxPath, selection, "# Preview\n\nSelection body text");

  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });
  const active = await ledger.list({ lifecycle: "bogus" });

  assert.equal(active.lifecycle, "active");
  assert.deepEqual(active.summaries.map((summary) => summary.capture_id), [selection.capture_id]);
  const [summary] = active.summaries;
  assert.equal(summary.inbox_state, "present");
  assert.equal(summary.body_state, "available");
  assert.equal(summary.content_exists, true);
  assert.match(summary.preview, /Selection body text/);
  assert.equal(summary.source_host, "example.com");

  const processedView = await ledger.list({ lifecycle: "processed" });
  assert.deepEqual(processedView.summaries.map((item) => item.capture_id), [processed.capture_id]);
  assert.equal(processedView.summaries[0].lifecycle_status, "processed");
});

test("get returns the capture, its verified body path, and an optional guarded body", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-get-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = sampleCapture("gettable");
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "# Gettable body");

  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  const meta = await ledger.get(capture.capture_id);
  assert.equal(meta.capture.title, capture.title);
  assert.equal(meta.bodyPath, path.join(paths.captureBodiesDir, `${capture.capture_id}.md`));
  assert.equal("body" in meta, false);

  const withBody = await ledger.get(capture.capture_id, { withBody: true });
  assert.equal(withBody.body, "# Gettable body");
});

test("get guards oversized bodies only when the body is requested", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-huge-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = sampleCapture("huge");
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "x".repeat(MAX_CAPTURE_CONTENT_BYTES + 1));

  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  const meta = await ledger.get(capture.capture_id);
  assert.ok(meta.bodyPath);
  await assert.rejects(
    ledger.get(capture.capture_id, { withBody: true }),
    (error) => error.code === "capture_too_large"
  );
});

function sampleCapture(captureId) {
  return {
    schema_version: 3,
    capture_id: captureId,
    source_url: "https://example.com/article",
    source_title: "Example",
    title: `Title ${captureId}`,
    input_type: "page",
    extraction_method: "readability",
    clipped_at: "2026-08-12T02:00:00.000Z",
    content_hash: `hash-${captureId}`,
    tags: ["ai", "tech"],
    sync_status: "local_saved",
    sinks: { local: { status: "saved" } },
    error: null
  };
}
