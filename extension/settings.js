import {
  copySetupCommand,
  getSetupCommand,
  isHostUnavailable,
  isHostOutdated,
  openOnboarding,
  openSetupGuide,
  safeErrorMessage
} from "./setup-guide.js";
import { buildSyncConsent, hasSyncConsent } from "./src/sync-consent.js";
import { historyActionDisabled } from "./src/history-actions.js";
import { getUiState, nextTabIndex, resolveHostUiState, stateClassName } from "./src/ui-state.js";
import { browserLabel, buildDiagnostics } from "./src/diagnostics.js";

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
let historyItems = [];
let activeTab = "history";
let historyLoaded = false;
let historyMode = "active";
let syncConsent = { version: "", sinks: {} };

for (const button of tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab, { persist: true, updateHash: true }));
  button.addEventListener("keydown", handleTabKeydown);
}
document.querySelector("#save-storage").addEventListener("click", saveStorage);
document.querySelector("#open-folder").addEventListener("click", openFolder);
document.querySelector("#copy-diagnostics").addEventListener("click", copyDiagnostics);
document.querySelector("#refresh-history").addEventListener("click", loadHistory);
for (const button of historyFilterButtons) {
  button.addEventListener("click", () => setHistoryMode(button.dataset.historyFilter));
}
document.querySelector("#save-sync").addEventListener("click", saveSync);
document.querySelector("#sync-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#copy-setup").addEventListener("click", copySetup);
document.querySelector("#open-guide").addEventListener("click", openSetupGuide);
document.querySelector("#retry-host").addEventListener("click", loadSettings);
document.querySelector("#install-host").addEventListener("click", openOnboarding);
historyListEl.addEventListener("click", handleHistoryAction);
document.addEventListener("click", closeHistoryMenusOnOutsideClick);
document.addEventListener("keydown", closeHistoryMenuOnEscape);
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
    const hostStatus = await sendNative({ type: "status" });
    if (!hostStatus.ok) {
      if (isHostUnavailable(hostStatus) || isHostOutdated(hostStatus)) {
        renderHostUnavailable(isHostOutdated(hostStatus));
        return;
      }
      throw new Error(hostStatus.error?.message || "Could not check the local Host.");
    }
    const response = await sendNative({ type: "get_config" });
    if (!response.ok) {
      if (isHostUnavailable(response) || isHostOutdated(response)) {
        renderHostUnavailable(isHostOutdated(response));
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
    syncConsent = nextConsent;
    await chrome.storage.local.set({ syncConsent });
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
    showResult(`Storage folder opened at ${formatTime(response.opened_at)}`);
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
    const response = await sendNative({ type: "history", limit: 50, lifecycle: historyMode });
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

  button.closest(".history-manage")?.removeAttribute("open");

  setHistoryButtons(true);
  try {
    if (["copy-agent", "copy-content"].includes(button.dataset.action)) {
      const mode = button.dataset.action === "copy-agent" ? "agent-reference" : "content";
      const response = await sendNative({ type: "copy_capture", captureId, mode });
      if (!response.ok) {
        if (isUnsupportedMessage(response)) {
          throw new Error("Update the local Host to copy captures.");
        }
        throw new Error(response.error?.message || "Could not copy capture.");
      }
      showResult(mode === "agent-reference"
        ? "Agent reference copied. Paste it into your Agent session."
        : "Capture content copied");
      return;
    }

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
      return;
    }

    if (button.dataset.action === "mark-processed") {
      const item = historyItems.find((capture) => capture.capture_id === captureId);
      const detail = item?.inbox_state === "missing"
        ? "Finish cleanup for this capture? Its internal history and source snapshot will be kept."
        : "Mark this capture as processed? It will be removed from inbox.md, while its internal history and source snapshot are kept.";
      if (!window.confirm(detail)) {
        return;
      }
      const response = await sendNative({ type: "process_capture", captureId });
      if (!response.ok) {
        throw new Error(response.error?.message || "Could not mark capture as processed.");
      }
      showResult("Capture marked as processed");
      await loadHistory();
      return;
    }

    if (button.dataset.action === "delete-capture") {
      if (!window.confirm("Permanently delete this local capture from inbox.md, History, and its source snapshot? Copies already sent to Notion or flomo will not be deleted.")) {
        return;
      }
      const response = await sendNative({ type: "delete_capture", captureId });
      if (!response.ok) {
        throw new Error(response.error?.message || "Could not delete local capture.");
      }
      showResult("Local note permanently deleted. External copies were not changed.");
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

function renderHistory(history) {
  const warnings = history.warnings || [];
  const items = history.items || [];
  historyListEl.innerHTML = "";

  if (warnings.length) {
    historyWarningEl.hidden = false;
    const unreadableCount = warnings.filter((warning) => ["invalid_json", "invalid_record"].includes(warning.code)).length;
    const recoveryCount = warnings.filter((warning) => warning.code === "lifecycle_recovery_failed").length;
    const messages = [];
    if (unreadableCount) {
      messages.push(`${unreadableCount} unreadable capture record${unreadableCount === 1 ? "" : "s"} skipped.`);
    }
    if (recoveryCount) {
      messages.push(`${recoveryCount} interrupted lifecycle operation${recoveryCount === 1 ? "" : "s"} still need attention.`);
    }
    historyWarningEl.textContent = messages.join(" ") || "Capture history needs attention.";
  } else {
    historyWarningEl.hidden = true;
    historyWarningEl.textContent = "";
  }

  if (!items.length) {
    setStatus(historyStatusEl, "Empty", "neutral");
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = historyMode === "processed"
      ? "No processed captures. Items marked as processed will remain available here."
      : "No active clips. Save a selection, page, or element to start a trail.";
    historyListEl.append(empty);
    return;
  }

  setStatus(historyStatusEl, `${items.length} ${historyMode}`, "ready");
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
    captureMethodLabel(item)
  ].filter(Boolean).join(" · ");

  const tags = document.createElement("div");
  tags.className = "history-tags";
  for (const tag of item.tags || []) {
    const pill = document.createElement("span");
    pill.textContent = `#${tag}`;
    tags.append(pill);
  }

  main.append(title, meta);
  if (["selection", "element"].includes(item.input_type) && item.preview) {
    const preview = document.createElement("p");
    preview.className = "history-preview";
    preview.textContent = item.preview;
    main.append(preview);
  }
  if (item.tags?.length) {
    main.append(tags);
  }

  const actions = document.createElement("div");
  actions.className = "history-actions";

  const quickActions = document.createElement("div");
  quickActions.className = "history-quick-actions";

  const status = document.createElement("span");
  status.className = `history-state ${historyStateClass(item.sync_status)}`;
  status.textContent = historyStatusLabel(item);
  quickActions.append(status);

  const copyAgent = document.createElement("button");
  copyAgent.className = `${item.sync_status === "sync_failed" ? "secondary" : "primary"} history-action`;
  copyAgent.type = "button";
  copyAgent.dataset.action = "copy-agent";
  copyAgent.dataset.captureId = item.capture_id;
  copyAgent.textContent = "Copy for Agent";
  copyAgent.disabled = historyActionDisabled("copy-agent", item, { hostAvailable });
  quickActions.append(copyAgent);

  const open = document.createElement("button");
  open.className = "secondary history-action";
  open.type = "button";
  open.dataset.action = "open-body";
  open.dataset.captureId = item.capture_id;
  open.textContent = historyOpenLabel(item);
  open.disabled = historyActionDisabled("open-body", item, { hostAvailable });
  quickActions.append(open);

  if (item.sync_status === "sync_failed") {
    const retry = document.createElement("button");
    retry.className = "primary history-action";
    retry.type = "button";
    retry.dataset.action = "retry-sync";
    retry.dataset.captureId = item.capture_id;
    retry.textContent = "Retry sync";
    retry.disabled = historyActionDisabled("retry-sync", item, { hostAvailable });
    quickActions.append(retry);
  }

  const manage = document.createElement("details");
  manage.className = "history-manage";
  manage.addEventListener("toggle", () => {
    if (!manage.open) {
      return;
    }
    for (const other of historyListEl.querySelectorAll(".history-manage[open]")) {
      if (other !== manage) {
        other.removeAttribute("open");
      }
    }
  });

  const manageSummary = document.createElement("summary");
  manageSummary.textContent = "Manage";
  manageSummary.setAttribute("aria-label", `Manage ${item.title || "this capture"}`);

  const manageActions = document.createElement("div");
  manageActions.className = "history-manage-actions";

  const copyContent = document.createElement("button");
  copyContent.className = "secondary history-action";
  copyContent.type = "button";
  copyContent.dataset.action = "copy-content";
  copyContent.dataset.captureId = item.capture_id;
  copyContent.textContent = "Copy content";
  copyContent.disabled = historyActionDisabled("copy-content", item, { hostAvailable });
  manageActions.append(copyContent);

  if (item.lifecycle_status === "active") {
    const process = document.createElement("button");
    process.className = "secondary history-action";
    process.type = "button";
    process.dataset.action = "mark-processed";
    process.dataset.captureId = item.capture_id;
    process.textContent = item.inbox_state === "missing" ? "Finish cleanup" : "Mark processed";
    process.disabled = historyActionDisabled("mark-processed", item, { hostAvailable });
    manageActions.append(process);
  }

  const remove = document.createElement("button");
  remove.className = "secondary history-action danger";
  remove.type = "button";
  remove.dataset.action = "delete-capture";
  remove.dataset.captureId = item.capture_id;
  remove.textContent = "Delete local copy";
  remove.disabled = historyActionDisabled("delete-capture", item, { hostAvailable });
  manageActions.append(remove);

  manage.append(manageSummary, manageActions);
  actions.append(quickActions, manage);

  row.append(main, actions);
  return row;
}

function closeHistoryMenusOnOutsideClick(event) {
  for (const menu of historyListEl.querySelectorAll(".history-manage[open]")) {
    if (!menu.contains(event.target)) {
      menu.removeAttribute("open");
    }
  }
}

function closeHistoryMenuOnEscape(event) {
  if (event.key !== "Escape") {
    return;
  }
  const menu = historyListEl.querySelector(".history-manage[open]");
  if (!menu) {
    return;
  }
  menu.removeAttribute("open");
  menu.querySelector("summary")?.focus();
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
  setHistoryButtons(isBusy);
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

async function copyDiagnostics() {
  setBusy(true, "Checking");
  try {
    const [platform, status] = await Promise.all([
      chrome.runtime.getPlatformInfo(),
      sendNative({ type: "status" })
    ]);
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
  historyListEl.innerHTML = '<div class="history-empty">Install the local Host to inspect your capture trail.</div>';
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
    button.disabled = historyActionDisabled(button.dataset.action, item, { isBusy, hostAvailable });
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

function historyStatusLabel(item) {
  if (item.lifecycle_status === "processed") {
    return "Processed";
  }
  if (item.inbox_state === "duplicate") {
    return "Duplicate inbox entries";
  }
  if (item.inbox_state === "missing") {
    return "Missing from inbox";
  }
  if (!item.content_exists) {
    if (item.input_type === "selection") {
      return "Text unavailable";
    }
    return item.input_type === "element" ? "Content unavailable" : "Body missing";
  }
  const status = item.sync_status;
  if (status === "synced") {
    return "Synced";
  }
  if (status === "sync_failed") {
    return "Sync failed";
  }
  if (status === "sync_skipped") {
    return "Sync skipped";
  }
  return "Note saved";
}

async function setHistoryMode(mode) {
  if (!["active", "processed"].includes(mode) || mode === historyMode) {
    return;
  }
  historyMode = mode;
  for (const button of historyFilterButtons) {
    const active = button.dataset.historyFilter === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  await loadHistory();
}

function historyOpenLabel(item) {
  if (!item.content_exists) {
    if (item.input_type === "selection") {
      return "Text unavailable";
    }
    return item.input_type === "element" ? "Content unavailable" : "Body missing";
  }
  return ["selection", "element"].includes(item.input_type) ? "Open content" : "Open body";
}

function captureMethodLabel(item) {
  const labels = {
    selection: "Selected text",
    readability: "Readable article",
    fallback: "Page fallback",
    element: "Selected area",
    legacy_page: "Page"
  };
  return labels[item.extraction_method] || labels[item.input_type] || "Page";
}

function syncResultMessage(response) {
  if (response.status === "synced") {
    return "Sync retried successfully";
  }
  if (response.status === "sync_failed") {
    return "Note saved. Sync still failed.";
  }
  if (response.status === "sync_skipped") {
    return "Sync skipped";
  }
  return "Sync retry finished";
}

async function copySetup() {
  try {
    await copySetupCommand();
    showResult("Setup command copied");
  } catch {
    showResult("Could not copy. Select the command shown above.", true);
  }
}

function isUnsupportedMessage(response) {
  return response?.error?.code === "unknown_message"
    || /Unsupported native host message/i.test(response?.error?.message || "");
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
