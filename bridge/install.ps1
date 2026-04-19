<#
.SYNOPSIS
    Installs the AgentEdge Native Messaging host for Microsoft Edge.

.DESCRIPTION
    - Writes the Native Messaging host manifest to %LOCALAPPDATA%\AgentEdge\com.agentedge.bridge.json
    - Registers the manifest under HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.agentedge.bridge
    - Points Edge at the launcher.cmd inside this bridge directory.

.NOTES
    No admin required (HKCU only). Requires the bridge to be built (`npm run build`) so dist/host.js exists.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$HostName        = 'com.agentedge.bridge'
$ExtensionId     = 'oopdnihjfloclgnbbkebgeiipfadebid'
$BridgeDir       = $PSScriptRoot
$LauncherPath    = Join-Path $BridgeDir 'launcher.cmd'
$TemplatePath    = Join-Path $BridgeDir 'manifest.template.json'
$InstallDir      = Join-Path $env:LOCALAPPDATA 'AgentEdge'
$ManifestPath    = Join-Path $InstallDir "$HostName.json"
$RegKey          = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"

if (-not (Test-Path $LauncherPath)) {
    throw "launcher.cmd not found at $LauncherPath"
}
if (-not (Test-Path $TemplatePath)) {
    throw "manifest.template.json not found at $TemplatePath"
}

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Read template, substitute __LAUNCHER_PATH__. JSON requires backslashes to be escaped.
$template = Get-Content -Raw -Path $TemplatePath
$jsonSafePath = $LauncherPath -replace '\\', '\\'
$manifestJson = $template -replace '__LAUNCHER_PATH__', $jsonSafePath

# Validate JSON parses before writing.
try {
    [void] ($manifestJson | ConvertFrom-Json -ErrorAction Stop)
}
catch {
    throw "Generated manifest is not valid JSON: $_"
}

Set-Content -Path $ManifestPath -Value $manifestJson -Encoding UTF8 -NoNewline
Write-Host "[OK] Wrote manifest: $ManifestPath"

if (-not (Test-Path $RegKey)) {
    New-Item -Path $RegKey -Force | Out-Null
}
Set-ItemProperty -Path $RegKey -Name '(Default)' -Value $ManifestPath
Write-Host "[OK] Registered: $RegKey -> $ManifestPath"

# Verify registry write
$verify = (Get-ItemProperty -Path $RegKey).'(default)'
if ($verify -ne $ManifestPath) {
    throw "Registry verification failed: expected '$ManifestPath', got '$verify'"
}

Write-Host ''
Write-Host '=== AgentEdge bridge installed ==='
Write-Host "Host name           : $HostName"
Write-Host "Extension ID (allowed): $ExtensionId"
Write-Host "Manifest path       : $ManifestPath"
Write-Host "Launcher path       : $LauncherPath"
Write-Host "Registry            : $RegKey"
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Build the bridge if you have not yet:   npm run build'
Write-Host '  2. Open edge://extensions, enable Developer mode'
Write-Host '  3. Click "Load unpacked" and select the AgentEdge\extension folder'
Write-Host "  4. Confirm the loaded extension ID matches: $ExtensionId"
Write-Host '  5. Open the AgentEdge sidebar; messages now route through this bridge.'
