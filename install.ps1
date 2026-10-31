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

The local Hindsight runtime is provisioned as a second phase after the profile is
installed and verified, when `uv` and a DeepSeek key are available; a runtime that
is already configured and healthy is skipped without prompting. Pass -NoHindsight
to skip that phase, -HindsightOnly to run only it, or -RepairHindsight to force it.
See docs/install.md and docs/hindsight.md for the Hindsight options and behavior.

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

.PARAMETER NoDesktopShortcut
Do not create the administrator desktop shortcut on the current user's Desktop.

.PARAMETER DryRun
Print the plan without changing anything.

.PARAMETER DeepSeekApiKey
DeepSeek key for the Hindsight phase. Prefer DEEPSEEK_API_KEY or ~/.hindsight/deepseek.key.

.PARAMETER ExportDir
Durable Hindsight export directory.

.PARAMETER ExportRemote
Private Git remote for the Hindsight export; '-' keeps the export local.

.PARAMETER ApiPort
Local Hindsight API port. Default: 8888.

.PARAMETER Model
DeepSeek model used by Hindsight extraction. Default: deepseek-chat.

.PARAMETER NoLogonTask
Do not register the Hindsight logon task.

.PARAMETER SkipVerify
Skip the Hindsight key, push-access, and retain/recall verification.

.PARAMETER NoHindsight
Install or update the profile only; skip the Hindsight phase.

.PARAMETER HindsightOnly
Run only the Hindsight phase; no DSH profile is read, written, or restarted.

.PARAMETER RepairHindsight
Run the Hindsight phase even when the runtime is already configured and healthy.

.PARAMETER SelfTest
Run the Hindsight component self-test and exit.

.EXAMPLE
irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 | iex

.EXAMPLE
./install.ps1 -DryRun

.EXAMPLE
./install.ps1 -SetupSpec ../dsh-setup/packages/setup -Profile ci -NoStopApp

.EXAMPLE
./install.ps1 -HindsightOnly -DryRun
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
  [switch]$NoDesktopShortcut,
  [switch]$DryRun,
  [string]$DeepSeekApiKey,
  [string]$ExportDir,
  [string]$ExportRemote,
  [string]$ApiPort = '8888',
  [string]$Model = 'deepseek-chat',
  [switch]$NoLogonTask,
  [switch]$SkipVerify,
  [switch]$NoHindsight,
  [switch]$HindsightOnly,
  [switch]$RepairHindsight,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# BEGIN REPOSITORY METADATA
# Kept in sync with dsh.json by scripts/validate-repo.ts. A standalone copy of
# this script has no repository to read these from.
$SupportedDshVersions = @('0.2.1-rc.3', '0.2.1-rc.5')
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
$ToolVersion = '1.1.0'
$ApiVersion = '1.1.0'
$TaskName = 'Hindsight embed daemon'

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

  # A pipeline run has no script path; the caller's working directory must not
  # silently become the installation source.
  if ($PSScriptRoot) {
    $localSetup = Join-Path $PSScriptRoot 'packages/setup/package.json'
    if (-not $SetupVersion -and (Test-Path -LiteralPath $localSetup)) {
      Write-Ok "using the setup bundle from this checkout: $PSScriptRoot/packages/setup"
      return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'packages/setup')).Path
    }
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
        # The resolved version is what the installed package must match; a rerun
        # that leaves an older package behind must fail the verification below.
        $script:SetupVersion = $selected.version
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

function Resolve-DesktopAppPath([string]$KnownPath) {
  if (
    $KnownPath -and
    (Test-Path -LiteralPath $KnownPath) -and
    ((Split-Path -Leaf $KnownPath) -ieq 'DeepSeek Harness.exe')
  ) {
    return $KnownPath
  }
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk'
  if (Test-Path -LiteralPath $startMenu) {
    try {
      $target = (New-Object -ComObject WScript.Shell).CreateShortcut($startMenu).TargetPath
      if ($target -and (Test-Path -LiteralPath $target)) { return $target }
    } catch {
      Write-Warn "cannot read the Start Menu shortcut: $($_.Exception.Message)"
    }
  }
  $fallback = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
  if (Test-Path -LiteralPath $fallback) { return $fallback }
  return $null
}

function New-AdminDesktopShortcut([string]$Executable) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $link = Join-Path $desktop 'DeepSeek Harness (Administrator).lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $escapedExecutable = $Executable.Replace("'", "''")
  $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath ''{0}'' -Verb RunAs"' -f $escapedExecutable
  $shortcut.WorkingDirectory = Split-Path -Parent $Executable
  $shortcut.IconLocation = "$Executable,0"
  $shortcut.Save()
  return $link
}

function Test-IsWindows {
  return [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Restrict-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Cannot restrict a missing file: $Path"
  }
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  # Set-Acl writes the DACL atomically, but it also attempts the empty SACL and
  # fails without SeSecurityPrivilege; the DACL verification below is authoritative.
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existing in @($acl.Access)) {
    [void]$acl.RemoveAccessRule($existing)
  }
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  try {
    Set-Acl -LiteralPath $Path -AclObject $acl
  } catch {
    # The DACL write may succeed and only the empty SACL fail; verify below.
  }
  $check = Get-Acl -LiteralPath $Path
  $foreign = @($check.Access | Where-Object { $_.IdentityReference.Value -ne $identity })
  if ($foreign.Count -gt 0) {
    throw "Could not restrict ${Path} to $identity."
  }
}

function Invoke-NativeCapture([string]$FilePath, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $FilePath @Arguments 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
}

function Test-EmbedVersion([string]$ToolList, [string]$Version) {
  $expected = 'hindsight-embed v' + $Version
  foreach ($line in ($ToolList -split "`r?`n")) {
    if ($line.Trim() -eq $expected) {
      return $true
    }
  }
  return $false
}

function Get-EnvLines([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    return @(Get-Content -LiteralPath $Path)
  }
  return @()
}

