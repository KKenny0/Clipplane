import path from "node:path";

const FORBIDDEN_NAMES = new Set([
  ".env", "com.clipplane.host.json", "captures.jsonl"
]);

const FORBIDDEN_EXTENSIONS = new Set([
  ".key", ".p12", ".pfx", ".pem"
]);

export function validateNode20Version(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`Could not parse Node version: ${version}`);
  }
  const [, major, minor] = match.map(Number);
  if (major !== 20 || minor < 19) {
    throw new Error(`Native Host bundles require Node 20.19 or later in the Node 20 line; got ${version.trim()}`);
  }
}

export function findNonSystemMacRuntimeDependencies(output) {
  return output.split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/, 1)[0])
    .filter((dependency) => dependency
      && !dependency.startsWith("/usr/lib/")
      && !dependency.startsWith("/System/Library/"));
}

export function findForbiddenHostFiles(names) {
  return names
    .map((name) => name.replaceAll("\\", "/").replace(/^\.\//, ""))
    .filter((name) => {
      const lower = name.toLowerCase();
      const base = path.posix.basename(lower);
      return FORBIDDEN_NAMES.has(base)
        || base.startsWith(".env")
        || FORBIDDEN_EXTENSIONS.has(path.posix.extname(base))
        || lower.includes("/test/")
        || lower.includes("/tests/")
        || lower.includes("/fixtures/")
        || lower.includes("/.clipplane/")
        || lower.startsWith(".clipplane/");
    });
}
