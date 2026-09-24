import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openCaptureLedger, recoverPendingCaptures } from "../native-host/capture-ledger.mjs";
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
