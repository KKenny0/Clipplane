const UI_STATES = Object.freeze({
  checking: state("Checking", "neutral", "Checking Clipplane", "Confirming the local Host and saved destinations."),
  ready: state("Ready", "ready", "Ready to clip", "Clips become notes first. Sync is optional."),
  working: state("Saving", "working", "Saving note", "Keep this popup open while Clipplane confirms the write."),
  "saved-local": state("Saved", "ready", "Capture saved", "The local Markdown source is ready for an Agent.", "Copy for Agent"),
  duplicate: state("Already saved", "neutral", "Already in your trail", "Clipplane kept the existing capture.", "Copy for Agent"),
  reactivated: state("Back in inbox", "ready", "Returned to your inbox", "This processed capture is active again.", "Copy for Agent"),
  "saved-local-sync-failed": state("Sync failed", "warning", "Note saved. Sync failed.", "Your note is safe. You can retry the external sync.", "Retry sync"),
  "saved-local-sync-skipped": state("Sync skipped", "warning", "Note saved. Sync skipped.", "Your note is safe. Check the destination before retrying."),
  "consent-required": state("Approval needed", "warning", "Note saved. Sync needs approval.", "Confirm what Clipplane may send in Sync settings.", "Open Sync settings"),
  "host-missing": state("Host missing", "warning", "Install the local Host", "Clipplane needs the local Host to write notes to your folder.", "Install host"),
  "host-outdated": state("Update required", "warning", "Update the local Host", "This extension needs a newer Host protocol before it can save safely.", "Update host"),
  unsupported: state("Unavailable", "warning", "This page cannot be clipped", "Try a normal webpage or select text on a supported page."),
  error: state("Failed", "error", "Clip not saved", "No note was written. Review the error and try again.")
});

export function getUiState(key, overrides = {}) {
  const value = UI_STATES[key] || UI_STATES.error;
  return { key: UI_STATES[key] ? key : "error", ...value, ...overrides };
}

export function resolveHostUiState(response) {
  if (response?.ok) {
    return getUiState("ready", {
      detail: response.host_version
        ? `Local Host ${response.host_version} is ready.`
        : UI_STATES.ready.detail
    });
  }
  if (response?.error?.code === "host_outdated") {
    return getUiState("host-outdated");
  }
  if (isHostUnavailableResponse(response)) {
    return getUiState("host-missing");
  }
  return getUiState("error", { detail: safeResponseMessage(response, UI_STATES.error.detail) });
}

export function resolveClipUiState(response) {
  if (response?.pending) {
    return getUiState("working", {
      label: "Choose area",
      title: "Choose an area on the page",
      detail: "Click the target content, or press Escape to cancel without saving."
    });
  }

  if (!response?.ok) {
    if (response?.error?.code === "host_outdated") {
      return getUiState("host-outdated");
    }
    if (isHostUnavailableResponse(response)) {
      return getUiState("host-missing");
    }
    if (isUnsupportedResponse(response)) {
      return getUiState("unsupported", { detail: safeResponseMessage(response, UI_STATES.unsupported.detail) });
    }
    return getUiState("error", { detail: safeResponseMessage(response, UI_STATES.error.detail) });
  }

  if (response.sync?.status === "sync_failed") {
    return getUiState("saved-local-sync-failed");
  }
  if (response.sync?.status === "sync_skipped") {
    if (response.sync?.error?.code === "sync_consent_required") {
      return getUiState("consent-required");
    }
    return getUiState("saved-local-sync-skipped");
  }
  if (response.reactivated) {
    return getUiState("reactivated");
  }
  if (response.duplicate) {
    return getUiState("duplicate");
  }
  return getUiState("saved-local");
}

export function stateClassName(base, uiState) {
  return [base, `is-${uiState.tone}`].filter(Boolean).join(" ");
}

export function nextTabIndex(key, currentIndex, length) {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(length) || length < 1) {
    return null;
  }
  if (["ArrowRight", "ArrowDown"].includes(key)) {
    return (currentIndex + 1) % length;
  }
  if (["ArrowLeft", "ArrowUp"].includes(key)) {
    return (currentIndex - 1 + length) % length;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return length - 1;
  }
  return null;
}

function state(label, tone, title, detail, action = "") {
  return Object.freeze({ label, tone, title, detail, action });
}

function isHostUnavailableResponse(response) {
  const message = response?.error?.message || response?.message || "";
  return response?.error?.code === "host_unavailable"
    || /native messaging host|receiving end does not exist|could not establish connection/i.test(message);
}

function isUnsupportedResponse(response) {
  const code = response?.error?.code || "";
  const message = response?.error?.message || response?.message || "";
  return [
    "nothing_to_clip",
    "missing_element_payload",
    "unsupported_page",
    "element_capture_timeout",
    "capture_timed_out",
    "capture_too_large"
  ].includes(code) || /cannot access|unsupported page|nothing to clip|no content was selected|area selection timed out|too large to save|took too long to process/i.test(message);
}

function safeResponseMessage(response, fallback) {
  return response?.error?.message || response?.message || fallback;
}
