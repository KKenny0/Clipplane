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
  openFolder(paths.notesDir);

  return {
    ok: true,
    path: paths.notesDir,
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

function openFolder(targetPath) {
  const command = process.platform === "win32"
    ? "explorer.exe"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";

  const child = spawn(command, [targetPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}
