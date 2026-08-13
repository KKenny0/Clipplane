# Clipplane 发布与信任链

本页面向维护者，记录扩展包、Native Messaging Host 和安装器的发布约束。普通安装流程见项目 [README](../README.md)。

## 当前发行边界

稳定版 `0.8.0` 使用 Host 协议 3，活动 Inbox 为 Markdown。

- GitHub Release 的 `clipplane-extension-v0.8.0.zip` 保留公开身份 key，canonical extension ID 为 `emacefnmbogjdcblglmipolnickjnmbl`。
- macOS arm64 的 Host `0.8.0` 包已经签名、公证并 stapled。immutable `v0.8.0` release 固定 SHA-256 `1f714c…9521c` 和 Apple Team ID `S7V7CK2G9T`。
- Windows 没有公开二进制安装器，普通用户从 README 中记录的完整 commit SHA 安装。
- Chrome Web Store 和 Edge Add-ons 尚未上架。

Chrome Native Messaging 要求 Host 明确列出允许访问它的扩展来源，不能使用通配符。`manifest.key` 是 Chrome Web Store 提供的公开身份 key，不是签名私钥。仓库不得保存 `.pem` 或其他私钥文件。

setup 在迁移期同时允许 canonical Store ID 和旧 GitHub dev-preview ID。Store 上传包必须从 staging manifest 移除 `key`，本地候选包则保留它，以维持固定扩展身份。

## 扩展包

```powershell
npm run package:extension
npm run verify:extension
npm run package:store
npm run verify:store
```

`package:extension` 生成用于 GitHub Release 和本地候选测试的 `dist/clipplane-extension-vX.zip`。`verify:extension` 检查文件清单、安全边界和固定身份 key。

`package:store` 生成 `dist/clipplane-store-vX.zip`，只在 staging 副本中移除 `key`。`verify:store` 拒绝身份 key、私钥、`.env*`、Native Host 文件、可执行文件、远程代码和权限扩张。两个 ZIP 都只能包含浏览器扩展。

打包前会从锁定版本的 `@mozilla/readability` 准备正文提取器和 Apache-2.0 许可证。

## Host 资产

公开 Host 下载记录必须固定 release tag、asset 名、Host 版本、SHA-256 和平台签名身份：

```powershell
npm run verify:host:release
```

Windows 源码安装固定完整 commit SHA，不依赖可移动 tag。在 Node 24.13 或更高的 Node 24 版本下，下面的命令会生成包含固定 Node runtime 和生产依赖的原生 Host bundle：

```powershell
npm run package:host:windows
npm run package:host:macos
```

CI 会分别重建并启动两端 bundle。ZIP bundle 是安装器输入，macOS 给普通用户的资产是签名并公证的 `.pkg`。

## Windows 安装器

私有 unsigned candidate 必须按下面的顺序构建和验证：

```powershell
npm run package:host:windows
node scripts/smoke-native-host-bundle.mjs --target windows
npm run package:host:windows:installer:candidate
npm run smoke:host:windows:installer
```

Unsigned candidate 只能消费前面已经 smoke 通过的 bundle，不能作为公开下载资产。

正式签名命令 `npm run package:host:windows:installer` 会拒绝 dirty source，重新执行 `npm ci`、bundle build 和 bundle smoke，再签名并验证同一份内容。它需要以下环境变量：

- `CLIPPLANE_INNO_SETUP_COMPILER`
- `CLIPPLANE_WINDOWS_SIGNTOOL`
- `CLIPPLANE_WINDOWS_CERT_SUBJECT`
- `CLIPPLANE_WINDOWS_TIMESTAMP_URL`

最终资产需要单独验收：

```powershell
pwsh -File scripts/smoke-native-host-windows-installer.ps1 -InstallerPath <signed.exe>
```

Installer smoke 会修改当前用户的安装目录和 Chrome、Edge HKCU 注册。只能在 GitHub Actions、一次性 Windows VM 或专用测试用户中运行。它通过 `/PRESERVECREDENTIALS` 保留已有 Notion 和 flomo 凭据，但仍不是普通开发机上的无副作用检查。

## macOS 源码调试

源码安装只用于维护者调试：

```bash
bash scripts/setup-macos.sh --browser chrome
bash scripts/setup-macos.sh --browser edge
```

正式用户应安装 immutable Release 中经过签名、公证和 stapled 的 `.pkg`。
