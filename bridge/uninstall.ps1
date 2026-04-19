<#
.SYNOPSIS
    Uninstalls the Anya Native Messaging host registration from every
    Chromium browser on Windows, macOS, or Linux.

.DESCRIPTION
    Cross-platform PowerShell 7+ uninstaller. Mirrors install.ps1:

      Windows  -> removes HKCU registry entries for com.anya.bridge across
                  Edge, Chrome, Chromium, Brave, Vivaldi, Arc; deletes the
                  shared manifest at %LOCALAPPDATA%\Anya\com.anya.bridge.json.
      macOS    -> deletes ~/Library/Application Support/<vendor>/<browser>/
                  NativeMessagingHosts/com.anya.bridge.json.
      Linux    -> deletes ~/.config/<vendor>/<browser>/NativeMessagingHosts/
                  com.anya.bridge.json.

    The bridge source folder, logs, and chat data are not touched.
#>

#Requires -Version 7.0

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if (-not ($IsWindows -or $IsMacOS -or $IsLinux)) {
    throw 'Unsupported OS — Anya uninstall supports Windows, macOS, and Linux.'
}

$Hosts = @('com.anya.bridge')

if ($IsWindows) {
    $RegRoots = @(
        'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
        'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
        'HKCU:\Software\Chromium\NativeMessagingHosts',
        'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts',
        'HKCU:\Software\Vivaldi\NativeMessagingHosts',
        'HKCU:\Software\TheBrowserCompany\Arc\NativeMessagingHosts'
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

    $mf = Join-Path $env:LOCALAPPDATA 'Anya\com.anya.bridge.json'
    if (Test-Path $mf) {
        Remove-Item -Path $mf -Force
        Write-Host "[OK]  Removed manifest: $mf"
    }
} else {
    # macOS + Linux: per-browser manifest dirs.
    if ($IsMacOS) {
        $base = Join-Path $HOME 'Library/Application Support'
        $dirs = @(
            "$base/Microsoft Edge/NativeMessagingHosts",
            "$base/Google/Chrome/NativeMessagingHosts",
            "$base/Chromium/NativeMessagingHosts",
            "$base/BraveSoftware/Brave-Browser/NativeMessagingHosts",
            "$base/Vivaldi/NativeMessagingHosts",
            "$base/Arc/User Data/NativeMessagingHosts"
        )
    } else {
        $base = Join-Path $HOME '.config'
        $dirs = @(
            "$base/microsoft-edge/NativeMessagingHosts",
            "$base/google-chrome/NativeMessagingHosts",
            "$base/chromium/NativeMessagingHosts",
            "$base/BraveSoftware/Brave-Browser/NativeMessagingHosts",
            "$base/vivaldi/NativeMessagingHosts"
        )
    }

    foreach ($dir in $dirs) {
        foreach ($h in $Hosts) {
            $mf = Join-Path $dir "$h.json"
            if (Test-Path $mf) {
                Remove-Item -Path $mf -Force
                Write-Host "[OK]  Removed manifest: $mf"
            }
        }
    }
}

Write-Host ''
Write-Host 'Anya bridge unregistered from all detected Chromium browsers.'
Write-Host 'The bridge source folder, logs, and chat data were not touched.'