function Get-EnvValue([string[]]$Lines, [string]$Name) {
  $pattern = '^\s*(?:export\s+)?' + [regex]::Escape($Name) + '\s*=(.*)$'
  $value = ''
  foreach ($line in $Lines) {
    $match = [regex]::Match($line, $pattern)
    if ($match.Success) {
      $value = $match.Groups[1].Value.Trim()
      if ($value.Length -ge 2 -and $value[0] -eq $value[$value.Length - 1] -and ($value[0] -eq '"' -or $value[0] -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
  }
  return $value
}

function Set-EnvValue([string[]]$Lines, [string]$Name, [string]$Value) {
  $pattern = '^\s*(?:export\s+)?' + [regex]::Escape($Name) + '\s*='
  $replacement = '{0}={1}' -f $Name, $Value
  $result = New-Object System.Collections.Generic.List[string]
  $written = $false
  foreach ($line in $Lines) {
    if ($line -match $pattern) {
      if (-not $written) {
        $result.Add($replacement)
        $written = $true
      }
      continue
    }
    $result.Add($line)
  }
  if (-not $written) {
    $result.Add($replacement)
  }
  return @($result)
}

function Resolve-DeepSeekKey([string[]]$Lines, [bool]$AllowPrompt) {
  if (-not [string]::IsNullOrWhiteSpace($DeepSeekApiKey)) {
    return $DeepSeekApiKey.Trim()
  }
  if (-not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
    return $env:DEEPSEEK_API_KEY.Trim()
  }
  if (Test-Path -LiteralPath $KeyFilePath) {
    $fromFile = (Get-Content -LiteralPath $KeyFilePath -Raw).Trim()
    if (-not [string]::IsNullOrWhiteSpace($fromFile)) {
      return $fromFile
    }
  }
  $fromProfile = Get-EnvValue $Lines 'HINDSIGHT_API_LLM_API_KEY'
  if (-not [string]::IsNullOrWhiteSpace($fromProfile)) {
    return $fromProfile.Trim()
  }
  if ($AllowPrompt -and [Environment]::UserInteractive) {
    try {
      $secure = Read-Host -AsSecureString 'DeepSeek API key'
    }
    catch {
      # -NonInteractive and some hosts reject the prompt; this means no key, not a failure.
      return $null
    }
    if ($null -eq $secure) { return $null }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  }
  return $null
}

function Get-UvCommand {
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($null -eq $uv) {
    throw 'uv is required. Install it with "winget install --id astral-sh.uv -e" and rerun.'
  }
  return $uv.Source
}

function Find-EmbedExecutable([string]$ToolRoot, [string]$BinRoot, [string]$UserBin = (Join-Path $env:USERPROFILE '.local\bin')) {
  $candidates = @((Join-Path $UserBin 'hindsight-embed.exe'))
  if (-not [string]::IsNullOrWhiteSpace($BinRoot)) {
    $candidates += (Join-Path $BinRoot 'hindsight-embed.exe')
    $candidates += (Join-Path $BinRoot 'hindsight-embed')
  }
  if (-not [string]::IsNullOrWhiteSpace($ToolRoot)) {
    $candidates += (Join-Path $ToolRoot 'hindsight-embed\Scripts\hindsight-embed.exe')
    $candidates += (Join-Path $ToolRoot 'hindsight-embed\bin\hindsight-embed')
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  $command = Get-Command hindsight-embed -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }
  return $null
}

function Get-EmbedCommand([string]$UvPath, [bool]$Install) {
  $list = Invoke-NativeCapture $UvPath @('tool', 'list')
  if ($list.ExitCode -ne 0) {
    throw 'uv tool list failed.'
  }
  $installed = Test-EmbedVersion $list.Output $ToolVersion
  if (-not $installed) {
    if (-not $Install) {
      return $null
    }
    Write-Step "Installing hindsight-embed $ToolVersion"
    $installResult = Invoke-NativeCapture $UvPath @('tool', 'install', ('hindsight-embed==' + $ToolVersion))
    if ($installResult.ExitCode -ne 0) {
      throw "uv tool install hindsight-embed failed: $($installResult.Output)"
    }
  }
  $toolRoot = ''
  $binRoot = ''
  $toolDir = Invoke-NativeCapture $UvPath @('tool', 'dir')
  if ($toolDir.ExitCode -eq 0) {
    $toolRoot = $toolDir.Output.Trim()
  }
  $binDir = Invoke-NativeCapture $UvPath @('tool', 'dir', '--bin')
  if ($binDir.ExitCode -eq 0) {
    $binRoot = $binDir.Output.Trim()
  }
  $candidate = Find-EmbedExecutable $toolRoot $binRoot
  if ($null -ne $candidate) {
    return $candidate
  }
  if ($Install) {
    throw 'hindsight-embed was installed but its executable was not found (checked the uv tool bin and venv directories, ~/.local/bin, and PATH).'
  }
  return $null
}

function Resolve-DatabaseUrl([string[]]$Lines) {
  $explicit = Get-EnvValue $Lines 'HINDSIGHT_EMBED_API_DATABASE_URL'
  if (-not [string]::IsNullOrWhiteSpace($explicit)) {
    return $explicit
  }
  $instances = Join-Path $env:USERPROFILE '.pg0\instances'
  $implicit = Join-Path $instances 'hindsight-embed-'
  if (Test-Path -LiteralPath $implicit) {
    return 'pg0://hindsight-embed-'
  }
  $namedDefault = Join-Path $instances 'hindsight-embed-default'
  if (Test-Path -LiteralPath $namedDefault) {
    return 'pg0://hindsight-embed-default'
  }
  return 'pg0://hindsight-embed-default'
}

function Export-WindowsCertBundle([string]$Path) {
  $certs = @()
  foreach ($store in @('Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root', 'Cert:\LocalMachine\CA', 'Cert:\CurrentUser\CA')) {
    $certs += Get-ChildItem $store -ErrorAction SilentlyContinue
  }
  $unique = @{}
  foreach ($cert in $certs) {
    $unique[$cert.Thumbprint] = $cert
  }
  $text = New-Object System.Text.StringBuilder
  foreach ($cert in $unique.Values) {
    [void]$text.AppendLine('-----BEGIN CERTIFICATE-----')
    [void]$text.AppendLine([Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks'))
    [void]$text.AppendLine('-----END CERTIFICATE-----')
  }
  if (Test-Path -LiteralPath $Path) {
    try {
      Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
    }
    catch {
      $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
      $grant = Invoke-NativeCapture $icacls @($Path, '/grant:r', "$($env:USERNAME):(F)")
      if ($grant.ExitCode -ne 0) {
        throw "Cannot make $Path writable: $($grant.Output)"
      }
    }
  }
  Write-Utf8NoBom $Path $text.ToString()
  Restrict-File $Path
}

function Get-HindsightListeners([int]$Port) {
  try {
    $connections = @(Get-NetTCPConnection -ErrorAction Stop)
  }
  catch {
    throw "Could not inspect listeners on port ${Port}: $($_.Exception.Message). See $DaemonLogPath."
  }
  return @($connections | Where-Object { $_.LocalPort -eq $Port -and $_.State -eq 'Listen' })
}

function Get-ListenerPid([int]$Port) {
  $connections = @(Get-HindsightListeners $Port)
  if ($connections.Count -eq 0) {
    return $null
  }
  return $connections[0].OwningProcess
}

function Assert-LoopbackListener([int]$Port) {
  $listeners = @(Get-HindsightListeners $Port)
  if ($listeners.Count -eq 0) {
    return
  }
  $foreign = @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })
  if ($foreign.Count -gt 0) {
    $addresses = ($foreign | ForEach-Object { $_.LocalAddress }) -join ', '
    throw "Hindsight is listening on non-loopback address(es): $addresses. Stop it and fix the bind address."
  }
}

function Test-HindsightHealth([int]$Port) {
  try {
    $health = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -TimeoutSec 10
    return ($health.status -eq 'healthy' -and $health.database -eq 'connected')
  }
  catch {
    return $false
  }
}

function Test-HindsightProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $ProcessId) -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return $false
  }
  return ($process.CommandLine -match 'hindsight_api|hindsight-api')
}

