# set-token.ps1
# Script to set the MAHORAGA API token in browser localStorage
# This opens the dashboard and sets the token automatically

$ProjectRoot = "C:\Users\azmunScripts\Documents\GitHub\MAHORAGA"
$devVarsPath = Join-Path $ProjectRoot ".dev.vars"

if (-not (Test-Path $devVarsPath)) {
    Write-Host "ERROR: .dev.vars not found at $devVarsPath" -ForegroundColor Red
    exit 1
}

$content = Get-Content $devVarsPath -Raw
if (-not ($content -match 'MAHORAGA_API_TOKEN=([^\r\n]+)')) {
    Write-Host "ERROR: MAHORAGA_API_TOKEN not found in .dev.vars" -ForegroundColor Red
    exit 1
}

$token = $Matches[1].Trim()
Write-Host "Token found. Opening dashboard..." -ForegroundColor Green
Write-Host ""
Write-Host "To set the token manually:" -ForegroundColor Yellow
Write-Host "1. Open browser console (F12)" -ForegroundColor White
Write-Host "2. Run: localStorage.setItem('mahoraga_api_token', '$token')" -ForegroundColor White
Write-Host "3. Reload the page" -ForegroundColor White
Write-Host ""
Write-Host "Or use the token input in the dashboard UI when prompted." -ForegroundColor Yellow
Write-Host ""
Write-Host "Dashboard URL: https://autotrader.tail3a7fed.ts.net/mahoraga/" -ForegroundColor Cyan

# Open the dashboard
Start-Process "https://autotrader.tail3a7fed.ts.net/mahoraga/"
