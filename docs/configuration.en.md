# Clipplane advanced configuration

Most users should configure Storage and external sync through Settings. This page covers source debugging, custom extension identities, and the config file format.

## Environment variables

Settings writes the local application config file. Development sessions can also use environment variables:

```powershell
$env:CLIPPLANE_NOTES_DIR = "D:\notes"
$env:CLIPPLANE_NOTION_TOKEN = "secret_xxx"
$env:CLIPPLANE_FLOMO_WEBHOOK_URL = "https://flomoapp.com/iwh/..."
```

A browser-launched Native Messaging Host sees only environment variables available to the browser process. This is not the recommended configuration path for normal use.

## Custom extension identity

Development with a custom manifest can override the extension ID:

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\setup-windows.ps1 -Browser chrome -ExtensionId "<extension-id>"
```

```bash
bash scripts/setup-macos.sh --browser chrome --extension-id "<extension-id>"
```

Official packages and normal source installations do not need a manual ID.

## Config file

```json
{
  "storage": {
    "notesDir": "D:\\notes"
  },
  "sync": {
    "defaultSinks": ["notion-api"]
  },
  "sinks": {
    "notion-api": {
      "enabled": true,
      "parentType": "page",
      "parentId": "NOTION_PAGE_ID"
    },
    "flomo-api": {
      "enabled": false,
      "tags": ["clipplane"]
    },
    "local-export": {
      "enabled": false
    }
  }
}
```

The Notion token and flomo webhook are intentionally absent from this file. On supported Windows and macOS systems, they are stored in the operating system credential store. External sync stays disabled when the native credential backend is unavailable instead of falling back to plaintext.

## Local export

`local-export` writes sync results under `.clipplane/sinks/local-export/` and is mainly intended for local verification. Notion uses its official API and flomo uses an incoming webhook. Neither integration depends on MCP.
