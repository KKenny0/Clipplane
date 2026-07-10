# Clipplane Chrome Web Store Listing

Status: implementation draft for the first `0.6.0` private trusted-tester submission. Replace only the bracketed release facts after signed Host installers and the Store Item ID exist.

## Single Purpose

Clipplane saves web content that the user explicitly chooses into a local org-mode inbox and, only when the user chooses **Save + sync**, can send that same clip to a configured Notion or flomo destination.

## Summary

Save pages, selections, or page regions to a local org-mode inbox, with optional user-triggered Notion or flomo sync.

The summary is 117 characters and is below the Chrome Web Store 132-character limit.

## Full Description

Clipplane is a local-first web clipper for people who want a clean, inspectable trail on their own computer.

Choose Selection, Page, or Element, then save the result to a local `inbox.org`. Page capture prefers readable article content and falls back to locally cleaned page text. Every clip also receives a structured local history record so you can inspect the source, capture method, saved body, and sync result later.

External sync is optional and off by default. After you configure and explicitly acknowledge a Notion or flomo destination, **Save + sync** saves locally first and then sends the clip body, title, and sanitized source URL to that destination. **Save local** never invokes an external sink.

Clipplane requires the separately installed Clipplane Host to write files on your computer. The Host package is available from the project's versioned GitHub Release assets for Windows and macOS.

Clipplane has no advertising, analytics, telemetry, account system, or Clipplane-operated content server.

## Permission Justifications

### `activeTab`

Provides temporary access to the current tab only after the user clicks Clipplane or chooses a Clipplane context-menu command. Clipplane does not request persistent access to all websites.

### `contextMenus`

Adds explicit “Clip selection to Clipplane” and “Clip page to Clipplane” commands to the browser context menu.

### `nativeMessaging`

Connects the extension to the locally installed Clipplane Host. The Host converts captured content to org-mode, writes the local inbox and capture history, and performs only user-configured sync requests.

### `scripting`

Runs the Selection, readable Page, fallback Page, or Element capture code in the active tab after a user action. No static all-sites content script is installed.

### `storage`

Stores extension UI preferences, short-lived Element capture state, the latest local result, and versioned external-sync consent. Clip content and service credentials are not stored in Chrome extension storage.

## Privacy Practice Answers

### Personally identifiable information

Not collected by Clipplane as a service. A page selected by the user may itself contain names or other identifying content; Clipplane treats it as Website content and saves it only according to the user's action.

### Authentication information

Handled only when the user configures optional Notion or flomo sync. The Notion integration token or flomo webhook is passed to the local Native Host and stored in the operating system credential store. It is not sent to Clipplane, placed in extension storage, logged, or included in Native Messaging responses.

### Website content

Collected only from the active page after an explicit click, context-menu command, or confirmed Element selection. The captured title, body, links, and sanitized source URL are saved locally first. They are sent to Notion or flomo only through **Save + sync** after per-sink consent.

### Web history

Clipplane stores a local history only for pages the user explicitly clips. It does not read or collect the browser's general browsing history.

### User activity

Clipplane records the chosen capture method and local sync outcome for each explicit clip. It does not track clicks, browsing behavior, or engagement for analytics or advertising.

### Data sale, advertising, and human access

Clipplane does not sell data, use it for advertising or credit purposes, or make it available for human review. It has no telemetry or Clipplane-operated content backend.

### Limited Use

Clipplane's use of information received from Google APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Public URLs

- Homepage: `https://github.com/KKenny0/Clipplane`
- Support: `https://github.com/KKenny0/Clipplane/issues`
- Privacy policy: `https://github.com/KKenny0/Clipplane/blob/main/PRIVACY.md`
- Host downloads: `https://github.com/KKenny0/Clipplane/releases/tag/v0.6.0`

Before submission, verify all four URLs in a signed-out browser. The privacy URL must remain publicly readable without a GitHub login.

## Reviewer Instructions

1. Install the signed Clipplane Host for the review operating system from `[SIGNED_HOST_RELEASE_URL]`.
2. Confirm that the installed extension ID is `[STORE_ITEM_ID]` and restart Chrome after Host installation.
3. Open a normal HTTPS article page. In Clipplane, select **Page** and **Save local**. Confirm the popup reports a local save.
4. Select text on the same page. Use **Selection** and **Save local**. Open Settings > History and confirm the selected-text preview and local body entry.
5. Use **Element**, choose a visible paragraph or card, and confirm only the selected region is saved. Pressing Escape before confirmation must save nothing.
6. Open Settings > Sync. Observe that Notion and flomo are disabled by default and that enabling either requires explicit acknowledgement of the transmitted fields.
7. Without configuring a sink, verify **Save + sync** is disabled. **Save local** must continue to work.
8. For external-sync review, use `[REVIEW_NOTION_CREDENTIALS_PROCEDURE]` or `[REVIEW_FLOMO_WEBHOOK_PROCEDURE]`. Do not place production credentials in this document or the extension package.
9. Trigger **Save + sync**. Confirm the local copy exists before checking the configured external destination.
10. Remove the test credential from the operating system credential manager after review. Local notes remain under the folder shown in Settings > Storage.

## Required Submission Assets

- 128x128 store icon from the shipped Clipplane icon.
- 1280x800 popup screenshot showing Selection, Page, Element, and Save local.
- 1280x800 Element screenshot showing a real selected region.
- 1280x800 History screenshot showing local capture methods and previews.
- 1280x800 Sync screenshot showing sinks off by default and the explicit acknowledgement.
- 1280x800 optional Notion result screenshot produced by an explicit test sync.
- 440x280 small promo tile using the Clipplane brand and “Local-first web clipping” only.

Generate these from the final `0.6.0` Store-ID build. Do not submit current screenshots if they omit Element mode, consent controls, onboarding, or the final Host status.

## Manual Submission Checklist

- `[ ]` User confirms `PRIVACY.md` is legally and factually acceptable.
- `[ ]` Public Store Item ID and key are reflected in the extension and Native Host origins.
- `[ ]` Signed Windows and notarized macOS Host assets exist at the exact reviewer URL.
- `[ ]` All bracketed reviewer placeholders are replaced without adding secrets.
- `[ ]` Listing and Privacy fields match the published `0.6.0` behavior.
- `[ ]` Screenshots come from the submitted build and contain no personal notes, tokens, webhooks, or private URLs.
- `[ ]` First submission uses Private trusted testers before Public distribution.
