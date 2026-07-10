# Clipplane Privacy Policy

Last updated: July 10, 2026

Clipplane is a local-first browser clipper. This policy describes what the Clipplane browser extension and its Native Messaging host handle, where that data goes, and what choices you have.

## Data Clipplane Handles

When you ask Clipplane to save a page, selection, or chosen element, it processes:

- the captured page title, text, links, and source URL;
- the capture time, capture method, content hash, and local sync history;
- the local notes folder you choose;
- a Notion integration token or flomo webhook only when you configure that optional service.

Clipplane does not capture pages in the background. Page access begins only after you click the extension, use its context menu, or confirm an element selection.

## Local Storage

Clips are saved first to files on your computer through the Clipplane Native Messaging host. By default these files are under `~/Documents/notes`, including `inbox.org` and the `.clipplane` capture history. Extension preferences and external-sync consent records are stored in Chrome extension storage.

Notion tokens and flomo webhooks are stored in the operating system credential store on supported Windows and macOS installations. Clipplane refuses to silently fall back to plaintext credential files. Older development versions may have stored these values in the local Clipplane config file; saving Sync settings migrates them only after the operating system credential store passes a write-and-read verification.

## Optional External Sync

External sync is off by default. Enabling a sink requires an explicit acknowledgement in Settings. A clip is sent externally only when you choose **Save + sync**.

- Notion receives the clip body, title, and sanitized source URL through the Notion API.
- flomo receives the clip body, title, and sanitized source URL through the configured official flomo incoming webhook.

Before transmission, Clipplane removes URL credentials and fragments, common tracking parameters, and values of query parameters that appear to contain authentication or other sensitive data. The external service then processes the transmitted data under its own privacy policy. A sync failure does not remove or alter the local copy.

## Collection and Sharing

Clipplane has no analytics, advertising, telemetry, crash-reporting service, or Clipplane-operated server. The project does not sell user data, use it for advertising, or provide it to humans for review. Data is shared only with an external sync destination that you configure and invoke.

Clipplane's use of information received from Google APIs complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Retention and Deletion

Local clips remain until you edit or delete the files from your notes folder. You can remove extension preferences and consent records by clearing the extension's data or uninstalling it. You can remove stored Notion or flomo credentials through the operating system credential manager. Data already sent to Notion or flomo must be deleted through that service.

## Security

The extension requests only `activeTab`, `contextMenus`, `nativeMessaging`, `scripting`, and `storage`. It does not request persistent host permissions. The published extension package contains no executable native host, private signing key, or remotely hosted code.

## Changes and Contact

Material policy changes will update the date above and require renewed consent before external sync resumes. Questions and security reports can be filed in the project's GitHub issue tracker.
