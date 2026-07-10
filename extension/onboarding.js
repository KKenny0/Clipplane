import { isHostOutdated, isHostUnavailable, safeErrorMessage } from "./setup-guide.js";
import { getHostAsset, getHostDownloadUrl } from "./src/host-distribution.js";

const stateEl = document.querySelector("#host-state");
const downloadEl = document.querySelector("#download-host");
const platformNoteEl = document.querySelector("#platform-note");

document.querySelector("#retry-host").addEventListener("click", refreshStatus);
document.querySelector("#open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

init();

async function init() {
  const platform = await chrome.runtime.getPlatformInfo();
  const version = chrome.runtime.getManifest().version;
  const asset = getHostAsset(platform.os, platform.arch, version);

  if (asset) {
    downloadEl.href = getHostDownloadUrl(platform.os, platform.arch, version);
    platformNoteEl.textContent = `${platform.os} ${platform.arch} · Clipplane Host ${version}`;
  } else {
    downloadEl.hidden = true;
    platformNoteEl.textContent = ["win", "mac"].includes(platform.os)
      ? "A signed installer is not published for this Clipplane version. Use the source setup guide."
      : "Public Host installers are currently planned for Windows and macOS.";
  }

  await refreshStatus();
}

async function refreshStatus() {
  stateEl.className = "status";
  stateEl.textContent = "Checking";
  const status = await chrome.runtime.sendMessage({ type: "status" });

  if (status?.ok) {
    stateEl.className = "status ready";
    stateEl.textContent = `Ready · ${status.host_version}`;
    return;
  }

  stateEl.className = "status warning";
  stateEl.textContent = isHostOutdated(status) ? "Update required" : "Not installed";
  if (!isHostUnavailable(status) && !isHostOutdated(status)) {
    platformNoteEl.textContent = safeErrorMessage(status);
  }
}
