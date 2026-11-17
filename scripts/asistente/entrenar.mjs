/**
 * EL LOOP DE ENTRENAMIENTO DEL INTÉRPRETE.
 *
 *     node scripts/asistente/entrenar.mjs                  (resumen y errores)
 *     node scripts/asistente/entrenar.mjs --todo           (también los aciertos)
 *     node scripts/asistente/entrenar.mjs --area clientes  (solo las frases de un archivo)
 *
 * Mide tres cosas, con frases que el modelo NO vio al entrenar:
 *
 *   1. FRASES APARTADAS: 1 de cada 5 frases de lenguaje/frases/*.txt se deja
 *      fuera del entrenamiento y se interpreta con los catálogos de prueba de
 *      los giros (giros.mjs). Intent correcto, y si la frase nombra un
 *      producto o una persona, que se encuentre (o se pregunte) y nunca que
 *      se tome otro con seguridad.
 *   2. CASOS DETALLADOS (casos.mjs): cada dato (cantidad, producto, precio,
 *      fecha, motivo…) con el modelo de producción.
 *   3. VARIACIONES de las apartadas: un dedazo, muletillas y MAYÚSCULAS.
 *
 * El loop: correr, leer los errores, corregir la causa (frases, palabra
 * clave, extractor), volver a correr. Meta: ≥97 % en cada medida y cero
 * productos o personas inventados. Sale con código 1 si no se cumple.
 */
import { createRequire } from 'node:module';
import { CATALOGO as CAT_CASOS, CATEGORIAS, CASOS, RUIDO } from './casos.mjs';
import { CATALOGO, PERSONAS, CONCEPTOS, MODULOS } from './giros.mjs';

const require = createRequire(import.meta.url);
const { crearInterprete, prepararCatalogo } = require('../../electron/asistente/lenguaje/interprete.js');
const { frases } = require('../../electron/asistente/lenguaje/corpus.js');
const { porId } = require('../../electron/asistente/lenguaje/intents/index.js');
const { normalizar, raiz } = require('../../electron/asistente/lenguaje/normalizar.js');

const args = process.argv.slice(2);
const todo = args.includes('--todo');
const area = args.includes('--area') ? args[args.indexOf('--area') + 1] : null;
const META = 97;
const t0 = Date.now();
const ahora = new Date('2026-11-14T12:00:00');
let fallos = 0;
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 100);

// ------------------------------------------------------- 1. frases apartadas
const medidor = crearInterprete({ sinApartadas: true });
const catalogo = prepararCatalogo(CATALOGO);
const personas = prepararCatalogo(PERSONAS);
const opciones = { catalogo, personas, conceptos: CONCEPTOS, categorias: CATEGORIAS, modulos: MODULOS, ahora };
const todas = frases();
const apartadas = todas.filter((f) => f.apartada && (!area || f.archivo === `${area}.txt`));

/* ¿El nombre tomado comparte palabras con lo que se dijo? */
const comparte = (nombre, dicho) => {
  const a = normalizar(nombre).tokens.map(raiz), b = normalizar(dicho).tokens.map(raiz);
  return b.some((w) => w.length > 2 && a.some((x) => x === w || x.startsWith(w) || w.startsWith(x)));
};
const PERS = ['cliente', 'proveedor', 'profesional'];

function revisar(f, r) {
  const problemas = [];
  if (r.intent !== f.intent) return [`intent ${r.intent} (${r.puntaje})`];
  const def = porId(f.intent);
  const slotProd = def.slots.producto ? 'producto' : def.slots.servicio ? 'servicio' : def.slots.renglones ? 'renglones' : null;
  if (f.productos.length && slotProd && slotProd !== 'renglones') {
    const s = r.slots[slotProd];
    if (!s || (s.valor == null && !s.opciones?.length)) problemas.push(`no encontró el producto «${f.productos[0]}»`);
    else if (s.valor != null && s.confianza !== 'dudoso') {
      const nom = CATALOGO.find((c) => c.id === s.valor)?.nombre;
      if (!comparte(nom, f.productos[0])) problemas.push(`INVENTA producto ${nom} por «${f.productos[0]}»`);
    }
  }
  const slotPer = PERS.find((k) => def.slots[k]);
  if (f.personas.length && slotPer) {
    const s = r.slots[slotPer];
    if (!s) problemas.push(`no encontró a «${f.personas[0]}»`);
    else if (s.valor != null && s.confianza !== 'dudoso') {
      const nom = PERSONAS.find((c) => c.id === s.valor)?.nombre;
      if (!f.personas.some((p) => comparte(nom, p))) problemas.push(`INVENTA persona ${nom} por «${f.personas.join(', ')}»`);
    }
  }
  return problemas;
}

const porIntent = {}, porArchivo = {}, confusion = {};
let okA = 0, inventa = 0;
for (const f of apartadas) {
  const r = medidor.interpretar(f.texto, opciones);
  const p = revisar(f, r);
  const e = (porIntent[f.intent] ||= { ok: 0, n: 0 });
  const g = (porArchivo[f.archivo] ||= { ok: 0, n: 0 });
  e.n++; g.n++;
  if (!p.length) { okA++; e.ok++; g.ok++; if (todo) console.log(`  ok     «${f.texto}» → ${r.intent}`); continue; }
  if (p.some((x) => x.startsWith('INVENTA'))) inventa++;
  if (r.intent !== f.intent) confusion[`${f.intent} → ${r.intent}`] = (confusion[`${f.intent} → ${r.intent}`] || 0) + 1;
  console.log(`  FALLA  [${f.intent}] «${f.texto}» → ${p.join(' · ')}`);
}
const pctA = pct(okA, apartadas.length);
console.log(`\nAPARTADAS: ${okA}/${apartadas.length} (${pctA}%) · inventados ${inventa}`);
console.log('  por archivo:', Object.entries(porArchivo).map(([k, v]) => `${k.replace('.txt', '')} ${pct(v.ok, v.n)}%`).join(' · '));
const flojos = Object.entries(porIntent).filter(([, v]) => v.ok < v.n).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);
if (flojos.length) console.log('  intents con fallas:', flojos.map(([k, v]) => `${k} ${v.ok}/${v.n}`).join(' · '));
if (Object.keys(confusion).length) console.log('  confusión:', confusion);
if (pctA < META || inventa) fallos++;

