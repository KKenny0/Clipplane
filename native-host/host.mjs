#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { clipPayload } from "./clip-core.mjs";
import { ClipplaneError } from "./capture-ledger.mjs";
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

export const messageHandlers = new Map([
  ["status", async () => ({
    ...await getSyncStatus(),
    host_version: HOST_VERSION,
    protocol_version: PROTOCOL_VERSION
  })],
  ["get_config", (message) => getSettings()],
  ["set_config", (message) => setSettings(message.config || {})],
  ["open_notes_dir", () => openNotesDir()],
  ["history", (message) => listCaptureHistory({ limit: message.limit, lifecycle: message.lifecycle })],
  ["open_capture_body", (message) => openCaptureBody(message.captureId)],
  ["copy_capture", (message) => copyCapture(message.captureId, message.mode)],
  ["process_capture", (message) => markCaptureProcessed(message.captureId)],
  ["delete_capture", (message) => deleteCapture(message.captureId)],
  ["sync", (message) => syncCapture(message.captureId, { sinks: message.sinks })],
  ["clip", async (message) => {
    const clipResult = await clipPayload(message.payload);
    if (message.sync) {
      return await syncClipResult(clipResult, { sinks: message.sinks });
    }
    return clipResult;
  }]
]);

export async function handleMessage(message) {
  try {
    const handler = messageHandlers.get(message?.type);
    if (handler) {
      return await handler(message);
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

if (isMainModule()) {
  const parser = createNativeMessageParser(async (message) => {
    const response = await handleMessage(message);
    writeNativeMessage(process.stdout, response);
  });

  process.stdin.on("data", parser);
  process.stdin.on("error", (error) => {
    logError(error);
  });
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1] || "").href;
}

function logError(error) {
  const line = `[clipplane] ${error.stack || error.message || String(error)}\n`;
  process.stderr.write(line);
}