function Start-HindsightDaemon([string]$EmbedPath, [int]$Port, [string]$CertPath, [bool]$Restart) {
  $env:HINDSIGHT_EMBED_PROFILE = 'default'
  Assert-LoopbackListener $Port
  $pidOnPort = Get-ListenerPid $Port
  if ($null -ne $pidOnPort) {
    if (Test-HindsightHealth $Port) {
      if (Test-HindsightProcess $pidOnPort) {
        if (-not $Restart) {
          Write-Skip "Hindsight daemon is already healthy on 127.0.0.1:$Port"
          return
        }
        Write-Step 'Restarting the Hindsight daemon to apply changed profile settings'
        $stopped = Invoke-NativeCapture $EmbedPath @('daemon', 'stop')
        if ($stopped.ExitCode -ne 0) {
          throw "Could not stop the running Hindsight daemon. See $DaemonLogPath."
        }
        $stopDeadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $stopDeadline -and $null -ne (Get-ListenerPid $Port)) {
          Start-Sleep -Seconds 1
        }
        if ($null -ne (Get-ListenerPid $Port)) {
          throw "The Hindsight daemon did not release port $Port."
        }
      }
      else {
        throw "Port $Port is healthy but its listener PID $pidOnPort is not the expected Hindsight daemon. Refusing to reuse or kill it. See $DaemonLogPath."
      }
    }
    else {
      throw "Port $Port is in use by PID $pidOnPort and does not answer as Hindsight. Stop that process or choose another port. See $DaemonLogPath."
    }
  }
  Write-Step "Starting the Hindsight daemon on 127.0.0.1:$Port"
  $env:SSL_CERT_FILE = $CertPath
  $env:REQUESTS_CA_BUNDLE = $CertPath
  $env:HINDSIGHT_EMBED_DAEMON_STARTUP_TIMEOUT = '300'
  # `pg0 start` leaves the PostgreSQL child holding inherited stdio handles on
  # Windows; capturing the command blocks setup forever. Start it detached and
  # poll /health instead.
  $startOutput = Join-Path $HindsightHome 'daemon-start.out'
  $startError = Join-Path $HindsightHome 'daemon-start.err'
  $startProcess = Start-Process -FilePath $EmbedPath -ArgumentList @('daemon', 'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput $startOutput -RedirectStandardError $startError
  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    if (Test-HindsightHealth $Port) {
      Assert-LoopbackListener $Port
      $startedPid = Get-ListenerPid $Port
      if ($null -eq $startedPid) {
        throw "Hindsight reports healthy on port $Port but no listening PID could be identified. See $DaemonLogPath."
      }
      if (-not (Test-HindsightProcess $startedPid)) {
        throw "Port $Port is healthy but its listener PID $startedPid is not the expected Hindsight daemon. See $DaemonLogPath."
      }
      Write-Ok "Daemon healthy on 127.0.0.1:$Port"
      return
    }
    if ($startProcess.HasExited -and $startProcess.ExitCode -ne 0) {
      $tail = ''
      if (Test-Path -LiteralPath $DaemonLogPath) {
        $tail = ((Get-Content -LiteralPath $DaemonLogPath -Tail 15) -join "`n")
      }
      throw "hindsight-embed daemon start failed (exit $($startProcess.ExitCode)). See $DaemonLogPath.`n$tail"
    }
    Start-Sleep -Seconds 3
  }
  throw "Hindsight daemon did not become healthy. See $DaemonLogPath."
}

function Write-StartScript([string]$Path, [string]$EmbedPath) {
  $template = @'
$env:HINDSIGHT_EMBED_PROFILE = 'default'
$env:SSL_CERT_FILE = Join-Path $env:USERPROFILE '.hindsight\windows-certs.pem'
$env:REQUESTS_CA_BUNDLE = $env:SSL_CERT_FILE
& '{0}' daemon start *> (Join-Path $env:USERPROFILE '.hindsight\daemon-start.log')
'@
  $escaped = $EmbedPath.Replace("'", "''")
  $content = $template -f $escaped
  Write-Utf8NoBom $Path $content
  Restrict-File $Path
}

function Register-LogonStart([string]$StartScript) {
  if ($NoLogonTask) {
    Write-Skip 'Logon task disabled by -NoLogonTask'
    return
  }
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $powershell)) {
    throw 'Windows PowerShell was not found; cannot register the logon start.'
  }
  $action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $StartScript)
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Start the local Hindsight embed daemon used by DeepSeek Harness memory' -Force | Out-Null
  Write-Ok "Logon task: $TaskName"
}

function Write-AgentConfig([string]$Path, [int]$Port) {
  if (Test-Path -LiteralPath $Path) {
    Write-Skip "Keeping existing $Path"
    return
  }
  $config = @{
    serverMode = 'self-hosted'
    apiUrl = ('http://127.0.0.1:{0}' -f $Port)
  } | ConvertTo-Json -Compress
  $null = $config | ConvertFrom-Json
  Write-Utf8NoBom $Path $config
  Restrict-File $Path
  Write-Ok "Wrote $Path"
}

function Resolve-ExportPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }
  $expanded = [Environment]::ExpandEnvironmentVariables($Value.Trim())
  if ($expanded -eq '~') {
    $expanded = $env:USERPROFILE
  }
  elseif ($expanded.StartsWith('~\') -or $expanded.StartsWith('~/')) {
    $expanded = Join-Path $env:USERPROFILE $expanded.Substring(2)
  }
  if (-not [System.IO.Path]::IsPathRooted($expanded)) {
    $expanded = Join-Path (Get-Location).Path $expanded
  }
  return [System.IO.Path]::GetFullPath($expanded)
}

function Resolve-ExportDirectory([string]$CurrentDirectory) {
  if (-not [string]::IsNullOrWhiteSpace($ExportDir)) {
    return Resolve-ExportPath $ExportDir
  }
  $default = if (-not [string]::IsNullOrWhiteSpace($CurrentDirectory)) { $CurrentDirectory } else { Join-Path $env:USERPROFILE 'hindsight-export' }
  if (-not [Environment]::UserInteractive) {
    return Resolve-ExportPath $default
  }
  $answer = Read-Host ("Durable Hindsight export directory (local folder or Git repository) [{0}]" -f $default)
  if ([string]::IsNullOrWhiteSpace($answer)) {
    return Resolve-ExportPath $default
  }
  return Resolve-ExportPath $answer
}

