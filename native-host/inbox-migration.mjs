import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { assertCaptureStoreWritable, captureRecords, readCaptureStore, writeCaptureStore } from "./capture-store.mjs";
import { captureBodyPath, inspectCaptureBody, resolveCaptureBodyForRead, writeNewCaptureBody } from "./capture-record.mjs";
import { isCaptureDocument, MAX_CAPTURE_DOCUMENT_BYTES, renderCaptureDocument, renderRecoveredOrgBody } from "./capture-document.mjs";
import {
  MARKDOWN_INBOX_HEADER,
  ensureMarkdownInbox,
  parseMarkdownInbox,
  renderMarkdownInboxEntry
} from "./inbox-markdown.mjs";

export async function prepareCaptureStorage(paths, options = {}) {
  await fs.mkdir(paths.notesDir, { recursive: true });
  await fs.mkdir(paths.stateDir, { recursive: true });
  const store = await readCaptureStore(paths.capturesPath);
  assertCaptureStoreWritable(store.entries);
  const [markdownExists, legacyExists, backupExists] = await Promise.all([
    fileExists(paths.inboxPath),
    fileExists(paths.legacyInboxPath),
    fileExists(paths.legacyInboxBackupPath)
  ]);

  if (markdownExists && legacyExists) {
    if (!backupExists) {
      throw migrationError(
        "multiple_inbox_formats",
        "Both inbox.md and inbox.org exist. Clipplane will not choose or overwrite either file."
      );
    }
    if (!await filesEqual(paths.legacyInboxPath, paths.legacyInboxBackupPath)) {
      throw migrationError("legacy_inbox_changed", "inbox.org differs from the archived migration source. Review both Inbox formats before continuing.");
    }
    parseMarkdownInbox(await fs.readFile(paths.inboxPath, "utf8"));
    await upgradeCaptureBodiesIfNeeded(paths, store);
    await upgradeCaptureRecords(paths.capturesPath);
    return { migrated: false, legacyRetained: true };
  }

  if (markdownExists) {
    parseMarkdownInbox(await fs.readFile(paths.inboxPath, "utf8"));
    await upgradeCaptureBodiesIfNeeded(paths, store);
    await upgradeCaptureRecords(paths.capturesPath);
    return { migrated: false };
  }

  if (legacyExists) {
    if (backupExists
      && store.entries.every((entry) => !entry.record || isCurrentCaptureRecord(entry.record))
      && (store.entries.some((entry) => entry.record) || await filesEqual(paths.legacyInboxPath, paths.legacyInboxBackupPath))) {
      await rebuildMarkdownInboxFromCurrentRecords(paths, store);
      return { migrated: false, archivePresent: true };
    }
    return migrateLegacyInbox(paths, paths.legacyInboxPath, { createBackup: true });
  }

  if (backupExists) {
    await rebuildMarkdownInboxFromCurrentRecords(paths, store);
    await upgradeCaptureRecords(paths.capturesPath);
    return { migrated: false, archivePresent: true };
  }

  if (!options.create && store.entries.length === 0) {
    return { migrated: false };
  }
  await ensureMarkdownInbox(paths.inboxPath);
  await upgradeCaptureRecords(paths.capturesPath);
  return { migrated: false };
}

function isCurrentCaptureRecord(record) {
  return record.schema_version === 3 && !record.org_heading && !record.org_timestamp;
}

async function rebuildMarkdownInboxFromCurrentRecords(paths, store) {
  const rendered = [];
  for (const record of captureRecords(store).filter(isActiveCaptureRecord)) {
    const inspected = await inspectCaptureBody(paths, record.capture_id);
    if (inspected.state === "unsafe") throw inspected.error;
    if (inspected.state === "missing") continue;
    const markdown = await fs.readFile(inspected.path, "utf8");
    rendered.push(renderMarkdownInboxEntry(record, markdown).trimEnd());
  }
  const markdownBody = `${MARKDOWN_INBOX_HEADER.trimEnd()}${rendered.length ? `\n\n${rendered.join("\n\n")}` : ""}\n`;
  parseMarkdownInbox(markdownBody);
  try {
    await fs.writeFile(paths.inboxPath, markdownBody, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw migrationError("multiple_inbox_formats", "inbox.md appeared while Clipplane was rebuilding it. No file was overwritten.");
    }
    throw error;
  }
}

function isActiveCaptureRecord(record) {
  return !["creating", "reactivating", "processed", "processing", "deleting", "deleted"].includes(cleanString(record.lifecycle_status));
}

