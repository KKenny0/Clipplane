param(
  [ValidateSet("chrome", "edge", "all")]
  [string]$Browser = "all"
)

$ErrorActionPreference = "Stop"
$hostRoot = $PSScriptRoot
$launcherPath = Join-Path $hostRoot "clipplane-host.cmd"
$originsPath = Join-Path $hostRoot "allowed-origins.json"
$manifestPath = Join-Path $hostRoot "com.clipplane.host.json"

if (-not (Test-Path -LiteralPath $launcherPath) -or -not (Test-Path -LiteralPath $originsPath)) {
  throw "Clipplane Host bundle is incomplete. Reinstall the signed package."
}

$origins = (Get-Content -LiteralPath $originsPath -Raw | ConvertFrom-Json).allowed_origins
$manifest = [ordered]@{
  name = "com.clipplane.host"
  description = "Clipplane Native Messaging Host"
  path = $launcherPath
  type = "stdio"
  allowed_origins = @($origins)
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$registryPaths = [ordered]@{
  chrome = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host"
  edge = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host"
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
foreach ($name in $browsers) {
  $previousStates[$name] = Get-RegistrationState $registryPaths[$name]
}

try {
  foreach ($name in $browsers) {
    New-Item -Path $registryPaths[$name] -Force | Out-Null
    Set-Item -LiteralPath $registryPaths[$name] -Value $manifestPath
    if ((Get-Item -LiteralPath $registryPaths[$name]).GetValue("") -ne $manifestPath) {
      throw "Clipplane Host registration verification failed for $name."
    }
  }
} catch {
  $registrationFailure = $_.Exception.Message
  $rollbackFailures = @()
  foreach ($name in $browsers) {
    try {
      Restore-RegistrationState $registryPaths[$name] $previousStates[$name]
    } catch {
      $rollbackFailures += "$($name): $($_.Exception.Message)"
    }
  }
  $rollbackDetail = if ($rollbackFailures.Count) { " Rollback failures: $($rollbackFailures -join '; ')" } else { "" }
  throw "Clipplane Host registration failed: $registrationFailure.$rollbackDetail"
}

Write-Host "Restart every browser window, then use Check again in Clipplane."
