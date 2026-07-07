import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TAG_RULES = [
  { tag: "ai", patterns: [/ai\b/i, /llm/i, /agent/i, /model/i, /\u673a\u5668\u5b66\u4e60/, /\u5927\u6a21\u578b/] },
  { tag: "tech", patterns: [/code/i, /programming/i, /software/i, /api\b/i, /\u7f16\u7a0b/, /\u4ee3\u7801/, /\u5f00\u53d1/] },
  { tag: "biz", patterns: [/startup/i, /business/i, /market/i, /pricing/i, /\u521b\u4e1a/, /\u5546\u4e1a/, /\u6295\u8d44/] },
  { tag: "think", patterns: [/philosophy/i, /cognition/i, /reason/i, /\u54f2\u5b66/, /\u601d\u8003/, /\u8ba4\u77e5/] },
  { tag: "design", patterns: [/design/i, /ux\b/i, /ui\b/i, /\u8bbe\u8ba1/] },
  { tag: "life", patterns: [/habit/i, /life/i, /health/i, /\u751f\u6d3b/, /\u4e60\u60ef/, /\u5065\u5eb7/] },
  { tag: "read", patterns: [/book/i, /paper/i, /article/i, /reading/i, /\u8bfb\u4e66/, /\u8bba\u6587/, /\u9605\u8bfb/] }
];

const DEFAULT_NOTES_DIR = path.join(os.homedir(), "Documents", "notes");

export function getDefaultPaths(notesDir = process.env.CLIPPLANE_NOTES_DIR || DEFAULT_NOTES_DIR) {
  return {
    notesDir,
    inboxPath: path.join(notesDir, "inbox.org"),
    stateDir: path.join(notesDir, ".clipplane"),
    capturesPath: path.join(notesDir, ".clipplane", "captures.jsonl")
  };
}

export async function clipPayload(payload, options = {}) {
  const paths = getDefaultPaths(options.notesDir);
  const normalized = normalizePayload(payload);
  const contentHash = createContentHash(normalized);
  const existing = await findExistingCapture(paths.capturesPath, contentHash);

  if (existing) {
    return {
      ok: true,
      duplicate: true,
      capture: existing
    };
  }

  await fs.mkdir(paths.stateDir, { recursive: true });
  await ensureInbox(paths.inboxPath);

  const capture = buildCapture(normalized, contentHash, paths.inboxPath);
  const orgEntry = buildOrgEntry(capture, normalized.contentMarkdown);

  await fs.appendFile(paths.inboxPath, `\n${orgEntry}`, "utf8");
  await fs.appendFile(paths.capturesPath, `${JSON.stringify(capture)}\n`, "utf8");

  return {
    ok: true,
    duplicate: false,
    capture
  };
}

export function normalizePayload(payload = {}) {
  const sourceUrl = stringOr(payload.sourceUrl, "manual");
  const sourceTitle = stringOr(payload.sourceTitle, sourceUrl);
  const contentMarkdown = stringOr(payload.contentMarkdown || payload.contentText, "").trim();

  if (!contentMarkdown) {
    throw new ClipplaneError("empty_content", "Nothing to clip.");
  }

  const title = cleanTitle(stringOr(payload.title, sourceTitle));
  const inputType = payload.inputType === "selection" ? "selection" : "page";

  return {
    inputType,
    sourceUrl,
    sourceTitle,
    title,
    contentMarkdown
  };
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

export function markdownToOrg(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inFence = false;

  for (const rawLine of lines) {
    const fence = rawLine.match(/^```(\w+)?\s*$/);
    if (fence && !inFence) {
      inFence = true;
      out.push(`#+begin_src ${fence[1] || ""}`.trimEnd());
      continue;
    }
    if (fence && inFence) {
      inFence = false;
      out.push("#+end_src");
      continue;
    }

    if (inFence) {
      out.push(rawLine);
      continue;
    }

    const heading = rawLine.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push(`${"*".repeat(heading[1].length + 1)} ${heading[2].trim()}`);
      continue;
    }

    out.push(convertInlineMarkdown(rawLine));
  }

  return out.join("\n").trim();
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

async function ensureInbox(inboxPath) {
  try {
    await fs.access(inboxPath);
  } catch {
    const header = [
      "#+title: Inbox",
      "#+filetags: :inbox:",
      "#+startup: overview",
      "",
      "Inbox for all Clipplane captures.",
      ""
    ].join("\n");
    await fs.writeFile(inboxPath, header, "utf8");
  }
}

async function findExistingCapture(capturesPath, contentHash) {
  let text;
  try {
    text = await fs.readFile(capturesPath, "utf8");
  } catch {
    return null;
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record.content_hash === contentHash) {
        return record;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function buildCapture(normalized, contentHash, inboxPath) {
  const clippedAt = new Date();
  const tags = classifyTags(`${normalized.title}\n${normalized.contentMarkdown}`);
  const captureId = `${formatCompactTimestamp(clippedAt)}-${contentHash.slice(0, 10)}`;
  const orgHeading = `* ${normalized.title} :${tags.join(":")}:`;

  return {
    capture_id: captureId,
    source_url: normalized.sourceUrl,
    source_title: normalized.sourceTitle,
    title: normalized.title,
    input_type: normalized.inputType,
    clipped_at: clippedAt.toISOString(),
    org_timestamp: formatOrgTimestamp(clippedAt),
    content_hash: contentHash,
    tags,
    local_path: inboxPath,
    org_heading: orgHeading,
    sync_status: "local_saved",
    sinks: {
      local: { status: "saved", path: inboxPath }
    },
    error: null
  };
}

function buildOrgEntry(capture, markdown) {
  return [
    capture.org_heading,
    ":PROPERTIES:",
    `:CAPTURE_ID: ${capture.capture_id}`,
    `:CLIPPED: ${capture.org_timestamp}`,
    `:SOURCE: ${capture.source_url}`,
    ":STATUS: inbox",
    `:CONTENT_HASH: ${capture.content_hash}`,
    ":END:",
    "",
    markdownToOrg(markdown),
    ""
  ].join("\n");
}

function cleanTitle(value) {
  const title = stringOr(value, "Untitled")
    .replace(/\s+/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim();
  return (title || "Untitled").slice(0, 120);
}

function convertInlineMarkdown(line) {
  return line
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "[[$2][$1]]")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*");
}

function formatOrgTimestamp(date) {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `[${yyyy}-${mm}-${dd} ${weekdays[date.getDay()]} ${hh}:${min}]`;
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
