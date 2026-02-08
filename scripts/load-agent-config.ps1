# Load agent-config.json into the harness (POST /agent/config).
# Run this after starting the worker so the harness uses your local config (e.g. crypto_enabled).
# Usage: .\scripts\load-agent-config.ps1 [-BaseUrl "http://localhost:8787"] [-Token "..."]

param(
    [string]$BaseUrl = "http://localhost:8787",
    [string]$Token = $env:MAHORAGA_API_TOKEN
)

$ErrorActionPreference = "Stop"

$configPath = Join-Path (Split-Path $PSScriptRoot -Parent) "agent-config.json"
if (-not (Test-Path $configPath)) {
    Write-Host "agent-config.json not found at $configPath" -ForegroundColor Yellow
    exit 0
}

if (-not $Token) {
    Write-Host "MAHORAGA_API_TOKEN not set. Set it or pass -Token '...'" -ForegroundColor Red
    exit 1
}

$body = Get-Content $configPath -Raw -Encoding UTF8
$headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type"  = "application/json"
}

try {
    $resp = Invoke-RestMethod -Uri "$BaseUrl/agent/config" -Method POST -Headers $headers -Body $body -TimeoutSec 15
    Write-Host "Config loaded (crypto_enabled = $($resp.config.crypto_enabled))." -ForegroundColor Green
} catch {
    Write-Host "Failed to load config: $_" -ForegroundColor Red
    exit 1
}
