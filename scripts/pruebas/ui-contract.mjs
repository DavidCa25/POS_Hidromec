/**
 * EL CONTRATO DE INTERFAZ, COMPROBADO.
 *
 *     node scripts/pruebas/ui-contract.mjs
 *
 * POR QUE EXISTE
 * --------------
 * El `<select>` nativo se ha corregido ya en Servicios, en la Agenda y en
 * QuickStart. Tres veces la misma correccion, en tres pantallas distintas,
 * porque cada una se escribio sin mirar si ya habia un componente.
 *
 * `CLAUDE.md` lo dice, pero una regla escrita solo funciona mientras alguien
 * la recuerda. Esta prueba la hace exigible: una pantalla NUEVA con un
 * `<select>` del sistema operativo pone la suite en rojo.
 *
 * NO ES UN LINTER DE ESTILO
 * -------------------------
 * No persigue clases ni nombres. Persigue UNA cosa: que una funcionalidad
 * nueva no se invente un control que Wybix ya tiene.
 *
 * LA LISTA HEREDADA
 * -----------------
 * Hay `<select>` nativos de antes de esta regla. No se arreglan aqui -seria
 * un rediseno, y esta prueba no es el sitio- pero quedan CONTADOS: si una
 * pantalla heredada añade otro, tambien se ve.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

function archivos(dir, ext) {
  const salida = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) salida.push(...archivos(p, ext));
    else if (ext.some((x) => e.endsWith(x))) salida.push(p);
  }
  return salida;
}

const rel = (f) => relative(process.cwd(), f).replace(/\\/g, '/');

/* Comentarios fuera: un comentario que NOMBRA el control para explicar por
   que no se usa no es una infraccion. */
const sinComentarios = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('\nCONTRATO DE INTERFAZ\n');

// ===================================================================
seccion('Nadie inventa un control que Wybix ya tiene');

/**
 * LO QUE SE PERMITE, Y POR QUE.
 *
 * Cada excepcion lleva su motivo. Una lista sin motivos se convierte en el
 * sitio donde se mete todo lo que molesta.
 */
const PERMITIDOS = {
  // El dialogo de archivos del sistema no se puede abrir de otra forma.
  'src/app/wx-quickstart/wx-quickstart.component.html': 'input type=file oculto tras un label',

  // Hardware: son listas del SISTEMA OPERATIVO -puertos, impresoras,
  // monitores-, no del dominio de Wybix. Enseñarlas con el control de Wybix
  // sugeriria que son cosas del negocio, y no lo son.
  'src/configuration/configurationApp.html': 'puertos, impresoras y cajon: hardware del sistema',
  'src/app/devices-panel/devices-panel.component.ts': 'dispositivos del sistema',
  'src/app/customer-display-panel/customer-display.component.ts': 'monitores del sistema',
};

/* Lo que ya existia cuando se escribio la regla. No se arregla aqui: se
   cuenta, para que no crezca. */
const HEREDADOS = {
  'src/compras/compras.html': 2,
  'src/app/servicios-panel/servicios-config.component.ts': 1,
};

const fuentes = archivos('src', ['.html', '.ts']).filter(f => !f.endsWith('.spec.ts'));

const infractores = [];
let heredadosVistos = {};

for (const f of fuentes) {
  const r = rel(f);
  const texto = sinComentarios(readFileSync(f, 'utf8'));
  const cuantos = (texto.match(/<select\b/g) || []).length;
  if (!cuantos) continue;

  if (PERMITIDOS[r]) continue;

  if (HEREDADOS[r] !== undefined) {
    heredadosVistos[r] = cuantos;
    continue;
  }
  infractores.push(`${r} (${cuantos})`);
}

check(infractores.length === 0,
  'ninguna pantalla nueva usa un <select> del sistema operativo',
  infractores.length
    ? `usa wx-select:\n            ${infractores.join('\n            ')}`
    : `${fuentes.length} archivos revisados`);

for (const [archivo, tope] of Object.entries(HEREDADOS)) {
  const cuantos = heredadosVistos[archivo] ?? 0;
  check(cuantos <= tope,
    `${archivo}: no añade selects nuevos`,
    `${cuantos} de ${tope} heredados`);
}

// ===================================================================
seccion('El componente oficial existe y se usa');

const existeWxSelect = fuentes.some(f => rel(f).includes('wx-select/wx-select.component.ts'));
check(existeWxSelect, 'wx-select existe', 'si no existiera, la regla de arriba seria injusta');

const usan = fuentes.filter(f => /<wx-select/.test(readFileSync(f, 'utf8')));
check(usan.length >= 3, 'y lo usan las pantallas del dominio', `${usan.length} pantallas`);

// ===================================================================
seccion('Blobatar: identidad estable, no azar');

/*
 * Una persona no cambia de cara cada vez que se pinta la pantalla. Si la
 * semilla saliera de `Math.random()`, cada render daria otro personaje: eso
 * no es variedad, es parpadeo.
 */
const mascota = readFileSync(join('src', 'app', 'wx-mascota', 'wx-mascota.component.ts'), 'utf8');
check(!/Math\.random\(/.test(sinComentarios(mascota)),
  'la mascota no se sortea en cada render',
  'seria otro personaje en cada fotograma');

const conAvatar = archivos(join('src', 'app'), ['.ts'])
  .filter(f => /semilla|seed/i.test(readFileSync(f, 'utf8')) && /mascota|blobatar/i.test(readFileSync(f, 'utf8')));
check(conAvatar.length > 0, 'la identidad sale de una semilla', `${conAvatar.length} archivos`);

/* Y el render entero: ningun componente sortea su apariencia al pintarse. */
const sorteanAlPintar = archivos(join('src', 'app'), ['.ts', '.html'])
  .filter(f => {
    const t = sinComentarios(readFileSync(f, 'utf8'));
    return /Math\.random\(/.test(t) && /(mascota|blobatar|avatar)/i.test(t);
  })
  .map(rel);

check(sorteanAlPintar.length === 0,
  'ningun avatar se sortea al pintarse',
  sorteanAlPintar.length ? sorteanAlPintar.join(', ') : 'la variedad se decide UNA vez, no por fotograma');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
