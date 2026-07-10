# Clipplane v0.5 Capture Quality Handoff

This handoff records the state after the v0.5 capture and Chrome Web Store security baseline. The source package is versioned `0.5.0`, but it is not a release until the browser acceptance checks below pass.

## Current State

- `v0.4.1` is the released fixed-ID dev preview. It keeps the stable extension ID `mhgcfphfcgbgabhbegdonadkedfaddhc` and distributes a manually loadable extension zip through GitHub Releases.
- Commits `76ae184` and `f743b6b` contain the unreleased v0.5 capture and security baseline:
  - `Selection` stores the exact selected text without loading a page extractor.
  - `Page` tries Mozilla Readability first, then falls back to Clipplane's local DOM extractor.
  - `Element` starts a temporary picker so the user can choose a paragraph, card, comment, or page region.
  - Capture records and org entries include `extraction_method`; History shows Selected text, Readable article, Page fallback, or Selected area.
- `@mozilla/readability@0.6.0` and `jsdom@29.1.1` are pinned development dependencies. Node.js `20.19.0` or later is required. `npm install` runs `prepare:extension`, which copies Readability and its Apache-2.0 license into the ignored `extension/vendor/` directory. `npm run package:extension` always refreshes those files before zipping.
- The extension manifest still has only `activeTab`, `contextMenus`, `nativeMessaging`, `scripting`, and `storage`. No broad `host_permissions`, static all-sites content script, background fetch, or external capture service was added.
- The DOM fallback normalizer uses a conservative profile: it retains semantic text, lists, code, tables, and safe links while removing hidden nodes, controls, navigation, dialogs, high-link-density chrome, and page-noise containers. Element mode keeps the chosen root and only removes local control chrome.
- The Chrome Web Store implementation sequence, manual account/signing gates, and rollback rules are recorded in `CHROME_WEB_STORE_READINESS_PLAN.md`.

## Privacy and Security Boundary

The v0.5 design keeps the local-first boundary intact:

1. Page code is injected only after an explicit extension action or context-menu command, using the temporary `activeTab` grant.
2. Readability parses `document.cloneNode(true)`, so it does not mutate the visible page.
3. Element mode sends content only after the user confirms a highlighted target. Its short-lived request state is stored in `chrome.storage.session`, so Service Worker suspension cannot drop it; the background script accepts a result only when its random request ID, tab ID, main-frame ID, and expiry match.
4. Picker listeners and its style node are removed after confirmation, `Escape`, timeout, or replacement by a newer picker. It does not save DOM selectors, raw HTML, screenshots, or pages that were merely hovered.
5. Markdown conversion keeps only `http`, `https`, and `mailto` links. It drops unsafe URL schemes before local org output.
6. Source URLs lose credentials, fragments, tracking parameters, and sensitive query values before persistence or sync.
7. flomo accepts only official `https://flomoapp.com/iwh/...` webhooks. Notion tokens and flomo webhooks use the native Windows/macOS credential backend; there is no silent plaintext fallback.
8. External sinks require versioned consent in Settings. Both new clips and History retries are blocked from external sync without that consent; local save still succeeds.
9. `PRIVACY.md` documents collection, retention, deletion, external transfer, and the Limited Use commitment. The extension requests no persistent host permissions.
10. `npm run verify:store` inspects the final extension ZIP and rejects expanded permissions, remote code, private keys, native executables, launchers, and local config.
11. The Host status includes package and protocol versions. A fresh extension install opens onboarding once; missing and outdated Hosts share the version-aware setup path.
12. Target-native Host bundle packaging requires Node 20.19+ in the Node 20 line, embeds that runtime, copies only production dependencies, and rejects private or local files.

## Verified Locally

```powershell
npm test
npm run smoke
npm run smoke:sync:local
npm run doctor
npm run package:extension
npm run verify:store
git diff --check
```

Latest results:

- `npm test`: 56 passing tests, including capture quality, credential storage, malicious folder paths, URL redaction, flomo validation, sync consent, retry-sync consent, package policy, Host protocol, versioned downloads, and Host runtime policy.
- `npm run smoke` and `npm run smoke:sync:local`: passed with `extraction_method` preserved in capture records and org entries.
- `npm run doctor`: passed core checks. Chrome and Edge Native Messaging manifests are not registered on this machine, which is expected until setup is run.
- `npm run package:extension` and `npm run verify:store`: produced and verified the 24-file extension ZIP. It contains onboarding, Readability, and its license, but no private key, `.env`, native host manifest, launcher, executable, remote code, or expanded permission.
- Windows Host bundle: built with Node `20.19.0`, checked 450 files, and passed a real framed `status` request from its bundled runtime as Host `0.5.0`, protocol `1`. No dev dependency, fixture, private key, local config, or credential material was found. macOS bundle execution remains a CI/real-mac verification item.
- Onboarding: rendered at desktop and 375px widths with no horizontal overflow. Versioned installer links remain disabled for `0.5.x`, which has no signed installer, and become eligible at `0.6.0`.

## Required Before Release

1. Load the prepared `extension/` folder in a fresh Chrome profile. Run the Chrome host setup command if required, then verify:
   - Selection saves exact text.
   - Page saves an article through Readability.
   - A short/non-article page saves through fallback.
   - Element highlights a target, saves only the confirmed region, and `Escape` or timeout writes nothing.
2. Repeat the same checks in Edge. Browser internal pages, the Chrome Web Store, and cross-origin iframes should fail clearly rather than capture.
3. Rebuild the package after the final browser checks, run `npm run verify:store`, then publish the verified `0.5.0` GitHub Release if a standalone v0.5 release is still wanted.
4. For Chrome Web Store work, the user must create an unpublished dashboard item and return only its public Item ID and public key. Canonical identity migration cannot be implemented safely before that value exists.
5. Signed Windows `.exe` and notarized macOS `.pkg` installers still require the public Store ID plus the user's signing environments. Current Host ZIPs are verified installer inputs, not public end-user installers.
6. Replace all bracketed fields in `CHROME_WEB_STORE_LISTING.md`, generate screenshots from the final Store-ID build, and run trusted-tester review before Public submission.

## Non-Scope

- No all-sites permission, cloud crawler, screenshot capture, AI summary, or new sync sink.
- No migration is needed. Older capture records without `extraction_method` are displayed as `legacy_page` while new records write the explicit method.

## Worktree Note

`native-host/clipplane-host.cmd` still has a pre-existing line-ending-only worktree state. Keep it out of the v0.5 commit unless line-ending normalization is an explicit, separately reviewed change.
