import assert from "node:assert/strict";
import test from "node:test";
import {
  readPendingElementCapture,
  removeExpiredElementCaptures,
  removePendingElementCapture,
  savePendingElementCapture
} from "../extension/src/element-capture-state.js";

test("element capture state survives a fresh storage read and can be removed", async () => {
  const storage = createStorage();
  await savePendingElementCapture("request-1", {
    tabId: 42,
    sync: true,
    expiresAt: 50_000
  }, { storage });

  assert.deepEqual(await readPendingElementCapture("request-1", { storage }), {
    tabId: 42,
    sync: true,
    expiresAt: 50_000
  });

  await removePendingElementCapture("request-1", { storage });
  assert.equal(await readPendingElementCapture("request-1", { storage }), null);
});

test("expired element capture state is pruned without touching active requests", async () => {
  const storage = createStorage({
    "element-capture:expired": { tabId: 1, sync: false, expiresAt: 10 },
    "element-capture:active": { tabId: 2, sync: true, expiresAt: 100 },
    unrelated: { preserved: true }
  });

  assert.equal(await removeExpiredElementCaptures(50, { storage }), 1);
  assert.equal(await readPendingElementCapture("expired", { storage }), null);
  assert.deepEqual(await readPendingElementCapture("active", { storage }), {
    tabId: 2,
    sync: true,
    expiresAt: 100
  });
  assert.deepEqual(storage.values.unrelated, { preserved: true });
});

function createStorage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(key) {
      if (key === null) {
        return structuredClone(values);
      }
      return Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {};
    },
    async set(entries) {
      Object.assign(values, structuredClone(entries));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete values[key];
      }
    }
  };
}
