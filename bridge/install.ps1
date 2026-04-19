<#
.SYNOPSIS
    Installs the Anya Native Messaging host for one or more Chromium-based
    browsers on Windows, macOS, or Linux.

.DESCRIPTION
    Cross-platform PowerShell 7+ installer. Detects the host OS and
    registers `com.anya.bridge` for each requested browser:

      Windows  -> HKCU:\Software\<vendor>\<browser>\NativeMessagingHosts\com.anya.bridge
                  (manifest written once to %LOCALAPPDATA%\Anya\com.anya.bridge.json)
      macOS    -> ~/Library/Application Support/<vendor>/<browser>/NativeMessagingHosts/com.anya.bridge.json
      Linux    -> ~/.config/<vendor>/<browser>/NativeMessagingHosts/com.anya.bridge.json

    The same Native Messaging host manifest content is shared by every
    browser; the extension ID baked into the manifest works in all
    Chromium browsers because it is derived deterministically from the
    public key in extension/manifest.json.

    By default this script auto-detects every supported Chromium browser
    installed on the machine and installs the host for all of them. Use
    -Browsers to override.

.PARAMETER Browsers
    One or more of: edge, chrome, chromium, brave, vivaldi, arc, all.
    Defaults to "all" (auto-detect installed browsers and register for each).

.PARAMETER Quiet
    Skip the interactive picker even when multiple browsers are detected.

.NOTES
    Requires PowerShell 7.0+ on every OS (uses $IsWindows / $IsMacOS / $IsLinux).
    No admin / sudo required (HKCU + per-user dirs only). Requires the
    bridge to be built (`npm run build`) so dist/host.js exists.
#>

#Requires -Version 7.0

