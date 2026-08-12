import fs from "node:fs/promises";
import { inspectCaptureBody } from "./capture-record.mjs";
import { captureRecords, readCaptureStore, writeCaptureStore } from "./capture-store.mjs";
import { appendMarkdownInboxEntry, removeMarkdownInboxEntry } from "./inbox-markdown.mjs";

export async function recoverCaptureWrites(paths) {
  const store = await readCaptureStore(paths.capturesPath);
  const pending = captureRecords(store).filter((record) => ["creating", "reactivating"].includes(record.lifecycle_status));
  const warnings = [];
  for (const record of pending) {
    try {
      if (record.lifecycle_status === "reactivating") {
        await finishReactivatingCapture(paths, record.capture_id);
      } else {
        await finishCreatingCapture(paths, record.capture_id);
      }
    } catch {
      warnings.push({ capture_id: record.capture_id, code: "lifecycle_recovery_failed" });
    }
  }
  return warnings;
}

export const recoverCreatingCaptures = recoverCaptureWrites;

export async function finishCreatingCapture(paths, captureId) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = uniqueCaptureEntry(store.entries, captureId);
  const inspected = await inspectCaptureBody(paths, captureId);
  if (inspected.state === "unsafe") {
    throw inspected.error;
  }
  if (inspected.state === "missing") {
    await removeMarkdownInboxEntry(paths.inboxPath, captureId);
    await writeCaptureStore(paths.capturesPath, store.entries.filter((candidate) => candidate !== entry));
    return null;
  }

  const markdown = await fs.readFile(inspected.path, "utf8");
  await appendMarkdownInboxEntry(paths.inboxPath, entry.record, markdown);
  entry.record = { ...entry.record };
  delete entry.record.lifecycle_status;
  delete entry.record.lifecycle_started_at;
  await writeCaptureStore(paths.capturesPath, store.entries);
  return entry.record;
}

export async function finishReactivatingCapture(paths, captureId) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = uniqueCaptureEntry(store.entries, captureId);
  const inspected = await inspectCaptureBody(paths, captureId);
  if (inspected.state === "unsafe") {
    throw inspected.error;
  }
  if (inspected.state === "missing") {
    entry.record = { ...entry.record, lifecycle_status: "processed" };
    delete entry.record.lifecycle_started_at;
    await writeCaptureStore(paths.capturesPath, store.entries);
    const error = new Error(`Capture body is missing: ${captureId}`);
    error.code = "missing_capture_body";
    throw error;
  }

  const markdown = await fs.readFile(inspected.path, "utf8");
  await appendMarkdownInboxEntry(paths.inboxPath, entry.record, markdown);
  entry.record = { ...entry.record };
  delete entry.record.lifecycle_status;
  delete entry.record.lifecycle_started_at;
  delete entry.record.processed_at;
  await writeCaptureStore(paths.capturesPath, store.entries);
  return entry.record;
}

function uniqueCaptureEntry(entries, captureId) {
  const matches = entries.filter((entry) => entry.record?.capture_id === captureId);
  if (matches.length !== 1) {
    const error = new Error(matches.length ? `Multiple records use Capture ID: ${captureId}` : `Capture not found: ${captureId}`);
    error.code = matches.length ? "duplicate_capture_record" : "capture_not_found";
    throw error;
  }
  return matches[0];
}
