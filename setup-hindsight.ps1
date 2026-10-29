#Requires -Version 5.1
<#
.SYNOPSIS
  Provision the local Hindsight embed daemon used by DeepSeek Harness memory.

.DESCRIPTION
  Installs the pinned hindsight-embed tool, configures its default profile for
  DeepSeek on loopback, starts the daemon, registers a logon start, writes the
  machine-local DSH connection file, and verifies a retain/recall round-trip.
  It is idempotent: existing data, profile values, and the logon task are kept.

  The DeepSeek key is read from -DeepSeekApiKey, DEEPSEEK_API_KEY,
  ~/.hindsight/deepseek.key, the existing profile, or a secure prompt. It is
  never printed and never written to the repository. The script verifies the key
  against the DeepSeek API before changing anything.

  It then asks for the durable memory export location: a local directory (empty
  or a Git repository; a plain folder is fine and exports stay local) and an
  optional private Git remote. When a remote is configured, push access is
  verified with a dry-run push and the ACL-restricted machine-local
  ~/.dsh/hindsight-export.json is written. A rejected key, an invalid URL, or a
  failed push check refuses the setup.

.EXAMPLE
  $env:DEEPSEEK_API_KEY = '...'
  irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/setup-hindsight.ps1 | iex

.EXAMPLE
  pwsh -NoProfile -File setup-hindsight.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$DeepSeekApiKey,
  [string]$ExportDir,
  [string]$ExportRemote,
  [string]$ApiPort = '8888',
  [string]$Model = 'deepseek-chat',
  [switch]$NoLogonTask,
  [switch]$SkipVerify,
  [switch]$DryRun,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$ToolVersion = '1.1.0'
$ApiVersion = '1.1.0'
$HindsightHome = Join-Path $env:USERPROFILE '.hindsight'
$DshHome = if (-not [string]::IsNullOrWhiteSpace($env:DSH_HOME)) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$ExportConfigPath = Join-Path $DshHome 'hindsight-export.json'
$ProfilePath = Join-Path $HindsightHome 'embed'
$KeyFilePath = Join-Path $HindsightHome 'deepseek.key'
$AgentConfigPath = Join-Path $HindsightHome 'coding-agent.json'
$CertBundlePath = Join-Path $HindsightHome 'windows-certs.pem'
$StartScriptPath = Join-Path $HindsightHome 'start-hindsight.ps1'
$DaemonLogPath = Join-Path $HindsightHome 'daemon.log'
$TaskName = 'Hindsight embed daemon'

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "    $Message" -ForegroundColor Green
}

function Write-Skip([string]$Message) {
  Write-Host "    $Message" -ForegroundColor DarkGray
}

