import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withCaptureMutationLock } from "./capture-lock.mjs";
import {
  MAX_CAPTURE_DOCUMENT_BYTES,
  captureDocumentMarkdown,
  renderCaptureDocument
} from "./capture-document.mjs";
import {
  assertSupportedCaptureRecord,
  captureBodyPath,
  ensureCaptureBody,
  inspectCaptureBody,
  localExportPath,
  resolveCaptureBodyForRead,
  writeNewCaptureBody
} from "./capture-record.mjs";
import {
  appendCaptureRecord,
  assertCaptureStoreWritable,
  captureRecords,
  findUniqueStoreEntry,
  readCaptureStore,
  replaceCaptureRecord,
  writeCaptureStore
} from "./capture-store.mjs";
import { resolveConfiguredPaths } from "./config.mjs";
import { appendMarkdownInboxEntry, readMarkdownInboxIds, removeMarkdownInboxEntry } from "./inbox-markdown.mjs";
import { prepareCaptureStorage } from "./inbox-migration.mjs";

export const MAX_CAPTURE_CONTENT_BYTES = MAX_CAPTURE_DOCUMENT_BYTES;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PREVIEW_LIMIT = 500;
const LIFECYCLE_FILTERS = new Set(["active", "processed", "all"]);
const TAG_RULES = [
  { tag: "ai", patterns: [/ai\b/i, /llm/i, /agent/i, /model/i, /\u673a\u5668\u5b66\u4e60/, /\u5927\u6a21\u578b/] },
  { tag: "tech", patterns: [/code/i, /programming/i, /software/i, /api\b/i, /\u7f16\u7a0b/, /\u4ee3\u7801/, /\u5f00\u53d1/] },
  { tag: "biz", patterns: [/startup/i, /business/i, /market/i, /pricing/i, /\u521b\u4e1a/, /\u5546\u4e1a/, /\u6295\u8d44/] },
  { tag: "think", patterns: [/philosophy/i, /cognition/i, /reason/i, /\u54f2\u5b66/, /\u601d\u8003/, /\u8ba4\u77e5/] },
  { tag: "design", patterns: [/design/i, /ux\b/i, /ui\b/i, /\u8bbe\u8ba1/] },
  { tag: "life", patterns: [/habit/i, /life/i, /health/i, /\u751f\u6d3b/, /\u4e60\u60ef/, /\u5065\u5eb7/] },
  { tag: "read", patterns: [/book/i, /paper/i, /article/i, /reading/i, /\u8bfb\u4e66/, /\u8bba\u6587/, /\u9605\u8bfb/] }
];

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
    create: (normalized) => createCapture(paths, normalized),
    list: (query = {}) => listCaptures(paths, query),
    get: (captureId, query = {}) => getCapture(paths, captureId, query),
    markProcessed: (captureId) => mutateCapture(paths, () => markProcessedCapture(paths, captureId)),
    remove: (captureId) => mutateCapture(paths, () => removeCapture(paths, captureId)),
    applySyncResults: (captureId, results) => mutateCapture(paths, () => applySyncResultsCapture(paths, captureId, results))
  };
}

async function mutateCapture(paths, operation) {
  return withCaptureMutationLock(paths, async () => {
    await prepareCaptureStorage(paths);
    const warnings = await recoverPendingCaptures(paths);
    if (warnings.length) {
      throw new ClipplaneError(
        "lifecycle_recovery_failed",
        "A previous capture could not be recovered. Open History before trying again."
      );
    }
    return operation();
  });
}

async function markProcessedCapture(paths, captureId) {
  const id = requireCaptureId(captureId);
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, id);

  if (publicLifecycleStatus(entry.record) === "processed") {
    return { capture: entry.record };
  }

  entry.record = {
    ...entry.record,
    lifecycle_status: "processing",
    lifecycle_started_at: new Date().toISOString()
  };
  await writeCaptureStore(paths.capturesPath, store.entries);

  const capture = await finishProcessingCapture(paths, id);
  return { capture };
}

async function removeCapture(paths, captureId) {
  const id = requireCaptureId(captureId);
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, id);

  entry.record = {
    ...entry.record,
    lifecycle_status: "deleting",
    lifecycle_started_at: new Date().toISOString()
  };
  await writeCaptureStore(paths.capturesPath, store.entries);
  await finishDeletingCapture(paths, id);

  return { deletedAt: new Date().toISOString() };
}

async function applySyncResultsCapture(paths, captureId, results) {
  const id = requireCaptureId(captureId);
  const store = await readCaptureStore(paths.capturesPath);
  const entry = findUniqueStoreEntry(store.entries, id);
  const capture = updateCaptureSinks(entry.record, results);
  entry.record = capture;
  await writeCaptureStore(paths.capturesPath, store.entries);
  return { capture };
}

