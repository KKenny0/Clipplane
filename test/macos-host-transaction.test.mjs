import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");

test("macOS Host install and uninstall restore browser registrations after partial failure", {
  skip: process.platform !== "darwin"
}, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clipplane-macos-transaction-"));
  const homeDir = path.join(tempDir, "home");
  const hostRoot = path.join(tempDir, "host");
  const runtimeDir = path.join(hostRoot, "runtime", "bin");
  const chromeManifest = path.join(homeDir, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", "com.clipplane.host.json");
  const edgeManifestDir = path.join(homeDir, "Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts");
  const edgeManifest = path.join(edgeManifestDir, "com.clipplane.host.json");

  await mkdir(runtimeDir, { recursive: true });
  await symlink(process.execPath, path.join(runtimeDir, "node"));
  await writeFile(path.join(hostRoot, "clipplane-host"), "#!/bin/sh\n", { mode: 0o755 });
  await chmod(path.join(hostRoot, "clipplane-host"), 0o755);
  await writeFile(path.join(hostRoot, "allowed-origins.json"), JSON.stringify({ allowed_origins: ["chrome-extension://example/"] }));
  await writeFile(path.join(hostRoot, "install-host.sh"), await readFile(path.join(rootDir, "scripts", "install-bundled-host-macos.sh")), { mode: 0o755 });
  await mkdir(path.dirname(chromeManifest), { recursive: true });
  await writeFile(chromeManifest, "previous chrome registration\n");
  await mkdir(path.dirname(edgeManifestDir), { recursive: true });
  await writeFile(edgeManifestDir, "blocks directory creation\n");

  const install = spawnSync(path.join(hostRoot, "install-host.sh"), ["--browser", "all"], {
    env: { ...process.env, HOME: homeDir },
    encoding: "utf8"
  });
  assert.notEqual(install.status, 0);
  assert.equal(await readFile(chromeManifest, "utf8"), "previous chrome registration\n");

  const uninstallRoot = path.join(tempDir, "missing-host");
  const manifestJson = JSON.stringify({ path: path.join(uninstallRoot, "clipplane-host") });
  await unlink(edgeManifestDir);
  await mkdir(edgeManifestDir, { recursive: true });
  await writeFile(chromeManifest, manifestJson);
  await writeFile(edgeManifest, manifestJson);
  const uninstall = spawnSync(path.join(rootDir, "scripts", "uninstall-native-host-macos.sh"), [
    "--browser", "all", "--host-root", uninstallRoot
  ], {
    env: { ...process.env, HOME: homeDir },
    encoding: "utf8"
  });
  assert.notEqual(uninstall.status, 0);
  assert.equal(await readFile(chromeManifest, "utf8"), manifestJson);
  assert.equal(await readFile(edgeManifest, "utf8"), manifestJson);
});
