import {
  copySetupCommand,
  getSetupCommand,
  isHostUnavailable,
  openSetupGuide,
  safeErrorMessage
} from "./setup-guide.js";

const stateEl = document.querySelector("#settings-state");
const resultEl = document.querySelector("#result");
const storageStatusEl = document.querySelector("#storage-status");
const syncStatusEl = document.querySelector("#sync-status");
const hostPanelEl = document.querySelector("#host-panel");
const setupCommandEl = document.querySelector("#setup-command");
const fields = {
  notesDir: document.querySelector("#notes-dir"),
  flomoEnabled: document.querySelector("#flomo-enabled"),
  flomoWebhook: document.querySelector("#flomo-webhook"),
  flomoTags: document.querySelector("#flomo-tags"),
  flomoState: document.querySelector("#flomo-state"),
  notionEnabled: document.querySelector("#notion-enabled"),
  notionPage: document.querySelector("#notion-page"),
  notionToken: document.querySelector("#notion-token"),
  notionState: document.querySelector("#notion-state"),
  storageNote: document.querySelector("#storage-note")
};
const buttons = [...document.querySelectorAll("button")];
const hostDependentControls = [
  fields.notesDir,
  fields.flomoEnabled,
  fields.flomoWebhook,
  fields.flomoTags,
  fields.notionEnabled,
  fields.notionPage,
  fields.notionToken,
  document.querySelector("#save-storage"),
  document.querySelector("#open-folder"),
  document.querySelector("#save-sync")
];
let hostAvailable = true;

document.querySelector("#save-storage").addEventListener("click", saveStorage);
document.querySelector("#open-folder").addEventListener("click", openFolder);
document.querySelector("#save-sync").addEventListener("click", saveSync);
document.querySelector("#sync-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#copy-setup").addEventListener("click", copySetup);
document.querySelector("#open-guide").addEventListener("click", openSetupGuide);
document.querySelector("#retry-host").addEventListener("click", loadSettings);

loadSettings();

async function loadSettings() {
  setBusy(true, "Loading");
  let loaded = false;
  try {
    const response = await sendNative({ type: "get_config" });
    if (!response.ok) {
      if (isHostUnavailable(response)) {
        renderHostUnavailable();
        return;
      }
      throw new Error(response.error?.message || "Could not load settings.");
    }
    hostAvailable = true;
    hostPanelEl.hidden = true;
    renderSettings(response);
    showResult("");
    loaded = true;
  } catch (error) {
    showResult(safeErrorMessage(error), true);
    if (!hostAvailable) {
      stateEl.textContent = "Host unavailable";
    } else {
      stateEl.textContent = "Error";
    }
  } finally {
    setBusy(false, loaded ? "Ready" : stateEl.textContent);
  }
}

async function saveStorage() {
  setBusy(true, "Saving");
  try {
    const response = await sendNative({
      type: "set_config",
      config: {
        storage: {
          notesDir: fields.notesDir.value.trim()
        }
      }
    });
    if (!response.ok) {
      if (isHostUnavailable(response)) {
        renderHostUnavailable();
        throw new Error("Run local host setup, then retry.");
      }
      throw new Error(response.error?.message || "Could not save folder.");
    }
    renderSettings(response);
    showResult("Folder saved");
  } catch (error) {
    showResult(safeErrorMessage(error), true);
  } finally {
    setBusy(false, "Ready");
  }
}

