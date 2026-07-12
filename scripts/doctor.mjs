import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfiguredPaths } from "../native-host/config.mjs";
import { getSyncStatus } from "../native-host/sync-core.mjs";
import { getDefaultExtensionId } from "./extension-identity.mjs";
import { getNativeHostOrigins } from "./native-host-origins.mjs";

const root = path.resolve(import.meta.dirname, "..");
const platform = os.platform();
let ok = true;
let defaultExtensionId = "";
let expectedNativeHostOrigins = [];

try {
  defaultExtensionId = await getDefaultExtensionId(root);
  expectedNativeHostOrigins = await getNativeHostOrigins(root);
  console.log(`PASS extension id: ${defaultExtensionId}`);
  console.log(`PASS native host origins: ${expectedNativeHostOrigins.join(", ")}`);
} catch (error) {
  ok = false;
  console.log(`FAIL extension id: ${error.message}`);
  console.log("NEXT ensure extension/manifest.json contains Clipplane's public manifest key.");
}

checkFile("extension manifest", path.join(root, "extension", "manifest.json"));
checkFile("native host", path.join(root, "native-host", "host.mjs"));

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor >= 20) {
  console.log(`PASS node: ${process.version}`);
} else {
  ok = false;
  console.log(`FAIL node: ${process.version} (Clipplane requires Node.js >=20)`);
  console.log("NEXT install Node.js 20 or newer, then run npm run doctor again.");
}

console.log(`INFO platform: ${platform}`);

if (platform === "win32") {
  checkFile("native launcher", path.join(root, "native-host", "clipplane-host.cmd"));
  checkWindowsRegistration("chrome");
  checkWindowsRegistration("edge");
} else if (platform === "darwin") {
  checkExecutable("native launcher", path.join(root, "native-host", "clipplane-host"));
  checkMacManifest("chrome");
  checkMacManifest("edge");
} else {
  console.log("WARN native host setup is documented for Windows and macOS only.");
}

const { paths } = await resolveConfiguredPaths();
console.log(`INFO notes dir: ${paths.notesDir}`);
console.log(`INFO inbox: ${paths.inboxPath}`);
console.log(`INFO captures: ${paths.capturesPath}`);
console.log(`INFO config: ${paths.configPath}`);

const sync = await getSyncStatus();
for (const [name, status] of Object.entries(sync.sinks)) {
  console.log(`INFO sink ${name}: enabled=${status.enabled} configured=${status.configured}`);
}

console.log("NEXT if the extension popup says Host unavailable, rerun the setup command for your browser.");
console.log("NEXT Notion and flomo can stay unconfigured unless you want Save + sync.");

process.exitCode = ok ? 0 : 1;

function checkFile(label, file) {
  const exists = fs.existsSync(file);
  ok &&= exists;
  console.log(`${exists ? "PASS" : "FAIL"} ${label}: ${file}`);
  return exists;
}

function checkExecutable(label, file) {
  const exists = checkFile(label, file);
  if (!exists) {
    console.log("NEXT run: bash scripts/setup-macos.sh --browser chrome");
    return false;
  }

  try {
    fs.accessSync(file, fs.constants.X_OK);
    console.log(`PASS ${label} executable: ${file}`);
    return true;
  } catch {
    ok = false;
    console.log(`FAIL ${label} is not executable: ${file}`);
    console.log("NEXT run: chmod +x native-host/clipplane-host");
    return false;
  }
}

function checkWindowsRegistration(browser) {
  const registryPath = browser === "chrome"
    ? "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.clipplane.host"
    : "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.clipplane.host";

  try {
    const output = execFileSync("reg", ["query", registryPath, "/ve"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const manifestPath = parseRegistryDefault(output);
    if (manifestPath && fs.existsSync(manifestPath)) {
      if (manifestHasExpectedOrigins(manifestPath)) {
        console.log(`PASS ${browser} native host registry: ${manifestPath}`);
      } else {
        console.log(`WARN ${browser} native host registry has stale or unexpected extension origins.`);
        console.log(`NEXT run: pwsh -NoLogo -NoProfile -File .\\scripts\\setup-windows.ps1 -Browser ${browser}`);
      }
      return;
    }
    console.log(`WARN ${browser} native host registry exists but manifest is missing: ${manifestPath || "(empty)"}`);
  } catch {
    console.log(`WARN ${browser} native host is not registered.`);
    console.log(`NEXT run: pwsh -NoLogo -NoProfile -File .\\scripts\\setup-windows.ps1 -Browser ${browser}`);
  }
}

function checkMacManifest(browser) {
  const manifestPath = browser === "chrome"
    ? path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", "com.clipplane.host.json")
    : path.join(os.homedir(), "Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts", "com.clipplane.host.json");

  if (fs.existsSync(manifestPath)) {
    if (manifestHasExpectedOrigins(manifestPath)) {
      console.log(`PASS ${browser} native host manifest: ${manifestPath}`);
    } else {
      console.log(`WARN ${browser} native host manifest has stale or unexpected extension origins.`);
      console.log(`NEXT run: bash scripts/setup-macos.sh --browser ${browser}`);
    }
    return;
  }

  console.log(`WARN ${browser} native host manifest is missing: ${manifestPath}`);
  console.log(`NEXT run: bash scripts/setup-macos.sh --browser ${browser}`);
}

function parseRegistryDefault(output) {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.includes("REG_SZ"));

  return line?.replace(/^.*REG_SZ\s+/, "").trim() || "";
}

function manifestHasExpectedOrigins(manifestPath) {
  if (!expectedNativeHostOrigins.length) {
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const actual = Array.isArray(manifest.allowed_origins) ? [...manifest.allowed_origins].sort() : [];
    const expected = [...expectedNativeHostOrigins].sort();
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}
