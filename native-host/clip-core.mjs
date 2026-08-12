import crypto from "node:crypto";
import { withCaptureMutationLock } from "./capture-lock.mjs";
import { finishCreatingCapture, finishReactivatingCapture, recoverCaptureWrites } from "./capture-creation.mjs";
import {
  assertSupportedCaptureRecord,
  ensureCaptureBody,
  inspectCaptureBody,
  withRuntimeCapturePaths,
  writeNewCaptureBody
} from "./capture-record.mjs";
import {
  appendCaptureRecord,
  assertCaptureStoreWritable,
  captureRecords,
  readCaptureStore,
  replaceCaptureRecord
} from "./capture-store.mjs";
import { resolveConfiguredPaths } from "./config.mjs";
import { getDefaultPaths } from "./paths.mjs";
import { appendMarkdownInboxEntry } from "./inbox-markdown.mjs";
import { prepareCaptureStorage } from "./inbox-migration.mjs";
import { sanitizeSourceUrl } from "./url-sanitizer.mjs";

const TAG_RULES = [
  { tag: "ai", patterns: [/ai\b/i, /llm/i, /agent/i, /model/i, /\u673a\u5668\u5b66\u4e60/, /\u5927\u6a21\u578b/] },
  { tag: "tech", patterns: [/code/i, /programming/i, /software/i, /api\b/i, /\u7f16\u7a0b/, /\u4ee3\u7801/, /\u5f00\u53d1/] },
  { tag: "biz", patterns: [/startup/i, /business/i, /market/i, /pricing/i, /\u521b\u4e1a/, /\u5546\u4e1a/, /\u6295\u8d44/] },
  { tag: "think", patterns: [/philosophy/i, /cognition/i, /reason/i, /\u54f2\u5b66/, /\u601d\u8003/, /\u8ba4\u77e5/] },
  { tag: "design", patterns: [/design/i, /ux\b/i, /ui\b/i, /\u8bbe\u8ba1/] },
  { tag: "life", patterns: [/habit/i, /life/i, /health/i, /\u751f\u6d3b/, /\u4e60\u60ef/, /\u5065\u5eb7/] },
  { tag: "read", patterns: [/book/i, /paper/i, /article/i, /reading/i, /\u8bfb\u4e66/, /\u8bba\u6587/, /\u9605\u8bfb/] }
];
export const MAX_CAPTURE_CONTENT_BYTES = 4 * 1024 * 1024;

export { getDefaultPaths };

export async function clipPayload(payload, options = {}) {
  const { paths } = await resolveConfiguredPaths(options);
  const normalized = normalizePayload(payload);
  return withCaptureMutationLock(paths, () => clipPayloadLocked(normalized, paths));
}

async function clipPayloadLocked(normalized, paths) {
  await prepareCaptureStorage(paths, { create: true });
  const recoveryWarnings = await recoverCaptureWrites(paths);
  if (recoveryWarnings.length) {
    throw new ClipplaneError("lifecycle_recovery_failed", "A previous capture could not be recovered. Open History before clipping again.");
  }
  const contentHash = createContentHash(normalized);
  const store = await readCaptureStore(paths.capturesPath);
  assertCaptureStoreWritable(store.entries);
  const existing = findExistingCapture(store, contentHash);

  if (existing) {
    assertSupportedCaptureRecord(existing);
    if (["processing", "deleting"].includes(existing.lifecycle_status)) {
      throw new ClipplaneError("capture_lifecycle_pending", "This capture has an unfinished History operation. Open History and try again.");
    }
    let capture = await ensureDuplicateCaptureBody(paths, existing, normalized.contentMarkdown);
    const reactivated = capture.lifecycle_status === "processed";
    if (reactivated) {
      capture = await reactivateCapture(paths, capture);
    }
    return {
      ok: true,
      duplicate: true,
      reactivated,
      capture: withRuntimeCapturePaths(capture, paths)
    };
  }

  const capture = await buildCapture(normalized, contentHash, paths, store);
  await appendCaptureRecord(paths.capturesPath, capture);
  await writeNewCaptureBody(paths, capture.capture_id, normalized.contentMarkdown);
  await appendMarkdownInboxEntry(paths.inboxPath, capture, normalized.contentMarkdown);
  const completed = await finishCreatingCapture(paths, capture.capture_id);

  return {
    ok: true,
    duplicate: false,
    capture: withRuntimeCapturePaths(completed, paths)
  };
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

export function normalizePayload(payload = {}) {
  const sourceUrl = sanitizeSourceUrl(stringOr(payload.sourceUrl, "manual"));
  const sourceTitle = stringOr(payload.sourceTitle, sourceUrl);
  const contentMarkdown = cleanCapturedMarkdown(stringOr(payload.contentMarkdown || payload.contentText, ""));

  if (!contentMarkdown) {
    throw new ClipplaneError("empty_content", "Nothing to clip.");
  }
  if (Buffer.byteLength(contentMarkdown, "utf8") > MAX_CAPTURE_CONTENT_BYTES) {
    throw new ClipplaneError(
      "capture_too_large",
      "This clip is too large to save safely. Try Selection or Element instead."
    );
  }

  const title = cleanTitle(stringOr(payload.title, sourceTitle));
  const inputType = ["selection", "element"].includes(payload.inputType) ? payload.inputType : "page";
  const extractionMethod = normalizeExtractionMethod(payload.extractionMethod, inputType);

  return {
    inputType,
    extractionMethod,
    sourceUrl,
    sourceTitle,
    title,
    contentMarkdown
  };
}

export function cleanCapturedMarkdown(markdown) {
  return String(markdown)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !isCaptureBoilerplateLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

export function createContentHash(normalized) {
  const body = [
    normalized.inputType,
    normalizeUrlForHash(normalized.sourceUrl),
    normalized.contentMarkdown.replace(/\s+/g, " ").trim()
  ].join("\n");
  return crypto.createHash("sha256").update(body).digest("hex");
}

export class ClipplaneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClipplaneError";
    this.code = code;
  }
}

function findExistingCapture(store, contentHash) {
  return captureRecords(store).find((record) => record.content_hash === contentHash) || null;
}

async function ensureDuplicateCaptureBody(paths, existing, markdown) {
  await ensureCaptureBody(paths, existing.capture_id, markdown);
  const updated = { ...existing };
  await replaceCaptureRecord(paths.capturesPath, updated);
  return updated;
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

function cleanTitle(value) {
  const title = stringOr(value, "Untitled")
    .replace(/\s+/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim();
  return (title || "Untitled").slice(0, 120);
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

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeExtractionMethod(value, inputType) {
  const allowed = new Set(["selection", "readability", "fallback", "element"]);
  if (allowed.has(value)) {
    return value;
  }
  if (inputType === "selection") {
    return "selection";
  }
  if (inputType === "element") {
    return "element";
  }
  return "fallback";
}

function isCaptureBoilerplateLine(line) {
  const text = line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

  return /^To view keyboard shortcuts, press question mark\s*View keyboard shortcuts\.?$/i.test(text);
}
