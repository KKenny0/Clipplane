import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(root, "docs");
const required = [
  "index.html",
  "privacy/index.html",
  "setup/index.html",
  "support/index.html",
  "releases/0.6.0/index.html",
  "assets/site.css",
  "assets/icon.png",
  "assets/popup.png",
  "assets/element.png",
  "assets/history.png",
  "assets/sync.png"
];
const forbidden = [
  [/localhost/i, "localhost reference"],
  [/file:\/\//i, "file URL"],
  [/example\.(com|org|net)/i, "test domain"],
  [/\[(?:SIGNED_HOST_RELEASE_URL|REVIEW_[A-Z_]+)\]/, "unresolved release placeholder"],
  [/(?:notion[_ -]?token|flomo[_ -]?webhook|client[_ -]?secret|private[_ -]?key)\s*[:=]\s*["']?[a-z0-9_\/-]{12,}/i, "assigned sensitive value"]
];
const errors = [];

for (const relative of required) {
  if (!existsSync(path.join(docs, relative))) errors.push(`Missing required file: docs/${relative}`);
}

const htmlFiles = (await walk(docs)).filter((file) => file.endsWith(".html"));
for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  const label = path.relative(root, file);
  for (const [pattern, reason] of forbidden) {
    if (pattern.test(source)) errors.push(`${label}: contains ${reason}`);
  }
  for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(?:mailto:|#)/.test(target)) continue;
    if (/^https?:/.test(target)) {
      if (!target.startsWith("https://")) errors.push(`${label}: external link must use HTTPS: ${target}`);
      continue;
    }
    const resolved = resolveLocal(file, target);
    if (!existsSync(resolved)) errors.push(`${label}: broken local target: ${target}`);
  }
}

const fixedUrls = [
  "https://kkenny0.github.io/Clipplane/privacy/",
  "https://kkenny0.github.io/Clipplane/setup/",
  "https://kkenny0.github.io/Clipplane/support/",
  "https://kkenny0.github.io/Clipplane/releases/0.6.0/"
];
if (new Set(fixedUrls).size !== fixedUrls.length || fixedUrls.some((url) => !url.startsWith("https://kkenny0.github.io/Clipplane/"))) {
  errors.push("Canonical Pages URLs are invalid.");
}

const activePages = ["index.html", "privacy/index.html", "setup/index.html", "support/index.html"];
for (const relative of activePages) {
  const source = await readFile(path.join(docs, relative), "utf8");
  if (source.includes("releases/0.6.0")) {
    errors.push(`docs/${relative}: must not promote the archived 0.6.0 release page.`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Verified ${htmlFiles.length} Pages entries and ${required.length} required files.`);
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

function resolveLocal(fromFile, target) {
  const clean = target.split(/[?#]/, 1)[0];
  const resolved = path.resolve(path.dirname(fromFile), clean);
  if (clean.endsWith("/")) return path.join(resolved, "index.html");
  return resolved;
}
