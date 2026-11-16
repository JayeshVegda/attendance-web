$ports = @(8091, 5173)
foreach ($port in $ports) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $conns) {
            $procId = $conn.OwningProcess
            if ($procId -gt 4) {
                Write-Host "Stopping process $procId on port $port..." -ForegroundColor Yellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
}
Write-Host "All Attendance services stopped." -ForegroundColor Green
