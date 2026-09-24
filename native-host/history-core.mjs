import { withCaptureMutationLock } from "./capture-lock.mjs";
import { findUniqueStoreEntry, readCaptureStore, writeCaptureStore } from "./capture-store.mjs";
import {
  ClipplaneError,
  finishDeletingCapture,
  finishProcessingCapture,
  openCaptureLedger
} from "./capture-ledger.mjs";
import { resolveConfiguredPaths } from "./config.mjs";
import { prepareCaptureStorage } from "./inbox-migration.mjs";
import { openTextFile, writeClipboardText } from "./settings-core.mjs";
import { sanitizeSourceUrl } from "./url-sanitizer.mjs";

export async function listCaptureHistory(options = {}) {
  const ledger = await openCaptureLedger(options);
  const { summaries, warnings, lifecycle } = await ledger.list({
    lifecycle: options.lifecycle,
    limit: options.limit
  });

  return {
    ok: true,
    history: {
      items: summaries,
      warnings,
      lifecycle
    }
  };
}

export async function openCaptureBody(captureId, options = {}) {
  const id = requireCaptureId(captureId);
  const ledger = await openCaptureLedger(options);
  const { bodyPath } = await ledger.get(id);
  await (options.openFileImpl || openTextFile)(bodyPath, options);

  return {
    ok: true,
    capture_id: id,
    path: bodyPath,
    opened_at: new Date().toISOString()
  };
}

export async function copyCapture(captureId, mode, options = {}) {
  const id = requireCaptureId(captureId);
  if (!["agent-reference", "content"].includes(mode)) {
    throw new ClipplaneError("invalid_copy_mode", "Choose a supported capture copy format.");
  }

  const ledger = await openCaptureLedger(options);
  const { capture, bodyPath, body } = await ledger.get(id, { withBody: mode === "content" });
  const text = mode === "content"
    ? body
    : buildAgentReference(capture, bodyPath);
  await (options.writeClipboardImpl || writeClipboardText)(text, options);

  return {
    ok: true,
    capture_id: id,
    copy_mode: mode,
    byte_length: Buffer.byteLength(text, "utf8"),
    copied_at: new Date().toISOString()
  };
}

export async function markCaptureProcessed(captureId, options = {}) {
  const id = requireCaptureId(captureId);
  const { paths } = await resolveConfiguredPaths(options);
  return withCaptureMutationLock(paths, async () => {
    await prepareCaptureStorage(paths);
    return markCaptureProcessedLocked(id, paths);
  });
}

async function markCaptureProcessedLocked(id, paths) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, id);

  if (publicLifecycleStatus(entry.record) === "processed") {
    return lifecycleResponse(entry.record, "processed");
  }

  entry.record = {
    ...entry.record,
    lifecycle_status: "processing",
    lifecycle_started_at: new Date().toISOString()
  };
  await writeCaptureStore(paths.capturesPath, store.entries);

  const processed = await finishProcessingCapture(paths, id);
  return lifecycleResponse(processed, "processed");
}

export async function deleteCapture(captureId, options = {}) {
  const id = requireCaptureId(captureId);
  const { paths } = await resolveConfiguredPaths(options);
  return withCaptureMutationLock(paths, async () => {
    await prepareCaptureStorage(paths);
    return deleteCaptureLocked(id, paths);
  });
}

async function deleteCaptureLocked(id, paths) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, id);

  entry.record = {
    ...entry.record,
    lifecycle_status: "deleting",
    lifecycle_started_at: new Date().toISOString()
  };
  await writeCaptureStore(paths.capturesPath, store.entries);
  await finishDeletingCapture(paths, id);

  return {
    ok: true,
    capture_id: id,
    lifecycle_status: "deleted",
    deleted_at: new Date().toISOString(),
    remote_copies_affected: false
  };
}

function buildAgentReference(capture, contentPath) {
  const lines = [
    "Use this Clipplane capture as source material.",
    "",
    `Title: ${cleanString(capture.title) || "Untitled"}`
  ];
  const sourceUrl = sanitizeSourceUrl(cleanString(capture.source_url));
  if (sourceUrl) {
    lines.push(`Source: ${sourceUrl}`);
  }
  lines.push(`Local Markdown file: ${contentPath}`);
  return lines.join("\n");
}

function lifecycleResponse(record, lifecycleStatus) {
  return {
    ok: true,
    capture_id: cleanString(record.capture_id),
    lifecycle_status: lifecycleStatus,
    processed_at: cleanString(record.processed_at)
  };
}

function publicLifecycleStatus(record) {
  return cleanString(record.lifecycle_status) === "processed" ? "processed" : "active";
}

function requireCaptureId(value) {
  const id = cleanString(value);
  if (!id) {
    throw new ClipplaneError("missing_capture_id", "Capture ID is required.");
  }
  return id;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}
