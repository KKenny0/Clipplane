import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_ID_PATTERN,
  LEGACY_EXTENSION_IDS,
  deriveExtensionIdFromKey,
  getExtensionIdentity
} from "../scripts/extension-identity.mjs";
import { getNativeHostExtensionIds, getNativeHostOrigins } from "../scripts/native-host-origins.mjs";

test("manifest public key derives the documented stable extension ID", async () => {
  const identity = await getExtensionIdentity();

  assert.match(identity.id, EXTENSION_ID_PATTERN);
  assert.equal(deriveExtensionIdFromKey(identity.key), identity.id);
  assert.equal(identity.id, "emacefnmbogjdcblglmipolnickjnmbl");
  assert.deepEqual(identity.legacyIds, ["mhgcfphfcgbgabhbegdonadkedfaddhc"]);
});

test("native host origins contain only the Store ID and documented legacy ID", async () => {
  assert.deepEqual(await getNativeHostExtensionIds(), [
    "emacefnmbogjdcblglmipolnickjnmbl",
    "mhgcfphfcgbgabhbegdonadkedfaddhc"
  ]);
  assert.deepEqual(await getNativeHostOrigins(), [
    "chrome-extension://emacefnmbogjdcblglmipolnickjnmbl/",
    "chrome-extension://mhgcfphfcgbgabhbegdonadkedfaddhc/"
  ]);
});
