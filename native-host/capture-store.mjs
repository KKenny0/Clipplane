import fs from "node:fs/promises";
import path from "node:path";
import {
  assertManagedDirectory,
  assertManagedFileTarget,
  assertSupportedCaptureRecord,
  normalizeCaptureRecord
} from "./capture-record.mjs";

export async function readCaptureStore(capturesPath) {
  await assertCaptureStorePath(capturesPath);
  let text;
  try {
    text = await fs.readFile(capturesPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { entries: [], warnings: [] };
    }
    throw error;
  }

  const entries = [];
  const warnings = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && cleanString(record.capture_id)) {
        entries.push({ raw: line, record });
      } else {
        entries.push({ raw: line, record: null });
        warnings.push({ line: index + 1, code: "invalid_record" });
      }
    } catch {
      entries.push({ raw: line, record: null });
      warnings.push({ line: index + 1, code: "invalid_json" });
    }
  }

  return { entries, warnings };
}

export function captureRecords(store) {
  return store.entries.filter((entry) => entry.record).map((entry) => entry.record);
}

export async function appendCaptureRecord(capturesPath, record) {
  await assertCaptureStorePath(capturesPath);
  let separator = "";
  try {
    const existing = await fs.readFile(capturesPath, "utf8");
    separator = existing && !existing.endsWith("\n") ? "\n" : "";
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.appendFile(capturesPath, `${separator}${JSON.stringify(normalizeCaptureRecord(record))}\n`, "utf8");
}

export async function replaceCaptureRecord(capturesPath, updated) {
  const store = await readCaptureStore(capturesPath);
  const captureId = cleanString(updated.capture_id);
  const matches = store.entries.filter((entry) => cleanString(entry.record?.capture_id) === captureId);
  if (matches.length > 1) {
    const error = new Error(`Multiple records use Capture ID: ${captureId}`);
    error.code = "duplicate_capture_record";
    throw error;
  }

  if (matches.length === 1) {
    matches[0].record = updated;
  } else {
    store.entries.push({ raw: "", record: updated });
  }
  await writeCaptureStore(capturesPath, store.entries);
}

export async function writeCaptureStore(capturesPath, entries) {
  assertCaptureStoreWritable(entries);
  await assertCaptureStorePath(capturesPath);
  const body = entries
    .map((entry) => entry.record ? JSON.stringify(normalizeCaptureRecord(entry.record)) : entry.raw)
    .join("\n");
  await atomicWrite(capturesPath, body ? `${body}\n` : "");
}

export function assertCaptureStoreWritable(entries) {
  for (const entry of entries) {
    if (entry.record) {
      assertSupportedCaptureRecord(entry.record);
    }
  }
}

async function atomicWrite(filePath, body) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let mode = 0o600;
  try {
    mode = (await fs.stat(filePath)).mode & 0o777;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await fs.writeFile(tempPath, body, { encoding: "utf8", mode, flag: "wx" });
    await fs.chmod(tempPath, mode);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function assertCaptureStorePath(capturesPath) {
  const stateDir = path.dirname(capturesPath);
  const notesDir = path.dirname(stateDir);
  try {
    await assertManagedDirectory(stateDir, notesDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await assertManagedFileTarget(capturesPath, stateDir, notesDir);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}
