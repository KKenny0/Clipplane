import assert from "node:assert/strict";
import test from "node:test";
import { getHostAsset, getHostDownloadUrl } from "../extension/src/host-distribution.js";

test("unpublished Host installers never produce public download links", () => {
  assert.equal(getHostAsset("win", "x86-64", "0.5.0"), null);
  assert.equal(getHostAsset("win", "x86-64", "0.6.0"), null);
  assert.equal(getHostDownloadUrl("mac", "arm64", "0.6.0"), null);
});

test("published Host download URLs require exact immutable assets", () => {
  const options = {
    publishedAssets: new Set([
      "clipplane-host-v0.7.5-windows-x64.exe",
      "clipplane-host-v0.7.5-macos-arm64.pkg"
    ])
  };
  assert.equal(
    getHostAsset("win", "x86-64", "0.7.5", options),
    "clipplane-host-v0.7.5-windows-x64.exe"
  );
  assert.equal(
    getHostDownloadUrl("mac", "arm64", "0.7.5", options),
    "https://github.com/KKenny0/Clipplane/releases/download/v0.7.5/clipplane-host-v0.7.5-macos-arm64.pkg"
  );
  assert.equal(getHostDownloadUrl("win", "arm64", "0.7.5", options), null);
  assert.equal(getHostDownloadUrl("mac", "x86-64", "0.7.5", options), null);
  assert.equal(getHostDownloadUrl("linux", "x86-64", "0.7.5", options), null);
});

test("a version alone never makes an unpublished platform asset public", () => {
  const options = { publishedAssets: new Set(["clipplane-host-v0.7.5-macos-arm64.pkg"]) };
  assert.equal(getHostAsset("win", "x86-64", "0.7.5", options), null);
});