async function saveSync() {
  setBusy(true, "Saving");
  try {
    const defaultSinks = [];
    if (fields.flomoEnabled.checked) {
      defaultSinks.push("flomo-api");
    }
    if (fields.notionEnabled.checked) {
      defaultSinks.push("notion-api");
    }

    const response = await sendNative({
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
    if (!response.ok) {
      if (isHostUnavailable(response)) {
        renderHostUnavailable();
        throw new Error("Run local host setup, then retry.");
      }
      throw new Error(response.error?.message || "Could not save sync settings.");
    }
    fields.flomoWebhook.value = "";
    fields.notionToken.value = "";
    renderSettings(response);
    showResult("Sync settings saved");
  } catch (error) {
    showResult(safeErrorMessage(error), true);
  } finally {
    setBusy(false, "Ready");
  }
}

async function openFolder() {
  setBusy(true, "Opening");
  try {
    const response = await sendNative({ type: "open_notes_dir" });
    if (!response.ok) {
      if (isHostUnavailable(response)) {
        renderHostUnavailable();
        throw new Error("Run local host setup, then retry.");
      }
      throw new Error(response.error?.message || "Could not open folder.");
    }
    showResult(`Folder opened at ${formatTime(response.opened_at)}`);
  } catch (error) {
    showResult(safeErrorMessage(error), true);
  } finally {
    setBusy(false, "Ready");
  }
}

function renderSettings(response) {
  const config = response.config;
  fields.notesDir.value = response.storage.notes_dir;
  fields.storageNote.textContent = response.storage.using_env_override
    ? "CLIPPLANE_NOTES_DIR is overriding this setting."
    : `Default: ${response.storage.default_notes_dir}`;
  setStatus(storageStatusEl, "Ready", "ready");

  const flomo = config.sinks["flomo-api"];
  fields.flomoEnabled.checked = flomo.enabled;
  fields.flomoWebhook.placeholder = flomo.webhookConfigured ? "Webhook saved" : "https://flomoapp.com/iwh/...";
  fields.flomoTags.value = flomo.tags.join(", ");
  fields.flomoState.textContent = flomoReady(flomo) ? "Ready" : "Paste a webhook URL to enable flomo sync.";

  const notion = config.sinks["notion-api"];
  fields.notionEnabled.checked = notion.enabled;
  fields.notionPage.value = notion.parentId;
  fields.notionToken.placeholder = notion.tokenConfigured ? "Token saved" : "secret_xxx";
  fields.notionState.textContent = notionReady(notion) ? "Ready" : "Add a page ID and integration token to enable Notion sync.";

  const readyCount = [flomoReady(flomo), notionReady(notion)].filter(Boolean).length;
  setStatus(syncStatusEl, readyCount ? `${readyCount} ready` : "Not configured", readyCount ? "ready" : "warning");
}

function flomoReady(flomo) {
  return Boolean(flomo.enabled && flomo.webhookConfigured);
}

function notionReady(notion) {
  return Boolean(notion.enabled && notion.parentId && notion.tokenConfigured);
}

function setStatus(element, text, state) {
  element.textContent = text;
  element.className = `status-pill ${state || ""}`.trim();
}

function setBusy(isBusy, label) {
  stateEl.textContent = isBusy ? label : (hostAvailable ? label : "Host unavailable");
  for (const button of buttons) {
    button.disabled = isBusy;
  }
  updateHostDependentControls(isBusy);
}

function showResult(message, isError = false) {
  resultEl.textContent = message;
  resultEl.className = isError ? "result error" : "result";
}

function splitTags(value) {
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function sendNative(message) {
  return chrome.runtime.sendMessage(message);
}

function renderHostUnavailable() {
  hostAvailable = false;
  hostPanelEl.hidden = false;
  setupCommandEl.textContent = getSetupCommand();
  stateEl.textContent = "Host unavailable";
  setStatus(storageStatusEl, "Unavailable", "warning");
  setStatus(syncStatusEl, "Unavailable", "warning");
  updateHostDependentControls();
}

function updateHostDependentControls(isBusy = false) {
  for (const control of hostDependentControls) {
    control.disabled = isBusy || !hostAvailable;
  }
}

async function copySetup() {
  try {
    await copySetupCommand();
    showResult("Setup command copied.");
  } catch {
    showResult("Could not copy. Select the command shown above.", true);
  }
}
