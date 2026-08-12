export function buildDiagnostics({ platform = {}, browser = "Unknown", extensionVersion = "", status = {} } = {}) {
  const lines = [
    "Clipplane diagnostics",
    `OS: ${clean(platform.os) || "unknown"}`,
    `Architecture: ${clean(platform.arch) || "unknown"}`,
    `Browser: ${clean(browser) || "unknown"}`,
    `Extension: ${clean(extensionVersion) || "unknown"}`,
    `Host: ${status.ok ? clean(status.host_version) || "unknown" : "unavailable"}`,
    `Protocol: ${status.ok && Number.isInteger(status.protocol_version) ? status.protocol_version : "unavailable"}`,
    `Error: ${status.ok ? "none" : clean(status.error?.code) || "unknown"}`
  ];
  return lines.join("\n");
}

export function browserLabel(userAgentData, userAgent = "") {
  const brands = Array.isArray(userAgentData?.brands) ? userAgentData.brands : [];
  const preferred = brands.find((brand) => !/not.?a.?brand/i.test(brand.brand));
  if (preferred) {
    return `${preferred.brand} ${preferred.version}`.trim();
  }
  const match = String(userAgent).match(/(Edg|Chrome)\/([\d.]+)/);
  return match ? `${match[1] === "Edg" ? "Edge" : "Chrome"} ${match[2]}` : "Chromium";
}

function clean(value) {
  return typeof value === "string" ? value.trim().replace(/[\r\n]+/g, " ") : "";
}
