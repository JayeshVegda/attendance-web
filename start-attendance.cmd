@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Install Node.js and run: corepack enable
  pause
  exit /b 1
)

call pnpm start
if errorlevel 1 pause
