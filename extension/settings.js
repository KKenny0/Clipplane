import {
  copySetupCommand,
  getSetupCommand,
  openOnboarding,
  openSetupGuide,
  safeErrorMessage
} from "./setup-guide.js";
import { buildSyncConsent, hasSyncConsent } from "./src/sync-consent.js";
import { historyActionDisabled } from "./src/history-actions.js";
import { getUiState, nextTabIndex, resolveHostUiState, stateClassName } from "./src/ui-state.js";
import { browserLabel, buildDiagnostics } from "./src/diagnostics.js";
import { createHostLink } from "./src/host-link.js";
import { createHistoryView } from "./src/history-view.js";

const hostLink = createHostLink();

const stateEl = document.querySelector("#settings-state");
const resultEl = document.querySelector("#result");
const resultMessageEl = document.querySelector("#result-message");
const storageStatusEl = document.querySelector("#storage-status");
const syncStatusEl = document.querySelector("#sync-status");
const historyStatusEl = document.querySelector("#history-status");
const historyListEl = document.querySelector("#history-list");
const historyWarningEl = document.querySelector("#history-warning");
const historyFilterButtons = [...document.querySelectorAll("[data-history-filter]")];
const hostPanelEl = document.querySelector("#host-panel");
const setupCommandEl = document.querySelector("#setup-command");
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const tabPanels = [...document.querySelectorAll("[data-panel]")];
const fields = {
  notesDir: document.querySelector("#notes-dir"),
  flomoEnabled: document.querySelector("#flomo-enabled"),
  flomoWebhook: document.querySelector("#flomo-webhook"),
  flomoTags: document.querySelector("#flomo-tags"),
  flomoConsent: document.querySelector("#flomo-consent"),
  flomoState: document.querySelector("#flomo-state"),
  notionEnabled: document.querySelector("#notion-enabled"),
  notionPage: document.querySelector("#notion-page"),
  notionToken: document.querySelector("#notion-token"),
  notionConsent: document.querySelector("#notion-consent"),
  notionState: document.querySelector("#notion-state"),
  storageNote: document.querySelector("#storage-note")
};
const buttons = [...document.querySelectorAll("button")];
const hostDependentControls = [
  fields.notesDir,
  fields.flomoEnabled,
  fields.flomoWebhook,
  fields.flomoTags,
  fields.flomoConsent,
  fields.notionEnabled,
  fields.notionPage,
  fields.notionToken,
  fields.notionConsent,
  document.querySelector("#save-storage"),
  document.querySelector("#open-folder"),
  document.querySelector("#refresh-history"),
  ...historyFilterButtons,
  document.querySelector("#save-sync")
];
let hostAvailable = true;
let activeTab = "history";
let syncConsent = { version: "", sinks: {} };

const historyView = createHistoryView({
  elements: {
    list: historyListEl,
    status: historyStatusEl,
    warning: historyWarningEl,
    filterButtons: historyFilterButtons
  },
  hostLink,
  confirm: (detail) => window.confirm(detail),
  notify: (message, isError) => showResult(message, isError),
  onHostUnavailable: () => renderHostUnavailable(),
  hostAvailable: () => hostAvailable
});

for (const button of tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab, { persist: true, updateHash: true }));
  button.addEventListener("keydown", handleTabKeydown);
}
document.querySelector("#save-storage").addEventListener("click", saveStorage);
document.querySelector("#open-folder").addEventListener("click", openFolder);
document.querySelector("#copy-diagnostics").addEventListener("click", copyDiagnostics);
document.querySelector("#refresh-history").addEventListener("click", () => historyView.load());
for (const button of historyFilterButtons) {
  button.addEventListener("click", () => historyView.setMode(button.dataset.historyFilter));
}
document.querySelector("#save-sync").addEventListener("click", saveSync);
document.querySelector("#sync-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#copy-setup").addEventListener("click", copySetup);
document.querySelector("#open-guide").addEventListener("click", openSetupGuide);
document.querySelector("#retry-host").addEventListener("click", loadSettings);
document.querySelector("#install-host").addEventListener("click", openOnboarding);
window.addEventListener("hashchange", () => {
  const tab = tabFromHash();
  if (tab) {
    setActiveTab(tab, { persist: true });
  }
});

