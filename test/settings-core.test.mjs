import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openFolder, openNotesDir } from "../native-host/settings-core.mjs";

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
  assert.equal(openedPath, notesDir);
  assert.equal((await fs.stat(notesDir)).isDirectory(), true);
});

test("openFolder uses the Windows shell open command and waits for completion", async () => {
  let captured;

  await openFolder("D:\\Notes\\Clipplane", {
    platform: "win32",
    spawnImpl: (command, args, options) => {
      captured = { command, args, options };
      return closingChild(0);
    }
  });

  assert.equal(captured.command, "cmd.exe");
  assert.deepEqual(captured.args, ["/d", "/s", "/c", "start", "", "D:\\Notes\\Clipplane"]);
  assert.equal(captured.options.windowsHide, true);
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
