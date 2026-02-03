# startup-services.ps1
# Script to start PM2 services for MAHORAGA
# Run this script at Windows startup via Task Scheduler

$ProjectRoot = "C:\Users\azmunScripts\Documents\GitHub\MAHORAGA"
$LogFile = "$ProjectRoot\logs\startup-services.log"

# Ensure logs directory exists
if (-not (Test-Path "$ProjectRoot\logs")) {
    New-Item -ItemType Directory -Path "$ProjectRoot\logs" -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Write-Host $logMessage
    Add-Content -Path $LogFile -Value $logMessage
}

function Test-PM2Ready {
    <#
    .SYNOPSIS
    Verifies that PM2 daemon is ready to accept commands
    #>
    $maxAttempts = 5
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        try {
            $pingResult = pm2 ping 2>&1
            if ($LASTEXITCODE -eq 0) {
                return $true
            }
        } catch {
            # Continue to next attempt
        }
        
        $attempt++
        if ($attempt -lt $maxAttempts) {
            Start-Sleep -Seconds 2
        }
    }
    
    return $false
}

function Start-PM2Daemon {
    <#
    .SYNOPSIS
    Ensures PM2 daemon is running, killing any zombie instances first
    #>
    Write-Log "Ensuring PM2 daemon is running..."
    
    # First, try to kill any existing PM2 instances (zombies)
    Write-Log "Cleaning up any existing PM2 instances..."
    pm2 kill 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    
    # Try to ping PM2 - this will start the daemon if it's not running
    Write-Log "Starting PM2 daemon..."
    $pingResult = pm2 ping 2>&1
    
    # Wait for daemon to be ready
    if (Test-PM2Ready) {
        Write-Log "PM2 daemon is ready"
        return $true
    } else {
        Write-Log "WARNING: PM2 daemon may not be fully ready, but continuing..."
        return $false
    }
}

function Get-ApiToken {
    <#
    .SYNOPSIS
    Reads MAHORAGA_API_TOKEN from .dev.vars file
    #>
    $devVarsPath = Join-Path $ProjectRoot ".dev.vars"
    if (-not (Test-Path $devVarsPath)) {
        Write-Log "WARNING: .dev.vars not found, cannot enable agent automatically"
        return $null
    }
    
    $content = Get-Content $devVarsPath -Raw
    if ($content -match 'MAHORAGA_API_TOKEN=([^\r\n]+)') {
        return $Matches[1].Trim()
    }
    
    return $null
}

function Wait-ForWorker {
    <#
    .SYNOPSIS
    Waits for the worker to be ready by checking /health endpoint
    #>
    $maxAttempts = 30
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8787/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            # Continue to next attempt
        }
        
        $attempt++
        if ($attempt -lt $maxAttempts) {
            Start-Sleep -Seconds 2
        }
    }
    
    return $false
}

function Enable-Agent {
    <#
    .SYNOPSIS
    Enables the MAHORAGA agent via API
    #>
    $token = Get-ApiToken
    if (-not $token) {
        Write-Log "WARNING: Cannot enable agent - API token not found"
        return $false
    }
    
    Write-Log "Waiting for worker to be ready..."
    if (-not (Wait-ForWorker)) {
        Write-Log "WARNING: Worker did not become ready within timeout, skipping agent enable"
        return $false
    }
    
    Write-Log "Enabling MAHORAGA agent..."
    try {
        $headers = @{
            "Authorization" = "Bearer $token"
        }
        
        $response = Invoke-WebRequest -Uri "http://localhost:8787/agent/enable" -Method POST -Headers $headers -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        
        if ($response.StatusCode -eq 200) {
            $result = $response.Content | ConvertFrom-Json
            if ($result.ok -and $result.enabled) {
                Write-Log "Agent enabled successfully"
                return $true
            }
        }
        
        Write-Log "WARNING: Agent enable returned unexpected response"
        return $false
    } catch {
        Write-Log "WARNING: Failed to enable agent: $_"
        return $false
    }
}

function Start-PM2Services {
    Write-Log "Starting PM2 services..."

    try {
        Set-Location $ProjectRoot
        
        # Ensure PM2 daemon is running
        $daemonOk = Start-PM2Daemon
        if (-not $daemonOk) {
            Write-Log "WARNING: PM2 daemon may not be ready, but attempting to continue..."
        }
        
        # Wait a bit more for daemon to stabilize
        Start-Sleep -Seconds 2
        
        # Check if there are saved processes to resurrect
        $dumpFile = "$env:USERPROFILE\.pm2\dump.pm2"
        if (Test-Path $dumpFile) {
            $dumpContent = Get-Content $dumpFile -ErrorAction SilentlyContinue
            if ($dumpContent -and $dumpContent.Count -gt 0) {
                Write-Log "Found saved PM2 processes, attempting to resurrect..."
                $result = pm2 resurrect 2>&1
                Write-Log "PM2 resurrect output: $result"
                
                # Wait a moment for processes to start
                Start-Sleep -Seconds 3
                
                # Check if services are running
                $pm2List = pm2 list 2>&1
                if ($LASTEXITCODE -eq 0 -and $pm2List -notmatch "connect EPERM") {
                    Write-Log "PM2 services resurrected successfully."
                    Write-Log "Running processes:`n$pm2List"
                    
                    # Save again to ensure dump is current
                    pm2 save 2>&1 | Out-Null
                    
                    # Enable agent after services are running
                    Start-Sleep -Seconds 5
                    Enable-Agent | Out-Null
                    
                    return $true
                } else {
                    Write-Log "Resurrect failed or incomplete, starting from ecosystem.config.js..."
                }
            }
        }
        
        # If no saved processes or resurrect failed, start from ecosystem.config.cjs
        Write-Log "Starting services from ecosystem.config.cjs..."
        $result = pm2 start ecosystem.config.cjs 2>&1 | Out-String
        Write-Log "PM2 start output: $result"
        
        # Wait for services to initialize
        Start-Sleep -Seconds 5

        # Save PM2 configuration
        pm2 save 2>&1 | Out-Null
        Write-Log "PM2 configuration saved"

        # List running processes (with error handling)
        $pm2List = pm2 list 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $pm2List -notmatch "connect EPERM") {
            Write-Log "PM2 services started successfully."
            Write-Log "Running processes:`n$pm2List"
            
            # Enable agent after services are running
            Enable-Agent | Out-Null
            
            return $true
        } else {
            Write-Log "WARNING: PM2 list command had issues, but services may still be running"
            Write-Log "Output: $pm2List"
            # Still return true as services might be running despite the error
            # Try to enable agent anyway
            Enable-Agent | Out-Null
            return $true
        }
    } catch {
        Write-Log "ERROR: Failed to start PM2 services: $_"
        return $false
    }
}

# Main execution
Write-Log "=========================================="
Write-Log "Starting MAHORAGA services..."
Write-Log "=========================================="

# Wait for system to stabilize after boot/auto-login
Write-Log "Waiting 30 seconds for system to stabilize..."
Start-Sleep -Seconds 30

$pm2Ok = Start-PM2Services
if (-not $pm2Ok) {
    Write-Log "WARNING: PM2 services failed to start."
}

Write-Log "=========================================="
Write-Log "Startup complete."
Write-Log "PM2: $(if($pm2Ok){'OK'}else{'FAILED'})"
Write-Log "=========================================="

exit 0
