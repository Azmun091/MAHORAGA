# health-check.ps1
# Health check script for MAHORAGA
# Checks PM2 services and Worker health endpoint
# Automatically recovers failed services

param(
    [string]$WorkerUrl = "http://localhost:8787",
    [string]$DashboardUrl = "http://localhost:4173",
    [int]$MaxRestartThreshold = 20,  # Services with more restarts are considered unstable (increased from 5)
    [int]$HealthCheckRetries = 3,  # Number of retries before considering service unhealthy
    [int]$HealthCheckRetryDelay = 2  # Seconds to wait between retries
)

$ProjectRoot = "C:\Users\azmunScripts\Documents\GitHub\MAHORAGA"
$LogFile = "$ProjectRoot\logs\health-check.log"
$MaxLogLines = 1000

# Service to port mapping for port conflict detection
$ServicePorts = @{
    "mahoraga-worker" = 8787
    "mahoraga-dashboard" = 4173
}

# Ensure logs directory exists
if (-not (Test-Path "$ProjectRoot\logs")) {
    New-Item -ItemType Directory -Path "$ProjectRoot\logs" -Force | Out-Null
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path $LogFile -Value $logMessage

    # Rotate log if too large
    $logContent = Get-Content $LogFile -ErrorAction SilentlyContinue
    if ($logContent -and $logContent.Count -gt $MaxLogLines) {
        $logContent | Select-Object -Last $MaxLogLines | Set-Content $LogFile
    }
}

