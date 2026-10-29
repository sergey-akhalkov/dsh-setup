#Requires -Version 5.1
<#
.SYNOPSIS
  Restore Hindsight memory banks from the exporter's JSON tree.

.DESCRIPTION
  Rebuilds each bank's transfer archive from the exported JSON tree, verifies
  the manifest and every file checksum, submits the import through the local
  Hindsight REST API, waits for the operation, and compares the imported counts
  with the manifest. `restore` creates an absent bank; `merge` folds an
  archive's documents into an existing one.

  The exported tree may come from -From, from the machine-local
  ~/.dsh/hindsight-export.json directory, or from a private remote cloned with
  -Repo. When the local daemon is down, the script runs the documented
  provisioning script only when the tool is already installed; otherwise it
  offers the offline `hindsight-admin import-bank` command instead of
  installing anything silently.

  Nothing is written to the live Harness home or the Hindsight database by this
  script beyond the import it submits.

.PARAMETER From
  Exported JSON tree (the directory holding `banks/` and `index.json`).

.PARAMETER Repo
  Private Git remote to clone when the local export copy is gone.

.PARAMETER Bank
  Bank id(s) to restore; default is every bank in the tree.

.PARAMETER Mode
  `restore` (default) creates an absent bank; `merge` imports documents into an
  existing bank with a skip-on-conflict policy.

.PARAMETER TargetBank
  Restore target id (defaults to the archive's source bank). Only valid for one
  selected bank.

.PARAMETER DryRun
  Verify the tree, rebuild each archive in memory, and report the plan without
  contacting the server or changing any bank.

.PARAMETER IncludeHistory
  Also restore the operational history section when the archive carries it.

.PARAMETER SkipVerify
  Skip the post-import count comparison against the manifest.

.PARAMETER ApiUrl
  Local Hindsight endpoint; defaults to HINDSIGHT_API_URL or
  http://127.0.0.1:8888.

.PARAMETER ArchiveOut
  Directory that receives each rebuilt `.zip` (named after the bank folder).
  Meant for `-DryRun` inspection and for handing an archive to
  `hindsight-admin import-bank` by hand.

.EXAMPLE
  pwsh -NoProfile -File restore-hindsight.ps1 -From "$env:USERPROFILE\hindsight-export" -DryRun

.EXAMPLE
  pwsh -NoProfile -File restore-hindsight.ps1 -Repo https://example.invalid/private/hindsight-export.git
#>
[CmdletBinding()]
param(
  [string]$From,
  [string]$Repo,
  [string[]]$Bank,
  [ValidateSet('restore', 'merge')]
  [string]$Mode = 'restore',
  [string]$TargetBank,
  [switch]$DryRun,
  [switch]$IncludeHistory,
  [switch]$SkipVerify,
  [string]$ApiUrl,
  [string]$ArchiveOut
)

$ErrorActionPreference = 'Stop'
$script:SchemaVersion = 1
if ([string]::IsNullOrWhiteSpace($ApiUrl)) {
  $ApiUrl = if ($env:HINDSIGHT_API_URL) { $env:HINDSIGHT_API_URL } else { 'http://127.0.0.1:8888' }
}
$ApiUrl = $ApiUrl.TrimEnd('/')

try { Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop } catch { }
try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }
try { Add-Type -AssemblyName System.Net.Http -ErrorAction Stop } catch { }

function Write-Step([string]$Message) {
  Write-Host "restore-hindsight: $Message"
}

function Remove-Scratch {
  if ($script:ScratchZip -and (Test-Path -LiteralPath $script:ScratchZip)) {
    Remove-Item -LiteralPath $script:ScratchZip -Force -ErrorAction SilentlyContinue
  }
  if ($script:CloneRoot -and (Test-Path -LiteralPath $script:CloneRoot)) {
    Remove-Item -LiteralPath $script:CloneRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Stop-WithError([int]$Code, [string]$Message) {
  Remove-Scratch
  [Console]::Error.WriteLine("restore-hindsight: $Message")
  exit $Code
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-WithError 1 "missing file: $Path"
  }
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  } catch {
    Stop-WithError 1 "invalid JSON in ${Path}: $($_.Exception.Message)"
  }
}

