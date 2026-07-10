# Clipplane v0.5 Capture Quality Handoff

This handoff records the state after the v0.5 multi-strategy capture implementation. The source package is versioned `0.5.0`, but it is not a release until the browser acceptance checks below pass.

## Current State

- `v0.4.1` is the released fixed-ID dev preview. It keeps the stable extension ID `mhgcfphfcgbgabhbegdonadkedfaddhc` and distributes a manually loadable extension zip through GitHub Releases.
- The working tree now contains the unreleased v0.5 capture-quality work:
  - `Selection` stores the exact selected text without loading a page extractor.
  - `Page` tries Mozilla Readability first, then falls back to Clipplane's local DOM extractor.
  - `Element` starts a temporary picker so the user can choose a paragraph, card, comment, or page region.
  - Capture records and org entries include `extraction_method`; History shows Selected text, Readable article, Page fallback, or Selected area.
- `@mozilla/readability@0.6.0` and `jsdom@29.1.1` are pinned development dependencies. Node.js `20.19.0` or later is required. `npm install` runs `prepare:extension`, which copies Readability and its Apache-2.0 license into the ignored `extension/vendor/` directory. `npm run package:extension` always refreshes those files before zipping.
- The extension manifest still has only `activeTab`, `contextMenus`, `nativeMessaging`, `scripting`, and `storage`. No broad `host_permissions`, static all-sites content script, background fetch, or external capture service was added.
- The DOM fallback normalizer uses a conservative profile: it retains semantic text, lists, code, tables, and safe links while removing hidden nodes, controls, navigation, dialogs, high-link-density chrome, and page-noise containers. Element mode keeps the chosen root and only removes local control chrome.

## Privacy and Security Boundary

The v0.5 design keeps the local-first boundary intact:

1. Page code is injected only after an explicit extension action or context-menu command, using the temporary `activeTab` grant.
2. Readability parses `document.cloneNode(true)`, so it does not mutate the visible page.
3. Element mode sends content only after the user confirms a highlighted target. Its short-lived request state is stored in `chrome.storage.session`, so Service Worker suspension cannot drop it; the background script accepts a result only when its random request ID, tab ID, main-frame ID, and expiry match.
4. Picker listeners and its style node are removed after confirmation, `Escape`, timeout, or replacement by a newer picker. It does not save DOM selectors, raw HTML, screenshots, or pages that were merely hovered.
5. Markdown conversion keeps only `http`, `https`, and `mailto` links. It drops unsafe URL schemes before local org output.

## Verified Locally

```powershell
npm test
npm run smoke
npm run smoke:sync:local
npm run doctor
npm run package:extension
git diff --check
```

Latest results:

- `npm test`: 39 passing tests, including Readability article extraction, short-page fallback, Element payload, picker cleanup, Service Worker-safe pending state, capture metadata, and bounded History previews.
- `npm run smoke` and `npm run smoke:sync:local`: passed with `extraction_method` preserved in capture records and org entries.
- `npm run doctor`: passed core checks. Chrome and Edge Native Messaging manifests are not registered on this machine, which is expected until setup is run.
- `npm run package:extension`: produced the extension zip containing `vendor/Readability.js` and `vendor/Readability-LICENSE.md`; the inspected archive contains no private key, `.env`, native host manifest, or launcher file. Manifest permissions remain unchanged.

## Required Before Release

1. Load the prepared `extension/` folder in a fresh Chrome profile. Run the Chrome host setup command if required, then verify:
   - Selection saves exact text.
   - Page saves an article through Readability.
   - A short/non-article page saves through fallback.
   - Element highlights a target, saves only the confirmed region, and `Escape` or timeout writes nothing.
2. Repeat the same checks in Edge. Browser internal pages, the Chrome Web Store, and cross-origin iframes should fail clearly rather than capture.
3. Rebuild the package after the final browser checks, inspect the zip again, then publish the verified `0.5.0` GitHub Release.

## Non-Scope

- No Chrome Web Store dependency, all-sites permission, native desktop installer, cloud crawler, screenshot capture, AI summary, or new sync sink.
- No migration is needed. Older capture records without `extraction_method` are displayed as `legacy_page` while new records write the explicit method.

## Worktree Note

`native-host/clipplane-host.cmd` still has a pre-existing line-ending-only worktree state. Keep it out of the v0.5 commit unless line-ending normalization is an explicit, separately reviewed change.
