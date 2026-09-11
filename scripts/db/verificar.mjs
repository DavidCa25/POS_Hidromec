/**
 * Compara la definicion canonica de Git contra la de una base real.
 *
 * SOLO LECTURA. No modifica ni el repositorio ni la base.
 *
 *     npm run db:verify                    -> Wybix_Production
 *     npm run db:verify -- Hidromec_DataBase
 *     npm run db:verify -- Wybix_Template --detalle
 *
 * ESTADOS
 *   OK         el objeto existe y su checksum coincide.
 *   FALTA      esta en Git y no en la base. Con `criticidad` alta detiene.
 *   DERIVADO   existe en ambos pero el cuerpo difiere -> alguien lo edito a
 *              mano en la base, o el archivo cambio sin aplicar migracion.
 *   EXTRA      esta en la base y no en Git. Sin fuente: hay que rescatarlo.
 *   PENDIENTE  esta en Git y se sabe que aun no se ha desplegado
 *              (`ausenteEnBase`). No es un error.
 *   EXCLUIDO   esta en Git pero el baseline no lo despliega a proposito
 *              (clase `legacy`). Su ausencia es lo correcto.
 *
 * Sobre el checksum: se calcula sobre la forma canonica descrita en
 * lib/canonico.mjs, que unifica CREATE/ALTER y el espacio final de linea.
 * No colapsa espacios internos a proposito.
 */
import { readFileSync, existsSync } from 'node:fs';
import { consultar } from './lib/sql.mjs';
import { checksum, desenvolver, normalizar } from './lib/canonico.mjs';
import { leerEsquema, huellaTabla, TABLAS_INFRAESTRUCTURA } from './lib/esquema.mjs';
import { clasificacionDe } from './lib/catalogo.mjs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const DETALLE = process.argv.includes('--detalle');
const DB = args[0] || 'Wybix_Production';

const MANIFIESTO = 'sql/manifest.json';
if (!existsSync(MANIFIESTO)) {
  console.error('No existe sql/manifest.json. Ejecuta antes: node scripts/db/extraer.mjs');
  process.exit(2);
}
const manifiesto = JSON.parse(readFileSync(MANIFIESTO, 'utf8'));

// ---------------------------------------------------------------- lectura BD
const modsBase = new Map(
  consultar(DB, `
    SELECT o.name, m.definition AS def
      FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.schema_id = SCHEMA_ID('dbo');`).map(r => [r.name, r.def]),
);
const tiposBase = new Set(
  consultar(DB, `SELECT name FROM sys.table_types WHERE schema_id = SCHEMA_ID('dbo');`)
    .map(r => r.name),
);

// ---------------------------------------------------------------- comparacion
const res = { ok: [], falta: [], derivado: [], pendiente: [], excluido: [], sinArchivo: [] };

for (const o of manifiesto.objetos) {
  const esTipo = o.tipo === 'USER_TABLE_TYPE';

  if (!existsSync(o.archivo)) { res.sinArchivo.push(o); continue; }

  if (esTipo) {
    // Un tipo no guarda texto: solo se comprueba presencia.
    (tiposBase.has(o.nombre) ? res.ok : res.falta).push(o);
    continue;
  }

  const enBase = modsBase.get(o.nombre);
  if (!enBase) {
    // Un objeto `legacy` ausente no es un hueco: el baseline lo deja fuera a
    // proposito. Contarlo como FALTA obligaria a mirar el detalle en cada
    // verificacion para descartar lo mismo una y otra vez.
    const clase = clasificacionDe(o.nombre);
    if (clase === 'legacy') res.excluido.push(o);
    else if (clase === 'futuro' || o.ausenteEnBase) res.pendiente.push(o);
    else res.falta.push(o);
    continue;
  }

  const canonico = desenvolver(readFileSync(o.archivo, 'utf8'));
  if (canonico === null) { res.sinArchivo.push(o); continue; }

  if (checksum(canonico) === checksum(enBase)) res.ok.push(o);
  else res.derivado.push({ ...o, hashGit: checksum(canonico), hashBase: checksum(enBase) });
}

// Objetos de la base que Git no conoce.
const enManifiesto = new Set(manifiesto.objetos.map(o => o.nombre));
const extra = [...modsBase.keys()].filter(n => !enManifiesto.has(n)).sort();