export function parseLegacyOrgInbox(text) {
  const lines = String(text).split(/\r?\n/);
  const starts = [];
  for (const [index, line] of lines.entries()) {
    if (!/^\*\s+/.test(line) || lines[index + 1] !== ":PROPERTIES:") {
      continue;
    }
    const captureId = captureIdFromPropertyDrawer(lines, index + 1);
    if (captureId) {
      starts.push({ index, captureId });
    }
  }

  const entries = starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? lines.length;
    return { captureId: start.captureId, start: start.index, end };
  });

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.captureId)) {
      throw migrationError("duplicate_inbox_capture", `Multiple inbox entries use Capture ID: ${entry.captureId}`);
    }
    seen.add(entry.captureId);
  }
  const preambleEnd = starts[0]?.index ?? lines.length;
  const unmanagedPreamble = lines.slice(0, preambleEnd).some((line) => {
    const value = line.trim();
    return value && ![
      "#+title: Inbox",
      "#+filetags: :inbox:",
      "#+startup: overview",
      "Inbox for all Clipplane captures."
    ].includes(value);
  });
  if (unmanagedPreamble) {
    throw migrationError(
      "legacy_inbox_contains_unmanaged_entries",
      "inbox.org contains content outside Clipplane capture entries. Move it before migration."
    );
  }
  return entries;
}

function captureIdFromPropertyDrawer(lines, drawerStart) {
  let captureId = "";
  for (let index = drawerStart + 1; index < lines.length; index += 1) {
    if (lines[index] === ":END:") {
      return captureId;
    }
    const match = lines[index].match(/^:CAPTURE_ID:\s*(\S.*?)\s*$/);
    if (match) {
      if (captureId) {
        return "";
      }
      captureId = match[1];
    }
  }
  return "";
}

