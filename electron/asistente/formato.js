'use strict';
/** Cómo dice Wybix los números: igual en todas las plantillas. */

const mx = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

const dinero = (n) => mx.format(Number(n) || 0);

const UNIDADES = { pza: ['pieza', 'piezas'], g: ['g', 'g'], kg: ['kg', 'kg'], ml: ['ml', 'ml'], l: ['L', 'L'], L: ['L', 'L'] };
/** «4 L», «6 piezas», «1 pieza». Gramos y mililitros grandes se suben a kg y L. */
function cant(n, uom = 'pza') {
  let v = Number(n) || 0;
  let u = String(uom || 'pza');
  if (u === 'g' && Math.abs(v) >= 1000) { v /= 1000; u = 'kg'; }
  if (u === 'ml' && Math.abs(v) >= 1000) { v /= 1000; u = 'l'; }
  const [uno, varios] = UNIDADES[u] || [u, u];
  return `${num.format(v)} ${Math.abs(v) === 1 ? uno : varios}`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}
/** «2026-11»: periodo mensual para la clave de un hallazgo agregado. */
const mes = (ms) => new Date(ms).toISOString().slice(0, 7);

module.exports = { dinero, cant, fechaCorta, mes, num: (n) => num.format(Number(n) || 0) };
