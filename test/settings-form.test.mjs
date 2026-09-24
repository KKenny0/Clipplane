import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createSettingsForm } from "../extension/src/settings-form.js";

function mount({ setConfigResponse, problem = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <input id="notes-dir"><span id="storage-note"></span>
    <input id="flomo-enabled" type="checkbox"><input id="flomo-webhook"><input id="flomo-tags">
    <input id="flomo-consent" type="checkbox"><span id="flomo-state"></span>
    <input id="notion-enabled" type="checkbox"><input id="notion-page"><input id="notion-token">
    <input id="notion-consent" type="checkbox"><span id="notion-state"></span>
    <span id="storage-status"></span><span id="sync-status"></span>
  </body></html>`, { url: "https://clipplane.test/" });
  const { document } = dom.window;
  const fields = {};
  for (const id of [
    "notes-dir", "storage-note", "flomo-enabled", "flomo-webhook", "flomo-tags",
    "flomo-consent", "flomo-state", "notion-enabled", "notion-page", "notion-token",
    "notion-consent", "notion-state"
  ]) {
    fields[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.querySelector(`#${id}`);
  }

  const sent = [];
  const notifications = [];
  const state = { unavailable: 0, stored: {} };
  const configResponse = setConfigResponse || sampleConfigResponse();

  const hostLink = {
    send: async (message) => {
      sent.push(message);
      return { response: configResponse, problem };
    }
  };

  const form = createSettingsForm({
    elements: {
      fields,
      storageStatus: document.querySelector("#storage-status"),
      syncStatus: document.querySelector("#sync-status")
    },
    hostLink,
    notify: (message, isError) => notifications.push({ message, isError }),
    onHostUnavailable: () => { state.unavailable += 1; },
    storage: {
      get: async (key) => state.stored[key] || {},
      set: async (value) => { Object.assign(state.stored, value); }
    }
  });

  return { document, fields, form, sent, notifications, state };
}

function sampleConfigResponse() {
  return {
    ok: true,
    config: {
      sinks: {
        "flomo-api": { enabled: true, webhookConfigured: true, tags: ["ai", "tech"], credentialMigrationRequired: false },
        "notion-api": { enabled: false, parentId: "", tokenConfigured: false, credentialMigrationRequired: false }
      }
    },
    storage: { notes_dir: "D:/notes", default_notes_dir: "C:/Users/you/Documents/notes", using_env_override: false }
  };
}

test("render fills fields, placeholders, states, and the sync summary", async () => {
  const { fields, form } = mount();
  await form.init();

  form.render(sampleConfigResponse());

  assert.equal(fields.notesDir.value, "D:/notes");
  assert.match(fields.storageNote.textContent, /^Default: /);
  assert.equal(fields.flomoEnabled.checked, true);
  assert.equal(fields.flomoWebhook.placeholder, "Webhook saved");
  assert.equal(fields.flomoTags.value, "ai, tech");
  assert.equal(fields.flomoConsent.checked, false);
  assert.equal(fields.flomoState.textContent, "Credentials saved. Confirm external data handling to enable sync.");
  assert.equal(fields.notionToken.placeholder, "secret_xxx");
  assert.equal(fields.notionState.textContent, "Add a page ID and integration token to enable Notion sync.");
  assert.equal(fields.storageNote.ownerDocument.querySelector("#storage-status").textContent, "Ready");
  assert.equal(fields.storageNote.ownerDocument.querySelector("#sync-status").textContent, "1 configured, 0 approved");
});

test("saveSync assembles the sink config, clears secrets, and persists consent", async () => {
  const { fields, form, sent, notifications, state } = mount();
  await form.init();
  form.render(sampleConfigResponse());

  fields.flomoWebhook.value = " https://flomoapp.com/iwh/abc123 ";
  fields.flomoTags.value = "#ai, tech";
  fields.notionEnabled.checked = true;
  fields.notionPage.value = "page-1";
  fields.notionToken.value = "secret_abc123";
  fields.flomoConsent.checked = true;
  fields.notionConsent.checked = true;
  await form.saveSync();

  const message = sent.find((entry) => entry.type === "set_config");
  assert.deepEqual(message.config, {
    sync: { defaultSinks: ["flomo-api", "notion-api"] },
    sinks: {
      "flomo-api": { enabled: true, webhookUrl: "https://flomoapp.com/iwh/abc123", tags: ["ai", "tech"] },
      "notion-api": { enabled: true, parentType: "page", parentId: "page-1", token: "secret_abc123" }
    }
  });
  assert.equal(fields.flomoWebhook.value, "", "webhook cleared after save");
  assert.equal(fields.notionToken.value, "", "token cleared after save");
  assert.ok(state.stored.syncConsent, "consent persisted to storage");
  assert.deepEqual(notifications, [{ message: "Sync settings saved", isError: false }]);
});

test("saveStorage sends the notes dir and reports success", async () => {
  const { fields, form, sent, notifications } = mount();
  await form.init();
  form.render(sampleConfigResponse());
  fields.notesDir.value = "  E:/vault  ";

  await form.saveStorage();

  assert.deepEqual(sent[0].config, { storage: { notesDir: "E:/vault" } });
  assert.deepEqual(notifications, [{ message: "Storage folder saved", isError: false }]);
});

test("host problems surface through the unavailable hook and a retry error", async () => {
  const dom = mount({ problem: "host-unavailable" });
  await dom.form.init();
  dom.fields.notesDir.value = "E:/vault";

  await assert.rejects(
    dom.form.saveStorage(),
    /Run local host setup, then retry/
  );
  assert.equal(dom.state.unavailable, 1);
  assert.deepEqual(dom.notifications, []);
});
