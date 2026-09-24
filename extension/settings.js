import {
  copySetupCommand,
  getSetupCommand,
  openOnboarding,
  openSetupGuide,
  safeErrorMessage
} from "./setup-guide.js";
import { getUiState, nextTabIndex, resolveHostUiState, stateClassName } from "./src/ui-state.js";
import { browserLabel, buildDiagnostics } from "./src/diagnostics.js";
import { createHostLink } from "./src/host-link.js";
import { createHistoryView } from "./src/history-view.js";
import { createSettingsForm } from "./src/settings-form.js";

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

const settingsForm = createSettingsForm({
  elements: { fields, storageStatus: storageStatusEl, syncStatus: syncStatusEl },
  hostLink,
  notify: (message, isError) => showResult(message, isError),
  onHostUnavailable: () => renderHostUnavailable(),
  storage: chrome.storage.local
});

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
document.querySelector("#save-storage").addEventListener("click", () => runHostTask("Saving", () => settingsForm.saveStorage()));
document.querySelector("#open-folder").addEventListener("click", () => runHostTask("Opening", () => settingsForm.openFolder()));
document.querySelector("#copy-diagnostics").addEventListener("click", copyDiagnostics);
document.querySelector("#refresh-history").addEventListener("click", () => historyView.load());
for (const button of historyFilterButtons) {
  button.addEventListener("click", () => historyView.setMode(button.dataset.historyFilter));
}
document.querySelector("#save-sync").addEventListener("click", () => runHostTask("Saving", () => settingsForm.saveSync()));
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
  await settingsForm.init();
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
    settingsForm.render(response.response);
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




function setBusy(isBusy, label) {
  setWorkspaceState(isBusy ? label : (hostAvailable ? label : "Host unavailable"));
  for (const button of buttons) {
    button.disabled = isBusy;
  }
  updateHostDependentControls(isBusy);
  historyView.setBusy(isBusy);
}

async function runHostTask(label, task) {
  setBusy(true, label);
  try {
    await task();
  } catch (error) {
    showResult(safeErrorMessage(error), true);
  } finally {
    setBusy(false, "Ready");
  }
}

function showResult(message, isError = false) {
  resultEl.hidden = !message;
  resultMessageEl.textContent = message;
  const uiState = getUiState(isError ? "error" : "saved-local");
  resultEl.className = stateClassName("result", uiState);
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
  settingsForm.markUnavailable(uiState.label);
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
