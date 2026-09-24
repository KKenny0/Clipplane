import { openCaptureLedger } from "./capture-ledger.mjs";
import { withRuntimeCapturePaths } from "./capture-record.mjs";
import { configuredExternalSinks, getSecretStatus, resolveConfiguredPaths, resolveSyncSecrets } from "./config.mjs";
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
  const ledger = await openCaptureLedger(options);
  const { capture, body } = await ledger.get(captureId, { withBody: true });
  const markdown = captureDocumentMarkdown(body, capture.capture_id);
  const config = ledger.config;
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
      capture: withRuntimeCapturePaths(capture, ledger.paths)
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
        paths: ledger.paths,
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

  const { capture: updatedCapture } = await ledger.applySyncResults(capture.capture_id, results);

  return {
    ok: true,
    status: updatedCapture.sync_status,
    requested: sinkNames,
    results,
    capture: withRuntimeCapturePaths(updatedCapture, ledger.paths)
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
