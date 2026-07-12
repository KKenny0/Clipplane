import assert from "node:assert/strict";
import test from "node:test";
import { getHostAsset, getHostDownloadUrl } from "../extension/src/host-distribution.js";

test("unpublished Host installers never produce public download links", () => {
  assert.equal(getHostAsset("win", "x86-64", "0.5.0"), null);
  assert.equal(getHostAsset("win", "x86-64", "0.6.0"), null);
  assert.equal(getHostDownloadUrl("mac", "arm64", "0.6.0"), null);
});

test("published Host download URLs use immutable versioned assets", () => {
  const options = { publishedVersions: new Set(["0.6.0"]) };
  assert.equal(
    getHostAsset("win", "x86-64", "0.6.0", options),
    "clipplane-host-v0.6.0-windows-x64.exe"
  );
  assert.equal(
    getHostDownloadUrl("mac", "arm64", "0.6.0", options),
    "https://github.com/KKenny0/Clipplane/releases/download/v0.6.0/clipplane-host-v0.6.0-macos-arm64.pkg"
  );
  assert.equal(getHostDownloadUrl("linux", "x86-64", "0.6.0", options), null);
});