function Assert-ExportDirectory([string]$Directory) {
  if ($Directory -match '^(https?|ssh|file)://' -or $Directory -match '^[^@\s]+@[^:\s]+:') {
    throw "The export directory looks like a Git remote URL: $Directory. Enter a local folder here and provide the remote on the next prompt."
  }
  $target = [System.IO.Path]::GetFullPath($Directory).TrimEnd([char[]]@('\', '/'))
  $roots = @($DshHome, (Join-Path $env:USERPROFILE '.pg0'))
  foreach ($root in $roots) {
    $prefix = [System.IO.Path]::GetFullPath($root).TrimEnd([char[]]@('\', '/'))
    if ($target.Equals($prefix, [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($prefix + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "The export directory must stay outside the Harness home and the Hindsight database: $Directory"
    }
  }
  if (-not (Test-Path -LiteralPath $Directory)) {
    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  }
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw "The export path is not a directory: $Directory"
  }
  $isRepository = Test-Path -LiteralPath (Join-Path $Directory '.git')
  if (-not $isRepository) {
    $existing = @(Get-ChildItem -LiteralPath $Directory -Force -ErrorAction Stop)
    if ($existing.Count -gt 0) {
      throw "The export directory is not empty and is not a Git repository: $Directory. Choose an empty directory or an existing repository, or move its contents aside."
    }
  }
  $probe = Join-Path $Directory ('.hindsight-write-check-' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    Write-Utf8NoBom $probe 'ok'
  }
  catch {
    throw "The export directory is not writable: $Directory ($($_.Exception.Message))"
  }
  finally {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  }
  return $isRepository
}

function Get-ExportRepoOrigin([string]$Directory) {
  if (-not (Test-Path -LiteralPath (Join-Path $Directory '.git'))) {
    return ''
  }
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($null -eq $git) {
    return ''
  }
  $origin = Invoke-NativeCapture $git.Source @('-C', $Directory, 'remote', 'get-url', 'origin')
  if ($origin.ExitCode -ne 0) {
    return ''
  }
  return $origin.Output.Trim()
}

function Hide-RemoteSecret([string]$Remote) {
  if ([string]::IsNullOrWhiteSpace($Remote)) {
    return ''
  }
  return [regex]::Replace($Remote, '(?i)(://)[^/@\s]+@', '$1***@')
}

function Test-ExportRemoteUrl([string]$Remote) {
  if ([string]::IsNullOrWhiteSpace($Remote)) {
    return $false
  }
  $value = $Remote.Trim()
  if ($value -match '[\r\n\t]' -or $value.StartsWith('-')) {
    return $false
  }
  if ($value -match '^(https?|ssh|file)://[^\s]+$') {
    return $true
  }
  if ($value -match '^[^@\s]+@[^:\s]+:[^\s]+$') {
    return $true
  }
  return $false
}

function Resolve-ExportRemoteAnswer([string]$Proposed, [string]$Answer) {
  if ([string]::IsNullOrWhiteSpace($Answer)) {
    return $Proposed
  }
  $trimmed = $Answer.Trim()
  if ($trimmed -eq '-') {
    return ''
  }
  return $trimmed
}

function Resolve-ExportRemote([string]$CurrentRemote, [string]$RepoOrigin) {
  if (-not [string]::IsNullOrWhiteSpace($ExportRemote)) {
    if ($ExportRemote.Trim() -eq '-') {
      return ''
    }
    return $ExportRemote.Trim()
  }
  $proposed = if (-not [string]::IsNullOrWhiteSpace($CurrentRemote)) { $CurrentRemote } elseif (-not [string]::IsNullOrWhiteSpace($RepoOrigin)) { $RepoOrigin } else { '' }
  if (-not [Environment]::UserInteractive) {
    return $proposed
  }
  if ([string]::IsNullOrWhiteSpace($proposed)) {
    $answer = Read-Host 'Private Git remote for the export (leave empty for local-only; no push)'
  }
  else {
    $answer = Read-Host ("Private Git remote for the export [{0}] (Enter keeps it, '-' removes it)" -f (Hide-RemoteSecret $proposed))
  }
  return Resolve-ExportRemoteAnswer $proposed $answer
}

function Read-ExportConfig([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return @{}
  }
  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) {
      throw 'the file is empty'
    }
    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
  }
  catch {
    throw "Cannot read the machine-local export configuration at ${Path}: $($_.Exception.Message). Fix or remove the file and rerun."
  }
  if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) {
    throw "The machine-local export configuration at ${Path} must be a JSON object."
  }
  $result = @{}
  foreach ($property in $parsed.PSObject.Properties) {
    $result[$property.Name] = $property.Value
  }
  return $result
}

function Write-ExportConfig([string]$Path, [string]$Directory, [string]$Remote) {
  $config = Read-ExportConfig $Path
  $config['dir'] = $Directory
  if ([string]::IsNullOrWhiteSpace($Remote)) {
    if ($config.ContainsKey('remote')) {
      [void]$config.Remove('remote')
    }
  }
  else {
    $config['remote'] = $Remote
  }
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $json = ($config | ConvertTo-Json -Depth 8) + "`n"
  Write-Utf8NoBom $Path $json
  Restrict-File $Path
}

function Test-DeepSeekApiKey([string]$Key) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }
  catch {
    # Older Windows builds may not expose the symbol; the request below still reports the real failure.
  }
  try {
    Invoke-RestMethod -Method Get -Uri 'https://api.deepseek.com/models' -Headers @{ Authorization = "Bearer $Key" } -TimeoutSec 20 | Out-Null
  }
  catch {
    $detail = $_.Exception.Message
    if ($detail -match '401|Unauthorized') {
      throw 'The DeepSeek API key was rejected (HTTP 401). Check the key and rerun; nothing was changed.'
    }
    throw "Could not verify the DeepSeek API key at https://api.deepseek.com/models: $detail. Nothing was changed."
  }
}

function Test-ExportPushAccess([string]$Remote) {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($null -eq $git) {
    throw 'git is required to verify the export remote. Install Git for Windows and rerun.'
  }
  $temp = Join-Path $env:TEMP ('hindsight-export-access-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  try {
    $initialized = Invoke-NativeCapture $git.Source @('-C', $temp, 'init', '-q', '-b', 'main')
    if ($initialized.ExitCode -ne 0) {
      throw "Could not create a temporary Git repository: $($initialized.Output)"
    }
    $committed = Invoke-NativeCapture $git.Source @('-C', $temp, '-c', 'user.name=Hindsight Export Check', '-c', 'user.email=hindsight-export@localhost', 'commit', '--allow-empty', '-q', '-m', 'export access check')
    if ($committed.ExitCode -ne 0) {
      throw "Could not create the export access probe commit: $($committed.Output)"
    }
    $registered = Invoke-NativeCapture $git.Source @('-C', $temp, 'remote', 'add', 'origin', $Remote)
    if ($registered.ExitCode -ne 0) {
      throw "Could not register the export remote: $(Hide-RemoteSecret $registered.Output)"
    }
    $push = Invoke-NativeCapture $git.Source @('-C', $temp, 'push', '--dry-run', 'origin', 'HEAD:refs/heads/main')
    if ($push.ExitCode -eq 0) {
      return
    }
    if ($push.Output -match 'non-fast-forward|fetch first|\[rejected\]') {
      $probeRef = 'refs/heads/hindsight-export-access-' + [guid]::NewGuid().ToString('N')
      $probe = Invoke-NativeCapture $git.Source @('-C', $temp, 'push', '--dry-run', 'origin', ("HEAD:{0}" -f $probeRef))
      if ($probe.ExitCode -eq 0) {
        return
      }
      $push = $probe
    }
    $safe = (Hide-RemoteSecret $push.Output).Trim()
    if ($safe.Length -gt 1200) {
      $safe = $safe.Substring(0, 1200) + '...'
    }
    throw "Push access to the export remote was refused or unavailable: $safe"
  }
  finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Verify([int]$Port) {
  if ($SkipVerify) {
    Write-Skip 'Verification disabled by -SkipVerify'
    return
  }
  $bank = 'dsh-hindsight-setup-check'
  $marker = 'dsh-hindsight-setup-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $retainBody = @{
    items = @(@{
      content = "The $marker marker verifies the local Hindsight setup for DeepSeek Harness."
      context = 'setup-hindsight verification'
      document_id = 'setup-hindsight-check'
    })
  } | ConvertTo-Json -Depth 6
  Write-Step 'Verifying retain and recall through the local API'
  try {
    $retained = Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:{0}/v1/default/banks/{1}/memories" -f $Port, $bank) -ContentType 'application/json' -Body $retainBody -TimeoutSec 180
  }
  catch {
    throw "Retain verification failed: $($_.Exception.Message). See $DaemonLogPath."
  }
  if (-not $retained.success) {
    throw 'Retain verification returned an unsuccessful response.'
  }
  $recallBody = @{ query = 'What is the local Hindsight setup verification marker?'; max_tokens = 2000 } | ConvertTo-Json
  try {
    $recalled = Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:{0}/v1/default/banks/{1}/memories/recall" -f $Port, $bank) -ContentType 'application/json' -Body $recallBody -TimeoutSec 120
  }
  catch {
    throw "Recall verification failed: $($_.Exception.Message). See $DaemonLogPath."
  }
  $text = ($recalled.results | ForEach-Object { $_.text }) -join "`n"
  if ($text -notmatch [regex]::Escape($marker)) {
    throw "Recall did not return the retained marker. See $DaemonLogPath."
  }
  Write-Ok "Retain/recall verified with marker $marker"
}

function Set-HindsightPaths([string]$DshHomePath) {
  # Test-only isolation: validate-installer points this at a throwaway directory
  # so it can exercise the real phase without touching the machine's Hindsight state.
  $script:HindsightHome = if (-not [string]::IsNullOrWhiteSpace($env:DSH_SETUP_HINDSIGHT_HOME)) {
    $env:DSH_SETUP_HINDSIGHT_HOME
  }
  else {
    Join-Path $env:USERPROFILE '.hindsight'
  }
  $script:ProfilePath = Join-Path $script:HindsightHome 'embed'
  $script:KeyFilePath = Join-Path $script:HindsightHome 'deepseek.key'
  $script:AgentConfigPath = Join-Path $script:HindsightHome 'coding-agent.json'
  $script:CertBundlePath = Join-Path $script:HindsightHome 'windows-certs.pem'
  $script:StartScriptPath = Join-Path $script:HindsightHome 'start-hindsight.ps1'
  $script:DaemonLogPath = Join-Path $script:HindsightHome 'daemon.log'
  $script:ExportConfigPath = Join-Path $DshHomePath 'hindsight-export.json'
}

function Get-HindsightFacts {
  $lines = Get-EnvLines $ProfilePath
  $facts = [ordered]@{
    ProfileExists = (Test-Path -LiteralPath $ProfilePath)
    ProviderMatches = ((Get-EnvValue $lines 'HINDSIGHT_API_LLM_PROVIDER') -eq 'deepseek')
    ModelMatches = ((Get-EnvValue $lines 'HINDSIGHT_API_LLM_MODEL') -eq $Model)
    HostMatches = ((Get-EnvValue $lines 'HINDSIGHT_API_HOST') -eq '127.0.0.1')
    PortMatches = ((Get-EnvValue $lines 'HINDSIGHT_API_PORT') -eq [string]$ApiPort)
    DatabaseUrlPresent = -not [string]::IsNullOrWhiteSpace((Get-EnvValue $lines 'HINDSIGHT_EMBED_API_DATABASE_URL'))
    ApiVersionMatches = ((Get-EnvValue $lines 'HINDSIGHT_EMBED_API_VERSION') -eq $ApiVersion)
    KeyAvailable = $false
    ToolPinned = $false
    AgentConfigPresent = (Test-Path -LiteralPath $AgentConfigPath)
    CertBundlePresent = (Test-Path -LiteralPath $CertBundlePath)
    Healthy = $false
  }
  try {
    $facts['KeyAvailable'] = -not [string]::IsNullOrWhiteSpace((Resolve-DeepSeekKey $lines $false))
  }
  catch {
    $facts['KeyAvailable'] = $false
  }
  try {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($null -ne $uv) {
      $embed = Get-EmbedCommand $uv.Source $false
      $facts['ToolPinned'] = ($null -ne $embed)
    }
  }
  catch {
    $facts['ToolPinned'] = $false
  }
  $facts['Healthy'] = Test-HindsightHealth ([int]$ApiPort)
  return [pscustomobject]$facts
}

function Test-HindsightReadyFacts($Facts) {
  $reasons = [ordered]@{
    ProfileExists = 'the default Hindsight profile is missing'
    ProviderMatches = 'the Hindsight profile provider is not deepseek'
    ModelMatches = 'the Hindsight profile model differs from the desired model'
    HostMatches = 'the Hindsight profile host is not 127.0.0.1'
    PortMatches = 'the Hindsight profile port differs from the desired port'
    DatabaseUrlPresent = 'the Hindsight profile has no database URL'
    ApiVersionMatches = 'the Hindsight profile API version differs from the pinned version'
    KeyAvailable = 'no DeepSeek key is available without prompting'
    ToolPinned = 'hindsight-embed is not installed at the pinned version'
    AgentConfigPresent = 'the coding-agent configuration is missing'
    CertBundlePresent = 'the TLS trust bundle is missing'
    Healthy = 'the Hindsight daemon is not healthy with a connected database'
  }
  foreach ($name in $reasons.Keys) {
    if (-not $Facts.$name) {
      return [pscustomobject]@{ Ready = $false; Reason = $reasons[$name] }
    }
  }
  return [pscustomobject]@{ Ready = $true; Reason = '' }
}

function Invoke-HindsightGateSelfTest {
  $base = @{
    ProfileExists = $true
    ProviderMatches = $true
    ModelMatches = $true
    HostMatches = $true
    PortMatches = $true
    DatabaseUrlPresent = $true
    ApiVersionMatches = $true
    KeyAvailable = $true
    ToolPinned = $true
    AgentConfigPresent = $true
    CertBundlePresent = $true
    Healthy = $true
  }
  $ready = Test-HindsightReadyFacts ([pscustomobject]$base)
  if (-not $ready.Ready) {
    throw 'Readiness self-test rejected a fully configured runtime.'
  }
  $cases = @(
    @{ Name = 'profile'; Field = 'ProfileExists'; Expected = 'the default Hindsight profile is missing' },
    @{ Name = 'provider'; Field = 'ProviderMatches'; Expected = 'the Hindsight profile provider is not deepseek' },
    @{ Name = 'model'; Field = 'ModelMatches'; Expected = 'the Hindsight profile model differs from the desired model' },
    @{ Name = 'host'; Field = 'HostMatches'; Expected = 'the Hindsight profile host is not 127.0.0.1' },
    @{ Name = 'port'; Field = 'PortMatches'; Expected = 'the Hindsight profile port differs from the desired port' },
    @{ Name = 'database'; Field = 'DatabaseUrlPresent'; Expected = 'the Hindsight profile has no database URL' },
    @{ Name = 'api version'; Field = 'ApiVersionMatches'; Expected = 'the Hindsight profile API version differs from the pinned version' },
    @{ Name = 'key'; Field = 'KeyAvailable'; Expected = 'no DeepSeek key is available without prompting' },
    @{ Name = 'tool'; Field = 'ToolPinned'; Expected = 'hindsight-embed is not installed at the pinned version' },
    @{ Name = 'coding agent'; Field = 'AgentConfigPresent'; Expected = 'the coding-agent configuration is missing' },
    @{ Name = 'cert bundle'; Field = 'CertBundlePresent'; Expected = 'the TLS trust bundle is missing' },
    @{ Name = 'health'; Field = 'Healthy'; Expected = 'the Hindsight daemon is not healthy with a connected database' }
  )
  foreach ($case in $cases) {
    $facts = $base.Clone()
    $facts[$case.Field] = $false
    $verdict = Test-HindsightReadyFacts ([pscustomobject]$facts)
    if ($verdict.Ready -or $verdict.Reason -ne $case.Expected) {
      throw "Readiness self-test failed for $($case.Name)."
    }
  }
  Write-Ok 'Hindsight readiness self-test passed'
}

function Get-HindsightPlanLabel {
  if ($NoHindsight) { return 'skip (-NoHindsight)' }
  if ($RepairHindsight) { return 'repair (forced by -RepairHindsight)' }
  try {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($null -eq $uv) {
      return 'provision (uv is missing; the phase will be skipped)'
    }
    $readiness = Test-HindsightReadyFacts (Get-HindsightFacts)
    if ($readiness.Ready) {
      return 'skip (already configured)'
    }
    return "provision ($($readiness.Reason))"
  }
  catch {
    return "provision (the readiness check failed: $($_.Exception.Message))"
  }
}

function Show-HindsightPlan {
  try {
    $lines = Get-EnvLines $ProfilePath
    $databaseUrl = Resolve-DatabaseUrl $lines
    $readiness = Test-HindsightReadyFacts (Get-HindsightFacts)
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    $embedPath = $null
    if ($null -ne $uv) {
      try {
        $embedPath = Get-EmbedCommand $uv.Source $false
      }
      catch {
        $embedPath = $null
      }
    }
    $exportConfig = @{}
    try {
      $exportConfig = Read-ExportConfig $ExportConfigPath
    }
    catch {
      Write-Warn "cannot read the export configuration: $($_.Exception.Message)"
    }
    $plannedDir = if (-not [string]::IsNullOrWhiteSpace($ExportDir)) {
      Resolve-ExportPath $ExportDir
    }
    elseif (-not [string]::IsNullOrWhiteSpace([string]$exportConfig['dir'])) {
      Resolve-ExportPath ([string]$exportConfig['dir'])
    }
    else {
      Resolve-ExportPath (Join-Path $env:USERPROFILE 'hindsight-export')
    }
    $plannedRemote = if ($ExportRemote -eq '-') {
      ''
    }
    elseif (-not [string]::IsNullOrWhiteSpace($ExportRemote)) {
      $ExportRemote
    }
    elseif (-not [string]::IsNullOrWhiteSpace([string]$exportConfig['remote'])) {
      [string]$exportConfig['remote']
    }
    else {
      ''
    }
    if ([string]::IsNullOrWhiteSpace($plannedRemote) -and (Test-Path -LiteralPath (Join-Path $plannedDir '.git'))) {
      $plannedRemote = Get-ExportRepoOrigin $plannedDir
    }
    $plannedRemoteLabel = if ([string]::IsNullOrWhiteSpace($plannedRemote)) {
      'local only (no push)'
    }
    elseif ($SkipVerify) {
      (Hide-RemoteSecret $plannedRemote) + ' (push check would be skipped)'
    }
    else {
      (Hide-RemoteSecret $plannedRemote) + ' (push access would be verified)'
    }
    $planLabel = if ($RepairHindsight) {
      'repair (forced by -RepairHindsight)'
    }
    elseif ($readiness.Ready) {
      'skip (already configured)'
    }
    else {
      "provision ($($readiness.Reason))"
    }
    Write-Step 'Hindsight dry run: no changes will be made'
    Write-Host "    hindsight:     $planLabel"
    Write-Host "    profile:       $ProfilePath"
    Write-Host "    database:      $databaseUrl"
    Write-Host "    endpoint:      http://127.0.0.1:$ApiPort"
    Write-Host "    tool:          $(if ($null -eq $embedPath) { "will install hindsight-embed $ToolVersion" } else { $embedPath })"
    Write-Host "    export dir:    $plannedDir"
    Write-Host "    export remote: $plannedRemoteLabel"
    Write-Host "    key check:     $(if ($SkipVerify) { 'skip' } else { 'DeepSeek API' })"
    Write-Host "    logon task:    $(if ($NoLogonTask) { 'skip' } else { $TaskName })"
    Write-Host "    verification:  $(if ($SkipVerify) { 'skip' } else { 'retain/recall' })"
    if ($readiness.Ready -and -not $RepairHindsight) {
      Write-Skip 'a real run would skip the phase: already configured'
    }
    elseif (-not $readiness.Ready) {
      Write-Skip "a real run would provision or repair: $($readiness.Reason)"
    }
    else {
      Write-Skip 'a real run would repair because -RepairHindsight is set'
    }
  }
  catch {
    Write-Warn "cannot compute the Hindsight plan: $($_.Exception.Message)"
  }
}

function Invoke-HindsightPhase {
  Write-Step 'Hindsight'
  if ($NoHindsight) {
    Write-Skip 'Hindsight skipped (-NoHindsight)'
    return 'skipped (-NoHindsight)'
  }
  if (-not (Test-IsWindows)) {
    throw 'The Hindsight phase supports Windows only.'
  }
  if ($DryRun) {
    Show-HindsightPlan
    return 'planned'
  }
  try {
    if (-not $RepairHindsight) {
      $readiness = Test-HindsightReadyFacts (Get-HindsightFacts)
      if ($readiness.Ready) {
        Write-Skip 'Hindsight is already configured (profile, tool, key, daemon healthy); nothing to do'
        return 'already configured'
      }
      Write-Skip "Hindsight needs attention: $($readiness.Reason)"
    }
    else {
      Write-Step 'Repairing the Hindsight runtime (-RepairHindsight)'
    }
    try {
      $null = Get-UvCommand
    }
    catch {
      Write-Warn 'Hindsight was not provisioned: uv is not installed. Install it with "winget install --id astral-sh.uv -e" and rerun.'
      return 'skipped (uv missing)'
    }
    $lines = Get-EnvLines $ProfilePath
    $key = Resolve-DeepSeekKey $lines ([Environment]::UserInteractive)
    if ([string]::IsNullOrWhiteSpace($key)) {
      Write-Warn 'Hindsight was not provisioned: no DeepSeek key is available. Set DEEPSEEK_API_KEY, write ~/.hindsight/deepseek.key, or pass -DeepSeekApiKey, then rerun.'
      return 'skipped (key missing)'
    }
    Invoke-HindsightSetup -Key $key
    return 'provisioned'
  }
  catch {
    if ($HindsightOnly) {
      throw "The Hindsight phase failed: $($_.Exception.Message)"
    }
    throw "The setup profile was installed, but the Hindsight phase failed: $($_.Exception.Message)"
  }
}

function Invoke-HindsightSelfTest {
  $DshHome = [System.IO.Path]::GetFullPath($DshHome)
  Set-HindsightPaths $DshHome
  $cases = @(
    @{ Text = 'hindsight-embed v1.1.0'; Expected = $true },
    @{ Text = 'hindsight-embed v1.1.0rc1'; Expected = $false },
    @{ Text = 'hindsight-embed v1.1.0.1'; Expected = $false },
    @{ Text = "noise`nhindsight-embed v1.1.0`n- other"; Expected = $true }
  )
  foreach ($case in $cases) {
    if ((Test-EmbedVersion $case.Text $ToolVersion) -ne $case.Expected) {
      throw "Version self-test failed for: $($case.Text)"
    }
  }
  Write-Ok 'Version self-test passed'
  $duplicate = @(
    'HINDSIGHT_EMBED_API_DATABASE_URL=pg0://old-empty',
    'HINDSIGHT_EMBED_API_DATABASE_URL=pg0://current-populated'
  )
  if ((Get-EnvValue $duplicate 'HINDSIGHT_EMBED_API_DATABASE_URL') -ne 'pg0://current-populated') {
    throw 'Profile merge self-test did not use last-assignment-wins.'
  }
  $merged = @(Set-EnvValue $duplicate 'HINDSIGHT_EMBED_API_DATABASE_URL' 'pg0://current-populated')
  if (@($merged | Where-Object { $_ -match '^HINDSIGHT_EMBED_API_DATABASE_URL=' }).Count -ne 1) {
    throw 'Profile merge self-test left duplicate database assignments.'
  }
  Write-Ok 'Profile merge self-test passed'
  if (Test-HindsightProcess $PID) {
    throw 'Listener identity self-test accepted the current shell as a Hindsight daemon.'
  }
  Write-Ok 'Listener identity self-test passed'
  # The foreign-listener fixture (Start-Job plus a raw TCP listener) made
  # Defender/AMSI block the documented irm | iex form. The runtime refusal stays
  # in Start-HindsightDaemon and the manual acceptance; the ACL probe uses the
  # user profile because the temp directory can carry an inherited SACL.
  $probe = Join-Path $env:USERPROFILE ('hindsight-acl-' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    New-Item -ItemType File -Path $probe -Force | Out-Null
    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    $deny = Invoke-NativeCapture $icacls @($probe, '/deny', '*S-1-1-0:(R)')
    if ($deny.ExitCode -ne 0) {
      throw 'ACL self-test could not create the inherited/deny fixture.'
    }
    Restrict-File $probe
    Restrict-File $probe
    $probeAcl = Get-Acl -LiteralPath $probe
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $foreign = @($probeAcl.Access | Where-Object { $_.IdentityReference.Value -ne $identity })
    if ($foreign.Count -gt 0) {
      throw 'ACL self-test left foreign access entries.'
    }
  }
  finally {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  }
  Write-Ok 'ACL self-test passed'

  $remoteUrlCases = @(
    @{ Url = 'https://git.example.invalid/owner/private.git'; Expected = $true },
    @{ Url = 'ssh://git@git.example.invalid/owner/private.git'; Expected = $true },
    @{ Url = 'git@git.example.invalid:owner/private.git'; Expected = $true },
    @{ Url = ('file:///' + ($env:TEMP -replace '\\', '/') + '/hindsight-remote.git'); Expected = $true },
    @{ Url = ''; Expected = $false },
    @{ Url = '--upload-pack=evil'; Expected = $false },
    @{ Url = ($env:SystemDrive + '\repos\export.git'); Expected = $false }
  )
  foreach ($case in $remoteUrlCases) {
    if ((Test-ExportRemoteUrl $case.Url) -ne $case.Expected) {
      throw "Remote URL self-test failed for: $($case.Url)"
    }
  }
  if ((Hide-RemoteSecret 'https://user:token@git.example.invalid/x.git') -ne 'https://***@git.example.invalid/x.git') {
    throw 'Remote URL redaction self-test failed.'
  }
  Write-Ok 'Export remote URL self-test passed'
  $promptCases = @(
    @{ Proposed = 'https://git.example.invalid/x.git'; Answer = ''; Expected = 'https://git.example.invalid/x.git' },
    @{ Proposed = 'https://git.example.invalid/x.git'; Answer = '   '; Expected = 'https://git.example.invalid/x.git' },
    @{ Proposed = 'https://git.example.invalid/x.git'; Answer = '-'; Expected = '' },
    @{ Proposed = ''; Answer = 'https://git.example.invalid/y.git'; Expected = 'https://git.example.invalid/y.git' },
    @{ Proposed = ''; Answer = ''; Expected = '' }
  )
  foreach ($case in $promptCases) {
    if ((Resolve-ExportRemoteAnswer $case.Proposed $case.Answer) -ne $case.Expected) {
      throw "Export remote prompt self-test failed for answer '$($case.Answer)'."
    }
  }
  Write-Ok 'Export remote prompt self-test passed'
  $toolProbe = Join-Path $env:TEMP ('hindsight-tool-' + [guid]::NewGuid().ToString('N'))
  $binProbe = Join-Path $env:TEMP ('hindsight-bin-' + [guid]::NewGuid().ToString('N'))
  $userBinProbe = Join-Path $env:TEMP ('hindsight-userbin-' + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Force -Path (Join-Path $toolProbe 'hindsight-embed\Scripts') | Out-Null
    New-Item -ItemType Directory -Force -Path $binProbe | Out-Null
    New-Item -ItemType Directory -Force -Path $userBinProbe | Out-Null
    $toolExe = Join-Path $toolProbe 'hindsight-embed\Scripts\hindsight-embed.exe'
    New-Item -ItemType File -Force -Path $toolExe | Out-Null
    if ((Find-EmbedExecutable $toolProbe $binProbe $userBinProbe) -ne $toolExe) {
      throw 'Hindsight tool discovery self-test did not find the uv venv executable.'
    }
    Remove-Item -LiteralPath $toolExe -Force
    $binExe = Join-Path $binProbe 'hindsight-embed.exe'
    New-Item -ItemType File -Force -Path $binExe | Out-Null
    if ((Find-EmbedExecutable $toolProbe $binProbe $userBinProbe) -ne $binExe) {
      throw 'Hindsight tool discovery self-test did not find the uv bin executable.'
    }
  }
  finally {
    Remove-Item -Path $toolProbe, $binProbe, $userBinProbe -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Ok 'Hindsight tool discovery self-test passed'
  $configProbe = Join-Path $env:TEMP ('hindsight-export-config-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    Write-Utf8NoBom $configProbe '{"enabled":false,"remote":"https://git.example.invalid/old.git"}'
    Write-ExportConfig $configProbe (Join-Path $env:TEMP 'hindsight-export-self-test') 'https://git.example.invalid/new.git'
    $written = Read-ExportConfig $configProbe
    if ($written['enabled'] -ne $false -or $written['remote'] -ne 'https://git.example.invalid/new.git' -or $written['dir'] -notlike '*hindsight-export-self-test*') {
      throw 'Export config merge self-test failed.'
    }
    Write-ExportConfig $configProbe (Join-Path $env:TEMP 'hindsight-export-self-test') ''
    $removed = Read-ExportConfig $configProbe
    if ($removed.ContainsKey('remote')) {
      throw 'Export config removal self-test failed.'
    }
  }
  finally {
    Remove-Item -LiteralPath $configProbe -Force -ErrorAction SilentlyContinue
  }
  Write-Ok 'Export config self-test passed'
  $dirProbe = Join-Path $env:TEMP ('hindsight-export-dir-' + [guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Force -Path $dirProbe | Out-Null
    if (Assert-ExportDirectory $dirProbe) {
      throw 'An empty directory self-test was mistaken for a Git repository.'
    }
    Write-Utf8NoBom (Join-Path $dirProbe 'keep.txt') 'keep'
    $nonEmptyRefused = $false
    try {
      $null = Assert-ExportDirectory $dirProbe
    }
    catch {
      $nonEmptyRefused = $true
    }
    if (-not $nonEmptyRefused) {
      throw 'A non-empty plain export directory was accepted.'
    }
    Remove-Item -LiteralPath (Join-Path $dirProbe 'keep.txt') -Force
    $dirGit = Get-Command git -ErrorAction SilentlyContinue
    if ($null -ne $dirGit) {
      $gitInit = Invoke-NativeCapture $dirGit.Source @('-C', $dirProbe, 'init', '-q', '-b', 'main')
      if ($gitInit.ExitCode -ne 0) {
        throw 'Could not create the export directory repository fixture.'
      }
      if (-not (Assert-ExportDirectory $dirProbe)) {
        throw 'A Git export directory self-test was not recognized as a repository.'
      }
    }
  }
  finally {
    Remove-Item -LiteralPath $dirProbe -Recurse -Force -ErrorAction SilentlyContinue
  }
  $homeRefused = $false
  try {
    $null = Assert-ExportDirectory (Join-Path $DshHome 'hindsight-export-self-test')
  }
  catch {
    $homeRefused = $true
  }
  if (-not $homeRefused) {
    throw 'The Harness home was accepted as an export directory.'
  }
  Write-Ok 'Export directory self-test passed'
  $bareRemote = Join-Path $env:TEMP ('hindsight-remote-' + [guid]::NewGuid().ToString('N') + '.git')
  $gitCheck = Get-Command git -ErrorAction SilentlyContinue
  if ($null -ne $gitCheck) {
    try {
      $bare = Invoke-NativeCapture $gitCheck.Source @('init', '--bare', '-q', $bareRemote)
      if ($bare.ExitCode -ne 0) {
        throw 'Could not create the local bare remote fixture.'
      }
      $fileUrl = 'file:///' + ($bareRemote -replace '\\', '/')
      Test-ExportPushAccess $fileUrl
      $refused = $false
      try {
        Test-ExportPushAccess ($fileUrl + '-missing')
      }
      catch {
        $refused = $true
      }
      if (-not $refused) {
        throw 'Push access self-test accepted a missing remote.'
      }
    }
    finally {
      Remove-Item -LiteralPath $bareRemote -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Ok 'Export remote push self-test passed'
  }
  else {
    Write-Skip 'git is not installed; export remote push self-test skipped'
  }
  Invoke-HindsightGateSelfTest
}

function Invoke-HindsightSetup {
  param([string]$Key)
  Write-Step 'Hindsight one-click setup'
  $uvPath = Get-UvCommand
  Write-Ok "uv: $uvPath"
  $lines = Get-EnvLines $ProfilePath
  $profileBefore = @($lines)
  $exportConfig = Read-ExportConfig $ExportConfigPath
  if (-not $DryRun) {
    if (-not $SkipVerify) {
      Write-Step 'Verifying the DeepSeek API key'
      Test-DeepSeekApiKey $key
      Write-Ok 'DeepSeek API key verified'
    }
    else {
      Write-Skip 'DeepSeek API key verification skipped by -SkipVerify'
    }
    $configureExport = [Environment]::UserInteractive -or -not [string]::IsNullOrWhiteSpace($ExportDir) -or -not [string]::IsNullOrWhiteSpace($ExportRemote) -or (Test-Path -LiteralPath $ExportConfigPath)
    if ($configureExport) {
      Write-Step 'Configuring the durable memory export'
      $exportDirectory = Resolve-ExportDirectory ([string]$exportConfig['dir'])
      $null = Assert-ExportDirectory $exportDirectory
      $repoOrigin = Get-ExportRepoOrigin $exportDirectory
      $exportRemote = Resolve-ExportRemote ([string]$exportConfig['remote']) $repoOrigin
      if (-not [string]::IsNullOrWhiteSpace($exportRemote)) {
        if (-not (Test-ExportRemoteUrl $exportRemote)) {
          throw "The export remote is not a supported Git URL: $(Hide-RemoteSecret $exportRemote). Use https://, ssh://, git@host:path, or file://."
        }
        if (-not $SkipVerify) {
          Write-Step 'Verifying push access to the export remote'
          Test-ExportPushAccess $exportRemote
          Write-Ok ("Export remote push access verified: " + (Hide-RemoteSecret $exportRemote))
        }
        else {
          Write-Warn 'Export remote push access not verified (-SkipVerify)'
        }
      }
      else {
        Write-Skip 'No export remote configured; exports stay local'
      }
      Write-ExportConfig $ExportConfigPath $exportDirectory $exportRemote
      Write-Ok "Export directory: $exportDirectory"
      if ([string]::IsNullOrWhiteSpace($exportRemote)) {
        Write-Skip 'Export remote: none (local Git repository only)'
      }
      else {
        Write-Ok ("Export remote: " + (Hide-RemoteSecret $exportRemote))
      }
    }
    else {
      Write-Skip 'Export configuration unchanged (non-interactive; pass -ExportDir and/or -ExportRemote)'
    }
  }
  $databaseUrl = Resolve-DatabaseUrl $lines
  $embedPath = Get-EmbedCommand $uvPath $true


  if ($null -eq $embedPath) {
    throw 'hindsight-embed is not available after installation.'
  }

  if (-not (Test-Path -LiteralPath $HindsightHome)) {
    New-Item -ItemType Directory -Force -Path $HindsightHome | Out-Null
  }

  $profileIsNew = -not (Test-Path -LiteralPath $ProfilePath)
  if ($profileIsNew) {
    New-Item -ItemType File -Path $ProfilePath -Force | Out-Null
  }
  Restrict-File $ProfilePath

  $lines = Set-EnvValue $lines 'HINDSIGHT_EMBED_API_VERSION' $ApiVersion
  $lines = Set-EnvValue $lines 'HINDSIGHT_EMBED_API_DATABASE_URL' $databaseUrl
  $lines = Set-EnvValue $lines 'HINDSIGHT_API_LLM_PROVIDER' 'deepseek'
  $lines = Set-EnvValue $lines 'HINDSIGHT_API_LLM_MODEL' $Model
  $lines = Set-EnvValue $lines 'HINDSIGHT_API_LLM_API_KEY' $key
  $lines = Set-EnvValue $lines 'HINDSIGHT_API_HOST' '127.0.0.1'
  $lines = Set-EnvValue $lines 'HINDSIGHT_API_PORT' $ApiPort
  $lines = Set-EnvValue $lines 'HINDSIGHT_EMBED_DAEMON_IDLE_TIMEOUT' '0'

  if ($profileIsNew) {
    $lines = @('# Machine-local Hindsight embed profile. Do not commit.') + $lines
  }
  $profileChanged = $profileIsNew -or (($profileBefore -join "`n") -ne ($lines -join "`n"))
  Write-Utf8NoBom $ProfilePath ($lines -join "`n")
  Restrict-File $ProfilePath
  Write-Ok "Profile: $ProfilePath"

  Export-WindowsCertBundle $CertBundlePath
  Write-Ok "TLS trust bundle: $CertBundlePath"

  Write-StartScript $StartScriptPath $embedPath
  Start-HindsightDaemon $embedPath ([int]$ApiPort) $CertBundlePath $profileChanged
  Write-AgentConfig $AgentConfigPath ([int]$ApiPort)
  Register-LogonStart $StartScriptPath
  Invoke-Verify ([int]$ApiPort)

  Write-Step 'Hindsight is ready'
  Write-Host "    endpoint: http://127.0.0.1:$ApiPort"
  Write-Host "    logs:     $DaemonLogPath"
  Write-Host '    Rerun this script to update the runtime or repair the setup.'
}

# ---- Hindsight-only modes ----

if ($HindsightOnly -and $NoHindsight) {
  throw '-HindsightOnly and -NoHindsight cannot be combined.'
}
if ($NoHindsight -and $RepairHindsight) {
  throw '-NoHindsight and -RepairHindsight cannot be combined.'
}

$DshHome = [System.IO.Path]::GetFullPath($DshHome)
$env:DSH_HOME = $DshHome
Set-HindsightPaths $DshHome

if ($SelfTest) {
  Invoke-HindsightSelfTest
  return
}

if ($HindsightOnly) {
  try {
    $null = Invoke-HindsightPhase
  }
  catch {
    Write-Host ''
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    throw
  }
  return
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
  if ($NoDesktopShortcut) { Write-Host '    shortcut: skip' }
  else { Write-Host '    shortcut: create DeepSeek Harness (Administrator).lnk on the Desktop' }
  Write-Host "    hindsight: $(Get-HindsightPlanLabel)"
  if ($DryRun) {
    Write-Step "Dry run: no changes were made"
    return
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

  # The CLI can install the dependency without selecting its bundle, and an
  # existing entry is not moved by `dsh plugin add`. Ensure it is selected last
  # so the setup defaults outrank the profile's own bundles.
  $manifest = Read-JsonFile $profileManifestPath
  $bundles = @(Get-ProfileBundles $manifest)
  if ($bundles -notcontains $SetupPackage -or $bundles[$bundles.Count - 1] -ne $SetupPackage) {
    $reordered = @($bundles | Where-Object { $_ -ne $SetupPackage })
    $reordered += $SetupPackage
    $manifest = Set-ProfileBundles $manifest $reordered
    Save-JsonFile $profileManifestPath $manifest
    Write-Ok 'selected the setup bundle last so its defaults win'
  }

  if ($NoDesktopShortcut) {
    Write-Skip 'desktop administrator shortcut skipped'
  } else {
    Write-Step "Creating the administrator desktop shortcut"
    try {
      $desktopApp = Resolve-DesktopAppPath $appPath
      if ($null -eq $desktopApp) {
        Write-Warn 'DeepSeek Harness Desktop was not found; the administrator shortcut was not created'
      } else {
        $shortcutPath = New-AdminDesktopShortcut $desktopApp
        Write-Ok "administrator shortcut: $shortcutPath"
      }
    } catch {
      Write-Warn "could not create the administrator shortcut: $($_.Exception.Message)"
    }
  }

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
    $problems += "installed setup version $installedVersion is not the resolved $SetupVersion"
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

  $hindsightStatus = Invoke-HindsightPhase
  if ($installedVersion) { Write-Ok "setup version $installedVersion in $Profile" }
  if ($backupPath) { Write-Ok "profile backups: $backupDirectory" }
  Write-Host ''
  Write-Host "Profile: setup $installedVersion installed in '$Profile'."
  Write-Host "Hindsight: $hindsightStatus."
  Write-Host ''
  Write-Host "Installed. Start DeepSeek Harness and the setup bundle is active."
} catch {
  Write-Host ''
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($backupPath) { Write-Host "The profile manifest backup is at $backupPath" }
  if ($patchBackupPath) { Write-Host "The profile patch backup is at $patchBackupPath" }
  if ($cordisBackupPath) { Write-Host "The profile root backup is at $cordisBackupPath" }
  # The script also runs through Invoke-Expression: a terminating error keeps the
  # caller's window alive and still reports a non-zero exit for `pwsh -File`.
  throw
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
