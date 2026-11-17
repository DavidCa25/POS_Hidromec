/**
 * PRUEBA DE HUMO DEL SQL DEL ASISTENTE: corre la respuesta de CADA intent
 * contra una base temporal real (por omisión Wybix_E2E_Core, la que deja
 * `node e2e/preparar-bases.mjs core`), con datos de ejemplo de esa base.
 *
 *     node scripts/asistente/humo-sql.mjs [Base_Temporal]
 *
 * No prueba que la respuesta sea la correcta (eso lo hacen la E2E y el
 * loop): prueba que ninguna consulta truene en el esquema de verdad
 * (columna mal escrita, tabla que no existe, tipo equivocado). Solo lee:
 * las acciones arman su plan sin ejecutarlo.
 */
import { createRequire } from 'node:module';
import { consultarTemporal } from '../db/lib/temporal-consulta.mjs';

const require = createRequire(import.meta.url);
const { crearAcciones } = require('../../electron/asistente/acciones/index.js');
const { crearSensores } = require('../../electron/asistente/sensores.js');
const { INTENTS } = require('../../electron/asistente/lenguaje/intents/index.js');

const BASE = process.argv[2] || 'Wybix_E2E_Core';

/* Tipos de mssql como texto T-SQL: el «pool» de abajo los declara. */
const sql = { Int: 'INT', Date: 'DATE', DateTime2: 'DATETIME2', Bit: 'BIT', NVarChar: (n = 4000) => `NVARCHAR(${n})`, VarChar: (n = 4000) => `VARCHAR(${n})`,
              Decimal: (p = 18, s = 4) => `DECIMAL(${p},${s})` };
