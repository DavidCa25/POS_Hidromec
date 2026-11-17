'use strict';
/**
 * «¿POR QUÉ?»: la diferencia entre dos periodos, separada en sus causas.
 *
 *   1. Clientes contra gasto por cliente:
 *        Δventas = Δtickets × promedio anterior  (vinieron más o menos)
 *                + tickets × Δpromedio           (gastaron más o menos)
 *   2. Dónde se concentró: por producto, categoría, día de la semana, hora,
 *      cajero y forma de pago. Gana la dimensión donde pocos renglones
 *      explican más de la diferencia («casi todo fue la concha»).
 *
 * Funciones puras sobre filas del cubo: se prueban sin base.
 */

/** Δ por miembro de una dimensión, con nombre. */
function diferencias(ahora, antes) {
  const m = new Map();
  for (const x of antes) m.set(String(x.clave), { clave: x.clave, nombre: x.nombre, antes: x.ventas, ahora: 0 });
  for (const x of ahora) {
    const k = String(x.clave);
    const o = m.get(k) || { clave: x.clave, nombre: x.nombre, antes: 0, ahora: 0 };
    o.ahora = x.ventas;
    o.nombre = x.nombre;
    m.set(k, o);
  }
  return [...m.values()].map((o) => ({ ...o, delta: o.ahora - o.antes }));
}

/**
 * ¿El cambio se concentró en pocos miembros? Se compara cada uno contra lo
 * que le TOCABA según su tamaño: si todo bajó 20 %, el producto grande baja
 * más pesos sin ser «la causa». Lo que cuenta es el exceso sobre su parte.
 *
 *   esperado_i = Δtotal × (antes_i / antes_total)
 *   exceso_i   = Δ_i − esperado_i
 *
 * @returns { dimension, miembros: [{nombre, delta, antes, ahora}], peso (0–1) } | null
 *   peso = qué parte del cambio total explica el exceso de los 2 primeros.
 */
function concentracion(dimension, filas, deltaTotal) {
  if (!deltaTotal || filas.length < 2) return null;
  const antesTotal = filas.reduce((a, f) => a + f.antes, 0);
  const conExceso = filas.map((f) => ({ ...f, exceso: f.delta - deltaTotal * (antesTotal > 0 ? f.antes / antesTotal : 1 / filas.length) }));
  const mismo = conExceso.filter((f) => Math.sign(f.exceso) === Math.sign(deltaTotal) && Math.sign(f.delta) === Math.sign(deltaTotal))
    .sort((a, b) => Math.abs(b.exceso) - Math.abs(a.exceso));
  if (!mismo.length) return null;
  const top = mismo.slice(0, 2);
  const peso = Math.max(0, Math.min(1, top.reduce((a, f) => a + f.exceso, 0) / deltaTotal));
  return { dimension, miembros: top.map(({ exceso, ...f }) => f), peso };
}

/**
 * @param x {
 *   total: { ahora: {ventas, tickets}, antes: {ventas, tickets} },
 *   dimensiones: { producto: {ahora: filas, antes: filas}, diaSemana: …, hora: … }
 * }
 * @returns { delta, pct, porTickets, porPromedio, causas: [{dimension, miembros, peso}] }
 */
function explicar({ total, dimensiones = {} }) {
  const a = total.ahora, b = total.antes;
  const delta = a.ventas - b.ventas;
  const pct = b.ventas > 0 ? Math.round((a.ventas / b.ventas - 1) * 100) : null;
  const promA = a.tickets ? a.ventas / a.tickets : 0;
  const promB = b.tickets ? b.ventas / b.tickets : 0;
  const porTickets = (a.tickets - b.tickets) * promB;
  const porPromedio = a.tickets * (promA - promB);
  const causas = Object.entries(dimensiones)
    .map(([dim, { ahora, antes }]) => concentracion(dim, diferencias(ahora, antes), delta))
    .filter((c) => c && c.peso >= 0.2)
    .sort((x, y) => y.peso - x.peso);
  return { delta, pct, ticketsAhora: a.tickets, ticketsAntes: b.tickets, promAhora: promA, promAntes: promB, porTickets, porPromedio, causas };
}

module.exports = { explicar, diferencias, concentracion };
