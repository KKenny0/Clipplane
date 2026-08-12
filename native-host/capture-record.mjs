import fs from "node:fs/promises";
import path from "node:path";

export const CAPTURE_SCHEMA_VERSION = 3;

export function normalizeCaptureRecord(record = {}) {
  assertSupportedCaptureRecord(record);
  const normalized = {
    schema_version: CAPTURE_SCHEMA_VERSION,
    ...record
  };

  normalized.schema_version = CAPTURE_SCHEMA_VERSION;
  delete normalized.local_path;
  delete normalized.content_path;
  delete normalized.org_heading;
  delete normalized.org_timestamp;

  if (normalized.sinks && typeof normalized.sinks === "object" && !Array.isArray(normalized.sinks)) {
    normalized.sinks = Object.fromEntries(
      Object.entries(normalized.sinks).map(([name, sink]) => {
        if (!sink || typeof sink !== "object" || Array.isArray(sink)) {
          return [name, sink];
        }
        const portableSink = { ...sink };
        delete portableSink.path;
        return [name, portableSink];
      })
    );
  }

  return normalized;
}

export function captureBodyPath(paths, captureId) {
  return managedCapturePath(paths.captureBodiesDir, captureId, ".md");
}

export function localExportPath(paths, captureId) {
  return managedCapturePath(path.join(paths.stateDir, "sinks", "local-export"), captureId, ".json");
}

export async function inspectCaptureBody(paths, captureId) {
  const bodyPath = captureBodyPath(paths, captureId);
  try {
    const exists = await assertManagedFileTarget(bodyPath, paths.captureBodiesDir, paths.notesDir);
    return { path: bodyPath, state: exists ? "available" : "missing" };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: bodyPath, state: "missing" };
    }
    return { path: "", state: "unsafe", error };
  }
}

export async function resolveCaptureBodyForRead(paths, captureId) {
  const inspected = await inspectCaptureBody(paths, captureId);
  if (inspected.state === "available") {
    return inspected.path;
  }
  if (inspected.state === "unsafe") {
    throw inspected.error;
  }
  throw managedPathError("missing_capture_body", "Capture body is missing for this record.");
}

export async function writeNewCaptureBody(paths, captureId, body) {
  await assertManagedDirectory(paths.captureBodiesDir, paths.notesDir, { create: true });
  const bodyPath = captureBodyPath(paths, captureId);
  await assertManagedFileTarget(bodyPath, paths.captureBodiesDir, paths.notesDir);
  await fs.writeFile(bodyPath, body, { encoding: "utf8", flag: "wx" });
  return bodyPath;
}

export async function ensureCaptureBody(paths, captureId, body) {
  const inspected = await inspectCaptureBody(paths, captureId);
  if (inspected.state === "available") {
    return inspected.path;
  }
  if (inspected.state === "unsafe") {
    throw inspected.error;
  }

  await assertManagedDirectory(paths.captureBodiesDir, paths.notesDir, { create: true });
  const bodyPath = captureBodyPath(paths, captureId);
  try {
    await fs.writeFile(bodyPath, body, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    return resolveCaptureBodyForRead(paths, captureId);
  }
  return bodyPath;
}

export async function writeLocalExport(paths, captureId, body) {
  const exportRoot = path.join(paths.stateDir, "sinks", "local-export");
  await assertManagedDirectory(exportRoot, paths.notesDir, { create: true });
  const exportPath = localExportPath(paths, captureId);
  await assertManagedFileTarget(exportPath, exportRoot, paths.notesDir);
  await atomicManagedWrite(exportPath, body);
  return exportPath;
}

export function assertSupportedCaptureRecord(record) {
  const version = record?.schema_version;
  if (Number.isInteger(version) && version > CAPTURE_SCHEMA_VERSION) {
    throw managedPathError(
      "unsupported_capture_schema",
      `Capture data requires a newer Clipplane Host (schema ${version}).`
    );
  }
}

export async function assertManagedDirectory(root, notesRoot, options = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedNotes = path.resolve(notesRoot);
  if (!isPathInside(resolvedRoot, resolvedNotes)) {
    throw managedPathError("unsafe_managed_path", "Managed path is outside the Clipplane notes folder.");
  }

  await assertNoSymlinkComponents(resolvedNotes, resolvedRoot);
  if (options.create) {
    await fs.mkdir(resolvedRoot, { recursive: true });
    await assertNoSymlinkComponents(resolvedNotes, resolvedRoot);
  }

  const stat = await fs.lstat(resolvedRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw managedPathError("unsafe_managed_path", "Managed directory cannot be a symbolic link.");
  }
  const [realRoot, realNotes] = await Promise.all([fs.realpath(resolvedRoot), fs.realpath(resolvedNotes)]);
  if (!isPathInside(realRoot, realNotes)) {
    throw managedPathError("unsafe_managed_path", "Managed directory resolves outside the Clipplane notes folder.");
  }
  return realRoot;
}

export async function assertManagedFileTarget(filePath, managedRoot, notesRoot) {
  const realRoot = await assertManagedDirectory(managedRoot, notesRoot);
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw managedPathError("unsafe_managed_path", "Managed file cannot be a symbolic link.");
  }
  const realFile = await fs.realpath(filePath);
  if (!isPathInside(realFile, realRoot)) {
    throw managedPathError("unsafe_managed_path", "Managed file resolves outside its Clipplane directory.");
  }
  return true;
}

export function withRuntimeCapturePaths(record, paths) {
  const capture = normalizeCaptureRecord(record);
  const sinks = capture.sinks && typeof capture.sinks === "object" && !Array.isArray(capture.sinks)
    ? { ...capture.sinks }
    : {};

  if (sinks.local && typeof sinks.local === "object" && !Array.isArray(sinks.local)) {
    sinks.local = { ...sinks.local, path: paths.inboxPath };
  }
  if (sinks["local-export"] && typeof sinks["local-export"] === "object" && !Array.isArray(sinks["local-export"])) {
    sinks["local-export"] = { ...sinks["local-export"], path: localExportPath(paths, capture.capture_id) };
  }

  return {
    ...capture,
    local_path: paths.inboxPath,
    content_path: captureBodyPath(paths, capture.capture_id),
    sinks
  };
}

function managedCapturePath(root, captureId, extension) {
  const id = String(captureId || "").trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    const error = new Error("Capture ID cannot be used as a managed file name.");
    error.code = "invalid_capture_id";
    throw error;
  }
  return path.join(root, `${id}${extension}`);
}

async function assertNoSymlinkComponents(notesRoot, target) {
  const relative = path.relative(notesRoot, target);
  if (relative === "") {
    return;
  }
  let current = notesRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw managedPathError("unsafe_managed_path", "Managed directory cannot contain symbolic links.");
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function atomicManagedWrite(filePath, body) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function isPathInside(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function managedPathError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