function updateCaptureSinks(capture, results) {
  const sinks = { ...(capture.sinks || {}) };
  for (const result of results) {
    sinks[result.sink] = {
      status: result.status,
      external_id: result.external_id || null,
      external_url: result.external_url || null,
      synced_at: result.status === "synced" ? new Date().toISOString() : null,
      error_code: result.error_code || null,
      last_error: result.last_error || null
    };
  }

  const hasFailed = results.some((result) => result.status === "failed");
  const hasSynced = results.some((result) => result.status === "synced");
  const hasSkipped = results.some((result) => result.status === "skipped");

  return {
    ...capture,
    sinks,
    sync_status: hasFailed ? "sync_failed" : hasSynced ? "synced" : hasSkipped ? "sync_skipped" : capture.sync_status
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

export function classifyTags(text) {
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      tags.push(rule.tag);
    }
    if (tags.length >= 2) {
      break;
    }
  }
  return tags.length ? tags : ["clip"];
}

function createContentHash(normalized) {
  const body = [
    normalized.inputType,
    normalizeUrlForHash(normalized.sourceUrl),
    normalized.contentMarkdown.replace(/\s+/g, " ").trim()
  ].join("\n");
  return crypto.createHash("sha256").update(body).digest("hex");
}

async function createCapture(paths, normalized) {
  return withCaptureMutationLock(paths, async () => {
    await prepareCaptureStorage(paths, { create: true });
    const warnings = await recoverPendingCaptures(paths);
    if (warnings.length) {
      throw new ClipplaneError(
        "lifecycle_recovery_failed",
        "A previous capture could not be recovered. Open History before clipping again."
      );
    }

    const contentHash = createContentHash(normalized);
    const store = await readCaptureStore(paths.capturesPath);
    assertCaptureStoreWritable(store.entries);
    const existing = findExistingCapture(store, contentHash);

    if (existing) {
      assertSupportedCaptureRecord(existing);
      let capture = await ensureDuplicateCaptureBody(paths, existing, normalized);
      const reactivated = capture.lifecycle_status === "processed";
      if (reactivated) {
        capture = await reactivateCapture(paths, capture);
      }
      return { capture, duplicate: true, reactivated };
    }

    const capture = await buildCapture(normalized, contentHash, paths, store);
    const document = renderCaptureDocument(capture, normalized.contentMarkdown);
    if (Buffer.byteLength(document, "utf8") > MAX_CAPTURE_CONTENT_BYTES) {
      throw new ClipplaneError("capture_too_large", "This clip is too large to save safely. Try Selection or Element instead.");
    }
    await appendCaptureRecord(paths.capturesPath, capture);
    await writeNewCaptureBody(paths, capture.capture_id, document);
    await appendMarkdownInboxEntry(paths.inboxPath, capture, document);
    const completed = await finishCreatingCapture(paths, capture.capture_id);

    return { capture: completed, duplicate: false, reactivated: false };
  });
}

function findExistingCapture(store, contentHash) {
  return captureRecords(store).find((record) => record.content_hash === contentHash) || null;
}

async function ensureDuplicateCaptureBody(paths, existing, normalized) {
  await ensureCaptureBody(paths, existing.capture_id, renderCaptureDocument(existing, normalized.contentMarkdown));
  const updated = { ...existing };
  await replaceCaptureRecord(paths.capturesPath, updated);
  return updated;
}

async function reactivateCapture(paths, capture) {
  const pending = {
    ...capture,
    lifecycle_status: "reactivating",
    lifecycle_started_at: new Date().toISOString()
  };
  await replaceCaptureRecord(paths.capturesPath, pending);
  return finishReactivatingCapture(paths, capture.capture_id);
}

async function buildCapture(normalized, contentHash, paths, store) {
  const clippedAt = new Date();
  const tags = classifyTags(`${normalized.title}\n${normalized.contentMarkdown}`);
  const captureId = await createUniqueCaptureId(clippedAt, paths, store);
  return {
    capture_id: captureId,
    source_url: normalized.sourceUrl,
    source_title: normalized.sourceTitle,
    title: normalized.title,
    author: normalized.author,
    published_at: normalized.publishedAt,
    description: normalized.description,
    site_name: normalized.siteName,
    input_type: normalized.inputType,
    extraction_method: normalized.extractionMethod,
    clipped_at: clippedAt.toISOString(),
    content_hash: contentHash,
    tags,
    lifecycle_status: "creating",
    lifecycle_started_at: clippedAt.toISOString(),
    sync_status: "local_saved",
    sinks: {
      local: { status: "saved" }
    },
    error: null
  };
}

async function createUniqueCaptureId(clippedAt, paths, store) {
  const existingIds = new Set(captureRecords(store).map((record) => record.capture_id));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const captureId = `${formatCompactTimestamp(clippedAt)}-${crypto.randomUUID()}`;
    if (existingIds.has(captureId)) {
      continue;
    }
    const body = await inspectCaptureBody(paths, captureId);
    if (body.state === "unsafe") {
      throw body.error;
    }
    if (body.state === "missing") {
      return captureId;
    }
  }
  throw new ClipplaneError("capture_id_unavailable", "Could not allocate a unique capture ID.");
}

function formatCompactTimestamp(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${min}${sec}`;
}

function normalizeUrlForHash(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
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

async function finishCreatingCapture(paths, captureId) {
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

async function finishReactivatingCapture(paths, captureId) {
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

async function finishProcessingCapture(paths, captureId) {
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
