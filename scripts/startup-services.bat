@echo off
REM Startup script for MAHORAGA services
REM This batch file launches the PowerShell script with proper execution policy
REM Add this to Windows Task Scheduler to run at startup

powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "C:\Users\azmunScripts\Documents\GitHub\MAHORAGA\scripts\startup-services.ps1"
