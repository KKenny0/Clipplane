# Clipplane 高级配置

普通用户应优先通过 Settings 配置 Storage 和外部同步。本页记录源码调试、自定义扩展身份和配置文件格式。

## 环境变量

Settings 会写入本机应用配置文件。开发调试时也可以使用环境变量：

```powershell
$env:CLIPPLANE_NOTES_DIR = "D:\notes"
$env:CLIPPLANE_NOTION_TOKEN = "secret_xxx"
$env:CLIPPLANE_FLOMO_WEBHOOK_URL = "https://flomoapp.com/iwh/..."
```

浏览器启动的 Native Messaging Host 只能读取浏览器进程可见的环境变量，因此普通使用不建议依赖这条路径。

## 自定义扩展身份

开发自定义 manifest 时，可以手动覆盖 extension ID：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\setup-windows.ps1 -Browser chrome -ExtensionId "<extension-id>"
```

```bash
bash scripts/setup-macos.sh --browser chrome --extension-id "<extension-id>"
```

正式发行包和普通源码安装不需要手动填写 ID。

## 配置文件

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

Notion token 和 flomo webhook 不会写入这个文件。在支持的 Windows 和 macOS 上，它们进入操作系统凭据库；如果原生凭据后端不可用，外部同步保持关闭，不会退回明文存储。

## 本地导出

`local-export` 会把同步结果写到 `.clipplane/sinks/local-export/`，主要用于本地验证。Notion 使用官方 API 创建页面，flomo 使用 incoming webhook；两者都不依赖 MCP。