// --------------------------------------------- 3. variaciones de las apartadas
function prng(semilla) { let x = semilla >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; }
const rnd = prng(11);
const dedo = (t) => t.split(' ').map((w) => {
  if (w.length < 6 || rnd() > 0.35) return w;
  const i = 1 + Math.floor(rnd() * (w.length - 3));
  return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
}).join(' ');
const MULETILLAS = ['oye ', 'wybix ', 'oye wybix, ', 'porfa ', 'a ver, '];
let varOk = 0, varN = 0, varInventa = 0;
for (const f of apartadas) {
  for (const v of [dedo(f.texto), MULETILLAS[Math.floor(rnd() * MULETILLAS.length)] + f.texto + (rnd() > 0.5 ? ' porfa' : ''), f.texto.toUpperCase()]) {
    varN++;
    const r = medidor.interpretar(v, opciones);
    const p = revisar(f, r);
    if (r.intent === f.intent) varOk++;
    else if (todo || area) console.log(`  VAR    «${v}» → ${r.intent} (${r.puntaje}) esperaba ${f.intent}`);
    if (p.some((x) => x.startsWith('INVENTA'))) { varInventa++; console.log(`  VAR    «${v}» → ${p.join(' · ')}`); }
  }
}
const pctV = pct(varOk, varN);
console.log(`VARIACIONES: ${varOk}/${varN} (${pctV}%) · inventados ${varInventa}`);
if (pctV < META - 2 || varInventa) fallos++;

// ------------------------------------------------- 2. casos detallados
if (!area) {
  const it = crearInterprete();
  const cat = prepararCatalogo(CAT_CASOS);
  const iso = (n) => { const d = new Date(ahora); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const FECHAS = { hoy: iso(0), manana: iso(1), pasado: iso(2) };
  let okC = 0;
  for (const [texto, esperado, datos] of CASOS) {
    const r = it.interpretar(texto, { catalogo: cat, categorias: CATEGORIAS, modulos: MODULOS, ahora });
    const problemas = [];
    if (r.intent !== esperado) problemas.push(`intent ${r.intent} (${r.puntaje})`);
    else {
      for (const [k, v] of Object.entries(datos)) {
        const s = r.slots[k];
        if (v === '?') { if (s && s.valor != null && s.confianza !== 'dudoso') problemas.push(`${k} debía preguntarse y quedó ${s.texto}`); continue; }
        if (k === 'producto') { const nom = CAT_CASOS.find((p) => p.id === s?.valor)?.nombre; if (nom !== v || s.confianza === 'dudoso') problemas.push(`producto ${nom ?? s?.texto ?? '—'} (${s?.confianza ?? 'sin dato'})`); continue; }
        if (k === 'fecha') { if (s?.valor !== FECHAS[v]) problemas.push(`fecha ${s?.valor ?? '—'}`); continue; }
        if (k === 'delta') { if (r.slots.precio?.delta !== v) problemas.push(`delta ${r.slots.precio?.delta ?? '—'}`); continue; }
        if (k === 'nombre') { if ((s?.valor || '').toLowerCase() !== v.toLowerCase()) problemas.push(`nombre «${s?.valor ?? '—'}»`); continue; }
        if (s?.valor !== v) problemas.push(`${k} ${s?.valor ?? '—'}`);
      }
    }
    if (problemas.length) console.log(`  CASO   «${texto}» → ${problemas.join(' · ')}`);
    else okC++;
  }
  for (const texto of RUIDO) {
    const r = it.interpretar(texto, { catalogo: cat, categorias: CATEGORIAS, modulos: MODULOS, ahora });
    /* Con una frase de otro tema Wybix nunca arma una ACCIÓN con seguridad (las
       consultas no escriben nada; una acción siempre pasa por Confirmar, pero
       ni siquiera debe proponerse). */
    if (r.intent && r.puntaje >= 0.45 && porId(r.intent).tipo === 'accion') { fallos++; console.log(`  RUIDO  «${texto}» → ${r.intent} (${r.puntaje})`); }
    else if (r.intent && r.puntaje >= 0.45) console.log(`  ruido  «${texto}» → consulta ${r.intent} (${r.puntaje}), no escribe nada`);
  }
  const pctC = pct(okC, CASOS.length);
  console.log(`CASOS DETALLADOS: ${okC}/${CASOS.length} (${pctC}%)`);
  if (pctC < META) fallos++;
}

const porGiro = (m) => todas.filter((f) => { const mo = porId(f.intent).modulo; return !mo || mo === m || (m !== 'hospitality' && m !== 'servicios' && mo !== 'hospitality' && mo !== 'servicios'); }).length;
console.log(`\nfrases: ${todas.length} · retail ${porGiro('retail')} · hospitality ${porGiro('hospitality')} · servicios ${porGiro('servicios')} · ${Date.now() - t0} ms`);
process.exit(fallos ? 1 : 0);
