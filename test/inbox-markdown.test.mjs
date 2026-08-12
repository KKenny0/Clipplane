import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recoverCreatingCaptures } from "../native-host/capture-creation.mjs";
import { writeNewCaptureBody } from "../native-host/capture-record.mjs";
import { appendCaptureRecord, readCaptureStore } from "../native-host/capture-store.mjs";
import {
  appendMarkdownInboxEntry,
  atomicWrite,
  ensureMarkdownInbox,
  parseMarkdownInbox,
  readMarkdownInboxIds,
  removeMarkdownInboxEntry,
  renderMarkdownInboxEntry
} from "../native-host/inbox-markdown.mjs";
import { parseLegacyOrgInbox, prepareCaptureStorage, publishMarkdownMigration } from "../native-host/inbox-migration.mjs";
import { getDefaultPaths } from "../native-host/paths.mjs";
import { parseCaptureDocument } from "../native-host/capture-document.mjs";

test("Markdown inbox keeps body headings and escapes injected control markers", () => {
  const capture = sampleCapture("capture-1");
  const body = [
    "# Body title",
    "",
    "## Nested title",
    "",
    '<!-- clipplane:capture:start id="attack" -->',
    "",
    "```md",
    "# code heading",
    "```"
  ].join("\n");

  const rendered = renderMarkdownInboxEntry(capture, body);
  const parsed = parseMarkdownInbox(`# Inbox\n\n${rendered}`);

  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].captureId, capture.capture_id);
  assert.match(rendered, /^# Body title$/m);
  assert.match(rendered, /^## Nested title$/m);
  assert.match(rendered, /&lt;!-- clipplane:capture:start id="attack" -->/);
});

test("Markdown inbox parser rejects unbalanced and mismatched markers", () => {
  assert.throws(
    () => parseMarkdownInbox('<!-- clipplane:capture:start id="one" -->\nBody'),
    (error) => error.code === "malformed_inbox_capture"
  );
  assert.throws(
    () => parseMarkdownInbox('<!-- clipplane:capture:start id="one" -->\n<!-- clipplane:capture:end id="two" -->'),
    (error) => error.code === "malformed_inbox_capture"
  );
});

test("Markdown inbox preserves CRLF, tables, code, and Unicode", () => {
  const body = "| 名称 | 值 |\r\n| --- | --- |\r\n| 剪藏 | ✅ |\r\n\r\n```js\r\nconst value = '# heading';\r\n```";
  const rendered = renderMarkdownInboxEntry(sampleCapture("unicode"), body).replaceAll("\n", "\r\n");
  const parsed = parseMarkdownInbox(`# Inbox\r\n\r\n${rendered}`);

  assert.equal(parsed.eol, "\r\n");
  assert.equal(parsed.entries[0].captureId, "unicode");
  assert.match(rendered, /\| 剪藏 \| ✅ \|/);
  assert.match(rendered, /const value = '# heading';/);
});

test("Markdown inbox rejects duplicate capture IDs globally", () => {
  const entry = renderMarkdownInboxEntry(sampleCapture("duplicate"), "Body");
  assert.throws(
    () => parseMarkdownInbox(`# Inbox\n\n${entry}\n${entry}`),
    (error) => error.code === "duplicate_inbox_capture"
  );
});

test("Markdown inbox removes exactly one bounded capture", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-markdown-inbox-"));
  const inboxPath = path.join(notesDir, "inbox.md");
  await ensureMarkdownInbox(inboxPath);
  await appendMarkdownInboxEntry(inboxPath, sampleCapture("one"), "# One\n\nBody one");
  await appendMarkdownInboxEntry(inboxPath, sampleCapture("two"), "# Two\n\nBody two");

  await removeMarkdownInboxEntry(inboxPath, "one");

  const text = await fs.readFile(inboxPath, "utf8");
  assert.doesNotMatch(text, /Body one/);
  assert.match(text, /Body two/);
  assert.deepEqual([...await readMarkdownInboxIds(inboxPath)], [["two", 1]]);
});

