<#
  Quita los servicios bit2-ngrok y bit2-api. Se auto-eleva a Administrador.
#>
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList "-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`""
    exit
}
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nssm = Join-Path $here "nssm.exe"
foreach ($name in @("bit2-ngrok","bit2-api")) {
    if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
        Write-Host "Quitando $name..." -ForegroundColor Yellow
        & $nssm stop $name | Out-Null
        & $nssm remove $name confirm | Out-Null
    }
}
Write-Host "Listo. Servicios removidos." -ForegroundColor Green
Write-Host "Presiona Enter para cerrar..."; [void](Read-Host)
