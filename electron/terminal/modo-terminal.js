/**
 * MODO TERMINAL: este equipo, solo para operar.
 *
 * QUE HACE, Y QUE NO
 * ------------------
 * NO mata procesos, NO oculta el escritorio, NO vigila nada en bucle. Aplica
 * DIRECTIVAS DE USUARIO OFICIALES de Windows -las mismas que escribe el
 * Editor de directivas de grupo- a la cuenta de Windows que usa esta caja:
 *
 *   Ejecutar solo aplicaciones de Windows especificadas   (RestrictRun)
 *   Quitar «Ejecutar» del menu Inicio                      (NoRun)
 *   Prohibir el acceso al Panel de control y Configuracion (NoControlPanel)
 *   Quitar el Administrador de tareas          (DisableTaskMgr, opcional)
 *
 * Son valores del registro bajo `Software\Microsoft\Windows\CurrentVersion\
 * Policies` de ESA cuenta. Windows los respeta en todas las ediciones de
 * escritorio (Home, Pro, Enterprise, Education). Explorer los lee al iniciar
 * sesion: surten efecto al cerrar sesion de Windows y volver a entrar.
 *
 * Los mecanismos mas fuertes -Acceso asignado (quiosco), Shell Launcher,
 * AppLocker- dependen de la edicion y se configuran con MDM o una cuenta de
 * sistema. Aqui se DETECTAN y se explican; no se aplican desde Wybix.
 *
 * NADA SIN VUELTA ATRAS
 * ---------------------
 *   1. Antes de escribir un solo valor se guarda el estado exacto de cada uno
 *      (si existia, su tipo y su valor) en `%ProgramData%\Wybix\terminal`.
 *   2. Si algo falla a medias, se restaura ese respaldo en el mismo script.
 *   3. Junto al respaldo queda `restaurar-modo-terminal.ps1`: si Wybix no
 *      abriera, un administrador lo ejecuta desde otra cuenta y todo vuelve.
 *   4. Activar y restaurar piden elevacion (UAC). Sin administrador no se toca
 *      nada.
 *
 * Este modulo separa lo PURO (plan, scripts, capacidades: se prueba sin
 * Windows) de lo que ejecuta PowerShell.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const POLITICAS = 'Software\\Microsoft\\Windows\\CurrentVersion\\Policies';

// ---------------------------------------------------------------- edicion
function familiaDeEdicion(editionId) {
  const e = String(editionId || '').toLowerCase();
  if (!e) return 'DESCONOCIDA';
  if (/server/.test(e)) return 'SERVER';
  if (/iot/.test(e)) return 'IOT';
  if (/education/.test(e)) return 'EDUCATION';
  if (/enterprise/.test(e)) return 'ENTERPRISE';
  if (/professional|pro\b|^pro/.test(e)) return 'PRO';
  if (/core|home/.test(e)) return 'HOME';
  return 'DESCONOCIDA';
}

/** El nombre comercial: el registro dice «Windows 10» tambien en Windows 11. */
function nombreDeWindows(build, familia) {
  const b = Number(build) || 0;
  const version = b >= 22000 ? 'Windows 11' : 'Windows 10';
  const ed = { HOME: 'Home', PRO: 'Pro', ENTERPRISE: 'Enterprise', EDUCATION: 'Education', IOT: 'IoT', SERVER: 'Server' }[familia] || '';
  return `${version} ${ed}`.trim();
}

/**
 * Que puede hacer ESTE Windows. Cada mecanismo dice si esta disponible y,
 * si no, por que. Nada se supone: todo sale de la auditoria.
 */
