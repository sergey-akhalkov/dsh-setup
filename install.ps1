#Requires -Version 5.1
<#
.SYNOPSIS
Install the portable dsh-setup into a DeepSeek Harness profile in one command.

.DESCRIPTION
The deepseek-harness setup is one bundle: installing it adds every plugin package,
mounts their composition rows, and applies the owner defaults. This script also
enables the shipped optional bundles the setup expects, because a third-party
bundle cannot select them itself. It uses the same mechanisms as the Plugins page:
shipped optional bundles are appended to `dsh.profile.bundles`, registry bundles
are installed with `dsh plugin`, and the setup bundle is installed with the native
plugin manager. The profile's own `cordis.patch.yml` is never modified.

DeepSeek Harness must be closed while the profile is written. By default the
script closes it, waits, installs, and starts it again; pass -NoStopApp to abort
instead when it is running, or -NoRestart to leave it closed.

The script refuses to install into the `desktop` profile when it runs inside a
shell hosted by the running Harness (the desktop profile is the one the app owns):
closing the app would terminate that shell and the session behind it. Run the
installer from an external PowerShell window instead, or run `pnpm dogfood` to
verify this checkout against a copy of the profile without touching the live one.

.PARAMETER Profile
Profile name under `$DshHome/profiles`. Default: desktop.

.PARAMETER DshHome
Harness home directory. Default: $env:DSH_HOME, else $HOME/.dsh.

.PARAMETER DshCli
The `dsh` CLI command or path. Default: `dsh` on PATH, else the Desktop CLI.

.PARAMETER IndexUrl
Market index used to pin the released setup bundle. Ignored when -SetupSpec or a
local checkout is used.

.PARAMETER Repository
Repository used for the tag fallback when the index is unreachable.

.PARAMETER SetupVersion
Install this exact setup version instead of the newest listed one. The version
also selects the release tag fallback.

.PARAMETER SetupSpec
An explicit pnpm spec for the setup bundle, e.g. a git spec or a directory path.
Overrides the index and local checkout.

.PARAMETER NoStopApp
Abort instead of closing a running DeepSeek Harness. Only relevant for the
desktop profile.

.PARAMETER NoRestart
Do not start DeepSeek Harness again after installing.

.PARAMETER DryRun
Print the plan without changing anything.

.EXAMPLE
irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 | iex

.EXAMPLE
./install.ps1 -DryRun

.EXAMPLE
./install.ps1 -SetupSpec ../dsh-setup/packages/setup -Profile ci -NoStopApp
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = $(
    if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
  ),
  [string]$DshCli,
  [string]$IndexUrl = 'https://sergey-akhalkov.github.io/dsh-setup/index.json',
  [string]$Repository = 'https://github.com/sergey-akhalkov/dsh-setup',
  [string]$SetupVersion,
  [string]$SetupSpec,
  [switch]$NoStopApp,
  [switch]$NoRestart,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# BEGIN REPOSITORY METADATA
# Kept in sync with dsh.json by scripts/validate-repo.ts. A standalone copy of
# this script has no repository to read these from.
$SupportedDshVersions = @('0.2.1-rc.3')
$ShippedBundles = @(
  '@deepseek-ai/dsh-experimental-agent-team-profile',
  '@deepseek-ai/dsh-experimental-tool-worktree',
  '@deepseek-ai/dsh-experimental-ralph-bundle',
  '@deepseek-ai/dsh-experimental-plugin-market-bundle',
  '@deepseek-ai/dsh-experimental-session-search',
  '@deepseek-ai/dsh-experimental-terminal-bundle'
)
$RegistryBundles = @()
# END REPOSITORY METADATA

$SetupPackage = '@dsh-setup/setup'
$SetupRowsMarker = 'dsh-setup-ponytail'

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

function Write-Ok([string]$Message) {
  Write-Host "    ok $Message"
}

function Write-Skip([string]$Message) {
  Write-Host "    -- $Message"
}

function Write-Warn([string]$Message) {
  Write-Host "    !! $Message" -ForegroundColor Yellow
}

function Test-HasProperty($Object, [string]$Name) {
  if ($null -eq $Object) { return $false }
  return $null -ne $Object.PSObject.Properties[$Name]
}

