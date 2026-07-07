import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { publicConfig, resolveConfiguredPaths, saveConfig } from "./config.mjs";

export async function getSettings(options = {}) {
  const { paths, config } = await resolveConfiguredPaths(options);
  return settingsResponse(paths, config);
}

export async function setSettings(patch, options = {}) {
  const { paths, config } = await saveConfig(patch, options);
  return settingsResponse(paths, config);
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
    config: publicConfig(config)
  };
}

function settingsResponse(paths, config) {
  return {
    ok: true,
    config_path: paths.configPath,
    storage: {
      notes_dir: paths.notesDir,
      default_notes_dir: paths.defaultNotesDir,
      using_env_override: paths.usingEnvNotesDir
    },
    config: publicConfig(config)
  };
}

export function openFolder(targetPath, options = {}) {
  const { command, args } = getOpenFolderCommand(targetPath, options.platform || process.platform);
  return runOpenCommand(command, args, options);
}

export function getOpenFolderCommand(targetPath, platform = process.platform) {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", "explorer.exe", `/n,${targetPath}`]
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
    child.once("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Open folder command failed with exit code ${code}.`));
    });
  });
}
