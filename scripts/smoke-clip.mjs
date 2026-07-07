import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clipPayload } from "../native-host/clip-core.mjs";

const notesDir = path.join(os.tmpdir(), `clipplane-smoke-${process.pid}`);
const configDir = path.join(os.tmpdir(), `clipplane-smoke-config-${process.pid}`);

const result = await clipPayload({
  inputType: "selection",
  sourceUrl: "https://example.com/article",
  sourceTitle: "Example Article",
  title: "Example Article",
  contentMarkdown: "# Example\n\nA short AI clipping smoke test."
}, { notesDir, configDir });

console.log(JSON.stringify(result, null, 2));
console.log(await fs.readFile(path.join(notesDir, "inbox.org"), "utf8"));
