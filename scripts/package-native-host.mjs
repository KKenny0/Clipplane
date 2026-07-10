import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findForbiddenHostFiles, validateNode20Version } from "./host-package-policy.mjs";
import { getNativeHostOrigins } from "./native-host-origins.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const target = readTarget(process.argv.slice(2));
const expectedPlatform = target === "windows" ? "win32" : "darwin";

if (process.platform !== expectedPlatform) {
  throw new Error(`${target} Host bundles must be built on ${expectedPlatform} so native credential modules match the target.`);
}

const runtimeVersion = run(process.execPath, ["--version"], { capture: true }).stdout;
validateNode20Version(runtimeVersion);

const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
if (!arch) {
  throw new Error(`Unsupported Native Host architecture: ${process.arch}`);
}

const bundleName = `clipplane-host-v${packageJson.version}-${target}-${arch}`;
const stageDir = path.join(rootDir, "dist", bundleName);
const zipPath = `${stageDir}.zip`;
await rm(stageDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(path.join(stageDir, "app", "native-host"), { recursive: true });
await mkdir(path.join(stageDir, "runtime"), { recursive: true });

const nativeHostDir = path.join(rootDir, "native-host");
for (const source of await walkFiles(nativeHostDir)) {
  if (source.endsWith(".mjs")) {
    const relative = path.relative(nativeHostDir, source);
    const destination = path.join(stageDir, "app", "native-host", relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

await writeFile(path.join(stageDir, "app", "package.json"), `${JSON.stringify({
  name: packageJson.name,
  version: packageJson.version,
  private: true,
  type: "module",
  dependencies: packageJson.dependencies
}, null, 2)}\n`);

for (const dependencyPath of productionDependencyPaths()) {
  const relative = path.relative(rootDir, dependencyPath);
  await cp(dependencyPath, path.join(stageDir, "app", relative), { recursive: true });
}

if (target === "windows") {
  await cp(process.execPath, path.join(stageDir, "runtime", "node.exe"));
  await writeFile(path.join(stageDir, "clipplane-host.cmd"), [
    "@echo off",
    "setlocal",
    'set "BUNDLE_DIR=%~dp0"',
    '"%BUNDLE_DIR%runtime\\node.exe" "%BUNDLE_DIR%app\\native-host\\host.mjs"',
    ""
  ].join("\r\n"), "ascii");
} else {
  await mkdir(path.join(stageDir, "runtime", "bin"), { recursive: true });
  await cp(process.execPath, path.join(stageDir, "runtime", "bin", "node"));
  await writeFile(path.join(stageDir, "clipplane-host"), [
    "#!/usr/bin/env sh",
    "set -eu",
    'BUNDLE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    'exec "$BUNDLE_DIR/runtime/bin/node" "$BUNDLE_DIR/app/native-host/host.mjs"',
    ""
  ].join("\n"), { mode: 0o755 });
}

await writeFile(path.join(stageDir, "allowed-origins.json"), `${JSON.stringify({
  allowed_origins: await getNativeHostOrigins(rootDir)
}, null, 2)}\n`);

const stagedNames = await walkRelative(stageDir);
const forbidden = findForbiddenHostFiles(stagedNames);
if (forbidden.length) {
  throw new Error(`Refusing to package forbidden Host files:\n${forbidden.join("\n")}`);
}

if (target === "windows") {
  const archivePath = path.join(stageDir, "*");
  const command = `Compress-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(zipPath)} -Force`;
  run("pwsh", ["-NoLogo", "-NoProfile", "-Command", command]);
} else {
  run("zip", ["-qr", zipPath, "."], { cwd: stageDir });
}

console.log(`Wrote ${path.relative(rootDir, zipPath)}`);
console.log(`Runtime: ${runtimeVersion.trim()}`);
console.log(`Files checked: ${stagedNames.length}`);

function readTarget(args) {
  const index = args.indexOf("--target");
  const value = index >= 0 ? args[index + 1] : "";
  if (!["windows", "macos"].includes(value)) {
    throw new Error("Use --target windows or --target macos.");
  }
  return value;
}

function productionDependencyPaths() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("Run Native Host packaging through its npm script so npm can enumerate production dependencies.");
  }
  const output = run(process.execPath, [npmCli, "ls", "--omit=dev", "--all", "--parseable"], { capture: true }).stdout;
  return output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && path.resolve(line) !== rootDir);
}

async function walkRelative(directory, base = directory) {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      names.push(...await walkRelative(fullPath, base));
    } else if (entry.isFile()) {
      names.push(path.relative(base, fullPath).replaceAll(path.sep, "/"));
    }
  }
  return names;
}

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  return result;
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
