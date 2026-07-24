#!/usr/bin/env node
import { clipPayload, ClipplaneError } from "./clip-core.mjs";
import {
  copyCapture,
  deleteCapture,
  listCaptureHistory,
  markCaptureProcessed,
  openCaptureBody
} from "./history-core.mjs";
import { createNativeMessageParser, writeNativeMessage } from "./native-message.mjs";
import { getSettings, openNotesDir, setSettings } from "./settings-core.mjs";
import { getSyncStatus, syncCapture, syncClipResult } from "./sync-core.mjs";
import { HOST_VERSION, PROTOCOL_VERSION } from "./version.mjs";

const parser = createNativeMessageParser(async (message) => {
  const response = await handleMessage(message);
  writeNativeMessage(process.stdout, response);
});

process.stdin.on("data", parser);
process.stdin.on("error", (error) => {
  logError(error);
});

async function handleMessage(message) {
  try {
    if (message?.type === "status") {
      return {
        ...await getSyncStatus(),
        host_version: HOST_VERSION,
        protocol_version: PROTOCOL_VERSION
      };
    }

    if (message?.type === "get_config") {
      return await getSettings();
    }

    if (message?.type === "set_config") {
      return await setSettings(message.config || {});
    }

    if (message?.type === "open_notes_dir") {
      return await openNotesDir();
    }

    if (message?.type === "history") {
      return await listCaptureHistory({ limit: message.limit, lifecycle: message.lifecycle });
    }

    if (message?.type === "open_capture_body") {
      return await openCaptureBody(message.captureId);
    }

    if (message?.type === "copy_capture") {
      return await copyCapture(message.captureId, message.mode);
    }

    if (message?.type === "process_capture") {
      return await markCaptureProcessed(message.captureId);
    }

    if (message?.type === "delete_capture") {
      return await deleteCapture(message.captureId);
    }

    if (message?.type === "sync") {
      return await syncCapture(message.captureId, { sinks: message.sinks });
    }

    if (message?.type === "clip") {
      const clipResult = await clipPayload(message.payload);
      if (message.sync) {
        return await syncClipResult(clipResult, { sinks: message.sinks });
      }
      return clipResult;
    }

    throw new ClipplaneError("unknown_message", "Unsupported native host message.");
  } catch (error) {
    logError(error);
    return {
      ok: false,
      error: {
        code: error.code || "clip_failed",
        message: error.message || "Clip failed."
      }
    };
  }
}

function logError(error) {
  const line = `[clipplane] ${error.stack || error.message || String(error)}\n`;
  process.stderr.write(line);
}
