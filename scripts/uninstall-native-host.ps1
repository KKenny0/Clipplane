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

$root = if ($HostRoot) {
  (Resolve-Path -LiteralPath $HostRoot).Path
} elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot "app\native-host\credential-maintenance.mjs")) {
  $PSScriptRoot
} else {
  (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$expectedManifest = if (Test-Path -LiteralPath (Join-Path $root "app\native-host\credential-maintenance.mjs")) {
  Join-Path $root "com.clipplane.host.json"
} else {
  Join-Path $root "native-host\com.clipplane.host.json"
}

$browsers = if ($Browser -eq "all") { @("chrome", "edge") } else { @($Browser) }
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
    $missingValue = [guid]::NewGuid().ToString()
    $expectedValue = if ($State.HasDefaultValue) { $State.DefaultValue } else { $missingValue }
    if ($item.GetValue("", $missingValue) -ne $expectedValue) {
      throw "Could not restore the prior registration value."
    }
  } elseif (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

$previousStates = @{}
$ownedBrowsers = @()
$foreignRegistrationFound = $false
foreach ($name in $browsers) {
  $previousStates[$name] = Get-RegistrationState $registryPaths[$name]
  $state = $previousStates[$name]
  if ($state.HasDefaultValue -and $state.DefaultValue -is [string] -and $state.DefaultValue -eq $expectedManifest) {
    $ownedBrowsers += $name
  } elseif ($state.Exists) {
    $foreignRegistrationFound = $true
    Write-Host "Left a non-Clipplane or newer Host registration unchanged for $name"
  } else {
    Write-Host "Clipplane Host was not registered for $name"
  }
}

try {
  foreach ($name in $ownedBrowsers) {
    $registryPath = $registryPaths[$name]
    if (Test-Path -LiteralPath $registryPath) {
      Remove-Item -LiteralPath $registryPath -Recurse -Force
      Write-Host "Removed Clipplane Host registration for $name"
    } else {
      Write-Host "Clipplane Host was not registered for $name"
    }
  }
  $deleteCredentials = -not $PreserveCredentials -and $Browser -eq "all" -and -not $foreignRegistrationFound
  if ($deleteCredentials) {
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
      throw "Clipplane Host credentials could not be deleted."
    }
  } elseif (-not $PreserveCredentials) {
    Write-Host "Preserved shared credentials because this was not an owned full Host uninstall."
  }
} catch {
  $registrationFailure = $_.Exception.Message
  $rollbackFailures = @()
  foreach ($name in $ownedBrowsers) {
    try {
      Restore-RegistrationState $registryPaths[$name] $previousStates[$name]
    } catch {
      $rollbackFailures += "$($name): $($_.Exception.Message)"
    }
  }
  $credentialDetail = if ($PreserveCredentials) { " Credentials were preserved." } else { " Credential cleanup did not complete." }
  $rollbackDetail = if ($rollbackFailures.Count) { " Rollback failures: $($rollbackFailures -join '; ')" } else { "" }
  throw "Clipplane Host registration removal failed: $registrationFailure.$credentialDetail$rollbackDetail Local notes were not changed."
}

Write-Host "Clipplane Host uninstall complete. Local notes were preserved."
