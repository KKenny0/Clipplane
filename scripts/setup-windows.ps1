param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser,

  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,

  [string]$NotesDir
)

$ErrorActionPreference = "Stop"

if ($ExtensionId -notmatch "^[a-p]{32}$") {
  throw "ExtensionId must be a 32-character Chrome extension ID using letters a-p."
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$installScript = Join-Path $PSScriptRoot "install-native-host.ps1"
$checkScript = Join-Path $PSScriptRoot "check-native-host.ps1"

$node = Get-Command node -ErrorAction Stop
Write-Host "PASS node: $($node.Source)"

$installArgs = @{
  Browser = $Browser
  ExtensionId = $ExtensionId
}

if ($NotesDir) {
  $installArgs.NotesDir = $NotesDir
}

& $installScript @installArgs
& $checkScript -Browser $Browser -ExtensionId $ExtensionId

Write-Host ""
Write-Host "NEXT open your browser extension popup and make a first Save local clip."
Write-Host "NEXT open Settings to confirm the notes folder and optional sync targets."
Write-Host "NEXT run: pwsh -NoLogo -NoProfile -Command `"npm run doctor`""
