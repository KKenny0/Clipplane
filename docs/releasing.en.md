# Clipplane release and trust chain

This maintainer document records the release constraints for the browser extension, Native Messaging Host, and installers. See the project [README](../README.en.md) for normal installation.

## Current distribution boundary

Stable release `0.8.0` uses Host protocol 3 and a Markdown active Inbox.

- The GitHub Release asset `clipplane-extension-v0.8.0.zip` keeps the public identity key and canonical extension ID `emacefnmbogjdcblglmipolnickjnmbl`.
- The macOS arm64 Host `0.8.0` package is signed, notarized, and stapled. The immutable `v0.8.0` release pins SHA-256 `1f714c…9521c` and Apple Team ID `S7V7CK2G9T`.
- Windows has no public binary installer. Users install from the full commit SHA documented in the README.
- Clipplane is not yet available through Chrome Web Store or Edge Add-ons.

Chrome Native Messaging requires the Host to list every allowed extension origin explicitly. Wildcards are not allowed. `manifest.key` is the public identity key provided by Chrome Web Store, not a signing private key. The repository must not contain `.pem` files or other private keys.

During migration, setup allows both the canonical Store ID and the legacy GitHub dev-preview ID. Store upload packages remove `key` from the staging manifest, while local candidate packages keep it to preserve a stable extension identity.

## Extension packages

```powershell
npm run package:extension
npm run verify:extension
npm run package:store
npm run verify:store
```

`package:extension` writes `dist/clipplane-extension-vX.zip` for GitHub Releases and local candidate testing. `verify:extension` checks the file inventory, safety boundary, and fixed identity key.

`package:store` writes `dist/clipplane-store-vX.zip` and removes `key` only from the staging copy. `verify:store` rejects identity keys, private keys, `.env*`, Native Host files, executables, remote code, and permission expansion. Both ZIPs must contain only the browser extension.

Packaging prepares the pinned `@mozilla/readability` extractor and its Apache-2.0 license before building either archive.

## Host assets

Every public Host download record must pin the release tag, asset name, Host version, SHA-256 digest, and platform signing identity:

```powershell
npm run verify:host:release
```

Windows source installation pins a full commit SHA instead of trusting a movable tag. On Node 24.13 or later in the Node 24 line, these commands create native Host bundles with a fixed Node runtime and production dependencies:

```powershell
npm run package:host:windows
npm run package:host:macos
```

CI rebuilds and launches both bundles. ZIP bundles are installer inputs. The macOS end-user asset is the signed and notarized `.pkg`.

## Windows installer

Build and verify a private unsigned candidate in this order:

```powershell
npm run package:host:windows
node scripts/smoke-native-host-bundle.mjs --target windows
npm run package:host:windows:installer:candidate
npm run smoke:host:windows:installer
```

Unsigned candidate packaging may consume only the bundle that passed the preceding smoke test. An unsigned candidate must never become a public download.

The public signing command, `npm run package:host:windows:installer`, refuses dirty source and reruns `npm ci`, the bundle build, and the bundle smoke before signing and verifying the same content. It requires these environment variables:

- `CLIPPLANE_INNO_SETUP_COMPILER`
- `CLIPPLANE_WINDOWS_SIGNTOOL`
- `CLIPPLANE_WINDOWS_CERT_SUBJECT`
- `CLIPPLANE_WINDOWS_TIMESTAMP_URL`

Verify the final asset itself:

```powershell
pwsh -File scripts/smoke-native-host-windows-installer.ps1 -InstallerPath <signed.exe>
```

The installer smoke changes the current user's install directory and Chrome and Edge HKCU registrations. Run it only in GitHub Actions, a disposable Windows VM, or a dedicated test account. It preserves existing Notion and flomo credentials with `/PRESERVECREDENTIALS`, but it is not a side-effect-free developer-machine check.

## macOS source debugging

Source installation is for maintainer debugging only:

```bash
bash scripts/setup-macos.sh --browser chrome
bash scripts/setup-macos.sh --browser edge
```

End users should install the signed, notarized, and stapled `.pkg` from the immutable Release.
