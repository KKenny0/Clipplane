#!/usr/bin/env node
import { clipPayload, ClipplaneError } from "./clip-core.mjs";
import { createNativeMessageParser, writeNativeMessage } from "./native-message.mjs";
import { getSyncStatus, syncCapture, syncClipResult } from "./sync-core.mjs";

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
      return await getSyncStatus();
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
