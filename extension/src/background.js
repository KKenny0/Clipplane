import {
  readPendingElementCapture,
  removeExpiredElementCaptures,
  removePendingElementCapture,
  savePendingElementCapture
} from "./element-capture-state.js";
import { canSyncStatus, hasSyncConsent } from "./sync-consent.js";

const HOST_NAME = "com.clipplane.host";
const MIN_HOST_PROTOCOL = 1;
const PAGE_CAPTURE_FILES = ["vendor/Readability.js", "src/dom-normalizer.js", "src/page-capture.js"];
const ELEMENT_CAPTURE_STATE_TTL_MS = 70_000;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: "clipplane-selection",
    title: "Clip selection to Clipplane",
    contexts: ["selection"]
  });

  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
  chrome.contextMenus.create({
    id: "clipplane-page",
    title: "Clip page to Clipplane",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode = info.menuItemId === "clipplane-selection" ? "selection" : "page";
  clipTab(tab.id, mode).catch(storeClipError);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "element_capture_result") {
    finishElementCapture(message, sender).then(sendResponse);
    return true;
  }

  if (message?.type === "status") {
    getStatusWithConsent().then(sendResponse);
    return true;
  }

  if (message?.type === "sync") {
    syncCaptureWithConsent(message).then(sendResponse);
    return true;
  }

  if (["get_config", "set_config", "open_notes_dir", "history", "open_capture_body"].includes(message?.type)) {
    sendNative(message).then(sendResponse);
    return true;
  }

  if (message?.type !== "clip") {
    return false;
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }
    return clipTab(tab.id, message.mode || "selection", Boolean(message.sync));
  }).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: { message: error.message } });
  });

  return true;
});

async function clipTab(tabId, mode, sync = false) {
  if (mode === "selection") {
    const selection = await captureSelection(tabId);
    if (selection) {
      return saveClip(selection, sync);
    }
    mode = "page";
  }

  await ensurePageCapture(tabId);
  if (mode === "element") {
    return beginElementCapture(tabId, sync);
  }

  const payload = await runPageCapture(tabId, mode);
  return saveClip(payload, sync);
}

async function captureSelection(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selectedText = String(window.getSelection?.() || "").trim();
      if (!selectedText) {
        return null;
      }
      const sourceUrl = location.href;
      const sourceTitle = document.title || sourceUrl;
      const title = (selectedText.split(/\r?\n/).find(Boolean) || sourceTitle)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      return {
        inputType: "selection",
        extractionMethod: "selection",
        sourceUrl,
        sourceTitle,
        title: title || sourceTitle,
        contentMarkdown: selectedText,
        contentText: selectedText
      };
    }
  });
  return result;
}

async function ensurePageCapture(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: PAGE_CAPTURE_FILES
  });
}

async function runPageCapture(tabId, mode) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (captureMode) => {
      if (!globalThis.__clipplaneCapture?.capture) {
        throw new Error("Clipplane page capture is unavailable.");
      }
      return globalThis.__clipplaneCapture.capture(captureMode);
    },
    args: [mode]
  });
  return result;
}

async function beginElementCapture(tabId, sync) {
  const requestId = crypto.randomUUID();
  await removeExpiredElementCaptures();
  await savePendingElementCapture(requestId, {
    tabId,
    sync,
    expiresAt: Date.now() + ELEMENT_CAPTURE_STATE_TTL_MS
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (id) => {
        if (!globalThis.__clipplaneCapture?.startElementPicker) {
          throw new Error("Clipplane area picker is unavailable.");
        }
        globalThis.__clipplaneCapture.startElementPicker(id);
      },
      args: [requestId]
    });
  } catch (error) {
    await removePendingElementCapture(requestId);
    throw error;
  }

  return { ok: true, pending: true };
}

async function finishElementCapture(message, sender) {
  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  const pending = await readPendingElementCapture(requestId);
  if (!pending) {
    return { ok: false, error: { code: "invalid_element_capture", message: "Ignoring an unexpected element capture result." } };
  }
  if (pending.expiresAt <= Date.now()) {
    await removePendingElementCapture(requestId);
    const response = { ok: false, error: { code: "element_capture_timeout", message: "Area selection timed out." } };
    await chrome.storage.local.set({ lastClipResult: response });
    return response;
  }
  if (sender.tab?.id !== pending.tabId || sender.frameId !== 0) {
    return { ok: false, error: { code: "invalid_element_capture", message: "Ignoring an unexpected element capture result." } };
  }

  await removePendingElementCapture(requestId);
  if (message.cancelled) {
    return { ok: true, cancelled: true };
  }
  if (message.error) {
    const response = { ok: false, error: message.error };
    await chrome.storage.local.set({ lastClipResult: response });
    return response;
  }
  if (!message.payload || typeof message.payload !== "object") {
    const response = { ok: false, error: { code: "missing_element_payload", message: "No content was selected." } };
    await chrome.storage.local.set({ lastClipResult: response });
    return response;
  }

  return saveClip(message.payload, pending.sync);
}

async function saveClip(payload, sync) {
  let response;
  if (sync && !await hasConfiguredSyncConsent()) {
    response = await sendNative({ type: "clip", payload, sync: false });
    if (response.ok) {
      response.sync = {
        ok: false,
        status: "sync_skipped",
        requested: [],
        results: [],
        error: { code: "sync_consent_required", message: "Confirm external sync data handling in Settings." }
      };
    }
  } else {
    response = await sendNative({ type: "clip", payload, sync });
  }
  await chrome.storage.local.set({ lastClipResult: response });
  return response;
}

async function getStatusWithConsent() {
  const status = await sendNative({ type: "status" });
  if (!status.ok || !status.sinks) {
    return status;
  }

  if (!Number.isInteger(status.protocol_version) || status.protocol_version < MIN_HOST_PROTOCOL) {
    return {
      ok: false,
      host_version: status.host_version || null,
      protocol_version: status.protocol_version || null,
      error: { code: "host_outdated", message: "Clipplane Host must be updated." }
    };
  }

  const consent = (await chrome.storage.local.get("syncConsent")).syncConsent;
  for (const [name, sink] of Object.entries(status.sinks)) {
    if (name === "local-export") {
      continue;
    }
    sink.consent = hasSyncConsent(consent, name);
  }
  return status;
}

async function hasConfiguredSyncConsent() {
  const status = await getStatusWithConsent();
  return canSyncStatus(status);
}

async function syncCaptureWithConsent(message) {
  const status = await getStatusWithConsent();
  if (!canSyncStatus(status, message.sinks)) {
    return {
      ok: false,
      status: "sync_skipped",
      requested: [],
      results: [],
      error: { code: "sync_consent_required", message: "Confirm external sync data handling in Settings." }
    };
  }
  return sendNative(message);
}

async function storeClipError(error) {
  await chrome.storage.local.set({
    lastClipResult: {
      ok: false,
      error: { message: error.message }
    }
  });
}

async function sendNative(message) {
  try {
    return await chrome.runtime.sendNativeMessage(HOST_NAME, message);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "host_unavailable",
        message: "Host unavailable. Run the Clipplane local host setup for this browser.",
        detail: error.message
      }
    };
  }
}
