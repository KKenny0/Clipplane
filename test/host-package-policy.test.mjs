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
  const installScript = await readFile(path.join(rootDir, "scripts", "install-bundled-host-macos.sh"), "utf8");
  const uninstallScript = await readFile(path.join(rootDir, "scripts", "uninstall-native-host-macos.sh"), "utf8");

  assert.match(packageScript, /Developer ID Application/);
  assert.match(packageScript, /Developer ID Installer/);
  assert.match(packageScript, /--options runtime --timestamp/);
  assert.match(packageScript, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(packageScript, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.doesNotMatch(packageScript, /com\.apple\.security\.get-task-allow/);
  assert.match(packageScript, /smoke-native-host-bundle\.mjs --target macos --bundle "\$bundle_dir"/);
  assert.match(packageScript, /git status --porcelain --untracked-files=all/);
  assert.match(packageScript, /git ls-files --others --ignored --exclude-standard -- native-host/);
  assert.match(packageScript, /npm ci/);
  assert.match(packageScript, /sha256=/);
  assert.match(packageScript, /state=built/);
  assert.match(notarizeScript, /--keychain-profile/);
  assert.match(notarizeScript, /package-native-host-macos-pkg\.sh/);
  assert.match(notarizeScript, /notarytool submit/);
  assert.match(notarizeScript, /submitted_sha256/);
  assert.match(notarizeScript, /state=stapled/);
  assert.doesNotMatch(notarizeScript, /CLIPPLANE_NOTARY_SUBMISSION_ID/);
  assert.doesNotMatch(notarizeScript, /--password|--apple-id/);
  assert.match(installScript, /trap rollback EXIT/);
  assert.match(uninstallScript, /trap rollback EXIT/);
  assert.match(uninstallScript, /--remove-payload/);
  assert.match(uninstallScript, /pkgutil --forget com\.clipplane\.host/);
  assert.match(uninstallScript, /Left a non-Clipplane or newer Host registration unchanged/);
  assert.match(uninstallScript, /Preserved shared credentials because this was not an owned full Host uninstall/);
  assert.match(uninstallScript, /\/bin\/launchctl asuser/);
  assert.match(uninstallScript, /\/usr\/bin\/sudo -H -u/);
  assert.match(uninstallScript, /package payload or receipt cleanup failed/);
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
  const bundleSmoke = await readFile(path.join(rootDir, "scripts", "smoke-native-host-bundle.mjs"), "utf8");
  const ci = await readFile(path.join(rootDir, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(installer, /DefaultDirName=\{localappdata\}\\Clipplane Host/);
  assert.match(installer, /PrivilegesRequired=lowest/);
  assert.match(installer, /ArchitecturesAllowed=x64compatible and not arm64/);
  assert.match(installer, /SignTool=\{#SignToolName\}/);
  assert.match(installer, /SignedUninstaller=yes/);
  assert.match(installer, /RunHostScript\('install-host\.ps1', '-Browser all'/);
  assert.match(installer, /function PrepareToInstall\(var NeedsRestart: Boolean\): String;/);
  assert.match(installer, /CheckRegistrationWriteAccess\('Chrome', ChromeRegistrationKey\)/);
  assert.match(installer, /CheckRegistrationWriteAccess\('Edge', EdgeRegistrationKey\)/);
  assert.match(installer, /RunHostScript\('uninstall-host\.ps1', UninstallArguments/);
  assert.match(installer, /stage-uninstall-cleanup\.ps1/);
  assert.match(installer, /CurUninstallStep = usPostUninstall/);
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
    uninstallScript.indexOf("& $nodePath $maintenance") > uninstallScript.indexOf("Remove-Item -LiteralPath $registryPath"),
    "credential cleanup must run only after browser registration removal succeeds"
  );
  assert.match(uninstallScript, /Credential cleanup did not complete/);
  assert.match(uninstallScript, /Get-RegistrationState/);
  assert.match(uninstallScript, /Restore-RegistrationState/);
  assert.match(uninstallScript, /Clipplane Host registration removal failed/);
  assert.match(uninstallScript, /Rollback failures:/);
  assert.match(uninstallScript, /Left a non-Clipplane or newer Host registration unchanged/);
  assert.match(uninstallScript, /Preserved shared credentials because this was not an owned full Host uninstall/);
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
  assert.match(packageScript, /status --porcelain --untracked-files=all/);
  assert.match(packageScript, /ls-files --others --ignored --exclude-standard -- native-host/);
  assert.match(packageScript, /npm\.cmd ci/);
  assert.match(packageScript, /npm\.cmd run package:host:windows/);
  assert.match(packageScript, /smoke-native-host-bundle\.mjs/);
  assert.match(packageScript, /Get-BundleDigest/);
  assert.match(packageScript, /Source changed while the signed Windows installer was being built/);
  for (const required of [
    "allowed-origins.json",
    "stage-uninstall-cleanup.ps1",
    "runtime\\node.exe",
    "app\\native-host\\host.mjs",
    "app\\native-host\\credential-maintenance.mjs"
  ]) {
    assert.match(packageScript, new RegExp(required.replaceAll("\\", "\\\\")));
  }
  assert.match(ci, /choco install innosetup --version=6\.7\.1 --yes --no-progress/);
  assert.match(ci, /npm run smoke:host:windows:installer/);
  assert.match(installerSmoke, /Windows installer smoke tests can only run on Windows/);
  assert.match(installerSmoke, /\[string\]\$InstallerPath/);
  assert.match(installerSmoke, /Bundled uninstall unexpectedly succeeded without credential maintenance/);
  assert.match(installerSmoke, /Inno uninstaller removed a newer Chrome Host registration/);
  assert.match(installerSmoke, /Start-Process -FilePath \$Path -ArgumentList \$Arguments -Wait -PassThru/);
  assert.equal((installerSmoke.match(/Invoke-Installer \$installerPath/g) || []).length, 2);
  assert.equal((installerSmoke.match(/^  Assert-InstalledHost$/gm) || []).length, 2);
  assert.match(installerSmoke, /Invoke-Installer \$uninstaller\.FullName/);
  assert.match(installerSmoke, /Invoke-Installer \$cleanupUninstaller\.FullName/);
  assert.match(installerSmoke, /PASS Windows Host installer smoke/);
  assert.match(bundleSmoke, /`""\$\{launcher\}""`/);
  assert.ok(
    ci.indexOf("npm run smoke:host:windows:installer") < ci.indexOf("Upload unsigned Windows installer candidate"),
    "CI must smoke the installer before uploading it"
  );
});
