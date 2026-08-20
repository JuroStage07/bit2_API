$host_ = "10.17.230.2"
$port = 1433
$c = New-Object System.Net.Sockets.TcpClient
$iar = $c.BeginConnect($host_, $port, $null, $null)
if ($iar.AsyncWaitHandle.WaitOne(4000)) {
    try { $c.EndConnect($iar); Write-Host "TCP ${host_}:${port} -> ABIERTO" -ForegroundColor Green }
    catch { Write-Host "TCP ${host_}:${port} -> RECHAZADO (puerto cerrado / SQL apagado)" -ForegroundColor Yellow }
} else {
    Write-Host "TCP ${host_}:${port} -> TIMEOUT (host inalcanzable en la red)" -ForegroundColor Red
}
$c.Close()
Write-Host "--- Ping ---"
if (Test-Connection -ComputerName $host_ -Count 2 -Quiet) {
    Write-Host "Ping OK (el host responde)" -ForegroundColor Green
} else {
    Write-Host "Ping FALLA (no hay ruta al host)" -ForegroundColor Red
}
