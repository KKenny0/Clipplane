import assert from "node:assert/strict";
import test from "node:test";
import { getHostAsset, getHostDownloadUrl } from "../extension/src/host-distribution.js";

test("host download URLs are versioned GitHub Release assets", () => {
  assert.equal(getHostAsset("win", "x86-64", "0.5.0"), null);
  assert.equal(getHostAsset("win", "x86-64", "0.6.0"), "clipplane-host-v0.6.0-windows-x64.exe");
  assert.equal(
    getHostDownloadUrl("mac", "arm64", "0.6.0"),
    "https://github.com/KKenny0/Clipplane/releases/download/v0.6.0/clipplane-host-v0.6.0-macos-arm64.pkg"
  );
  assert.equal(getHostDownloadUrl("linux", "x86-64", "0.6.0"), null);
});
