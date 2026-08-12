const FORMAT_KEY = "clipplane_body_format";
export const CAPTURE_BODY_FORMAT = 1;
export const MAX_CAPTURE_DOCUMENT_BYTES = 4 * 1024 * 1024;

const STRING_LIMITS = {
  capture_id: 200,
  title: 500,
  source: 4096,
  author: 500,
  published: 200,
  created: 200,
  description: 2000,
  site_name: 500,
  capture_method: 100,
  recovery: 100
};

export function renderCaptureDocument(capture, markdown, options = {}) {
  const metadata = captureDocumentMetadata(capture, options);
  const lines = ["---", `${FORMAT_KEY}: ${CAPTURE_BODY_FORMAT}`];
  for (const key of ["capture_id", "title", "source", "author", "published", "created", "description", "site_name"]) {
    lines.push(`${key}: ${JSON.stringify(metadata[key])}`);
  }
  lines.push(`tags: ${JSON.stringify(metadata.tags)}`);
  lines.push(`capture_method: ${JSON.stringify(metadata.capture_method)}`);
  lines.push(`recovery: ${JSON.stringify(metadata.recovery)}`, "---", "");
  return `${lines.join("\n")}${String(markdown || "")}`;
}

export function parseCaptureDocument(value, expectedCaptureId = "") {
  const text = String(value || "");
  if (!text.startsWith("---\n")) {
    return { format: 0, markdown: text };
  }
  const boundary = text.indexOf("\n---\n", 4);
  if (boundary < 0) {
    return { format: 0, markdown: text };
  }
  const header = text.slice(4, boundary);
  if (!new RegExp(`^${FORMAT_KEY}:\\s*${CAPTURE_BODY_FORMAT}\\s*$`, "m").test(header)) {
    return { format: 0, markdown: text };
  }
  if (expectedCaptureId) {
    const idLine = header.match(/^capture_id:\s*(.*)$/m);
    let documentId = "";
    try { documentId = idLine ? JSON.parse(idLine[1]) : ""; } catch { return { format: 0, markdown: text }; }
    if (!documentId) return { format: 0, markdown: text };
    if (documentId !== expectedCaptureId) throw documentError("capture_document_id_mismatch", "Capture document ID does not match its managed file.");
  }
  const metadata = {};
  for (const line of header.split("\n")) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match || match[1] === FORMAT_KEY) continue;
    try { metadata[match[1]] = JSON.parse(match[2]); } catch { throw documentError("malformed_capture_document", "Capture document metadata is malformed."); }
  }
  return { format: CAPTURE_BODY_FORMAT, metadata, markdown: text.slice(boundary + 5) };
}

export function captureDocumentMarkdown(value, expectedCaptureId = "") {
  return parseCaptureDocument(value, expectedCaptureId).markdown;
}

export function isCaptureDocument(value, expectedCaptureId = "") {
  return parseCaptureDocument(value, expectedCaptureId).format === CAPTURE_BODY_FORMAT;
}

export function renderRecoveredOrgBody(orgBody) {
  const body = normalizeBody(orgBody);
  if (!body) throw documentError("legacy_capture_content_missing", "The legacy Inbox entry has no recoverable body.");
  const longest = Math.max(3, ...[...body.matchAll(/~+/g)].map((match) => match[0].length + 1));
  const fence = "~".repeat(longest);
  return `> Recovered from the original Clipplane Org Inbox.\n\n${fence}org\n${body}\n${fence}`;
}

function captureDocumentMetadata(capture, options) {
  const string = (key, value) => String(value || "").trim().slice(0, STRING_LIMITS[key]);
  return {
    capture_id: string("capture_id", capture.capture_id),
    title: string("title", capture.title) || "Untitled",
    source: string("source", capture.source_url),
    author: string("author", capture.author),
    published: string("published", capture.published_at),
    created: string("created", capture.clipped_at),
    description: string("description", capture.description),
    site_name: string("site_name", capture.site_name),
    tags: Array.isArray(capture.tags) ? capture.tags.map((tag) => String(tag).trim().slice(0, 100)).filter(Boolean).slice(0, 20) : [],
    capture_method: string("capture_method", capture.extraction_method),
    recovery: string("recovery", options.recovery || capture.recovery)
  };
}

function normalizeBody(value) { return String(value || "").replace(/\r\n/g, "\n").trim(); }
function documentError(code, message) { const error = new Error(message); error.code = code; return error; }
