import assert from "node:assert/strict";
import test from "node:test";
import {
  captureDocumentMarkdown,
  isCaptureDocument,
  parseCaptureDocument,
  renderCaptureDocument,
  renderRecoveredOrgBody
} from "../native-host/capture-document.mjs";

const capture = {
  capture_id: "capture-1",
  title: "A \"quoted\" title",
  source_url: "https://example.com/a",
  author: "作者",
  published_at: "2026-08-12",
  clipped_at: "2026-08-12T10:00:00.000Z",
  description: "A description",
  site_name: "Example",
  tags: ["ai", "read"],
  extraction_method: "readability"
};

test("Capture Document v1 is self-contained and preserves exact Markdown semantics", () => {
  const markdown = "# Heading\n\nBody with --- and 中文.";
  const document = renderCaptureDocument(capture, markdown);
  const parsed = parseCaptureDocument(document);
  assert.equal(parsed.format, 1);
  assert.equal(parsed.metadata.capture_id, "capture-1");
  assert.equal(parsed.metadata.author, "作者");
  assert.deepEqual(parsed.metadata.tags, ["ai", "read"]);
  assert.equal(parsed.markdown.trimEnd(), markdown);
  assert.equal(captureDocumentMarkdown(document).trimEnd(), markdown);
  assert.equal(isCaptureDocument(document), true);
});

test("legacy Markdown remains readable and is wrapped only once", () => {
  assert.equal(captureDocumentMarkdown("Raw body"), "Raw body");
  const once = renderCaptureDocument(capture, "Raw body");
  assert.equal(isCaptureDocument(once), true);
  assert.equal(captureDocumentMarkdown(once).trim(), "Raw body");
});

test("Capture Document wrapping preserves legacy body bytes", () => {
  const markdown = "\n    indented code\r\n\r\nBody  \r\n";
  const document = renderCaptureDocument(capture, markdown);
  assert.equal(parseCaptureDocument(document, capture.capture_id).markdown, markdown);
});

test("a legacy article showing Clipplane frontmatter is not mistaken for its own document", () => {
  const article = "---\nclipplane_body_format: 1\ncapture_id: other\ntitle: Ordinary YAML\n---\nBody";
  assert.equal(parseCaptureDocument(article, capture.capture_id).format, 0);
  assert.equal(captureDocumentMarkdown(article, capture.capture_id), article);
});

test("a managed Capture Document with another ID fails closed", () => {
  const document = renderCaptureDocument(capture, "Body");
  assert.throws(() => parseCaptureDocument(document, "another-id"), (error) => error.code === "capture_document_id_mismatch");
});

test("legacy Org recovery uses a collision-safe fence and rejects empty content", () => {
  const recovered = renderRecoveredOrgBody("Text\n~~~~\nMore");
  assert.match(recovered, /~~~~~org/);
  assert.match(recovered, /Recovered from the original/);
  assert.throws(() => renderRecoveredOrgBody(" \n"), (error) => error.code === "legacy_capture_content_missing");
});