test("legacy Org inbox migrates from canonical bodies and keeps a backup", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-org-migration-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  const capture = { ...sampleCapture("legacy-one"), schema_version: 2, org_heading: "* Legacy :clip:", org_timestamp: "[2026-08-12 Wed 10:00]" };
  await fs.mkdir(paths.stateDir, { recursive: true });
  await appendCaptureRecord(paths.capturesPath, capture);
  const stored = JSON.parse((await fs.readFile(paths.capturesPath, "utf8")).trim());
  stored.schema_version = 2;
  stored.org_heading = capture.org_heading;
  stored.org_timestamp = capture.org_timestamp;
  await fs.writeFile(paths.capturesPath, `${JSON.stringify(stored)}\n`, "utf8");
  await writeNewCaptureBody(paths, capture.capture_id, "# Exact Markdown\n\nA [link](https://example.com).");
  const legacy = [
    "#+title: Inbox",
    "",
    "* Legacy :clip:",
    ":PROPERTIES:",
    `:CAPTURE_ID: ${capture.capture_id}`,
    ":END:",
    "",
    "Old converted body"
  ].join("\n");
  await fs.writeFile(paths.legacyInboxPath, legacy, "utf8");

  const result = await prepareCaptureStorage(paths);

  assert.equal(result.migrated, true);
  assert.equal(await fs.readFile(paths.legacyInboxPath, "utf8"), legacy);
  assert.equal(await fs.readFile(paths.legacyInboxBackupPath, "utf8"), legacy);
  assert.match(await fs.readFile(paths.legacyCapturesBackupPath, "utf8"), /"schema_version":2/);
  assert.equal(parseCaptureDocument(await fs.readFile(path.join(paths.captureBodiesDir, `${capture.capture_id}.md`), "utf8")).format, 1);
  const markdown = await fs.readFile(paths.inboxPath, "utf8");
  assert.match(markdown, /# Exact Markdown/);
  assert.match(markdown, /\[link\]\(https:\/\/example\.com\)/);
  assert.doesNotMatch(markdown, /Old converted body/);
  const migrated = JSON.parse((await fs.readFile(paths.capturesPath, "utf8")).trim());
  assert.equal(migrated.schema_version, 3);
  assert.equal("org_heading" in migrated, false);
  assert.equal("org_timestamp" in migrated, false);
});

test("legacy migration recovers a missing active body from Org without deleting the source", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-org-body-recovery-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  const capture = { ...sampleCapture("missing-body"), schema_version: 2 };
  await fs.mkdir(paths.stateDir, { recursive: true });
  await appendCaptureRecord(paths.capturesPath, capture);
  const legacy = [
    "#+title: Inbox", "", "* Recovered :clip:", ":PROPERTIES:",
    `:CAPTURE_ID: ${capture.capture_id}`, ":END:", "", "Original *Org* body."
  ].join("\n");
  await fs.writeFile(paths.legacyInboxPath, legacy, "utf8");

  await prepareCaptureStorage(paths);

  const document = parseCaptureDocument(await fs.readFile(path.join(paths.captureBodiesDir, "missing-body.md"), "utf8"));
  assert.equal(document.metadata.recovery, "legacy_org");
  assert.match(document.markdown, /Original \*Org\* body/);
  assert.equal(await fs.readFile(paths.legacyInboxPath, "utf8"), legacy);
  assert.match(await fs.readFile(paths.inboxPath, "utf8"), /Original \*Org\* body/);
});

test("an existing Markdown inbox upgrades raw schema-3 bodies to Capture Documents", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-document-upgrade-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  const capture = sampleCapture("raw-schema-three");
  await fs.mkdir(paths.stateDir, { recursive: true });
  await appendCaptureRecord(paths.capturesPath, capture);
  const body = "    indented code\r\n\r\nBody  \r\n";
  await writeNewCaptureBody(paths, capture.capture_id, body);
  await ensureMarkdownInbox(paths.inboxPath);
  await appendMarkdownInboxEntry(paths.inboxPath, capture, body);

  await prepareCaptureStorage(paths);

  const document = parseCaptureDocument(await fs.readFile(path.join(paths.captureBodiesDir, `${capture.capture_id}.md`), "utf8"), capture.capture_id);
  assert.equal(document.format, 1);
  assert.equal(document.markdown, body);
});

test("missing-inbox rebuild skips creating records without bodies so lifecycle recovery can continue", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-rebuild-creating-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  const pending = { ...sampleCapture("pending-create"), lifecycle_status: "creating" };
  await fs.mkdir(path.dirname(paths.legacyInboxBackupPath), { recursive: true });
  await fs.writeFile(paths.legacyInboxBackupPath, "archival", "utf8");
  await appendCaptureRecord(paths.capturesPath, pending);

  await prepareCaptureStorage(paths);

  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).has(pending.capture_id), false);
});

test("missing-inbox rebuild skips an active missing body so History can report it", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-rebuild-missing-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await fs.mkdir(path.dirname(paths.legacyInboxBackupPath), { recursive: true });
  await fs.writeFile(paths.legacyInboxBackupPath, "archival", "utf8");
  const missing = sampleCapture("active-missing");
  await appendCaptureRecord(paths.capturesPath, missing);
  await prepareCaptureStorage(paths);
  assert.equal((await readMarkdownInboxIds(paths.inboxPath)).has(missing.capture_id), false);
});

