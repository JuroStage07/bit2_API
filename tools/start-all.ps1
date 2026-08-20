<#
  Arranca TODO en el orden correcto para exponer bit2-api por ngrok (URL fija):
    1. Levanta la API (npm start) si no esta corriendo.
    2. Espera a que /health responda en 127.0.0.1:8090.
    3. Arranca ngrok apuntando al dominio estatico.

  Uso:
    powershell -ExecutionPolicy Bypass -File tools\start-all.ps1

  El dominio se toma de la variable NGROK_DOMAIN; si no esta seteada usa el default de abajo.
#>

$ErrorActionPreference = "Stop"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$root    = Split-Path -Parent $here
$ngrok   = Join-Path $here "ngrok.exe"
$port    = if ($env:PORT) { $env:PORT } else { "8090" }
$domain  = if ($env:NGROK_DOMAIN) { $env:NGROK_DOMAIN } else { "pleading-evaporate-crawfish.ngrok-free.dev" }
$health  = "http://127.0.0.1:$port/health"

function Test-Api {
    try {
        $r = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 3
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# 1. API
if (Test-Api) {
    Write-Host "[1/3] API ya esta corriendo en $port." -ForegroundColor Green
} else {
    Write-Host "[1/3] Arrancando la API (npm start)..." -ForegroundColor Cyan
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm start" -WorkingDirectory $root -WindowStyle Minimized | Out-Null
}

# 2. Esperar a que /health responda
Write-Host "[2/3] Esperando a que la API responda en $health ..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Api) { $ok = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ok) {
    Write-Error "La API no respondio en 30s. Revisa la ventana de 'npm start' por errores (SQL, service-account, etc.)."
    exit 1
}
Write-Host "      API OK." -ForegroundColor Green

# 3. Tunnel ngrok (URL fija)
if (-not (Test-Path $ngrok)) {
    Write-Error "No se encontro ngrok.exe en $here."
    exit 1
}
Write-Host "[3/3] Arrancando ngrok -> https://$domain" -ForegroundColor Cyan
Write-Host "      URL publica (fija): https://$domain" -ForegroundColor Green
& $ngrok http --url=$domain $port --log=stdout
