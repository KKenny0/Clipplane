import {
  copySetupCommand,
  getSetupCommand,
  isHostUnavailable,
  isHostOutdated,
  openOnboarding,
  openSetupGuide,
  safeErrorMessage
} from "./setup-guide.js";

const stateEl = document.querySelector("#state");
const resultEl = document.querySelector("#result");
const syncStatusEl = document.querySelector("#sync-status");
const hostPanelEl = document.querySelector("#host-panel");
const setupCommandEl = document.querySelector("#setup-command");
const clipLocalButton = document.querySelector("#clip-local");
const clipSyncButton = document.querySelector("#clip-sync");
const buttons = [...document.querySelectorAll("button")];
const modeButtons = {
  selection: document.querySelector("#mode-selection"),
  page: document.querySelector("#mode-page"),
  element: document.querySelector("#mode-element")
};
let mode = "selection";
let hostAvailable = true;
let hasConfiguredSync = false;

modeButtons.selection.addEventListener("click", () => setMode("selection"));
modeButtons.page.addEventListener("click", () => setMode("page"));
modeButtons.element.addEventListener("click", () => setMode("element"));
clipLocalButton.addEventListener("click", () => clip(false));
clipSyncButton.addEventListener("click", () => clip(true));
document.querySelector("#copy-setup").addEventListener("click", copySetup);
document.querySelector("#install-host").addEventListener("click", openOnboarding);
document.querySelector("#open-guide").addEventListener("click", openSetupGuide);
document.querySelector("#retry-host").addEventListener("click", refreshStatus);
document.querySelector("#open-settings").addEventListener("click", () => openSettings());
document.querySelector("#configure-sync").addEventListener("click", () => openSettings("sync"));

chrome.storage.local.get("lastClipResult").then(({ lastClipResult }) => {
  if (lastClipResult) {
    renderResult(lastClipResult);
  }
});

refreshStatus();

async function clip(sync) {
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "clip", mode, sync });
    if (response?.pending) {
      resultEl.className = "result";
      resultEl.textContent = "Choose an area in the page.";
      window.setTimeout(() => window.close(), 180);
      return;
    }
    renderResult(response);
    refreshStatus();
  } catch (error) {
    renderResult({ ok: false, error: { message: safeErrorMessage(error) } });
  } finally {
    setBusy(false);
  }
}

async function refreshStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "status" });
    if (isHostUnavailable(status) || isHostOutdated(status)) {
      renderHostUnavailable(isHostOutdated(status));
      return;
    }
    hostAvailable = true;
    hostPanelEl.hidden = true;
    setPopupState("Ready");
    renderSyncStatus(status);
  } catch (error) {
    renderHostUnavailable();
  }
}

function setMode(nextMode) {
  mode = nextMode;
  for (const [key, button] of Object.entries(modeButtons)) {
    button.classList.toggle("active", key === mode);
    button.setAttribute("aria-pressed", String(key === mode));
  }
  updateActionLabels();
}

function updateActionLabels() {
  const choosingElement = mode === "element";
  setActionLabel(
    clipLocalButton,
    choosingElement ? "Choose area" : "Save local",
    choosingElement ? "Pick a region" : "Inbox first"
  );
  setActionLabel(
    clipSyncButton,
    choosingElement ? "Choose area + sync" : "Save + sync",
    choosingElement ? "Pick before sending" : "Only configured destinations"
  );
}

function setActionLabel(button, label, detail) {
  button.querySelector("span").textContent = label;
  button.querySelector("small").textContent = detail;
}

function setBusy(isBusy) {
  setPopupState(isBusy ? "Clipping" : (hostAvailable ? "Ready" : "Host unavailable"));
  for (const button of buttons) {
    button.disabled = isBusy;
  }
  updateActionButtons(isBusy);
}

function renderResult(response) {
  if (!response?.ok) {
    resultEl.className = "result error";
    if (isHostUnavailable(response)) {
      renderHostUnavailable();
      resultEl.textContent = "Run local host setup, then retry.";
      return;
    }
    resultEl.textContent = safeErrorMessage(response, "Clip failed.");
    return;
  }

  resultEl.className = "result";
  const capture = response.capture;
  const duplicate = response.duplicate ? "Duplicate skipped" : "Saved";
  const sync = summarizeSync(response.sync);
  resultEl.textContent = sync
    ? `${duplicate}\n${sync}\n${capture.title}`
    : `${duplicate}\n${capture.title}\n${capture.local_path}`;
}

function renderSyncStatus(status) {
  if (!status?.ok) {
    if (isHostUnavailable(status)) {
      renderHostUnavailable();
      return;
    }
    syncStatusEl.textContent = "Unavailable";
    document.querySelector("#configure-sync").hidden = false;
    hasConfiguredSync = false;
    updateActionButtons();
    return;
  }

  const configured = Object.entries(status.sinks)
    .filter(([name, sink]) => name !== "local-export" && sink.enabled && sink.configured)
    .map(([name]) => name.replace("-api", ""));

  hasConfiguredSync = configured.length > 0;
  syncStatusEl.textContent = configured.length ? configured.join(", ") : "Not configured";
  document.querySelector("#configure-sync").hidden = configured.length > 0;
  updateActionButtons();
}

function updateActionButtons(forceDisabled = false) {
  clipLocalButton.disabled = forceDisabled || !hostAvailable;
  clipSyncButton.disabled = forceDisabled || !hostAvailable || !hasConfiguredSync;
}

function renderHostUnavailable(outdated = false) {
  hostAvailable = false;
  hasConfiguredSync = false;
  setPopupState(outdated ? "Host outdated" : "Host unavailable");
  syncStatusEl.textContent = outdated ? "Update required" : "Host unavailable";
  document.querySelector(".host-title").textContent = outdated ? "Local host update required" : "Local host unavailable";
  setupCommandEl.textContent = getSetupCommand();
  hostPanelEl.hidden = false;
  document.querySelector("#configure-sync").hidden = false;
  updateActionButtons();
}

async function copySetup() {
  try {
    await copySetupCommand();
    resultEl.className = "result";
    resultEl.textContent = "Setup command copied.";
  } catch {
    resultEl.className = "result error";
    resultEl.textContent = "Could not copy. Select the command shown above.";
  }
}

async function openSettings(tab) {
  if (tab) {
    await chrome.storage.local.set({ settingsTab: tab });
  }
  await chrome.runtime.openOptionsPage();
}

function summarizeSync(sync) {
  if (!sync || sync.status === "no_sinks") {
    return "";
  }
  if (sync.status === "synced") {
    return "Synced";
  }
  if (sync.status === "sync_failed") {
    return "Saved locally, sync failed";
  }
  if (sync.status === "sync_skipped") {
    return "Saved locally, sync skipped";
  }
  return "";
}

function setPopupState(label) {
  const dot = document.createElement("i");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  stateEl.replaceChildren(dot, document.createTextNode(label));
}
