/**
 * LA HORA QUE GUARDO LA BASE, NO LA DE LONDRES.
 *
 *     node scripts/pruebas/fechas-sql.mjs
 *
 * De donde sale esto: el corte decia «Abierto 02:14» de un turno abierto a las
 * 08:14. Casi toda la base guarda hora de pared (GETDATE, SYSDATETIME, DATE) y
 * `mssql` la lee como si fuera UTC. El pipe `date` de Angular la pasaba a la
 * zona del equipo: en Mexico, seis horas menos, y un DATE salia como el dia
 * anterior. Lo mismo al escribir: un Date de JavaScript se guarda con sus
 * partes UTC, asi que una venta importada de las 20:00 quedaba a las 02:00 del
 * dia siguiente.
 *
 * Aqui se comprueban dos cosas:
 *   1. Que `fechaDeSql`, `zonaDeSql` y `horaParedLocal` hacen lo que dicen, EN
 *      VARIOS HUSOS, ejecutando el archivo de verdad.
 *   2. Que nadie vuelve a pintar una columna de la base con `| date`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

console.log('\nFECHAS DE LA BASE\n');

// ===================================================================
seccion('Los ayudantes, ejecutados en varios husos horarios');

function enHuso(tz) {
  const guion = `
    const { fechaDeSql, zonaDeSql, horaParedLocal } = await import('./src/core/fechas.ts');
    const hora = (v) => { const d = fechaDeSql(v); return d && d.toLocaleTimeString('es-MX', { timeZone: zonaDeSql(v), hour: '2-digit', minute: '2-digit', hour12: false }); };
    const dia = (v) => { const d = fechaDeSql(v); return d && d.toLocaleDateString('es-MX', { timeZone: zonaDeSql(v) }); };
    console.log(JSON.stringify({
      turno: hora(new Date('2026-10-29T08:14:00Z')),
      sinZona: hora('2026-10-18T09:35:00'),
      soloFecha: dia(new Date('2026-10-29T00:00:00Z')),
      textoFecha: dia('2026-10-29'),
      vacio: fechaDeSql(''), invalido: fechaDeSql('no es fecha'),
      nube: zonaDeSql('2026-10-29T14:14:00Z') ?? 'local',
      nubeHora: hora('2026-10-29T14:14:00Z'),
      pared: horaParedLocal(new Date(2026, 9, 1, 20, 5, 9)),
    }));
  `;
  const salida = execFileSync(process.execPath, ['--input-type=module', '-e', guion], {
    env: { ...process.env, TZ: tz }, encoding: 'utf8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(salida.trim().split('\n').pop());
}

const LOCAL_NUBE = { 'America/Mexico_City': '08:14', 'America/Tijuana': '07:14', 'Europe/Madrid': '15:14', 'Asia/Tokyo': '23:14' };
for (const tz of Object.keys(LOCAL_NUBE)) {
  const r = enHuso(tz);
  check(r.turno === '08:14', `${tz}: un turno de las 08:14 se ve a las 08:14`, `salio ${r.turno}`);
  check(r.sinZona === '09:35', `${tz}: un texto de FOR JSON sin zona conserva su hora`, `salio ${r.sinZona}`);
  check(r.soloFecha === '29/10/2026' && r.textoFecha === '29/10/2026', `${tz}: un DATE no se corre un dia`,
    `Date ${r.soloFecha} · texto ${r.textoFecha}`);
  check(r.vacio === null && r.invalido === null, `${tz}: vacio o basura no inventan fecha`);
  check(r.nube === 'local' && r.nubeHora === LOCAL_NUBE[tz], `${tz}: un instante con zona (la nube) sale en la hora del equipo`,
    `salio ${r.nubeHora}`);
  check(r.pared === '2026-10-01T20:05:09', `${tz}: las 20:05 de aqui se mandan como 20:05, sin zona`, `salio ${r.pared}`);
}

// ===================================================================
seccion('Ninguna columna de la base se pinta con `| date`');

/*
 * `date` es para instantes de JavaScript: lo que se calcula aqui (hoy, today,
 * el dia elegido) o lo que llega con zona (la nube, el sistema de archivos).
 * Todo lo demas sale de la base y va con `fechaSql`. Para agregar una
 * excepcion hay que poder decir de donde viene el valor.
 */
const INSTANTES = new Map([
  ['hoy', 'reloj del equipo'], ['today', 'reloj del equipo'], ["dia() + 'T12:00:00'", 'dia elegido'],
  ['dia()', 'dia elegido'], ['lastBackupAt', 'archivo de respaldo'], ['b.modified', 'archivo de respaldo'],
  ['d.emparejadoEn', 'ISO con zona del emparejamiento'], ['e.publicadoEn', 'ISO de la nube'],
  ['e.aplicadoEn', 'ISO de la nube'],
]);
const html = [];
(function andar(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) andar(p);
    else if (n.endsWith('.html')) html.push(p);
  }
})('src');

const sueltos = [];
for (const p of html) {
  readFileSync(p, 'utf8').split('\n').forEach((linea, i) => {
    for (const m of linea.matchAll(/([^{}|?]+?)\s*\|\s*date\b/g)) {
      const expr = m[1].trim().replace(/^\(\s*/, '');
      if (!INSTANTES.has(expr)) sueltos.push(`${relative(process.cwd(), p)}:${i + 1}  ${expr}`);
    }
  });
}
check(!sueltos.length, 'las columnas de la base usan `fechaSql`', sueltos.join('\n            '));

/* La regex rota de antes (`/^d{4}-...`): sin la barra no reconoce nada. */
const rotas = [];
(function andar(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) andar(p);
    else if (n.endsWith('.ts') && /\/\^?\(?[^\\/\n]*(?<!\\)d\{\d\}/.test(readFileSync(p, 'utf8'))) rotas.push(relative(process.cwd(), p));
  }
})('src');
check(!rotas.length, 'ninguna regex de fecha perdio sus `\\d`', rotas.join(', '));

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