function Resolve-ExportRoot {
  if ($Repo) {
    $clone = Join-Path ([System.IO.Path]::GetTempPath()) ("hindsight-restore-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    Write-Step "cloning the private export remote into a temporary directory"
    try {
      & git clone --quiet $Repo $clone
      if ($LASTEXITCODE -ne 0) { Stop-WithError 1 "git clone failed (exit $LASTEXITCODE)" }
    } catch {
      Stop-WithError 1 "cannot clone the export remote: $($_.Exception.Message)"
    }
    $script:CloneRoot = $clone
    return $clone
  }
  if ($From) {
    if (-not (Test-Path -LiteralPath $From -PathType Container)) { Stop-WithError 1 "export directory not found: $From" }
    return (Resolve-Path -LiteralPath $From).Path
  }
  $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
  $machineFile = Join-Path $dshHome 'hindsight-export.json'
  if (Test-Path -LiteralPath $machineFile -PathType Leaf) {
    $machine = Read-JsonFile $machineFile
    if ($machine.dir) { return [string]$machine.dir }
  }
  $fallback = Join-Path $env:USERPROFILE 'hindsight-export'
  if (Test-Path -LiteralPath $fallback -PathType Container) { return $fallback }
  Stop-WithError 1 "no export directory found; pass -From, -Repo, or set dir in $machineFile"
}

function Get-Banks([string]$Root) {
  $banks = @()
  $indexPath = Join-Path $Root 'index.json'
  if (Test-Path -LiteralPath $indexPath -PathType Leaf) {
    $index = Read-JsonFile $indexPath
    foreach ($entry in @($index.banks)) {
      if ($null -eq $entry) { continue }
      $folder = Join-Path (Join-Path $Root 'banks') ([string]$entry.folder)
      if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
        Stop-WithError 1 "index.json names a missing bank folder: $folder"
      }
      $banks += [pscustomobject]@{ BankId = [string]$entry.bank_id; Folder = $folder }
    }
  }
  if ($banks.Count -eq 0) {
    $banksDir = Join-Path $Root 'banks'
    if (Test-Path -LiteralPath $banksDir -PathType Container) {
      foreach ($directory in Get-ChildItem -LiteralPath $banksDir -Directory) {
        $metadataPath = Join-Path $directory.FullName 'export.json'
        if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { continue }
        $metadata = Read-JsonFile $metadataPath
        $banks += [pscustomobject]@{ BankId = [string]$metadata.bank_id; Folder = $directory.FullName }
      }
    }
  }
  return $banks
}

function Confirm-BankTree([string]$BankId, [string]$Folder) {
  $metadata = Read-JsonFile (Join-Path $Folder 'export.json')
  if ([int]$metadata.schema_version -ne $script:SchemaVersion) {
    Stop-WithError 1 "unsupported export metadata version $($metadata.schema_version) in $Folder"
  }
  if ([string]$metadata.bank_id -ne $BankId) {
    Stop-WithError 1 "export.json names bank '$($metadata.bank_id)', expected '$BankId'"
  }
  $manifest = Read-JsonFile (Join-Path $Folder 'manifest.json')
  if ([int]$manifest.schema_version -ne $script:SchemaVersion) {
    Stop-WithError 1 "unsupported transfer schema version $($manifest.schema_version) in $Folder"
  }
  if ([string]$manifest.archive_type -ne 'bank') {
    Stop-WithError 1 "archive in $Folder is not a whole-bank archive"
  }
  if ([string]$manifest.source_bank_id -ne $BankId) {
    Stop-WithError 1 "manifest names bank '$($manifest.source_bank_id)', expected '$BankId'"
  }
  foreach ($property in $metadata.checksums.PSObject.Properties) {
    $relative = ([string]$property.Name).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $file = Join-Path $Folder $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      Stop-WithError 1 "missing exported file: $($property.Name)"
    }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$property.Value).ToLowerInvariant()) {
      Stop-WithError 1 "checksum mismatch for $($property.Name) in $Folder"
    }
  }
  # Every archive entry must be covered by a checksum, not merely the listed ones.
  $declared = @($metadata.checksums.PSObject.Properties | ForEach-Object { [string]$_.Name })
  $root = (Resolve-Path -LiteralPath $Folder).Path
  $exportJson = Join-Path $root 'export.json'
  $stored = @(
    Get-ChildItem -LiteralPath $root -Recurse -File |
      Where-Object { $_.FullName -ne $exportJson } |
      ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\', '/') }
  )
  $undeclared = @($stored | Where-Object { $declared -notcontains $_ })
  if ($undeclared.Count -gt 0) {
    Stop-WithError 1 "file(s) without a checksum in export.json: $($undeclared -join ', ')"
  }
  return [pscustomobject]@{ Metadata = $metadata; Manifest = $manifest }
}