initSettings();

async function initSettings() {
  syncConsent = (await chrome.storage.local.get("syncConsent")).syncConsent || syncConsent;
  const preferred = tabFromHash() || await loadSavedTab() || "history";
  setActiveTab(preferred, { persist: false, updateHash: false });
  await loadSettings();
}

async function loadSettings() {
  setBusy(true, "Loading");
  let loaded = false;
  try {
    const status = await hostLink.send({ type: "status" });
    if (status.problem === "host-outdated" || status.problem === "host-unavailable") {
      renderHostUnavailable(status.problem === "host-outdated");
      return;
    }
    if (status.problem) {
      throw new Error(status.response.error?.message || "Could not check the local Host.");
    }
    const response = await hostLink.send({ type: "get_config" });
    if (response.problem === "host-outdated" || response.problem === "host-unavailable") {
      renderHostUnavailable(response.problem === "host-outdated");
      return;
    }
    if (response.problem) {
      throw new Error(response.response.error?.message || "Could not load settings.");
    }
    hostAvailable = true;
    hostPanelEl.hidden = true;
    renderSettings(response.response);
    if (activeTab === "history") {
      await historyView.load();
    }
    showResult("");
    loaded = true;
  } catch (error) {
    showResult(safeErrorMessage(error), true);
    if (!hostAvailable) {
      setWorkspaceState("host-missing");
    } else {
      setWorkspaceState("error");
    }
  } finally {
    setBusy(false, loaded ? "Ready" : stateEl.textContent);
  }
}

