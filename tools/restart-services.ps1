<#
  Reinicia la API bit2 y el tunel ngrok en el orden correcto.
  Usar despues de editar el codigo de la API. Se auto-eleva a Administrador.
#>
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList "-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`""
    exit
}
Write-Host "Reiniciando servicios..." -ForegroundColor Cyan
Stop-Service bit2-ngrok -Force -ErrorAction SilentlyContinue
Restart-Service bit2-api -Force
Start-Sleep -Seconds 5
Start-Service bit2-ngrok
Start-Sleep -Seconds 3
Get-Service bit2-api, bit2-ngrok | Format-Table Name, Status -AutoSize
Write-Host "Listo." -ForegroundColor Green
Start-Sleep -Seconds 2