function New-TransferArchive([string]$Folder, [string]$ZipPath) {
  # Resolve first: Resolve-Path and Get-ChildItem can disagree on short (8.3)
  # paths, and a Substring over mismatched roots corrupts entry names.
  $root = (Resolve-Path -LiteralPath $Folder).Path
  $exportJson = Join-Path $root 'export.json'
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.FullName -ne $exportJson })
  if ($files.Count -eq 0) { Stop-WithError 1 "no archive entries found in $Folder" }
  # ZipArchiveMode.Create refuses an existing file; the temp path is reused per bank.
  if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
  $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
      $entry = $zip.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
      $output = $entry.Open()
      try {
        $input = [System.IO.File]::OpenRead($file.FullName)
        try { $input.CopyTo($output) } finally { $input.Dispose() }
      } finally {
        $output.Dispose()
      }
    }
  } finally {
    $zip.Dispose()
  }
  $read = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $count = $read.Entries.Count
  } finally {
    $read.Dispose()
  }
  if ($count -ne $files.Count) {
    Stop-WithError 1 "rebuilt archive holds $count entries, expected $($files.Count)"
  }
  return $count
}

function Invoke-Api([string]$Method, [string]$Path, $Body) {
  $parameters = @{
    Method      = $Method
    Uri         = "$ApiUrl$Path"
    TimeoutSec  = 30
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = ($Body | ConvertTo-Json -Depth 6 -Compress)
  }
  try {
    return Invoke-RestMethod @parameters
  } catch {
    Stop-WithError 5 "$Method $Path failed: $($_.Exception.Message)"
  }
}

function Send-ImportArchive([string]$OperationBank, [string]$ZipPath, [string]$ImportMode, [string]$Target) {
  $query = "mode=$ImportMode"
  if ($ImportMode -eq 'restore') {
    $query += '&target_bank_id=' + [uri]::EscapeDataString($Target)
    if ($IncludeHistory) { $query += '&include_history=true' }
  }
  $uri = "$ApiUrl/v1/default/banks/$([uri]::EscapeDataString($OperationBank))/transfer/import?$query"
  $client = [System.Net.Http.HttpClient]::new()
  $stream = [System.IO.File]::OpenRead($ZipPath)
  try {
    $content = [System.Net.Http.MultipartFormDataContent]::new()
    try {
      $fileContent = [System.Net.Http.StreamContent]::new($stream)
      $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/zip')
      $content.Add($fileContent, 'file', [System.IO.Path]::GetFileName($ZipPath))
      $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
      $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if (-not $response.IsSuccessStatusCode) {
        Stop-WithError 5 "import submit failed ($([int]$response.StatusCode)): $body"
      }
      return $body | ConvertFrom-Json
    } finally {
      $content.Dispose()
    }
  } finally {
    $stream.Dispose()
    $client.Dispose()
  }
}

function Wait-Operation([string]$OperationBank, [string]$OperationId) {
  $deadline = (Get-Date).AddSeconds(300)
  while ((Get-Date) -lt $deadline) {
    $operation = Invoke-Api 'Get' "/v1/default/banks/$([uri]::EscapeDataString($OperationBank))/operations/$([uri]::EscapeDataString($OperationId))" $null
    $status = [string]$operation.status
    if ($status -eq 'completed') { return $operation }
    if ($status -eq 'failed' -or $status -eq 'cancelled') {
      Stop-WithError 5 "import of bank operation $OperationId $status`: $($operation.error_message)"
    }
    Start-Sleep -Seconds 1
  }
  Stop-WithError 5 "timed out waiting for import operation $OperationId"
}

