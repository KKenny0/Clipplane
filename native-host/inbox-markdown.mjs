import fs from "node:fs/promises";

const START_PATTERN = /^<!-- clipplane:capture:start id="([A-Za-z0-9_-]+)" -->$/;
const END_PATTERN = /^<!-- clipplane:capture:end id="([A-Za-z0-9_-]+)" -->$/;

export const MARKDOWN_INBOX_HEADER = [
  "# Inbox",
  "",
  "Clipplane captures waiting to be processed.",
  ""
].join("\n");

export async function ensureMarkdownInbox(inboxPath) {
  try {
    const text = await fs.readFile(inboxPath, "utf8");
    parseMarkdownInbox(text);
    return text;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.writeFile(inboxPath, MARKDOWN_INBOX_HEADER, { encoding: "utf8", flag: "wx" });
  return MARKDOWN_INBOX_HEADER;
}

export function renderMarkdownInboxEntry(capture, markdown) {
  const id = requireCaptureId(capture.capture_id);
  const tags = Array.isArray(capture.tags)
    ? capture.tags.map(cleanString).filter(Boolean).map((tag) => `\`${escapeInlineCode(tag)}\``).join(", ")
    : "";
  const source = cleanString(capture.source_url);
  const lines = [
    `<!-- clipplane:capture:start id="${id}" -->`,
    `## ${escapeHeading(cleanString(capture.title) || "Untitled")}`,
    "",
    `- Source: ${formatSource(source)}`,
    `- Clipped: \`${escapeInlineCode(cleanString(capture.clipped_at))}\``,
    `- Method: \`${escapeInlineCode(cleanString(capture.extraction_method) || "fallback")}\``
  ];
  if (tags) {
    lines.push(`- Tags: ${tags}`);
  }
  lines.push(
    "",
    escapeControlMarkers(markdown),
    `<!-- clipplane:capture:end id="${id}" -->`
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

export function parseMarkdownInbox(text) {
  const eol = String(text).includes("\r\n") ? "\r\n" : "\n";
  const lines = String(text).split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const [index, line] of lines.entries()) {
    const start = line.match(START_PATTERN);
    const end = line.match(END_PATTERN);
    if (start) {
      if (current) {
        throw inboxError("malformed_inbox_capture", `Capture ${current.captureId} has no closing marker.`);
      }
      current = { captureId: start[1], start: index };
      continue;
    }
    if (end) {
      if (!current) {
        throw inboxError("malformed_inbox_capture", `Capture ${end[1]} has a closing marker without a start.`);
      }
      if (end[1] !== current.captureId) {
        throw inboxError("malformed_inbox_capture", `Capture marker mismatch: ${current.captureId} and ${end[1]}.`);
      }
      entries.push({ ...current, end: index + 1 });
      current = null;
    }
  }

  if (current) {
    throw inboxError("malformed_inbox_capture", `Capture ${current.captureId} has no closing marker.`);
  }
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.captureId)) {
      throw inboxError("duplicate_inbox_capture", `Multiple inbox entries use Capture ID: ${entry.captureId}`);
    }
    seen.add(entry.captureId);
  }
  return { eol, lines, entries };
}

export async function readMarkdownInboxIds(inboxPath) {
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
  for (const entry of parseMarkdownInbox(text).entries) {
    ids.set(entry.captureId, (ids.get(entry.captureId) || 0) + 1);
  }
  return ids;
}

export async function appendMarkdownInboxEntry(inboxPath, capture, markdown) {
  const text = await ensureMarkdownInbox(inboxPath);
  const parsed = parseMarkdownInbox(text);
  const matches = parsed.entries.filter((entry) => entry.captureId === capture.capture_id);
  if (matches.length > 1) {
    throw inboxError("duplicate_inbox_capture", `Multiple inbox entries use Capture ID: ${capture.capture_id}`);
  }
  if (matches.length === 1) {
    return false;
  }

  const base = text.trimEnd();
  const next = `${base}\n\n${renderMarkdownInboxEntry(capture, markdown)}`;
  await atomicWrite(inboxPath, next, { expectedBody: text });
  return true;
}

export async function removeMarkdownInboxEntry(inboxPath, captureId) {
  let text;
  try {
    text = await fs.readFile(inboxPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const parsed = parseMarkdownInbox(text);
  const matches = parsed.entries.filter((entry) => entry.captureId === captureId);
  if (matches.length > 1) {
    throw inboxError("duplicate_inbox_capture", `Multiple inbox entries use Capture ID: ${captureId}`);
  }
  if (!matches.length) {
    return false;
  }

  const match = matches[0];
  const lines = [...parsed.lines];
  let start = match.start;
  let end = match.end;
  if (start > 0 && lines[start - 1] === "") {
    start -= 1;
  } else if (end < lines.length && lines[end] === "") {
    end += 1;
  }
  lines.splice(start, end - start);
  const next = `${lines.join(parsed.eol).trimEnd()}${parsed.eol}`;
  await atomicWrite(inboxPath, next, { expectedBody: text });
  return true;
}

export async function atomicWrite(filePath, body, options = {}) {
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
    await fs.writeFile(tempPath, body, { encoding: "utf8", mode, flag: "wx" });
    await fs.chmod(tempPath, mode);
    if (options.expectedBody !== undefined && await fs.readFile(filePath, "utf8") !== options.expectedBody) {
      throw inboxError("inbox_changed", "inbox.md changed during an update. Review it and try again.");
    }
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function escapeControlMarkers(markdown) {
  return String(markdown)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => START_PATTERN.test(line) || END_PATTERN.test(line) ? line.replace("<!--", "&lt;!--") : line)
    .join("\n")
    .trim();
}

function formatSource(source) {
  if (/^https?:\/\/\S+$/i.test(source) && !/[<>]/.test(source)) {
    return `<${source}>`;
  }
  return `\`${escapeInlineCode(source || "manual")}\``;
}

function escapeHeading(value) {
  return value.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

function escapeInlineCode(value) {
  return String(value).replace(/`/g, "'");
}

function requireCaptureId(value) {
  const id = cleanString(value);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw inboxError("invalid_capture_id", "Capture ID cannot be written to the Markdown inbox.");
  }
  return id;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function inboxError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