function capacidades({ familia, build, enAdministradores }) {
  const b = Number(build) || 0;
  const escritorio = ['HOME', 'PRO', 'ENTERPRISE', 'EDUCATION', 'IOT'].includes(familia);
  const corporativa = ['ENTERPRISE', 'EDUCATION', 'IOT'].includes(familia);
  const conQuiosco = ['PRO', 'ENTERPRISE', 'EDUCATION', 'IOT'].includes(familia);

  return [
    {
      id: 'politicas-usuario',
      nombre: 'Directivas de usuario de Windows',
      aplicaWybix: true,
      disponible: escritorio && enAdministradores,
      motivo: !escritorio
        ? 'Esta edición de Windows no es de escritorio.'
        : (!enAdministradores ? 'Hace falta una cuenta de administrador para aplicarlas.' : null),
      detalle: 'Solo deja abrir las aplicaciones permitidas, quita «Ejecutar» y el Panel de control. Todas las ediciones.',
    },
    {
      id: 'acceso-asignado',
      nombre: 'Acceso asignado (quiosco)',
      aplicaWybix: false,
      disponible: conQuiosco && b >= 22621,
      motivo: !conQuiosco ? 'No existe en Windows Home.'
        : (b < 22621 ? 'El quiosco de varias aplicaciones necesita Windows 11 22H2 o posterior.' : null),
      detalle: 'Una cuenta que solo ve las aplicaciones elegidas. Se configura en Configuración › Cuentas › Otros usuarios › Quiosco, o por MDM.',
    },
    {
      id: 'shell-launcher',
      nombre: 'Shell Launcher',
      aplicaWybix: false,
      disponible: corporativa,
      motivo: corporativa ? null : 'Solo en Windows Enterprise, Education o IoT.',
      detalle: 'Sustituye el escritorio de Windows por Wybix para una cuenta.',
    },
    {
      id: 'applocker',
      nombre: 'AppLocker',
      aplicaWybix: false,
      disponible: corporativa,
      motivo: corporativa ? null : 'Windows solo hace cumplir AppLocker en Enterprise y Education.',
      detalle: 'Reglas de qué programas pueden ejecutarse, por firma o ruta.',
    },
  ];
}

// ------------------------------------------------------------------- plan
/**
 * Los valores a escribir. `permitidos` son nombres de ejecutable; Wybix va
 * SIEMPRE, lo pida quien lo pida: una lista sin Wybix dejaria la caja sin la
 * aplicacion para la que existe.
 */
function plan({ ejecutableWybix, permitirExcel = false, bloquearTaskMgr = false }) {
  const permitidos = [];
  const agregar = (n) => { if (n && !permitidos.some(x => x.toLowerCase() === n.toLowerCase())) permitidos.push(n); };
  agregar(ejecutableWybix || 'Wybix.exe');
  if (permitirExcel) agregar('EXCEL.EXE');

  const valores = [
    { clave: 'Explorer', nombre: 'RestrictRun', tipo: 'DWord', valor: 1 },
    ...permitidos.map((exe, i) => ({ clave: 'Explorer\\RestrictRun', nombre: String(i + 1), tipo: 'String', valor: exe })),
    { clave: 'Explorer', nombre: 'NoRun', tipo: 'DWord', valor: 1 },
    { clave: 'Explorer', nombre: 'NoControlPanel', tipo: 'DWord', valor: 1 },
  ];
  if (bloquearTaskMgr) valores.push({ clave: 'System', nombre: 'DisableTaskMgr', tipo: 'DWord', valor: 1 });
  return { permitidos, valores };
}

/** Lo que se bloqueara, dicho para una persona. */
function queSeBloquea({ permitidos, bloquearTaskMgr }) {
  const l = [
    `Desde el escritorio y el menú Inicio solo se podrán abrir: ${permitidos.join(', ')}.`,
    'Se quita «Ejecutar» del menú Inicio.',
    'Se bloquea el Panel de control y la aplicación Configuración.',
  ];
  if (bloquearTaskMgr) l.push('Se quita el Administrador de tareas.');
  l.push('Solo afecta a esta cuenta de Windows. Las demás cuentas, incluidas las de administrador, siguen igual.');
  l.push('Surte efecto al cerrar sesión de Windows y volver a entrar.');
  return l;
}