function Read-JsonFile([string]$Path) {
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Save-JsonFile([string]$Path, $Object) {
  $json = ($Object | ConvertTo-Json -Depth 32) + "`n"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  # Write a sibling first and swap it in: a process killed between the two steps
  # (for example by an app restart racing the installer) must never leave a
  # partially-written profile manifest behind.
  $temporary = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  try {
    [System.IO.File]::WriteAllText($temporary, $json, $utf8)
    if (Test-Path -LiteralPath $Path) {
      [System.IO.File]::Replace($temporary, $Path, $null)
    } else {
      Move-Item -LiteralPath $temporary -Destination $Path
    }
  } catch {
    [System.IO.File]::Copy($temporary, $Path, $true)
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

function Test-HarnessHosted {
  # Tool shells started by a running Harness export these variables; an external
  # PowerShell window started by the user does not.
  if ($env:DSH_SESSION_ID -or $env:DSH_SHELL) { return $true }
  # Fall back to the process tree: the interactive tools run below a
  # "DeepSeek Harness.exe" runner even when the environment was filtered.
  try {
    $processId = $PID
    for ($depth = 0; $depth -lt 16; $depth++) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
      if ($null -eq $process) { break }
      $parentId = [int]$process.ParentProcessId
      if ($parentId -le 0) { break }
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction Stop
      if ($null -eq $parent) { break }
      $parentPath = [string]$parent.ExecutablePath
      if ($parent.Name -eq 'DeepSeek Harness.exe' -or $parentPath -like '*DeepSeek Harness*') {
        return $true
      }
      $processId = $parentId
    }
  } catch {
    return $false
  }
  return $false
}

function Get-ProfileBundles($Manifest) {
  if (-not (Test-HasProperty $Manifest 'dsh')) { return @() }
  if (-not (Test-HasProperty $Manifest.dsh 'profile')) { return @() }
  if (-not (Test-HasProperty $Manifest.dsh.profile 'bundles')) { return @() }
  return @($Manifest.dsh.profile.bundles)
}

function Set-ProfileBundles($Manifest, [object[]]$Bundles) {
  if (-not (Test-HasProperty $Manifest 'dsh')) { $Manifest | Add-Member -MemberType NoteProperty -Name dsh -Value ([pscustomobject]@{}) }
  if (-not (Test-HasProperty $Manifest.dsh 'profile')) { $Manifest.dsh | Add-Member -MemberType NoteProperty -Name profile -Value ([pscustomobject]@{}) }
  $Manifest.dsh.profile | Add-Member -MemberType NoteProperty -Name bundles -Value @($Bundles) -Force
  return $Manifest
}

function Get-HarnessProcesses {
  $found = @()
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    $path = $null
    try { $path = $process.Path } catch { $path = $null }
    if ($process.ProcessName -eq 'DeepSeek Harness' -or ($path -and $path -like '*DeepSeek Harness*')) {
      $found += $process
    }
  }
  return $found
}

function Get-DshCli {
  if ($DshCli) {
    if (-not (Test-Path -LiteralPath $DshCli) -and -not (Get-Command $DshCli -ErrorAction SilentlyContinue)) {
      throw "The -DshCli value '$DshCli' is not a command or file."
    }
    return $DshCli
  }
  $onPath = Get-Command dsh -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $desktop = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
  if (Test-Path -LiteralPath $desktop) { return $desktop }
  throw "Cannot find the DeepSeek Harness CLI. Install DeepSeek Harness Desktop or pass -DshCli <path to dsh>."
}

function Invoke-DshPlugin([string[]]$Arguments) {
  # A .cmd shim re-parses its command line: an unquoted spec containing "&"
  # (git+...#<commit>&path:/packages/setup) would be split by cmd.exe.
  $cli = Get-Command $DshCli -ErrorAction SilentlyContinue
  $cliPath = if ($cli) { $cli.Source } else { $DshCli }
  if ($cliPath -match '\.(cmd|bat)$') {
    $Arguments = @($Arguments | ForEach-Object {
      $value = [string]$_
      if ($value -match '[&^]') { "`"$value`"" } else { $value }
    })
  }
  # Stream the manager's own output: a slow or stalled package operation must
  # show where it is, not disappear into a buffer until the call returns.
  $output = & $cliPath plugin --profile $Profile @Arguments 2>&1 | Tee-Object -Variable output
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw "dsh plugin --profile $Profile $($Arguments -join ' ') failed with exit code $code" }
}

function Get-LatestReleaseTag {
  # The index is the preferred pin, but the release tags are the fallback when
  # Pages has no published index yet.
  $output = @(& git ls-remote --tags --refs $Repository 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "git ls-remote $Repository failed with exit code $LASTEXITCODE" }
  $versions = @(
    foreach ($line in $output) {
      if ([string]$line -match 'refs/tags/v(\d+\.\d+\.\d+)$') { [version]$Matches[1] }
    }
  )
  if ($versions.Count -eq 0) { return $null }
  return (($versions | Sort-Object -Descending) | Select-Object -First 1).ToString()
}

function Resolve-SetupSpec {
  if ($SetupSpec) { return $SetupSpec }

  $scriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $localSetup = Join-Path $scriptDirectory 'packages/setup/package.json'
  if (-not $SetupVersion -and (Test-Path -LiteralPath $localSetup)) {
    Write-Ok "using the setup bundle from this checkout: $scriptDirectory/packages/setup"
    return (Resolve-Path -LiteralPath (Join-Path $scriptDirectory 'packages/setup')).Path
  }

  Write-Step "Looking up the setup release"
  $source = $null
  try {
    $index = Invoke-RestMethod -Uri $IndexUrl -Headers @{ Accept = 'application/json' } -TimeoutSec 30
    $entry = @($index.plugins) | Where-Object { $_.name -eq $SetupPackage } | Select-Object -First 1
    if ($null -ne $entry) {
      $versions = @($entry.versions)
      if ($SetupVersion) {
        $versions = @($versions | Where-Object { $_.version -eq $SetupVersion })
      }
      $selected = $versions | Select-Object -First 1
      if ($null -ne $selected) {
        $source = $selected.source
        Write-Ok "index lists setup $($selected.version) at commit $($source.commit.Substring(0, 12))"
      }
    }
  } catch {
    Write-Warn "cannot read ${IndexUrl}: $($_.Exception.Message)"
  }

  if ($null -ne $source) {
    if ($source.type -ne 'git') { throw "The setup entry is not a git source; pass -SetupSpec." }
    if ($source.commit -notmatch '^[0-9a-f]{40}$') { throw "The setup entry commit is not a 40-hex-digit SHA." }
    $url = [string]$source.url
    if (-not $url.EndsWith('.git')) { $url = "$url.git" }
    $spec = "git+$url#$($source.commit)"
    if ($source.path) { $spec = "$spec&path:/$($source.path)" }
    return $spec
  }

  if ($SetupVersion) {
    Write-Warn "falling back to the release tag v$SetupVersion instead of the index"
    return "git+$Repository.git#v$SetupVersion&path:/packages/setup"
  }

  $latest = $null
  try {
    $latest = Get-LatestReleaseTag
  } catch {
    Write-Warn "cannot list the release tags: $($_.Exception.Message)"
  }
  if ($latest) {
    $script:SetupVersion = $latest
    Write-Warn "using the latest release tag v$latest instead of the index"
    return "git+$Repository.git#v$latest&path:/packages/setup"
  }

  throw "Cannot resolve the setup release: $IndexUrl is unreachable and no release tag could be read from $Repository; pass -SetupVersion or -SetupSpec."
}

function Get-InstalledSetupVersion([string]$ProfileDirectory) {
  $manifest = Join-Path $ProfileDirectory 'node_modules/@dsh-setup/setup/package.json'
  if (Test-Path -LiteralPath $manifest) { return (Read-JsonFile $manifest).version }
  return $null
}

function Test-PatchUnchanged([string]$Path, [string]$Hash) {
  $after = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  return $after -eq $Hash
}

$stoppedApp = $false
$appPath = $null
$backupPath = $null
$patchBackupPath = $null
$cordisBackupPath = $null

try {
  Write-Step "Reading the DeepSeek Harness installation"

  # The CLI reads the harness home from DSH_HOME; the parameter is an explicit
  # override for installations and tests that keep profiles elsewhere.
  $DshHome = [System.IO.Path]::GetFullPath($DshHome)
  $env:DSH_HOME = $DshHome

  $DshCli = Get-DshCli
  $versionOutput = & $DshCli --version 2>&1 | Select-Object -Last 1
  $dshVersion = ([string]$versionOutput).Trim()
  if (-not $dshVersion) { throw "The DSH CLI did not report a version: $DshCli --version" }
  Write-Ok "CLI $DshCli"
  Write-Ok "DSH $dshVersion"
  if ($SupportedDshVersions -notcontains $dshVersion) {
    throw "DSH $dshVersion is not supported by this installer (supported: $($SupportedDshVersions -join ', ')). Update DeepSeek Harness or use an older release's install.ps1."
  }

  $profileDirectory = Join-Path $DshHome (Join-Path 'profiles' $Profile)
  $profileManifestPath = Join-Path $profileDirectory 'package.json'
  if (-not (Test-Path -LiteralPath $profileManifestPath)) {
    if ($Profile -eq 'desktop') {
      throw "The desktop profile does not exist in $profileDirectory. Start DeepSeek Harness once, quit it, then run this installer."
    }
    throw "Profile '$Profile' does not exist in $profileDirectory. Create it first, then run this installer."
  }
  $manifest = Read-JsonFile $profileManifestPath
  $patchPath = Join-Path $profileDirectory 'cordis.patch.yml'
  $patchHash = if (Test-Path -LiteralPath $patchPath) { (Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash } else { $null }

  $setupSpec = Resolve-SetupSpec
  Write-Step "Plan"
  Write-Host "    profile: $profileDirectory"
  Write-Host "    setup:   $setupSpec"
  $existingBundles = @(Get-ProfileBundles $manifest)
  foreach ($name in @($ShippedBundles + $RegistryBundles)) {
    if ($existingBundles -contains $name) { Write-Host "    keep     $name" }
    else { Write-Host "    enable   $name" }
  }
  if ($DryRun) {
    Write-Step "Dry run: no changes were made"
    exit 0
  }

  if ($Profile -eq 'desktop' -and (Test-HarnessHosted)) {
    throw "Refusing to install into the 'desktop' profile from a shell run by DeepSeek Harness: closing the app would terminate this session. Run install.ps1 from an external PowerShell window, or run 'pnpm dogfood' to verify this checkout against a copy of the profile without touching the live profile."
  }

  # Back up the profile's own files before anything is stopped or changed: the
  # run stays reviewable even if a later step fails, and the patch is the
  # user-owned file the installer must never modify.
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupDirectory = Join-Path $DshHome '.dsh-setup-backups'
  New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
  $backupPath = Join-Path $backupDirectory "package.json.$timestamp.$Profile.bak"
  Copy-Item -LiteralPath $profileManifestPath -Destination $backupPath -Force
  Write-Skip "backup: $backupPath"
  $cordisPath = Join-Path $profileDirectory 'cordis.yml'
  if (Test-Path -LiteralPath $patchPath) {
    $patchBackupPath = Join-Path $backupDirectory "cordis.patch.yml.$timestamp.$Profile.bak"
    Copy-Item -LiteralPath $patchPath -Destination $patchBackupPath -Force
    Write-Skip "backup: $patchBackupPath"
  }
  if (Test-Path -LiteralPath $cordisPath) {
    $cordisBackupPath = Join-Path $backupDirectory "cordis.yml.$timestamp.$Profile.bak"
    Copy-Item -LiteralPath $cordisPath -Destination $cordisBackupPath -Force
    Write-Skip "backup: $cordisBackupPath"
  }

  if ($Profile -eq 'desktop') {
    $processes = @(Get-HarnessProcesses)
    if ($processes.Count -gt 0) {
      if ($NoStopApp) {
        throw "DeepSeek Harness is running. Quit it and run the installer again, or omit -NoStopApp to let the installer close and restart it."
      }
      $appPath = $null
      foreach ($process in $processes) {
        try {
          if ($process.Path) { $appPath = $process.Path; break }
        } catch {
          $appPath = $null
        }
      }
      Write-Step "Closing DeepSeek Harness"
      foreach ($process in $processes) {
        try {
          if ($process.MainWindowHandle -ne 0 -and -not $process.CloseMainWindow()) {
            Write-Skip "window of process $($process.Id) did not accept a close request"
          }
        } catch {
          Write-Skip "cannot request a close of process $($process.Id)"
        }
      }
      $deadline = (Get-Date).AddSeconds(20)
      while (@(Get-HarnessProcesses).Count -gt 0 -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
      }
      $remaining = @(Get-HarnessProcesses)
      if ($remaining.Count -gt 0) {
        Write-Warn "closing the remaining $($remaining.Count) process(es) forcibly"
        foreach ($process in $remaining) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
      }
      if (@(Get-HarnessProcesses).Count -gt 0) { throw "Could not close DeepSeek Harness. Quit it manually and run the installer again." }
      $stoppedApp = $true
      Write-Ok "DeepSeek Harness is closed"
    }
  }

  Write-Step "Enabling the bundles the setup expects"

  foreach ($name in $RegistryBundles) {
    $manifest = Read-JsonFile $profileManifestPath
    $selected = (@(Get-ProfileBundles $manifest)) -contains $name
    $installed = (Test-HasProperty $manifest 'dependencies') -and (Test-HasProperty $manifest.dependencies $name)
    if ($selected -and $installed) {
      Write-Ok "already installed: $name"
      continue
    }
    try {
      Invoke-DshPlugin @('add', "$name@$dshVersion")
      Write-Ok "installed and enabled: $name@$dshVersion"
    } catch {
      Write-Warn "optional bundle $name could not be installed: $($_.Exception.Message)"
    }
  }

  $manifest = Read-JsonFile $profileManifestPath
  $bundles = @(Get-ProfileBundles $manifest)
  $missing = @($ShippedBundles | Where-Object { $bundles -notcontains $_ })
  if ($missing.Count -gt 0) {
    foreach ($name in $missing) { $bundles += $name }
    $manifest = Set-ProfileBundles $manifest $bundles
    Save-JsonFile $profileManifestPath $manifest
    Write-Ok "enabled $($missing.Count) shipped bundle(s)"
  } else {
    Write-Ok "shipped bundles already enabled"
  }

  Write-Step "Installing the setup bundle"
  Invoke-DshPlugin @('add', $setupSpec)
  Write-Ok "installed: $SetupPackage"

  Write-Step "Verifying the installed profile"
  $manifest = Read-JsonFile $profileManifestPath
  $bundles = @(Get-ProfileBundles $manifest)
  $problems = @()

  if (-not ((Test-HasProperty $manifest 'dependencies') -and (Test-HasProperty $manifest.dependencies $SetupPackage))) {
    $problems += "$SetupPackage is missing from the profile dependencies"
  }
  if ($bundles -notcontains $SetupPackage) {
    $problems += "$SetupPackage is missing from dsh.profile.bundles"
  }
  if ($bundles.Count -gt 0 -and $bundles[$bundles.Count - 1] -ne $SetupPackage) {
    $problems += "the setup bundle is not last in dsh.profile.bundles, so its defaults could lose precedence"
  }
  foreach ($name in @($ShippedBundles + $RegistryBundles)) {
    if ($bundles -notcontains $name) { $problems += "bundle $name is not selected" }
  }
  $installedVersion = Get-InstalledSetupVersion $profileDirectory
  if ($null -eq $installedVersion) {
    $problems += "the installed setup package was not found under the profile's node_modules"
  } elseif ($SetupVersion -and $installedVersion -ne $SetupVersion) {
    $problems += "installed setup version $installedVersion is not the requested $SetupVersion"
  }
  if ($null -ne $patchHash -and -not (Test-PatchUnchanged $patchPath $patchHash)) {
    $problems += "the profile's cordis.patch.yml changed; the installer must not modify it"
  }

  if ($Profile -ne 'desktop') {
    $dump = & $DshCli --profile $Profile --dump-config 2>&1
    $code = $LASTEXITCODE
    if ($code -ne 0) {
      $problems += "DSH cannot compose profile '$Profile' (exit code $code); see the output above"
      foreach ($line in @($dump)) { Write-Host "    $line" }
    } elseif (-not (@($dump) -match [regex]::Escape($SetupRowsMarker))) {
      $problems += "the composed profile lacks the setup row marker '$SetupRowsMarker'"
    } else {
      Write-Ok "the composed profile loads with the setup rows"
    }
  } else {
    Write-Skip "the desktop profile cannot be dumped by the CLI; composition is covered by CI"
  }

  if ($problems.Count -gt 0) {
    $backupSummary = @()
    if ($backupPath) { $backupSummary += "manifest: $backupPath" }
    if ($patchBackupPath) { $backupSummary += "patch: $patchBackupPath" }
    if ($cordisBackupPath) { $backupSummary += "root: $cordisBackupPath" }
    foreach ($problem in $problems) { Write-Warn $problem }
    throw "$($problems.Count) verification problem(s). Backups: $($backupSummary -join '; ')"
  }

  if ($installedVersion) { Write-Ok "setup version $installedVersion in $Profile" }
  if ($backupPath) { Write-Ok "profile backups: $backupDirectory" }
  Write-Host ''
  Write-Host "Installed. Start DeepSeek Harness and the setup bundle is active."
  exit 0
} catch {
  Write-Host ''
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($backupPath) { Write-Host "The profile manifest backup is at $backupPath" }
  if ($patchBackupPath) { Write-Host "The profile patch backup is at $patchBackupPath" }
  if ($cordisBackupPath) { Write-Host "The profile root backup is at $cordisBackupPath" }
  exit 1
} finally {
  if ($stoppedApp -and -not $NoRestart) {
    $launch = $appPath
    if (-not $launch) {
      $launch = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
    }
    if (Test-Path -LiteralPath $launch) {
      Write-Step "Starting DeepSeek Harness"
      Start-Process -FilePath $launch | Out-Null
    } else {
      Write-Warn "DeepSeek Harness was closed; start it manually (executable not found: $launch)"
    }
  }
}
