#Requires -Version 5.1
<#
.SYNOPSIS
  Run the local Hindsight provisioning phase of the dsh-setup installer.

.DESCRIPTION
  Hindsight provisioning now lives in install.ps1 as a second phase. This entry
  point keeps the documented setup-hindsight.ps1 URL and the restore-hindsight.ps1
  provisioning call working: it runs the local sibling install.ps1 when present,
  otherwise the published installer, and invokes it with -HindsightOnly. It
  contains no provisioning logic.

  The same options as the installer's Hindsight phase are accepted and forwarded
  unchanged.

.EXAMPLE
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

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sibling = $null
if ($PSScriptRoot) {
  $sibling = Join-Path $PSScriptRoot 'install.ps1'
}
if ($sibling -and (Test-Path -LiteralPath $sibling -PathType Leaf)) {
  & $sibling -HindsightOnly @PSBoundParameters
  return
}

$installerUrl = 'https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1'
$source = Invoke-RestMethod -Uri $installerUrl -TimeoutSec 60
& ([scriptblock]::Create([string]$source)) -HindsightOnly @PSBoundParameters
