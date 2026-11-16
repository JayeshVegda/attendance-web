@echo off
setlocal
title Stop Attendance and Salary
cd /d "%~dp0"

echo ===================================================
echo   Stopping Attendance and Salary Services...
echo ===================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-services.ps1"

echo.
echo Services have been stopped cleanly.
ping -n 3 127.0.0.1 >nul
