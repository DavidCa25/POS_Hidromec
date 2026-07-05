# ============================================================
# setup-sqlserver.ps1
# Instala SQL Server Express (si no existe) y lo deja accesible por red.
# Corre ELEVADO (administrador). Idempotente: se puede correr varias veces.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File setup-sqlserver.ps1 `
#     -SetupExe "C:\ruta\SQLEXPR\setup.exe" `
#     -ConfigFile "C:\ruta\ConfigurationFile.ini" `
#     -SaPassword "ContrasenaFuerte123"
# ============================================================

param(
  [Parameter(Mandatory=$true)] [string]$SetupExe,
  [Parameter(Mandatory=$true)] [string]$ConfigFile,
  [Parameter(Mandatory=$true)] [string]$SaPassword,
  [string]$InstanceName = "SQLEXPRESS",
  [int]$Port = 1433
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[SETUP-SQL] $msg" }

$serviceName = "MSSQL`$$InstanceName"

# ------------------------------------------------------------
# 1) Instalar SQL Express si la instancia no existe
# ------------------------------------------------------------
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -ne $svc) {
  Write-Step "La instancia $InstanceName ya existe. Se omite la instalacion."
} else {
  Write-Step "Instalando SQL Server Express (esto tarda varios minutos)..."
  $args = @(
    "/ConfigurationFile=`"$ConfigFile`"",
    "/SAPWD=`"$SaPassword`"",
    "/IACCEPTSQLSERVERLICENSETERMS"
  )
  $p = Start-Process -FilePath $SetupExe -ArgumentList $args -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    throw "La instalacion de SQL Express fallo con codigo $($p.ExitCode)."
  }
  Write-Step "SQL Express instalado."
}

# ------------------------------------------------------------
# 2) Fijar el puerto TCP a 1433 (via registro)
# ------------------------------------------------------------
Write-Step "Configurando TCP en el puerto $Port..."

# Localiza la clave de la instancia (MSSQLxx.SQLEXPRESS)
$instRegPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
$instId = (Get-ItemProperty -Path $instRegPath -Name $InstanceName -ErrorAction Stop).$InstanceName

$tcpIpAll = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instId\MSSQLServer\SuperSocketNetLib\Tcp\IPAll"

Set-ItemProperty -Path $tcpIpAll -Name "TcpPort" -Value "$Port"
Set-ItemProperty -Path $tcpIpAll -Name "TcpDynamicPorts" -Value ""

# Asegura que el protocolo TCP este habilitado
$tcpEnabled = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instId\MSSQLServer\SuperSocketNetLib\Tcp"
Set-ItemProperty -Path $tcpEnabled -Name "Enabled" -Value 1

# ------------------------------------------------------------
# 3) Reiniciar el servicio para aplicar el puerto
# ------------------------------------------------------------
Write-Step "Reiniciando el servicio SQL..."
Restart-Service -Name $serviceName -Force
Set-Service -Name $serviceName -StartupType Automatic

# ------------------------------------------------------------
# 4) SQL Browser (para resolver instancia por nombre desde otras PCs)
# ------------------------------------------------------------
Write-Step "Habilitando SQL Browser..."
Set-Service -Name "SQLBrowser" -StartupType Automatic
Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue

# ------------------------------------------------------------
# 5) Reglas de firewall
# ------------------------------------------------------------
Write-Step "Abriendo puertos en el firewall..."

if (-not (Get-NetFirewallRule -DisplayName "SQL Server (TCP $Port)" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "SQL Server (TCP $Port)" -Direction Inbound `
    -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}

if (-not (Get-NetFirewallRule -DisplayName "SQL Browser (UDP 1434)" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "SQL Browser (UDP 1434)" -Direction Inbound `
    -Protocol UDP -LocalPort 1434 -Action Allow | Out-Null
}

Write-Step "Listo. SQL Express accesible en el puerto $Port."
exit 0