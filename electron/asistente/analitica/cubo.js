'use strict';
/**
 * EL CUBO DE VENTAS: una pregunta con filtros combinados → UN SQL.
 *
 * Wybix no tiene una consulta escrita a mano para cada combinación («cuánto
 * vendí de refrescos los sábados después de las 6 en tarjeta»): tiene esta
 * capa, que arma la consulta con piezas declaradas como datos.
 *
 *   medidas      ventas · tickets · piezas · costo · base (sin IVA) → ganancia
 *   dimensiones  producto · categoria · dia · diaSemana · hora · metodo · cajero · cliente
 *   filtros      rango de fechas · productos · categorías · días de la semana
 *                · rango de horas · forma de pago · cajero · cliente
 *
 * Dos niveles:
 *   venta  sobre dbo.sales (el total cobrado, igual que el corte), cuando no
 *          hace falta saber QUÉ se vendió.
 *   linea  sobre dbo.sale_detail, cuando se filtra o se agrupa por producto o
 *          categoría, o se pide piezas o ganancia.
 *
 * Seguridad: los valores viajan como parámetros; lo único que se concatena
 * son fragmentos de esta tabla y enteros ya validados.
 *
 * El día de la semana se calcula con DATEDIFF desde un domingo (1900-01-07):
 * 0 = domingo … 6 = sábado, sin depender de SET DATEFIRST.
 */

const DIA_SEMANA = "(DATEDIFF(DAY, '19000107', s.datee) % 7)";
/* Base sin impuestos de un renglón: igual que finanzas.js y sp_get_profit_overview.
   Con IEPS u otro impuesto (0083), la foto de la venta (base_neta); si no, sin IVA. */
const BASE_LINEA = "COALESCE(sd.base_neta, CASE WHEN ISNULL(sd.tax_object, '02') = '02' THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0))) ELSE sd.subtotal END)";
const COSTO_LINEA = 'sd.quantity * COALESCE(sd.unit_cost, p.cost, 0)';

const DIMENSIONES = {
  producto: { linea: true, clave: 'p.id', nombre: 'p.nombre' },
  categoria: { linea: true, clave: 'ISNULL(p.category_id, 0)', nombre: "ISNULL(c.namee, N'Sin categoría')", unir: 'categoria' },
  dia: { clave: 'CAST(s.datee AS DATE)', nombre: "CONVERT(VARCHAR(10), CAST(s.datee AS DATE), 23)" },
  diaSemana: { clave: DIA_SEMANA, nombre: DIA_SEMANA },
  hora: { clave: 'DATEPART(HOUR, s.datee)', nombre: 'DATEPART(HOUR, s.datee)' },
  metodo: { clave: "UPPER(ISNULL(s.payment_method, 'EFECTIVO'))", nombre: "UPPER(ISNULL(s.payment_method, 'EFECTIVO'))" },
  cajero: { clave: 'ISNULL(s.useer_id, 0)', nombre: "ISNULL(u.usuario, N'Sin usuario')", unir: 'usuario' },
  cliente: { clave: 'ISNULL(s.customer_id, 0)', nombre: "ISNULL(cu.customerName, N'Público general')", unir: 'cliente' },
};

const UNIONES = {
  categoria: 'LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id',
  usuario: 'LEFT JOIN dbo.users u ON u.id = s.useer_id',
  cliente: 'LEFT JOIN dbo.customers cu ON cu.id = s.customer_id',
};

const METODOS = new Set(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'CREDITO', 'VALES']);
const MEDIDAS_LINEA = new Set(['piezas', 'ganancia', 'costo', 'base']);

const entero = (n, min, max) => { const v = Math.trunc(Number(n)); return Number.isFinite(v) && v >= min && v <= max ? v : null; };
const ids = (xs) => [...new Set((Array.isArray(xs) ? xs : [xs]).map((x) => entero(x, 1, 2_147_483_647)).filter((x) => x != null))];
const fechaValida = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(s);

/** ¿La pregunta necesita los renglones de la venta? */
function esDeLinea(p) {
  const f = p.filtros || {};
  return !!(ids(f.productos).length || ids(f.categorias).length || (p.agrupar && DIMENSIONES[p.agrupar]?.linea)
    || (p.medidas || []).some((m) => MEDIDAS_LINEA.has(m)));
}

/**
 * Pregunta → { texto, entradas: [[nombre, tipo, valor]] }.
 *
 * @param p {
 *   filtros: { desde, hasta (ISO local, hasta exclusivo), productos: [id], categorias: [id], diasSemana: [0-6],
 *              horaDesde (0-23), horaHasta (1-24, exclusiva), metodo, cajero (id), cliente (id) },
 *   agrupar: null | clave de DIMENSIONES,
 *   medidas: ['piezas', 'ganancia'…] (ventas y tickets van siempre),
 *   orden: 'ventas' | 'piezas' | 'tickets' | 'ganancia' | 'clave', limite }
 * @param tipos  los tipos de mssql (sql.NVarChar…), para declarar los parámetros
 */
