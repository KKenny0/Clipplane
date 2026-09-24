import {
  ClipplaneError,
  openCaptureLedger
} from "./capture-ledger.mjs";
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
  const ledger = await openCaptureLedger(options);
  const { capture } = await ledger.markProcessed(captureId);
  return lifecycleResponse(capture, "processed");
}

export async function deleteCapture(captureId, options = {}) {
  const ledger = await openCaptureLedger(options);
  const { deletedAt } = await ledger.remove(captureId);

  return {
    ok: true,
    capture_id: cleanString(captureId),
    lifecycle_status: "deleted",
    deleted_at: deletedAt,
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
