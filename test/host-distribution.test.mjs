import assert from "node:assert/strict";
import test from "node:test";
import { getHostAsset, getHostDownloadUrl, getHostRelease } from "../extension/src/host-distribution.js";

test("unpublished Host installers never produce public download links", () => {
  assert.equal(getHostAsset("win", "x86-64", "0.5.0"), null);
  assert.equal(getHostAsset("win", "x86-64", "0.6.0"), null);
  assert.equal(getHostDownloadUrl("mac", "arm64", "0.6.0"), null);
});

test("the mutable 0.7.6 release never produces an automatic Host link", () => {
  assert.equal(getHostDownloadUrl("mac", "arm64", "0.7.6"), null);
  assert.equal(getHostAsset("win", "x86-64", "0.7.6"), null);
});

test("0.7.7 points only to the immutable, identity-pinned macOS Host release", () => {
  const release = getHostRelease("mac", "arm64", "0.7.7");
  assert.deepEqual(release, {
    releaseTag: "v0.7.7",
    asset: "clipplane-host-v0.7.6-macos-arm64.pkg",
    hostVersion: "0.7.6",
    sha256: "2d2c2c6fe89bbe1f67e37388b2c8b1905a9092a14c2a230954097f19bf9fa4d6",
    appleTeamId: "S7V7CK2G9T"
  });
  assert.equal(
    getHostDownloadUrl("mac", "arm64", "0.7.7"),
    "https://github.com/KKenny0/Clipplane/releases/download/v0.7.7/clipplane-host-v0.7.6-macos-arm64.pkg"
  );
  assert.equal(getHostAsset("win", "x86-64", "0.7.7"), null);
  assert.equal(getHostAsset("mac", "x86-64", "0.7.7"), null);
});

test("published Host download URLs require exact immutable assets", () => {
  const options = {
    publishedReleases: new Map([
      ["win:x86-64:0.7.5", { releaseTag: "v0.7.5", asset: "clipplane-host-v0.7.5-windows-x64.exe" }],
      ["mac:arm64:0.7.5", {
        releaseTag: "v0.7.5",
        asset: "clipplane-host-v0.7.5-macos-arm64.pkg",
        hostVersion: "0.7.5",
        sha256: "a".repeat(64),
        appleTeamId: "A1B2C3D4E5"
      }]
    ])
  };
  assert.equal(getHostAsset("win", "x86-64", "0.7.5", options), null);
  assert.equal(
    getHostDownloadUrl("mac", "arm64", "0.7.5", options),
    "https://github.com/KKenny0/Clipplane/releases/download/v0.7.5/clipplane-host-v0.7.5-macos-arm64.pkg"
  );
  assert.equal(getHostDownloadUrl("win", "arm64", "0.7.5", options), null);
  assert.equal(getHostDownloadUrl("mac", "x86-64", "0.7.5", options), null);
  assert.equal(getHostDownloadUrl("linux", "x86-64", "0.7.5", options), null);
});

test("a version alone never makes an unpublished platform asset public", () => {
  const options = {
    publishedReleases: new Map([
      ["mac:arm64:0.7.5", { releaseTag: "v0.7.5", asset: "clipplane-host-v0.7.5-macos-arm64.pkg" }]
    ])
  };
  assert.equal(getHostAsset("win", "x86-64", "0.7.5", options), null);
  assert.equal(getHostAsset("mac", "arm64", "0.7.5", options), null);
});
