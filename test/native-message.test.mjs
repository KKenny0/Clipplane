import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeMessageParser,
  encodeNativeMessage
} from "../native-host/native-message.mjs";

test("native message parser handles split chunks", () => {
  const messages = [];
  const parser = createNativeMessageParser((message) => messages.push(message));
  const encoded = encodeNativeMessage({ type: "clip", value: 42 });

  parser(encoded.subarray(0, 2));
  parser(encoded.subarray(2));

  assert.deepEqual(messages, [{ type: "clip", value: 42 }]);
});
