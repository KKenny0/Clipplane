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
const historyStatusEl = document.querySelector("#history-status");
const historyListEl = document.querySelector("#history-list");
const historyWarningEl = document.querySelector("#history-warning");
const hostPanelEl = document.querySelector("#host-panel");
const setupCommandEl = document.querySelector("#setup-command");
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const tabPanels = [...document.querySelectorAll("[data-panel]")];
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
  document.querySelector("#refresh-history"),
  document.querySelector("#save-sync")
];
let hostAvailable = true;
let historyItems = [];
let activeTab = "history";
let historyLoaded = false;

for (const button of tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab, { persist: true, updateHash: true }));
}
document.querySelector("#save-storage").addEventListener("click", saveStorage);
document.querySelector("#open-folder").addEventListener("click", openFolder);
document.querySelector("#refresh-history").addEventListener("click", loadHistory);
document.querySelector("#save-sync").addEventListener("click", saveSync);
document.querySelector("#sync-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#copy-setup").addEventListener("click", copySetup);
document.querySelector("#open-guide").addEventListener("click", openSetupGuide);
document.querySelector("#retry-host").addEventListener("click", loadSettings);
historyListEl.addEventListener("click", handleHistoryAction);
window.addEventListener("hashchange", () => {
  const tab = tabFromHash();
  if (tab) {
    setActiveTab(tab, { persist: true });
  }
});

initSettings();

async function initSettings() {
  const preferred = tabFromHash() || await loadSavedTab() || "history";
  setActiveTab(preferred, { persist: false, updateHash: false });
  await loadSettings();
}

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
    if (activeTab === "history") {
      await loadHistory();
    }
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

async function loadHistory() {
  if (!hostAvailable) {
    renderHistoryUnavailable();
    return;
  }

  setStatus(historyStatusEl, "Loading", "");
  historyWarningEl.hidden = true;
  historyListEl.innerHTML = '<div class="history-empty">Loading capture history</div>';
  try {
    const response = await sendNative({ type: "history", limit: 50 });
    if (!response.ok) {
      if (isHostUnavailable(response)) {
        renderHostUnavailable();
        return;
      }
      if (isUnsupportedMessage(response)) {
        renderHistoryUpgradeRequired();
        return;
      }
      throw new Error(response.error?.message || "Could not load capture history.");
    }
    historyItems = response.history?.items || [];
    renderHistory(response.history || { items: [], warnings: [] });
    historyLoaded = true;
  } catch (error) {
    setStatus(historyStatusEl, "Error", "warning");
    historyListEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = safeErrorMessage(error, "Could not load capture history.");
    historyListEl.append(empty);
  }
}

