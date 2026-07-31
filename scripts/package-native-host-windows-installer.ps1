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
}

foreach ($required in @(
  (Join-Path $bundleDir "clipplane-host.cmd"),
  (Join-Path $bundleDir "install-host.ps1"),
  (Join-Path $bundleDir "uninstall-host.ps1"),
  (Join-Path $bundleDir "allowed-origins.json"),
  (Join-Path $bundleDir "runtime\node.exe"),
  (Join-Path $bundleDir "app\native-host\host.mjs"),
  (Join-Path $bundleDir "app\native-host\credential-maintenance.mjs")
)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Windows Host bundle is incomplete: $required"
  }
}

Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
& $IsccPath @isccArgs $scriptPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $installerPath)) {
  throw "Inno Setup did not produce $installerPath"
}

if ($AllowUnsigned) {
  Write-Host "Wrote private unsigned candidate: $installerPath"
  exit 0
}

& $SignToolPath verify /pa /v /tw $installerPath
if ($LASTEXITCODE -ne 0) {
  throw "Authenticode verification failed for the signed installer."
}

Move-Item -LiteralPath $installerPath -Destination $publicInstallerPath
Write-Host "Wrote and verified signed installer: $publicInstallerPath"
