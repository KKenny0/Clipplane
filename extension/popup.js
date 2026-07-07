const stateEl = document.querySelector("#state");
const resultEl = document.querySelector("#result");
const syncStatusEl = document.querySelector("#sync-status");
const buttons = [...document.querySelectorAll("button")];
const modeButtons = {
  selection: document.querySelector("#mode-selection"),
  page: document.querySelector("#mode-page")
};
const settingsButtons = [
  document.querySelector("#open-settings"),
  document.querySelector("#configure-sync")
];

let mode = "selection";
let hasConfiguredSync = false;

modeButtons.selection.addEventListener("click", () => setMode("selection"));
modeButtons.page.addEventListener("click", () => setMode("page"));
document.querySelector("#clip-local").addEventListener("click", () => clip(false));
document.querySelector("#clip-sync").addEventListener("click", () => clip(true));
for (const button of settingsButtons) {
  button.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

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
    renderResult(response);
    refreshStatus();
  } catch (error) {
    renderResult({ ok: false, error: { message: error.message } });
  } finally {
    setBusy(false);
  }
}

async function refreshStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "status" });
    renderSyncStatus(status);
  } catch (error) {
    syncStatusEl.textContent = "Host unavailable";
    hasConfiguredSync = false;
    updateSyncButton();
  }
}

function setMode(nextMode) {
  mode = nextMode;
  for (const [key, button] of Object.entries(modeButtons)) {
    button.classList.toggle("active", key === mode);
    button.setAttribute("aria-pressed", String(key === mode));
  }
}

function setBusy(isBusy) {
  stateEl.textContent = isBusy ? "Clipping" : "Ready";
  for (const button of buttons) {
    button.disabled = isBusy;
  }
  updateSyncButton(isBusy);
}

function renderResult(response) {
  if (!response?.ok) {
    resultEl.className = "result error";
    resultEl.textContent = response?.error?.message || "Clip failed.";
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
    syncStatusEl.textContent = "Host unavailable";
    document.querySelector("#configure-sync").hidden = false;
    hasConfiguredSync = false;
    updateSyncButton();
    return;
  }

  const configured = Object.entries(status.sinks)
    .filter(([name, sink]) => name !== "local-export" && sink.enabled && sink.configured)
    .map(([name]) => name.replace("-api", ""));

  hasConfiguredSync = configured.length > 0;
  syncStatusEl.textContent = configured.length ? configured.join(", ") : "Not configured";
  document.querySelector("#configure-sync").hidden = configured.length > 0;
  updateSyncButton();
}

function updateSyncButton(forceDisabled = false) {
  const syncButton = document.querySelector("#clip-sync");
  syncButton.disabled = forceDisabled || !hasConfiguredSync;
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
