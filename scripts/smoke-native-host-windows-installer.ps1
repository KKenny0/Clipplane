$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "Windows installer smoke tests can only run on Windows."
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$bundleRoot = Join-Path $projectRoot "dist\clipplane-host-v$version-windows-x64"
$installerPath = Join-Path $projectRoot "dist\clipplane-host-v$version-windows-x64-unsigned.exe"
$installRoot = Join-Path $env:LOCALAPPDATA "Clipplane Host"
$powerShellPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$registryPaths = [ordered]@{
  chrome = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host"
  edge = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host"
}
$requiredBundleFiles = @(
  "clipplane-host.cmd",
  "install-host.ps1",
  "uninstall-host.ps1",
  "allowed-origins.json",
  "runtime\node.exe",
  "app\native-host\host.mjs",
  "app\native-host\credential-maintenance.mjs"
)

function Get-RegistrationState {
  param([string]$Path)

  $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
  $missingValue = [guid]::NewGuid().ToString()
  $defaultValue = if ($item) { $item.GetValue("", $missingValue) } else { $missingValue }
  [pscustomobject]@{
    Exists = $null -ne $item
    HasDefaultValue = $defaultValue -ne $missingValue
    DefaultValue = if ($defaultValue -ne $missingValue) { $defaultValue } else { $null }
  }
}

