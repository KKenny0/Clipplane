import assert from "node:assert/strict";
import test from "node:test";
import { validateStorePackage } from "../scripts/store-package-policy.mjs";

const requiredFiles = {
  "onboarding.css": "body {}",
  "onboarding.html": "<!doctype html>",
  "onboarding.js": "export {};",
  "src/background.js": "export {};",
  "src/host-distribution.js": "export {};",
  "src/sync-consent.js": "export {};",
  "src/dom-normalizer.js": "export {};",
  "src/element-capture-state.js": "export {};",
  "src/page-capture.js": "export {};",
  "vendor/Readability.js": "export {};",
  "vendor/Readability-LICENSE.md": "license"
};

test("store package policy accepts the reviewed manifest surface", () => {
  const files = packageFiles();
  assert.deepEqual(validateStorePackage(files, "0.5.0"), []);
});

test("store package policy rejects native binaries and remote code", () => {
  const files = packageFiles({
    "native-host/clipplane.exe": "binary",
    "src/remote.js": "import('https://example.com/code.js')"
  });
  const errors = validateStorePackage(files, "0.5.0");
  assert.ok(errors.some((error) => error.includes("clipplane.exe")));
  assert.ok(errors.some((error) => error.includes("remote dynamic import")));
});

function packageFiles(extra = {}) {
  return new Map(Object.entries({
    "manifest.json": JSON.stringify({
      version: "0.5.0",
      minimum_chrome_version: "102",
      permissions: ["activeTab", "contextMenus", "nativeMessaging", "scripting", "storage"]
    }),
    ...requiredFiles,
    ...extra
  }));
}
