import assert from "node:assert/strict";
import test from "node:test";
import { MIN_HOST_PROTOCOL, supportsHostProtocol } from "../extension/src/host-protocol.js";

test("lifecycle-capable extension rejects older Host protocols", () => {
  assert.equal(MIN_HOST_PROTOCOL, 2);
  assert.equal(supportsHostProtocol(1), false);
  assert.equal(supportsHostProtocol(2), true);
  assert.equal(supportsHostProtocol(undefined), false);
});
