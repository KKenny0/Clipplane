import assert from "node:assert/strict";
import test from "node:test";
import * as vendored from "../extension/src/host-protocol.js";
import * as canonical from "../native-host/host-protocol.mjs";
import { handleMessage, messageHandlers } from "../native-host/host.mjs";

const { MIN_HOST_PROTOCOL, requiresCurrentHostProtocol, supportsHostProtocol } = vendored;

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

test("the host dispatch table carries exactly the vocabulary's message types", () => {
  assert.deepEqual(
    [...messageHandlers.keys()].sort(),
    Object.keys(canonical.HOST_MESSAGE_TYPES).sort()
  );
});

test("unknown and prototype-spoofed message types fall through to unknown_message", async () => {
  for (const type of ["nonsense", "__proto__", "constructor", "toString"]) {
    const response = await handleMessage({ type });
    assert.deepEqual(response, {
      ok: false,
      error: { code: "unknown_message", message: "Unsupported native host message." }
    }, type);
  }
});

test("the vendored extension copy matches the canonical host vocabulary", () => {
  assert.deepEqual(vendored.MIN_HOST_PROTOCOL, canonical.MIN_HOST_PROTOCOL);
  assert.deepEqual(vendored.HOST_MESSAGE_TYPES, canonical.HOST_MESSAGE_TYPES);
  assert.deepEqual(vendored.FORWARDED_MESSAGE_TYPES, canonical.FORWARDED_MESSAGE_TYPES);
  for (const type of Object.keys(canonical.HOST_MESSAGE_TYPES)) {
    assert.equal(
      vendored.requiresCurrentHostProtocol(type),
      canonical.requiresCurrentHostProtocol(type),
      type
    );
  }
});

test("the vocabulary flags exactly the messages background forwards and the host gates", () => {
  assert.deepEqual(vendored.FORWARDED_MESSAGE_TYPES, [
    "get_config",
    "set_config",
    "open_notes_dir",
    "history",
    "open_capture_body",
    "copy_capture",
    "process_capture",
    "delete_capture"
  ]);
  for (const type of ["clip", "sync", "process_capture", "delete_capture"]) {
    assert.equal(vendored.HOST_MESSAGE_TYPES[type].gated, true, type);
  }
  for (const type of ["status", "get_config", "set_config", "open_notes_dir", "history", "open_capture_body", "copy_capture"]) {
    assert.equal(vendored.HOST_MESSAGE_TYPES[type].gated, false, type);
  }
});
