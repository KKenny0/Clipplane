import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findForbiddenHostFiles, validateNode20Version } from "../scripts/host-package-policy.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Host package runtime stays on supported Node 20", () => {
  assert.doesNotThrow(() => validateNode20Version("v20.19.0"));
  assert.throws(() => validateNode20Version("v24.0.0"), /require Node 20/);
  assert.throws(() => validateNode20Version("v20.18.3"), /require Node 20/);
});

test("Host package policy rejects secrets, config, and test fixtures", () => {
  assert.deepEqual(findForbiddenHostFiles([
    "app/native-host/host.mjs",
    "app/.env.production",
    "app/test/fixture.json",
    "app/private.pem",
    "app/.clipplane/captures.jsonl"
  ]), [
    "app/.env.production",
    "app/test/fixture.json",
    "app/private.pem",
    "app/.clipplane/captures.jsonl"
  ]);
});

test("macOS distribution scripts keep credentials in a named keychain profile", async () => {
  const packageScript = await readFile(path.join(rootDir, "scripts", "package-native-host-macos-pkg.sh"), "utf8");
  const notarizeScript = await readFile(path.join(rootDir, "scripts", "notarize-native-host-macos-pkg.sh"), "utf8");

  assert.match(packageScript, /Developer ID Application/);
  assert.match(packageScript, /Developer ID Installer/);
  assert.match(packageScript, /--options runtime --timestamp/);
  assert.match(notarizeScript, /--keychain-profile/);
  assert.match(notarizeScript, /CLIPPLANE_NOTARY_SUBMISSION_ID/);
  assert.match(notarizeScript, /notarytool wait/);
  assert.doesNotMatch(notarizeScript, /--password|--apple-id/);
});

test("macOS source setup installs the Host outside privacy-protected source folders", async () => {
  const setupScript = await readFile(path.join(rootDir, "scripts", "setup-macos.sh"), "utf8");

  assert.match(setupScript, /install_root="\$install_parent\/Clipplane Host"/);
  assert.match(setupScript, /launcher_path="\$install_root\/clipplane-host"/);
  assert.doesNotMatch(setupScript, /launcher_path="\$host_dir\/clipplane-host"/);
  assert.doesNotMatch(setupScript, /cp -R "\$project_root\/native-host\/\."/);
});

test("Windows installer remains per-user, x64-only, and refuses unsigned public output", async () => {
  const installer = await readFile(path.join(rootDir, "installer", "windows", "clipplane-host.iss"), "utf8");
  const packageScript = await readFile(path.join(rootDir, "scripts", "package-native-host-windows-installer.ps1"), "utf8");

  assert.match(installer, /DefaultDirName=\{localappdata\}\\Clipplane Host/);
  assert.match(installer, /PrivilegesRequired=lowest/);
  assert.match(installer, /ArchitecturesAllowed=x64compatible and not arm64/);
  assert.match(installer, /SignTool=\{#SignToolName\}/);
  assert.match(installer, /SignedUninstaller=yes/);
  assert.match(installer, /RunHostScript\('install-host\.ps1', '-Browser all'/);
  assert.match(installer, /RunHostScript\('uninstall-host\.ps1', '-Browser all -HostRoot/);
  assert.match(installer, /ResultCode <> 0/);
  assert.match(installer, /RaiseException\('Clipplane Host registration failed/);
  assert.match(installer, /Abort;/);
  assert.match(packageScript, /\[switch\]\$AllowUnsigned/);
  assert.match(packageScript, /CLIPPLANE_WINDOWS_SIGNTOOL/);
  assert.match(packageScript, /signtool/i);
  assert.match(packageScript, /\/Sclipplane=/);
  assert.match(packageScript, /\/DSignToolName=clipplane/);
  assert.match(packageScript, /verify \/pa \/v \/tw/);
  assert.match(packageScript, /-candidate/);
  assert.match(packageScript, /-unsigned/);
  assert.match(packageScript, /Refusing to overwrite an existing public installer/);
  assert.match(packageScript, /Move-Item -LiteralPath \$installerPath -Destination \$publicInstallerPath/);
});
