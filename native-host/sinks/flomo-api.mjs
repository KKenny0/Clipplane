import { validateFlomoWebhookUrl } from "../flomo-webhook.mjs";

const MAX_FLOMO_CONTENT = 5000;

export async function syncFlomoApi({ capture, markdown, config, secrets = {}, fetchImpl = fetch }) {
  const sinkConfig = config.sinks["flomo-api"];

  if (!sinkConfig?.enabled) {
    return skipped("disabled", "flomo sink is disabled.");
  }

  const webhookUrl = secrets.flomoWebhook;
  if (!webhookUrl) {
    return skipped(secrets.errorCode || "auth_required", secrets.errorMessage || "flomo authentication is not configured.");
  }

  let verifiedWebhook;
  try {
    verifiedWebhook = validateFlomoWebhookUrl(webhookUrl);
  } catch (error) {
    return skipped(error.code || "invalid_webhook_url", error.message);
  }

  const response = await fetchImpl(verifiedWebhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content: formatFlomoContent(capture, markdown, sinkConfig) })
  });

  const body = await readJson(response);
  if (!response.ok) {
    return {
      status: "failed",
      error_code: `http_${response.status}`,
      last_error: body?.message || `flomo API returned ${response.status}.`
    };
  }

  return {
    status: "synced",
    external_id: body?.memo?.slug || body?.memo?.id || body?.id || null,
    external_url: body?.memo?.url || body?.url || null
  };
}

export function formatFlomoContent(capture, markdown, sinkConfig = {}) {
  const configuredTags = Array.isArray(sinkConfig.tags) ? sinkConfig.tags : [];
  const tags = [...new Set([...(capture.tags || []), ...configuredTags])]
    .map((tag) => `#${tag}`)
    .join(" ");
  return [
    tags || "#clip",
    capture.title,
    `Source: ${capture.source_url}`,
    "",
    markdown
  ].join("\n").slice(0, MAX_FLOMO_CONTENT);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function skipped(errorCode, message) {
  return {
    status: "skipped",
    error_code: errorCode,
    last_error: message
  };
}
