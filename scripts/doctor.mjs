import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDefaultPaths } from "../native-host/clip-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const checks = [
  ["extension manifest", path.join(root, "extension", "manifest.json")],
  ["native host", path.join(root, "native-host", "host.mjs")],
  ["native launcher", path.join(root, "native-host", "clipplane-host.cmd")]
];

let ok = true;
for (const [label, file] of checks) {
  const exists = fs.existsSync(file);
  ok &&= exists;
  console.log(`${exists ? "PASS" : "FAIL"} ${label}: ${file}`);
}

const paths = getDefaultPaths();
console.log(`INFO notes dir: ${paths.notesDir}`);
console.log(`INFO inbox: ${paths.inboxPath}`);
console.log(`INFO captures: ${paths.capturesPath}`);
console.log(`INFO platform: ${os.platform()}`);
console.log(`INFO node: ${process.version}`);

process.exitCode = ok ? 0 : 1;
