import assert from "node:assert/strict";
import test from "node:test";
import { getSecret, SecretStoreError, setSecretVerified } from "../native-host/secret-store.mjs";

test("setSecretVerified stores and reads back an OS credential through the injected boundary", async () => {
  const values = new Map();
  const secretStore = {
    async get(account) { return values.get(account) || null; },
    async set(account, value) { values.set(account, value); },
    async delete(account) { values.delete(account); }
  };

  await setSecretVerified("notionToken", "secret-value", { secretStore });
  assert.equal(await getSecret("notionToken", { secretStore }), "secret-value");
});
test("setSecretVerified rejects a backend that cannot read back the stored value", async () => {
  const secretStore = {
    async get() { return "different-value"; },
    async set() {},
    async delete() {}
  };

  await assert.rejects(
    setSecretVerified("flomoWebhook", "https://flomoapp.com/iwh/secret", { secretStore }),
    SecretStoreError
  );
});
