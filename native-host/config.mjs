import fs from "node:fs/promises";

const DEFAULT_CONFIG = {
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
      parentId: ""
    },
    "flomo-api": {
      enabled: false
    }
  }
};

export async function readConfig(paths) {
  let raw = {};
  try {
    raw = JSON.parse(await fs.readFile(paths.configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return normalizeConfig(raw);
}

export function normalizeConfig(raw = {}) {
  const sync = {
    ...DEFAULT_CONFIG.sync,
    ...(isObject(raw.sync) ? raw.sync : {})
  };

  const sinks = {};
  for (const [name, defaults] of Object.entries(DEFAULT_CONFIG.sinks)) {
    sinks[name] = {
      ...defaults,
      ...(isObject(raw.sinks?.[name]) ? raw.sinks[name] : {})
    };
  }

  return {
    sync: {
      defaultSinks: Array.isArray(sync.defaultSinks) ? sync.defaultSinks : []
    },
    sinks
  };
}

export function configuredExternalSinks(config) {
  return ["notion-api", "flomo-api"].filter((name) => Boolean(config.sinks[name]?.enabled));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
