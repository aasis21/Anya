# Tails the AgentEdge bridge log live in this PowerShell window.
# Usage:
#   pwsh -NoExit -File scripts\tail-bridge-log.ps1
# Or alias from your $PROFILE:
#   Set-Alias agentedge-tail "C:\Users\kumarashish\Projects\AgentEdge\scripts\tail-bridge-log.ps1"

$logPath = Join-Path $env:LOCALAPPDATA 'AgentEdge\bridge.log'

if (-not (Test-Path $logPath)) {
    Write-Host "No bridge.log yet at: $logPath" -ForegroundColor Yellow
    Write-Host "Open the AgentEdge sidebar in Edge once, then re-run." -ForegroundColor Yellow
    Write-Host "Waiting for the file to appear..." -ForegroundColor DarkGray
    while (-not (Test-Path $logPath)) { Start-Sleep -Milliseconds 500 }
}

Write-Host "Tailing $logPath" -ForegroundColor Cyan
Write-Host "Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ('-' * 60) -ForegroundColor DarkGray
Get-Content -Path $logPath -Wait -Tail 50
