import assert from "node:assert/strict";
import test from "node:test";
import { FlomoWebhookError, validateFlomoWebhookUrl } from "../native-host/flomo-webhook.mjs";
import { sanitizeSourceUrl } from "../native-host/url-sanitizer.mjs";

test("sanitizeSourceUrl removes credentials, fragments, tracking, and sensitive query values", () => {
  const sanitized = new URL(sanitizeSourceUrl(
    "https://user:pass@example.com/article?id=42&utm_source=news&access_token=secret&password=hunter2&jwt=eySecret#private"
  ));

  assert.equal(sanitized.username, "");
  assert.equal(sanitized.password, "");
  assert.equal(sanitized.hash, "");
  assert.equal(sanitized.searchParams.get("id"), "42");
  assert.equal(sanitized.searchParams.has("utm_source"), false);
  assert.equal(sanitized.searchParams.get("access_token"), "[redacted]");
  assert.equal(sanitized.searchParams.get("password"), "[redacted]");
  assert.equal(sanitized.searchParams.get("jwt"), "[redacted]");
});
test("sanitizeSourceUrl preserves manual and non-web sources", () => {
  assert.equal(sanitizeSourceUrl("manual"), "manual");
  assert.equal(sanitizeSourceUrl("not a URL"), "not a URL");
});

test("validateFlomoWebhookUrl only accepts official HTTPS incoming webhooks", () => {
  assert.equal(
    validateFlomoWebhookUrl("https://flomoapp.com/iwh/secret"),
    "https://flomoapp.com/iwh/secret"
  );

  for (const value of [
    "http://flomoapp.com/iwh/secret",
    "https://example.com/iwh/secret",
    "https://127.0.0.1/iwh/secret",
    "https://flomoapp.com:444/iwh/secret",
    "https://user:pass@flomoapp.com/iwh/secret",
    "https://flomoapp.com/iwh/secret?redirect=1",
    "https://flomoapp.com/iwh/secret#fragment",
    "https://flomoapp.com/not-a-webhook"
  ]) {
    assert.throws(() => validateFlomoWebhookUrl(value), FlomoWebhookError);
  }
});
