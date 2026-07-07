# Clipplane

Clipplane is a local-first browser clipper. It captures the current page or selected text, sends it through a Native Messaging host, and appends a clean org-mode entry to `~/Documents/notes/inbox.org`.

Phase 1 deliberately keeps the product narrow:

- browser action and context-menu clipping
- local Native Messaging host
- `inbox.org` as the human-readable source of truth
- `.clipplane/captures.jsonl` as the machine-readable audit and retry log
- duplicate detection by content hash

flomo MCP and Apple Notes are planned sinks, not Phase 1 dependencies. Local save succeeds or fails independently of any external service.

## Reference Workflow

Clipplane Phase 1 follows the clipping workflow from [lijigang/ljg-skill-clip](https://github.com/lijigang/ljg-skill-clip): capture a URL or text selection, clean it into Markdown, convert it into org-mode, tag it, and append it to a local `inbox.org`. Clipplane turns that workflow into a browser-triggered local app while keeping the same local-first storage boundary.

## Layout

```text
extension/           Manifest V3 browser extension
native-host/         Native Messaging host and clip core
scripts/             install, uninstall, smoke, and doctor scripts
test/                node:test coverage for clip core and framing
```

## Develop

Run tests:

```powershell
pwsh -NoLogo -NoProfile -Command "npm test"
```

Run a local smoke clip without the browser:

```powershell
pwsh -NoLogo -NoProfile -Command "npm run smoke"
```

Run environment checks:

```powershell
pwsh -NoLogo -NoProfile -Command "npm run doctor"
```

## Load The Extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select the `extension` folder.
5. Copy the generated extension ID.

## Install The Native Host On Windows

Install for Chrome:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-native-host.ps1 -Browser chrome -ExtensionId "<extension-id>"
```

Install for Edge:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\install-native-host.ps1 -Browser edge -ExtensionId "<extension-id>"
```

The installer writes `native-host/com.clipplane.host.json` and registers it under the current user's Native Messaging registry key.

Uninstall:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\uninstall-native-host.ps1 -Browser chrome
```

## Data Files

By default Clipplane writes:

- `~/Documents/notes/inbox.org`
- `~/Documents/notes/.clipplane/captures.jsonl`

Override the notes directory with `CLIPPLANE_NOTES_DIR` before launching the native host or by editing the generated launcher.

## Current Scope

Clipplane does not watch the clipboard, does not upload data by default, and does not run analysis skills automatically. It only clips when the user explicitly clicks the extension action or context menu.