// ---------------------------------------------------------------- esquema
const esq = { ok: [], falta: [], derivada: [], extra: [] };
if (manifiesto.esquema) {
  const enBase = new Map(leerEsquema(DB).map(t => [t.nombre, t]));
  const excluidas = new Set([...(manifiesto.esquema.excluidas || []), ...TABLAS_INFRAESTRUCTURA]);
  const enGit = new Map(manifiesto.esquema.objetos.map(o => [o.nombre, o]));

  for (const o of manifiesto.esquema.objetos) {
    const t = enBase.get(o.nombre);
    if (!t) { esq.falta.push(o); continue; }
    const h = createHash('sha256').update(huellaTabla(t), 'utf8').digest('hex').slice(0, 16);
    if (h === o.checksum) esq.ok.push(o);
    else esq.derivada.push({ ...o, hashBase: h, tabla: t });
  }
  for (const n of enBase.keys()) {
    if (!enGit.has(n) && !excluidas.has(n)) esq.extra.push(n);
  }
}

// ---------------------------------------------------------------- informe
const total = manifiesto.objetos.length;
const nTablas = manifiesto.esquema ? manifiesto.esquema.objetos.length : 0;
console.log(`Base: ${DB}`);
console.log(`Manifiesto: ${total} objetos programables + ${nTablas} tablas\n`);

if (manifiesto.esquema) {
  const r = manifiesto.esquema.resumen;
  console.log('  ESQUEMA');
  console.log(`    TABLAS      ${String(esq.ok.length).padStart(3)} / ${nTablas}` +
    (esq.falta.length ? `   FALTAN ${esq.falta.length}` : '') +
    (esq.derivada.length ? `   DERIVADAS ${esq.derivada.length}` : '') +
    (esq.extra.length ? `   EXTRA ${esq.extra.length}` : ''));
  console.log(`    columnas ${r.columnas} · PK ${r.pk} · UNIQUE ${r.unicas} · FK ${r.foraneas} · CHECK ${r.chequeos} · DEFAULT ${r.predeterminados} · INDEX ${r.indices}`);
  console.log('');
}

console.log('  OBJETOS PROGRAMABLES');
console.log(`    OK         ${String(res.ok.length).padStart(3)} / ${total}`);
console.log(`    FALTA      ${String(res.falta.length).padStart(3)}`);
console.log(`    DERIVADO   ${String(res.derivado.length).padStart(3)}`);
console.log(`    PENDIENTE  ${String(res.pendiente.length).padStart(3)}   (aun no desplegado, esperado)`);
console.log(`    EXCLUIDO   ${String(res.excluido.length).padStart(3)}   (legacy: el baseline no lo despliega)`);
console.log(`    EXTRA      ${String(extra.length).padStart(3)}   (en la base, sin fuente en Git)`);
if (res.sinArchivo.length) console.log(`    SIN ARCHIVO ${res.sinArchivo.length}`);

const criticosFaltantes = res.falta.filter(o => o.critico);

if (res.falta.length) {
  console.log('\nFALTAN en la base:');
  for (const o of res.falta) console.log(`  ${o.critico ? '[CRITICO] ' : '          '}${o.nombre}`);
}
if (res.derivado.length) {
  console.log('\nDERIVADOS (el cuerpo de la base no coincide con Git):');
  for (const o of res.derivado) {
    console.log(`  ${o.nombre}   git:${o.hashGit}  base:${o.hashBase}`);
    if (DETALLE) {
      const g = desenvolver(readFileSync(o.archivo, 'utf8')).split('\n');
      const b = normalizar(modsBase.get(o.nombre)).split('\n');
      for (let i = 0; i < Math.max(g.length, b.length); i++) {
        if (g[i] !== b[i]) {
          console.log(`      linea ${i + 1}`);
          console.log(`        git : ${JSON.stringify(g[i] ?? '(fin)')}`);
          console.log(`        base: ${JSON.stringify(b[i] ?? '(fin)')}`);
          break;
        }
      }
    }
  }
}
if (res.pendiente.length) {
  console.log('\nPENDIENTES de desplegar (estan en Git, no en la base):');
  for (const o of res.pendiente) console.log(`  ${o.nombre}   ${o.nota || ''}`);
}
if (extra.length) {
  console.log('\nEXTRA en la base sin fuente en Git (rescatar antes de perderlos):');
  for (const n of extra) console.log(`  ${n}`);
}

const limpio = !res.falta.length && !res.derivado.length && !extra.length && !res.sinArchivo.length;
console.log(`\n${limpio ? 'SIN DERIVA.' : 'HAY DIFERENCIAS.'}`);
if (criticosFaltantes.length) {
  console.log(`FALTAN ${criticosFaltantes.length} OBJETOS CRITICOS: esta base no puede operar.`);
}
process.exit(limpio ? 0 : 1);
