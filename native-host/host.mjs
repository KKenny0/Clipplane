#!/usr/bin/env node
import { clipPayload, ClipplaneError } from "./clip-core.mjs";
import { createNativeMessageParser, writeNativeMessage } from "./native-message.mjs";

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
    if (message?.type !== "clip") {
      throw new ClipplaneError("unknown_message", "Unsupported native host message.");
    }

    return await clipPayload(message.payload);
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
