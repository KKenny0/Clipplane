param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser,

  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,

  [string]$NotesDir
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$hostDir = Join-Path $projectRoot "native-host"
$launcherPath = Join-Path $hostDir "clipplane-host.cmd"
$manifestPath = Join-Path $hostDir "com.clipplane.host.json"
$nodePath = (Get-Command node -ErrorAction Stop).Source

$envLine = if ($NotesDir) { "set `"CLIPPLANE_NOTES_DIR=$NotesDir`"" } else { "rem CLIPPLANE_NOTES_DIR not set" }
$launcher = @"
@echo off
setlocal
$envLine
set "SCRIPT_DIR=%~dp0"
"$nodePath" "%SCRIPT_DIR%host.mjs"
"@
Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding ASCII

$manifest = [ordered]@{
  name = "com.clipplane.host"
  description = "Clipplane Native Messaging Host"
  path = $launcherPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$registryPath = if ($Browser -eq "chrome") {
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host"
} else {
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host"
}

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Installed Clipplane native host for $Browser"
Write-Host "Manifest: $manifestPath"