// ---------------------------------------------------------------- rutas
function carpetaTerminal(sandbox) {
  return sandbox
    ? path.join(os.tmpdir(), 'wybix-terminal-sandbox')
    : path.join(process.env.ProgramData || 'C:\\ProgramData', 'Wybix', 'terminal');
}

/** La raiz del registro donde se escribe: la cuenta real, o el arenero. */
function raizRegistro(sid, sandbox) {
  const s = String(sid || '').replace(/[^A-Za-z0-9-]/g, '');
  return sandbox
    ? `Registry::HKEY_CURRENT_USER\\Software\\Wybix\\TerminalSandbox\\${s}\\${POLITICAS}`
    : `Registry::HKEY_USERS\\${s}\\${POLITICAS}`;
}

function rutasPara(sid, sandbox) {
  const dir = carpetaTerminal(sandbox);
  const s = String(sid || '').replace(/[^A-Za-z0-9-]/g, '');
  return {
    dir,
    respaldo: path.join(dir, `respaldo-${s}.json`),
    restaurarManual: path.join(dir, 'restaurar-modo-terminal.ps1'),
    raiz: raizRegistro(sid, sandbox),
  };
}

// --------------------------------------------------------------- scripts
const q = (s) => String(s).replace(/'/g, "''");

const RESTAURAR_CUERPO = `
function Restaurar-Desde($r) {
  foreach ($v in $r.valores) {
    $k = "$($r.raiz)\\$($v.clave)"
    if ($v.existe) {
      if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
      New-ItemProperty -LiteralPath $k -Name $v.nombre -PropertyType $v.tipo -Value $v.valor -Force | Out-Null
    } elseif (Test-Path -LiteralPath $k) {
      Remove-ItemProperty -LiteralPath $k -Name $v.nombre -ErrorAction SilentlyContinue
    }
  }
  $nuevas = $r.valores | Where-Object { -not $_.existeClave } | Select-Object -ExpandProperty clave -Unique |
            Sort-Object { $_.Length } -Descending
  foreach ($c in $nuevas) {
    $k = "$($r.raiz)\\$c"
    if ((Test-Path -LiteralPath $k) -and ((Get-Item -LiteralPath $k).ValueCount -eq 0) -and
        (@(Get-ChildItem -LiteralPath $k).Count -eq 0)) { Remove-Item -LiteralPath $k -Force }
  }
}
`;

function scriptAplicar({ valores, raiz, respaldo, resultado }) {
  return `$ErrorActionPreference = 'Stop'
$resultado = '${q(resultado)}'
function Fin($ok, $msg) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resultado) | Out-Null
  @{ ok = $ok; mensaje = $msg } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultado -Encoding UTF8
  if ($ok) { exit 0 } else { exit 1 }
}
${RESTAURAR_CUERPO}
$raiz = '${q(raiz)}'
$respaldo = '${q(respaldo)}'
$escrito = $false
try {
  if (Test-Path -LiteralPath $respaldo) { Fin $false 'El modo terminal ya está activo en esta cuenta de Windows.' }
  $plan = ConvertFrom-Json @'
${JSON.stringify(valores)}
'@
  $antes = @()
  foreach ($p in $plan) {
    $k = "$raiz\\$($p.clave)"
    $existeClave = Test-Path -LiteralPath $k
    $existe = $false; $tipo = $null; $valor = $null
    if ($existeClave) {
      $item = Get-Item -LiteralPath $k
      if ($item.GetValueNames() -contains $p.nombre) {
        $existe = $true; $valor = $item.GetValue($p.nombre); $tipo = $item.GetValueKind($p.nombre).ToString()
      }
    }
    $antes += [pscustomobject]@{ clave = $p.clave; nombre = $p.nombre; existeClave = $existeClave; existe = $existe; tipo = $tipo; valor = $valor }
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $respaldo) | Out-Null
  $copia = [pscustomobject]@{ raiz = $raiz; creado = (Get-Date).ToString('o'); valores = $antes }
  $copia | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $respaldo -Encoding UTF8
  $escrito = $true
  foreach ($p in $plan) {
    $k = "$raiz\\$($p.clave)"
    if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
    New-ItemProperty -LiteralPath $k -Name $p.nombre -PropertyType $p.tipo -Value $p.valor -Force | Out-Null
  }
  Fin $true 'OK'
} catch {
  $err = $_.Exception.Message
  if ($escrito) {
    try { Restaurar-Desde (Get-Content -Raw -LiteralPath $respaldo | ConvertFrom-Json); Remove-Item -LiteralPath $respaldo -Force } catch {}
    Fin $false "No se aplicó y se dejó todo como estaba: $err"
  }
  Fin $false $err
}
`;
}

function scriptRestaurar({ respaldo, resultado }) {
  return `$ErrorActionPreference = 'Stop'
$resultado = '${q(resultado)}'
function Fin($ok, $msg) {
  if ($resultado) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resultado) | Out-Null
    @{ ok = $ok; mensaje = $msg } | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultado -Encoding UTF8
  } else { Write-Output $msg }
  if ($ok) { exit 0 } else { exit 1 }
}
${RESTAURAR_CUERPO}
$respaldo = '${q(respaldo)}'
try {
  if (-not (Test-Path -LiteralPath $respaldo)) { Fin $false 'No hay respaldo: el modo terminal no está activo en esta cuenta.' }
  Restaurar-Desde (Get-Content -Raw -LiteralPath $respaldo | ConvertFrom-Json)
  Remove-Item -LiteralPath $respaldo -Force
  Fin $true 'OK'
} catch { Fin $false $_.Exception.Message }
`;
}

/** El script para restaurar a mano, sin Wybix. Se deja junto al respaldo. */
function scriptRestaurarManual({ respaldo }) {
  return `# Restaura el modo terminal de Wybix sin abrir Wybix.
# Ejecutalo como administrador:  clic derecho > Ejecutar con PowerShell
# Devuelve cada directiva al valor exacto que tenia antes de activarlo.
` + scriptRestaurar({ respaldo, resultado: '' }).replace("$resultado = ''", '$resultado = $null');
}

// ----------------------------------------------------------- ejecutar
function ejecutarPs(script, { elevar = false, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, mensaje: 'Solo disponible en Windows.' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxterm-'));
    const ps1 = path.join(dir, 'paso.ps1');
    fs.writeFileSync(ps1, '\ufeff' + script, 'utf8');
    const args = elevar
      ? ['-NoProfile', '-NonInteractive', '-Command',
         `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
         `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${ps1}"'; exit $p.ExitCode } ` +
         `catch { Write-Output 'CANCELADO'; exit 1223 }`]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1];
    const hijo = spawn('powershell.exe', args, { windowsHide: true });
    let out = '', err = '';
    const reloj = setTimeout(() => { try { hijo.kill(); } catch { /* ya salio */ } }, timeoutMs);
    hijo.stdout.on('data', (d) => { out += d.toString(); });
    hijo.stderr.on('data', (d) => { err += d.toString(); });
    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporal */ }
      resolve({ codigo, out, err, cancelado: codigo === 1223 || /CANCELADO/.test(out) });
    });
  });
}

