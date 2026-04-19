<#
.SYNOPSIS
    Uninstalls the Anya Native Messaging host registration from every Chromium
    browser (and cleans up the legacy AgentEdge entries).

.DESCRIPTION
    - Removes HKCU registry entries for com.anya.bridge across Edge, Chrome,
      Chromium, Brave, and Vivaldi.
    - Also removes legacy entries for com.agentedge.bridge so users upgrading
      from the AgentEdge name don't get a duplicate registration.
    - Deletes the installed manifest at %LOCALAPPDATA%\Anya\com.anya.bridge.json
      and the legacy %LOCALAPPDATA%\AgentEdge directory if present.
    - Leaves the bridge source/build directory untouched.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Hosts        = @('com.anya.bridge', 'com.agentedge.bridge')  # current + legacy
$RegRoots     = @(
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
    'HKCU:\Software\Chromium\NativeMessagingHosts',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts',
    'HKCU:\Software\Vivaldi\NativeMessagingHosts'
)

foreach ($root in $RegRoots) {
    foreach ($h in $Hosts) {
        $key = Join-Path $root $h
        if (Test-Path $key) {
            Remove-Item -Path $key -Recurse -Force
            Write-Host "[OK]  Removed: $key"
        }
    }
}

$installDirs = @(
    @{ Dir = Join-Path $env:LOCALAPPDATA 'Anya';      File = 'com.anya.bridge.json' },
    @{ Dir = Join-Path $env:LOCALAPPDATA 'AgentEdge'; File = 'com.agentedge.bridge.json' }
)
foreach ($d in $installDirs) {
    $mf = Join-Path $d.Dir $d.File
    if (Test-Path $mf) {
        Remove-Item -Path $mf -Force
        Write-Host "[OK]  Removed manifest: $mf"
    }
}

Write-Host ''
Write-Host 'Anya bridge unregistered from all detected Chromium browsers.'
Write-Host 'The bridge source folder, logs, and chat data were not touched.'
