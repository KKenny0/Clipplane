import { ClipplaneError, openCaptureLedger } from "./capture-ledger.mjs";
import { withRuntimeCapturePaths } from "./capture-record.mjs";
import { sanitizeSourceUrl } from "./url-sanitizer.mjs";

export { ClipplaneError };

export async function clipPayload(payload, options = {}) {
  const normalized = normalizePayload(payload);
  const ledger = await openCaptureLedger(options);
  const { capture, duplicate, reactivated } = await ledger.create(normalized);

  return {
    ok: true,
    duplicate,
    reactivated,
    capture: withRuntimeCapturePaths(capture, ledger.paths)
  };
}

export function normalizePayload(payload = {}) {
  const sourceUrl = sanitizeSourceUrl(stringOr(payload.sourceUrl, "manual"));
  const sourceTitle = stringOr(payload.sourceTitle, sourceUrl);
  const contentMarkdown = cleanCapturedMarkdown(stringOr(payload.contentMarkdown || payload.contentText, ""));

  if (!contentMarkdown) {
    throw new ClipplaneError("empty_content", "Nothing to clip.");
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
    contentMarkdown,
    author: cleanMetadata(payload.author, 500),
    publishedAt: cleanMetadata(payload.publishedAt, 200),
    description: cleanMetadata(payload.description, 2000),
    siteName: cleanMetadata(payload.siteName, 500)
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

function cleanTitle(value) {
  const title = stringOr(value, "Untitled")
    .replace(/\s+/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim();
  return (title || "Untitled").slice(0, 120);
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

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function cleanMetadata(value, limit) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function isCaptureBoilerplateLine(line) {
  const text = line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

  return /^To view keyboard shortcuts, press question mark\s*View keyboard shortcuts\.?$/i.test(text);
}
