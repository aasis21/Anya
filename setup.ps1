#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot setup for Anya — GitHub Copilot for your browser.

.DESCRIPTION
  Installs deps + builds both projects, runs the bridge ping smoke test, and
  registers the Native Messaging host for every detected Chromium browser
  (Edge, Chrome, Chromium, Brave, Vivaldi).

.PARAMETER Browsers
  One or more of: edge, chrome, chromium, brave, vivaldi, all (default).
  Forwarded to bridge\install.ps1.

.PARAMETER Quiet
  Skip the interactive browser picker when multiple Chromium browsers are
  detected (registers for all of them).

.PARAMETER SkipTest
  Skip the bridge ping/pong smoke test.

.PARAMETER Uninstall
  Remove every browser's registry entry + manifest, then exit.
#>
[CmdletBinding()]
param(
  [string[]]$Browsers = @('all'),
  [switch]$Quiet,
  [switch]$SkipTest,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "      $msg" -ForegroundColor DarkGray }

if ($Uninstall) {
  Step 'Uninstalling Anya bridge'
  Push-Location "$root\bridge"
  try { & .\uninstall.ps1 } finally { Pop-Location }
  Ok 'Bridge unregistered. Remove the unpacked extension manually from your browser.'
  return
}

# --- 0. Prereq check -------------------------------------------------------
Step 'Checking prerequisites'
$node = (& node --version) 2>$null
if (-not $node) { throw 'Node.js not found on PATH. Install Node 20+.' }
$major = [int](($node.TrimStart('v') -split '\.')[0])
if ($major -lt 20) { throw "Node $node is too old; need >= 20." }
Ok "Node $node"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm not found on PATH.' }
Ok 'npm available'

# --- 1. Bridge -------------------------------------------------------------
Step 'Building bridge'
Push-Location "$root\bridge"
try {
  if (-not (Test-Path node_modules)) {
    Info 'npm install (bridge)...'
    npm install --no-audit --no-fund | Out-Host
  }
  npm run build | Out-Host
  Ok 'bridge built -> bridge\dist\host.js'

  if (-not $SkipTest) {
    Info 'Running ping/pong smoke test...'
    npm test | Out-Host
    Ok 'bridge ping/pong verified'
  }

  Step 'Registering bridge with Chromium browsers (HKCU)'
  $installArgs = @{ Browsers = $Browsers }
  if ($Quiet) { $installArgs['Quiet'] = $true }
  & .\install.ps1 @installArgs | Out-Host
  Ok 'bridge registered as com.anya.bridge'
} finally {
  Pop-Location
}

# --- 2. Extension ---------------------------------------------------------
Step 'Building extension'
Push-Location "$root\extension"
try {
  if (-not (Test-Path node_modules)) {
    Info 'npm install (extension)...'
    npm install --no-audit --no-fund | Out-Host
  }
  npm run build | Out-Host
  Ok 'extension built -> extension\dist\'
} finally {
  Pop-Location
}

# --- 3. Done --------------------------------------------------------------
$extId = (Get-Content "$root\.extension-id.txt" -Raw).Trim()
$distPath = "$root\extension\dist"

Write-Host ''
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ' Anya — github copilot for your browser. ready.' -ForegroundColor Green
Write-Host '=========================================================' -ForegroundColor Green
Write-Host ''
Write-Host ' Load the unpacked extension (one-time, in each browser):' -ForegroundColor Yellow
Write-Host '   Edge      ->  edge://extensions'
Write-Host '   Chrome    ->  chrome://extensions'
Write-Host '   Brave     ->  brave://extensions'
Write-Host '   Vivaldi   ->  vivaldi://extensions'
Write-Host '   Chromium  ->  chrome://extensions'
Write-Host ''
Write-Host '   1. Toggle  Developer mode  (top-right or bottom-left)'
Write-Host "   2. Click  Load unpacked  ->  $distPath"
Write-Host "   3. Confirm extension ID = $extId"
Write-Host '   4. Pin the action icon, click it -> sidebar opens'
Write-Host ''
Write-Host ' Smoke test in the sidebar:' -ForegroundColor Yellow
Write-Host '   - Type  ping   -> should echo PONG  (bridge handshake)'
Write-Host '   - Type a real prompt -> should stream Copilot output'
Write-Host ''
Write-Host " Logs:        $env:LOCALAPPDATA\Anya\bridge.log"
Write-Host ' Uninstall:   .\setup.ps1 -Uninstall'
Write-Host ''
