import { historyActionDisabled } from "./history-actions.js";
import { safeErrorMessage } from "../setup-guide.js";

// The History view module: everything about rendering and acting on the
// capture trail behind one interface. Host calls go through the injected
// host link; confirm/notify/onHostUnavailable are injected so jsdom tests
// can drive the whole module without Chrome.

export function createHistoryView({
  elements,
  hostLink,
  confirm = (detail) => window.confirm(detail),
  notify = () => {},
  onHostUnavailable = () => {},
  hostAvailable = () => true
}) {
  const { list, status, warning, filterButtons = [] } = elements;
  let items = [];
  let mode = "active";
  let loaded = false;

  list.addEventListener("click", handleHistoryAction);
  document.addEventListener("click", closeHistoryMenusOnOutsideClick);
  document.addEventListener("keydown", closeHistoryMenuOnEscape);

  async function ensureLoaded() {
    if (loaded) {
      return;
    }
    await load();
  }

  async function load() {
    if (!hostAvailable()) {
      setUnavailable();
      return;
    }

    setStatus("Loading", "");
    warning.hidden = true;
    list.innerHTML = '<div class="history-empty">Loading capture history</div>';
    try {
      const outcome = await hostLink.send({ type: "history", limit: 50, lifecycle: mode });
      if (outcome.problem === "host-unavailable" || outcome.problem === "host-outdated") {
        onHostUnavailable();
        return;
      }
      if (outcome.problem === "unsupported") {
        setUpgradeRequired();
        return;
      }
      if (outcome.problem) {
        throw new Error(outcome.response.error?.message || "Could not load capture history.");
      }
      items = outcome.response.history?.items || [];
      render(outcome.response.history || { items: [], warnings: [] });
      loaded = true;
    } catch (error) {
      setStatus("Error", "warning");
      list.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = safeErrorMessage(error, "Could not load capture history.");
      list.append(empty);
    }
  }

  async function setMode(nextMode) {
    if (!["active", "processed"].includes(nextMode) || nextMode === mode) {
      return;
    }
    mode = nextMode;
    for (const button of filterButtons) {
      const active = button.dataset.historyFilter === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    await load();
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

    setBusy(true);
    try {
      if (["copy-agent", "copy-content"].includes(button.dataset.action)) {
        const copyMode = button.dataset.action === "copy-agent" ? "agent-reference" : "content";
        const outcome = await hostLink.send({ type: "copy_capture", captureId, mode: copyMode });
        if (outcome.problem === "unsupported") {
          throw new Error("Update the local Host to copy captures.");
        }
        if (outcome.problem) {
          throw new Error(outcome.response.error?.message || "Could not copy capture.");
        }
        notify(copyMode === "agent-reference"
          ? "Agent reference copied. Paste it into your Agent session."
          : "Capture content copied", false);
        return;
      }

      if (button.dataset.action === "open-body") {
        const outcome = await hostLink.send({ type: "open_capture_body", captureId });
        if (outcome.problem) {
          throw new Error(outcome.response.error?.message || "Could not open capture body.");
        }
        notify("Capture open request sent", false);
        return;
      }

      if (button.dataset.action === "retry-sync") {
        const outcome = await hostLink.send({ type: "sync", captureId });
        if (outcome.problem) {
          throw new Error(outcome.response.error?.message || "Could not retry sync.");
        }
        notify(syncResultMessage(outcome.response), false);
        await load();
        return;
      }

      if (button.dataset.action === "mark-processed") {
        const item = items.find((capture) => capture.capture_id === captureId);
        const detail = item?.inbox_state === "missing"
          ? "Finish cleanup for this capture? Its internal history and source snapshot will be kept."
          : "Mark this capture as processed? It will be removed from inbox.md, while its internal history and source snapshot are kept.";
        if (!confirm(detail)) {
          return;
        }
        const outcome = await hostLink.send({ type: "process_capture", captureId });
        if (outcome.problem) {
          throw new Error(outcome.response.error?.message || "Could not mark capture as processed.");
        }
        notify("Capture marked as processed", false);
        await load();
        return;
      }

      if (button.dataset.action === "delete-capture") {
        if (!confirm("Permanently delete this local capture from inbox.md, History, and its source snapshot? Copies already sent to Notion or flomo will not be deleted.")) {
          return;
        }
        const outcome = await hostLink.send({ type: "delete_capture", captureId });
        if (outcome.problem) {
          throw new Error(outcome.response.error?.message || "Could not delete local capture.");
        }
        notify("Local note permanently deleted. External copies were not changed.", false);
        await load();
      }
    } catch (error) {
      notify(safeErrorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  function render(history) {
    const warnings = history.warnings || [];
    const renderedItems = history.items || [];
    list.innerHTML = "";

    if (warnings.length) {
      warning.hidden = false;
      const unreadableCount = warnings.filter((entry) => ["invalid_json", "invalid_record"].includes(entry.code)).length;
      const recoveryCount = warnings.filter((entry) => entry.code === "lifecycle_recovery_failed").length;
      const messages = [];
      if (unreadableCount) {
        messages.push(`${unreadableCount} unreadable capture record${unreadableCount === 1 ? "" : "s"} skipped.`);
      }
      if (recoveryCount) {
        messages.push(`${recoveryCount} interrupted lifecycle operation${recoveryCount === 1 ? "" : "s"} still need attention.`);
      }
      warning.textContent = messages.join(" ") || "Capture history needs attention.";
    } else {
      warning.hidden = true;
      warning.textContent = "";
    }

    if (!renderedItems.length) {
      setStatus("Empty", "neutral");
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = mode === "processed"
        ? "No processed captures. Items marked as processed will remain available here."
        : "No active clips. Save a selection, page, or element to start a trail.";
      list.append(empty);
      return;
    }

    setStatus(`${renderedItems.length} ${mode}`, "ready");
    for (const item of renderedItems) {
      list.append(renderItem(item));
    }
  }

  function renderItem(item) {
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

    const statusPill = document.createElement("span");
    statusPill.className = `history-state ${historyStateClass(item.sync_status)}`;
    statusPill.textContent = historyStatusLabel(item);
    quickActions.append(statusPill);

    const copyAgent = document.createElement("button");
    copyAgent.className = `${item.sync_status === "sync_failed" ? "secondary" : "primary"} history-action`;
    copyAgent.type = "button";
    copyAgent.dataset.action = "copy-agent";
    copyAgent.dataset.captureId = item.capture_id;
    copyAgent.textContent = "Copy for Agent";
    copyAgent.disabled = historyActionDisabled("copy-agent", item, { hostAvailable: hostAvailable() });
    quickActions.append(copyAgent);

    const open = document.createElement("button");
    open.className = "secondary history-action";
    open.type = "button";
    open.dataset.action = "open-body";
    open.dataset.captureId = item.capture_id;
    open.textContent = historyOpenLabel(item);
    open.disabled = historyActionDisabled("open-body", item, { hostAvailable: hostAvailable() });
    quickActions.append(open);

    if (item.sync_status === "sync_failed") {
      const retry = document.createElement("button");
      retry.className = "primary history-action";
      retry.type = "button";
      retry.dataset.action = "retry-sync";
      retry.dataset.captureId = item.capture_id;
      retry.textContent = "Retry sync";
      retry.disabled = historyActionDisabled("retry-sync", item, { hostAvailable: hostAvailable() });
      quickActions.append(retry);
    }

    const manage = document.createElement("details");
    manage.className = "history-manage";
    manage.addEventListener("toggle", () => {
      if (!manage.open) {
        return;
      }
      for (const other of list.querySelectorAll(".history-manage[open]")) {
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
    copyContent.disabled = historyActionDisabled("copy-content", item, { hostAvailable: hostAvailable() });
    manageActions.append(copyContent);

    if (item.lifecycle_status === "active") {
      const process = document.createElement("button");
      process.className = "secondary history-action";
      process.type = "button";
      process.dataset.action = "mark-processed";
      process.dataset.captureId = item.capture_id;
      process.textContent = item.inbox_state === "missing" ? "Finish cleanup" : "Mark processed";
      process.disabled = historyActionDisabled("mark-processed", item, { hostAvailable: hostAvailable() });
      manageActions.append(process);
    }

    const remove = document.createElement("button");
    remove.className = "secondary history-action danger";
    remove.type = "button";
    remove.dataset.action = "delete-capture";
    remove.dataset.captureId = item.capture_id;
    remove.textContent = "Delete local copy";
    remove.disabled = historyActionDisabled("delete-capture", item, { hostAvailable: hostAvailable() });
    manageActions.append(remove);

    manage.append(manageSummary, manageActions);
    actions.append(quickActions, manage);

    row.append(main, actions);
    return row;
  }

  function closeHistoryMenusOnOutsideClick(event) {
    for (const menu of list.querySelectorAll(".history-manage[open]")) {
      if (!menu.contains(event.target)) {
        menu.removeAttribute("open");
      }
    }
  }

  function closeHistoryMenuOnEscape(event) {
    if (event.key !== "Escape") {
      return;
    }
    const menu = list.querySelector(".history-manage[open]");
    if (!menu) {
      return;
    }
    menu.removeAttribute("open");
    menu.querySelector("summary")?.focus();
  }

  function setBusy(isBusy) {
    for (const button of list.querySelectorAll("button")) {
      const item = items.find((capture) => capture.capture_id === button.dataset.captureId);
      button.disabled = historyActionDisabled(button.dataset.action, item, { isBusy, hostAvailable: hostAvailable() });
    }
  }

  function setUnavailable() {
    setStatus("Unavailable", "warning");
    warning.hidden = true;
    list.innerHTML = '<div class="history-empty">Install the local Host to inspect your capture trail.</div>';
  }

  function setUpgradeRequired() {
    setStatus("Update host", "warning");
    warning.hidden = false;
    warning.textContent = "Your browser is talking to an older Clipplane local host. Rerun setup for this browser, then refresh history.";
    list.innerHTML = '<div class="history-empty">Capture history needs the latest local host protocol.</div>';
  }

  function setStatus(text, state) {
    status.textContent = text;
    status.className = `status-pill ${state ? `is-${state}` : "is-neutral"}`;
  }

  function historyStateClass(statusValue) {
    if (statusValue === "synced") {
      return "synced";
    }
    if (statusValue === "sync_failed") {
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
    if (item.sync_status === "synced") {
      return "Synced";
    }
    if (item.sync_status === "sync_failed") {
      return "Sync failed";
    }
    if (item.sync_status === "sync_skipped") {
      return "Sync skipped";
    }
    return "Note saved";
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

  return {
    load,
    ensureLoaded,
    setMode,
    setBusy,
    setUnavailable,
    setUpgradeRequired
  };
}
