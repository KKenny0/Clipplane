const SETUP_GUIDE_URL = "https://github.com/KKenny0/Clipplane/blob/main/README.en.md#5-minute-start";

export function getSetupCommand() {
  const browser = detectBrowser();
  const platform = detectPlatform();

  if (platform === "macos") {
    return `bash scripts/setup-macos.sh --browser ${browser}`;
  }

  return `pwsh -NoLogo -NoProfile -File .\\scripts\\setup-windows.ps1 -Browser ${browser}`;
}

export async function copySetupCommand() {
  await navigator.clipboard.writeText(getSetupCommand());
}

export function openSetupGuide() {
  chrome.tabs.create({ url: SETUP_GUIDE_URL });
}

export function isHostUnavailable(response) {
  const message = response?.error?.message || response?.message || "";
  return response?.error?.code === "host_unavailable" ||
    /native messaging host|receiving end does not exist|could not establish connection/i.test(message);
}

export function safeErrorMessage(response, fallback = "Clipplane could not complete the request.") {
  const message = response?.error?.message || response?.message || fallback;
  return message
    .replace(/secret_[a-z0-9_-]+/gi, "secret_[redacted]")
    .replace(/https:\/\/flomoapp\.com\/iwh\/[^\s"']+/gi, "https://flomoapp.com/iwh/[redacted]");
}

function detectBrowser() {
  return /\bEdg\//.test(navigator.userAgent) ? "edge" : "chrome";
}

function detectPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /mac/i.test(platform) ? "macos" : "windows";
}
