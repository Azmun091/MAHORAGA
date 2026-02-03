# setup-startup-task.ps1
# Run this script ONCE as Administrator to create the Windows Task Scheduler task
# This will make the services start automatically after login

$TaskName = "MAHORAGA-Startup"
$ScriptPath = "C:\Users\azmunScripts\Documents\GitHub\MAHORAGA\scripts\startup-services.bat"
$Description = "Starts PM2 services for MAHORAGA Worker and Dashboard"

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator', then run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "Creating Windows Task Scheduler task: $TaskName" -ForegroundColor Cyan

# Remove existing task if it exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create the task
$action = New-ScheduledTaskAction -Execute $ScriptPath
$trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $Description

Write-Host ""
Write-Host "Task '$TaskName' created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "The task will run automatically when you log in to Windows." -ForegroundColor Cyan
Write-Host ""
Write-Host "To test the task manually, run:" -ForegroundColor Cyan
Write-Host "  schtasks /run /tn '$TaskName'" -ForegroundColor White
Write-Host ""
