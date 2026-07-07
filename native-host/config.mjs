import fs from "node:fs/promises";
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

  return {
    paths,
    config: normalizeConfig({
      ...config,
      storage: {
        ...config.storage,
        notesDir: configuredNotesDir
      }
    })
  };
}

export async function readConfig(paths) {
  const raw = await readJsonIfExists(paths.configPath)
    ?? await readJsonIfExists(paths.legacyConfigPath)
    ?? {};

  return normalizeConfig(raw);
}

export async function saveConfig(patch = {}, options = {}) {
  const { paths: currentPaths, config: currentConfig } = await resolveConfiguredPaths(options);
  const config = mergeConfig(currentConfig, patch);
  const notesDir = options.notesDir
    || process.env.CLIPPLANE_NOTES_DIR
    || cleanString(config.storage.notesDir)
    || DEFAULT_NOTES_DIR;
  const paths = getDefaultPaths(notesDir, { configDir: options.configDir, notesDir: options.notesDir });

  await fs.mkdir(paths.notesDir, { recursive: true });
  await fs.mkdir(paths.stateDir, { recursive: true });
  await fs.mkdir(paths.appConfigDir, { recursive: true });
  await fs.writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return {
    paths,
    config,
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

export function publicConfig(config) {
  return {
    storage: {
      notesDir: config.storage.notesDir
    },
    sync: {
      defaultSinks: config.sync.defaultSinks
    },
    sinks: {
      "local-export": {
        enabled: Boolean(config.sinks["local-export"]?.enabled)
      },
      "notion-api": {
        enabled: Boolean(config.sinks["notion-api"]?.enabled),
        parentType: config.sinks["notion-api"]?.parentType || "page",
        parentId: config.sinks["notion-api"]?.parentId || "",
        tokenConfigured: hasNotionToken(config)
      },
      "flomo-api": {
        enabled: Boolean(config.sinks["flomo-api"]?.enabled),
        tags: config.sinks["flomo-api"]?.tags || [],
        webhookConfigured: hasFlomoWebhook(config)
      }
    }
  };
}

export function configuredExternalSinks(config) {
  return ["notion-api", "flomo-api"].filter((name) => Boolean(config.sinks[name]?.enabled));
}

export function hasNotionToken(config) {
  return Boolean(cleanString(config.sinks["notion-api"]?.token) || process.env.CLIPPLANE_NOTION_TOKEN);
}

export function hasFlomoWebhook(config) {
  return Boolean(cleanString(config.sinks["flomo-api"]?.webhookUrl) || process.env.CLIPPLANE_FLOMO_WEBHOOK_URL);
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
    if (cleanString(patch.token)) {
      next.token = cleanString(patch.token);
    }
  }

  if (name === "flomo-api") {
    if (cleanString(patch.webhookUrl)) {
      next.webhookUrl = cleanString(patch.webhookUrl);
    }
    if (Array.isArray(patch.tags)) {
      next.tags = uniqueStrings(patch.tags);
    }
  }

  return next;
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
