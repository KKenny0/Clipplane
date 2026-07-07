import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clipPayload } from "../native-host/clip-core.mjs";
import { syncCapture } from "../native-host/sync-core.mjs";

const notesDir = path.join(os.tmpdir(), `clipplane-sync-smoke-${process.pid}`);

const clip = await clipPayload({
  inputType: "selection",
  sourceUrl: "https://example.com/sync-smoke",
  sourceTitle: "Sync Smoke",
  title: "Sync Smoke",
  contentMarkdown: "# Sync Smoke\n\nLocal export sync test."
}, { notesDir });

const sync = await syncCapture(clip.capture.capture_id, {
  notesDir,
  sinks: ["local-export"]
});

console.log(JSON.stringify(sync, null, 2));
console.log(await fs.readFile(sync.capture.sinks["local-export"].path, "utf8"));
