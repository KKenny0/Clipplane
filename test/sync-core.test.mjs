import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clipPayload } from "../native-host/clip-core.mjs";
import { getSecretStatus, normalizeConfig, publicConfig, resolveConfiguredPaths, saveConfig } from "../native-host/config.mjs";
import { formatFlomoContent, syncFlomoApi } from "../native-host/sinks/flomo-api.mjs";
import { buildBlocks, syncNotionApi } from "../native-host/sinks/notion-api.mjs";
import { chooseSinkNames, getSyncStatus, syncCapture } from "../native-host/sync-core.mjs";

test("chooseSinkNames prefers explicit sinks, then defaults, then enabled external sinks", () => {
  const config = normalizeConfig({
    sync: { defaultSinks: ["notion-api"] },
    sinks: {
      "notion-api": { enabled: true },
      "flomo-api": { enabled: true }
    }
  });

  assert.deepEqual(chooseSinkNames(["local-export"], config), ["local-export"]);
  assert.deepEqual(chooseSinkNames([], config), ["notion-api"]);
  assert.deepEqual(chooseSinkNames(null, normalizeConfig({ sinks: { "flomo-api": { enabled: true } } })), ["flomo-api"]);
});

test("syncCapture writes local export and updates captures jsonl", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-sync-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const clip = await clipPayload({
    inputType: "selection",
    sourceUrl: "https://example.com/sync",
    sourceTitle: "Sync Test",
    title: "Sync Test",
    contentMarkdown: "# Sync Test\n\nAPI sink body."
  }, { notesDir, configDir });

  const result = await syncCapture(clip.capture.capture_id, {
    notesDir,
    configDir,
    sinks: ["local-export"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "synced");
  assert.equal(result.capture.sinks["local-export"].status, "synced");

  const exported = await fs.readFile(result.capture.sinks["local-export"].path, "utf8");
  assert.match(exported, /API sink body/);

  const records = await fs.readFile(path.join(notesDir, ".clipplane", "captures.jsonl"), "utf8");
  assert.match(records, /"sync_status":"synced"/);
});

test("getSyncStatus does not expose token values", async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-status-"));
  await fs.mkdir(path.join(notesDir, ".clipplane"), { recursive: true });
  await fs.writeFile(path.join(notesDir, ".clipplane", "config.json"), JSON.stringify({
    sinks: {
      "notion-api": { enabled: true, parentType: "page", parentId: "page123" }
    }
  }), "utf8");

  const previous = process.env.CLIPPLANE_NOTION_TOKEN;
  process.env.CLIPPLANE_NOTION_TOKEN = "secret-token";
  try {
    const status = await getSyncStatus({ notesDir, configDir });
    assert.equal(status.sinks["notion-api"].configured, true);
    assert.equal(JSON.stringify(status).includes("secret-token"), false);
  } finally {
    if (previous === undefined) {
      delete process.env.CLIPPLANE_NOTION_TOKEN;
    } else {
      process.env.CLIPPLANE_NOTION_TOKEN = previous;
    }
  }
});

test("saveConfig makes notesDir and sink secrets config-driven", async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-notes-"));
  const secretStore = memorySecretStore();

  await saveConfig({
    storage: { notesDir },
    sinks: {
      "notion-api": {
        enabled: true,
        parentType: "page",
        parentId: "page123",
        token: "secret-token"
      },
      "flomo-api": {
        enabled: true,
        webhookUrl: "https://flomoapp.com/iwh/secret",
        tags: ["clipplane"]
      }
    },
    sync: { defaultSinks: ["notion-api", "flomo-api"] }
  }, { configDir, secretStore });
  await saveConfig({ storage: { notesDir } }, { configDir, secretStore });

  const { paths, config } = await resolveConfiguredPaths({ configDir });
  const visible = publicConfig(config, await getSecretStatus(config, { secretStore }));
  const stored = await fs.readFile(path.join(configDir, "config.json"), "utf8");

  assert.equal(paths.notesDir, notesDir);
  assert.equal(visible.sinks["notion-api"].tokenConfigured, true);
  assert.equal(visible.sinks["flomo-api"].webhookConfigured, true);
  assert.equal(JSON.stringify(visible).includes("secret-token"), false);
  assert.equal(JSON.stringify(visible).includes("https://flomoapp.com/iwh/secret"), false);
  assert.equal(stored.includes("secret-token"), false);
  assert.equal(stored.includes("https://flomoapp.com/iwh/secret"), false);
  assert.equal(await secretStore.get("notion-token"), "secret-token");
  assert.equal(await secretStore.get("flomo-webhook"), "https://flomoapp.com/iwh/secret");
});

