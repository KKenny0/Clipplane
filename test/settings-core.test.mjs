import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getClipboardCommand,
  getOpenFolderCommand,
  getOpenTextFileCommand,
  openFolder,
  openNotesDir,
  openTextFile,
  writeClipboardText
} from "../native-host/settings-core.mjs";

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

test("getOpenTextFileCommand bypasses broken Markdown handlers on macOS", () => {
  assert.deepEqual(
    getOpenTextFileCommand("/Users/me/Notes/capture.md", "darwin"),
    { command: "open", args: ["-t", "/Users/me/Notes/capture.md"] }
  );
  assert.deepEqual(
    getOpenTextFileCommand("D:\\Notes\\capture.md", "win32"),
    { command: "explorer.exe", args: ["D:\\Notes\\capture.md"] }
  );
  assert.deepEqual(
    getOpenTextFileCommand("/home/me/notes/capture.md", "linux"),
    { command: "xdg-open", args: ["/home/me/notes/capture.md"] }
  );
});

test("getClipboardCommand uses platform-native clipboard writers", () => {
  assert.deepEqual(
    getClipboardCommand("darwin"),
    { command: "/usr/bin/pbcopy", args: [] }
  );
  assert.deepEqual(
    getClipboardCommand("win32"),
    { command: "clip.exe", args: [] }
  );
  assert.throws(
    () => getClipboardCommand("linux"),
    (error) => error.code === "clipboard_unsupported"
  );
});

test("writeClipboardText sends exact Unicode text over stdin without a shell", async () => {
  const calls = [];

  await writeClipboardText("# 标题\n\nExact body", {
    platform: "darwin",
    env: {},
    spawnImpl: (command, args, options) => clipboardChild(0, (input) => {
      calls.push({ command, args, options, input });
    })
  });

  assert.equal(calls[0].command, "/usr/bin/pbcopy");
  assert.deepEqual(calls[0].args, []);
  assert.deepEqual(calls[0].options.stdio, ["pipe", "ignore", "ignore"]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.env.LANG, "en_US.UTF-8");
  assert.equal(calls[0].options.env.LC_ALL, "en_US.UTF-8");
  assert.equal(calls[0].input, "# 标题\n\nExact body");
});

test("writeClipboardText sends UTF-16LE to the Windows clipboard writer", async () => {
  const calls = [];

  await writeClipboardText("# 标题\n\nExact body", {
    platform: "win32",
    spawnImpl: (command, args, options) => clipboardChild(0, (input) => {
      calls.push({ command, args, options, input });
    })
  });

  assert.equal(calls[0].command, "clip.exe");
  assert.deepEqual(calls[0].args, []);
  assert.equal(Buffer.isBuffer(calls[0].input), true);
  assert.equal(calls[0].input.toString("utf16le"), "# 标题\n\nExact body");
});

test("writeClipboardText reports clipboard command failures", async () => {
  await assert.rejects(
    writeClipboardText("Body", {
      platform: "win32",
      spawnImpl: () => clipboardChild(1, () => {})
    }),
    (error) => error.code === "clipboard_failed"
  );
});

test("writeClipboardText stops a clipboard writer that does not finish", async () => {
  const child = new EventEmitter();
  let destroyed = false;
  let killed = false;
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  child.stdin.destroy = () => {
    destroyed = true;
  };
  child.kill = () => {
    killed = true;
  };

  await assert.rejects(
    writeClipboardText("Body", {
      platform: "darwin",
      timeoutMs: 5,
      spawnImpl: () => child
    }),
    (error) => error.code === "clipboard_timeout"
  );

  assert.equal(destroyed, true);
  assert.equal(killed, true);
});

test("openTextFile uses the macOS text-editor route", async () => {
  const captured = [];

  await openTextFile("/notes/capture.md", {
    platform: "darwin",
    spawnImpl: (command, args) => {
      captured.push({ command, args });
      return closingChild(0);
    }
  });

  assert.deepEqual(captured, [{ command: "open", args: ["-t", "/notes/capture.md"] }]);
});

test("openTextFile keeps Windows Explorer visible and passes the path directly", async () => {
  const captured = [];
  await openTextFile("D:\\Notes & Archive\\中文\\capture.md", {
    platform: "win32",
    spawnImpl: (command, args, options) => {
      captured.push({ command, args, options });
      return closingChild(1);
    }
  });
  assert.equal(captured[0].command, "explorer.exe");
  assert.deepEqual(captured[0].args, ["D:\\Notes & Archive\\中文\\capture.md"]);
  assert.equal(captured[0].options.windowsHide, false);
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
    assert.equal(call.options.windowsHide, false);
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

test("Windows opener resolves after launch when Explorer hands off with exit code 1", async () => {
  await openFolder("D:\\Notes\\Clipplane", {
    platform: "win32",
    spawnImpl: () => closingChild(1)
  });
});

test("non-Windows openers still report nonzero exit codes", async () => {
  await assert.rejects(
    openFolder("/notes", {
      platform: "linux",
      spawnImpl: () => closingChild(1)
    }),
    /exit code 1/
  );
});

function closingChild(code) {
  const child = new EventEmitter();
  process.nextTick(() => {
    child.emit("spawn");
    child.emit("close", code);
  });
  return child;
}

function failingChild(error) {
  const child = new EventEmitter();
  process.nextTick(() => child.emit("error", error));
  return child;
}

function clipboardChild(code, onEnd) {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = (input) => {
    onEnd(input);
    process.nextTick(() => child.emit("close", code));
  };
  return child;
}
