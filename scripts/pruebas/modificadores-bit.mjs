/**
 * Un BIT viaja como booleano, siempre, tenga el grupo una opcion o veinte.
 *
 *     node scripts/pruebas/modificadores-bit.mjs
 *
 * EL FALLO QUE ESTA PRUEBA IMPIDE
 * -------------------------------
 * Guardar un grupo de modificadores con DOS o mas opciones respondia
 * "A boolean was expected". Con UNA guardaba bien, y por eso durante el QA
 * parecio un problema de SCALE o de tamanos cuando no tenia nada que ver.
 *
 * El driver es msnodesqlv8. Su `fromRow` arma cada columna del parametro de
 * tabla de dos maneras segun cuantas filas haya: con una fila manda el
 * valor suelto, con dos o mas manda un ARRAY. El nivel nativo tolera un `1`
 * suelto en una columna BIT, pero al recibir un array exige booleanos de
 * verdad. Se mandaba `o.active === false ? 0 : 1`, o sea 1.
 *
 * POR QUE NO SE PRUEBA CONTRA SQL
 * -------------------------------
 * Porque el defecto no estaba en SQL. El procedure siempre estuvo bien: lo
 * que estaba mal era el valor que salia de este proceso hacia el driver.
 * Una prueba que ejecutara el procedure con parametros ya correctos habria
 * pasado en verde el dia del fallo.
 *
 * Asi que se prueba LA FRONTERA: el mismo `bit()` que usa la aplicacion, y
 * la forma exacta en que msnodesqlv8 reparte las filas de un parametro de
 * tabla. Sin base de datos, sin red y en un segundo.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const FUENTE = join('electron', 'ipc', 'hospitality.js');
const codigo = readFileSync(FUENTE, 'utf8');

/**
 * `bit()` tal cual esta escrito en el modulo, sin copiarlo.
 *
 * Copiar la funcion a la prueba seria comprobar la copia: podria arreglarse
 * aqui y seguir rota alli. Se extrae del archivo real y se evalua.
 */
function cargarBit() {
  const i = codigo.indexOf('function bit(');
  if (i < 0) throw new Error(`No existe bit() en ${FUENTE}: alguien la quito o la renombro.`);
  // Hasta el cierre de la funcion, que esta a nivel de modulo.
  const fin = codigo.indexOf('\n}', i);
  const cuerpo = codigo.slice(i, fin + 2);
  // eslint-disable-next-line no-new-func
  return new Function(`${cuerpo}; return bit;`)();
}
const bit = cargarBit();

// ===================================================================
seccion('1. bit() entrega booleanos, no numeros ni cadenas');

for (const [entrada, esperado, nota] of [
  [true, true, 'el booleano pasa igual'],
  [false, false, 'y el falso tambien'],
  [1, true, 'un 1 es verdadero'],
  [0, false, 'un 0 es falso'],
  ['1', true, 'la cadena "1"'],
  ['0', false, 'la cadena "0", que como cadena seria verdadera'],
  ['true', true, 'la cadena "true"'],
  ['false', false, 'la cadena "false", el otro caso que Boolean() daria por cierto'],
]) {
  const r = bit(entrada);
  check(r === esperado && typeof r === 'boolean',
    `${JSON.stringify(entrada)} -> ${esperado}  (${nota})`,
    `devolvio ${JSON.stringify(r)} de tipo ${typeof r}`);
}

seccion('2. Lo que no se sabe se queda sin saber');

check(bit(null) === null, 'null sin valor por defecto sigue siendo null',
  'en una columna que admite NULL, "no lo se" no es "falso"');
check(bit(undefined) === null, 'undefined tambien');
check(bit('') === null, 'y la cadena vacia');
check(bit(undefined, true) === true, 'con valor por defecto se usa ese');
check(bit(undefined, false) === false, 'sea cual sea');
check(bit(0, true) === false, 'pero un valor presente manda sobre el defecto');

// ===================================================================
seccion('3. Ningun BIT de este modulo viaja como numero');

/*
 * La comprobacion mecanica. Si alguien vuelve a escribir `? 1 : 0` junto a
 * un sql.Bit, esto lo caza aunque la prueba de arriba siga en verde.
 */
const sinComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const lineasBit = sinComentarios.split('\n')
  .map((l, i) => ({ n: i + 1, l }))
  .filter(x => /sql\.Bit/.test(x.l));

check(lineasBit.length > 0, `hay ${lineasBit.length} usos de sql.Bit que vigilar`);

const numericos = lineasBit.filter(x => /\?\s*1\s*:\s*0|\?\s*0\s*:\s*1/.test(x.l));
check(numericos.length === 0,
  'ninguno convierte a 1/0 en el sitio de la llamada',
  numericos.map(x => `linea ${x.n}: ${x.l.trim()}`).join('\n            '));

const declaraciones = lineasBit.filter(x => /columns\.add/.test(x.l));
const entradas = lineasBit.filter(x => /\.input\(/.test(x.l));
const conBit = entradas.filter(x => /bit\(/.test(x.l));
check(conBit.length === entradas.length,
  `los ${entradas.length} parametros sql.Bit pasan por bit()`,
  entradas.filter(x => !/bit\(/.test(x.l)).map(x => `linea ${x.n}: ${x.l.trim()}`).join('\n            '));

// ===================================================================
seccion('4. Las filas del parametro de tabla, tambien');

/*
 * Es el caso que fallaba, y el que ninguna prueba de SQL habria visto: el
 * valor que se mete en `tvp.rows.add` para una columna BIT.
 */
const iTvp = sinComentarios.indexOf("new sql.Table('dbo.ModifierOptionType')");
check(iTvp > 0, 'se localiza el parametro de tabla de las opciones');
const bloque = sinComentarios.slice(iTvp, sinComentarios.indexOf('.execute(', iTvp));

check(/columns\.add\('active',\s*sql\.Bit/.test(bloque),
  'la columna active sigue declarada como BIT');
check(/bit\(\s*o\.active/.test(bloque),
  'y su valor pasa por bit()',
  'con dos o mas opciones el driver manda un ARRAY, y ahi un 1 no vale');
check(!/o\.active\s*===\s*false\s*\?\s*0\s*:\s*1/.test(bloque),
  'ya no queda la conversion a 1/0 que provocaba el fallo');

// ===================================================================
seccion('5. Asi reparte las filas el driver, que es la razon de todo');

/*
 * Reproduccion de `fromRow` de msnodesqlv8/lib/user.js. No se importa el
 * driver: lo que interesa es dejar escrito POR QUE una fila se comportaba
 * distinto de dos, para que nadie tenga que volver a descubrirlo.
 */
const fromRow = (filas, c) => filas.length === 1
  ? filas[0][c]
  : filas.map(f => f[c]);

const unaFila = [[true]];
const dosFilas = [[true], [false]];
check(!Array.isArray(fromRow(unaFila, 0)),
  'con UNA fila el driver manda el valor suelto',
  'por eso un 1 colaba y el fallo parecia intermitente');
check(Array.isArray(fromRow(dosFilas, 0)),
  'con DOS manda un array, y ahi el nivel nativo exige booleanos');

const comoAntes = [[1], [1]];
check(fromRow(comoAntes, 0).every(v => typeof v !== 'boolean'),
  'lo que se mandaba antes era un array de numeros: eso era el error');
const comoAhora = [[bit(1)], [bit(true)], [bit('1')], [bit(undefined, true)]];
check(fromRow(comoAhora, 0).every(v => typeof v === 'boolean'),
  'y ahora es un array de booleanos vengan como vengan del formulario');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
