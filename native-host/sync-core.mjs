import fs from "node:fs/promises";
import { getDefaultPaths, ClipplaneError } from "./clip-core.mjs";
import { configuredExternalSinks, readConfig } from "./config.mjs";
import { syncFlomoApi } from "./sinks/flomo-api.mjs";
import { syncLocalExport } from "./sinks/local-export.mjs";
import { syncNotionApi } from "./sinks/notion-api.mjs";

const SINKS = {
  "local-export": syncLocalExport,
  "notion-api": syncNotionApi,
  "flomo-api": syncFlomoApi
};

export async function getSyncStatus(options = {}) {
  const paths = getDefaultPaths(options.notesDir);
  const config = await readConfig(paths);

  return {
    ok: true,
    config_path: paths.configPath,
    default_sinks: config.sync.defaultSinks,
    sinks: {
      "local-export": {
        enabled: Boolean(config.sinks["local-export"]?.enabled),
        configured: true
      },
      "notion-api": {
        enabled: Boolean(config.sinks["notion-api"]?.enabled),
        configured: Boolean(config.sinks["notion-api"]?.parentId && process.env.CLIPPLANE_NOTION_TOKEN)
      },
      "flomo-api": {
        enabled: Boolean(config.sinks["flomo-api"]?.enabled),
        configured: Boolean(process.env.CLIPPLANE_FLOMO_WEBHOOK_URL)
      }
    }
  };
}

export async function syncClipResult(clipResult, options = {}) {
  if (!clipResult?.ok || !clipResult.capture?.capture_id) {
    return clipResult;
  }

  const sync = await syncCapture(clipResult.capture.capture_id, options);
  return {
    ...clipResult,
    capture: sync.capture || clipResult.capture,
    sync
  };
}

export async function syncCapture(captureId, options = {}) {
  const paths = getDefaultPaths(options.notesDir);
  const config = await readConfig(paths);
  const records = await readCaptureRecords(paths.capturesPath);
  const index = records.findIndex((record) => record.capture_id === captureId);

  if (index < 0) {
    throw new ClipplaneError("capture_not_found", `Capture not found: ${captureId}`);
  }

  const capture = records[index];
  const markdown = await readCaptureMarkdown(capture);
  const sinkNames = chooseSinkNames(options.sinks, config);
  const results = [];

  if (!sinkNames.length) {
    return {
      ok: true,
      status: "no_sinks",
      requested: [],
      results,
      capture
    };
  }

  for (const sinkName of sinkNames) {
    const syncSink = SINKS[sinkName];
    if (!syncSink) {
      results.push(markResult(sinkName, {
        status: "skipped",
        error_code: "unknown_sink",
        last_error: `Unknown sink: ${sinkName}`
      }));
      continue;
    }

    try {
      const result = await syncSink({
        capture,
        markdown,
        config,
        paths,
        fetchImpl: options.fetchImpl
      });
      results.push(markResult(sinkName, result));
    } catch (error) {
      results.push(markResult(sinkName, {
        status: "failed",
        error_code: error.code || "sync_failed",
        last_error: sanitizeError(error.message || String(error))
      }));
    }
  }

  const updatedCapture = updateCaptureSinks(capture, results);
  records[index] = updatedCapture;
  await writeCaptureRecords(paths.capturesPath, records);

  return {
    ok: true,
    status: updatedCapture.sync_status,
    requested: sinkNames,
    results,
    capture: updatedCapture
  };
}

export function chooseSinkNames(requested, config) {
  if (Array.isArray(requested) && requested.length) {
    return [...new Set(requested)];
  }

  if (Array.isArray(config.sync.defaultSinks) && config.sync.defaultSinks.length) {
    return [...new Set(config.sync.defaultSinks)];
  }

  return configuredExternalSinks(config);
}

async function readCaptureMarkdown(capture) {
  if (!capture.content_path) {
    throw new ClipplaneError("missing_capture_body", "Capture body is missing for this record.");
  }
  return fs.readFile(capture.content_path, "utf8");
}

async function readCaptureRecords(capturesPath) {
  let text;
  try {
    text = await fs.readFile(capturesPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function writeCaptureRecords(capturesPath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(capturesPath, `${body}\n`, "utf8");
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
      last_error: result.last_error || null,
      path: result.path || null
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

function markResult(sink, result) {
  return {
    sink,
    status: result.status,
    external_id: result.external_id || null,
    external_url: result.external_url || null,
    error_code: result.error_code || null,
    last_error: result.last_error ? sanitizeError(result.last_error) : null,
    path: result.path || null
  };
}

function sanitizeError(message) {
  return String(message || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/https:\/\/flomoapp\.com\/iwh\/[^\s)]+/g, "https://flomoapp.com/iwh/[redacted]");
}
