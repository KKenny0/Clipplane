import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStorePackage } from "./store-package-policy.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const archive = path.join(rootDir, "dist", `clipplane-store-v${packageJson.version}.zip`);
const extractDir = await mkdtemp(path.join(os.tmpdir(), "clipplane-store-package-"));

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

  const errors = validateStorePackage(files, packageJson.version);
  if (errors.length) {
    throw new Error(`Chrome Web Store package verification failed:\n- ${errors.join("\n- ")}`);
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
