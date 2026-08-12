import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { assertCaptureStoreWritable, captureRecords, readCaptureStore, writeCaptureStore } from "./capture-store.mjs";
import { resolveCaptureBodyForRead } from "./capture-record.mjs";
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
    parseMarkdownInbox(await fs.readFile(paths.inboxPath, "utf8"));
    await upgradeCaptureRecords(paths.capturesPath);
    return { migrated: false, legacyRetained: true };
  }

  if (markdownExists) {
    parseMarkdownInbox(await fs.readFile(paths.inboxPath, "utf8"));
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
    const bodyPath = await resolveCaptureBodyForRead(paths, record.capture_id);
    const markdown = await fs.readFile(bodyPath, "utf8");
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
  return !["processed", "processing", "deleting", "deleted"].includes(cleanString(record.lifecycle_status));
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

    if (options.createBackup) {
      await createLegacyBackup(paths, legacyText);
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
    await removePublishedInboxIfUnchanged(inboxPath, markdownBody);
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

async function removePublishedInboxIfUnchanged(inboxPath, expected) {
  try {
    if (await fs.readFile(inboxPath, "utf8") === expected) {
      await fs.rm(inboxPath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function createLegacyBackup(paths, legacyText) {
  await fs.mkdir(path.dirname(paths.legacyInboxBackupPath), { recursive: true });
  try {
    await fs.writeFile(paths.legacyInboxBackupPath, legacyText, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    if (await fs.readFile(paths.legacyInboxBackupPath, "utf8") !== legacyText) {
      throw migrationError("legacy_inbox_backup_conflict", "The existing inbox-v2.org backup has different content.");
    }
  }
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
