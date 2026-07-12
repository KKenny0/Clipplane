import { deleteSecret } from "./secret-store.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CREDENTIALS = ["notionToken", "flomoWebhook"];

export async function deleteClipplaneCredentials(options = {}) {
  const removed = [];
  for (const name of CREDENTIALS) {
    await deleteSecret(name, options);
    removed.push(name);
  }
  return removed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  deleteClipplaneCredentials()
    .then((removed) => {
      process.stdout.write(`Removed ${removed.length} Clipplane credentials.\n`);
    })
    .catch((error) => {
      process.stderr.write(`Could not remove Clipplane credentials: ${error.message}\n`);
      process.exitCode = 1;
    });
}
