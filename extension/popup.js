import {
  copySetupCommand,
  getSetupCommand,
  isHostUnavailable,
  isHostOutdated,
  openOnboarding,
  openSetupGuide,
  safeErrorMessage
} from "./setup-guide.js";
import { getExternalSyncStatus } from "./src/sync-consent.js";
import { getUiState, resolveClipUiState, resolveHostUiState, stateClassName } from "./src/ui-state.js";

const stateEl = document.querySelector("#state");
const resultEl = document.querySelector("#result");
const resultLabelEl = document.querySelector("#result-label");
const resultTitleEl = document.querySelector("#result-title");
const resultDetailEl = document.querySelector("#result-detail");
const resultDetailsEl = document.querySelector("#result-details");
const resultPathEl = document.querySelector("#result-path");
const resultPrimaryEl = document.querySelector("#result-primary");
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
let currentResult = null;

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
resultPrimaryEl.addEventListener("click", handleResultAction);

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
      renderResult(response);
      window.setTimeout(() => window.close(), 180);
      return;
    }
    renderResult(response);
    await refreshStatus({ preserveState: true });
  } catch (error) {
    renderResult({ ok: false, error: { message: safeErrorMessage(error) } });
  } finally {
    setBusy(false);
  }
}

async function refreshStatus(options = {}) {
  try {
    const status = await chrome.runtime.sendMessage({ type: "status" });
    if (isHostUnavailable(status) || isHostOutdated(status)) {
      renderHostUnavailable(isHostOutdated(status));
      return;
    }
    hostAvailable = true;
    hostPanelEl.hidden = true;
    if (!options.preserveState) {
      setPopupState(resolveHostUiState(status));
    }
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
  if (isBusy) {
    setPopupState(getUiState("working"));
  }
  for (const button of buttons) {
    button.disabled = isBusy;
  }
  updateActionButtons(isBusy);
}

function renderResult(response) {
  currentResult = response;
  const uiState = resolveClipUiState(response);
  if (!response?.ok && ["error", "unsupported"].includes(uiState.key)) {
    uiState.detail = safeErrorMessage(response, uiState.detail);
  }

  resultEl.hidden = false;
  resultEl.className = stateClassName("result-card", uiState);
  resultLabelEl.textContent = uiState.label;
  resultTitleEl.textContent = uiState.title;
  resultDetailEl.textContent = response?.capture?.title
    ? `${uiState.detail} ${response.capture.title}`
    : uiState.detail;

  const localPath = response?.capture?.local_path || "";
  resultDetailsEl.hidden = !localPath;
  resultDetailsEl.open = false;
  resultPathEl.textContent = localPath;

  resultPrimaryEl.hidden = !uiState.action;
  resultPrimaryEl.textContent = uiState.action;
  setPopupState(uiState);
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

  const { configured, consented } = getExternalSyncStatus(status);
  const configuredNames = configured.map((name) => name.replace("-api", ""));

  hasConfiguredSync = consented.length > 0;
  syncStatusEl.textContent = configuredNames.length === 0
    ? "Not configured"
    : consented.length === configured.length
      ? `${configuredNames.join(", ")} ready`
      : consented.length === 0
        ? `${configuredNames.join(", ")} needs approval`
        : `${consented.length} of ${configured.length} approved`;
  document.querySelector("#configure-sync").hidden = hasConfiguredSync;
  updateActionButtons();
}

function updateActionButtons(forceDisabled = false) {
  clipLocalButton.disabled = forceDisabled || !hostAvailable;
  clipSyncButton.disabled = forceDisabled || !hostAvailable || !hasConfiguredSync;
}

function renderHostUnavailable(outdated = false) {
  const uiState = getUiState(outdated ? "host-outdated" : "host-missing");
  hostAvailable = false;
  hasConfiguredSync = false;
  setPopupState(uiState);
  syncStatusEl.textContent = uiState.label;
  document.querySelector(".host-title").textContent = uiState.title;
  document.querySelector("#host-detail").textContent = uiState.detail;
  document.querySelector("#install-host").textContent = uiState.action;
  setupCommandEl.textContent = getSetupCommand();
  hostPanelEl.hidden = false;
  document.querySelector("#configure-sync").hidden = false;
  updateActionButtons();
}

async function copySetup() {
  try {
    await copySetupCommand();
    showTransientResult("Command copied", "Paste it into a terminal from the Clipplane source folder.");
  } catch {
    showTransientResult("Command not copied", "Select the command and copy it manually.", "error");
  }
}

async function openSettings(tab) {
  if (tab) {
    await chrome.storage.local.set({ settingsTab: tab });
  }
  await chrome.runtime.openOptionsPage();
}

async function handleResultAction() {
  const state = resolveClipUiState(currentResult);
  if (["saved-local", "duplicate"].includes(state.key)) {
    const captureId = currentResult?.capture?.capture_id;
    if (!captureId) {
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "open_capture_body", captureId });
    if (!response?.ok) {
      renderResult(response);
    } else {
      showTransientResult("Local copy opened", "Clipplane opened the saved body from your capture trail.");
    }
    return;
  }
  if (state.key === "saved-local-sync-failed") {
    const captureId = currentResult?.capture?.capture_id;
    if (!captureId) {
      return;
    }
    setBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "sync", captureId });
      renderResult({ ...currentResult, sync: response });
    } finally {
      setBusy(false);
    }
    return;
  }
  if (state.key === "consent-required") {
    await openSettings("sync");
    return;
  }
  if (["host-missing", "host-outdated"].includes(state.key)) {
    openOnboarding();
  }
}

function showTransientResult(title, detail, tone = "ready") {
  const uiState = { ...getUiState(tone === "error" ? "error" : "ready"), title, detail, tone, action: "" };
  currentResult = null;
  resultEl.hidden = false;
  resultEl.className = stateClassName("result-card", uiState);
  resultLabelEl.textContent = tone === "error" ? "Action failed" : "Done";
  resultTitleEl.textContent = title;
  resultDetailEl.textContent = detail;
  resultPathEl.hidden = true;
  resultPrimaryEl.hidden = true;
  setPopupState(uiState);
}

function setPopupState(uiState) {
  const dot = document.createElement("i");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  stateEl.className = stateClassName("state", uiState);
  stateEl.replaceChildren(dot, document.createTextNode(uiState.label));
}
