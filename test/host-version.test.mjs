import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };
import { HOST_VERSION, PROTOCOL_VERSION } from "../native-host/version.mjs";

test("native host reports the package version and supported protocol", () => {
  assert.equal(HOST_VERSION, packageJson.version);
  assert.equal(PROTOCOL_VERSION, 3);
});
