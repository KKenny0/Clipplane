import path from "node:path";

const REQUIRED_FILES = new Set([
  "manifest.json",
  "brand.css",
  "onboarding.css",
  "onboarding.html",
  "onboarding.js",
  "src/background.js",
  "src/host-distribution.js",
  "src/sync-consent.js",
  "src/dom-normalizer.js",
  "src/element-capture-state.js",
  "src/page-capture.js",
  "vendor/readability.js",
  "vendor/readability-license.md"
]);

const EXPECTED_PERMISSIONS = [
  "activeTab",
  "contextMenus",
  "nativeMessaging",
  "scripting",
  "storage"
];

const FORBIDDEN_EXTENSIONS = new Set([
  ".bat", ".cmd", ".dll", ".exe", ".key", ".node", ".p12", ".pfx", ".pem", ".ps1", ".sh"
]);

export function validateStorePackage(files, packageVersion) {
  const names = [...files.keys()].map(normalizeArchivePath);
  const errors = [];

  for (const required of REQUIRED_FILES) {
    if (!names.includes(required)) {
      errors.push(`Missing required file: ${required}`);
    }
  }

  for (const name of names) {
    const base = path.posix.basename(name).toLowerCase();
    const extension = path.posix.extname(base);
    if (
      FORBIDDEN_EXTENSIONS.has(extension)
      || base.startsWith(".env")
      || name.startsWith(".clipplane/")
      || name.includes("/.clipplane/")
      || name.includes("__macosx/")
      || name.includes("node_modules/")
      || name === "com.clipplane.host.json"
    ) {
      errors.push(`Forbidden packaged file: ${name}`);
    }
  }

  const manifestText = getFile(files, "manifest.json");
  if (!manifestText) {
    return errors;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    errors.push("manifest.json is not valid JSON");
    return errors;
  }

  if (manifest.version !== packageVersion) {
    errors.push(`Manifest version ${manifest.version} does not match package version ${packageVersion}`);
  }
  if (manifest.minimum_chrome_version !== "102") {
    errors.push("minimum_chrome_version must be 102");
  }
  if (Object.hasOwn(manifest, "key")) {
    errors.push("manifest.json must not contain a key field in a Chrome Web Store package");
  }
  if (manifest.host_permissions?.length) {
    errors.push("host_permissions must remain empty");
  }
  if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify([...EXPECTED_PERMISSIONS].sort())) {
    errors.push("Manifest permissions differ from the reviewed permission set");
  }

  for (const [rawName, content] of files) {
    const name = normalizeArchivePath(rawName);
    if (!/\.(?:html|js|mjs)$/i.test(name)) {
      continue;
    }
    const checks = [
      [/\b(?:eval|Function)\s*\(/, "dynamic code execution"],
      [/\bimportScripts\s*\(\s*["']https?:\/\//i, "remote importScripts"],
      [/\bimport\s*\(\s*["']https?:\/\//i, "remote dynamic import"],
      [/<script[^>]+src\s*=\s*["']https?:\/\//i, "remote script source"]
    ];
    for (const [pattern, label] of checks) {
      if (pattern.test(content)) {
        errors.push(`${label} detected in ${name}`);
      }
    }
  }

  return errors;
}

function normalizeArchivePath(name) {
  return name.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function getFile(files, target) {
  for (const [name, content] of files) {
    if (normalizeArchivePath(name) === target) {
      return content;
    }
  }
  return null;
}
