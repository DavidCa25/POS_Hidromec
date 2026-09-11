param(
  [Parameter(Mandatory = $true)]  [string] $ParamsFile,
  [Parameter(Mandatory = $false)] [string] $LogFile = ""
)

# ---------------------------------------------------------------------------
# PREPARAR ESTA MAQUINA COMO SERVIDOR DE OTRAS CAJAS.
#
# POR QUE EXISTE, SI YA ESTA setup-sqlserver.ps1
# ----------------------------------------------
# Aquel script hace TODO esto, pero solo corre cuando Wybix INSTALA SQL. Si el
# motor ya respondia -porque el cliente empezo con la prueba, porque tenia
# MonoCaja, o porque la maquina ya traia SQL Express de otro sistema- se salta
# entero, y con el se saltan el puerto TCP, el SQL Browser y el firewall. Ese
# es exactamente el cliente que hoy no puede pasar a MultiCaja sin que alguien
# le toque el equipo a mano.
#
# Este script es la parte de red, sin instalar nada, para poder ejecutarla el
# dia que el cliente compra MultiCaja.
#
# REINICIA EL SERVICIO SOLO SI HIZO FALTA
# ---------------------------------------
# Corre sobre una maquina VIVA, quiza con alguien vendiendo. Cada paso
# comprueba primero si ya esta como debe y solo escribe cuando no. Si nada
# cambio, el servicio NO se reinicia: reiniciarlo "por si acaso" corta las
# conexiones abiertas sin ningun motivo.
#
# Es idempotente: la segunda pasada no cambia nada y no reinicia nada.
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  $line = "[RED-SQL] $msg"
  Write-Host $line
  if ($LogFile -ne "") {
    try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch { }
  }
}

$hechos = New-Object System.Collections.ArrayList
function Hecho($clave, $estado, $detalle) {
  [void]$hechos.Add(@{ paso = $clave; estado = $estado; detalle = $detalle })
  Write-Step "$clave : $estado - $detalle"
}

$resultado = @{ ok = $false; pasos = @(); reinicioServicio = $false; error = $null }
$ResultFile = ""

