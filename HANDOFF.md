# Clipplane v0.4 Handoff

This handoff is for the next session. It assumes the repo is at `D:\VibeProject\product\Clipplane` and the current implementation is the `v0.4.0` fixed-ID dev preview.

## Current State

- Product: local-first browser clipper. The extension captures a page or selection, the Native Messaging host writes to local `inbox.org`, and optional sinks sync to Notion or flomo.
- Main storage path: `~/Documents/notes/inbox.org`, plus `.clipplane/captures.jsonl` and `.clipplane/captures/<capture-id>.md`.
- External sync: direct Notion API and flomo incoming webhook API. MCP and Agent CLI are not required for clipping or sync.
- Extension distribution: GitHub Release provides `dist/clipplane-extension-vX.zip` for manual `Load unpacked`; v0.4 uses the stable extension ID `mhgcfphfcgbgabhbegdonadkedfaddhc`.
- Host setup: users run platform setup scripts with only `-Browser` / `--browser`; manual `ExtensionId` remains an advanced development override.
- Privacy boundary: the repo stores only the public `manifest.key`. No `.pem` or signing private key is stored in the repo or required for the GitHub zip flow.
- Current verification: `npm test`, `npm run smoke`, `npm run smoke:sync:local`, `npm run doctor`, `npm run package:extension`, zip-sensitive-file inspection, PowerShell parser checks, and `git diff --check` passed locally.

## First Principles

Clipplane has one unavoidable trust boundary: a browser extension cannot write local notes directly. It must call a Native Messaging host, and Chrome Native Messaging requires that host manifest to list exact extension origins in `allowed_origins`.

The current first-run friction exists because unpacked extensions without a manifest key get a browser-generated ID. That forces the user to copy the ID into setup. The right v0.4 target is not "store distribution"; it is "stable extension origin plus clear host activation."

Chrome's `manifest.key` is a public key field used to keep a consistent extension ID when an extension is loaded during development. It is not the private signing key. Therefore Clipplane can ship a fixed-ID GitHub Release package without publishing private signing material and without depending on a paid Chrome Web Store account.

Implementation note: v0.4 generated the committed public manifest key in memory and did not write a private key file. If a future maintainer wants CRX signing with the same identity, they need a separately managed signing key process; the current GitHub zip flow does not require one.

## Recommended Next Work

Build v0.4 around fixed-ID GitHub distribution and first-run activation, not another sync sink and not Chrome Web Store publication.

Code implementation is complete. Remaining release work is manual browser loading verification in Chrome and Edge, screenshot refresh if needed, and GitHub Release publication.

Success means a new user can:

1. Download the extension package from GitHub Releases.
2. Load the unpacked extension in Chrome or Edge and get the documented Clipplane extension ID.
3. Run one local host setup command for their browser without copying an extension ID.
4. Open the extension and see a clear host status.
5. Save a page locally without editing environment variables, launcher files, or Native Messaging manifests.

Edge Add-ons is a useful optional follow-up because Microsoft does not charge a registration fee for Edge extension submission. Chrome Web Store should stay out of v0.4 unless the maintainer explicitly decides the one-time fee, review workflow, listing assets, privacy declarations, and ongoing store maintenance are worth it.

Apple Notes should stay out of this v0.4 slice. It is useful for Mac users, but it is a new sink and does not solve the biggest activation problem for both Mac and Windows users.

## Non-Scope

- Do not require Chrome Web Store publication for v0.4.
- Do not add Agent CLI, Claude Code, Codex CLI, or MCP as a required runtime.
- Do not add Apple Notes in this v0.4 activation slice.
- Do not make external sync automatic by default.
- Do not publish signing private keys, `.pem` files, or extension private keys into the repo.
- Do not replace the local-first storage model.
- Do not build a native desktop installer in this slice.

## Phase 1: Fixed Extension Identity

Goal: make the GitHub Release extension package load with a stable Clipplane extension ID in Chrome and Edge.

Files to inspect and edit:

- `extension/manifest.json`
- `scripts/package-extension.mjs`
- `README.md`
- `README.en.md`
- `.gitignore`

Chosen approach:

