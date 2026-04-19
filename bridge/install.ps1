<#
.SYNOPSIS
    Installs the Anya Native Messaging host for one or more Chromium-based browsers.

.DESCRIPTION
    - Writes the Native Messaging host manifest to %LOCALAPPDATA%\Anya\com.anya.bridge.json
    - Registers the manifest under HKCU for each requested browser, e.g.
        HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.anya.bridge
        HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.anya.bridge
        HKCU:\Software\Chromium\NativeMessagingHosts\com.anya.bridge
        HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.anya.bridge
        HKCU:\Software\Vivaldi\NativeMessagingHosts\com.anya.bridge
    - The same Native Messaging host manifest is shared by every browser; the
      extension ID baked into manifest.template.json works in all Chromium
      browsers because it is derived deterministically from the public key in
      extension/manifest.json.

    By default this script auto-detects every supported Chromium browser
    installed on the machine (HKCU\Software present, OR a known executable on
    disk) and installs the host for all of them. Use -Browsers to override.

.PARAMETER Browsers
    One or more of: edge, chrome, chromium, brave, vivaldi, all.
    Defaults to "all" (auto-detect installed browsers and register for each).

.PARAMETER Quiet
    Skip the interactive picker even when multiple browsers are detected.

.NOTES
    No admin required (HKCU only). Requires the bridge to be built (`npm run build`)
    so dist/host.js exists.
#>