async function migrateLegacyInbox(paths, sourcePath, options) {
  const legacyText = await fs.readFile(sourcePath, "utf8");
  const legacyEntries = parseLegacyOrgInbox(legacyText);
  const store = await readCaptureStore(paths.capturesPath);
  const records = captureRecords(store);
  const recordsById = new Map();
  for (const record of records) {
    const id = cleanString(record.capture_id);
    if (recordsById.has(id)) {
      throw migrationError("duplicate_capture_record", `Multiple records use Capture ID: ${id}`);
    }
    recordsById.set(id, record);
  }

  if (options.createBackup) {
    await createImmutableBackup(paths.legacyInboxBackupPath, legacyText, "legacy_inbox_backup_conflict");
    const recordsText = await readOptionalText(paths.capturesPath);
    await createImmutableBackup(paths.legacyCapturesBackupPath, recordsText, "legacy_captures_backup_conflict");
  }

  await upgradeCaptureBodies(paths, store, { legacyText, legacyEntries });
  await markCaptureDocumentUpgrade(paths);

  const rendered = [];
  for (const legacyEntry of legacyEntries) {
    const record = recordsById.get(legacyEntry.captureId);
    if (!record) {
      throw migrationError("legacy_capture_record_missing", `Capture record is missing: ${legacyEntry.captureId}`);
    }
    const bodyPath = await resolveCaptureBodyForRead(paths, legacyEntry.captureId);
    const markdown = await fs.readFile(bodyPath, "utf8");
    rendered.push(renderMarkdownInboxEntry(record, markdown).trimEnd());
  }

  const markdownBody = `${MARKDOWN_INBOX_HEADER.trimEnd()}${rendered.length ? `\n\n${rendered.join("\n\n")}` : ""}\n`;
  parseMarkdownInbox(markdownBody);
  const temporary = `${paths.inboxPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, markdownBody, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const verified = parseMarkdownInbox(await fs.readFile(temporary, "utf8"));
    if (verified.entries.map((entry) => entry.captureId).join("\n") !== legacyEntries.map((entry) => entry.captureId).join("\n")) {
      throw migrationError("inbox_migration_verification_failed", "The Markdown inbox did not preserve the legacy capture IDs.");
    }

    await publishMarkdownMigration(sourcePath, paths.inboxPath, temporary, legacyText, markdownBody);
    await fs.rm(temporary);
    await upgradeCaptureRecords(paths.capturesPath);
    return { migrated: true, count: legacyEntries.length, legacyRetained: true };
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function publishMarkdownMigration(sourcePath, inboxPath, temporary, expectedSource, markdownBody) {
  if (!await fileContentsEqual(sourcePath, expectedSource)) {
    throw migrationError("legacy_inbox_changed", "inbox.org changed during migration. Review it and try again.");
  }
  try {
    await fs.copyFile(temporary, inboxPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw migrationError("multiple_inbox_formats", "inbox.md appeared during migration. Clipplane did not overwrite it.");
    }
    throw error;
  }
  if (!await fileContentsEqual(sourcePath, expectedSource)) {
    throw migrationError("legacy_inbox_changed", "inbox.org changed during migration. Review it and try again.");
  }
}

async function fileContentsEqual(filePath, expected) {
  try {
    return await fs.readFile(filePath, "utf8") === expected;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function createImmutableBackup(backupPath, body, conflictCode) {
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  try {
    await fs.writeFile(backupPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    if (await fs.readFile(backupPath, "utf8") !== body) {
      throw migrationError(conflictCode, `The existing migration backup has different content: ${path.basename(backupPath)}`);
    }
  }
}

async function upgradeCaptureBodies(paths, store, options = {}) {
  const legacyById = new Map((options.legacyEntries || []).map((entry) => [entry.captureId, entry]));
  for (const record of captureRecords(store)) {
    const inspected = await inspectCaptureBody(paths, record.capture_id);
    if (inspected.state === "unsafe") {
      if (options.legacyText !== undefined) throw inspected.error;
      continue;
    }
    let original = "";
    let recovery = "";
    if (inspected.state === "available") {
      original = await fs.readFile(inspected.path, "utf8");
      if (isCaptureDocument(original, record.capture_id)) continue;
    } else {
      const legacyEntry = legacyById.get(record.capture_id);
      if (!legacyEntry || !isActiveCaptureRecord(record)) continue;
      original = renderRecoveredOrgBody(extractLegacyOrgBody(options.legacyText, legacyEntry));
      recovery = "legacy_org";
    }
    const document = renderCaptureDocument(record, original, { recovery });
    if (Buffer.byteLength(document, "utf8") > MAX_CAPTURE_DOCUMENT_BYTES) {
      throw migrationError("capture_too_large", `Capture body is too large to migrate safely: ${record.capture_id}`);
    }
    const target = captureBodyPath(paths, record.capture_id);
    if (inspected.state === "missing") {
      try { await writeNewCaptureBody(paths, record.capture_id, document); }
      catch (error) { if (error.code === "EEXIST") throw migrationError("recovered_body_conflict", `Capture body appeared during migration: ${record.capture_id}`); throw error; }
    } else {
      await atomicReplaceIfUnchanged(target, original, document);
    }
  }
}

async function upgradeCaptureBodiesIfNeeded(paths, store) {
  if (await fileExists(paths.captureDocumentMarkerPath)) return;
  let changed = false;
  for (const record of captureRecords(store)) {
    const inspected = await inspectCaptureBody(paths, record.capture_id);
    if (inspected.state !== "available") {
      const backupPath = captureBodyBackupPath(paths, record.capture_id);
      if (inspected.state === "missing" && await fileExists(backupPath)) {
        try { await fs.copyFile(backupPath, captureBodyPath(paths, record.capture_id), fsConstants.COPYFILE_EXCL); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
        changed = true;
        break;
      }
      continue;
    }
    const handle = await fs.open(inspected.path, "r");
    let header;
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      header = buffer.subarray(0, bytesRead).toString("utf8");
    } finally { await handle.close(); }
    const expectedId = `capture_id: ${JSON.stringify(record.capture_id)}`;
    if (!header.startsWith("---\nclipplane_body_format: 1\n") || !header.split("\n").includes(expectedId)) { changed = true; break; }
  }
  if (changed) await upgradeCaptureBodies(paths, store);
  await markCaptureDocumentUpgrade(paths);
}

async function markCaptureDocumentUpgrade(paths) {
  try { await fs.writeFile(paths.captureDocumentMarkerPath, "1\n", { encoding: "utf8", mode: 0o600, flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}

function captureBodyBackupPath(paths, captureId) {
  return path.join(paths.stateDir, "backups", "capture-bodies-v0", `${captureId}.md`);
}

function extractLegacyOrgBody(legacyText, entry) {
  const lines = String(legacyText).split(/\r?\n/).slice(entry.start, entry.end);
  const drawerEnd = lines.findIndex((line) => line === ":END:");
  return lines.slice(drawerEnd + 1).join("\n").trim();
}

async function atomicReplaceIfUnchanged(filePath, expected, body) {
  const captureId = path.basename(filePath, ".md");
  const backupPath = path.join(path.dirname(path.dirname(filePath)), "backups", "capture-bodies-v0", `${captureId}.md`);
  const displacedPath = `${filePath}.${process.pid}.${Date.now()}.pre-upgrade`;
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  try {
    await fs.link(filePath, backupPath);
  } catch (error) {
    if (error.code !== "EEXIST" || !await fileContentsEqual(backupPath, expected)) {
      throw migrationError("capture_body_backup_conflict", `Capture body backup conflicts with migration: ${path.basename(filePath)}`);
    }
  }
  await fs.rename(filePath, displacedPath);
  try {
    if (!await fileContentsEqual(displacedPath, expected)) {
      await restoreDisplacedBody(displacedPath, filePath);
      throw migrationError("capture_body_changed", `Capture body changed during migration: ${path.basename(filePath)}`);
    }
    await fs.writeFile(filePath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rm(displacedPath, { force: true });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw migrationError("capture_body_changed", `Capture body appeared during migration: ${path.basename(filePath)}`);
    }
    await restoreDisplacedBody(displacedPath, filePath);
    throw error;
  }
}

async function restoreDisplacedBody(displacedPath, filePath) {
  try {
    await fs.link(displacedPath, filePath);
    await fs.rm(displacedPath, { force: true });
  } catch (error) {
    if (error.code !== "EEXIST" && error.code !== "ENOENT") throw error;
  }
}

async function readOptionalText(filePath) {
  try { return await fs.readFile(filePath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function upgradeCaptureRecords(capturesPath) {
  const store = await readCaptureStore(capturesPath);
  if (!store.entries.some((entry) => entry.record && (entry.record.schema_version !== 3 || entry.record.org_heading || entry.record.org_timestamp))) {
    return false;
  }
  await writeCaptureStore(capturesPath, store.entries);
  return true;
}

async function filesEqual(first, second) {
  return await fs.readFile(first, "utf8") === await fs.readFile(second, "utf8");
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function migrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
