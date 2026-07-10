import fs from "node:fs/promises";
import { validateFlomoWebhookUrl } from "./flomo-webhook.mjs";
import { getSecret, setSecretVerified } from "./secret-store.mjs";
import { DEFAULT_NOTES_DIR, getDefaultPaths } from "./paths.mjs";

const DEFAULT_CONFIG = {
  storage: {
    notesDir: ""
  },
  sync: {
    defaultSinks: []
  },
  sinks: {
    "local-export": {
      enabled: false
    },
    "notion-api": {
      enabled: false,
      parentType: "page",
      parentId: "",
      token: ""
    },
    "flomo-api": {
      enabled: false,
      webhookUrl: "",
      tags: []
    }
  }
};

export async function resolveConfiguredPaths(options = {}) {
  const initialPaths = getDefaultPaths(options.notesDir, { configDir: options.configDir });
  const config = await readConfig(initialPaths);
  const configuredNotesDir = cleanString(config.storage.notesDir);
  const notesDir = options.notesDir
    || process.env.CLIPPLANE_NOTES_DIR
    || configuredNotesDir
    || DEFAULT_NOTES_DIR;
  const paths = getDefaultPaths(notesDir, { configDir: options.configDir, notesDir: options.notesDir });

  config.storage.notesDir = configuredNotesDir;
  return { paths, config };
}

export async function readConfig(paths) {
  const appConfig = await readJsonIfExists(paths.configPath);
  const legacyConfig = appConfig ? null : await readJsonIfExists(paths.legacyConfigPath);
  const config = normalizeConfig(appConfig ?? legacyConfig ?? {});
  Object.defineProperty(config, "sourcePath", {
    value: appConfig ? paths.configPath : legacyConfig ? paths.legacyConfigPath : null,
    enumerable: false
  });
  return config;
}

export async function saveConfig(patch = {}, options = {}) {
  const { paths: currentPaths, config: currentConfig } = await resolveConfiguredPaths(options);
  const migrated = await persistSecretChanges(currentConfig, patch, options);
  const config = mergeConfig(currentConfig, patch);
  if (migrated.notionToken) {
    config.sinks["notion-api"].token = "";
  }
  if (migrated.flomoWebhook) {
    config.sinks["flomo-api"].webhookUrl = "";
  }
  const notesDir = options.notesDir
    || process.env.CLIPPLANE_NOTES_DIR
    || cleanString(config.storage.notesDir)
    || DEFAULT_NOTES_DIR;
  const paths = getDefaultPaths(notesDir, { configDir: options.configDir, notesDir: options.notesDir });

  await fs.mkdir(paths.notesDir, { recursive: true });
  await fs.mkdir(paths.stateDir, { recursive: true });
  await fs.mkdir(paths.appConfigDir, { recursive: true });
  await writeConfigAtomic(paths.configPath, config);

  if (
    (migrated.notionToken || migrated.flomoWebhook)
    && currentConfig.sourcePath === currentPaths.legacyConfigPath
    && currentConfig.sourcePath !== paths.configPath
  ) {
    await fs.rm(currentConfig.sourcePath, { force: true });
  }

  const secretStatus = await getSecretStatus(config, options);

  return {
    paths,
    config,
    secretStatus,
    previousConfigPath: currentPaths.configPath
  };
}

export function normalizeConfig(raw = {}) {
  const storage = {
    ...DEFAULT_CONFIG.storage,
    ...(isObject(raw.storage) ? raw.storage : {})
  };

  const sync = {
    ...DEFAULT_CONFIG.sync,
    ...(isObject(raw.sync) ? raw.sync : {})
  };

  const sinks = {};
  for (const [name, defaults] of Object.entries(DEFAULT_CONFIG.sinks)) {
    sinks[name] = normalizeSink(name, {
      ...defaults,
      ...(isObject(raw.sinks?.[name]) ? raw.sinks[name] : {})
    });
  }

  return {
    storage: {
      notesDir: cleanString(storage.notesDir)
    },
    sync: {
      defaultSinks: Array.isArray(sync.defaultSinks) ? uniqueStrings(sync.defaultSinks) : []
    },
    sinks
  };
}

export function publicConfig(config, secretStatus = localSecretStatus(config)) {
  return {
    storage: {
      notesDir: config.storage.notesDir
    },
    sync: {
      defaultSinks: config.sync.defaultSinks
    },
    secretStore: {
      available: secretStatus.available,
      errorCode: secretStatus.errorCode
    },
    sinks: {
      "local-export": {
        enabled: Boolean(config.sinks["local-export"]?.enabled)
      },
      "notion-api": {
        enabled: Boolean(config.sinks["notion-api"]?.enabled),
        parentType: config.sinks["notion-api"]?.parentType || "page",
        parentId: config.sinks["notion-api"]?.parentId || "",
        tokenConfigured: secretStatus.notionToken,
        credentialMigrationRequired: Boolean(config.sinks["notion-api"]?.token)
      },
      "flomo-api": {
        enabled: Boolean(config.sinks["flomo-api"]?.enabled),
        tags: config.sinks["flomo-api"]?.tags || [],
        webhookConfigured: secretStatus.flomoWebhook,
        credentialMigrationRequired: Boolean(config.sinks["flomo-api"]?.webhookUrl)
      }
    }
  };
}

