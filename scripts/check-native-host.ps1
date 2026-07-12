param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser,

  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"

function Resolve-ClipplaneExtensionIds {
  param(
    [string]$ExtensionId,
    [Parameter(Mandatory = $true)]
    [string]$NodePath,
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  if ($ExtensionId) {
    return @($ExtensionId)
  }

  $originsScript = Join-Path $ProjectRoot "scripts\native-host-origins.mjs"
  $resolved = @(& $NodePath $originsScript ids)
  if ($LASTEXITCODE -ne 0 -or -not $resolved) {
    throw "ExtensionId was not provided and Clipplane extension IDs could not be resolved. Pass -ExtensionId for development builds."
  }

  return @($resolved | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$node = Get-Command node -ErrorAction Stop
$ExtensionIds = @(Resolve-ClipplaneExtensionIds -ExtensionId $ExtensionId -NodePath $node.Source -ProjectRoot $projectRoot)

foreach ($ResolvedExtensionId in $ExtensionIds) {
  if ($ResolvedExtensionId -notmatch "^[a-p]{32}$") {
    throw "ExtensionId must be a 32-character Chrome extension ID using letters a-p."
  }
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

$expectedOrigins = @($ExtensionIds | ForEach-Object { "chrome-extension://$_/" } | Sort-Object)
$actualOrigins = @($manifest.allowed_origins | Sort-Object)
if (Compare-Object -ReferenceObject $expectedOrigins -DifferenceObject $actualOrigins) {
  throw "Native host allowed origins mismatch. Expected $($expectedOrigins -join ', '); got $($actualOrigins -join ', ')"
}

Write-Host "PASS registry: $registryPath"
Write-Host "PASS manifest: $manifestPath"
Write-Host "PASS launcher: $($manifest.path)"
Write-Host "PASS node: $($node.Source)"
Write-Host "PASS allowed origins: $($actualOrigins -join ', ')"
