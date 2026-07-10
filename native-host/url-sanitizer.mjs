const TRACKING_PARAMS = new Set(["fbclid", "gclid", "dclid", "msclkid"]);
const SENSITIVE_PARAM = /(^|[_-])(access[_-]?token|token|code|api[_-]?key|key|auth|signature|session|secret)($|[_-])/i;

export function sanitizeSourceUrl(value) {
  const source = String(value || "").trim();
  if (!source || source === "manual") {
    return source;
  }

  let url;
  try {
    url = new URL(source);
  } catch {
    return source;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return source;
  }

  url.username = "";
  url.password = "";
  url.hash = "";

  for (const name of [...url.searchParams.keys()]) {
    const normalized = name.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_PARAMS.has(normalized)) {
      url.searchParams.delete(name);
    } else if (SENSITIVE_PARAM.test(normalized)) {
      url.searchParams.set(name, "[redacted]");
    }
  }

  return url.toString();
}
