export class FlomoWebhookError extends Error {
  constructor(message) {
    super(message);
    this.name = "FlomoWebhookError";
    this.code = "invalid_webhook_url";
  }
}
export function validateFlomoWebhookUrl(value) {
  const source = String(value || "").trim();
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new FlomoWebhookError("Enter a valid flomo incoming webhook URL.");
  }

  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "flomoapp.com"
    || (url.port && url.port !== "443")
    || url.username
    || url.password
    || url.hash
    || url.search
    || !/^\/iwh\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new FlomoWebhookError("Only official HTTPS flomoapp.com/iwh webhook URLs are allowed.");
  }

  return url.toString();
}
