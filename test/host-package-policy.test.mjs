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
  const installScript = await readFile(path.join(rootDir, "scripts", "install-bundled-host.ps1"), "utf8");
  const uninstallScript = await readFile(path.join(rootDir, "scripts", "uninstall-native-host.ps1"), "utf8");
  const packageScript = await readFile(path.join(rootDir, "scripts", "package-native-host-windows-installer.ps1"), "utf8");
  const installerSmoke = await readFile(path.join(rootDir, "scripts", "smoke-native-host-windows-installer.ps1"), "utf8");
  const ci = await readFile(path.join(rootDir, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(installer, /DefaultDirName=\{localappdata\}\\Clipplane Host/);
  assert.match(installer, /PrivilegesRequired=lowest/);
  assert.match(installer, /ArchitecturesAllowed=x64compatible and not arm64/);
  assert.match(installer, /SignTool=\{#SignToolName\}/);
  assert.match(installer, /SignedUninstaller=yes/);
  assert.match(installer, /RunHostScript\('install-host\.ps1', '-Browser all'/);
  assert.match(installer, /RunHostScript\('uninstall-host\.ps1', UninstallArguments/);
  assert.match(installer, /ParamCount/);
  assert.match(installer, /CompareText\(ParamStr\(Index\), '\/PRESERVECREDENTIALS'\)/);
  assert.match(installer, /UninstallArguments := UninstallArguments \+ ' -PreserveCredentials'/);
  assert.equal((installer.match(/-PreserveCredentials/g) || []).length, 1);
  assert.match(installer, /ResultCode <> 0/);
  assert.match(installer, /RaiseException\('Clipplane Host registration failed/);
  assert.match(installer, /Abort;/);
  assert.match(installScript, /Get-RegistrationState/);
  assert.match(installScript, /Restore-RegistrationState/);
  assert.match(installScript, /HasDefaultValue/);
  assert.match(installScript, /Rollback failures:/);
  assert.ok(
    uninstallScript.indexOf("& $nodePath $maintenance") < uninstallScript.indexOf("Remove-Item -LiteralPath $registryPath"),
    "credential cleanup must run before browser registration removal"
  );
  assert.match(uninstallScript, /Browser registrations were left unchanged/);
  assert.match(uninstallScript, /Get-RegistrationState/);
  assert.match(uninstallScript, /Restore-RegistrationState/);
  assert.match(uninstallScript, /Clipplane Host registration removal failed/);
  assert.match(uninstallScript, /Rollback failures:/);
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
  assert.doesNotMatch(packageScript, /npm run package:host:windows/);
  for (const required of [
    "allowed-origins.json",
    "runtime\\node.exe",
    "app\\native-host\\host.mjs",
    "app\\native-host\\credential-maintenance.mjs"
  ]) {
    assert.match(packageScript, new RegExp(required.replaceAll("\\", "\\\\")));
  }
  assert.match(ci, /choco install innosetup --version=6\.7\.1 --yes --no-progress/);
  assert.match(ci, /npm run smoke:host:windows:installer/);
  assert.match(installerSmoke, /Windows installer smoke tests can only run on Windows/);
  assert.match(installerSmoke, /Bundled install unexpectedly succeeded while Edge registration was denied/);
  assert.match(installerSmoke, /Bundled uninstall unexpectedly succeeded without credential maintenance/);
  assert.match(installerSmoke, /RegistryRights\]::Delete/);
  assert.match(installerSmoke, /Bundled uninstall unexpectedly succeeded while Edge registration deletion was denied/);
  assert.match(installerSmoke, /registration was not restored after the denied uninstall/);
  assert.equal((installerSmoke.match(/& \$installerPath \/VERYSILENT \/SUPPRESSMSGBOXES \/NORESTART/g) || []).length, 2);
  assert.equal((installerSmoke.match(/^  Assert-InstalledHost$/gm) || []).length, 2);
  assert.match(installerSmoke, /& \$uninstaller\.FullName \/VERYSILENT \/SUPPRESSMSGBOXES \/NORESTART \/PRESERVECREDENTIALS/);
  assert.match(installerSmoke, /& \$cleanupUninstaller\.FullName \/VERYSILENT \/SUPPRESSMSGBOXES \/NORESTART \/PRESERVECREDENTIALS/);
  assert.match(installerSmoke, /PASS Windows Host installer candidate smoke/);
  assert.ok(
    ci.indexOf("npm run smoke:host:windows:installer") < ci.indexOf("Upload unsigned Windows installer candidate"),
    "CI must smoke the installer before uploading it"
  );
});
