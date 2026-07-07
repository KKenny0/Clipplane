param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser,

  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"

$registryPath = if ($Browser -eq "chrome") {
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host"
} else {
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host"
}

if (-not (Test-Path -LiteralPath $registryPath)) {
  throw "Native host registry key is missing: $registryPath"
}

$manifestPath = (Get-Item -LiteralPath $registryPath).GetValue("")
if (-not $manifestPath) {
  throw "Native host registry key has no default manifest path: $registryPath"
}

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Native host manifest does not exist: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.name -ne "com.clipplane.host") {
  throw "Unexpected native host name: $($manifest.name)"
}

if ($manifest.type -ne "stdio") {
  throw "Unexpected native host type: $($manifest.type)"
}

if (-not (Test-Path -LiteralPath $manifest.path)) {
  throw "Native host launcher does not exist: $($manifest.path)"
}

if ($ExtensionId) {
  $origin = "chrome-extension://$ExtensionId/"
  if ($manifest.allowed_origins -notcontains $origin) {
    throw "Manifest does not allow extension origin: $origin"
  }
}

$node = Get-Command node -ErrorAction Stop

Write-Host "PASS registry: $registryPath"
Write-Host "PASS manifest: $manifestPath"
Write-Host "PASS launcher: $($manifest.path)"
Write-Host "PASS node: $($node.Source)"
if ($ExtensionId) {
  Write-Host "PASS allowed origin: chrome-extension://$ExtensionId/"
}