async function handleHistoryAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const captureId = button.dataset.captureId;
  if (!captureId) {
    return;
  }

  setHistoryButtons(true);
  try {
    if (button.dataset.action === "open-body") {
      const response = await sendNative({ type: "open_capture_body", captureId });
      if (!response.ok) {
        throw new Error(response.error?.message || "Could not open capture body.");
      }
      showResult(`Capture opened at ${formatTime(response.opened_at)}`);
      return;
    }

    if (button.dataset.action === "retry-sync") {
      const response = await sendNative({ type: "sync", captureId });
      if (!response.ok) {
        throw new Error(response.error?.message || "Could not retry sync.");
      }
      showResult(syncResultMessage(response));
      await loadHistory();
    }
  } catch (error) {
    showResult(safeErrorMessage(error), true);
  } finally {
    setHistoryButtons(false);
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

function renderHistory(history) {
  const warnings = history.warnings || [];
  const items = history.items || [];
  historyListEl.innerHTML = "";

  if (warnings.length) {
    historyWarningEl.hidden = false;
    historyWarningEl.textContent = `${warnings.length} unreadable capture record${warnings.length === 1 ? "" : "s"} skipped.`;
  } else {
    historyWarningEl.hidden = true;
    historyWarningEl.textContent = "";
  }

  if (!items.length) {
    setStatus(historyStatusEl, "Empty", "warning");
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No local clips yet. Save a page or selection to start a trail.";
    historyListEl.append(empty);
    return;
  }

  setStatus(historyStatusEl, `${items.length} recent`, "ready");
  for (const item of items) {
    historyListEl.append(renderHistoryItem(item));
  }
}

function renderHistoryItem(item) {
  const row = document.createElement("article");
  row.className = "history-item";

  const main = document.createElement("div");
  main.className = "history-main";

  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = item.title || "Untitled";

  const meta = document.createElement("div");
  meta.className = "history-meta";
  meta.textContent = [
    item.source_host || "local",
    formatDateTime(item.clipped_at),
    item.input_type || "page"
  ].filter(Boolean).join(" · ");

  const tags = document.createElement("div");
  tags.className = "history-tags";
  for (const tag of item.tags || []) {
    const pill = document.createElement("span");
    pill.textContent = `#${tag}`;
    tags.append(pill);
  }

  main.append(title, meta);
  if (item.tags?.length) {
    main.append(tags);
  }

  const actions = document.createElement("div");
  actions.className = "history-actions";

  const status = document.createElement("span");
  status.className = `history-state ${historyStateClass(item.sync_status)}`;
  status.textContent = historyStatusLabel(item.sync_status, item.content_exists);
  actions.append(status);

  const open = document.createElement("button");
  open.className = "secondary history-action";
  open.type = "button";
  open.dataset.action = "open-body";
  open.dataset.captureId = item.capture_id;
  open.textContent = item.content_exists ? "Open body" : "Body missing";
  open.disabled = !item.content_exists || !hostAvailable;
  actions.append(open);

  if (item.sync_status === "sync_failed") {
    const retry = document.createElement("button");
    retry.className = "primary history-action";
    retry.type = "button";
    retry.dataset.action = "retry-sync";
    retry.dataset.captureId = item.capture_id;
    retry.textContent = "Retry sync";
    retry.disabled = !hostAvailable;
    actions.append(retry);
  }

  row.append(main, actions);
  return row;
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
  setHistoryButtons(isBusy);
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

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown time";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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
  renderHistoryUnavailable();
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

  if (tab === "history" && hostAvailable && !historyLoaded) {
    await loadHistory();
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

function renderHistoryUnavailable() {
  setStatus(historyStatusEl, "Unavailable", "warning");
  historyWarningEl.hidden = true;
  historyListEl.innerHTML = '<div class="history-empty">Install the local host to inspect your capture trail.</div>';
}

function renderHistoryUpgradeRequired() {
  setStatus(historyStatusEl, "Update host", "warning");
  historyWarningEl.hidden = false;
  historyWarningEl.textContent = "Your browser is talking to an older Clipplane local host. Rerun setup for this browser, then refresh history.";
  historyListEl.innerHTML = '<div class="history-empty">Capture history needs the latest local host protocol.</div>';
}

function setHistoryButtons(isBusy) {
  for (const button of historyListEl.querySelectorAll("button")) {
    const item = historyItems.find((capture) => capture.capture_id === button.dataset.captureId);
    const missingBody = button.dataset.action === "open-body" && item && !item.content_exists;
    button.disabled = isBusy || !hostAvailable || missingBody;
  }
}

function historyStateClass(status) {
  if (status === "synced") {
    return "synced";
  }
  if (status === "sync_failed") {
    return "failed";
  }
  return "";
}

function historyStatusLabel(status, contentExists) {
  if (!contentExists) {
    return "Body missing";
  }
  if (status === "synced") {
    return "Synced";
  }
  if (status === "sync_failed") {
    return "Sync failed";
  }
  if (status === "sync_skipped") {
    return "Sync skipped";
  }
  return "Saved local";
}

function syncResultMessage(response) {
  if (response.status === "synced") {
    return "Sync retried successfully";
  }
  if (response.status === "sync_failed") {
    return "Saved locally, sync still failed";
  }
  if (response.status === "sync_skipped") {
    return "Sync skipped";
  }
  return "Sync retry finished";
}

async function copySetup() {
  try {
    await copySetupCommand();
    showResult("Setup command copied.");
  } catch {
    showResult("Could not copy. Select the command shown above.", true);
  }
}

function isUnsupportedMessage(response) {
  return response?.error?.code === "unknown_message"
    || /Unsupported native host message/i.test(response?.error?.message || "");
}
