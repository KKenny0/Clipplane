const BLOCKED_WEB_HOSTS = new Set([
  "chromewebstore.google.com"
]);

export function capturablePage(urlValue) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return unsupported("Clipplane needs a normal webpage URL before it can capture content.");
  }

  if (["http:", "https:"].includes(url.protocol) && !BLOCKED_WEB_HOSTS.has(url.hostname)) {
    return { ok: true };
  }
  if (url.protocol === "file:") {
    return { ok: true };
  }
  if (BLOCKED_WEB_HOSTS.has(url.hostname)) {
    return unsupported("Chrome blocks extensions from clipping the Chrome Web Store. Choose another page.");
  }
  return unsupported("Chrome blocks extensions from clipping this internal page. Choose a normal webpage.");
}

function unsupported(message) {
  return { ok: false, error: { code: "unsupported_page", message } };
}
