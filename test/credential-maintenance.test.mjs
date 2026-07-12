import test from "node:test";
import assert from "node:assert/strict";

import { deleteClipplaneCredentials } from "../native-host/credential-maintenance.mjs";

test("credential cleanup removes both external sink secrets", async () => {
  const deleted = [];
  const secretStore = {
    get: async () => null,
    set: async () => {},
    delete: async (account) => deleted.push(account)
  };

  const removed = await deleteClipplaneCredentials({ secretStore });
  assert.deepEqual(removed, ["notionToken", "flomoWebhook"]);
  assert.deepEqual(deleted, ["notion-token", "flomo-webhook"]);
});
