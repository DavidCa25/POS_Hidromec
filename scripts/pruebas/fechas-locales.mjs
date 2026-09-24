/**
 * EL DIA DE LA CAJA, NO EL DE LONDRES.
 *
 *     node scripts/pruebas/fechas-locales.mjs
 *
 * De donde sale esto: la prueba de la agenda empezo a fallar por la tarde y a
 * pasar por la manana. No era la prueba. `new Date().toISOString().slice(0,10)`
 * devuelve la fecha en UTC, asi que en Mexico (UTC-6) a partir de las 18:00 la
 * aplicacion entera empezaba a creer que era manana: la agenda abria en el dia
 * siguiente, el boton «Hoy» se deshabilitaba en el dia equivocado, la linea de
 * la hora actual desaparecia, el rango de estadisticas se corria una semana
 * entera y las alertas ya enviadas se volvian a enviar.
 *
 * Son las ultimas horas del dia -las de mas venta en muchos giros- trabajando
 * sobre el dia que no es.
 *
 * Aqui se comprueban dos cosas distintas:
 *   1. Que el ayudante hace lo que dice, EN VARIOS HUSOS, ejecutandolo.
 *   2. Que el patron roto no vuelve a entrar al codigo.
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

console.log('\nFECHAS LOCALES\n');

// ===================================================================
seccion('El ayudante, ejecutado en varios husos horarios');

/*
 * No se puede cambiar el huso del proceso en marcha, asi que cada caso corre
 * en un node aparte con su `TZ`. Se importa el ARCHIVO DE VERDAD -node 24
 * ejecuta TypeScript- y no una copia: una copia probaria la copia.
 */
function enHuso(tz, instante) {
  const guion = `
    const { fechaLocal, hoyLocal, moverDias } = await import('./src/core/fechas.ts');
    const d = new Date('${instante}');
    console.log(JSON.stringify({
      local: fechaLocal(d),
      utc: d.toISOString().slice(0, 10),
      partes: [d.getFullYear(), d.getMonth() + 1, d.getDate()],
      hoy: hoyLocal(),
      masUno: moverDias(fechaLocal(d), 1),
      menosUno: moverDias(fechaLocal(d), -1),
    }));
  `;
  const salida = execFileSync(process.execPath, ['--input-type=module', '-e', guion], {
    env: { ...process.env, TZ: tz }, encoding: 'utf8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(salida.trim().split('\n').pop());
}

/*
 * Cada caso es un instante en el que UTC y la hora local NO caen en el mismo
 * dia. Son justo los momentos en los que la version rota mentia.
 */
const CASOS = [
  ['America/Mexico_City', '2026-09-21T04:46:00Z', '2026-09-20',
   'las 22:46 del domingo en Mexico: en Londres ya es lunes'],
  ['America/Mexico_City', '2026-01-01T05:30:00Z', '2025-12-31',
   'nochevieja a las 23:30: en UTC ya cambio el ano'],
  ['America/Tijuana',     '2026-07-04T06:10:00Z', '2026-07-03',
   'la frontera con otro huso, y en horario de verano'],
  ['Europe/Madrid',       '2026-09-20T23:30:00Z', '2026-09-21',
   'al otro lado se equivoca al reves: alli ya es manana'],
  ['Pacific/Kiritimati',  '2026-09-20T11:00:00Z', '2026-09-21',
   'UTC+14, el extremo que rompe incluso el anclaje al mediodia'],
];

for (const [tz, instante, esperado, porque] of CASOS) {
  const r = enHuso(tz, instante);
  check(r.local === esperado, `${tz}: ${porque}`, `local ${r.local} · UTC ${r.utc}`);
  check(r.local !== r.utc, `${tz}: y es DISTINTO de lo que daba antes`,
    `la version rota habria dicho ${r.utc}`);

  /* Lo de verdad importante: que coincida con lo que un reloj de pared diria.
     `getFullYear/getMonth/getDate` SON la hora local, por definicion. */
  const [a, m, d] = r.partes;
  const pared = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  check(r.local === pared, `${tz}: coincide con el reloj de pared`, pared);

  /* Y que moverse un dia siga siendo moverse UN dia, tambien donde hay cambio
     de horario de verano: sumar 24 h a una medianoche puede caer en el mismo
     dia otra vez. */
  const siguiente = new Date(esperado + 'T12:00:00Z'); siguiente.setUTCDate(siguiente.getUTCDate() + 1);
  const anterior = new Date(esperado + 'T12:00:00Z'); anterior.setUTCDate(anterior.getUTCDate() - 1);
  check(r.masUno === siguiente.toISOString().slice(0, 10)
     && r.menosUno === anterior.toISOString().slice(0, 10),
    `${tz}: un dia adelante y un dia atras son exactamente eso`,
    `${r.menosUno} < ${r.local} < ${r.masUno}`);
}

// ===================================================================
seccion('El patron roto no vuelve a entrar');

/*
 * `new Date().toISOString().slice(0, 10)` sobre el MOMENTO ACTUAL es el fallo.
 * Sobre una fecha que ya viene de la base NO lo es: ese dato ya es un instante
 * concreto y pasarlo por el ayudante lo moveria un dia. Por eso la busqueda va
 * contra `new Date()` sin argumentos, y no contra `toISOString` a secas.
 */
const ROTO = /new Date\(\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

function archivos(dir, ext) {
  const salida = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) salida.push(...archivos(p, ext));
    else if (ext.some((x) => e.endsWith(x))) salida.push(p);
  }
  return salida;
}

/* El comentario del propio ayudante NOMBRA el patron para explicarlo. Buscar
   dentro de los comentarios daria rojo por la explicacion del fallo, no por el
   fallo: seria una prueba que se dispara a si misma. */
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const fuentes = [
  ...archivos('src', ['.ts']),
  ...archivos('electron', ['.js']),
  ...archivos('e2e', ['.js']),
];
const culpables = fuentes.filter((f) => ROTO.test(sinComentarios(readFileSync(f, 'utf8'))));

check(culpables.length === 0,
  'ningun archivo pregunta que dia es hoy en UTC',
  culpables.length ? culpables.map((f) => relative(process.cwd(), f)).join(', ')
    : `${fuentes.length} archivos revisados`);

/* Y que el ayudante siga estando donde el resto del codigo lo busca. */
const indice = readFileSync(join('src', 'core', 'index.ts'), 'utf8');
check(/export \* from '\.\/fechas'/.test(indice),
  'el ayudante se exporta desde el nucleo', 'si no, cada pantalla se escribe el suyo');

/* Las pantallas que abren en «hoy» tienen que usarlo: son las que fallaban. */
for (const p of ['src/modulo-servicios/agenda/agenda.component.ts',
                 'src/touch/servicios/touch-servicios.ts']) {
  const s = readFileSync(p, 'utf8');
  check(/hoyLocal\(\)/.test(s), `${relative(process.cwd(), p)} abre en el dia de aqui`);
}

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
