import assert from "node:assert/strict";
import test from "node:test";
import { createHostLink, hostProblem, isUnsupportedMessage } from "../extension/src/host-link.js";

test("hostProblem classifies every failure shape pages branch on", () => {
  assert.equal(hostProblem({ ok: true }), null);
  assert.equal(hostProblem({ ok: false, error: { code: "host_outdated", message: "x" } }), "host-outdated");
  assert.equal(hostProblem({ ok: false, error: { code: "host_unavailable", message: "x" } }), "host-unavailable");
  assert.equal(hostProblem({ ok: false, error: { message: "native messaging host not found" } }), "host-unavailable");
  assert.equal(hostProblem({ ok: false, error: { code: "unknown_message", message: "Unsupported native host message." } }), "unsupported");
  assert.equal(hostProblem({ ok: false, error: { code: "capture_not_found", message: "gone" } }), "failed");
  assert.equal(hostProblem(undefined), "failed");
});

test("isUnsupportedMessage recognises both the code and the message form", () => {
  assert.equal(isUnsupportedMessage({ error: { code: "unknown_message" } }), true);
  assert.equal(isUnsupportedMessage({ error: { message: "Unsupported native host message." } }), true);
  assert.equal(isUnsupportedMessage({ error: { code: "other", message: "nope" } }), false);
});

test("the host link sends through the injected transport and reports the problem", async () => {
  const sent = [];
  const hostLink = createHostLink({
    sendMessage: async (message) => {
      sent.push(message);
      return message.type === "status"
        ? { ok: true, protocol_version: 3 }
        : { ok: false, error: { code: "host_outdated", message: "old" } };
    }
  });

  const status = await hostLink.send({ type: "status" });
  assert.deepEqual(sent, [{ type: "status" }]);
  assert.equal(status.problem, null);
  assert.equal(status.response.protocol_version, 3);

  const clip = await hostLink.send({ type: "clip" });
  assert.equal(clip.problem, "host-outdated");
});
