param(
  [ValidateSet("chrome", "edge", "all")]
  [string]$Browser = "all"
)

$ErrorActionPreference = "Stop"
$hostRoot = $PSScriptRoot
$launcherPath = Join-Path $hostRoot "clipplane-host.cmd"
$originsPath = Join-Path $hostRoot "allowed-origins.json"
$manifestPath = Join-Path $hostRoot "com.clipplane.host.json"

if (-not (Test-Path -LiteralPath $launcherPath) -or -not (Test-Path -LiteralPath $originsPath)) {
  throw "Clipplane Host bundle is incomplete. Reinstall the signed package."
}

$origins = (Get-Content -LiteralPath $originsPath -Raw | ConvertFrom-Json).allowed_origins
$manifest = [ordered]@{
  name = "com.clipplane.host"
  description = "Clipplane Native Messaging Host"
  path = $launcherPath
  type = "stdio"
  allowed_origins = @($origins)
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$registryPaths = [ordered]@{
  chrome = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host"
  edge = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host"
}
$browsers = if ($Browser -eq "all") { @("chrome", "edge") } else { @($Browser) }
foreach ($name in $browsers) {
  New-Item -Path $registryPaths[$name] -Force | Out-Null
  Set-Item -Path $registryPaths[$name] -Value $manifestPath
  if ((Get-Item -LiteralPath $registryPaths[$name]).GetValue("") -ne $manifestPath) {
    throw "Clipplane Host registration verification failed for $name."
  }
  Write-Host "Registered Clipplane Host for $name"
}

Write-Host "Restart every browser window, then use Check again in Clipplane."
