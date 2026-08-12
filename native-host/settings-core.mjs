import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { getSecretStatus, publicConfig, resolveConfiguredPaths, saveConfig } from "./config.mjs";

const CLIPBOARD_TIMEOUT_MS = 10_000;

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
    windowsHide: platform !== "win32",
    resolveOnSpawn: platform === "win32"
  });
}

export function openTextFile(targetPath, options = {}) {
  const platform = options.platform || process.platform;
  const { command, args } = getOpenTextFileCommand(targetPath, platform);
  return runOpenCommand(command, args, {
    ...options,
    windowsHide: platform !== "win32",
    resolveOnSpawn: platform === "win32"
  });
}

export function writeClipboardText(text, options = {}) {
  const platform = options.platform || process.platform;
  const { command, args } = getClipboardCommand(platform);
  const input = platform === "win32"
    ? Buffer.from(String(text), "utf16le")
    : String(text);
  const env = platform === "darwin"
    ? {
        ...process.env,
        ...options.env,
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8"
      }
    : options.env;
  return runClipboardCommand(command, args, input, { ...options, env });
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

export function getOpenTextFileCommand(targetPath, platform = process.platform) {
  if (platform === "darwin") {
    return { command: "open", args: ["-t", targetPath] };
  }
  return getOpenFolderCommand(targetPath, platform);
}

export function getClipboardCommand(platform = process.platform) {
  if (platform === "darwin") {
    return { command: "/usr/bin/pbcopy", args: [] };
  }
  if (platform === "win32") {
    return { command: "clip.exe", args: [] };
  }

  const error = new Error("Copying captures is supported on Windows and macOS.");
  error.code = "clipboard_unsupported";
  throw error;
}

function runOpenCommand(command, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      stdio: "ignore",
      windowsHide: options.windowsHide ?? true
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

function runClipboardCommand(command, args, input, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const spawnOptions = {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true
    };
    if (options.env) {
      spawnOptions.env = options.env;
    }
    const child = spawnImpl(command, args, spawnOptions);

    child.once("error", (error) => finish(reject, error));
    child.stdin.once("error", (error) => finish(reject, error));
    child.once("close", (code) => {
      if (code === 0) {
        finish(resolve);
        return;
      }
      const error = new Error(`Clipboard command failed with exit code ${code}.`);
      error.code = "clipboard_failed";
      finish(reject, error);
    });
    timeout = setTimeout(() => {
      const error = new Error(`Clipboard command timed out after ${timeoutMs} ms.`);
      error.code = "clipboard_timeout";
      finish(reject, error);
      child.stdin.destroy?.();
      child.kill?.();
    }, timeoutMs);
    child.stdin.end(input);
  });
}
