/**
 * Compara el esquema estructural de dos bases.
 *
 *     node scripts/db/comparar-esquema.mjs BaseA BaseB
 *
 * SOLO LECTURA. Sirve para decidir cual es la base autoritativa antes de
 * versionar nada, y para contrastar el template del instalador contra el
 * estado actual.
 *
 * Compara la huella estructural (columnas, tipos, claves, constraints,
 * indices), no el formato.
 */
import { leerEsquema, huellaTabla } from './lib/esquema.mjs';

const [A, B] = process.argv.slice(2);
if (!A || !B) {
  console.error('Uso: node scripts/db/comparar-esquema.mjs <BaseA> <BaseB>');
  process.exit(1);
}

const ea = new Map(leerEsquema(A).map(t => [t.nombre, t]));
const eb = new Map(leerEsquema(B).map(t => [t.nombre, t]));

console.log(`A = ${A}   tablas: ${ea.size}`);
console.log(`B = ${B}   tablas: ${eb.size}\n`);

const soloA = [...ea.keys()].filter(n => !eb.has(n)).sort();
const soloB = [...eb.keys()].filter(n => !ea.has(n)).sort();
const comunes = [...ea.keys()].filter(n => eb.has(n)).sort();

if (soloA.length) { console.log(`Solo en ${A}:`); soloA.forEach(n => console.log('   ' + n)); console.log(); }
if (soloB.length) { console.log(`Solo en ${B}:`); soloB.forEach(n => console.log('   ' + n)); console.log(); }

let distintas = 0;
for (const n of comunes) {
  const ha = huellaTabla(ea.get(n)).split('\n');
  const hb = huellaTabla(eb.get(n)).split('\n');
  if (ha.join('\n') === hb.join('\n')) continue;
  distintas++;
  console.log(`~ ${n}`);
  const sa = new Set(ha), sb = new Set(hb);
  for (const l of ha) if (!sb.has(l)) console.log(`    ${A}: ${l.trim()}`);
  for (const l of hb) if (!sa.has(l)) console.log(`    ${B}: ${l.trim()}`);
}

// Recuento agregado, util para el informe.
const cuenta = (m) => {
  let col = 0, pk = 0, uq = 0, fk = 0, ck = 0, df = 0, ix = 0;
  for (const t of m.values()) {
    col += t.columnas.length; if (t.pk) pk++;
    uq += t.unicas.length; fk += t.foraneas.length;
    ck += t.chequeos.length; df += t.predet.length; ix += t.indices.length;
  }
  return { tablas: m.size, col, pk, uq, fk, ck, df, ix };
};
const ca = cuenta(ea), cb = cuenta(eb);
console.log('\n           tablas  columnas  PK  UNIQUE  FK  CHECK  DEFAULT  INDEX');
const fila = (etq, c) => console.log(
  `${etq.padEnd(11)}${String(c.tablas).padStart(5)}${String(c.col).padStart(10)}` +
  `${String(c.pk).padStart(4)}${String(c.uq).padStart(8)}${String(c.fk).padStart(4)}` +
  `${String(c.ck).padStart(7)}${String(c.df).padStart(9)}${String(c.ix).padStart(7)}`);
fila(A.slice(0, 10), ca);
fila(B.slice(0, 10), cb);

const igual = !soloA.length && !soloB.length && !distintas;
console.log(`\n${igual ? 'ESQUEMAS IDENTICOS.' : `DIFERENCIAS: ${soloA.length} solo en A, ${soloB.length} solo en B, ${distintas} tablas distintas.`}`);
process.exit(igual ? 0 : 1);
