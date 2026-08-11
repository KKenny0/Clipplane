param(
  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$hostRoot = $PSScriptRoot

if (Test-Path -LiteralPath $Destination) {
  throw "Refusing to overwrite uninstall cleanup staging: $Destination"
}

New-Item -ItemType Directory -Path $Destination | Out-Null
try {
  Copy-Item -LiteralPath (Join-Path $hostRoot "runtime") -Destination $Destination -Recurse
  Copy-Item -LiteralPath (Join-Path $hostRoot "app") -Destination $Destination -Recurse
  Copy-Item -LiteralPath (Join-Path $hostRoot "uninstall-host.ps1") -Destination $Destination
} catch {
  Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
