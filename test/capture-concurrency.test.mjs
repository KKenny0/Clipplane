import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clipPayload } from "../native-host/clip-core.mjs";
import { listCaptureHistory, markCaptureProcessed } from "../native-host/history-core.mjs";

test("concurrent clipping and lifecycle updates do not lose records", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-concurrency-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const victim = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/victim",
    title: "Victim",
    contentMarkdown: "Victim body"
  }, { notesDir, configDir });
  const newClips = Array.from({ length: 30 }, (_, index) => clipPayload({
    inputType: "selection",
    sourceUrl: `https://example.com/concurrent-${index}`,
    title: `Concurrent ${index}`,
    contentMarkdown: `Concurrent body ${index}`
  }, { notesDir, configDir }));

  await Promise.all([
    markCaptureProcessed(victim.capture.capture_id, { notesDir, configDir }),
    ...newClips
  ]);

  const capturesPath = path.join(notesDir, ".clipplane", "captures.jsonl");
  const records = (await fs.readFile(capturesPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const active = await listCaptureHistory({ notesDir, configDir, lifecycle: "active", limit: 50 });
  const processed = await listCaptureHistory({ notesDir, configDir, lifecycle: "processed" });

  assert.equal(records.length, 31);
  assert.equal(active.history.items.length, 30);
  assert.deepEqual(processed.history.items.map((item) => item.capture_id), [victim.capture.capture_id]);
  assert.equal(await fileExists(path.join(notesDir, ".clipplane", "capture-mutation.lock")), false);
});

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
