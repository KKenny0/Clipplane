import assert from "node:assert/strict";
import test from "node:test";
import { MIN_HOST_PROTOCOL, requiresCurrentHostProtocol, supportsHostProtocol } from "../extension/src/host-protocol.js";

test("lifecycle-capable extension rejects older Host protocols", () => {
  assert.equal(MIN_HOST_PROTOCOL, 3);
  assert.equal(supportsHostProtocol(1), false);
  assert.equal(supportsHostProtocol(2), false);
  assert.equal(supportsHostProtocol(3), true);
  assert.equal(supportsHostProtocol(undefined), false);
});

test("every capture-data mutation requires the current Host protocol", () => {
  for (const type of ["clip", "sync", "process_capture", "delete_capture"]) {
    assert.equal(requiresCurrentHostProtocol(type), true, type);
  }
  for (const type of ["status", "history", "copy_capture", "open_capture_body", "get_config", "set_config"]) {
    assert.equal(requiresCurrentHostProtocol(type), false, type);
  }
});
