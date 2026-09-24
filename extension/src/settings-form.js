import { buildSyncConsent, hasSyncConsent } from "./sync-consent.js";

// The settings form module: field rendering, the storage and sync save
// flows, and sync-consent state behind one interface. The host link,
// notification, and storage are injected so jsdom tests drive it without
// Chrome. Failures throw; the page decides how to surface them.

export function createSettingsForm({
  elements,
  hostLink,
  notify = () => {},
  onHostUnavailable = () => {},
  storage = chrome.storage.local
}) {
  const { fields, storageStatus, syncStatus } = elements;
  let syncConsent = { version: "", sinks: {} };

  async function init() {
    syncConsent = (await storage.get("syncConsent")).syncConsent || syncConsent;
  }

  async function saveStorage() {
    const outcome = await hostLink.send({
      type: "set_config",
      config: {
        storage: {
          notesDir: fields.notesDir.value.trim()
        }
      }
    });
    if (outcome.problem === "host-unavailable" || outcome.problem === "host-outdated") {
      onHostUnavailable();
      throw new Error("Run local host setup, then retry.");
    }
    if (outcome.problem) {
      throw new Error(outcome.response.error?.message || "Could not save folder.");
    }
    render(outcome.response);
    notify("Storage folder saved", false);
  }

  async function saveSync() {
    const defaultSinks = [];
    if (fields.flomoEnabled.checked) {
      defaultSinks.push("flomo-api");
    }
    if (fields.notionEnabled.checked) {
      defaultSinks.push("notion-api");
    }

    const nextConsent = buildSyncConsent(syncConsent, [
      {
        sink: "flomo-api",
        label: "flomo",
        enabled: fields.flomoEnabled.checked,
        confirmed: fields.flomoConsent.checked
      },
      {
        sink: "notion-api",
        label: "Notion",
        enabled: fields.notionEnabled.checked,
        confirmed: fields.notionConsent.checked
      }
    ]);

    const outcome = await hostLink.send({
      type: "set_config",
      config: {
        sync: { defaultSinks },
        sinks: {
          "flomo-api": {
            enabled: fields.flomoEnabled.checked,
            webhookUrl: fields.flomoWebhook.value.trim(),
            tags: splitTags(fields.flomoTags.value)
          },
          "notion-api": {
            enabled: fields.notionEnabled.checked,
            parentType: "page",
            parentId: fields.notionPage.value.trim(),
            token: fields.notionToken.value.trim()
          }
        }
      }
    });
    if (outcome.problem === "host-unavailable" || outcome.problem === "host-outdated") {
      onHostUnavailable();
      throw new Error("Run local host setup, then retry.");
    }
    if (outcome.problem) {
      throw new Error(outcome.response.error?.message || "Could not save sync settings.");
    }
    fields.flomoWebhook.value = "";
    fields.notionToken.value = "";
    syncConsent = nextConsent;
    await storage.set({ syncConsent });
    render(outcome.response);
    notify("Sync settings saved", false);
  }

  async function openFolder() {
    const outcome = await hostLink.send({ type: "open_notes_dir" });
    if (outcome.problem === "host-unavailable" || outcome.problem === "host-outdated") {
      onHostUnavailable();
      throw new Error("Run local host setup, then retry.");
    }
    if (outcome.problem) {
      throw new Error(outcome.response.error?.message || "Could not open folder.");
    }
    notify("Storage folder open request sent", false);
  }

  function render(response) {
    const config = response.config;
    fields.notesDir.value = response.storage.notes_dir;
    fields.storageNote.textContent = response.storage.using_env_override
      ? "CLIPPLANE_NOTES_DIR is overriding this setting."
      : `Default: ${response.storage.default_notes_dir}`;
    setStatus(storageStatus, "Ready", "ready");

    const flomo = config.sinks["flomo-api"];
    fields.flomoEnabled.checked = flomo.enabled;
    fields.flomoWebhook.placeholder = flomo.webhookConfigured ? "Webhook saved" : "https://flomoapp.com/iwh/...";
    fields.flomoTags.value = flomo.tags.join(", ");
    fields.flomoConsent.checked = hasSyncConsent(syncConsent, "flomo-api");
    fields.flomoState.textContent = flomo.credentialMigrationRequired
      ? "Webhook uses legacy plaintext storage. Save sync settings to move it into the operating system credential store."
      : flomoReady(flomo)
        ? fields.flomoConsent.checked ? "Ready" : "Credentials saved. Confirm external data handling to enable sync."
        : "Paste a webhook URL to enable flomo sync.";

    const notion = config.sinks["notion-api"];
    fields.notionEnabled.checked = notion.enabled;
    fields.notionPage.value = notion.parentId;
    fields.notionToken.placeholder = notion.tokenConfigured ? "Token saved" : "secret_xxx";
    fields.notionConsent.checked = hasSyncConsent(syncConsent, "notion-api");
    fields.notionState.textContent = notion.credentialMigrationRequired
      ? "Token uses legacy plaintext storage. Save sync settings to move it into the operating system credential store."
      : notionReady(notion)
        ? fields.notionConsent.checked ? "Ready" : "Credentials saved. Confirm external data handling to enable sync."
        : "Add a page ID and integration token to enable Notion sync.";

    const configuredSinks = [
      { ready: flomoReady(flomo), consented: fields.flomoConsent.checked },
      { ready: notionReady(notion), consented: fields.notionConsent.checked }
    ].filter((sink) => sink.ready);
    const approvedCount = configuredSinks.filter((sink) => sink.consented).length;
    const syncSummary = configuredSinks.length === 0
      ? { text: "Not configured", state: "warning" }
      : approvedCount === configuredSinks.length
        ? { text: `${approvedCount} ready`, state: "ready" }
        : { text: `${configuredSinks.length} configured, ${approvedCount} approved`, state: "warning" };
    setStatus(syncStatus, syncSummary.text, syncSummary.state);
  }

  function markUnavailable(label) {
    setStatus(storageStatus, label, "warning");
    setStatus(syncStatus, label, "warning");
  }

  function setStatus(element, text, state) {
    element.textContent = text;
    element.className = `status-pill ${state ? `is-${state}` : "is-neutral"}`;
  }

  function flomoReady(flomo) {
    return Boolean(flomo.enabled && flomo.webhookConfigured);
  }

  function notionReady(notion) {
    return Boolean(notion.enabled && notion.parentId && notion.tokenConfigured);
  }

  function splitTags(value) {
    return value
      .split(/[,\s]+/)
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean);
  }

  return {
    init,
    render,
    saveStorage,
    saveSync,
    openFolder,
    markUnavailable
  };
}
