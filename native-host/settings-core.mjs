import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { getSecretStatus, publicConfig, resolveConfiguredPaths, saveConfig } from "./config.mjs";

export async function getSettings(options = {}) {
  const { paths, config } = await resolveConfiguredPaths(options);
  return settingsResponse(paths, config, await getSecretStatus(config, options));
}

export async function setSettings(patch, options = {}) {
  const { paths, config, secretStatus } = await saveConfig(patch, options);
  return settingsResponse(paths, config, secretStatus);
}

export async function openNotesDir(options = {}) {
  const { paths, config } = await resolveConfiguredPaths(options);
  await fs.mkdir(paths.notesDir, { recursive: true });
  await (options.openFolderImpl || openFolder)(paths.notesDir, options);
  const openedAt = new Date().toISOString();

  return {
    ok: true,
    path: paths.notesDir,
    opened_at: openedAt,
    config: publicConfig(config, await getSecretStatus(config, options))
  };
}

function settingsResponse(paths, config, secretStatus) {
  return {
    ok: true,
    config_path: paths.configPath,
    storage: {
      notes_dir: paths.notesDir,
      default_notes_dir: paths.defaultNotesDir,
      using_env_override: paths.usingEnvNotesDir
    },
    config: publicConfig(config, secretStatus)
  };
}

export function openFolder(targetPath, options = {}) {
  const platform = options.platform || process.platform;
  const { command, args } = getOpenFolderCommand(targetPath, platform);
  return runOpenCommand(command, args, {
    ...options,
    resolveOnSpawn: platform === "win32"
  });
}

export function getOpenFolderCommand(targetPath, platform = process.platform) {
  if (platform === "win32") {
    return {
      command: "explorer.exe",
      args: [targetPath]
    };
  }

  if (platform === "darwin") {
    return { command: "open", args: [targetPath] };
  }

  return { command: "xdg-open", args: [targetPath] };
}

function runOpenCommand(command, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", reject);
    if (options.resolveOnSpawn) {
      child.once("spawn", resolve);
      return;
    }

    child.once("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Open folder command failed with exit code ${code}.`));
    });
  });
}
