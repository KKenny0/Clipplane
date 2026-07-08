param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser,

  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"

function Resolve-ClipplaneExtensionId {
  param(
    [string]$ExtensionId,
    [Parameter(Mandatory = $true)]
    [string]$NodePath,
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  if ($ExtensionId) {
    return $ExtensionId
  }

  $identityScript = Join-Path $ProjectRoot "scripts\extension-identity.mjs"
  $resolved = & $NodePath $identityScript id
  if ($LASTEXITCODE -ne 0 -or -not $resolved) {
    throw "ExtensionId was not provided and the default Clipplane extension ID could not be resolved. Pass -ExtensionId for development builds."
  }

  return $resolved.Trim()
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$node = Get-Command node -ErrorAction Stop
$ExtensionId = Resolve-ClipplaneExtensionId -ExtensionId $ExtensionId -NodePath $node.Source -ProjectRoot $projectRoot

if ($ExtensionId -notmatch "^[a-p]{32}$") {
  throw "ExtensionId must be a 32-character Chrome extension ID using letters a-p."
}

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

$origin = "chrome-extension://$ExtensionId/"
if ($manifest.allowed_origins -notcontains $origin) {
  throw "Manifest does not allow extension origin: $origin"
}

Write-Host "PASS registry: $registryPath"
Write-Host "PASS manifest: $manifestPath"
Write-Host "PASS launcher: $($manifest.path)"
Write-Host "PASS node: $($node.Source)"
Write-Host "PASS allowed origin: chrome-extension://$ExtensionId/"
