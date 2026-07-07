param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser
)

$ErrorActionPreference = "Stop"

$registryPath = if ($Browser -eq "chrome") {
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host"
} else {
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host"
}

if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Recurse -Force
  Write-Host "Uninstalled Clipplane native host for $Browser"
} else {
  Write-Host "Clipplane native host was not registered for $Browser"
}
