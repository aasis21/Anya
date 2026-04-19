#Requires -Version 7.0
<#
.SYNOPSIS
  One-line bootstrap installer for Anya.

.DESCRIPTION
  Clones (or updates) the Anya repo into $InstallDir, then runs setup.ps1
  to build the bridge + extension and register the native-messaging host.

  Designed to be run with:
    iwr -useb https://raw.githubusercontent.com/aasis21/Anya/main/install.ps1 | iex

  Or with arguments via:
    & ([scriptblock]::Create((iwr -useb https://raw.githubusercontent.com/aasis21/Anya/main/install.ps1))) -Branch dev

.PARAMETER InstallDir
  Where to clone the repo. Defaults to ~/Anya.

.PARAMETER Branch
  Git branch to check out. Defaults to main.

.PARAMETER Browsers
  Forwarded to setup.ps1 (-Browsers). Defaults to all detected.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $HOME 'Anya'),
  [string]$Branch = 'main',
  [string[]]$Browsers = @('all')
)

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/aasis21/Anya.git'

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "      $msg" -ForegroundColor DarkGray }

Step 'Checking prerequisites'
foreach ($cmd in @('git', 'node', 'npm')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd not found on PATH. Install it first."
  }
  Ok "$cmd available"
}

if (Test-Path (Join-Path $InstallDir '.git')) {
  Step "Updating existing checkout at $InstallDir"
  Push-Location $InstallDir
  try {
    git fetch --quiet origin
    git checkout --quiet $Branch
    git pull --ff-only --quiet origin $Branch
    Ok "synced to origin/$Branch"
  } finally { Pop-Location }
} else {
  Step "Cloning $repo into $InstallDir"
  git clone --quiet --branch $Branch $repo $InstallDir
  Ok 'cloned'
}

Step 'Running setup.ps1'
Push-Location $InstallDir
try {
  & (Join-Path '.' 'setup.ps1') -Browsers $Browsers -Quiet
} finally { Pop-Location }