function compilar(p, tipos) {
  const f = p.filtros || {};
  const linea = esDeLinea(p);
  const dim = p.agrupar ? DIMENSIONES[p.agrupar] : null;
  if (p.agrupar && !dim) throw new Error(`No sé agrupar por «${p.agrupar}».`);
  const entradas = [];
  const donde = [];
  const uniones = new Set();

  if (!fechaValida(f.desde) || !fechaValida(f.hasta)) throw new Error('La pregunta necesita un rango de fechas.');
  entradas.push(['desde', tipos.NVarChar(19), f.desde], ['hasta', tipos.NVarChar(19), f.hasta]);
  donde.push('s.datee >= CAST(@desde AS DATETIME2)', 's.datee < CAST(@hasta AS DATETIME2)');

  const prods = ids(f.productos);
  if (prods.length) donde.push(`sd.product_id IN (${prods.join(', ')})`);
  const cats = ids(f.categorias);
  if (cats.length) donde.push(`p.category_id IN (${cats.join(', ')})`);
  const dias = [...new Set((f.diasSemana || []).map((d) => entero(d, 0, 6)).filter((d) => d != null))];
  if (dias.length && dias.length < 7) donde.push(`${DIA_SEMANA} IN (${dias.join(', ')})`);
  const hd = entero(f.horaDesde, 0, 23), hh = entero(f.horaHasta, 1, 24);
  if (hd != null) donde.push(`DATEPART(HOUR, s.datee) >= ${hd}`);
  if (hh != null) donde.push(`DATEPART(HOUR, s.datee) < ${hh}`);
  if (f.metodo) {
    const m = String(f.metodo).toUpperCase();
    if (!METODOS.has(m)) throw new Error(`Forma de pago desconocida: ${m}`);
    entradas.push(['metodo', tipos.VarChar(20), m]);
    /* Pago mixto: cuenta si alguna parte se pagó así. */
    donde.push(`(UPPER(ISNULL(s.payment_method, 'EFECTIVO')) = @metodo OR EXISTS (SELECT 1 FROM dbo.sale_payments sp WHERE sp.sale_id = s.id AND UPPER(sp.payment_method) = @metodo))`);
  }
  const cajero = entero(f.cajero, 1, 2_147_483_647);
  if (cajero != null) donde.push(`s.useer_id = ${cajero}`);
  const cliente = entero(f.cliente, 1, 2_147_483_647);
  if (cliente != null) donde.push(`s.customer_id = ${cliente}`);
  if (dim?.unir) uniones.add(dim.unir);

  const medidas = linea
    ? ['ISNULL(SUM(sd.subtotal), 0) AS ventas', 'COUNT(DISTINCT s.id) AS tickets', 'ISNULL(SUM(sd.quantity), 0) AS piezas',
       `ISNULL(SUM(${BASE_LINEA}), 0) AS base`, `ISNULL(SUM(${COSTO_LINEA}), 0) AS costo`,
       'SUM(CASE WHEN COALESCE(sd.unit_cost, p.cost, 0) = 0 THEN 1 ELSE 0 END) AS sin_costo']
    : ['ISNULL(SUM(s.total), 0) AS ventas', 'COUNT(*) AS tickets'];
  const desde = linea
    ? 'dbo.sales s JOIN dbo.sale_detail sd ON sd.sale_id = s.id JOIN dbo.products p ON p.id = sd.product_id'
    : 'dbo.sales s';
  const joins = [...uniones].map((u) => UNIONES[u]).join('\n  ');
  /* SQL Server acepta un alias en ORDER BY solo si va solo: «(base - costo)»
     truena con «Invalid column name». La ganancia se ordena con la expresión. */
  const ORDEN = { ventas: 'ventas', tickets: 'tickets', piezas: linea ? 'piezas' : 'ventas',
                  ganancia: linea ? `(ISNULL(SUM(${BASE_LINEA}), 0) - ISNULL(SUM(${COSTO_LINEA}), 0))` : 'ventas', clave: 'clave' };
  const orden = ORDEN[p.orden] || 'ventas';
  const limite = entero(p.limite, 1, 500);

  const texto = dim
    ? `SELECT ${limite ? `TOP (${limite}) ` : ''}${dim.clave} AS clave, ${dim.nombre} AS nombre, ${medidas.join(', ')}
  FROM ${desde}
  ${joins}
 WHERE ${donde.join('\n   AND ')}
 GROUP BY ${dim.clave}, ${dim.nombre}
 ORDER BY ${orden} ${orden === 'clave' ? 'ASC' : 'DESC'};`
    : `SELECT ${medidas.join(', ')}
  FROM ${desde}
  ${joins}
 WHERE ${donde.join('\n   AND ')};`;
  return { texto, entradas, linea };
}

/** Una fila del cubo con números y la ganancia ya calculada. */
function fila(x) {
  const o = { clave: x.clave, nombre: x.nombre, ventas: Number(x.ventas) || 0, tickets: Number(x.tickets) || 0 };
  if (x.piezas !== undefined) {
    o.piezas = Number(x.piezas) || 0;
    o.base = Number(x.base) || 0;
    o.costo = Number(x.costo) || 0;
    o.ganancia = o.base - o.costo;
    o.sinCosto = Number(x.sin_costo) || 0;
  }
  o.promedio = o.tickets ? o.ventas / o.tickets : 0;
  return o;
}

/** @param d { q(texto, entradas), sql } */
function crearCubo({ q, sql }) {
  async function consultar(p) {
    const { texto, entradas } = compilar(p, sql);
    const filas = (await q(texto, entradas)).map(fila);
    return p.agrupar ? filas : filas[0] || fila({});
  }
  return { consultar };
}

module.exports = { crearCubo, compilar, esDeLinea, DIMENSIONES, DIA_SEMANA };
