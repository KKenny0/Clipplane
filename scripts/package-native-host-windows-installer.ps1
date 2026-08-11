param(
  [switch]$AllowUnsigned,
  [string]$IsccPath = $env:CLIPPLANE_INNO_SETUP_COMPILER,
  [string]$SignToolPath = $env:CLIPPLANE_WINDOWS_SIGNTOOL,
  [string]$CertificateSubject = $env:CLIPPLANE_WINDOWS_CERT_SUBJECT,
  [string]$TimestampUrl = $env:CLIPPLANE_WINDOWS_TIMESTAMP_URL
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$package = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$bundleDir = Join-Path $projectRoot "dist\clipplane-host-v$version-windows-x64"
$distDir = Join-Path $projectRoot "dist"
$publicBaseName = "clipplane-host-v$version-windows-x64"
$outputBaseName = if ($AllowUnsigned) { "$publicBaseName-unsigned" } else { "$publicBaseName-candidate" }
$installerPath = Join-Path $distDir "$outputBaseName.exe"
$publicInstallerPath = Join-Path $distDir "$publicBaseName.exe"
$scriptPath = Join-Path $projectRoot "installer\windows\clipplane-host.iss"
$isccArgs = @(
  "/DHostVersion=$version",
  "/DBundleDir=$bundleDir",
  "/DOutputDir=$distDir",
  "/DOutputBaseName=$outputBaseName"
)

if (-not $IsccPath) {
  $IsccPath = @(
    (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source,
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
if (-not (Test-Path -LiteralPath $IsccPath)) {
  throw "Inno Setup Compiler was not found: $IsccPath"
}

if (-not $AllowUnsigned) {
  $sourceHead = (& git -C $projectRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sourceHead) {
    throw "The signed Windows installer must be built from a Git commit."
  }
  $sourceChanges = @(& git -C $projectRoot status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0 -or $sourceChanges.Count -ne 0) {
    throw "The signed Windows installer must be built from clean, committed source."
  }
  $ignoredHostInputs = @(& git -C $projectRoot ls-files --others --ignored --exclude-standard -- native-host)
  if ($LASTEXITCODE -ne 0 -or $ignoredHostInputs.Count -ne 0) {
    throw "The signed Windows installer refuses ignored files under native-host."
  }
  if (Test-Path -LiteralPath $publicInstallerPath) {
    throw "Refusing to overwrite an existing public installer: $publicInstallerPath"
  }
  foreach ($setting in @{
    "CLIPPLANE_WINDOWS_SIGNTOOL" = $SignToolPath
    "CLIPPLANE_WINDOWS_CERT_SUBJECT" = $CertificateSubject
    "CLIPPLANE_WINDOWS_TIMESTAMP_URL" = $TimestampUrl
  }.GetEnumerator()) {
    if (-not $setting.Value) {
      throw "Set $($setting.Key) to produce a signed public installer. Use -AllowUnsigned only for private testing."
    }
  }
  if (-not (Test-Path -LiteralPath $SignToolPath)) {
    throw "SignTool was not found: $SignToolPath"
  }
  $innoSignTool = '$q' + $SignToolPath + '$q sign /fd SHA256 /tr ' + $TimestampUrl + ' /td SHA256 /n $q' + $CertificateSubject + '$q $f'
  $isccArgs += "/Sclipplane=$innoSignTool"
  $isccArgs += "/DSignToolName=clipplane"

  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed before the signed Windows Host build."
  }
  & npm.cmd run package:host:windows
  if ($LASTEXITCODE -ne 0) {
    throw "Windows Host bundle packaging failed."
  }
  & node.exe (Join-Path $projectRoot "scripts\smoke-native-host-bundle.mjs") --target windows --bundle $bundleDir
  if ($LASTEXITCODE -ne 0) {
    throw "Windows Host bundle smoke failed."
  }
}

foreach ($required in @(
  (Join-Path $bundleDir "clipplane-host.cmd"),
  (Join-Path $bundleDir "install-host.ps1"),
    (Join-Path $bundleDir "uninstall-host.ps1"),
    (Join-Path $bundleDir "stage-uninstall-cleanup.ps1"),
  (Join-Path $bundleDir "allowed-origins.json"),
  (Join-Path $bundleDir "runtime\node.exe"),
  (Join-Path $bundleDir "app\native-host\host.mjs"),
  (Join-Path $bundleDir "app\native-host\credential-maintenance.mjs")
)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Windows Host bundle is incomplete: $required"
  }
}

function Get-BundleDigest {
  $entries = Get-ChildItem -LiteralPath $bundleDir -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relativePath = [System.IO.Path]::GetRelativePath($bundleDir, $_.FullName).Replace('\', '/')
    "$relativePath $((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
  }
  return ($entries -join "`n")
}

$bundleDigest = Get-BundleDigest

Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
& $IsccPath @isccArgs $scriptPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $installerPath)) {
  throw "Inno Setup did not produce $installerPath"
}
if ((Get-BundleDigest) -ne $bundleDigest) {
  Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
  throw "Windows Host bundle changed while the installer was being built."
}

if ($AllowUnsigned) {
  Write-Host "Wrote private unsigned candidate: $installerPath"
  exit 0
}

& $SignToolPath verify /pa /v /tw $installerPath
if ($LASTEXITCODE -ne 0) {
  throw "Authenticode verification failed for the signed installer."
}

$finalHead = (& git -C $projectRoot rev-parse HEAD).Trim()
$finalChanges = @(& git -C $projectRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $finalHead -ne $sourceHead -or $finalChanges.Count -ne 0) {
  Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
  throw "Source changed while the signed Windows installer was being built."
}

Move-Item -LiteralPath $installerPath -Destination $publicInstallerPath
Write-Host "Wrote and verified signed installer: $publicInstallerPath"
