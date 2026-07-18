import fs from "node:fs/promises";
import path from "node:path";
import { withCaptureMutationLock } from "./capture-lock.mjs";
import { captureBodyPath, inspectCaptureBody, localExportPath, resolveCaptureBodyForRead } from "./capture-record.mjs";
import {
  assertCaptureStoreWritable,
  captureRecords,
  readCaptureStore,
  writeCaptureStore
} from "./capture-store.mjs";
import { ClipplaneError } from "./clip-core.mjs";
import { resolveConfiguredPaths } from "./config.mjs";
import { openTextFile } from "./settings-core.mjs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PREVIEW_LIMIT = 500;
const LIFECYCLE_FILTERS = new Set(["active", "processed", "all"]);

export async function listCaptureHistory(options = {}) {
  const { paths } = await resolveConfiguredPaths(options);
  let captureData = await readCaptureRecords(paths.capturesPath);
  let recoveryWarnings = [];
  const pendingRecords = captureData.records
    .filter((record) => ["processing", "deleting"].includes(cleanString(record.lifecycle_status)));
  if (pendingRecords.length) {
    try {
      recoveryWarnings = await withCaptureMutationLock(paths, () => recoverPendingLifecycleOperations(paths));
      captureData = await readCaptureRecords(paths.capturesPath);
    } catch (error) {
      if (error.code !== "unsupported_capture_schema") {
        throw error;
      }
      recoveryWarnings = pendingRecords.map((record) => ({
        capture_id: cleanString(record.capture_id),
        code: "lifecycle_recovery_failed"
      }));
    }
  }
  const { records, warnings } = captureData;
  const inboxIds = await readInboxCaptureIds(paths.inboxPath);
  const lifecycle = normalizeLifecycleFilter(options.lifecycle);
  const limit = normalizeLimit(options.limit);
  const recentRecords = records
    .filter((record) => lifecycle === "all" || publicLifecycleStatus(record) === lifecycle)
    .sort((a, b) => timestampValue(b.clipped_at) - timestampValue(a.clipped_at))
    .slice(0, limit);

  const items = [];
  for (const record of recentRecords) {
    items.push(await summarizeCapture(record, paths, inboxIds));
  }

  return {
    ok: true,
    history: {
      items,
      warnings: [...warnings, ...recoveryWarnings],
      lifecycle
    }
  };
}

export async function openCaptureBody(captureId, options = {}) {
  const id = requireCaptureId(captureId);
  const { paths } = await resolveConfiguredPaths(options);
  const { records } = await readCaptureRecords(paths.capturesPath);
  const capture = findUniqueRecord(records, id);
  const contentPath = await resolveCaptureBodyForRead(paths, capture.capture_id);
  await (options.openFileImpl || openTextFile)(contentPath, options);

  return {
    ok: true,
    capture_id: id,
    path: contentPath,
    opened_at: new Date().toISOString()
  };
}