[CmdletBinding()]
param(
    [string[]]$Browsers = @('all'),
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$HostName     = 'com.anya.bridge'
$ExtensionId  = 'oopdnihjfloclgnbbkebgeiipfadebid'
$BridgeDir    = $PSScriptRoot
$TemplatePath = Join-Path $BridgeDir 'manifest.template.json'
$LauncherCmd  = Join-Path $BridgeDir 'launcher.cmd'
$LauncherSh   = Join-Path $BridgeDir 'launcher.sh'

# --- OS gate ---------------------------------------------------------------
if (-not ($IsWindows -or $IsMacOS -or $IsLinux)) {
    throw 'Unsupported OS — Anya install supports Windows, macOS, and Linux.'
}

# --- Anya data directory (mirrors bridge/src/paths.ts) -------------------
function Get-AnyaDataDir {
    if ($IsWindows) {
        $base = $env:LOCALAPPDATA
        if (-not $base) { $base = Join-Path $env:USERPROFILE 'AppData\Local' }
        return Join-Path $base 'Anya'
    } elseif ($IsMacOS) {
        return Join-Path $HOME 'Library/Application Support/Anya'
    } else {
        $xdg = $env:XDG_DATA_HOME
        if ($xdg) { return Join-Path $xdg 'Anya' }
        return Join-Path $HOME '.local/share/Anya'
    }
}

# --- Browser catalog -------------------------------------------------------
# Each browser entry has cross-platform metadata plus a per-OS subtable. Only
# the row matching the current OS is consulted. Probes are cheap heuristics:
# we check the most reliable indicator (registry on Win, .app bundle on
# macOS, binary on PATH on Linux) plus a couple of fallback paths.
$BrowserCatalog = @(
    @{
        Id   = 'edge';     Name = 'Microsoft Edge';
        Win  = @{
            RegRoot  = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts';
            ExePaths = @("$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe");
            ExtUrl   = 'edge://extensions';
        };
        Mac  = @{
            ManifestDir = "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts";
            AppPaths    = @('/Applications/Microsoft Edge.app', "$HOME/Applications/Microsoft Edge.app");
            ExtUrl      = 'edge://extensions';
        };
        Linux = @{
            ManifestDir = "$HOME/.config/microsoft-edge/NativeMessagingHosts";
            Binaries    = @('microsoft-edge', 'microsoft-edge-stable', 'microsoft-edge-beta', 'microsoft-edge-dev');
            ExtUrl      = 'edge://extensions';
        };
    },
    @{
        Id   = 'chrome';   Name = 'Google Chrome';
        Win  = @{
            RegRoot  = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts';
            ExePaths = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe");
            ExtUrl   = 'chrome://extensions';
        };
        Mac  = @{
            ManifestDir = "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts";
            AppPaths    = @('/Applications/Google Chrome.app', "$HOME/Applications/Google Chrome.app");
            ExtUrl      = 'chrome://extensions';
        };
        Linux = @{
            ManifestDir = "$HOME/.config/google-chrome/NativeMessagingHosts";
            Binaries    = @('google-chrome', 'google-chrome-stable', 'chrome');
            ExtUrl      = 'chrome://extensions';
        };
    },
    @{
        Id   = 'chromium'; Name = 'Chromium';
        Win  = @{
            RegRoot  = 'HKCU:\Software\Chromium\NativeMessagingHosts';
            ExePaths = @("$env:LOCALAPPDATA\Chromium\Application\chrome.exe");
            ExtUrl   = 'chrome://extensions';
        };
        Mac  = @{
            ManifestDir = "$HOME/Library/Application Support/Chromium/NativeMessagingHosts";
            AppPaths    = @('/Applications/Chromium.app', "$HOME/Applications/Chromium.app");
            ExtUrl      = 'chrome://extensions';
        };
        Linux = @{
            ManifestDir = "$HOME/.config/chromium/NativeMessagingHosts";
            Binaries    = @('chromium', 'chromium-browser');
            ExtUrl      = 'chrome://extensions';
        };
    },
    @{
        Id   = 'brave';    Name = 'Brave';
        Win  = @{
            RegRoot  = 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts';
            ExePaths = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe");
            ExtUrl   = 'brave://extensions';
        };
        Mac  = @{
            ManifestDir = "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts";
            AppPaths    = @('/Applications/Brave Browser.app', "$HOME/Applications/Brave Browser.app");
            ExtUrl      = 'brave://extensions';
        };
        Linux = @{
            ManifestDir = "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts";
            Binaries    = @('brave-browser', 'brave', 'brave-browser-stable');
            ExtUrl      = 'brave://extensions';
        };
    },
    @{
        Id   = 'vivaldi';  Name = 'Vivaldi';
        Win  = @{
            RegRoot  = 'HKCU:\Software\Vivaldi\NativeMessagingHosts';
            ExePaths = @("$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe", "$env:ProgramFiles\Vivaldi\Application\vivaldi.exe");
            ExtUrl   = 'vivaldi://extensions';
        };
        Mac  = @{
            ManifestDir = "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts";
            AppPaths    = @('/Applications/Vivaldi.app', "$HOME/Applications/Vivaldi.app");
            ExtUrl      = 'vivaldi://extensions';
        };
        Linux = @{
            ManifestDir = "$HOME/.config/vivaldi/NativeMessagingHosts";
            Binaries    = @('vivaldi', 'vivaldi-stable', 'vivaldi-snapshot');
            ExtUrl      = 'vivaldi://extensions';
        };
    },
    @{
        Id   = 'arc';      Name = 'Arc';
        Win  = @{
            RegRoot  = 'HKCU:\Software\TheBrowserCompany\Arc\NativeMessagingHosts';
            ExePaths = @("$env:LOCALAPPDATA\Programs\Arc\Arc.exe", "$env:ProgramFiles\Arc\Arc.exe");
            ExtUrl   = 'arc://extensions';
        };
        Mac  = @{
            ManifestDir = "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts";
            AppPaths    = @('/Applications/Arc.app', "$HOME/Applications/Arc.app");
            ExtUrl      = 'arc://extensions';
        };
        # Arc has no Linux build (as of writing). Entry omitted intentionally —
        # the Linux probe filters this browser out.
        Linux = $null;
    }
)

function Get-OsRow($b) {
    if ($IsWindows) { return $b.Win }
    if ($IsMacOS)   { return $b.Mac }
    if ($IsLinux)   { return $b.Linux }
    return $null
}

function Test-BrowserInstalled($b) {
    $row = Get-OsRow $b
    if (-not $row) { return $false }
    if ($IsWindows) {
        $rootKey = ($row.RegRoot -replace '\\NativeMessagingHosts$','')
        if (Test-Path $rootKey) { return $true }
        foreach ($p in $row.ExePaths) { if ($p -and (Test-Path $p)) { return $true } }
        return $false
    } elseif ($IsMacOS) {
        foreach ($p in $row.AppPaths) { if ($p -and (Test-Path $p)) { return $true } }
        # Manifest dir already present means a prior browser run created it.
        if ($row.ManifestDir -and (Test-Path (Split-Path $row.ManifestDir -Parent))) { return $true }
        return $false
    } else {
        foreach ($bin in $row.Binaries) {
            if ($bin -and (Get-Command $bin -ErrorAction SilentlyContinue)) { return $true }
        }
        if ($row.ManifestDir -and (Test-Path (Split-Path $row.ManifestDir -Parent))) { return $true }
        return $false
    }
}

# --- Sanity ----------------------------------------------------------------
if (-not (Test-Path $TemplatePath)) { throw "manifest.template.json not found at $TemplatePath" }
if ($IsWindows) {
    if (-not (Test-Path $LauncherCmd)) { throw "launcher.cmd not found at $LauncherCmd" }
} else {
    if (-not (Test-Path $LauncherSh)) { throw "launcher.sh not found at $LauncherSh" }
    # Ensure the launcher is executable. PS Core has no built-in chmod cmdlet.
    try { & /bin/chmod '+x' $LauncherSh } catch { Write-Host "[warn] could not chmod +x launcher.sh: $_" -ForegroundColor Yellow }
}

# --- Resolve target browsers ----------------------------------------------
$normalized = $Browsers | ForEach-Object { $_.ToLowerInvariant() }
if ($normalized -contains 'all' -or $normalized.Count -eq 0) {
    $targets = $BrowserCatalog | Where-Object { Test-BrowserInstalled $_ }
    if ($targets.Count -eq 0) {
        $fallbackId = if ($IsWindows -or $IsMacOS) { 'edge' } else { 'chrome' }
        Write-Host "[warn] No supported Chromium browser detected. Defaulting to $fallbackId." -ForegroundColor Yellow
        $targets = @($BrowserCatalog | Where-Object { $_.Id -eq $fallbackId })
    }
    if ($targets.Count -gt 1 -and -not $Quiet) {
        Write-Host ''
        Write-Host 'Detected the following Chromium browsers:' -ForegroundColor Cyan
        for ($i = 0; $i -lt $targets.Count; $i++) {
            Write-Host ("  [{0}] {1}" -f ($i + 1), $targets[$i].Name)
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
        if (-not $b) { throw "Unknown browser '$id'. Valid: edge, chrome, chromium, brave, vivaldi, arc, all." }
        if (-not (Get-OsRow $b)) { throw "Browser '$id' is not supported on this OS." }
        $targets += $b
    }
}

# --- Build the manifest content -------------------------------------------
$launcherForManifest = if ($IsWindows) { $LauncherCmd } else { $LauncherSh }
$template = Get-Content -Raw -Path $TemplatePath
# JSON-escape backslashes only (Win paths). POSIX paths have none.
$jsonSafePath = if ($IsWindows) { $launcherForManifest -replace '\\', '\\' } else { $launcherForManifest }
$manifestJson = $template -replace '__LAUNCHER_PATH__', $jsonSafePath
try { [void] ($manifestJson | ConvertFrom-Json -ErrorAction Stop) }
catch { throw "Generated manifest is not valid JSON: $_" }

# --- Write + register per browser -----------------------------------------
$registered = @()

if ($IsWindows) {
    # Windows: one shared manifest, registry pointer per browser.
    $InstallDir   = Get-AnyaDataDir
    $ManifestPath = Join-Path $InstallDir "$HostName.json"
    if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
    Set-Content -Path $ManifestPath -Value $manifestJson -Encoding UTF8 -NoNewline
    Write-Host "[OK] Wrote shared manifest: $ManifestPath"

    foreach ($b in $targets) {
        $row = $b.Win
        $regKey = Join-Path $row.RegRoot $HostName
        if (-not (Test-Path $regKey)) { New-Item -Path $regKey -Force | Out-Null }
        Set-ItemProperty -Path $regKey -Name '(Default)' -Value $ManifestPath
        $verify = (Get-ItemProperty -Path $regKey).'(default)'
        if ($verify -ne $ManifestPath) {
            throw "Registry verification failed for $($b.Name): expected '$ManifestPath', got '$verify'"
        }
        Write-Host ("[OK] Registered for {0,-15}-> {1}" -f $b.Name, $regKey)
        $registered += $b
    }
} else {
    # macOS + Linux: each browser gets its own copy in its NativeMessagingHosts dir.
    foreach ($b in $targets) {
        $row = Get-OsRow $b
        if (-not $row) { continue }
        $dir = $row.ManifestDir
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $manifestPath = Join-Path $dir "$HostName.json"
        Set-Content -Path $manifestPath -Value $manifestJson -Encoding UTF8 -NoNewline
        Write-Host ("[OK] Registered for {0,-15}-> {1}" -f $b.Name, $manifestPath)
        $registered += $b
    }
}

# --- Summary --------------------------------------------------------------
Write-Host ''
Write-Host '=== Anya bridge installed ===' -ForegroundColor Green
Write-Host "Host name             : $HostName"
Write-Host "Extension ID (allowed): $ExtensionId"
Write-Host "Launcher              : $launcherForManifest"
Write-Host ''
Write-Host 'Next steps — load the unpacked extension in each browser:' -ForegroundColor Yellow
foreach ($b in $registered) {
    $row = Get-OsRow $b
    Write-Host ("  {0,-16} open {1} -> Developer mode -> Load unpacked -> .\extension\dist" -f $b.Name, $row.ExtUrl)
}
Write-Host ("  Confirm extension ID matches: {0}" -f $ExtensionId) -ForegroundColor DarkGray
