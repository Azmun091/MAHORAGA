# MAHORAGA - Master Startup Script
# This script orchestrates the complete system startup

param(
    [switch]$SkipBuild,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MAHORAGA - System Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-Command {
    param($Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Function to wait for service
function Wait-ForService {
    param(
        [string]$ServiceName,
        [string]$ServiceHost,
        [int]$Port,
        [int]$TimeoutSeconds = 30
    )
    
    Write-Host "Waiting for $ServiceName to be ready..." -ForegroundColor Yellow
    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        try {
            $connection = New-Object System.Net.Sockets.TcpClient($ServiceHost, $Port)
            $connection.Close()
            Write-Host "[OK] $ServiceName is ready!" -ForegroundColor Green
            return $true
        } catch {
            Start-Sleep -Seconds 2
            $elapsed += 2
            Write-Host "  Waiting... ($elapsed of $TimeoutSeconds seconds)" -ForegroundColor Gray
        }
    }
    Write-Host "X $ServiceName failed to start within $TimeoutSeconds seconds" -ForegroundColor Red
    return $false
}

# Step 1: Check Prerequisites
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Cyan

if (-not (Test-Command "node")) {
    Write-Host "[ERROR] Node.js is not installed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js found: $(node --version)" -ForegroundColor Green

if (-not (Test-Command "npm")) {
    Write-Host "[ERROR] npm is not installed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] npm found: $(npm --version)" -ForegroundColor Green

if (-not (Test-Command "npx")) {
    Write-Host "[ERROR] npx is not installed!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] npx found" -ForegroundColor Green

# Check for wrangler
$wranglerCheck = npx wrangler --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARNING] wrangler may not be installed. Will attempt to install..." -ForegroundColor Yellow
} else {
    Write-Host "[OK] wrangler found: $wranglerCheck" -ForegroundColor Green
}

# Check for PM2
if (-not (Test-Command "pm2")) {
    Write-Host "[ERROR] PM2 is not installed!" -ForegroundColor Red
    Write-Host "  Install with: npm install -g pm2" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] PM2 found: $(pm2 --version)" -ForegroundColor Green

# Step 2: Check for .dev.vars
Write-Host "`n[2/6] Checking configuration..." -ForegroundColor Cyan

$devVarsPath = Join-Path $ScriptDir ".dev.vars"
if (-not (Test-Path $devVarsPath)) {
    Write-Host "[WARNING] .dev.vars not found!" -ForegroundColor Yellow
    Write-Host "  Create .dev.vars with required environment variables" -ForegroundColor Yellow
    Write-Host "  See .dev.vars.example or README.md for required variables" -ForegroundColor Yellow
} else {
    Write-Host "[OK] .dev.vars found" -ForegroundColor Green
}

# Step 3: Install Dependencies
Write-Host "`n[3/6] Installing dependencies..." -ForegroundColor Cyan

Write-Host "Installing root dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install root dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Root dependencies installed" -ForegroundColor Green

Write-Host "Installing dashboard dependencies..." -ForegroundColor Yellow
$dashboardPath = Join-Path $ScriptDir "dashboard"
if (Test-Path $dashboardPath) {
    Push-Location $dashboardPath
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to install dashboard dependencies" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Host "[OK] Dashboard dependencies installed" -ForegroundColor Green
} else {
    Write-Host "[WARNING] Dashboard directory not found" -ForegroundColor Yellow
}

# Step 4: Run Database Migrations
Write-Host "`n[4/6] Running database migrations..." -ForegroundColor Cyan
npm run db:migrate

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to run migrations" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Database migrations complete" -ForegroundColor Green

# Give database time to settle after migrations
Write-Host "Waiting for database to settle..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Step 5: Build Dashboard
if (-not $SkipBuild) {
    Write-Host "`n[5/6] Building dashboard..." -ForegroundColor Cyan
    
    $dashboardPath = Join-Path $ScriptDir "dashboard"
    if (Test-Path $dashboardPath) {
        Push-Location $dashboardPath
        npm run build
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] Dashboard build failed" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Pop-Location
        Write-Host "[OK] Dashboard built successfully" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] Dashboard directory not found, skipping build" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n[5/6] Skipping dashboard build (SkipBuild flag set)" -ForegroundColor Yellow
}

# Step 6: Start All Services with PM2
Write-Host "`n[6/6] Starting all services with PM2..." -ForegroundColor Cyan
Write-Host "Services will start:" -ForegroundColor Yellow
Write-Host "  1. MAHORAGA Worker (Wrangler Dev)" -ForegroundColor Gray
Write-Host "  2. MAHORAGA Dashboard (Vite Preview)" -ForegroundColor Gray
Write-Host "  3. Health Monitor" -ForegroundColor Gray
Write-Host ""

# Create logs directory if it doesn't exist
$logsDir = Join-Path $ScriptDir "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
    Write-Host "[OK] Created logs directory" -ForegroundColor Green
}

# Stop any existing PM2 processes for MAHORAGA
Write-Host "Stopping any existing MAHORAGA processes..." -ForegroundColor Yellow
$services = @("mahoraga-worker", "mahoraga-dashboard", "mahoraga-health-monitor")
foreach ($service in $services) {
    # Use cmd to execute PM2 and suppress all output (including warnings)
    cmd /c "pm2 delete $service >nul 2>&1"
}
Start-Sleep -Seconds 2

# Start PM2 ecosystem
Write-Host "Starting PM2 ecosystem..." -ForegroundColor Yellow
Push-Location $ScriptDir
pm2 start ecosystem.config.cjs

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to start PM2 services" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Wait for services to be ready
Write-Host "Waiting for services to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Wait-ForService -ServiceName "MAHORAGA Worker" -ServiceHost "localhost" -Port 8787 -TimeoutSeconds 60
Wait-ForService -ServiceName "MAHORAGA Dashboard" -ServiceHost "localhost" -Port 4173 -TimeoutSeconds 30

Write-Host "[OK] All services started" -ForegroundColor Green

# Enable the agent automatically
Write-Host "`nEnabling MAHORAGA agent..." -ForegroundColor Cyan
$devVarsPath = Join-Path $ScriptDir ".dev.vars"
if (Test-Path $devVarsPath) {
    $devVarsContent = Get-Content $devVarsPath -Raw
    if ($devVarsContent -match 'MAHORAGA_API_TOKEN=([^\r\n]+)') {
        $token = $Matches[1].Trim()
        try {
            $headers = @{
                "Authorization" = "Bearer $token"
            }
            $response = Invoke-WebRequest -Uri "http://localhost:8787/agent/enable" -Method POST -Headers $headers -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $result = $response.Content | ConvertFrom-Json
                if ($result.ok -and $result.enabled) {
                    Write-Host "[OK] Agent enabled successfully" -ForegroundColor Green
                } else {
                    Write-Host "[WARNING] Agent enable returned unexpected response" -ForegroundColor Yellow
                }
            }
        } catch {
            Write-Host "[WARNING] Failed to enable agent: $_" -ForegroundColor Yellow
            Write-Host "  You can enable it manually: curl -H 'Authorization: Bearer `$TOKEN' http://localhost:8787/agent/enable" -ForegroundColor Gray
        }
    } else {
        Write-Host "[WARNING] MAHORAGA_API_TOKEN not found in .dev.vars" -ForegroundColor Yellow
    }
} else {
    Write-Host "[WARNING] .dev.vars not found, cannot enable agent automatically" -ForegroundColor Yellow
}

# Step 7: Display Summary
Write-Host "`n[7/7] System startup complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  System Status" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Application Services:" -ForegroundColor Cyan
Write-Host "  Worker API:      http://localhost:8787" -ForegroundColor White
Write-Host "  Dashboard:        http://localhost:4173" -ForegroundColor White
Write-Host "  Health Check:     http://localhost:8787/health" -ForegroundColor White
Write-Host ""
Write-Host "PM2 Commands:" -ForegroundColor Cyan
Write-Host "  View status:      pm2 status" -ForegroundColor White
Write-Host "  View logs:        pm2 logs" -ForegroundColor White
Write-Host "  Stop all:         pm2 stop all" -ForegroundColor White
Write-Host "  Restart all:      pm2 restart all" -ForegroundColor White
Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor Cyan
Write-Host "  Stop system:      .\stop-system.ps1" -ForegroundColor White
Write-Host "  Database Studio: npm run db:studio" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
