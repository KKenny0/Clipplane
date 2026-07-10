import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyncConsent,
  canSyncStatus,
  getExternalSyncStatus,
  hasSyncConsent,
  SYNC_CONSENT_VERSION
} from "../extension/src/sync-consent.js";

test("buildSyncConsent requires an explicit confirmation before enabling a sink", () => {
  assert.throws(
    () => buildSyncConsent(null, [{ sink: "notion-api", label: "Notion", enabled: true, confirmed: false }]),
    /Confirm what Notion receives/
  );
});

test("buildSyncConsent stores only sink identity, policy version, and acceptance time", () => {
  const acceptedAt = new Date("2026-07-10T00:00:00.000Z");
  const record = buildSyncConsent(null, [
    { sink: "flomo-api", label: "flomo", enabled: true, confirmed: true }
  ], acceptedAt);

  assert.deepEqual(record, {
    version: SYNC_CONSENT_VERSION,
    sinks: { "flomo-api": { acceptedAt: acceptedAt.toISOString() } }
  });
  assert.equal(hasSyncConsent(record, "flomo-api"), true);
  assert.equal(JSON.stringify(record).includes("content"), false);
});

test("a new policy version invalidates earlier consent", () => {
  assert.equal(hasSyncConsent({ version: "old", sinks: { "notion-api": { acceptedAt: "now" } } }, "notion-api"), false);
});

test("sync status requires consent for every requested external sink", () => {
  const status = {
    ok: true,
    default_sinks: ["notion-api"],
    sinks: {
      "local-export": { enabled: false, configured: true },
      "notion-api": { enabled: true, configured: true, consent: false }
    }
  };

  assert.equal(canSyncStatus(status), false);
  assert.equal(canSyncStatus({
    ...status,
    sinks: { ...status.sinks, "notion-api": { enabled: true, configured: true, consent: true } }
  }), true);
  assert.equal(canSyncStatus(status, ["local-export"]), true);
});

test("external sync status keeps credential configuration distinct from consent", () => {
  const status = {
    ok: true,
    sinks: {
      "local-export": { enabled: true, configured: true },
      "notion-api": { enabled: true, configured: true, consent: false },
      "flomo-api": { enabled: true, configured: true, consent: true },
      disabled: { enabled: false, configured: true, consent: true }
    }
  };

  assert.deepEqual(getExternalSyncStatus(status), {
    configured: ["notion-api", "flomo-api"],
    consented: ["flomo-api"]
  });
});