function Compare-ManifestCounts($Manifest, $Operation) {
  $pairs = @(
    @{ Label = 'documents'; Expected = [int]$Manifest.document_count; Key = 'documents_imported' },
    @{ Label = 'facts'; Expected = [int]$Manifest.fact_count; Key = 'facts_imported' },
    @{ Label = 'observations'; Expected = [int]$Manifest.observation_count; Key = 'observations_imported' },
    @{ Label = 'mental models'; Expected = [int]$Manifest.mental_model_count; Key = 'mental_models_imported' },
    @{ Label = 'knowledge pages'; Expected = [int]$Manifest.knowledge_page_count; Key = 'knowledge_pages_imported' }
  )
  $mismatches = @()
  foreach ($pair in $pairs) {
    $actual = $Operation.result_metadata.($pair.Key)
    if ($null -eq $actual) { $actual = 0 }
    if ([int]$actual -ne [int]$pair.Expected) {
      $mismatches += "  $($pair.Label): expected $($pair.Expected), imported $([int]$actual)"
    }
  }
  if ($mismatches.Count -gt 0) {
    [Console]::Error.WriteLine("restore-hindsight: imported counts differ from the manifest:")
    foreach ($line in $mismatches) { [Console]::Error.WriteLine($line) }
    exit 3
  }
}

function Test-Daemon {
  try {
    $health = Invoke-RestMethod -Method Get -Uri "$ApiUrl/health" -TimeoutSec 5 -ErrorAction Stop
    return ([string]$health.status -eq 'healthy')
  } catch {
    return $false
  }
}

function Get-ExistingBanks {
  $ids = @()
  $offset = 0
  while ($true) {
    $listed = Invoke-Api 'Get' "/v1/default/banks?limit=100&offset=$offset" $null
    $page = @($listed.banks)
    foreach ($entry in $page) {
      if ($null -ne $entry) { $ids += [string]$entry.bank_id }
    }
    $total = if ($null -ne $listed.total) { [int]$listed.total } else { $ids.Count }
    if ($page.Count -eq 0 -or $ids.Count -ge $total) { break }
    $offset += $page.Count
  }
  return $ids
}

function Initialize-Daemon {
  if (Test-Daemon) { return }
  $provisioning = Join-Path $PSScriptRoot 'setup-hindsight.ps1'
  $tool = Get-Command hindsight-embed -ErrorAction SilentlyContinue
  if ($tool -and (Test-Path -LiteralPath $provisioning -PathType Leaf)) {
    Write-Step 'the daemon is not healthy; running the documented provisioning script (no install)'
    $provisioned = $false
    try {
      & $provisioning -SkipVerify
      $provisioned = $true
    } catch {
      # A failed provision must not abort the restore: the offline import is next.
      Write-Step "provisioning failed ($($_.Exception.Message)); trying the offline import instead"
    }
    if ($provisioned) {
      $deadline = (Get-Date).AddSeconds(180)
      while ((Get-Date) -lt $deadline) {
        if (Test-Daemon) { return }
        Start-Sleep -Seconds 3
      }
    }
  }
}

