import fs from "node:fs/promises";
import path from "node:path";
import { withCaptureMutationLock } from "./capture-lock.mjs";
import { finishCreatingCapture, finishReactivatingCapture } from "./capture-creation.mjs";
import { MAX_CAPTURE_DOCUMENT_BYTES, captureDocumentMarkdown } from "./capture-document.mjs";
import { captureBodyPath, inspectCaptureBody, localExportPath, resolveCaptureBodyForRead } from "./capture-record.mjs";
import {
  assertCaptureStoreWritable,
  captureRecords,
  findUniqueStoreEntry,
  readCaptureStore,
  writeCaptureStore
} from "./capture-store.mjs";
import { resolveConfiguredPaths } from "./config.mjs";
import { readMarkdownInboxIds, removeMarkdownInboxEntry } from "./inbox-markdown.mjs";
import { prepareCaptureStorage } from "./inbox-migration.mjs";

export const MAX_CAPTURE_CONTENT_BYTES = MAX_CAPTURE_DOCUMENT_BYTES;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PREVIEW_LIMIT = 500;
const LIFECYCLE_FILTERS = new Set(["active", "processed", "all"]);

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
    recoverPending: () => recoverPendingCaptures(paths),
    list: (query = {}) => listCaptures(paths, query),
    get: (captureId, query = {}) => getCapture(paths, captureId, query)
  };
}

async function listCaptures(paths, query = {}) {
  let recoveryWarnings = [];
  if (await captureStorageExists(paths)) {
    try {
      recoveryWarnings = await withCaptureMutationLock(paths, async () => {
        await prepareCaptureStorage(paths);
        return recoverPendingCaptures(paths);
      });
    } catch (error) {
      if (error.code !== "unsupported_capture_schema") {
        throw error;
      }
      const futureStore = await readCaptureStore(paths.capturesPath);
      recoveryWarnings = captureRecords(futureStore)
        .filter((record) => ["creating", "reactivating", "processing", "deleting"].includes(cleanString(record.lifecycle_status)))
        .map((record) => ({ capture_id: cleanString(record.capture_id), code: "lifecycle_recovery_failed" }));
    }
  }

  const store = await readCaptureStore(paths.capturesPath);
  const inboxIds = await readMarkdownInboxIds(paths.inboxPath);
  const lifecycle = normalizeLifecycleFilter(query.lifecycle);
  const limit = normalizeLimit(query.limit);
  const recentRecords = captureRecords(store)
    .filter((record) => lifecycle === "all" || publicLifecycleStatus(record) === lifecycle)
    .sort((a, b) => timestampValue(b.clipped_at) - timestampValue(a.clipped_at))
    .slice(0, limit);

  const summaries = [];
  for (const record of recentRecords) {
    summaries.push(await summarizeCapture(record, paths, inboxIds));
  }

  return {
    summaries,
    warnings: [...store.warnings, ...recoveryWarnings],
    lifecycle
  };
}

async function getCapture(paths, captureId, query = {}) {
  const id = requireCaptureId(captureId);
  const store = await readCaptureStore(paths.capturesPath);
  const capture = findUniqueRecord(captureRecords(store), id);
  const bodyPath = await resolveCaptureBodyForRead(paths, capture.capture_id);
  const result = { capture, bodyPath };
  if (query.withBody) {
    const stat = await fs.stat(bodyPath);
    if (stat.size > MAX_CAPTURE_CONTENT_BYTES) {
      throw new ClipplaneError("capture_too_large", "This capture body is too large to copy safely.");
    }
    result.body = await fs.readFile(bodyPath, "utf8");
  }
  return result;
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

async function summarizeCapture(record, paths, inboxIds) {
  const inspectedBody = await inspectCaptureBody(paths, record.capture_id);
  const contentPath = inspectedBody.path;
  const contentExists = inspectedBody.state === "available";
  const inputType = ["selection", "element"].includes(record.input_type) ? record.input_type : "page";
  const extractionMethod = publicExtractionMethod(record.extraction_method, inputType);
  const preview = ["selection", "element"].includes(inputType) && contentExists ? await readCapturePreview(contentPath, record.capture_id) : "";
  const captureId = cleanString(record.capture_id);
  const inboxMatches = inboxIds.get(captureId) || 0;

  return {
    capture_id: captureId,
    title: cleanString(record.title) || "Untitled",
    source_url: cleanString(record.source_url),
    source_host: sourceHost(record.source_url),
    input_type: inputType,
    extraction_method: extractionMethod,
    clipped_at: cleanString(record.clipped_at),
    processed_at: cleanString(record.processed_at),
    lifecycle_status: publicLifecycleStatus(record),
    inbox_state: inboxMatches > 1 ? "duplicate" : inboxMatches === 1 ? "present" : "missing",
    tags: Array.isArray(record.tags) ? record.tags.map(cleanString).filter(Boolean).slice(0, 8) : [],
    sync_status: cleanString(record.sync_status) || "local_saved",
    content_path: contentPath || "",
    content_exists: contentExists,
    body_state: inspectedBody.state,
    preview,
    sinks: publicSinks(record.sinks)
  };
}

function publicExtractionMethod(value, inputType) {
  const allowed = new Set(["selection", "readability", "fallback", "element"]);
  if (allowed.has(value)) {
    return value;
  }
  return inputType === "selection" ? "selection" : inputType === "element" ? "element" : "legacy_page";
}

async function readCapturePreview(contentPath, captureId) {
  try {
    const text = await fs.readFile(contentPath, "utf8");
    return cleanPreview(captureDocumentMarkdown(text, captureId));
  } catch {
    return "";
  }
}

function cleanPreview(value) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, PREVIEW_LIMIT);
}

function publicSinks(sinks) {
  if (!sinks || typeof sinks !== "object" || Array.isArray(sinks)) {
    return {};
  }

  const visible = {};
  for (const [name, sink] of Object.entries(sinks)) {
    if (!sink || typeof sink !== "object" || Array.isArray(sink)) {
      continue;
    }
    visible[name] = {
      status: cleanString(sink.status) || "unknown",
      error_code: cleanString(sink.error_code),
      synced_at: cleanString(sink.synced_at),
      external_url: cleanString(sink.external_url)
    };
  }
  return visible;
}

function publicLifecycleStatus(record) {
  return cleanString(record.lifecycle_status) === "processed" ? "processed" : "active";
}

function normalizeLifecycleFilter(value) {
  const filter = cleanString(value);
  return LIFECYCLE_FILTERS.has(filter) ? filter : "active";
}

function normalizeLimit(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(number, MAX_LIMIT);
}

function timestampValue(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function sourceHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function findUniqueRecord(records, captureId) {
  const matches = records.filter((record) => cleanString(record.capture_id) === captureId);
  if (!matches.length) {
    throw new ClipplaneError("capture_not_found", `Capture not found: ${captureId}`);
  }
  if (matches.length > 1) {
    throw new ClipplaneError("duplicate_capture_record", `Multiple records use Capture ID: ${captureId}`);
  }
  return matches[0];
}

function requireCaptureId(value) {
  const id = cleanString(value);
  if (!id) {
    throw new ClipplaneError("missing_capture_id", "Capture ID is required.");
  }
  return id;
}

async function captureStorageExists(paths) {
  return await fileExists(paths.capturesPath)
    || await fileExists(paths.inboxPath)
    || await fileExists(paths.legacyInboxPath);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}