- Generate one Clipplane public manifest key without committing or retaining private signing material.
- Commit only the public key value in `extension/manifest.json` as the `key` field.
- Ensure `.gitignore` excludes extension signing key material such as `*.pem`, even though the current GitHub zip flow does not require a private key file.
- Record the resulting stable extension ID in README and in the setup scripts during Phase 2.

Implementation steps:

1. Generate the public manifest key without writing private signing material to the repo.
2. Add the public key to `extension/manifest.json` as `key`.
3. Derive and test the stable extension ID from that public key.
4. Load `extension/` unpacked in Chrome and Edge and confirm both browsers show the documented extension ID.
5. Update `scripts/package-extension.mjs` so release zips include `manifest.json` with `key` and exclude private key material, generated local host files, local configs, and secrets.
6. Update `.gitignore` to exclude extension private key files if it does not already.
7. Update README install docs to say the GitHub package has a stable extension ID.

Acceptance checks:

- `npm test`
- `npm run package:extension`
- Inspect the generated `dist/clipplane-extension-vX.zip` and confirm it contains extension files plus `manifest.json` with `key`, and no `.pem`, local config, Native Messaging manifest, or secret files.
- Load the packaged extension manually in Chrome and Edge and confirm both browsers show the documented stable extension ID.
- Confirm popup, settings, context menu, `Save local`, and host error state still render.

Rollback:

- Remove the `key` field from `extension/manifest.json`, revert package/doc changes, and return to the current manual-ID setup flow. No local user data is touched.

## Phase 2: Default Stable ID in Host Setup

Goal: remove the extension ID from the normal setup path while retaining manual ID override for development and troubleshooting.

Files to inspect and edit:

- `scripts/setup-windows.ps1`
- `scripts/setup-macos.sh`
- `scripts/install-native-host.ps1`
- `scripts/check-native-host.ps1`
- `scripts/check-native-host-macos.sh`
- `scripts/doctor.mjs`
- `README.md`
- `README.en.md`

Chosen approach:

- Add the stable Clipplane extension ID from Phase 1 as the default for Chrome and Edge host setup.
- Keep `-ExtensionId` and `--extension-id` as developer overrides.
- Make setup commands for normal users browser-only:
  - Windows Chrome: `pwsh -NoLogo -NoProfile -File .\scripts\setup-windows.ps1 -Browser chrome`
  - Windows Edge: `pwsh -NoLogo -NoProfile -File .\scripts\setup-windows.ps1 -Browser edge`
  - macOS Chrome: `bash scripts/setup-macos.sh --browser chrome`
  - macOS Edge: `bash scripts/setup-macos.sh --browser edge`

Implementation steps:

1. In `scripts/setup-windows.ps1`, make `ExtensionId` optional.
2. Add a helper that resolves the default Clipplane extension ID from `Browser`.
3. If no default ID exists for a browser, fail with a clear message asking for `-ExtensionId`.
4. In `scripts/setup-macos.sh`, make `--extension-id` optional with the same default-ID behavior.
5. Update native host check scripts so default IDs can be used for normal checks.
6. Update `scripts/doctor.mjs` next-step messages to prefer the no-ID command.
7. Keep manual unpacked-extension ID override docs under an advanced/development section.

Rejected alternative:

- Do not require Chrome Web Store just to get a stable ID. It adds account cost and review maintenance while not solving any capability that `manifest.key` cannot solve for GitHub Release users.

Acceptance checks:

- `npm test`
- `npm run doctor`
- Windows Chrome: run setup without `-ExtensionId`, then `npm run doctor:native:chrome`.
- Windows Edge: run setup without `-ExtensionId`, then `npm run doctor:native:edge`.
- macOS Chrome and Edge checks need a Mac runner or manual Mac verification.
- Development override still works with a manually loaded extension ID.

Rollback:

- Revert setup/check/doctor script changes. If a user already installed a manifest with a bad ID, rerun the previous setup command with the correct `ExtensionId`.

## Phase 3: First-Run Activation UX

Goal: make host availability and next action obvious from the extension itself.

Files to inspect and edit:

- `extension/popup.html`
- `extension/popup.css`
- `extension/popup.js`
- `extension/settings.html`
- `extension/settings.css`
- `extension/settings.js`
- `extension/src/background.js`
- `native-host/host.mjs`
- `native-host/settings-core.mjs`
- `test/native-message.test.mjs`
- `test/settings-core.test.mjs`

Implementation steps:

1. On popup load, call the existing `status` native message and classify the result:
   - host reachable
   - host unavailable
   - sink not configured
2. When host is unavailable, show one compact action area:
   - "Install local host"
   - "Open setup guide"
   - "Retry"
3. Show setup commands that match the detected browser when possible, and keep the full guide available when detection is uncertain.
4. The action may open a local setup guide or README section. It should not pretend the extension can register Native Messaging by itself, because browser extensions cannot write registry entries or Native Messaging manifests.
5. In settings, keep `Open Folder`, storage directory, and sink settings available only after host reachability is known.
6. Keep the UI cross-platform: Windows and macOS copy should show the matching setup command, and Linux should remain unsupported unless implemented.

Acceptance checks:

- Host installed: popup shows ready state and `Save local` works.
- Host not installed: popup shows setup actions and does not crash.
- Wrong extension ID: popup shows actionable host unavailable state.
- Settings page still loads existing config and `Open Folder` can be invoked repeatedly.
- `npm test`
- `npm run smoke`

Rollback:

- Revert extension UI changes. No local data migration is involved.

## Phase 4: Release Packaging and Docs

Goal: publish v0.4 with README and release artifacts that match the GitHub-first fixed-ID install path.

Files to inspect and edit:

- `package.json`
- `extension/manifest.json`
- `README.md`
- `README.en.md`
- `assets/screenshots/*`
- `dist/*`

Implementation steps:

1. Bump `package.json` and `extension/manifest.json` to `0.4.0`.
2. Regenerate extension package with `npm run package:extension`.
3. Update README current status:
   - GitHub Release package as the primary install path.
   - Stable extension ID and host setup commands without extension ID for normal users.
   - Manual `-ExtensionId` / `--extension-id` override as advanced/development fallback.
   - Edge Add-ons as an optional future distribution path.
   - Chrome Web Store as a future paid-maintainer choice, not a v0.4 dependency.
4. Update screenshots if first-run UI changes materially.
5. Create a GitHub Release with the extension zip and a note that the native host still comes from source package or future installer.

Verification commands:

```powershell
npm test
npm run smoke
npm run smoke:sync:local
npm run doctor
npm run package:extension
git diff --check
```

Manual acceptance:

- Fresh Chrome profile, no previous Clipplane host registration: loaded GitHub extension shows the documented stable ID and host setup state.
- Fresh Edge profile, no previous Clipplane host registration: loaded GitHub extension shows the same documented stable ID and host setup state.
- After host setup: `Save local` writes to `~/Documents/notes/inbox.org`.
- Existing user with config file: settings still read the configured notes directory and sink status.
- Notion and flomo remain opt-in.

Release follow-through:

- Commit with a focused message such as `feat: streamline fixed-id host setup`.
- Tag and release `v0.4.0` after manual install checks pass.
- Update GitHub About description if the install story changes.

Rollback:

- Delete or supersede the GitHub Release if the package is broken.
- Re-run host setup with the previous known-good extension ID if users installed a bad native manifest.
- Local notes data does not need migration or rollback.

## Optional Store Follow-Up

This plan does not depend on store IDs.

Edge Add-ons can be considered after v0.4 because it provides a store install and auto-update path without a registration fee. If pursued, add Edge listing assets, privacy declarations, and review notes as a separate release task.

Chrome Web Store should be considered only if the maintainer accepts the one-time developer registration fee and the ongoing review/listing burden. It is not required for Clipplane's fixed-ID GitHub distribution.

## Suggested Commit Boundaries

1. `docs: update v0.4 activation handoff`
2. `chore: add stable extension identity`
3. `feat: default host setup to stable extension id`
4. `feat: improve first-run host activation UI`
5. `docs: update fixed-id install flow`
6. `chore: release v0.4.0`

Each commit should leave `npm test` passing. Phases 1, 2, and 3 should be mergeable independently.
