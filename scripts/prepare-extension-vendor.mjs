import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const sourceDir = path.join(rootDir, "node_modules", "@mozilla", "readability");
const vendorDir = path.join(rootDir, "extension", "vendor");

await mkdir(vendorDir, { recursive: true });
await copyFile(
  path.join(sourceDir, "Readability.js"),
  path.join(vendorDir, "Readability.js")
);
await copyFile(
  path.join(sourceDir, "LICENSE.md"),
  path.join(vendorDir, "Readability-LICENSE.md")
);

console.log("Prepared Mozilla Readability for the extension package.");