function Test-PM2Running {
    try {
        $result = pm2 ping 2>&1 | Out-String
        # Check for EPERM errors in output
        if ($result -match "EPERM|connect.*rpc\.sock") {
            Write-Log "PM2 daemon connection error detected: $result" "WARN"
            return $false
        }
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-PM2ServiceStatus {
    try {
        $jsonOutput = pm2 jlist 2>&1
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        
        try {
            return $jsonOutput | ConvertFrom-Json | ForEach-Object {
                [PSCustomObject]@{
                    name = $_.name
                    pid = $_.pid
                    pm2_env = [PSCustomObject]@{
                        status = $_.pm2_env.status
                        restart_time = $_.pm2_env.restart_time
                    }
                }
            }
        } catch {
            return Get-PM2ServiceStatusFallback
        }
    } catch {
        Write-Log "Failed to get PM2 status: $_" "ERROR"
        return $null
    }
}

function Get-PM2ServiceStatusFallback {
    $knownServices = @(
        "mahoraga-worker",
        "mahoraga-dashboard",
        "mahoraga-health-monitor"
    )
    
    $services = @()
    
    foreach ($serviceName in $knownServices) {
        try {
            $showOutput = pm2 show $serviceName --no-color 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { continue }
            
            $status = "unknown"
            $restarts = 0
            $servicePid = 0
            
            if ($showOutput -match 'status\s+[^a-zA-Z]*\s*(\w+)') {
                $status = $Matches[1]
            }
            if ($showOutput -match 'restarts\s+[^0-9]*\s*(\d+)') {
                $restarts = [int]$Matches[1]
            }
            if ($showOutput -match '(?:^|\s)pid\s+[^0-9]*\s*(\d+)') {
                $servicePid = [int]$Matches[1]
            }
            
            $services += [PSCustomObject]@{
                name = $serviceName
                pid = $servicePid
                pm2_env = [PSCustomObject]@{
                    status = $status
                    restart_time = $restarts
                }
            }
        } catch {
            # Skip this service if parsing fails
        }
    }
    
    return $services
}

function Test-PM2ServicesHealthy {
    $criticalServices = @(
        "mahoraga-worker",
        "mahoraga-dashboard",
        "mahoraga-health-monitor"
    )

    $unhealthyServices = @()
    $restartLoopServices = @()
    $stuckServices = @()

    $pm2Status = Get-PM2ServiceStatus
    if ($null -eq $pm2Status) {
        foreach ($service in $criticalServices) {
            try {
                $showOutput = pm2 show $service 2>&1 | Out-String
                if ($LASTEXITCODE -ne 0 -or $showOutput -notmatch "online") {
                    $unhealthyServices += $service
                }
            } catch {
                $unhealthyServices += $service
            }
        }
        return @{
            Healthy = ($unhealthyServices.Count -eq 0)
            Unhealthy = $unhealthyServices
            RestartLoops = @()
            StuckServices = @()
        }
    }

    foreach ($service in $criticalServices) {
        $proc = $pm2Status | Where-Object { $_.name -eq $service }
        
        if ($null -eq $proc) {
            $unhealthyServices += $service
            continue
        }

        $status = $proc.pm2_env.status
        $restarts = $proc.pm2_env.restart_time

        if ($status -ne "online") {
            if ($status -eq "launching" -or $status -eq "stopping") {
                $stuckServices += @{
                    Name = $service
                    Status = $status
                    Restarts = $restarts
                }
            } else {
                $unhealthyServices += $service
            }
        }

        if ($restarts -ge $MaxRestartThreshold) {
            $restartLoopServices += @{
                Name = $service
                Restarts = $restarts
                Status = $status
            }
        }
    }

    return @{
        Healthy = ($unhealthyServices.Count -eq 0 -and $stuckServices.Count -eq 0 -and $restartLoopServices.Count -eq 0)
        Unhealthy = $unhealthyServices
        RestartLoops = $restartLoopServices
        StuckServices = $stuckServices
    }
}

function Repair-PM2Services {
    param([array]$Services)

    if ($Services.Count -eq 0) { return }

    foreach ($service in $Services) {
        Write-Log "Restarting PM2 service: $service" "WARN"
        pm2 restart $service 2>&1
    }

    Start-Sleep -Seconds 5

    $stillUnhealthy = (Test-PM2ServicesHealthy).Unhealthy
    if ($stillUnhealthy.Count -gt 0) {
        Write-Log "Some services still unhealthy, attempting full resurrect..." "WARN"
        pm2 resurrect 2>&1
    }
}

function Test-WorkerHealth {
    $retries = 0
    while ($retries -lt $HealthCheckRetries) {
        try {
            $response = Invoke-WebRequest -Uri "$WorkerUrl/health" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            # Only log on last retry
            if ($retries -eq ($HealthCheckRetries - 1)) {
                Write-Log "Worker health check failed after $HealthCheckRetries retries: $_" "WARN"
            }
        }
        $retries++
        if ($retries -lt $HealthCheckRetries) {
            Start-Sleep -Seconds $HealthCheckRetryDelay
        }
    }
    return $false
}

function Test-DashboardHealth {
    $retries = 0
    while ($retries -lt $HealthCheckRetries) {
        try {
            $response = Invoke-WebRequest -Uri $DashboardUrl -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            # Only log on last retry
            if ($retries -eq ($HealthCheckRetries - 1)) {
                Write-Log "Dashboard health check failed after $HealthCheckRetries retries: $_" "WARN"
            }
        }
        $retries++
        if ($retries -lt $HealthCheckRetries) {
            Start-Sleep -Seconds $HealthCheckRetryDelay
        }
    }
    return $false
}

# Main execution
Write-Log "========== Health Check Started =========="

$issues = @()
$repairs = @()

# 1. Check PM2
Write-Log "Checking PM2..."
if (-not (Test-PM2Running)) {
    $issues += "PM2 not running or connection error"
    Write-Log "PM2 daemon is NOT running or has connection issues" "ERROR"
    
    # Try to fix PM2 daemon issues
    Write-Log "Attempting to fix PM2 daemon..." "WARN"
    pm2 kill 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    
    # Try to start daemon by pinging
    pm2 ping 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    
    # Try resurrect
    $resurrectResult = pm2 resurrect 2>&1 | Out-String
    if ($resurrectResult -notmatch "EPERM|connect.*rpc\.sock") {
        $repairs += "PM2 daemon restarted and resurrected"
    } else {
        Write-Log "PM2 daemon still has issues after restart attempt" "ERROR"
    }
} else {
    Write-Log "PM2 daemon: OK"

    # 2. Check PM2 Services
    Write-Log "Checking PM2 services..."
    $pm2Status = Test-PM2ServicesHealthy

    if ($pm2Status.Unhealthy.Count -gt 0) {
        $issues += "PM2 services not healthy: $($pm2Status.Unhealthy -join ', ')"
        Write-Log "Unhealthy PM2 services: $($pm2Status.Unhealthy -join ', ')" "ERROR"
        Repair-PM2Services -Services $pm2Status.Unhealthy
        $repairs += "PM2 services restarted"
    }

    if ($pm2Status.RestartLoops.Count -gt 0) {
        foreach ($loopService in $pm2Status.RestartLoops) {
            # Only treat as issue if service is actually unhealthy
            # High restart count alone doesn't mean the service is broken
            $serviceStatus = $pm2Status | Where-Object { $_.name -eq $loopService.Name }
            if ($serviceStatus -and $serviceStatus.pm2_env.status -eq "online") {
                # Service is online and working, ignore high restart count
                # Don't reset restart count as it's just informational
                Write-Log "Service $($loopService.Name) has $($loopService.Restarts) restarts but is online and healthy - ignoring" "INFO"
                # Don't add to issues or repairs - service is working fine
            } else {
                # Service is actually unhealthy AND has high restart count
                $issues += "Restart loop detected: $($loopService.Name) ($($loopService.Restarts) restarts, status: $($loopService.Status))"
                Write-Log "Service $($loopService.Name) in restart loop ($($loopService.Restarts) restarts) and unhealthy" "WARN"
                pm2 restart $loopService.Name 2>&1 | Out-Null
                Start-Sleep -Seconds 5  # Give service time to start
                $repairs += "Restarted unhealthy service $($loopService.Name)"
            }
        }
    }

    if ($pm2Status.StuckServices.Count -gt 0) {
        foreach ($stuckService in $pm2Status.StuckServices) {
            if ($stuckService.Status -eq "stopped" -or $stuckService.Status -match "waiting") {
                continue
            }
            
            $issues += "Service stuck: $($stuckService.Name) (status: $($stuckService.Status))"
            Write-Log "Service $($stuckService.Name) stuck in '$($stuckService.Status)' state" "WARN"
            pm2 restart $stuckService.Name 2>&1 | Out-Null
            $repairs += "Force restarted $($stuckService.Name)"
        }
    }

    if ($pm2Status.Healthy) {
        Write-Log "PM2 services: OK"
    }
}

# 3. Check Worker Health Endpoint
Write-Log "Checking Worker health endpoint..."
$workerHealthy = Test-WorkerHealth
if (-not $workerHealthy) {
    # Only restart if PM2 shows service is actually down or unhealthy
    $workerStatus = Get-PM2ServiceStatus | Where-Object { $_.name -eq "mahoraga-worker" }
    if ($null -eq $workerStatus -or $workerStatus.pm2_env.status -ne "online") {
        $issues += "Worker health endpoint not responding and PM2 service is down"
        Write-Log "Worker health endpoint is NOT responding and PM2 service is down" "WARN"
        pm2 restart mahoraga-worker 2>&1 | Out-Null
        Start-Sleep -Seconds 10  # Give worker time to start before next check
        $repairs += "Worker restarted"
    } else {
        # Service is online in PM2 but not responding - might be starting up
        Write-Log "Worker health endpoint not responding but PM2 service is online - may be starting up" "INFO"
    }
} else {
    Write-Log "Worker health: OK"
}

# 4. Check Dashboard
Write-Log "Checking Dashboard..."
$dashboardHealthy = Test-DashboardHealth
if (-not $dashboardHealthy) {
    # Only restart if PM2 shows service is actually down or unhealthy
    $dashboardStatus = Get-PM2ServiceStatus | Where-Object { $_.name -eq "mahoraga-dashboard" }
    if ($null -eq $dashboardStatus -or $dashboardStatus.pm2_env.status -ne "online") {
        $issues += "Dashboard not responding and PM2 service is down"
        Write-Log "Dashboard is NOT responding and PM2 service is down" "WARN"
        pm2 restart mahoraga-dashboard 2>&1 | Out-Null
        Start-Sleep -Seconds 10  # Give dashboard time to start before next check
        $repairs += "Dashboard restarted"
    } else {
        # Service is online in PM2 but not responding - might be starting up
        Write-Log "Dashboard not responding but PM2 service is online - may be starting up" "INFO"
    }
} else {
    Write-Log "Dashboard: OK"
}

# Summary
Write-Log "========== Health Check Complete =========="
if ($issues.Count -eq 0) {
    Write-Log "Status: ALL SYSTEMS HEALTHY"
} else {
    Write-Log "Issues found: $($issues.Count)" "WARN"
    foreach ($issue in $issues) {
        Write-Log "  - $issue" "WARN"
    }
    if ($repairs.Count -gt 0) {
        Write-Log "Repairs attempted: $($repairs.Count)"
        foreach ($repair in $repairs) {
            Write-Log "  - $repair"
        }
    }
}

exit 0
