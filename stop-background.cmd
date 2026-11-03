@echo off
setlocal
echo Stopping attendance-web background services (ports 8091 and 5173)...

powershell -NoProfile -Command ^
  "Get-NetTCPConnection -LocalPort 8091,5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host 'Services stopped.'"

echo Done.
timeout /t 2 >nul
