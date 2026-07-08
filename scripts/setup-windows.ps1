param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chrome", "edge")]
  [string]$Browser,

  [string]$ExtensionId,

  [string]$NotesDir
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
$installScript = Join-Path $PSScriptRoot "install-native-host.ps1"
$checkScript = Join-Path $PSScriptRoot "check-native-host.ps1"

$node = Get-Command node -ErrorAction Stop
Write-Host "PASS node: $($node.Source)"

$ExtensionId = Resolve-ClipplaneExtensionId -ExtensionId $ExtensionId -NodePath $node.Source -ProjectRoot $projectRoot

if ($ExtensionId -notmatch "^[a-p]{32}$") {
  throw "ExtensionId must be a 32-character Chrome extension ID using letters a-p."
}

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
