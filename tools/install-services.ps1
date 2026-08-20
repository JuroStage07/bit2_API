<#
  Instala bit2-api y el tunel ngrok como servicios de Windows (con NSSM).
  - bit2-api    : corre node src\index.js (la API).
  - bit2-ngrok  : corre ngrok con el dominio fijo, depende de bit2-api.
  Ambos: inicio automatico con Windows + reinicio automatico si se caen.

  Se auto-eleva a Administrador (aparece un prompt de UAC).
#>

# --- Auto-elevacion ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Solicitando permisos de administrador (UAC)..." -ForegroundColor Yellow
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList "-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`""
    exit
}

$ErrorActionPreference = "Stop"
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$root   = Split-Path -Parent $here
$nssm   = Join-Path $here "nssm.exe"
$ngrok  = Join-Path $here "ngrok.exe"
$ngcfg  = Join-Path $here "ngrok.yml"
$logs   = Join-Path $here "logs"
$node   = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\Program Files\nodejs\node.exe" }

$port   = "8090"
$domain = "pleading-evaporate-crawfish.ngrok-free.dev"

New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Remove-Svc($name) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Host "Quitando servicio existente '$name'..." -ForegroundColor DarkYellow
        & $nssm stop $name | Out-Null
        & $nssm remove $name confirm | Out-Null
        Start-Sleep -Seconds 2
    }
}

# Limpieza previa: liberar puerto y sesiones ngrok viejas
Write-Host "Limpiando instancias previas..." -ForegroundColor Cyan
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($owner) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Remove-Svc "bit2-ngrok"
Remove-Svc "bit2-api"

# --- Servicio: bit2-api ---
Write-Host "Instalando servicio bit2-api..." -ForegroundColor Cyan
& $nssm install bit2-api $node "src\index.js"
& $nssm set bit2-api AppDirectory $root
& $nssm set bit2-api DisplayName "Bit2 API"
& $nssm set bit2-api Description "API bit2 (Express) - horas extra y marcas de asistencia"
& $nssm set bit2-api Start SERVICE_DELAYED_AUTO_START
& $nssm set bit2-api AppStdout (Join-Path $logs "api.log")
& $nssm set bit2-api AppStderr (Join-Path $logs "api.err.log")
& $nssm set bit2-api AppRotateFiles 1
& $nssm set bit2-api AppRotateBytes 5000000
& $nssm set bit2-api AppExit Default Restart
& $nssm set bit2-api AppRestartDelay 3000

# --- Servicio: bit2-ngrok ---
Write-Host "Instalando servicio bit2-ngrok..." -ForegroundColor Cyan
& $nssm install bit2-ngrok $ngrok "--config" $ngcfg "http" "--url=$domain" $port "--log=stdout"
& $nssm set bit2-ngrok AppDirectory $here
& $nssm set bit2-ngrok DisplayName "Bit2 ngrok tunnel"
& $nssm set bit2-ngrok Description "Tunel HTTPS ngrok hacia la API bit2 (dominio fijo)"
& $nssm set bit2-ngrok Start SERVICE_DELAYED_AUTO_START
& $nssm set bit2-ngrok DependOnService bit2-api
& $nssm set bit2-ngrok AppStdout (Join-Path $logs "ngrok.log")
& $nssm set bit2-ngrok AppStderr (Join-Path $logs "ngrok.err.log")
& $nssm set bit2-ngrok AppRotateFiles 1
& $nssm set bit2-ngrok AppRotateBytes 5000000
& $nssm set bit2-ngrok AppExit Default Restart
& $nssm set bit2-ngrok AppRestartDelay 5000

# --- Arrancar ---
Write-Host "Arrancando servicios..." -ForegroundColor Cyan
& $nssm start bit2-api
Start-Sleep -Seconds 5
& $nssm start bit2-ngrok
Start-Sleep -Seconds 3

Write-Host "`nEstado:" -ForegroundColor Green
Get-Service bit2-api, bit2-ngrok | Format-Table Name, Status, StartType -AutoSize

Write-Host "`nListo. La API queda en https://$domain" -ForegroundColor Green
Write-Host "Presiona Enter para cerrar..."
[void](Read-Host)
