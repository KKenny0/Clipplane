import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_CAPTURE_CONTENT_BYTES, classifyTags, openCaptureLedger, recoverPendingCaptures } from "../native-host/capture-ledger.mjs";
import { localExportPath, writeLocalExport, writeNewCaptureBody } from "../native-host/capture-record.mjs";
import { appendCaptureRecord, readCaptureStore } from "../native-host/capture-store.mjs";
import { appendMarkdownInboxEntry, readMarkdownInboxIds } from "../native-host/inbox-markdown.mjs";
import { prepareCaptureStorage } from "../native-host/inbox-migration.mjs";
import { getDefaultPaths } from "../native-host/paths.mjs";

test("the ledger factory resolves paths and opens a clean view", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-open-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  await prepareCaptureStorage(getDefaultPaths(notesDir, { configDir }), { create: true });

  const ledger = await openCaptureLedger({ notesDir, configDir });

  assert.equal(ledger.paths.inboxPath, path.join(notesDir, "inbox.md"));
  assert.ok(ledger.config);
  assert.deepEqual((await ledger.list()).summaries, []);
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

test("markProcessed removes the inbox entry and reports processed state", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-process-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = sampleCapture("to-process");
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Body to process");
  await appendMarkdownInboxEntry(paths.inboxPath, capture, "Body to process");
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  const first = await ledger.markProcessed(capture.capture_id);
  const second = await ledger.markProcessed(capture.capture_id);

  assert.equal(first.capture.lifecycle_status, "processed");
  assert.ok(first.capture.processed_at);
  assert.equal(second.capture.capture_id, capture.capture_id);
  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).has(capture.capture_id), false);
  const [record] = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.equal(record.lifecycle_status, "processed");
});

test("remove clears the record, body, inbox entry, and local export", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-remove-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = sampleCapture("to-remove");
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Doomed body");
  await appendMarkdownInboxEntry(paths.inboxPath, capture, "Doomed body");
  await writeLocalExport(paths, capture.capture_id, "{\"saved\":true}");
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  const { deletedAt } = await ledger.remove(capture.capture_id);

  assert.ok(deletedAt);
  const records = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.deepEqual(records, []);
  await assert.rejects(fs.access(path.join(paths.captureBodiesDir, `${capture.capture_id}.md`)), (error) => error.code === "ENOENT");
  await assert.rejects(fs.access(localExportPath(paths, capture.capture_id)), (error) => error.code === "ENOENT");
  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).has(capture.capture_id), false);
});

test("markProcessed self-heals a stuck processing capture through recovery", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-process-heal-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = { ...sampleCapture("stuck-process"), lifecycle_status: "processing", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Stuck body");
  await appendMarkdownInboxEntry(paths.inboxPath, capture, "Stuck body");
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  const { capture: processed } = await ledger.markProcessed(capture.capture_id);

  assert.equal(processed.capture_id, capture.capture_id);
  assert.equal(processed.lifecycle_status, "processed");
});

test("remove self-heals a stuck deleting capture and then reports it missing", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-remove-heal-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = { ...sampleCapture("stuck-remove"), lifecycle_status: "deleting", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Stuck body");
  await appendMarkdownInboxEntry(paths.inboxPath, capture, "Stuck body");
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  await assert.rejects(
    ledger.remove(capture.capture_id),
    (error) => error.code === "capture_not_found"
  );
  const records = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.deepEqual(records, []);
});

test("mutations refuse to run while another capture cannot be recovered", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-mutate-blocked-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const healthy = sampleCapture("healthy");
  await appendCaptureRecord(paths.capturesPath, healthy);
  await writeNewCaptureBody(paths, healthy.capture_id, "Healthy body");
  const stuck = { ...sampleCapture("stuck"), lifecycle_status: "creating", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, stuck);
  await appendCaptureRecord(paths.capturesPath, stuck);
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  for (const operation of [() => ledger.markProcessed(healthy.capture_id), () => ledger.remove(healthy.capture_id)]) {
    await assert.rejects(
      operation(),
      (error) => error.code === "lifecycle_recovery_failed"
    );
  }
  const [record] = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.equal(record.capture_id, healthy.capture_id);
});

test("create writes the triple, dedupes by content hash, and reactivates processed captures", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-create-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });
  const normalized = {
    inputType: "selection",
    extractionMethod: "selection",
    sourceUrl: "https://example.com/article#fragment",
    sourceTitle: "Article",
    title: "Article",
    contentMarkdown: "Hashed body",
    author: "",
    publishedAt: "",
    description: "",
    siteName: ""
  };

  const first = await ledger.create(normalized);

  assert.equal(first.duplicate, false);
  assert.equal(first.capture.content_hash.length, 64);
  assert.equal(first.capture.tags.length > 0, true);
  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).get(first.capture.capture_id), 1);
  assert.match(await fs.readFile(path.join(paths.captureBodiesDir, `${first.capture.capture_id}.md`), "utf8"), /Hashed body/);

  const duplicate = await ledger.create(normalized);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reactivated, false);
  assert.equal(duplicate.capture.capture_id, first.capture.capture_id);

  const processed = await ledger.markProcessed(first.capture.capture_id);
  assert.equal(processed.capture.lifecycle_status, "processed");

  const reactivated = await ledger.create(normalized);
  assert.equal(reactivated.duplicate, true);
  assert.equal(reactivated.reactivated, true);
  const [record] = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.equal("lifecycle_status" in record, false);
});

test("applySyncResults records sink outcomes under the commit envelope", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-sync-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = sampleCapture("sync-me");
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Syncable body");
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  const { capture: updated } = await ledger.applySyncResults(capture.capture_id, [
    { sink: "flomo-api", status: "synced", external_url: "https://flomoapp.com/memo/1" },
    { sink: "notion-api", status: "failed", error_code: "sync_failed", last_error: "no token" }
  ]);

  assert.equal(updated.sync_status, "sync_failed");
  assert.equal(updated.sinks["flomo-api"].status, "synced");
  assert.ok(updated.sinks["flomo-api"].synced_at);
  assert.equal(updated.sinks["notion-api"].error_code, "sync_failed");
  const [record] = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.equal(record.sinks["flomo-api"].status, "synced");
});

test("applySyncResults refuses a capture whose deletion recovery finished", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-ledger-sync-heal-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const capture = { ...sampleCapture("stuck-sync"), lifecycle_status: "deleting", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, "Body");
  const ledger = await openCaptureLedger({ notesDir, configDir: paths.appConfigDir });

  await assert.rejects(
    ledger.applySyncResults(capture.capture_id, [{ sink: "flomo-api", status: "synced" }]),
    (error) => error.code === "capture_not_found"
  );
  const records = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.deepEqual(records, []);
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
