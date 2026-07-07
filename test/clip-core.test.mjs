import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyTags,
  clipPayload,
  markdownToOrg,
  normalizePayload
} from "../native-host/clip-core.mjs";

test("normalizePayload rejects empty content", () => {
  assert.throws(() => normalizePayload({ contentMarkdown: "" }), /Nothing to clip/);
});

test("markdownToOrg converts headings, links, bold, and code fences", () => {
  const org = markdownToOrg("# Title\n\nSee [site](https://example.com).\n\n**Bold**\n\n```js\nconsole.log(1)\n```");
  assert.match(org, /^\*\* Title/m);
  assert.match(org, /\[\[https:\/\/example\.com\]\[site\]\]/);
  assert.match(org, /\*Bold\*/);
  assert.match(org, /#\+begin_src js/);
  assert.match(org, /#\+end_src/);
});

test("classifyTags returns at most two content tags", () => {
  assert.deepEqual(classifyTags("AI agent code API startup design"), ["ai", "tech"]);
});

test("clipPayload writes inbox and skips duplicates", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-test-"));
  const payload = {
    inputType: "page",
    sourceUrl: "https://example.com/post#section",
    sourceTitle: "Agent Notes",
    title: "Agent Notes",
    contentMarkdown: "# Agent Notes\n\nAI agent article body."
  };

  const first = await clipPayload(payload, { notesDir });
  const second = await clipPayload(payload, { notesDir });

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.capture.content_hash, first.capture.content_hash);

  const inbox = await fs.readFile(path.join(notesDir, "inbox.org"), "utf8");
  assert.match(inbox, /\* Agent Notes :ai:/);
  assert.match(inbox, /:STATUS: inbox/);
  assert.match(inbox, /\*\* Agent Notes/);

  const captures = await fs.readFile(path.join(notesDir, ".clipplane", "captures.jsonl"), "utf8");
  assert.equal(captures.trim().split(/\r?\n/).length, 1);
});
