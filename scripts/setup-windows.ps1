param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser,

  [string]$ExtensionId,

  [string]$NotesDir
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$installScript = Join-Path $PSScriptRoot "install-native-host.ps1"
$checkScript = Join-Path $PSScriptRoot "check-native-host.ps1"

$node = Get-Command node -ErrorAction Stop
$nodeVersionText = (& $node.Source --version).Trim().TrimStart("v")
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion.Major -ne 24 -or $nodeVersion -lt [version]"24.13.0") {
  throw "Clipplane source setup requires Node.js >=24.13.0 <25. Found $nodeVersionText at $($node.Source). Install Node 24 or use the packaged Host."
}
Write-Host "PASS node ${nodeVersionText}: $($node.Source)"

if ($ExtensionId -and $ExtensionId -notmatch "^[a-p]{32}$") {
  throw "ExtensionId must be a 32-character Chrome extension ID using letters a-p."
}

$installArgs = @{
  Browser = $Browser
}
$checkArgs = @{
  Browser = $Browser
}

if ($ExtensionId) {
  $installArgs.ExtensionId = $ExtensionId
  $checkArgs.ExtensionId = $ExtensionId
}

if ($NotesDir) {
  $installArgs.NotesDir = $NotesDir
}

& $installScript @installArgs
& $checkScript @checkArgs

Write-Host ""
Write-Host "NEXT open your browser extension popup and make a first Save local clip."
Write-Host "NEXT open Settings to confirm the notes folder and optional sync targets."
Write-Host "NEXT run: pwsh -NoLogo -NoProfile -Command `"npm run doctor`""
