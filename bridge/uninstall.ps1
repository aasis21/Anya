<#
.SYNOPSIS
    Uninstalls the AgentEdge Native Messaging host registration.

.DESCRIPTION
    - Removes the HKCU registry entry for com.agentedge.bridge
    - Deletes the installed manifest at %LOCALAPPDATA%\AgentEdge\com.agentedge.bridge.json
    - Leaves the bridge source/build directory untouched.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$HostName     = 'com.agentedge.bridge'
$InstallDir   = Join-Path $env:LOCALAPPDATA 'AgentEdge'
$ManifestPath = Join-Path $InstallDir "$HostName.json"
$RegKey       = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"

if (Test-Path $RegKey) {
    Remove-Item -Path $RegKey -Recurse -Force
    Write-Host "[OK] Removed registry key: $RegKey"
}
else {
    Write-Host "[skip] Registry key not present: $RegKey"
}

if (Test-Path $ManifestPath) {
    Remove-Item -Path $ManifestPath -Force
    Write-Host "[OK] Removed manifest: $ManifestPath"
}
else {
    Write-Host "[skip] Manifest not present: $ManifestPath"
}

Write-Host ''
Write-Host 'AgentEdge bridge uninstalled. The bridge source folder was not touched.'
