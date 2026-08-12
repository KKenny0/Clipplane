import { isHostOutdated, isHostUnavailable, safeErrorMessage } from "./setup-guide.js";
import { getHostDownloadUrl, getHostRelease } from "./src/host-distribution.js";
import { getUiState, resolveHostUiState, stateClassName } from "./src/ui-state.js";

const stateEl = document.querySelector("#host-state");
const setupStateEl = document.querySelector("#setup-state");
const downloadEl = document.querySelector("#download-host");
const platformNoteEl = document.querySelector("#platform-note");
const firstCaptureEl = document.querySelector("#first-capture");
const steps = {
  install: document.querySelector("#step-install"),
  restart: document.querySelector("#step-restart"),
  check: document.querySelector("#step-check")
};

document.querySelector("#retry-host").addEventListener("click", refreshStatus);
document.querySelector("#open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

init();

async function init() {
  const platform = await chrome.runtime.getPlatformInfo();
  const version = chrome.runtime.getManifest().version;
  const release = getHostRelease(platform.os, platform.arch, version);

  if (release) {
    downloadEl.href = getHostDownloadUrl(platform.os, platform.arch, version);
    downloadEl.hidden = false;
    platformNoteEl.textContent = `${platformLabel(platform.os)} ${architectureLabel(platform.arch)}, Clipplane Host ${release.hostVersion}.`;
  } else {
    downloadEl.hidden = true;
    platformNoteEl.textContent = platform.os === "win"
      ? "Windows uses the source setup path. Install Node 20, then follow the setup guide for Chrome or Edge."
      : platform.os === "mac"
        ? "No signed Host package is published for this macOS architecture."
        : "The public Host package is available only for macOS arm64; Windows uses source setup.";
  }

  await refreshStatus();
}

async function refreshStatus() {
  renderState(getUiState("checking"));
  let status;
  try {
    status = await chrome.runtime.sendMessage({ type: "status" });
  } catch (error) {
    status = { ok: false, error: { code: "host_unavailable", message: safeErrorMessage(error) } };
  }

  if (status?.ok) {
    renderState(resolveHostUiState(status));
    setStepState("complete", "complete", "complete");
    firstCaptureEl.classList.remove("is-locked");
    return;
  }

  const uiState = resolveHostUiState(status);
  renderState(uiState);
  setStepState("current", "", "");
  firstCaptureEl.classList.add("is-locked");
  if (!isHostUnavailable(status) && !isHostOutdated(status)) {
    platformNoteEl.textContent = safeErrorMessage(status);
  }
}

function renderState(uiState) {
  stateEl.className = stateClassName("status", uiState);
  stateEl.textContent = uiState.label;

  const dot = document.createElement("i");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  setupStateEl.className = stateClassName("onboarding-state", uiState);
  setupStateEl.replaceChildren(dot, document.createTextNode(uiState.label));
}

function setStepState(install, restart, check) {
  for (const [name, value] of Object.entries({ install, restart, check })) {
    steps[name].classList.toggle("is-current", value === "current");
    steps[name].classList.toggle("is-complete", value === "complete");
  }
}

function platformLabel(os) {
  return os === "win" ? "Windows" : os === "mac" ? "macOS" : os;
}

function architectureLabel(arch) {
  return arch === "x86-64" ? "x64" : arch;
}
