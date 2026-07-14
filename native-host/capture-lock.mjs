import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const LOCK_NAME = "capture-mutation.lock";
const OWNER_FILE = "owner";
const DEFAULT_WAIT_MS = 30_000;
const DEFAULT_STALE_MS = 10 * 60_000;
const RETRY_MS = 25;

export async function withCaptureMutationLock(paths, operation, options = {}) {
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const lockPath = path.join(paths.stateDir, LOCK_NAME);
  const ownerPath = path.join(lockPath, OWNER_FILE);
  const owner = `${process.pid}:${crypto.randomUUID()}`;
  const deadline = Date.now() + waitMs;

  await fs.mkdir(paths.stateDir, { recursive: true });

  while (true) {
    try {
      await fs.mkdir(lockPath);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      if (await removeStaleLock(lockPath, staleMs)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw captureBusyError();
      }
      await delay(RETRY_MS);
      continue;
    }

    try {
      await fs.writeFile(ownerPath, owner, { encoding: "utf8", mode: 0o600 });
      break;
    } catch (error) {
      await fs.rm(lockPath, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    return await operation();
  } finally {
    await releaseOwnedLock(lockPath, ownerPath, owner);
  }
}

async function removeStaleLock(lockPath, staleMs) {
  try {
    const owner = await readLockOwner(path.join(lockPath, OWNER_FILE));
    if (owner?.pid && processIsRunning(owner.pid)) {
      return false;
    }
    const stat = await fs.stat(lockPath);
    if (!owner && Date.now() - stat.mtimeMs <= staleMs) {
      return false;
    }
    await fs.rm(lockPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

async function readLockOwner(ownerPath) {
  try {
    const [pid] = (await fs.readFile(ownerPath, "utf8")).split(":", 1);
    const value = Number.parseInt(pid, 10);
    return Number.isInteger(value) && value > 0 ? { pid: value } : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function releaseOwnedLock(lockPath, ownerPath, owner) {
  try {
    if ((await fs.readFile(ownerPath, "utf8")) !== owner) {
      return;
    }
    await fs.rm(lockPath, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function captureBusyError() {
  const error = new Error("Capture storage is busy. Try again after the current operation finishes.");
  error.code = "capture_busy";
  return error;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