function Invoke-AdminImport([string]$ZipPath, [string]$Target) {
  $admin = Get-Command hindsight-admin -ErrorAction SilentlyContinue
  if (-not $admin) {
    # The temporary archive is deleted on exit, so keep a durable copy for the
    # manual command that follows.
    $kept = Join-Path ([System.IO.Path]::GetTempPath()) ('hindsight-archive-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.zip')
    Copy-Item -LiteralPath $ZipPath -Destination $kept -Force
    [Console]::Error.WriteLine('restore-hindsight: the local daemon is not healthy and hindsight-admin is not installed.')
    [Console]::Error.WriteLine("  The rebuilt archive was kept at: $kept")
    [Console]::Error.WriteLine('  Install the runtime with setup-hindsight.ps1, then import offline:')
    [Console]::Error.WriteLine("  hindsight-admin import-bank --archive `"$kept`" --target-bank `"$Target`"")
    exit 4
  }
  Write-Step "daemon unavailable; falling back to hindsight-admin import-bank for $Target"
  $arguments = @('import-bank', '--archive', $ZipPath, '--target-bank', $Target)
  if ($IncludeHistory) { $arguments += '--include-history' }
  & hindsight-admin @arguments
  if ($LASTEXITCODE -ne 0) { Stop-WithError 5 "hindsight-admin import-bank failed (exit $LASTEXITCODE)" }
}

function New-OperationBankId {
  return 'hindsight-restore-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
}

# ---- main ----

if ($Repo -and $From) { Stop-WithError 1 'use either -From or -Repo, not both' }

$root = Resolve-ExportRoot

try {
  $banks = @(Get-Banks $root)
  if ($Bank) {
    $unknown = @($Bank | Where-Object { $banks.BankId -notcontains $_ })
    if ($unknown.Count -gt 0) {
      Stop-WithError 1 "bank(s) not found in the export tree: $($unknown -join ', ')"
    }
    $banks = @($banks | Where-Object { $Bank -contains $_.BankId })
  }
  if ($banks.Count -eq 0) { Stop-WithError 1 "no exported banks found under $root" }
  if ($TargetBank -and $banks.Count -gt 1) {
    Stop-WithError 1 '-TargetBank is only valid when one bank is selected; pass -Bank'
  }

  $existing = @()
  $daemonAvailable = $true
  if (-not $DryRun) {
    Initialize-Daemon | Out-Null
    if (-not (Test-Daemon)) { $daemonAvailable = $false }
    if ($daemonAvailable) { $existing = @(Get-ExistingBanks) }
  }

  $temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("hindsight-restore-" + [guid]::NewGuid().ToString('N') + '.zip')
  $script:ScratchZip = $temporary
  try {
    foreach ($selected in $banks) {
      $verified = Confirm-BankTree $selected.BankId $selected.Folder
      $entries = New-TransferArchive $selected.Folder $temporary
      $target = if ($TargetBank) { $TargetBank } else { $selected.BankId }
      $counts = $verified.Manifest

      if ($DryRun) {
        if ($ArchiveOut) {
          if (-not (Test-Path -LiteralPath $ArchiveOut -PathType Container)) {
            New-Item -ItemType Directory -Force -Path $ArchiveOut | Out-Null
          }
          $copy = Join-Path $ArchiveOut ((Split-Path -Leaf $selected.Folder) + '.zip')
          Copy-Item -LiteralPath $temporary -Destination $copy -Force
          Write-Step "wrote the rebuilt archive to $copy"
        }
        Write-Step ("would restore bank '{0}' into '{1}' ({2} archive entries, {3} documents, {4} facts)" -f $selected.BankId, $target, $entries, $counts.document_count, $counts.fact_count)
        continue
      }

      if (-not $daemonAvailable) {
        Invoke-AdminImport $temporary $target
        continue
      }

      if ($Mode -eq 'merge') {
        if ($existing -notcontains $target) {
          Stop-WithError 1 "merge target '$target' does not exist; use -Mode restore to create it"
        }
        $submission = Send-ImportArchive -OperationBank $target -ZipPath $temporary -ImportMode 'merge' -Target $target
        $operation = Wait-Operation $target ([string]$submission.operation_id)
        $metadata = $operation.result_metadata
        Write-Step ("merged bank '{0}': {1} documents imported, {2} skipped" -f $target, $metadata.documents_imported, $metadata.documents_skipped)
        continue
      }

      if ($existing -contains $target) {
        Stop-WithError 2 "target bank '$target' already exists; a restore needs an absent bank. Use -Mode merge to recover documents into it."
      }
      $operationBank = New-OperationBankId
      Invoke-Api 'Put' "/v1/default/banks/$([uri]::EscapeDataString($operationBank))" @{} | Out-Null
      try {
        $submission = Send-ImportArchive -OperationBank $operationBank -ZipPath $temporary -ImportMode 'restore' -Target $target
        $operation = Wait-Operation $operationBank ([string]$submission.operation_id)
        if (-not $SkipVerify) { Compare-ManifestCounts $counts $operation }
        Write-Step ("restored bank '{0}' -> '{1}': {2} documents, {3} facts, {4} observations" -f $selected.BankId, $target, $operation.result_metadata.documents_imported, $operation.result_metadata.facts_imported, $operation.result_metadata.observations_imported)
      } finally {
        try { Invoke-Api 'Delete' "/v1/default/banks/$([uri]::EscapeDataString($operationBank))" $null | Out-Null } catch { }
      }
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
} finally {
  if ($script:CloneRoot -and (Test-Path -LiteralPath $script:CloneRoot)) {
    Remove-Item -LiteralPath $script:CloneRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Step 'done'
exit 0