function Restore-RegistrationState {
  param(
    [string]$Path,
    [object]$State
  )

  if ($State.Exists) {
    New-Item -Path $Path -Force | Out-Null
    $item = Get-Item -LiteralPath $Path
    if ($State.HasDefaultValue) {
      Set-Item -LiteralPath $Path -Value $State.DefaultValue
    } else {
      $item.DeleteValue("", $false)
    }
  } elseif (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Invoke-PowerShellFile {
  param(
    [string]$Path,
    [string[]]$Arguments
  )

  & $powerShellPath -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Path @Arguments
  return $LASTEXITCODE
}

foreach ($relativePath in $requiredBundleFiles) {
  $requiredPath = Join-Path $bundleRoot $relativePath
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Windows Host bundle is incomplete: $requiredPath"
  }
}
if (-not (Test-Path -LiteralPath $installerPath)) {
  throw "Unsigned Windows installer candidate was not found: $installerPath"
}
if (Test-Path -LiteralPath $installRoot) {
  throw "Installer smoke requires an empty per-user install root: $installRoot"
}

$initialStates = @{}
foreach ($name in $registryPaths.Keys) {
  $initialStates[$name] = Get-RegistrationState $registryPaths[$name]
}
$notesSentinel = Join-Path ([System.IO.Path]::GetTempPath()) "clipplane-installer-smoke-$PID-notes.txt"
$edgeAcl = $null
$edgeAclChanged = $false
$maintenanceBackup = $null

try {
  Set-Content -LiteralPath $notesSentinel -Value "keep notes outside the Host install root" -Encoding UTF8
  $sentinels = @{
    chrome = "C:\clipplane-smoke\chrome-$PID.json"
    edge = "C:\clipplane-smoke\edge-$PID.json"
  }
  foreach ($name in $registryPaths.Keys) {
    New-Item -Path $registryPaths[$name] -Force | Out-Null
    Set-Item -LiteralPath $registryPaths[$name] -Value $sentinels[$name]
  }

  $edgeAcl = Get-Acl -LiteralPath $registryPaths.edge
  $edgeAclWithDeny = Get-Acl -LiteralPath $registryPaths.edge
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $denySetValue = [System.Security.AccessControl.RegistryAccessRule]::new(
    $currentUser,
    [System.Security.AccessControl.RegistryRights]::SetValue,
    [System.Security.AccessControl.AccessControlType]::Deny
  )
  $edgeAclWithDeny.AddAccessRule($denySetValue)
  Set-Acl -LiteralPath $registryPaths.edge -AclObject $edgeAclWithDeny
  $edgeAclChanged = $true

  $transactionExitCode = Invoke-PowerShellFile (Join-Path $bundleRoot "install-host.ps1") @("-Browser", "all")
  if ($transactionExitCode -eq 0) {
    throw "Bundled install unexpectedly succeeded while Edge registration was denied."
  }
  if ((Get-Item -LiteralPath $registryPaths.chrome).GetValue("") -ne $sentinels.chrome) {
    throw "Chrome registration was not restored after the failed bundled install."
  }
  if ((Get-Item -LiteralPath $registryPaths.edge).GetValue("") -ne $sentinels.edge) {
    throw "Edge registration changed despite the denied write."
  }

  Set-Acl -LiteralPath $registryPaths.edge -AclObject $edgeAcl
  $edgeAclChanged = $false

  & $installerPath /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
  if ($LASTEXITCODE -ne 0) {
    throw "Unsigned Windows installer candidate exited with $LASTEXITCODE."
  }
  foreach ($relativePath in $requiredBundleFiles + "com.clipplane.host.json") {
    $installedPath = Join-Path $installRoot $relativePath
    if (-not (Test-Path -LiteralPath $installedPath)) {
      throw "Installer did not create required file: $installedPath"
    }
  }
  $installedManifest = Join-Path $installRoot "com.clipplane.host.json"
  $manifest = Get-Content -LiteralPath $installedManifest -Raw | ConvertFrom-Json
  if ($manifest.name -ne "com.clipplane.host" -or $manifest.path -ne (Join-Path $installRoot "clipplane-host.cmd") -or $manifest.type -ne "stdio") {
    throw "Installed Host manifest is invalid."
  }
  foreach ($name in $registryPaths.Keys) {
    if ((Get-Item -LiteralPath $registryPaths[$name]).GetValue("") -ne $installedManifest) {
      throw "$name registration does not point to the installed manifest."
    }
  }

  & node (Join-Path $projectRoot "scripts\smoke-native-host-bundle.mjs") --target windows --bundle $installRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Installed Host bundle smoke failed with $LASTEXITCODE."
  }

  $maintenance = Join-Path $installRoot "app\native-host\credential-maintenance.mjs"
  $maintenanceBackup = "$maintenance.smoke-$PID"
  Move-Item -LiteralPath $maintenance -Destination $maintenanceBackup
  try {
    $uninstallExitCode = Invoke-PowerShellFile (Join-Path $installRoot "uninstall-host.ps1") @("-Browser", "all", "-HostRoot", $installRoot)
    if ($uninstallExitCode -eq 0) {
      throw "Bundled uninstall unexpectedly succeeded without credential maintenance."
    }
    foreach ($name in $registryPaths.Keys) {
      if (-not (Test-Path -LiteralPath $registryPaths[$name])) {
        throw "$name registration was removed after credential cleanup failed."
      }
    }
  } finally {
    if (Test-Path -LiteralPath $maintenanceBackup) {
      Move-Item -LiteralPath $maintenanceBackup -Destination $maintenance
    }
    $maintenanceBackup = $null
  }

  $uninstaller = Get-ChildItem -LiteralPath $installRoot -Filter "unins*.exe" -File | Select-Object -First 1
  if (-not $uninstaller) {
    throw "Inno uninstaller was not found in $installRoot"
  }
  & $uninstaller.FullName /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
  if ($LASTEXITCODE -ne 0) {
    throw "Inno uninstaller exited with $LASTEXITCODE."
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "Inno uninstaller left the Host install root behind: $installRoot"
  }
  foreach ($name in $registryPaths.Keys) {
    if (Test-Path -LiteralPath $registryPaths[$name]) {
      throw "Inno uninstaller left the $name registration behind."
    }
  }
  if (-not (Test-Path -LiteralPath $notesSentinel)) {
    throw "Installer smoke changed notes outside the Host install root."
  }

  Write-Host "PASS Windows Host installer candidate smoke"
} finally {
  if ($edgeAclChanged) {
    Set-Acl -LiteralPath $registryPaths.edge -AclObject $edgeAcl
  }
  if ($maintenanceBackup -and (Test-Path -LiteralPath $maintenanceBackup)) {
    Move-Item -LiteralPath $maintenanceBackup -Destination (Join-Path $installRoot "app\native-host\credential-maintenance.mjs")
  }
  if (Test-Path -LiteralPath $installRoot) {
    $cleanupUninstaller = Get-ChildItem -LiteralPath $installRoot -Filter "unins*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cleanupUninstaller) {
      & $cleanupUninstaller.FullName /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
    }
  }
  foreach ($name in $registryPaths.Keys) {
    Restore-RegistrationState $registryPaths[$name] $initialStates[$name]
  }
  Remove-Item -LiteralPath $notesSentinel -Force -ErrorAction SilentlyContinue
}