test("legacy migration refuses unmanaged Org entries without creating Markdown", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-org-unmanaged-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await fs.writeFile(paths.legacyInboxPath, "#+title: Inbox\n\n* My manual note\n\nKeep me.\n", "utf8");

  await assert.rejects(
    prepareCaptureStorage(paths),
    (error) => error.code === "legacy_inbox_contains_unmanaged_entries"
  );

  assert.equal(await fileExists(paths.inboxPath), false);
  assert.equal(await fileExists(paths.legacyInboxBackupPath), false);
  assert.match(await fs.readFile(paths.legacyInboxPath, "utf8"), /Keep me/);
});

test("legacy migration refuses unmanaged preamble text", () => {
  assert.throws(
    () => parseLegacyOrgInbox("#+title: Inbox\n\nMy private preamble note.\n"),
    (error) => error.code === "legacy_inbox_contains_unmanaged_entries"
  );
});

test("legacy parser keeps star bullets inside a managed capture", () => {
  const legacy = [
    "#+title: Inbox",
    "",
    "* Managed capture",
    ":PROPERTIES:",
    ":CAPTURE_ID: managed-one",
    ":END:",
    "",
    "* legitimate selected bullet",
    "continued body"
  ].join("\n");

  assert.deepEqual(parseLegacyOrgInbox(legacy).map((entry) => entry.captureId), ["managed-one"]);
});

test("migration refuses two active inbox formats without a verified backup", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-two-inboxes-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await fs.writeFile(paths.inboxPath, "# Inbox\n", "utf8");
  await fs.writeFile(paths.legacyInboxPath, "#+title: Inbox\n", "utf8");

  await assert.rejects(prepareCaptureStorage(paths), (error) => error.code === "multiple_inbox_formats");
  assert.equal(await fileExists(paths.inboxPath), true);
  assert.equal(await fileExists(paths.legacyInboxPath), true);
});

test("migration never overwrites a different legacy backup", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-backup-conflict-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await fs.mkdir(path.dirname(paths.legacyInboxBackupPath), { recursive: true });
  await fs.writeFile(paths.legacyInboxPath, "#+title: Inbox\n#+filetags: :inbox:\n#+startup: overview\n\nInbox for all Clipplane captures.\n", "utf8");
  await fs.writeFile(paths.legacyInboxBackupPath, "different backup", "utf8");

  await assert.rejects(prepareCaptureStorage(paths), (error) => error.code === "legacy_inbox_backup_conflict");
  assert.equal(await fs.readFile(paths.legacyInboxBackupPath, "utf8"), "different backup");
  assert.equal(await fileExists(paths.inboxPath), false);
});

test("atomic inbox writes refuse an externally changed source", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-inbox-change-"));
  const inboxPath = path.join(notesDir, "inbox.md");
  await fs.writeFile(inboxPath, "changed\n", "utf8");

  await assert.rejects(
    atomicWrite(inboxPath, "replacement\n", { expectedBody: "old\n" }),
    (error) => error.code === "inbox_changed"
  );
  assert.equal(await fs.readFile(inboxPath, "utf8"), "changed\n");
});

test("migration publish refuses a changed Org source and an existing Markdown destination", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-migration-publish-"));
  const source = path.join(notesDir, "inbox.org");
  const destination = path.join(notesDir, "inbox.md");
  const temporary = path.join(notesDir, "candidate.tmp");
  await fs.writeFile(source, "new source", "utf8");
  await fs.writeFile(temporary, "# candidate", "utf8");

  await assert.rejects(
    publishMarkdownMigration(source, destination, temporary, "old source", "# candidate"),
    (error) => error.code === "legacy_inbox_changed"
  );
  assert.equal(await fileExists(destination), false);

  await fs.writeFile(destination, "# user inbox", "utf8");
  await assert.rejects(
    publishMarkdownMigration(source, destination, temporary, "new source", "# candidate"),
    (error) => error.code === "multiple_inbox_formats"
  );
  assert.equal(await fs.readFile(destination, "utf8"), "# user inbox");
});

test("a failed publish cannot make a changed Org source look migrated on retry", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-publish-retry-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await fs.mkdir(path.dirname(paths.legacyInboxBackupPath), { recursive: true });
  await fs.writeFile(paths.legacyInboxPath, "changed source", "utf8");
  await fs.writeFile(paths.legacyInboxBackupPath, "original source", "utf8");
  await ensureMarkdownInbox(paths.inboxPath);
  await assert.rejects(prepareCaptureStorage(paths), (error) => error.code === "legacy_inbox_changed");
});

