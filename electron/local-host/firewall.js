/**
 * EL FIREWALL DE WINDOWS Y EL LOCAL HOST.
 *
 * Las tablets entran por el puerto del Local Host. Windows lo bloquea de
 * fabrica. Aqui hay dos cosas y solo dos:
 *
 *   diagnosticar   LEER: ¿hay una regla que lo permita? ¿la red esta marcada
 *                  como Publica (donde la regla privada no aplica)? No cambia
 *                  nada.
 *   abrir          Crear UNA regla de entrada, solo TCP a ESE puerto, solo
 *                  desde la subred local y solo en perfiles Privado/Dominio.
 *                  Pide permisos de administrador a Windows (UAC) y SOLO se
 *                  ejecuta cuando la persona lo pide en la pantalla. Nunca
 *                  en silencio, nunca al arrancar.
 *
 * No toca SQL Server (1433), no desactiva el firewall y no abre nada a
 * Internet: el router ni se entera.
 */
const { execFile } = require('child_process');

const NOMBRE = (puerto) => `Wybix Local Host (TCP ${puerto})`;

function ps(script, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true }, (err, stdout) => resolve({ ok: !err, salida: String(stdout || '').trim() }));
  });
}

async function diagnosticar(puerto) {
  if (process.platform !== 'win32') return { soportado: false };
  const p = Number(puerto);
  const r = await ps(`
    $o = @{ regla = $false; perfiles = @(); red = @() }
    try {
      $reglas = Get-NetFirewallRule -DisplayName '${NOMBRE(p)}' -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' }
      if ($reglas) { $o.regla = $true; $o.perfiles = @($reglas | ForEach-Object { $_.Profile.ToString() }) }
    } catch {}
    try { $o.red = @(Get-NetConnectionProfile | ForEach-Object { @{ nombre = $_.InterfaceAlias; categoria = $_.NetworkCategory.ToString() } }) } catch {}
    $o | ConvertTo-Json -Depth 4 -Compress`);
  try {
    const j = JSON.parse(r.salida || '{}');
    const redes = Array.isArray(j.red) ? j.red : (j.red ? [j.red] : []);
    return {
      soportado: true,
      regla: !!j.regla,
      perfiles: j.perfiles || [],
      redes,
      redPublica: redes.some(x => String(x.categoria) === 'Public'),
      nombreRegla: NOMBRE(p),
    };
  } catch {
    return { soportado: true, regla: null, redes: [], nombreRegla: NOMBRE(p), error: 'No se pudo leer el firewall.' };
  }
}

/** Solo por peticion explicita de la persona (la pantalla pide confirmacion antes). */
async function abrir(puerto) {
  if (process.platform !== 'win32') return { ok: false, error: 'Solo en Windows.' };
  const p = Number(puerto);
  if (!Number.isInteger(p) || p < 1024 || p > 49151) return { ok: false, error: 'Puerto no válido.' };
  const interno = `New-NetFirewallRule -DisplayName '${NOMBRE(p)}' -Direction Inbound -Protocol TCP -LocalPort ${p} -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet -ErrorAction Stop | Out-Null`;
  const r = await ps(`
    try {
      $p = Start-Process powershell -Verb RunAs -PassThru -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',"${interno.replace(/"/g, '`"')}"
      if ($p.ExitCode -eq 0) { 'OK' } else { 'FALLO' }
    } catch { 'CANCELADO' }`, { timeout: 120000 });
  if (r.salida.includes('OK')) return { ok: true };
  if (r.salida.includes('CANCELADO')) return { ok: false, error: 'Se canceló el permiso de administrador.' };
  return { ok: false, error: 'Windows no creó la regla.' };
}

module.exports = { diagnosticar, abrir, NOMBRE };
