const NOTION_API_URL = "https://api.notion.com/v1/pages";
const NOTION_VERSION = "2022-06-28";
const MAX_BLOCKS = 80;
const MAX_RICH_TEXT = 1900;

export async function syncNotionApi({ capture, markdown, config, secrets = {}, fetchImpl = fetch }) {
  const sinkConfig = config.sinks["notion-api"];
  const token = secrets.notionToken;

  if (!sinkConfig?.enabled) {
    return skipped("disabled", "Notion sink is disabled.");
  }
  if (!token) {
    return skipped(secrets.errorCode || "auth_required", secrets.errorMessage || "Notion authentication is not configured.");
  }
  if (sinkConfig.parentType !== "page" || !sinkConfig.parentId) {
    return skipped("config_required", "Notion page parent is not configured.");
  }

  const response = await fetchImpl(NOTION_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION
    },
    body: JSON.stringify({
      parent: { page_id: sinkConfig.parentId },
      properties: {
        title: {
          title: [{ text: { content: capture.title.slice(0, MAX_RICH_TEXT) } }]
        }
      },
      children: buildBlocks(capture, markdown)
    })
  });

  const body = await readJson(response);
  if (!response.ok) {
    return {
      status: "failed",
      error_code: `http_${response.status}`,
      last_error: body?.message || `Notion API returned ${response.status}.`
    };
  }

  return {
    status: "synced",
    external_id: body.id || null,
    external_url: body.url || null
  };
}

export function buildBlocks(capture, markdown) {
  const tags = capture.tags.map((tag) => `#${tag}`).join(" ");
  const blocks = [
    paragraph(`Source: ${capture.source_url}`),
    paragraph(`Tags: ${tags || "#clip"}`),
    { object: "block", type: "divider", divider: {} }
  ];

  for (const line of markdown.split(/\r?\n/)) {
    if (blocks.length >= MAX_BLOCKS) {
      blocks.push(paragraph("Content truncated by Clipplane because the first sync keeps pages compact."));
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push(headingBlock(heading[1].length, heading[2]));
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(bullet[1]) }
      });
      continue;
    }

    blocks.push(paragraph(trimmed));
  }

  return blocks;
}

function headingBlock(level, text) {
  const type = `heading_${level}`;
  return {
    object: "block",
    type,
    [type]: { rich_text: richText(text) }
  };
}

function paragraph(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(text) }
  };
}

function richText(text) {
  const value = String(text || "").slice(0, MAX_RICH_TEXT);
  return value ? [{ type: "text", text: { content: value } }] : [];
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
