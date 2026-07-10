const KEY_PREFIX = "element-capture:";

export async function savePendingElementCapture(requestId, pending, options = {}) {
  const storage = resolveStorage(options);
  const key = keyFor(requestId);
  const value = normalizePending(pending);
  await storage.set({ [key]: value });
  return value;
}

export async function readPendingElementCapture(requestId, options = {}) {
  const storage = resolveStorage(options);
  const key = keyFor(requestId);
  const result = await storage.get(key);
  return normalizePending(result[key], { allowMissing: true });
}

export async function removePendingElementCapture(requestId, options = {}) {
  await resolveStorage(options).remove(keyFor(requestId));
}

export async function removeExpiredElementCaptures(now = Date.now(), options = {}) {
  const storage = resolveStorage(options);
  const records = await storage.get(null);
  const expired = Object.entries(records)
    .filter(([key, value]) => key.startsWith(KEY_PREFIX) && normalizePending(value, { allowMissing: true })?.expiresAt <= now)
    .map(([key]) => key);

  if (expired.length) {
    await storage.remove(expired);
  }
  return expired.length;
}

function resolveStorage(options) {
  const storage = options.storage || globalThis.chrome?.storage?.session;
  if (!storage) {
    throw new Error("Session storage is unavailable for element capture.");
  }
  return storage;
}

function keyFor(requestId) {
  if (typeof requestId !== "string" || !requestId) {
    throw new Error("Element capture request ID is required.");
  }
  return `${KEY_PREFIX}${requestId}`;
}

function normalizePending(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (options.allowMissing) {
      return null;
    }
    throw new Error("Element capture state is invalid.");
  }

  const tabId = Number(value.tabId);
  const expiresAt = Number(value.expiresAt);
  if (!Number.isInteger(tabId) || tabId < 0 || !Number.isFinite(expiresAt)) {
    if (options.allowMissing) {
      return null;
    }
    throw new Error("Element capture state is invalid.");
  }

  return {
    tabId,
    sync: Boolean(value.sync),
    expiresAt
  };
}
