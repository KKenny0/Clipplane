import { deleteSecret, getSecret, setSecretVerified } from "./secret-store.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CREDENTIALS = ["notionToken", "flomoWebhook"];

export async function deleteClipplaneCredentials(options = {}) {
  const previousValues = new Map();
  for (const name of CREDENTIALS) {
    previousValues.set(name, await getSecret(name, options));
  }

  const removed = [];
  try {
    for (const name of CREDENTIALS) {
      if (previousValues.get(name) === null) continue;
      await deleteSecret(name, options);
      removed.push(name);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const name of removed.reverse()) {
      const value = previousValues.get(name);
      if (!value) continue;
      try {
        await setSecretVerified(name, value, options);
      } catch (rollbackError) {
        rollbackFailures.push(`${name}: ${rollbackError.message}`);
      }
    }
    const rollbackDetail = rollbackFailures.length
      ? ` Credential rollback failed: ${rollbackFailures.join("; ")}`
      : " Credentials were restored.";
    throw new Error(`Could not remove Clipplane credentials: ${error.message}.${rollbackDetail}`, { cause: error });
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
