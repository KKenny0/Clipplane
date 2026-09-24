import fs from "node:fs/promises";
import path from "node:path";
import { finishCreatingCapture, finishReactivatingCapture } from "./capture-creation.mjs";
import { captureBodyPath, localExportPath } from "./capture-record.mjs";
import {
  assertCaptureStoreWritable,
  captureRecords,
  findUniqueStoreEntry,
  readCaptureStore,
  writeCaptureStore
} from "./capture-store.mjs";
import { resolveConfiguredPaths } from "./config.mjs";
import { removeMarkdownInboxEntry } from "./inbox-markdown.mjs";

export class ClipplaneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClipplaneError";
    this.code = code;
  }
}

export async function openCaptureLedger(options = {}) {
  const { paths, config } = await resolveConfiguredPaths(options);
  return {
    paths,
    config,
    recoverPending: () => recoverPendingCaptures(paths)
  };
}

export async function recoverPendingCaptures(paths) {
  const warnings = [];
  const store = await readCaptureStore(paths.capturesPath);
  assertCaptureStoreWritable(store.entries);
  const pending = captureRecords(store)
    .filter((record) => ["creating", "reactivating", "processing", "deleting"].includes(cleanString(record.lifecycle_status)))
    .map((record) => ({ id: cleanString(record.capture_id), operation: cleanString(record.lifecycle_status) }));

  for (const item of pending) {
    try {
      if (item.operation === "creating") {
        await finishCreatingCapture(paths, item.id);
      } else if (item.operation === "reactivating") {
        await finishReactivatingCapture(paths, item.id);
      } else if (item.operation === "processing") {
        await finishProcessingCapture(paths, item.id);
      } else {
        await finishDeletingCapture(paths, item.id);
      }
    } catch {
      warnings.push({ capture_id: item.id, code: "lifecycle_recovery_failed" });
    }
  }
  return warnings;
}

export async function finishProcessingCapture(paths, captureId) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, captureId);
  await removeMarkdownInboxEntry(paths.inboxPath, captureId);
  entry.record = {
    ...entry.record,
    lifecycle_status: "processed",
    processed_at: cleanString(entry.record.processed_at) || new Date().toISOString()
  };
  delete entry.record.lifecycle_started_at;
  await writeCaptureStore(paths.capturesPath, store.entries);
  return entry.record;
}

export async function finishDeletingCapture(paths, captureId) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, captureId);
  const contentCandidate = captureBodyPath(paths, entry.record.capture_id);
  const contentPath = await safeManagedFileForDeletion(
    contentCandidate,
    paths.captureBodiesDir,
    paths.notesDir,
    "unsafe_capture_path"
  );
  const exportPath = await localExportForDeletion(entry.record, paths);

  await removeMarkdownInboxEntry(paths.inboxPath, captureId);
  if (contentPath) {
    await fs.rm(contentPath, { force: true });
  }
  if (exportPath) {
    await fs.rm(exportPath, { force: true });
  }

  const nextEntries = store.entries.filter((candidate) => candidate !== entry);
  await writeCaptureStore(paths.capturesPath, nextEntries);
}

async function localExportForDeletion(record, paths) {
  const exportRoot = path.join(paths.stateDir, "sinks", "local-export");
  const expected = localExportPath(paths, record.capture_id);
  return safeManagedFileForDeletion(expected, exportRoot, paths.notesDir, "unsafe_local_export_path");
}

async function safeManagedFileForDeletion(candidate, managedRoot, notesRoot, errorCode) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedManagedRoot = path.resolve(managedRoot);
  const resolvedNotesRoot = path.resolve(notesRoot);
  if (!isPathInside(resolvedCandidate, resolvedManagedRoot) || !isPathInside(resolvedManagedRoot, resolvedNotesRoot)) {
    throw new ClipplaneError(errorCode, "Managed file path is outside the Clipplane notes folder.");
  }

  let candidateStat;
  try {
    candidateStat = await fs.lstat(resolvedCandidate);
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
  if (candidateStat.isSymbolicLink()) {
    throw new ClipplaneError(errorCode, "Managed file path cannot be a symbolic link.");
  }

  const [realCandidate, realManagedRoot, realNotesRoot] = await Promise.all([
    fs.realpath(resolvedCandidate),
    fs.realpath(resolvedManagedRoot),
    fs.realpath(resolvedNotesRoot)
  ]);
  if (!isPathInside(realManagedRoot, realNotesRoot) || !isPathInside(realCandidate, realManagedRoot)) {
    throw new ClipplaneError(errorCode, "Managed file resolves outside the Clipplane notes folder.");
  }
  return resolvedCandidate;
}

function isPathInside(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}