try {
  if (-not (Test-Path $ParamsFile)) { throw "No se encontro el archivo de parametros: $ParamsFile" }
  $cfg = Get-Content -Path $ParamsFile -Raw | ConvertFrom-Json

  $InstanceName = [string]$cfg.InstanceName
  $Port = [string]$cfg.Port
  if ([string]::IsNullOrWhiteSpace($Port)) { $Port = "1433" }
  $ResultFile = [string]$cfg.ResultFile

  # ------------------------------------------------------------
  # 0) Que instancia es
  # ------------------------------------------------------------
  # No se SUPONE. Una maquina puede estar configurada como `localhost` -sin
  # nombre de instancia, porque el puerto 1433 esta fijo- y tener solo
  # SQLEXPRESS: dar por hecho MSSQLSERVER fallaria con "no existe el
  # servicio", que es un mensaje que no ayuda a nadie.
  $instRegPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
  $props = Get-ItemProperty -Path $instRegPath -ErrorAction Stop
  $instalados = @($props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $_.Name })

  if (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    if ($instalados -notcontains $InstanceName) {
      throw "Esta maquina no tiene la instancia '$InstanceName' de SQL Server. Instaladas: $($instalados -join ', ')."
    }
  } elseif ($instalados.Count -eq 1) {
    $InstanceName = $instalados[0]
  } elseif ($instalados.Count -eq 0) {
    throw "Esta maquina no tiene ninguna instancia de SQL Server."
  } else {
    throw "Esta maquina tiene varias instancias de SQL Server ($($instalados -join ', ')) y la configuracion no dice cual usa Wybix."
  }
  Write-Step "Instancia: $InstanceName"

  # El nombre del servicio depende de si la instancia es la predeterminada.
  $serviceName = if ($InstanceName -eq "MSSQLSERVER") { "MSSQLSERVER" } else { "MSSQL`$$InstanceName" }

  $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($null -eq $svc) { throw "No existe el servicio $serviceName. Esta maquina no tiene esa instancia de SQL Server." }

  $instId = $props.$InstanceName
  $raiz = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instId"

  $requiereReinicio = $false

  # ------------------------------------------------------------ 1) Modo mixto
  # Sin modo mixto, el login `ocus_app` existe pero NO puede iniciar sesion:
  # SQL Server rechaza toda autenticacion que no sea de Windows. Una caja
  # secundaria no es un usuario de Windows del servidor, asi que sin esto no
  # hay MultiCaja posible.
  $modo = (Get-ItemProperty -Path "$raiz\MSSQLServer" -Name "LoginMode" -ErrorAction SilentlyContinue).LoginMode
  if ($modo -ne 2) {
    Set-ItemProperty -Path "$raiz\MSSQLServer" -Name "LoginMode" -Value 2 -Type DWord
    $requiereReinicio = $true
    Hecho "modoMixto" "cambiado" "LoginMode $modo -> 2 (Windows + SQL Server)"
  } else {
    Hecho "modoMixto" "ya-estaba" "LoginMode 2"
  }

  # --------------------------------------------------------------- 2) TCP/IP
  $tcp = "$raiz\MSSQLServer\SuperSocketNetLib\Tcp"
  $tcpAll = "$tcp\IPAll"

  $habilitado = (Get-ItemProperty -Path $tcp -Name "Enabled" -ErrorAction SilentlyContinue).Enabled
  if ($habilitado -ne 1) {
    Set-ItemProperty -Path $tcp -Name "Enabled" -Value 1 -Type DWord
    $requiereReinicio = $true
    Hecho "tcpHabilitado" "cambiado" "protocolo TCP/IP habilitado"
  } else {
    Hecho "tcpHabilitado" "ya-estaba" "protocolo TCP/IP habilitado"
  }

  $puertoFijo = [string](Get-ItemProperty -Path $tcpAll -Name "TcpPort" -ErrorAction SilentlyContinue).TcpPort
  $puertoDin  = [string](Get-ItemProperty -Path $tcpAll -Name "TcpDynamicPorts" -ErrorAction SilentlyContinue).TcpDynamicPorts
  if ($puertoFijo -ne $Port -or $puertoDin -ne "") {
    # El puerto dinamico se vacia a proposito: mientras exista, SQL Server lo
    # prefiere y el 1433 que abrimos en el firewall no sirve de nada.
    Set-ItemProperty -Path $tcpAll -Name "TcpPort" -Value "$Port"
    Set-ItemProperty -Path $tcpAll -Name "TcpDynamicPorts" -Value ""
    $requiereReinicio = $true
    Hecho "puerto" "cambiado" "puerto fijo $Port (antes: fijo='$puertoFijo', dinamico='$puertoDin')"
  } else {
    Hecho "puerto" "ya-estaba" "puerto fijo $Port"
  }

  # ------------------------------------------------------- 3) Arranque y reinicio
  $inicio = (Get-CimInstance -ClassName Win32_Service -Filter "Name='$($serviceName.Replace("'","''"))'").StartMode
  if ($inicio -ne "Auto") {
    Set-Service -Name $serviceName -StartupType Automatic
    Hecho "arranqueAutomatico" "cambiado" "el servicio SQL arrancara con Windows"
  } else {
    Hecho "arranqueAutomatico" "ya-estaba" "automatico"
  }

  if ($requiereReinicio) {
    Write-Step "Reiniciando el servicio SQL para aplicar los cambios..."
    Restart-Service -Name $serviceName -Force -ErrorAction Stop
    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromMinutes(3))
    $resultado.reinicioServicio = $true
    Hecho "servicio" "reiniciado" "los cambios ya estan activos"
  } else {
    if ((Get-Service -Name $serviceName).Status -ne 'Running') {
      Start-Service -Name $serviceName
      (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromMinutes(3))
      Hecho "servicio" "iniciado" "estaba detenido"
    } else {
      Hecho "servicio" "ya-estaba" "sin cambios que aplicar: no se reinicia"
    }
  }

  # ---------------------------------------------------------- 4) SQL Browser
  # Es quien responde "la instancia SQLEXPRESS esta en el puerto N" cuando la
  # secundaria se conecta por NOMBRE de instancia (SERVIDOR\SQLEXPRESS), que
  # es como lo escribe el asistente.
  $br = Get-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue
  if ($null -eq $br) {
    Hecho "sqlBrowser" "ausente" "esta maquina no tiene el servicio SQL Browser"
  } else {
    $inicioBr = (Get-CimInstance -ClassName Win32_Service -Filter "Name='SQLBrowser'").StartMode
    if ($inicioBr -eq "Disabled" -or $inicioBr -ne "Auto") {
      Set-Service -Name "SQLBrowser" -StartupType Automatic
    }
    if ((Get-Service -Name "SQLBrowser").Status -ne 'Running') {
      Start-Service -Name "SQLBrowser"
      Hecho "sqlBrowser" "iniciado" "automatico y en marcha"
    } else {
      Hecho "sqlBrowser" "ya-estaba" "automatico y en marcha"
    }
  }

  # ------------------------------------------------------------- 5) Firewall
  $reglaSql = "SQL Server (TCP $Port)"
  if (-not (Get-NetFirewallRule -DisplayName $reglaSql -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $reglaSql -Direction Inbound `
      -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Hecho "firewallSql" "creada" $reglaSql
  } else {
    Enable-NetFirewallRule -DisplayName $reglaSql -ErrorAction SilentlyContinue
    Hecho "firewallSql" "ya-estaba" $reglaSql
  }

  $reglaBr = "SQL Browser (UDP 1434)"
  if (-not (Get-NetFirewallRule -DisplayName $reglaBr -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $reglaBr -Direction Inbound `
      -Protocol UDP -LocalPort 1434 -Action Allow | Out-Null
    Hecho "firewallBrowser" "creada" $reglaBr
  } else {
    Enable-NetFirewallRule -DisplayName $reglaBr -ErrorAction SilentlyContinue
    Hecho "firewallBrowser" "ya-estaba" $reglaBr
  }

  $resultado.ok = $true
  $resultado.pasos = $hechos.ToArray()
  Write-Step "Red preparada. SQL accesible en el puerto $Port."
}
catch {
  $resultado.ok = $false
  $resultado.pasos = $hechos.ToArray()
  $resultado.error = $_.Exception.Message
  Write-Step "ERROR: $($_.Exception.Message)"
}

if ($ResultFile -ne "") {
  try {
    $json = ConvertTo-Json -InputObject $resultado -Depth 6 -Compress
    [System.IO.File]::WriteAllText($ResultFile, $json, (New-Object System.Text.UTF8Encoding $false))
  } catch { Write-Step "No se pudo escribir el resultado: $($_.Exception.Message)" }
}

if ($resultado.ok) { exit 0 } else { exit 1 }