async function saveStorage() {
  setBusy(true, "Saving");
  try {
    const response = await hostLink.send({
      type: "set_config",
      config: {
        storage: {
          notesDir: fields.notesDir.value.trim()
        }
      }
    });
    if (response.problem === "host-unavailable" || response.problem === "host-outdated") {
      renderHostUnavailable(response.problem === "host-outdated");
      throw new Error("Run local host setup, then retry.");
    }
    if (response.problem) {
      throw new Error(response.response.error?.message || "Could not save folder.");
    }
    renderSettings(response.response);
    showResult("Storage folder saved");
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

    const response = await hostLink.send({
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
    if (response.problem === "host-unavailable" || response.problem === "host-outdated") {
      renderHostUnavailable(response.problem === "host-outdated");
      throw new Error("Run local host setup, then retry.");
    }
    if (response.problem) {
      throw new Error(response.response.error?.message || "Could not save sync settings.");
    }
    fields.flomoWebhook.value = "";
    fields.notionToken.value = "";
    syncConsent = nextConsent;
    await chrome.storage.local.set({ syncConsent });
    renderSettings(response.response);
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
    const response = await hostLink.send({ type: "open_notes_dir" });
    if (response.problem === "host-unavailable" || response.problem === "host-outdated") {
      renderHostUnavailable(response.problem === "host-outdated");
      throw new Error("Run local host setup, then retry.");
    }
    if (response.problem) {
      throw new Error(response.response.error?.message || "Could not open folder.");
    }
    showResult("Storage folder open request sent");
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
  setStatus(syncStatusEl, syncSummary.text, syncSummary.state);
}

function flomoReady(flomo) {
  return Boolean(flomo.enabled && flomo.webhookConfigured);
}

function notionReady(notion) {
  return Boolean(notion.enabled && notion.parentId && notion.tokenConfigured);
}

function setStatus(element, text, state) {
  element.textContent = text;
  element.className = `status-pill ${state ? `is-${state}` : "is-neutral"}`;
}

function setBusy(isBusy, label) {
  setWorkspaceState(isBusy ? label : (hostAvailable ? label : "Host unavailable"));
  for (const button of buttons) {
    button.disabled = isBusy;
  }
  updateHostDependentControls(isBusy);
  historyView.setBusy(isBusy);
}

function showResult(message, isError = false) {
  resultEl.hidden = !message;
  resultMessageEl.textContent = message;
  const uiState = getUiState(isError ? "error" : "saved-local");
  resultEl.className = stateClassName("result", uiState);
}

function splitTags(value) {
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean);
}

async function copyDiagnostics() {
  setBusy(true, "Checking");
  try {
    const [platform, statusOutcome] = await Promise.all([
      chrome.runtime.getPlatformInfo(),
      hostLink.send({ type: "status" })
    ]);
    const status = statusOutcome.response;
    const diagnostics = buildDiagnostics({
      platform,
      browser: browserLabel(navigator.userAgentData, navigator.userAgent),
      extensionVersion: chrome.runtime.getManifest().version,
      status
    });
    await copyText(diagnostics);
    showResult("Diagnostics copied");
  } catch {
    showResult("Could not copy diagnostics.", true);
  } finally {
    setBusy(false, "Ready");
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the extension-page clipboard fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("clipboard_unavailable");
  }
}

function renderHostUnavailable(outdated = false) {
  const uiState = resolveHostUiState({ ok: false, error: { code: outdated ? "host_outdated" : "host_unavailable" } });
  hostAvailable = false;
  hostPanelEl.hidden = false;
  setupCommandEl.textContent = getSetupCommand();
  document.querySelector("#host-title").textContent = uiState.title;
  document.querySelector("#host-detail").textContent = uiState.detail;
  document.querySelector("#host-status").textContent = uiState.label;
  document.querySelector("#host-status").className = `status-pill is-${uiState.tone}`;
  document.querySelector("#install-host").textContent = uiState.action;
  setWorkspaceState(uiState.key);
  setStatus(storageStatusEl, uiState.label, "warning");
  setStatus(syncStatusEl, uiState.label, "warning");
  historyView.setUnavailable();
  updateHostDependentControls();
}

async function setActiveTab(tab, options = {}) {
  if (!isTab(tab)) {
    tab = "history";
  }
  activeTab = tab;

  for (const button of tabButtons) {
    const selected = button.dataset.tab === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.panel !== tab;
  }

  if (options.updateHash && location.hash !== `#${tab}`) {
    history.replaceState(null, "", `#${tab}`);
  }

  if (options.persist) {
    chrome.storage.local.set({ settingsTab: tab }).catch(() => {});
  }

  if (tab === "history" && hostAvailable) {
    await historyView.ensureLoaded();
  }
}

function tabFromHash() {
  const value = location.hash.replace(/^#/, "");
  return isTab(value) ? value : "";
}

async function loadSavedTab() {
  try {
    const { settingsTab } = await chrome.storage.local.get("settingsTab");
    return isTab(settingsTab) ? settingsTab : "";
  } catch {
    return "";
  }
}

function isTab(value) {
  return ["storage", "history", "sync"].includes(value);
}

function updateHostDependentControls(isBusy = false) {
  for (const control of hostDependentControls) {
    control.disabled = isBusy || !hostAvailable;
  }
}

async function copySetup() {
  try {
    await copySetupCommand();
    showResult("Setup command copied");
  } catch {
    showResult("Could not copy. Select the command shown above.", true);
  }
}

function setWorkspaceState(value) {
  const aliases = {
    Loading: "checking",
    Saving: "working",
    Opening: "working",
    Ready: "ready",
    Checking: "checking",
    Error: "error",
    Failed: "error",
    "Host unavailable": "host-missing",
    "Host missing": "host-missing",
    "Update required": "host-outdated"
  };
  const uiState = getUiState(aliases[value] || value);
  const dot = document.createElement("i");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  stateEl.className = stateClassName("muted", uiState);
  stateEl.replaceChildren(dot, document.createTextNode(uiState.label));
}

function handleTabKeydown(event) {
  const currentIndex = tabButtons.indexOf(event.currentTarget);
  const nextIndex = nextTabIndex(event.key, currentIndex, tabButtons.length);
  if (nextIndex === null) {
    return;
  }
  event.preventDefault();
  const next = tabButtons[nextIndex];
  setActiveTab(next.dataset.tab, { persist: true, updateHash: true });
  next.focus();
}
