import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeNativeMessage } from "../native-host/native-message.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const args = process.argv.slice(2);
const target = readOptionalArgument(args, "--target") || (process.platform === "win32" ? "windows" : "macos");
const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
if (!["windows", "macos"].includes(target) || !arch) {
  throw new Error(`Unsupported Host smoke target: ${target} ${process.arch}`);
}
const bundleArg = readOptionalArgument(args, "--bundle")
  || path.join("dist", `clipplane-host-v${packageJson.version}-${target}-${arch}`);
const bundleDir = path.resolve(rootDir, bundleArg);
const launcher = path.join(bundleDir, process.platform === "win32" ? "clipplane-host.cmd" : "clipplane-host");

if (!existsSync(launcher)) {
  throw new Error(`Native Host bundle launcher not found: ${launcher}`);
}

const child = process.platform === "win32"
  ? spawn("cmd.exe", ["/d", "/s", "/c", launcher], { stdio: ["pipe", "pipe", "pipe"] })
  : spawn(launcher, [], { stdio: ["pipe", "pipe", "pipe"] });

const stdout = [];
const stderr = [];
child.stdout.on("data", (chunk) => stdout.push(chunk));
child.stderr.on("data", (chunk) => stderr.push(chunk));
child.stdin.end(encodeNativeMessage({ type: "status" }));

const exitCode = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("Native Host bundle smoke test timed out."));
  }, 10_000);
  child.once("error", reject);
  child.once("close", (code) => {
    clearTimeout(timeout);
    resolve(code);
  });
});

if (exitCode !== 0) {
  throw new Error(`Native Host bundle exited with ${exitCode}: ${Buffer.concat(stderr).toString("utf8").trim()}`);
}

const responseBuffer = Buffer.concat(stdout);
if (responseBuffer.length < 4) {
  throw new Error("Native Host bundle returned no framed response.");
}
const length = responseBuffer.readUInt32LE(0);
const response = JSON.parse(responseBuffer.subarray(4, 4 + length).toString("utf8"));

if (!response.ok || response.host_version !== packageJson.version || response.protocol_version !== 1) {
  throw new Error(`Unexpected Native Host status: ${JSON.stringify(response)}`);
}
if (/secret_|flomoapp\.com\/iwh\//i.test(JSON.stringify(response))) {
  throw new Error("Native Host status exposed credential material.");
}

console.log(`PASS Native Host bundle ${response.host_version}, protocol ${response.protocol_version}`);

function readOptionalArgument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}
