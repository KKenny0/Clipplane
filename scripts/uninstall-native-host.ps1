param(
  [ValidateSet("chrome", "edge", "all")]
  [string]$Browser = "all",

  [switch]$PreserveCredentials,

  [string]$HostRoot
)

$ErrorActionPreference = "Stop"

$registryPaths = [ordered]@{
  chrome = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host"
  edge = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host"
}

$browsers = if ($Browser -eq "all") { @("chrome", "edge") } else { @($Browser) }
foreach ($name in $browsers) {
  $registryPath = $registryPaths[$name]
  if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force
    Write-Host "Removed Clipplane Host registration for $name"
  } else {
    Write-Host "Clipplane Host was not registered for $name"
  }
}

if (-not $PreserveCredentials) {
  $root = if ($HostRoot) {
    (Resolve-Path -LiteralPath $HostRoot).Path
  } elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot "app\native-host\credential-maintenance.mjs")) {
    $PSScriptRoot
  } else {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  }
  $bundledNode = Join-Path $root "runtime\node.exe"
  $nodePath = if (Test-Path -LiteralPath $bundledNode) {
    $bundledNode
  } else {
    (Get-Command node -ErrorAction Stop).Source
  }
  $maintenance = if (Test-Path -LiteralPath (Join-Path $root "app\native-host\credential-maintenance.mjs")) {
    Join-Path $root "app\native-host\credential-maintenance.mjs"
  } else {
    Join-Path $root "native-host\credential-maintenance.mjs"
  }
  & $nodePath $maintenance
  if ($LASTEXITCODE -ne 0) {
    throw "Clipplane Host registrations were removed, but credentials could not be deleted. Local notes were not changed."
  }
}

Write-Host "Clipplane Host uninstall complete. Local notes were preserved."
