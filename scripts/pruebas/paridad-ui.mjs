/**
 * UNA NAVEGACION Y UNA CAJA, AUNQUE TENGAN DOS DISENOS.
 *
 *     node scripts/pruebas/paridad-ui.mjs
 *
 * De donde sale: Checar se agrego al dock y faltaba en la barra lateral; la
 * devolucion directa estaba en Touch y no en Retail; Apps Wybix la veia
 * cualquiera. Cada vez que algo nuevo llegaba a un solo lado habia que
 * arreglarlo dos veces. Esto lo detecta antes:
 *
 *   1. NAVEGACION. El dock y la barra lateral ofrecen las mismas acciones
 *      (mismo `data-guide`) y usan las mismas reglas de NavAccionesService
 *      (`acc.ver...`). El dialogo de Checar vive una sola vez, en la carcasa.
 *      Apps Wybix: solo con `acc.verApps` (Administrador), en las dos.
 *
 *   2. CAJA. Cada accion de src/core/acciones-caja.ts esta marcada con
 *      `data-caja` en Retail (venta.html) Y en Touch (touch-pos.html), y
 *      ninguna pantalla marca algo que no este en la lista.
 */
import { readFileSync } from 'node:fs';

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const leer = (p) => readFileSync(p, 'utf8');
const conjunto = (texto, re) => new Set([...texto.matchAll(re)].map(m => m[1]));
const resta = (a, b) => [...a].filter(x => !b.has(x));

console.log('\nPARIDAD DE INTERFAZ\n');

// ===================================================================
console.log('-- 1. Dock y barra lateral');
const dock = leer('src/app/wx-dock/wx-dock.component.html');
const barra = leer('src/app/wx-sidebar/wx-sidebar.component.html');
const carcasa = leer('src/app/wx-nav/wx-navegacion.component.ts');

/* Las acciones que no son un area ni un destino: las dos formas las ofrecen. */
const ACCIONES = ['buscar', 'wybix-guide', 'crear', 'nav-checar', 'aprobaciones', 'nav-apps'];
for (const a of ACCIONES) {
  check(dock.includes(`data-guide="${a}"`) && barra.includes(`data-guide="${a}"`),
    `«${a}» esta en el dock y en la barra lateral`,
    `dock: ${dock.includes(`data-guide="${a}"`)} · barra: ${barra.includes(`data-guide="${a}"`)}`);
}
const reglasDock = conjunto(dock, /acc\.(ver\w+)/g);
const reglasBarra = conjunto(barra, /acc\.(ver\w+)/g);
check(!resta(reglasDock, reglasBarra).length && !resta(reglasBarra, reglasDock).length,
  'las dos formas usan las mismas reglas de NavAccionesService',
  `solo dock: ${resta(reglasDock, reglasBarra).join(', ') || '-'} · solo barra: ${resta(reglasBarra, reglasDock).join(', ') || '-'}`);
check(/\*ngIf="acc\.verApps"[^>]*>\s*<button[^>]*data-guide="nav-apps"/.test(dock.replace(/\r\n/g, '\n'))
   && /\*ngIf="acc\.verApps"[^>]*>\s*<button[^>]*data-guide="nav-apps"/.test(barra.replace(/\r\n/g, '\n')),
  'Apps Wybix solo con acc.verApps (Administrador), en las dos');
check(!dock.includes('<app-asistencia-checar') && !barra.includes('<app-asistencia-checar')
   && carcasa.includes('<app-asistencia-checar'),
  'el dialogo de Checar vive una sola vez, en la carcasa de la navegacion');

// ===================================================================
console.log('\n-- 2. Retail y Touch');
const catalogo = conjunto(leer('src/core/acciones-caja.ts'), /\{\s*id:\s*'([\w-]+)'/g);
const retail = conjunto(leer('src/venta/appVenta/venta.html'), /data-caja="([\w-]+)"/g);
const touch = conjunto(leer('src/touch/touch-pos.html'), /data-caja="([\w-]+)"/g);
check(catalogo.size >= 8, `el catalogo tiene sus acciones (${catalogo.size})`, [...catalogo].join(', '));
check(!resta(catalogo, retail).length, 'Retail ofrece todo lo esencial', `le falta: ${resta(catalogo, retail).join(', ')}`);
check(!resta(catalogo, touch).length, 'Touch ofrece todo lo esencial', `le falta: ${resta(catalogo, touch).join(', ')}`);
check(!resta(retail, catalogo).length && !resta(touch, catalogo).length,
  'nadie marca una accion que no esta en el catalogo',
  `Retail: ${resta(retail, catalogo).join(', ') || '-'} · Touch: ${resta(touch, catalogo).join(', ') || '-'}`);

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
