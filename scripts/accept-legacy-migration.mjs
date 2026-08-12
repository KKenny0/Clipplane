import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCaptureDocument } from "../native-host/capture-document.mjs";
import { inspectCaptureBody } from "../native-host/capture-record.mjs";
import { captureRecords, readCaptureStore } from "../native-host/capture-store.mjs";
import { parseMarkdownInbox } from "../native-host/inbox-markdown.mjs";
import { prepareCaptureStorage } from "../native-host/inbox-migration.mjs";
import { getDefaultPaths } from "../native-host/paths.mjs";

const source = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: node scripts/accept-legacy-migration.mjs <0.7.x-notes-dir> [copy-dir]");
const destination = path.resolve(process.argv[3] || path.join(os.tmpdir(), `clipplane-upgrade-${crypto.randomUUID()}`));
try { await fs.access(destination); throw new Error(`Acceptance destination already exists: ${destination}`); } catch (error) { if (error.code !== "ENOENT") throw error; }

await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-upgrade-config-"));
const paths = getDefaultPaths(destination, { configDir });
const orgBefore = await fs.readFile(paths.legacyInboxPath);
const recordsBefore = await fs.readFile(paths.capturesPath);
const beforeStore = await readCaptureStore(paths.capturesPath);
const beforeRecords = captureRecords(beforeStore);
const missingBefore = [];
for (const record of beforeRecords) {
  if (!["processed", "processing", "deleting", "deleted"].includes(record.lifecycle_status || "")
    && (await inspectCaptureBody(paths, record.capture_id)).state === "missing") missingBefore.push(record.capture_id);
}

const migration = await prepareCaptureStorage(paths);
const inbox = parseMarkdownInbox(await fs.readFile(paths.inboxPath, "utf8"));
const inboxIds = new Set(inbox.entries.map((entry) => entry.captureId));
const afterRecords = captureRecords(await readCaptureStore(paths.capturesPath));
const beforeIds = beforeRecords.map((record) => record.capture_id).sort();
const afterIds = afterRecords.map((record) => record.capture_id).sort();
if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) throw new Error("Capture record IDs changed during migration.");
let documentCount = 0;
let recoveredCount = 0;
for (const record of afterRecords) {
  const inspected = await inspectCaptureBody(paths, record.capture_id);
  if (inspected.state !== "available") continue;
  const document = parseCaptureDocument(await fs.readFile(inspected.path, "utf8"));
  if (document.format === 1) documentCount += 1;
  if (document.metadata?.recovery === "legacy_org") recoveredCount += 1;
  if (record.lifecycle_status === "processed" && inboxIds.has(record.capture_id)) throw new Error(`Processed capture was resurrected: ${record.capture_id}`);
  if (!["processed", "processing", "deleting", "deleted"].includes(record.lifecycle_status || "") && !inboxIds.has(record.capture_id)) {
    throw new Error(`Active capture is missing from inbox.md: ${record.capture_id}`);
  }
}
const availableAfter = (await Promise.all(afterRecords.map(async (record) => (await inspectCaptureBody(paths, record.capture_id)).state === "available"))).filter(Boolean).length;
if (documentCount !== availableAfter) throw new Error(`Expected ${availableAfter} Capture Documents, found ${documentCount}.`);
if (recoveredCount !== missingBefore.length) throw new Error(`Expected ${missingBefore.length} recovered bodies, found ${recoveredCount}.`);
if (!orgBefore.equals(await fs.readFile(paths.legacyInboxBackupPath))) throw new Error("Org backup does not match the source.");
if (!recordsBefore.equals(await fs.readFile(paths.legacyCapturesBackupPath))) throw new Error("Capture-record backup does not match the source.");

console.log(JSON.stringify({
  ok: true,
  source,
  acceptance_copy: destination,
  migration,
  records: beforeRecords.length,
  inbox_entries: inbox.entries.length,
  missing_before: missingBefore,
  capture_documents: documentCount,
  recovered_from_org: recoveredCount,
  source_org_sha256: sha256(orgBefore),
  records_sha256: sha256(recordsBefore)
}, null, 2));

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
