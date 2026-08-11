import test from "node:test";
import assert from "node:assert/strict";

import { deleteClipplaneCredentials } from "../native-host/credential-maintenance.mjs";

for (const { label, initial, expected } of [
  { label: "no saved credentials", initial: [], expected: [] },
  { label: "only a Notion credential", initial: [["notion-token", "notion-secret"]], expected: ["notionToken"] },
  { label: "only a flomo credential", initial: [["flomo-webhook", "flomo-secret"]], expected: ["flomoWebhook"] },
  {
    label: "both saved credentials",
    initial: [["notion-token", "notion-secret"], ["flomo-webhook", "flomo-secret"]],
    expected: ["notionToken", "flomoWebhook"]
  }
]) {
  test(`credential cleanup removes ${label}`, async () => {
    const values = new Map(initial);
    const secretStore = {
      get: async (account) => values.get(account) ?? null,
      set: async (account, value) => values.set(account, value),
      delete: async (account) => {
        if (!values.delete(account)) throw new Error("Password not found");
      }
    };

    const removed = await deleteClipplaneCredentials({ secretStore });
    assert.deepEqual(removed, expected);
    assert.equal(values.size, 0);
  });
}

test("credential cleanup restores prior secrets when a later deletion fails", async () => {
  const values = new Map([
    ["notion-token", "notion-secret"],
    ["flomo-webhook", "flomo-secret"]
  ]);
  const secretStore = {
    get: async (account) => values.get(account) ?? null,
    set: async (account, value) => values.set(account, value),
    delete: async (account) => {
      if (account === "flomo-webhook") throw new Error("keychain denied deletion");
      values.delete(account);
    }
  };

  await assert.rejects(
    deleteClipplaneCredentials({ secretStore }),
    /Credentials were restored/
  );
  assert.equal(values.get("notion-token"), "notion-secret");
  assert.equal(values.get("flomo-webhook"), "flomo-secret");
});
