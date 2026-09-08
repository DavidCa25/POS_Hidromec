/**
 * Guardian de capas.
 *
 *     node scripts/pruebas/capas.mjs
 *
 * Un aviso de error que aparece DETRAS del modal que lo provoco deja al
 * usuario esperando una respuesta que ya estaba dada. Eso paso en la prueba de
 * VM: SweetAlert2 trae `z-index: 1060` de fabrica y los modales de la app usan
 * numeros heredados de 2000 a 12500.
 *
 * La correccion no es subir el numero cada vez que algo queda tapado -asi
 * empiezan las guerras de z-index-, sino reservar una franja para los avisos y
 * comprobar que nadie entra en ella. El techo vive en `--wx-z-alerta`
 * (tokens.css) y esta prueba es lo que lo sostiene.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const BARRA = String.fromCharCode(92);   // separador de Windows
const SALTO = String.fromCharCode(10);
const RESERVA_DESDE = 13000;   // de aqui hacia arriba solo viven los avisos

function css(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.angular' || n === 'dist') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) css(p, acc);
    else if (extname(n) === '.css') acc.push(p);
  }
  return acc;
}

// ------------------------------------------------------------- el techo
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const techo = Number((tokens.match(/--wx-z-alerta:\s*(\d+)/) || [])[1]);

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok    ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};

console.log('\nCAPAS  —  el aviso siempre por encima del modal\n');
check(Number.isFinite(techo), 'tokens.css declara --wx-z-alerta', String(techo));
check(techo >= RESERVA_DESDE, 'el techo esta dentro de la franja reservada', `${techo} >= ${RESERVA_DESDE}`);

// -------------------------------------------- SweetAlert2 apunta al techo
const refinamiento = readFileSync('src/styles/refinamiento.css', 'utf8');
check(/\.swal2-container\s*\{[^}]*z-index:\s*var\(--wx-z-alerta/.test(refinamiento),
  'SweetAlert2 toma su capa del token, no de un numero suelto');

// ------------------------------------------ nadie invade la franja de avisos
const invasores = [];
const declarados = [];
for (const f of css('src')) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/z-index:\s*(\d+)/g)) {
    const n = Number(m[1]);
    const linea = txt.slice(0, m.index).split('\n').length;
    declarados.push({ f: relative('.', f).split(BARRA).join('/'), linea, n });
    if (n >= RESERVA_DESDE) invasores.push({ f: relative('.', f).split(BARRA).join('/'), linea, n });
  }
}
check(invasores.length === 0,
  `ningun componente entra en la franja reservada (>= ${RESERVA_DESDE})`,
  `${declarados.length} z-index numericos revisados`);
for (const i of invasores) console.log(`         ${i.f}:${i.linea}  z-index: ${i.n}`);

// ------------------------- contenedores que descolocan los menus anclados
//
// El segundo defecto de la prueba de VM. Un `transform` crea BLOQUE
// CONTENEDOR: todo `position: fixed` que viva dentro -incluido un popover del
// top layer- resuelve sus coordenadas contra el elemento ya desplazado, y el
// desplazamiento se aplica dos veces. Centrar un modal con
// `translate(-50%, -50%)` mandaba los menus de sus desplegables a media
// pantalla de distancia, todos al mismo sitio.
//
// `inset: 0` + `margin: auto` centra igual y no crea bloque contenedor.
const centradosConTransform = [];
for (const f of css('src')) {
  const txt = readFileSync(f, 'utf8');
  // Se mira bloque a bloque: `position` y `transform` tienen que convivir en
  // la MISMA regla para que el problema exista.
  for (const m of txt.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().split(SALTO).pop().trim();
    const cuerpo = m[2];
    if (!/position:\s*fixed/.test(cuerpo)) continue;
    if (!/transform:\s*translate\(\s*-50%/.test(cuerpo)) continue;
    const linea = txt.slice(0, m.index).split(SALTO).length;
    centradosConTransform.push({ f: relative('.', f).split(BARRA).join('/'), linea, selector });
  }
}
check(centradosConTransform.length === 0,
  'ningun contenedor fijo se centra con transform (romperia el anclaje de sus menus)');
for (const i of centradosConTransform) console.log(`         ${i.f}:${i.linea}  ${i.selector}`);

// El maximo real de la app tiene que quedar por debajo del techo con margen:
// si alguien lo sube hasta rozarlo, esto avisa antes de que vuelva a taparse.
const maximo = declarados.reduce((a, d) => Math.max(a, d.n), 0);
check(maximo < techo, 'el modal mas alto de la app queda por debajo del aviso',
  `maximo ${maximo} < techo ${techo}`);

console.log(`\nRESULTADO: ${ok} ok · ${fallos.length} fallas`);
if (fallos.length) { fallos.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('El aviso no puede quedar detras de un modal.');