function Write-Warn([string]$Message) {
  Write-Host "    $Message" -ForegroundColor Yellow
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
  if (-not ('HindsightAclNative' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class HindsightAclNative
{
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool SetFileSecurity(
        string lpFileName,
        uint securityInformation,
        IntPtr pSecurityDescriptor);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string stringSecurityDescriptor,
        uint stringSdRevision,
        out IntPtr securityDescriptor,
        out uint securityDescriptorSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LocalFree(IntPtr hMem);
}
'@
  }
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  $sddl = $acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)
  $descriptor = [IntPtr]::Zero
  $descriptorSize = [uint32]0
  if (-not [HindsightAclNative]::ConvertStringSecurityDescriptorToSecurityDescriptor($sddl, 1, [ref]$descriptor, [ref]$descriptorSize)) {
    throw "Could not build the protected ACL for $Path."
  }
  try {
    if (-not [HindsightAclNative]::SetFileSecurity($Path, 4, $descriptor)) {
      $errorCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw "Could not apply the protected ACL to ${Path} (Windows error $errorCode)."
    }
  }
  finally {
    if ($descriptor -ne [IntPtr]::Zero) {
      [void][HindsightAclNative]::LocalFree($descriptor)
    }
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
    $secure = Read-Host -AsSecureString 'DeepSeek API key'
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
  throw 'DeepSeek API key is required. Set DEEPSEEK_API_KEY, write ~/.hindsight/deepseek.key, or pass -DeepSeekApiKey.'
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

# ---- main ----

if (-not (Test-IsWindows)) {
  throw 'This bootstrap supports Windows only.'
}

if ($SelfTest) {
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
  $probe = Join-Path $env:TEMP ('hindsight-acl-' + [guid]::NewGuid().ToString('N') + '.tmp')
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
  $probeListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $probeListener.Start()
  $probePort = [int]$probeListener.LocalEndpoint.Port
  $probeListener.Stop()
  $foreignJob = Start-Job -ScriptBlock {
    param($Port)
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    try {
      while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
          $stream = $client.GetStream()
          $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
          while ($true) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrEmpty($line)) { break }
          }
          $body = '{"status":"healthy","database":"connected"}'
          $response = "HTTP/1.1 200 OK`r`nContent-Type: application/json`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n$body"
          $bytes = [System.Text.Encoding]::UTF8.GetBytes($response)
          $stream.Write($bytes, 0, $bytes.Length)
          $stream.Flush()
        }
        finally {
          $client.Close()
        }
      }
    }
    finally {
      $listener.Stop()
    }
  } -ArgumentList $probePort
  try {
    $listenerDeadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $listenerDeadline -and $null -eq (Get-ListenerPid $probePort)) {
      Start-Sleep -Milliseconds 200
    }
    if ($null -eq (Get-ListenerPid $probePort)) {
      throw 'Foreign listener self-test could not start the probe listener.'
    }
    $rejected = $false
    try {
      Start-HindsightDaemon 'unused' $probePort $CertBundlePath $false
    }
    catch {
      if ($_.Exception.Message -notmatch 'not the expected Hindsight daemon') {
        throw
      }
      $rejected = $true
    }
    if (-not $rejected) {
      throw 'Foreign listener self-test accepted a non-Hindsight listener with a healthy payload.'
    }
  }
  finally {
    Stop-Job $foreignJob -ErrorAction SilentlyContinue
    Remove-Job $foreignJob -Force -ErrorAction SilentlyContinue
  }
  Write-Ok 'Foreign listener identity self-test passed'
  if ($null -ne (Get-ListenerPid $probePort)) {
    throw 'Unused-port discovery self-test reported a listener after the probe stopped.'
  }
  Write-Ok 'Unused-port discovery self-test passed'
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
  return
}

Write-Step 'Hindsight one-click setup'
$uvPath = Get-UvCommand
Write-Ok "uv: $uvPath"
$lines = Get-EnvLines $ProfilePath
$profileBefore = @($lines)
$key = Resolve-DeepSeekKey $lines (-not $DryRun)
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
$embedPath = Get-EmbedCommand $uvPath (-not $DryRun)

if ($DryRun) {
  $plannedDir = if (-not [string]::IsNullOrWhiteSpace($ExportDir)) { Resolve-ExportPath $ExportDir } elseif (-not [string]::IsNullOrWhiteSpace([string]$exportConfig['dir'])) { Resolve-ExportPath ([string]$exportConfig['dir']) } else { Resolve-ExportPath (Join-Path $env:USERPROFILE 'hindsight-export') }
  $plannedRemote = if ($ExportRemote -eq '-') { '' } elseif (-not [string]::IsNullOrWhiteSpace($ExportRemote)) { $ExportRemote } elseif (-not [string]::IsNullOrWhiteSpace([string]$exportConfig['remote'])) { [string]$exportConfig['remote'] } else { '' }
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
  Write-Step 'Dry run: no changes will be made'
  Write-Host "    profile:      $ProfilePath"
  Write-Host "    database:     $databaseUrl"
  Write-Host "    endpoint:     http://127.0.0.1:$ApiPort"
  Write-Host "    tool:         $(if ($null -eq $embedPath) { "will install hindsight-embed $ToolVersion" } else { $embedPath })"
  Write-Host "    export dir:   $plannedDir"
  Write-Host "    export remote: $plannedRemoteLabel"
  Write-Host "    key check:    $(if ($SkipVerify) { 'skip' } else { 'DeepSeek API' })"
  Write-Host "    logon task:   $(if ($NoLogonTask) { 'skip' } else { $TaskName })"
  Write-Host "    verification: $(if ($SkipVerify) { 'skip' } else { 'retain/recall' })"
  return
}

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
