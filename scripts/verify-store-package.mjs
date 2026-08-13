import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStorePackage } from "./store-package-policy.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const sourceManifest = JSON.parse(await readFile(path.join(rootDir, "extension", "manifest.json"), "utf8"));
const verifyExtension = process.argv.includes("--extension");
const packageName = verifyExtension ? "clipplane-extension" : "clipplane-store";
const archive = path.join(rootDir, "dist", `${packageName}-v${packageJson.version}.zip`);
const extractDir = await mkdtemp(path.join(os.tmpdir(), `${packageName}-package-`));

try {
  if (os.platform() === "win32") {
    const command = `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(extractDir)} -Force`;
    run("pwsh", ["-NoLogo", "-NoProfile", "-Command", command]);
  } else {
    run("unzip", ["-q", archive, "-d", extractDir]);
  }

  const files = new Map();
  for (const file of await walk(extractDir)) {
    const relative = path.relative(extractDir, file).replaceAll(path.sep, "/");
    files.set(relative, await readFile(file, "utf8"));
  }

  const errors = validateStorePackage(files, packageJson.version, {
    expectedManifestKey: verifyExtension ? sourceManifest.key : null
  });
  if (errors.length) {
    const label = verifyExtension ? "GitHub Release extension" : "Chrome Web Store";
    throw new Error(`${label} package verification failed:\n- ${errors.join("\n- ")}`);
  }

  console.log(`Verified ${path.relative(rootDir, archive)}`);
  console.log(`Files checked: ${files.size}`);
} finally {
  await rm(extractDir, { recursive: true, force: true });
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