export function configuredExternalSinks(config) {
  return ["notion-api", "flomo-api"].filter((name) => Boolean(config.sinks[name]?.enabled));
}

export async function getSecretStatus(config, options = {}) {
  const secrets = await resolveSyncSecrets(config, options);
  return {
    available: !secrets.errorCode,
    errorCode: secrets.errorCode || null,
    notionToken: Boolean(secrets.notionToken),
    flomoWebhook: Boolean(secrets.flomoWebhook)
  };
}

export async function resolveSyncSecrets(config, options = {}) {
  const secrets = {
    notionToken: cleanString(process.env.CLIPPLANE_NOTION_TOKEN) || cleanString(config.sinks["notion-api"]?.token),
    flomoWebhook: cleanString(process.env.CLIPPLANE_FLOMO_WEBHOOK_URL) || cleanString(config.sinks["flomo-api"]?.webhookUrl),
    errorCode: null,
    errorMessage: null
  };

  if (secrets.notionToken && secrets.flomoWebhook) {
    return secrets;
  }

  try {
    if (!secrets.notionToken) {
      secrets.notionToken = cleanString(await getSecret("notionToken", options));
    }
    if (!secrets.flomoWebhook) {
      secrets.flomoWebhook = cleanString(await getSecret("flomoWebhook", options));
    }
  } catch (error) {
    secrets.errorCode = error.code || "secret_store_unavailable";
    secrets.errorMessage = "The operating system credential store is unavailable.";
  }

  return secrets;
}

function mergeConfig(current, patch) {
  const merged = normalizeConfig(current);

  if (isObject(patch.storage) && "notesDir" in patch.storage) {
    merged.storage.notesDir = cleanString(patch.storage.notesDir);
  }

  if (isObject(patch.sync) && Array.isArray(patch.sync.defaultSinks)) {
    merged.sync.defaultSinks = uniqueStrings(patch.sync.defaultSinks);
  }

  if (isObject(patch.sinks)) {
    for (const [name, value] of Object.entries(patch.sinks)) {
      if (!isObject(value) || !merged.sinks[name]) {
        continue;
      }
      merged.sinks[name] = mergeSink(name, merged.sinks[name], value);
    }
  }

  return normalizeConfig(merged);
}

function mergeSink(name, current, patch) {
  const next = { ...current };

  if ("enabled" in patch) {
    next.enabled = Boolean(patch.enabled);
  }

  if (name === "notion-api") {
    if ("parentType" in patch) {
      next.parentType = cleanString(patch.parentType) || "page";
    }
    if ("parentId" in patch) {
      next.parentId = cleanString(patch.parentId);
    }
  }

  if (name === "flomo-api") {
    if (Array.isArray(patch.tags)) {
      next.tags = uniqueStrings(patch.tags);
    }
  }

  return next;
}

async function persistSecretChanges(currentConfig, patch, options) {
  const migrated = { notionToken: false, flomoWebhook: false };
  if (!isObject(patch.sinks)) {
    return migrated;
  }

  const notionPatch = patch.sinks["notion-api"];
  if (isObject(notionPatch)) {
    const token = cleanString(notionPatch.token) || cleanString(currentConfig.sinks["notion-api"]?.token);
    if (token) {
      await setSecretVerified("notionToken", token, options);
      migrated.notionToken = true;
    }
  }

  const flomoPatch = patch.sinks["flomo-api"];
  if (isObject(flomoPatch)) {
    const webhook = cleanString(flomoPatch.webhookUrl) || cleanString(currentConfig.sinks["flomo-api"]?.webhookUrl);
    if (webhook) {
      await setSecretVerified("flomoWebhook", validateFlomoWebhookUrl(webhook), options);
      migrated.flomoWebhook = true;
    }
  }

  return migrated;
}

function localSecretStatus(config) {
  return {
    available: true,
    errorCode: null,
    notionToken: Boolean(cleanString(process.env.CLIPPLANE_NOTION_TOKEN) || cleanString(config.sinks["notion-api"]?.token)),
    flomoWebhook: Boolean(cleanString(process.env.CLIPPLANE_FLOMO_WEBHOOK_URL) || cleanString(config.sinks["flomo-api"]?.webhookUrl))
  };
}

async function writeConfigAtomic(file, config) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, file);
}

function normalizeSink(name, value) {
  if (name === "notion-api") {
    return {
      enabled: Boolean(value.enabled),
      parentType: cleanString(value.parentType) || "page",
      parentId: cleanString(value.parentId),
      token: cleanString(value.token)
    };
  }

  if (name === "flomo-api") {
    return {
      enabled: Boolean(value.enabled),
      webhookUrl: cleanString(value.webhookUrl),
      tags: Array.isArray(value.tags) ? uniqueStrings(value.tags) : []
    };
  }

  return {
    enabled: Boolean(value.enabled)
  };
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
