<#
  NOTA: este script es la via ALTERNATIVA (Cloudflare) y hoy NO se usa.
  El tunel oficial es ngrok -> usar tools\start-all.ps1 (manual) o
  tools\install-services.ps1 (como servicio). Ver README.md.

  Arranca un Cloudflare Tunnel HTTPS hacia la API local (bit2-api) en el puerto 8090.

  Uso:
    powershell -ExecutionPolicy Bypass -File tools\start-tunnel.ps1

  Notas:
  - Quick tunnel (por defecto): URL aleatoria de *.trycloudflare.com que CAMBIA en cada arranque.
  - Para URL estable, usar un named tunnel (ver README / instrucciones del equipo) y setear
    la variable de entorno TUNNEL_NAME antes de correr este script.
#>

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cf = Join-Path $here "cloudflared.exe"
$port = if ($env:PORT) { $env:PORT } else { "8090" }

if (-not (Test-Path $cf)) {
    Write-Error "No se encontró cloudflared.exe en $here. Descargalo de https://github.com/cloudflare/cloudflared/releases/latest"
    exit 1
}

if ($env:TUNNEL_NAME) {
    Write-Host "Arrancando named tunnel '$($env:TUNNEL_NAME)' -> http://127.0.0.1:$port" -ForegroundColor Cyan
    & $cf tunnel --no-autoupdate run $env:TUNNEL_NAME
} else {
    Write-Host "Arrancando quick tunnel -> http://127.0.0.1:$port" -ForegroundColor Cyan
    Write-Host "La URL publica aparecera abajo (https://XXXX.trycloudflare.com)." -ForegroundColor Yellow
    & $cf tunnel --no-autoupdate --url "http://127.0.0.1:$port"
}
