import os from "node:os";
import path from "node:path";

export const DEFAULT_NOTES_DIR = path.join(os.homedir(), "Documents", "notes");

export function getDefaultPaths(notesDir = process.env.CLIPPLANE_NOTES_DIR || DEFAULT_NOTES_DIR, options = {}) {
  const appConfigDir = getAppConfigDir(options.configDir);

  return {
    notesDir,
    inboxPath: path.join(notesDir, "inbox.md"),
    legacyInboxPath: path.join(notesDir, "inbox.org"),
    stateDir: path.join(notesDir, ".clipplane"),
    legacyInboxBackupPath: path.join(notesDir, ".clipplane", "backups", "inbox-v2.org"),
    legacyCapturesBackupPath: path.join(notesDir, ".clipplane", "backups", "captures-v2.jsonl"),
    capturesPath: path.join(notesDir, ".clipplane", "captures.jsonl"),
    captureBodiesDir: path.join(notesDir, ".clipplane", "captures"),
    captureDocumentMarkerPath: path.join(notesDir, ".clipplane", "capture-document-v1"),
    legacyConfigPath: path.join(notesDir, ".clipplane", "config.json"),
    appConfigDir,
    configPath: path.join(appConfigDir, "config.json"),
    defaultNotesDir: DEFAULT_NOTES_DIR,
    usingEnvNotesDir: Boolean(process.env.CLIPPLANE_NOTES_DIR && !options.notesDir)
  };
}

export function getAppConfigDir(configDir = process.env.CLIPPLANE_CONFIG_DIR) {
  if (configDir) {
    return configDir;
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Clipplane");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Clipplane");
  }

  return path.join(os.homedir(), ".config", "clipplane");
}