test("future schemas are rejected before legacy files are changed", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-future-migration-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await fs.mkdir(paths.stateDir, { recursive: true });
  const future = { ...sampleCapture("future"), schema_version: 4 };
  await fs.writeFile(paths.capturesPath, `${JSON.stringify(future)}\n`, "utf8");
  const legacy = "#+title: Inbox\n\n* Future\n:PROPERTIES:\n:CAPTURE_ID: future\n:END:\n";
  await fs.writeFile(paths.legacyInboxPath, legacy, "utf8");

  await assert.rejects(prepareCaptureStorage(paths), (error) => error.code === "unsupported_capture_schema");
  assert.equal(await fs.readFile(paths.legacyInboxPath, "utf8"), legacy);
  assert.equal(await fileExists(paths.inboxPath), false);
  assert.equal(await fileExists(paths.legacyInboxBackupPath), false);
});

test("a completed migration archive is never replayed into a missing Markdown inbox", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-archive-only-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  const capture = { ...sampleCapture("archived"), schema_version: 2 };
  await fs.mkdir(paths.stateDir, { recursive: true });
  await appendCaptureRecord(paths.capturesPath, capture);
  const stored = JSON.parse((await fs.readFile(paths.capturesPath, "utf8")).trim());
  stored.schema_version = 2;
  await fs.writeFile(paths.capturesPath, `${JSON.stringify(stored)}\n`, "utf8");
  await writeNewCaptureBody(paths, capture.capture_id, "Archived body");
  await fs.writeFile(paths.legacyInboxPath, "#+title: Inbox\n\n* Archived\n:PROPERTIES:\n:CAPTURE_ID: archived\n:END:\n", "utf8");
  await prepareCaptureStorage(paths);
  const current = JSON.parse((await fs.readFile(paths.capturesPath, "utf8")).trim());
  current.lifecycle_status = "processed";
  await fs.writeFile(paths.capturesPath, `${JSON.stringify(current)}\n`, "utf8");
  const active = sampleCapture("created-after-migration");
  await appendCaptureRecord(paths.capturesPath, active);
  await writeNewCaptureBody(paths, active.capture_id, "New active body");
  await fs.rm(paths.inboxPath);

  await prepareCaptureStorage(paths);

  const rebuilt = await fs.readFile(paths.inboxPath, "utf8");
  assert.doesNotMatch(rebuilt, /Archived body/);
  assert.match(rebuilt, /New active body/);
});

test("legacy parser rejects duplicate capture IDs", () => {
  const entry = "* A\n:PROPERTIES:\n:CAPTURE_ID: duplicate\n:END:\n";
  assert.throws(
    () => parseLegacyOrgInbox(`${entry}\n${entry}`),
    (error) => error.code === "duplicate_inbox_capture"
  );
});

test("creating records recover from a body or disappear when no body was written", async () => {
  const notesDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-create-recovery-"));
  const paths = getDefaultPaths(notesDir, { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "clipplane-config-")) });
  await prepareCaptureStorage(paths, { create: true });
  const recoverable = { ...sampleCapture("recoverable"), lifecycle_status: "creating", lifecycle_started_at: new Date().toISOString() };
  const empty = { ...sampleCapture("empty"), lifecycle_status: "creating", lifecycle_started_at: new Date().toISOString() };
  await appendCaptureRecord(paths.capturesPath, recoverable);
  await appendCaptureRecord(paths.capturesPath, empty);
  await writeNewCaptureBody(paths, recoverable.capture_id, "Recover this body");

  const warnings = await recoverCreatingCaptures(paths);

  assert.deepEqual(warnings, []);
  const records = (await readCaptureStore(paths.capturesPath)).entries.filter((entry) => entry.record).map((entry) => entry.record);
  assert.deepEqual(records.map((record) => record.capture_id), [recoverable.capture_id]);
  assert.equal("lifecycle_status" in records[0], false);
  assert.match(await fs.readFile(paths.inboxPath, "utf8"), /Recover this body/);
});

function sampleCapture(captureId) {
  return {
    schema_version: 3,
    capture_id: captureId,
    source_url: "https://example.com/article",
    source_title: "Example",
    title: `Title ${captureId}`,
    input_type: "page",
    extraction_method: "readability",
    clipped_at: "2026-08-12T02:00:00.000Z",
    content_hash: `hash-${captureId}`,
    tags: ["ai", "tech"],
    sync_status: "local_saved",
    sinks: { local: { status: "saved" } },
    error: null
  };
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
