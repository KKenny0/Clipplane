import fs from "node:fs/promises";
import path from "node:path";
import { ClipplaneError } from "./clip-core.mjs";
import { resolveConfiguredPaths } from "./config.mjs";
import { openFolder } from "./settings-core.mjs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listCaptureHistory(options = {}) {
  const { paths } = await resolveConfiguredPaths(options);
  const { records, warnings } = await readCaptureRecords(paths.capturesPath);
  const limit = normalizeLimit(options.limit);
  const recentRecords = records
    .sort((a, b) => timestampValue(b.clipped_at) - timestampValue(a.clipped_at))
    .slice(0, limit);

  const items = [];
  for (const record of recentRecords) {
    items.push(await summarizeCapture(record, paths));
  }

  return {
    ok: true,
    history: {
      items,
      warnings
    }
  };
}

export async function openCaptureBody(captureId, options = {}) {
  const id = cleanString(captureId);
  if (!id) {
    throw new ClipplaneError("missing_capture_id", "Capture ID is required.");
  }

  const { paths } = await resolveConfiguredPaths(options);
  const { records } = await readCaptureRecords(paths.capturesPath);
  const capture = records.find((record) => record.capture_id === id);
  if (!capture) {
    throw new ClipplaneError("capture_not_found", `Capture not found: ${id}`);
  }

  const contentPath = safeCaptureBodyPath(capture, paths);
  await fs.access(contentPath);
  await (options.openFolderImpl || openFolder)(contentPath, options);

  return {
    ok: true,
    capture_id: id,
    path: contentPath,
    opened_at: new Date().toISOString()
  };
}

async function summarizeCapture(record, paths) {
  const contentPath = safeCaptureBodyPath(record, paths, { allowMissing: true });
  const contentExists = contentPath ? await fileExists(contentPath) : false;

  return {
    capture_id: cleanString(record.capture_id),
    title: cleanString(record.title) || "Untitled",
    source_url: cleanString(record.source_url),
    source_host: sourceHost(record.source_url),
    input_type: record.input_type === "selection" ? "selection" : "page",
    clipped_at: cleanString(record.clipped_at),
    tags: Array.isArray(record.tags) ? record.tags.map(cleanString).filter(Boolean).slice(0, 8) : [],
    sync_status: cleanString(record.sync_status) || "local_saved",
    content_path: contentPath || "",
    content_exists: contentExists,
    sinks: publicSinks(record.sinks)
  };
}

async function readCaptureRecords(capturesPath) {
  let text;
  try {
    text = await fs.readFile(capturesPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { records: [], warnings: [] };
    }
    throw error;
  }

  const records = [];
  const warnings = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && cleanString(record.capture_id)) {
        records.push(record);
      } else {
        warnings.push({ line: index + 1, code: "invalid_record" });
      }
    } catch {
      warnings.push({ line: index + 1, code: "invalid_json" });
    }
  }

  return { records, warnings };
}

function safeCaptureBodyPath(record, paths, options = {}) {
  const candidate = cleanString(record.content_path)
    || path.join(paths.captureBodiesDir, `${cleanString(record.capture_id)}.md`);
  const resolved = path.resolve(candidate);
  const notesRoot = path.resolve(paths.notesDir);
  const bodiesRoot = path.resolve(paths.captureBodiesDir);

  if (!isPathInside(resolved, notesRoot) || !isPathInside(resolved, bodiesRoot)) {
    if (options.allowMissing) {
      return "";
    }
    throw new ClipplaneError("unsafe_capture_path", "Capture body path is outside the Clipplane notes folder.");
  }

  return resolved;
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
