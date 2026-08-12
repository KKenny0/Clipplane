import fs from "node:fs/promises";
import { withCaptureMutationLock } from "./capture-lock.mjs";
import { resolveCaptureBodyForRead, withRuntimeCapturePaths } from "./capture-record.mjs";
import { assertCaptureStoreWritable, captureRecords, readCaptureStore, writeCaptureStore } from "./capture-store.mjs";
import { ClipplaneError } from "./clip-core.mjs";
import { configuredExternalSinks, getSecretStatus, resolveConfiguredPaths, resolveSyncSecrets } from "./config.mjs";
import { prepareCaptureStorage } from "./inbox-migration.mjs";
import { syncFlomoApi } from "./sinks/flomo-api.mjs";
import { syncLocalExport } from "./sinks/local-export.mjs";
import { syncNotionApi } from "./sinks/notion-api.mjs";
import { captureDocumentMarkdown } from "./capture-document.mjs";

const SINKS = {
  "local-export": syncLocalExport,
  "notion-api": syncNotionApi,
  "flomo-api": syncFlomoApi
};

export async function getSyncStatus(options = {}) {
  const { paths, config } = await resolveConfiguredPaths(options);
  const secretStatus = await getSecretStatus(config, options);

  return {
    ok: true,
    config_path: paths.configPath,
    storage: {
      notes_dir: paths.notesDir,
      default_notes_dir: paths.defaultNotesDir,
      using_env_override: paths.usingEnvNotesDir
    },
    default_sinks: config.sync.defaultSinks,
    sinks: {
      "local-export": {
        enabled: Boolean(config.sinks["local-export"]?.enabled),
        configured: true
      },
      "notion-api": {
        enabled: Boolean(config.sinks["notion-api"]?.enabled),
        configured: Boolean(config.sinks["notion-api"]?.parentId && secretStatus.notionToken),
        credential_migration_required: Boolean(config.sinks["notion-api"]?.token)
      },
      "flomo-api": {
        enabled: Boolean(config.sinks["flomo-api"]?.enabled),
        configured: secretStatus.flomoWebhook,
        credential_migration_required: Boolean(config.sinks["flomo-api"]?.webhookUrl)
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
  const { paths, config } = await resolveConfiguredPaths(options);
  return withCaptureMutationLock(paths, () => syncCaptureLocked(captureId, options, paths, config));
}

async function syncCaptureLocked(captureId, options, paths, config) {
  await prepareCaptureStorage(paths);
  const store = await readCaptureStore(paths.capturesPath);
  assertCaptureStoreWritable(store.entries);
  const records = captureRecords(store);
  const index = records.findIndex((record) => record.capture_id === captureId);

  if (index < 0) {
    throw new ClipplaneError("capture_not_found", `Capture not found: ${captureId}`);
  }

  const capture = records[index];
  const markdown = await readCaptureMarkdown(capture, paths);
  const sinkNames = chooseSinkNames(options.sinks, config);
  const secrets = sinkNames.some((name) => name === "notion-api" || name === "flomo-api")
    ? await resolveSyncSecrets(config, options)
    : {};
  const results = [];

  if (!sinkNames.length) {
    return {
      ok: true,
      status: "no_sinks",
      requested: [],
      results,
      capture: withRuntimeCapturePaths(capture, paths)
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
        secrets,
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
  const entry = store.entries.find((candidate) => candidate.record === capture);
  entry.record = updatedCapture;
  await writeCaptureStore(paths.capturesPath, store.entries);

  return {
    ok: true,
    status: updatedCapture.sync_status,
    requested: sinkNames,
    results,
    capture: withRuntimeCapturePaths(updatedCapture, paths)
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

async function readCaptureMarkdown(capture, paths) {
  return captureDocumentMarkdown(await fs.readFile(await resolveCaptureBodyForRead(paths, capture.capture_id), "utf8"), capture.capture_id);
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
