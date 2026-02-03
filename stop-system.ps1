# MAHORAGA - System Stop Script
# This script stops all PM2 services gracefully

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MAHORAGA - System Stop" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-Command {
    param($Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Check for PM2
if (-not (Test-Command "pm2")) {
    Write-Host "[WARNING] PM2 is not installed. Nothing to stop." -ForegroundColor Yellow
    exit 0
}

Write-Host "Stopping all MAHORAGA services..." -ForegroundColor Yellow

# Stop PM2 services
pm2 stop mahoraga-worker 2>&1 | Out-Null
pm2 stop mahoraga-dashboard 2>&1 | Out-Null
pm2 stop mahoraga-health-monitor 2>&1 | Out-Null

Start-Sleep -Seconds 2

# Delete PM2 processes
pm2 delete mahoraga-worker 2>&1 | Out-Null
pm2 delete mahoraga-dashboard 2>&1 | Out-Null
pm2 delete mahoraga-health-monitor 2>&1 | Out-Null

Write-Host "[OK] All MAHORAGA services stopped" -ForegroundColor Green
Write-Host ""
Write-Host "To restart the system, run: .\start-system.ps1" -ForegroundColor Cyan
Write-Host ""
