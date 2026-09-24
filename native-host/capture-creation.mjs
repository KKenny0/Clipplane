import fs from "node:fs/promises";
import { inspectCaptureBody } from "./capture-record.mjs";
import { findUniqueStoreEntry, readCaptureStore, writeCaptureStore } from "./capture-store.mjs";
import { appendMarkdownInboxEntry, removeMarkdownInboxEntry } from "./inbox-markdown.mjs";

export async function finishCreatingCapture(paths, captureId) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, captureId);
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
  const entry = findUniqueStoreEntry(store.entries, captureId);
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
