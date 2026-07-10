import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getOpenFolderCommand, openFolder, openNotesDir } from "../native-host/settings-core.mjs";

test("openNotesDir creates and opens the resolved notes directory", async () => {
  const notesDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-open-")), "notes");
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-"));
  let openedPath = "";

  const result = await openNotesDir({
    notesDir,
    configDir,
    openFolderImpl: async (targetPath) => {
      openedPath = targetPath;
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, notesDir);
  assert.match(result.opened_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(openedPath, notesDir);
  assert.equal((await fs.stat(notesDir)).isDirectory(), true);
});

test("getOpenFolderCommand selects platform-native folder openers", () => {
  assert.deepEqual(
    getOpenFolderCommand("D:\\Notes\\Clipplane", "win32"),
    {
      command: "explorer.exe",
      args: ["D:\\Notes\\Clipplane"]
    }
  );
  assert.deepEqual(
    getOpenFolderCommand("/Users/me/Notes", "darwin"),
    { command: "open", args: ["/Users/me/Notes"] }
  );
  assert.deepEqual(
    getOpenFolderCommand("/home/me/notes", "linux"),
    { command: "xdg-open", args: ["/home/me/notes"] }
  );
});

test("openFolder launches one OS open request per invocation", async () => {
  const captured = [];

  for (let index = 0; index < 5; index += 1) {
    await openFolder("D:\\Notes\\Clipplane", {
      platform: "win32",
      spawnImpl: (command, args, options) => {
        captured.push({ command, args, options });
        return closingChild(0);
      }
    });
  }

  assert.equal(captured.length, 5);
  for (const call of captured) {
    assert.equal(call.command, "explorer.exe");
    assert.deepEqual(call.args, ["D:\\Notes\\Clipplane"]);
    assert.equal(call.options.windowsHide, true);
  }
});

test("Windows folder paths never pass through a command interpreter", () => {
  const targetPath = "D:\\Notes & Archive|(2026)\\\u4e2d\u6587";
  assert.deepEqual(getOpenFolderCommand(targetPath, "win32"), {
    command: "explorer.exe",
    args: [targetPath]
  });
});

test("openFolder uses platform-native commands outside Windows", async () => {
  const captured = [];

  for (const platform of ["darwin", "linux"]) {
    await openFolder("/notes", {
      platform,
      spawnImpl: (command, args) => {
        captured.push({ platform, command, args });
        return closingChild(0);
      }
    });
  }

  assert.deepEqual(captured, [
    {
      platform: "darwin",
      command: "open",
      args: ["/notes"]
    },
    {
      platform: "linux",
      command: "xdg-open",
      args: ["/notes"]
    }
  ]);
});

test("openFolder reports opener launch failures", async () => {
  await assert.rejects(
    openFolder("D:\\Notes\\Clipplane", {
      platform: "win32",
      spawnImpl: () => failingChild(new Error("opener failed"))
    }),
    /opener failed/
  );
});

function closingChild(code) {
  const child = new EventEmitter();
  process.nextTick(() => child.emit("close", code));
  return child;
}

function failingChild(error) {
  const child = new EventEmitter();
  process.nextTick(() => child.emit("error", error));
  return child;
}
