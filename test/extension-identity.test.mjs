import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_ID_PATTERN,
  deriveExtensionIdFromKey,
  getExtensionIdentity
} from "../scripts/extension-identity.mjs";

test("manifest public key derives the documented stable extension ID", async () => {
  const identity = await getExtensionIdentity();

  assert.match(identity.id, EXTENSION_ID_PATTERN);
  assert.equal(deriveExtensionIdFromKey(identity.key), identity.id);
  assert.equal(identity.id, "mhgcfphfcgbgabhbegdonadkedfaddhc");
});