[CmdletBinding()]
param(
    [string[]]$Browsers = @('all'),
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$HostName        = 'com.anya.bridge'
$ExtensionId     = 'oopdnihjfloclgnbbkebgeiipfadebid'
$BridgeDir       = $PSScriptRoot
$LauncherPath    = Join-Path $BridgeDir 'launcher.cmd'
$TemplatePath    = Join-Path $BridgeDir 'manifest.template.json'
$InstallDir      = Join-Path $env:LOCALAPPDATA 'Anya'
$ManifestPath    = Join-Path $InstallDir "$HostName.json"

# Browser registry roots. Anya works in every Chromium-based browser because:
#   - chrome.* APIs (sidePanel, tabs, scripting, bookmarks, nativeMessaging) are
#     identical across the family.
#   - Native Messaging hosts are registered per-browser, but the manifest itself
#     is browser-agnostic (allowed_origins points at the deterministic
#     extension ID).
$BrowserCatalog = @(
    @{ Id='edge';     Name='Microsoft Edge'; RegRoot='HKCU:\Software\Microsoft\Edge\NativeMessagingHosts';                ExtUrl='edge://extensions';   ExePaths=@("$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe","${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") },
    @{ Id='chrome';   Name='Google Chrome';  RegRoot='HKCU:\Software\Google\Chrome\NativeMessagingHosts';                 ExtUrl='chrome://extensions'; ExePaths=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
    @{ Id='chromium'; Name='Chromium';       RegRoot='HKCU:\Software\Chromium\NativeMessagingHosts';                      ExtUrl='chrome://extensions'; ExePaths=@("$env:LOCALAPPDATA\Chromium\Application\chrome.exe") },
    @{ Id='brave';    Name='Brave';          RegRoot='HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts';   ExtUrl='brave://extensions';  ExePaths=@("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe","${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe") },
    @{ Id='vivaldi';  Name='Vivaldi';        RegRoot='HKCU:\Software\Vivaldi\NativeMessagingHosts';                       ExtUrl='vivaldi://extensions';ExePaths=@("$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe","$env:ProgramFiles\Vivaldi\Application\vivaldi.exe") }
)

function Test-BrowserInstalled($b) {
    # Heuristic: HKCU\Software\<vendor>\<browser> exists, OR a known exe on disk.
    $rootKey = ($b.RegRoot -replace '\\NativeMessagingHosts$','')
    if (Test-Path $rootKey) { return $true }
    foreach ($p in $b.ExePaths) { if ($p -and (Test-Path $p)) { return $true } }
    return $false
}

# --- Sanity ----------------------------------------------------------------
if (-not (Test-Path $LauncherPath)) { throw "launcher.cmd not found at $LauncherPath" }
if (-not (Test-Path $TemplatePath)) { throw "manifest.template.json not found at $TemplatePath" }

# --- Resolve target browsers ----------------------------------------------
$normalized = $Browsers | ForEach-Object { $_.ToLowerInvariant() }
if ($normalized -contains 'all' -or $normalized.Count -eq 0) {
    $targets = $BrowserCatalog | Where-Object { Test-BrowserInstalled $_ }
    if ($targets.Count -eq 0) {
        Write-Host '[warn] No supported Chromium browser detected. Defaulting to Edge.' -ForegroundColor Yellow
        $targets = @($BrowserCatalog | Where-Object { $_.Id -eq 'edge' })
    }
    if ($targets.Count -gt 1 -and -not $Quiet) {
        Write-Host ''
        Write-Host 'Detected the following Chromium browsers:' -ForegroundColor Cyan
        for ($i = 0; $i -lt $targets.Count; $i++) {
            Write-Host ("  [{0}] {1}" -f ($i+1), $targets[$i].Name)
        }
        Write-Host ''
        $ans = Read-Host 'Install Anya for [a]ll detected, or pick numbers (e.g. 1,3) — Enter = all'
        if ($ans -and $ans.Trim() -and $ans.Trim().ToLowerInvariant() -ne 'a') {
            $picked = @()
            foreach ($tok in ($ans -split '[,\s]+')) {
                if (-not $tok) { continue }
                if ($tok -match '^\d+$') {
                    $idx = [int]$tok - 1
                    if ($idx -ge 0 -and $idx -lt $targets.Count) { $picked += $targets[$idx] }
                }
            }
            if ($picked.Count -gt 0) { $targets = $picked }
        }
    }
} else {
    $targets = @()
    foreach ($id in $normalized) {
        $b = $BrowserCatalog | Where-Object { $_.Id -eq $id }
        if (-not $b) { throw "Unknown browser '$id'. Valid: edge, chrome, chromium, brave, vivaldi, all." }
        $targets += $b
    }
}

# --- Write the shared manifest --------------------------------------------
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
$template = Get-Content -Raw -Path $TemplatePath
$jsonSafePath = $LauncherPath -replace '\\', '\\'
$manifestJson = $template -replace '__LAUNCHER_PATH__', $jsonSafePath
try { [void] ($manifestJson | ConvertFrom-Json -ErrorAction Stop) }
catch { throw "Generated manifest is not valid JSON: $_" }
Set-Content -Path $ManifestPath -Value $manifestJson -Encoding UTF8 -NoNewline
Write-Host "[OK] Wrote manifest: $ManifestPath"

# --- Register per browser -------------------------------------------------
$registered = @()
foreach ($b in $targets) {
    $regKey = Join-Path $b.RegRoot $HostName
    if (-not (Test-Path $regKey)) { New-Item -Path $regKey -Force | Out-Null }
    Set-ItemProperty -Path $regKey -Name '(Default)' -Value $ManifestPath
    $verify = (Get-ItemProperty -Path $regKey).'(default)'
    if ($verify -ne $ManifestPath) {
        throw "Registry verification failed for $($b.Name): expected '$ManifestPath', got '$verify'"
    }
    Write-Host ("[OK] Registered for {0,-15}-> {1}" -f $b.Name, $regKey)
    $registered += $b
}

# --- Summary --------------------------------------------------------------
Write-Host ''
Write-Host '=== Anya bridge installed ===' -ForegroundColor Green
Write-Host "Host name             : $HostName"
Write-Host "Extension ID (allowed): $ExtensionId"
Write-Host "Manifest path         : $ManifestPath"
Write-Host "Launcher path         : $LauncherPath"
Write-Host ''
Write-Host 'Next steps — load the unpacked extension in each browser:' -ForegroundColor Yellow
foreach ($b in $registered) {
    Write-Host ("  {0,-16} open {1} -> Developer mode -> Load unpacked -> .\extension\dist" -f $b.Name, $b.ExtUrl)
}
Write-Host ("  Confirm extension ID matches: {0}" -f $ExtensionId) -ForegroundColor DarkGray
