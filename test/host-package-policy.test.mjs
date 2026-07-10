import assert from "node:assert/strict";
import test from "node:test";
import { findForbiddenHostFiles, validateNode20Version } from "../scripts/host-package-policy.mjs";

test("Host package runtime stays on supported Node 20", () => {
  assert.doesNotThrow(() => validateNode20Version("v20.19.0"));
  assert.throws(() => validateNode20Version("v24.0.0"), /require Node 20/);
  assert.throws(() => validateNode20Version("v20.18.3"), /require Node 20/);
});

test("Host package policy rejects secrets, config, and test fixtures", () => {
  assert.deepEqual(findForbiddenHostFiles([
    "app/native-host/host.mjs",
    "app/.env.production",
    "app/test/fixture.json",
    "app/private.pem",
    "app/.clipplane/captures.jsonl"
  ]), [
    "app/.env.production",
    "app/test/fixture.json",
    "app/private.pem",
    "app/.clipplane/captures.jsonl"
  ]);
});