export async function markCaptureProcessed(captureId, options = {}) {
  const id = requireCaptureId(captureId);
  const { paths } = await resolveConfiguredPaths(options);
  return withCaptureMutationLock(paths, () => markCaptureProcessedLocked(id, paths));
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
  return withCaptureMutationLock(paths, () => deleteCaptureLocked(id, paths));
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

async function summarizeCapture(record, paths, inboxIds) {
  const inspectedBody = await inspectCaptureBody(paths, record.capture_id);
  const contentPath = inspectedBody.path;
  const contentExists = inspectedBody.state === "available";
  const inputType = ["selection", "element"].includes(record.input_type) ? record.input_type : "page";
  const extractionMethod = publicExtractionMethod(record.extraction_method, inputType);
  const preview = ["selection", "element"].includes(inputType) && contentExists ? await readCapturePreview(contentPath) : "";
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

async function recoverPendingLifecycleOperations(paths) {
  const store = await readCaptureStore(paths.capturesPath);
  assertCaptureStoreWritable(store.entries);
  const records = captureRecords(store);
  const pending = records
    .filter((record) => ["processing", "deleting"].includes(cleanString(record.lifecycle_status)))
    .map((record) => ({ id: cleanString(record.capture_id), operation: cleanString(record.lifecycle_status) }));
  const warnings = [];

  for (const item of pending) {
    try {
      if (item.operation === "processing") {
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

async function finishProcessingCapture(paths, captureId) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, captureId);
  await removeCaptureFromInbox(paths.inboxPath, captureId);
  entry.record = {
    ...entry.record,
    lifecycle_status: "processed",
    processed_at: cleanString(entry.record.processed_at) || new Date().toISOString()
  };
  delete entry.record.lifecycle_started_at;
  await writeCaptureStore(paths.capturesPath, store.entries);
  return entry.record;
}

async function finishDeletingCapture(paths, captureId) {
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, captureId);
  const contentCandidate = captureBodyPath(paths, entry.record.capture_id);
  const contentPath = await safeManagedFileForDeletion(
    contentCandidate,
    paths.captureBodiesDir,
    paths.notesDir,
    "unsafe_capture_path"
  );
  const localExportPath = await localExportForDeletion(entry.record, paths);

  await removeCaptureFromInbox(paths.inboxPath, captureId);
  if (contentPath) {
    await fs.rm(contentPath, { force: true });
  }
  if (localExportPath) {
    await fs.rm(localExportPath, { force: true });
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

async function removeCaptureFromInbox(inboxPath, captureId) {
  let text;
  try {
    text = await fs.readFile(inboxPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const parsed = parseInboxEntries(text);
  const matches = parsed.entries.filter((entry) => entry.captureId === captureId);
  if (matches.length > 1) {
    throw new ClipplaneError("duplicate_inbox_capture", `Multiple inbox entries use Capture ID: ${captureId}`);
  }
  if (!matches.length) {
    return false;
  }

  const match = matches[0];
  const lines = [...parsed.lines];
  let start = match.start;
  if (start > 0 && lines[start - 1] === "" && match.end < lines.length && lines[match.end] === "") {
    start -= 1;
  }
  lines.splice(start, match.end - start);
  await atomicWrite(inboxPath, lines.join(parsed.eol), { expectedBody: text });
  return true;
}

async function readInboxCaptureIds(inboxPath) {
  let text;
  try {
    text = await fs.readFile(inboxPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const ids = new Map();
  for (const entry of parseInboxEntries(text).entries) {
    if (entry.captureId) {
      ids.set(entry.captureId, (ids.get(entry.captureId) || 0) + 1);
    }
  }
  return ids;
}

function parseInboxEntries(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const starts = [];
  for (const [index, line] of lines.entries()) {
    if (/^\*\s+/.test(line)) {
      starts.push(index);
    }
  }

  const entries = starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    let captureId = "";
    let inProperties = false;
    for (let lineIndex = start + 1; lineIndex < end; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!inProperties && line === ":PROPERTIES:") {
        inProperties = true;
        continue;
      }
      if (inProperties && line === ":END:") {
        break;
      }
      if (inProperties) {
        const match = line.match(/^:CAPTURE_ID:\s*(\S.*?)\s*$/);
        if (match) {
          captureId = match[1];
        }
      } else if (line.trim()) {
        break;
      }
    }
    return { start, end, captureId };
  });

  return { eol, lines, entries };
}

function publicExtractionMethod(value, inputType) {
  const allowed = new Set(["selection", "readability", "fallback", "element"]);
  if (allowed.has(value)) {
    return value;
  }
  return inputType === "selection" ? "selection" : inputType === "element" ? "element" : "legacy_page";
}

async function readCapturePreview(contentPath) {
  try {
    const text = await fs.readFile(contentPath, "utf8");
    return cleanPreview(text);
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

async function readCaptureRecords(capturesPath) {
  const store = await readCaptureStore(capturesPath);
  return {
    records: captureRecords(store),
    warnings: store.warnings
  };
}

async function atomicWrite(filePath, body, options = {}) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let mode = 0o600;
  try {
    mode = (await fs.stat(filePath)).mode & 0o777;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    await fs.writeFile(tempPath, body, { encoding: "utf8", mode });
    await fs.chmod(tempPath, mode);
    if (options.expectedBody !== undefined && await fs.readFile(filePath, "utf8") !== options.expectedBody) {
      throw new ClipplaneError("inbox_changed", "inbox.org changed during cleanup. Review it and try again.");
    }
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
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

function findUniqueStoreEntry(entries, captureId) {
  const matches = entries.filter((entry) => entry.record && cleanString(entry.record.capture_id) === captureId);
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

function normalizeLifecycleFilter(value) {
  const filter = cleanString(value);
  return LIFECYCLE_FILTERS.has(filter) ? filter : "active";
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

function isPathInside(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