function leerResultado(ruta) {
  try {
    const txt = fs.readFileSync(ruta, 'utf8').replace(/^\ufeff/, '');
    fs.rmSync(ruta, { force: true });
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- auditar
const SCRIPT_AUDITORIA = `$ErrorActionPreference = 'Stop'
$cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$p = New-Object Security.Principal.WindowsPrincipal($id)
$admins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
[pscustomobject]@{
  edicion = $cv.EditionID; producto = $cv.ProductName; build = $cv.CurrentBuild; ubr = $cv.UBR
  version = $cv.DisplayVersion; usuario = $id.Name; sid = $id.User.Value
  enAdministradores = [bool]($id.Groups | Where-Object { $_.Equals($admins) })
  elevado = $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} | ConvertTo-Json -Compress`;

async function auditar({ sandbox = false } = {}) {
  const r = await ejecutarPs(SCRIPT_AUDITORIA);
  let w;
  try { w = JSON.parse(String(r.out || '').trim()); } catch { return { ok: false, mensaje: 'No se pudo leer la información de Windows.' }; }
  const familia = familiaDeEdicion(w.edicion);
  const rutas = rutasPara(w.sid, sandbox);
  return {
    ok: true,
    windows: {
      nombre: nombreDeWindows(w.build, familia),
      edicion: w.edicion, familia, build: `${w.build}.${w.ubr}`, version: w.version,
      usuario: w.usuario, sid: w.sid,
      enAdministradores: !!w.enAdministradores, elevado: !!w.elevado,
    },
    capacidades: capacidades({ familia, build: w.build, enAdministradores: !!w.enAdministradores || sandbox }),
    activo: fs.existsSync(rutas.respaldo),
    rutas: { respaldo: rutas.respaldo, restaurarManual: rutas.restaurarManual },
    sandbox,
  };
}

// ------------------------------------------------------ activar / restaurar
async function activar({ sid, ejecutableWybix, permitirExcel, bloquearTaskMgr, sandbox = false }) {
  if (!sid) return { ok: false, mensaje: 'Falta la cuenta de Windows.' };
  const rutas = rutasPara(sid, sandbox);
  const p = plan({ ejecutableWybix, permitirExcel, bloquearTaskMgr });
  const resultado = path.join(rutas.dir, `resultado-${Date.now()}.json`);
  fs.mkdirSync(rutas.dir, { recursive: true });

  const r = await ejecutarPs(scriptAplicar({ valores: p.valores, raiz: rutas.raiz, respaldo: rutas.respaldo, resultado }),
    { elevar: !sandbox });
  if (r.cancelado) return { ok: false, mensaje: 'Se canceló el permiso de administrador: no se cambió nada.' };
  const res = leerResultado(resultado);
  if (!res?.ok) return { ok: false, mensaje: res?.mensaje || (r.err || 'No se pudo aplicar.').trim() };

  /* El script de restauracion manual se deja en cuanto hay respaldo. */
  try { fs.writeFileSync(rutas.restaurarManual, '\ufeff' + scriptRestaurarManual({ respaldo: rutas.respaldo }), 'utf8'); } catch { /* sin permiso */ }
  return { ok: true, permitidos: p.permitidos, respaldo: rutas.respaldo, restaurarManual: rutas.restaurarManual };
}

async function restaurar({ sid, sandbox = false }) {
  if (!sid) return { ok: false, mensaje: 'Falta la cuenta de Windows.' };
  const rutas = rutasPara(sid, sandbox);
  const resultado = path.join(rutas.dir, `resultado-${Date.now()}.json`);
  fs.mkdirSync(rutas.dir, { recursive: true });
  const r = await ejecutarPs(scriptRestaurar({ respaldo: rutas.respaldo, resultado }), { elevar: !sandbox });
  if (r.cancelado) return { ok: false, mensaje: 'Se canceló el permiso de administrador: no se cambió nada.' };
  const res = leerResultado(resultado);
  if (!res?.ok) return { ok: false, mensaje: res?.mensaje || (r.err || 'No se pudo restaurar.').trim() };
  return { ok: true };
}

module.exports = {
  // puro
  familiaDeEdicion, nombreDeWindows, capacidades, plan, queSeBloquea, rutasPara, raizRegistro,
  scriptAplicar, scriptRestaurar, scriptRestaurarManual,
  // con Windows
  ejecutarPs, auditar, activar, restaurar,
};
