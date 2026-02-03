# setup-health-check-task.ps1
# Creates a scheduled task that runs health check every 10 minutes

$TaskName = "MAHORAGA-HealthCheck"
$ScriptPath = "C:\Users\azmunScripts\Documents\GitHub\MAHORAGA\scripts\health-check.bat"

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    exit 1
}

# Remove existing task if it exists
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Create trigger: every 10 minutes, for 9999 days (effectively indefinitely)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 9999)

$action = New-ScheduledTaskAction -Execute $ScriptPath
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Health check for PM2 services and Worker - runs every 10 minutes"

Write-Host "Task '$TaskName' created successfully!" -ForegroundColor Green
Write-Host "The health check will run every 10 minutes." -ForegroundColor Cyan
