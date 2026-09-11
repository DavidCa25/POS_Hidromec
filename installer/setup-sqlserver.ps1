param(
  [Parameter(Mandatory = $true)]  [string] $ParamsFile,
  [Parameter(Mandatory = $false)] [string] $LogFile = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  $line = "[SETUP-SQL] $msg"
  Write-Host $line
  if ($LogFile -ne "") {
    try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch { }
  }
}

try {
  # ------------------------------------------------------------
  # Parametros (llegan por JSON, sin nada que escapar)
  # ------------------------------------------------------------
  if (-not (Test-Path $ParamsFile)) { throw "No se encontro el archivo de parametros: $ParamsFile" }
  $cfg = Get-Content -Path $ParamsFile -Raw | ConvertFrom-Json

  $SetupExe    = [string]$cfg.SetupExe
  $ConfigFile  = [string]$cfg.ConfigFile
  $SaPassword  = [string]$cfg.SaPassword
  $InstanceName = "SQLEXPRESS"
  $Port         = "1433"
  $serviceName  = "MSSQL`$$InstanceName"

  Write-Step "Parametros leidos. SetupExe: $SetupExe"

  if (-not (Test-Path $SetupExe))   { throw "No se encontro SETUP.EXE en: $SetupExe" }
  if (-not (Test-Path $ConfigFile)) { throw "No se encontro ConfigurationFile.ini en: $ConfigFile" }

  # ------------------------------------------------------------
  # 1) Instalar SQL Express (si la instancia no existe)
  # ------------------------------------------------------------
  $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($null -ne $svc) {
    Write-Step "La instancia $InstanceName ya existe. Se omite la instalacion."
  } else {
    Write-Step "Instalando SQL Server Express (esto tarda varios minutos)..."

    # SQL setup DEBE correr desde la carpeta del medio, y con los VALORES entre comillas
    # (igual que a mano). Se lanza con .NET Process para pasar los argumentos TAL CUAL,
    # sin que PowerShell re-entrecomille las rutas con espacios (Program Files, Wybix POS).
    # Eso -las comillas mal puestas por el espacio- era lo que causaba el -196608.
    $workDir = Split-Path -Parent $SetupExe
    $argLine = "/ConfigurationFile=`"$ConfigFile`" /SAPWD=`"$SaPassword`" /IACCEPTSQLSERVERLICENSETERMS"

    Write-Step "Ejecutando SETUP.EXE desde: $workDir"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName         = $SetupExe
    $psi.Arguments        = $argLine
    $psi.WorkingDirectory = $workDir
    $psi.UseShellExecute  = $false
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.WaitForExit()

    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
      throw "La instalacion de SQL Express fallo con codigo $($p.ExitCode). Revisa el Summary.txt en 'Setup Bootstrap\Log'."
    }
    Write-Step "SQL Express instalado."
  }

  # ------------------------------------------------------------
  # 1.5) Actualizacion de seguridad del motor (GDR)
  # ------------------------------------------------------------
  # El medio base es RTM (15.0.2000.5), de septiembre de 2019. Dejarlo asi
  # significa entregar un motor sin los parches de seguridad publicados desde
  # entonces, y en Wybix ese motor acepta conexiones TCP de otras maquinas de
  # la red -es el requisito de multicaja-. Por eso toda instalacion nueva
  # queda parcheada antes de crear la base.
  #
  # Se aplica la rama GDR: solo seguridad, sin cambios de comportamiento. Los
  # datos del parche (KB, build, hash) viven en installer/sql-servicing.json,
  # que es lo unico que hay que tocar para cambiarlo en un release futuro.
  $buildEsperado = $null
  $reinicioPendiente = $false
  if ($null -ne $cfg.Servicing -and $null -ne $cfg.Servicing.Paquete) {
    $parche        = [string]$cfg.Servicing.Paquete
    $kb            = [string]$cfg.Servicing.KB
    $buildEsperado = [string]$cfg.Servicing.Build
    $sha256        = [string]$cfg.Servicing.Sha256

    if (-not (Test-Path $parche)) {
      throw "No se encontro la actualizacion de seguridad $kb en: $parche"
    }

    # El hash se comprueba aqui tambien, no solo al empaquetar: entre el
    # empaquetado y esta maquina el archivo pudo corromperse.
    $hashReal = (Get-FileHash -Path $parche -Algorithm SHA256).Hash
    if ($hashReal -ne $sha256.ToUpper()) {
      throw "La actualizacion $kb no coincide con la oficial. Esperado $sha256, encontrado $hashReal."
    }
    Write-Step "Aplicando actualizacion de seguridad $kb (build $buildEsperado). Puede tardar varios minutos..."

    # /Action=Patch sobre la instancia, en silencio y aceptando la licencia.
    $argParche = "/qs /IAcceptSQLServerLicenseTerms /Action=Patch /InstanceName=$InstanceName"
    $pp = New-Object System.Diagnostics.ProcessStartInfo
    $pp.FileName         = $parche
    $pp.Arguments        = $argParche
    $pp.WorkingDirectory = (Split-Path -Parent $parche)
    $pp.UseShellExecute  = $false
    $procParche = [System.Diagnostics.Process]::Start($pp)
    $procParche.WaitForExit()
    $codigo = $procParche.ExitCode

    # 0 = aplicado y terminado. 3010 = aplicado, pero Windows tiene operaciones
    # pendientes hasta el reinicio. No se tratan igual: con 3010 no se da por
    # bueno el motor todavia, se termina la configuracion de red -que son
    # cambios de registro, independientes del parche- y se sale con 3010 para
    # que Wybix pida el reinicio antes de crear ninguna base.
    if ($codigo -eq 0) {
      Write-Step "Actualizacion $kb aplicada."
    } elseif ($codigo -eq 3010) {
      Write-Step "Actualizacion $kb aplicada. Windows solicita reinicio (3010)."
      $reinicioPendiente = $true
    } else {
      throw "La actualizacion $kb fallo con codigo $codigo. Revisa el Summary.txt en 'Setup Bootstrap\Log'."
    }

    # El servicio tiene que volver a levantar para que el motor sirva ya
    # parcheado; si no arranca, no se sigue adelante.
    Write-Step "Reiniciando el servicio SQL tras la actualizacion..."
    Restart-Service -Name $serviceName -Force -ErrorAction Stop
    $svcTrasParche = Get-Service -Name $serviceName
    $svcTrasParche.WaitForStatus('Running', [TimeSpan]::FromMinutes(3))
  } else {
    Write-Step "Sin actualizacion de seguridad configurada: el motor queda como lo dejo el medio."
  }

  # ------------------------------------------------------------
  # 2) Fijar el puerto TCP
  # ------------------------------------------------------------
  Write-Step "Configurando TCP en el puerto $Port..."

  $instRegPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
  $instId = (Get-ItemProperty -Path $instRegPath -Name $InstanceName -ErrorAction Stop).$InstanceName

  $tcpIpAll = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instId\MSSQLServer\SuperSocketNetLib\Tcp\IPAll"
  Set-ItemProperty -Path $tcpIpAll -Name "TcpPort" -Value "$Port"
  Set-ItemProperty -Path $tcpIpAll -Name "TcpDynamicPorts" -Value ""

  $tcpEnabled = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instId\MSSQLServer\SuperSocketNetLib\Tcp"
  Set-ItemProperty -Path $tcpEnabled -Name "Enabled" -Value 1

  # ------------------------------------------------------------
  # 3) Reiniciar el servicio
  # ------------------------------------------------------------
  Write-Step "Reiniciando el servicio SQL..."
  Restart-Service -Name $serviceName -Force
  Set-Service -Name $serviceName -StartupType Automatic

  # ------------------------------------------------------------
  # 4) SQL Browser (para descubrir la instancia por red / multicaja)
  # ------------------------------------------------------------
  Write-Step "Habilitando SQL Browser..."
  Set-Service -Name "SQLBrowser" -StartupType Automatic -ErrorAction SilentlyContinue
  Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue

  # ------------------------------------------------------------
  # 5) Firewall
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

  # ------------------------------------------------------------
  # 6) Comprobar el build REAL del motor
  # ------------------------------------------------------------
  # Que el instalador del parche devuelva 0 no prueba que el motor este
  # parcheado: se le pregunta a SQL Server, que es el unico que lo sabe.
  #
  # Con reinicio pendiente NO se comprueba aqui: Windows tiene operaciones a
  # medias y lo que responda el motor ahora no es concluyente. Se sale con
  # 3010, Wybix pide el reinicio, y al volver a arrancar se verifica de verdad.
  if ($reinicioPendiente) {
    Write-Step "Reinicio pendiente: la verificacion del motor se hara tras reiniciar."
    Write-Step "SQL Express configurado. Falta reiniciar Windows."
    exit 3010
  }

  if ($null -ne $buildEsperado) {
    Write-Step "Comprobando la version del motor..."
    $cs = "Server=localhost\$InstanceName;Database=master;Integrated Security=True;TrustServerCertificate=True"
    $cn = New-Object System.Data.SqlClient.SqlConnection $cs
    try {
      $cn.Open()
      $cmd = $cn.CreateCommand()
      $cmd.CommandText = "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(64))"
      $buildReal = [string]$cmd.ExecuteScalar()
    } finally {
      $cn.Close()
    }

    if ([System.Version]$buildReal -lt [System.Version]$buildEsperado) {
      throw ("El motor quedo en $buildReal y se esperaba $buildEsperado o superior. " +
             "La actualizacion de seguridad no se aplico. No se continua con la instalacion.")
    }
    Write-Step "Motor verificado: $buildReal."
  }

  Write-Step "Listo. SQL Express accesible en el puerto $Port."
  exit 0
}
catch {
  Write-Step "ERROR: $($_.Exception.Message)"
  exit 1
}