const literal = (v) => {
  if (v == null) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19)}'`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `N'${String(v).replace(/'/g, "''")}'`;
};
/* El ayudante de PowerShell devuelve las fechas como «/Date(ms)/»; mssql, como Date. */
const fechas = (filas) => filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => {
  const m = typeof v === 'string' && v.match(/^\/Date\((-?\d+)\)\/$/);
  return [k, m ? new Date(Number(m[1])) : v];
})));
/** Un pool falso: cada consulta es un lote con sus DECLARE, en la base temporal. */
const pool = async () => ({
  request() {
    const entradas = [];
    return {
      input(n, t, v) { entradas.push([n, t, v]); return this; },
      async query(texto) {
        const decl = entradas.map(([n, t, v]) => `DECLARE @${n} ${typeof t === 'function' ? t() : t} = ${literal(v)};`).join('\n');
        const r = consultarTemporal(BASE, `SET NOCOUNT ON;\n${decl}\n${texto}`);
        if (!r.ok) throw new Error(r.error);
        return { recordset: fechas(r.sets.length ? r.sets[r.sets.length - 1] : []) };
      },
      /* Procedures: EXEC con los mismos parámetros por nombre. */
      async execute(nombre) {
        const decl = entradas.map(([n, t, v]) => `DECLARE @${n} ${typeof t === 'function' ? t() : t} = ${literal(v)};`).join('\n');
        const args = entradas.map(([n]) => `@${n} = @${n}`).join(', ');
        const r = consultarTemporal(BASE, `SET NOCOUNT ON;\n${decl}\nEXEC dbo.${nombre} ${args};`);
        if (!r.ok) throw new Error(r.error);
        return { recordset: fechas(r.sets.length ? r.sets[r.sets.length - 1] : []) };
      },
    };
  },
});

const fila = (texto) => { const r = consultarTemporal(BASE, `SET NOCOUNT ON; ${texto}`); if (!r.ok) throw new Error(r.error); return r.sets.at(-1)?.[0] || {}; };
/* Datos de ejemplo de la base (o un id que no existe: la respuesta debe decir «no encontré», no tronar). */
const m = fila(`SELECT
  (SELECT TOP 1 id FROM dbo.products WHERE active = 1 AND inventory_mode = 'DIRECT' ORDER BY id) AS producto,
  (SELECT TOP 1 id FROM dbo.customers ORDER BY id) AS cliente,
  (SELECT TOP 1 id FROM dbo.CAT_suppliers ORDER BY id) AS proveedor,
  (SELECT TOP 1 id FROM dbo.expense_categories ORDER BY id) AS concepto,
  (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id) AS categoria,
  (SELECT TOP 1 id FROM dbo.sales ORDER BY id DESC) AS folio;`);
let profesional = null;
try { profesional = fila('SELECT TOP 1 id FROM dbo.professionals ORDER BY id;').id ?? null; } catch { /* sin módulo de servicios */ }

const ex = (valor, texto = String(valor)) => ({ valor, texto, confianza: 'exacto' });
const manana = (() => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const SLOTS = {
  producto: ex(m.producto ?? 999999), servicio: ex(m.producto ?? 999999), cliente: ex(m.cliente ?? 999999), proveedor: ex(m.proveedor ?? 999999),
  profesional: profesional ? ex(profesional) : undefined, concepto: ex(m.concepto ?? 1), categoria: ex(m.categoria ?? 1, 'Categoría'),
  cantidad: ex(3), precio: ex(25), monto: ex(150), metodo: ex('EFECTIVO', 'efectivo'), periodo: ex('semana'), fecha: ex(manana, 'mañana'),
  hora: ex({ h: 17, m: 0 }, '17:00'), folio: ex(m.folio ?? 1), mesa: ex(1, 'mesa 1'), motivo: ex('SE_CAYO'), nombre: ex('Prueba Humo Wybix'),
  telefono: ex('4770000000'), destino: ex('/dashboard/inventario', 'Inventario'), nota: ex('humo'),
  renglones: ex([{ cantidad: 2, productId: m.producto ?? 999999, nombre: 'x' }], '2 x'),
  alias: ex('roja'), objetivo: ex({ tipo: 'producto', id: m.producto ?? 999999 }, 'x'),
  pregunta: ex({ medida: 'ganancia', agrupar: 'categoria', orden: 'asc', limite: 3, comparar: null }), producto2: ex(m.producto ?? 999999),
  preferencia: ex({ cambios: { graficas: true } }), costo: ex(5), existencia: ex(3),
};
/* La pregunta libre en todas sus formas: cada agrupación y medida, y las dos comparaciones. */
const LIBRES = [
  ...['producto', 'categoria', 'hora', 'diaSemana', 'dia', 'cajero', 'metodo', 'cliente'].flatMap((agrupar) =>
    ['ventas', 'piezas', 'ganancia', 'tickets', 'promedio'].map((medida) => ({ medida, agrupar, orden: 'desc', limite: null, comparar: null }))),
  { medida: 'ventas', agrupar: null, orden: 'desc', limite: null, comparar: { tipo: 'periodos', a: { periodo: 'semana' }, b: { periodo: 'semana_pasada' } } },
  { medida: 'ganancia', agrupar: null, orden: 'desc', limite: null, comparar: { tipo: 'periodos', a: { rango: { desde: '2026-10-01', hasta: '2026-11-01', nombre: 'En octubre' } }, b: { rango: { desde: '2026-09-01', hasta: '2026-10-01', nombre: 'En septiembre' } } } },
  { medida: 'ventas', agrupar: null, orden: 'desc', limite: null, comparar: { tipo: 'productos' } },
];
/* Todos los filtros a la vez: el SQL del cubo con cada pieza encendida. */
const FILTROS = ex({ diasSemana: [0, 6], horaDesde: 18, horaHasta: 23, metodo: 'TARJETA', categoria: { id: m.categoria ?? 1, nombre: 'Categoría' },
                     cajero: { id: 1, nombre: 'admin' }, rango: { desde: '2026-10-01', hasta: '2026-11-01', nombre: 'En octubre', de: 'de octubre' } }, 'todo');

const sensores = crearSensores({ sql, pool, sistema: async () => ({}) });
const acciones = crearAcciones({ sql, pool, sensores, listarHallazgos: async () => [], sistema: async () => ({ respaldo: { activo: true }, disco: { libreGB: 50 } }) });
const ctx = { userId: 1, usuario: 'humo', puede: () => true };

let fallos = 0;
const t0 = Date.now();
/* Cada intent con sus datos; los que aceptan filtros, otra vez con todos los filtros (el cubo). */
const corridas = INTENTS.flatMap((def) => [[def, false], ...(def.slots.filtros ? [[def, true]] : [])]);
for (const q of LIBRES) corridas.push([INTENTS.find((d) => d.id === 'analisis.libre'), 'libre', q]);
for (const [def, conFiltros, libre] of corridas) {
  const nombre = def.id + (libre ? ` ${libre.comparar ? `contra ${libre.comparar.tipo}` : `${libre.medida}/${libre.agrupar}`}` : conFiltros ? ' +filtros' : '');
  const slots = {};
  for (const k of Object.keys(def.slots)) if (SLOTS[k] !== undefined && k !== 'filtros') slots[k] = SLOTS[k];
  if (conFiltros === true) slots.filtros = FILTROS;
  if (libre) slots.pregunta = ex(libre);
  const interp = { intent: def.id, puntaje: 1, alternativas: [], slots, falta: null, texto: def.ejemplos?.[0] || def.etiqueta };
  try {
    const r = await acciones.responder(interp, ctx);
    if (!r || typeof r.texto !== 'string') throw new Error('respuesta sin texto');
    console.log(`  ok     ${nombre.padEnd(30)} ${r.plan ? '[plan] ' : ''}${r.texto.slice(0, 90)}`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA  ${nombre.padEnd(30)} ${String(e.message).split('\n')[0].slice(0, 160)}`);
  }
}
console.log(`\n${corridas.length - fallos}/${corridas.length} respuestas corren contra ${BASE} (${INTENTS.length} intents, ${corridas.length - INTENTS.length} con todos los filtros) · ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(fallos ? 1 : 0);