test("failed credential migration leaves the legacy plaintext config unchanged", async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-failed-migration-"));
  const configPath = path.join(configDir, "config.json");
  const legacy = {
    sinks: {
      "notion-api": { enabled: true, parentType: "page", parentId: "page123", token: "legacy-secret" }
    }
  };
  await fs.writeFile(configPath, JSON.stringify(legacy), "utf8");

  await assert.rejects(
    saveConfig({ sinks: { "notion-api": { enabled: true, token: "" } } }, {
      configDir,
      secretStore: {
        async get() { return null; },
        async set() { throw new Error("credential store locked"); },
        async delete() {}
      }
    }),
    /credential store locked/
  );

  assert.deepEqual(JSON.parse(await fs.readFile(configPath, "utf8")), legacy);
});

test("notion sink creates a page with compact blocks", async () => {
  const capture = sampleCapture();
  const previous = process.env.CLIPPLANE_NOTION_TOKEN;
  delete process.env.CLIPPLANE_NOTION_TOKEN;
  let request;

  try {
    const result = await syncNotionApi({
      capture,
      markdown: "# Heading\n\n- one\nplain text",
      config: normalizeConfig({
        sinks: {
          "notion-api": { enabled: true, parentType: "page", parentId: "page123" }
        }
      }),
      secrets: { notionToken: "config-token" },
      fetchImpl: async (url, init) => {
        request = { url, init };
        return jsonResponse(200, { id: "notion-page-id", url: "https://notion.so/page" });
      }
    });

    assert.equal(result.status, "synced");
    assert.equal(result.external_url, "https://notion.so/page");
    assert.equal(request.init.headers.Authorization, "Bearer config-token");
    const body = JSON.parse(request.init.body);
    assert.equal(body.parent.page_id, "page123");
    assert.equal(body.children[3].type, "heading_1");
  } finally {
    if (previous === undefined) {
      delete process.env.CLIPPLANE_NOTION_TOKEN;
    } else {
      process.env.CLIPPLANE_NOTION_TOKEN = previous;
    }
  }
});

test("flomo sink posts webhook content", async () => {
  const capture = sampleCapture();
  const previous = process.env.CLIPPLANE_FLOMO_WEBHOOK_URL;
  delete process.env.CLIPPLANE_FLOMO_WEBHOOK_URL;
  let request;

  try {
    const result = await syncFlomoApi({
      capture,
      markdown: "Body",
      config: normalizeConfig({
        sinks: {
          "flomo-api": {
            enabled: true,
            tags: ["clipplane"]
          }
        }
      }),
      secrets: { flomoWebhook: "https://flomoapp.com/iwh/token" },
      fetchImpl: async (url, init) => {
        request = { url, init };
        return jsonResponse(200, { memo: { slug: "memo1" } });
      }
    });

    assert.equal(result.status, "synced");
    assert.equal(result.external_id, "memo1");
    assert.equal(request.url, "https://flomoapp.com/iwh/token");
    assert.match(JSON.parse(request.init.body).content, /#ai/);
    assert.match(JSON.parse(request.init.body).content, /#clipplane/);
  } finally {
    if (previous === undefined) {
      delete process.env.CLIPPLANE_FLOMO_WEBHOOK_URL;
    } else {
      process.env.CLIPPLANE_FLOMO_WEBHOOK_URL = previous;
    }
  }
});

test("format helpers stay compact", () => {
  const capture = sampleCapture();
  assert.equal(buildBlocks(capture, "plain").length >= 4, true);
  assert.equal(formatFlomoContent(capture, "x".repeat(6000)).length, 5000);
});

function sampleCapture() {
  return {
    capture_id: "cap1",
    title: "Example Clip",
    source_url: "https://example.com",
    tags: ["ai", "read"]
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function memorySecretStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(account) {
      return values.get(account) || null;
    },
    async set(account, value) {
      values.set(account, value);
    },
    async delete(account) {
      values.delete(account);
    }
  };
}
