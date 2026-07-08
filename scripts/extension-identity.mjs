import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(__dirname, "..");

export async function readExtensionManifest(rootDir = defaultRootDir) {
  const manifestPath = path.join(rootDir, "extension", "manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

export function deriveExtensionIdFromKey(manifestKey) {
  if (!manifestKey || typeof manifestKey !== "string") {
    throw new Error("extension/manifest.json is missing the public key field.");
  }

  const publicKey = Buffer.from(manifestKey, "base64");
  if (!publicKey.length) {
    throw new Error("extension/manifest.json has an empty public key field.");
  }

  return createHash("sha256")
    .update(publicKey)
    .digest()
    .subarray(0, 16)
    .toString("hex")
    .replace(/[0-9a-f]/g, (char) => String.fromCharCode(Number.parseInt(char, 16) + 97));
}

export async function getDefaultExtensionId(rootDir = defaultRootDir) {
  const manifest = await readExtensionManifest(rootDir);
  return deriveExtensionIdFromKey(manifest.key);
}

export async function getExtensionIdentity(rootDir = defaultRootDir) {
  const manifest = await readExtensionManifest(rootDir);
  const id = deriveExtensionIdFromKey(manifest.key);
  return {
    id,
    key: manifest.key
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || "id";
  const identity = await getExtensionIdentity();

  if (command === "id") {
    process.stdout.write(`${identity.id}\n`);
  } else if (command === "key") {
    process.stdout.write(`${identity.key}\n`);
  } else if (command === "json") {
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
  } else {
    throw new Error(`Unknown extension identity command: ${command}`);
  }
}
