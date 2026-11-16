@echo off
setlocal enabledelayedexpansion
title Attendance ^& Salary
cd /d "%~dp0"

echo ===================================================
echo     Attendance ^& Salary - System Launch
echo ===================================================
echo.

:: 1. Check if Node.js is available
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [Notice] Node.js runtime not detected in PATH.
    echo Running in Standalone Engine mode...
    echo.
    
    :: Check if pocketbase.exe exists
    if not exist "pb\pocketbase.exe" (
        echo [ERROR] PocketBase executable not found in pb\pocketbase.exe
        echo Please ensure project files are intact.
        pause
        exit /b 1
    )
    
    :: Migrate database
    "pb\pocketbase.exe" migrate up --dir="pb\pb_data" --migrationsDir="pb\pb_migrations"
    
    :: Start PocketBase and open browser
    start "" "http://127.0.0.1:8091"
    "pb\pocketbase.exe" serve --http="127.0.0.1:8091" --dir="pb\pb_data" --publicDir="pb\pb_public" --migrationsDir="pb\pb_migrations"
    pause
    exit /b 0
)

:: 2. Run the auto-healing launcher script with Node
node scripts\launcher.mjs

if %errorlevel% neq 0 (
    echo.
    echo ===================================================
    echo   Application encountered an error during launch.
    echo   Attempting automatic repair and restart...
    echo ===================================================
    call Stop-Attendance.bat
    ping -n 3 127.0.0.1 >nul
    node scripts\launcher.mjs
)

pause
