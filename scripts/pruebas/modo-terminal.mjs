/**
 * MODO TERMINAL: lo puro, y activar/restaurar de verdad en un arenero.
 *
 *     node scripts/pruebas/modo-terminal.mjs
 *
 * Aplicar y restaurar se EJECUTAN con PowerShell, pero contra
 * `HKCU\Software\Wybix\TerminalSandbox\<SID>`, nunca contra las directivas
 * reales de este equipo. Antes se siembran valores que «ya estaban» para
 * comprobar que restaurar devuelve cada uno exactamente a como era, y que lo
 * que no existia desaparece.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const mt = require('../../electron/terminal/modo-terminal.js');

let ok = 0; const fallos = [];
const check = (c, t, d = '') => {
  if (c) { ok++; console.log(`   ok     ${t}${d ? '  · ' + d : ''}`); }
  else { fallos.push(t); console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
  { encoding: 'utf8' }).trim();

console.log('\nMODO TERMINAL\n');

// =====================================================================
seccion('1. Cada edicion dice lo que puede');
check(mt.familiaDeEdicion('Professional') === 'PRO', 'Professional es Pro');
check(mt.familiaDeEdicion('Core') === 'HOME', 'Core es Home');
check(mt.familiaDeEdicion('Enterprise') === 'ENTERPRISE' && mt.familiaDeEdicion('EnterpriseS') === 'ENTERPRISE', 'Enterprise y LTSC');
check(mt.familiaDeEdicion('Education') === 'EDUCATION', 'Education');
check(mt.nombreDeWindows('26200', 'PRO') === 'Windows 11 Pro', 'el build 26200 es Windows 11 aunque el registro diga 10');

const home = mt.capacidades({ familia: 'HOME', build: 26200, enAdministradores: true });
const pro = mt.capacidades({ familia: 'PRO', build: 26200, enAdministradores: true });
const ent = mt.capacidades({ familia: 'ENTERPRISE', build: 26200, enAdministradores: true });
const cap = (l, id) => l.find(c => c.id === id);
check(cap(home, 'politicas-usuario').disponible, 'las directivas de usuario sirven hasta en Home');
check(!cap(home, 'acceso-asignado').disponible && /Home/.test(cap(home, 'acceso-asignado').motivo),
  'Home no tiene quiosco, y se dice');
check(cap(pro, 'acceso-asignado').disponible && !cap(pro, 'applocker').disponible,
  'Pro tiene quiosco pero no hace cumplir AppLocker');
check(cap(ent, 'shell-launcher').disponible && cap(ent, 'applocker').disponible, 'Enterprise tiene Shell Launcher y AppLocker');
check(!cap(mt.capacidades({ familia: 'PRO', build: 19045, enAdministradores: true }), 'acceso-asignado').disponible,
  'el quiosco de varias apps no existe antes de Windows 11 22H2');
check(!cap(mt.capacidades({ familia: 'PRO', build: 26200, enAdministradores: false }), 'politicas-usuario').disponible,
  'sin administrador no se ofrece aplicar nada');
check(pro.filter(c => c.aplicaWybix).map(c => c.id).join() === 'politicas-usuario',
  'Wybix solo aplica las directivas: lo demas se explica, no se toca');

// =====================================================================
seccion('2. El plan');
const p1 = mt.plan({ ejecutableWybix: 'Wybix.exe', permitirExcel: true });
check(p1.permitidos.join() === 'Wybix.exe,EXCEL.EXE', 'Wybix siempre, Excel si se pide');
check(!p1.valores.some(v => v.nombre === 'DisableTaskMgr'), 'el Administrador de tareas NO se toca por defecto');
check(mt.plan({ ejecutableWybix: 'Wybix.exe', bloquearTaskMgr: true }).valores.some(v => v.nombre === 'DisableTaskMgr'),
  'solo si se pide');
check(mt.plan({}).permitidos[0] === 'Wybix.exe', 'aunque no se diga, Wybix entra en la lista');
check(mt.queSeBloquea({ permitidos: p1.permitidos }).some(l => /cerrar sesi/.test(l)),
  'y se avisa de que surte efecto al volver a entrar');
check(/HKEY_USERS\\S-1-5-21-1/.test(mt.raizRegistro('S-1-5-21-1', false)), 'escribe en la cuenta indicada, por su SID');
check(/TerminalSandbox/.test(mt.raizRegistro('S-1-5-21-1', true)), 'y en pruebas, en el arenero');
check(mt.raizRegistro("S-1'; Remove-Item C:\\ -Recurse", false).indexOf("'") < 0, 'un SID con comillas no inyecta nada');

// =====================================================================
seccion('3. Activar y restaurar, de verdad, en el arenero');
if (process.platform !== 'win32') {
  console.log('   (se omite: no es Windows)');
} else {
  const aud = await mt.auditar({ sandbox: true });
  check(aud.ok && /^S-1-5-/.test(aud.windows.sid), 'la auditoria lee la cuenta de Windows', aud.windows?.nombre);
  const sid = aud.windows.sid;
  const raizPs = mt.raizRegistro(sid, true).replace('Registry::HKEY_CURRENT_USER', 'HKCU:');
  const base = `HKCU:\\Software\\Wybix\\TerminalSandbox\\${sid}`;

  try { ps(`Remove-Item -LiteralPath '${base}' -Recurse -Force -ErrorAction SilentlyContinue`); } catch { /* limpio */ }
  try { await mt.restaurar({ sid, sandbox: true }); } catch { /* sin respaldo previo */ }

  /* Lo que «ya estaba»: NoRun en 0 y otra directiva ajena. */
  ps(`New-Item -Path '${raizPs}\\Explorer' -Force | Out-Null;
      New-ItemProperty -LiteralPath '${raizPs}\\Explorer' -Name NoRun -PropertyType DWord -Value 0 -Force | Out-Null;
      New-ItemProperty -LiteralPath '${raizPs}\\Explorer' -Name NoDesktop -PropertyType DWord -Value 0 -Force | Out-Null`);

  const a = await mt.activar({ sid, ejecutableWybix: 'Wybix.exe', permitirExcel: true, sandbox: true });
  check(a.ok, 'se activa', a.mensaje || '');
  check(existsSync(a.respaldo || ''), 'deja el respaldo ANTES de escribir, y queda en disco');
  check(existsSync(a.restaurarManual || ''), 'y el script para restaurar a mano');
  const leer = (clave, nombre) => ps(`(Get-ItemProperty -LiteralPath '${raizPs}\\${clave}' -Name '${nombre}' -ErrorAction SilentlyContinue).'${nombre}'`);
  check(leer('Explorer', 'RestrictRun') === '1' && leer('Explorer', 'NoRun') === '1', 'las directivas quedan puestas');
  check(leer('Explorer\\RestrictRun', '1') === 'Wybix.exe' && leer('Explorer\\RestrictRun', '2') === 'EXCEL.EXE',
    'con la lista de permitidos');

  const otra = await mt.activar({ sid, ejecutableWybix: 'Wybix.exe', sandbox: true });
  check(!otra.ok && /ya est/.test(otra.mensaje), 'activar dos veces no pisa el respaldo bueno', otra.mensaje);

  const r = await mt.restaurar({ sid, sandbox: true });
  check(r.ok, 'se restaura', r.mensaje || '');
  check(leer('Explorer', 'NoRun') === '0', 'NoRun vuelve a su 0 de antes, no desaparece');
  check(leer('Explorer', 'NoDesktop') === '0', 'lo que no era nuestro sigue intacto');
  check(leer('Explorer', 'RestrictRun') === '', 'lo que no existia desaparece');
  check(ps(`Test-Path -LiteralPath '${raizPs}\\Explorer\\RestrictRun'`) === 'False', 'y la clave que se creo, tambien');
  check(!existsSync(a.respaldo), 'el respaldo se retira al restaurar');
  const sin = await mt.restaurar({ sid, sandbox: true });
  check(!sin.ok && /no est/.test(sin.mensaje), 'restaurar sin respaldo lo dice, no rompe nada', sin.mensaje);

  /* El arenero entero, y la clave Wybix si solo la habia creado el. */
  try {
    ps(String.raw`Remove-Item -LiteralPath 'HKCU:\Software\Wybix\TerminalSandbox' -Recurse -Force -ErrorAction SilentlyContinue;
      $w = 'HKCU:\Software\Wybix';
      if ((Test-Path $w) -and @(Get-ChildItem $w).Count -eq 0 -and (Get-Item $w).ValueCount -eq 0) { Remove-Item $w -Force }`);
  } catch { /* limpio */ }
}

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
