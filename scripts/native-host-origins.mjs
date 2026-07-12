import { fileURLToPath } from "node:url";
import { getDefaultExtensionId, LEGACY_EXTENSION_IDS } from "./extension-identity.mjs";

export async function getNativeHostExtensionIds(rootDir) {
  return [...new Set([await getDefaultExtensionId(rootDir), ...LEGACY_EXTENSION_IDS])];
}

export async function getNativeHostOrigins(rootDir) {
  return (await getNativeHostExtensionIds(rootDir)).map((id) => `chrome-extension://${id}/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || "json";
  const ids = await getNativeHostExtensionIds();
  if (command === "ids") {
    process.stdout.write(`${ids.join("\n")}\n`);
  } else if (command === "json") {
    process.stdout.write(`${JSON.stringify(ids.map((id) => `chrome-extension://${id}/`))}\n`);
  } else {
    throw new Error("Use ids or json.");
  }
}
