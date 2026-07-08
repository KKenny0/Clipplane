import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultExtensionId } from "./extension-identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8"),
);

const version = packageJson.version;
const extensionDir = path.join(rootDir, "extension");
const distDir = path.join(rootDir, "dist");
const stageDir = path.join(distDir, `clipplane-extension-v${version}`);
const zipPath = path.join(distDir, `clipplane-extension-v${version}.zip`);

if (!existsSync(extensionDir)) {
  throw new Error(`Extension directory not found: ${extensionDir}`);
}

await rm(stageDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(distDir, { recursive: true });
await cp(extensionDir, stageDir, { recursive: true });
await assertNoForbiddenFiles(stageDir);

if (os.platform() === "win32") {
  const archivePath = path.join(stageDir, "*");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Compress-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(zipPath)} -Force`,
  ].join("; ");
  run("pwsh", ["-NoLogo", "-NoProfile", "-Command", command]);
} else {
  run("zip", ["-r", zipPath, "."], { cwd: stageDir });
}

console.log(`Wrote ${path.relative(rootDir, zipPath)}`);
console.log(`Extension ID: ${await getDefaultExtensionId(rootDir)}`);

async function assertNoForbiddenFiles(directory) {
  const forbidden = [];

  for (const file of await walk(directory)) {
    const relative = path.relative(directory, file).replaceAll(path.sep, "/");
    const name = path.basename(file).toLowerCase();

    if (
      name.endsWith(".pem") ||
      name.endsWith(".key") ||
      name.endsWith(".p12") ||
      name.endsWith(".pfx") ||
      name.startsWith(".env") ||
      relative.startsWith(".clipplane/") ||
      relative.includes("/.clipplane/") ||
      name === "com.clipplane.host.json" ||
      name === "clipplane-host.cmd" ||
      name === "clipplane-host"
    ) {
      forbidden.push(relative);
    }
  }

  if (forbidden.length) {
    throw new Error(`Refusing to package private or local-only files:\n${forbidden.join("\n")}`);
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile() || (await stat(fullPath)).isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });

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
