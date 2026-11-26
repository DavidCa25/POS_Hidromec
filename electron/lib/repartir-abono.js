/**
 * REPARTIR UN ABONO ENTRE LAS VENTAS A CRÉDITO DE UN CLIENTE.
 *
 * El cliente debe $2,000 en varias notas y trae $800: el abono liquida
 * completas las notas que alcanza, en el orden en que llegan (lo más vencido
 * primero, el mismo orden de sp_get_customer_open_credit_sales), y lo que
 * sobra se abona a la siguiente, que queda con su faltante.
 *
 * Se cuenta en centavos enteros: 0.1 + 0.2 no debe dejar una nota con
 * $0.0000001 de saldo.
 *
 * Función pura: la usa el proceso principal para aplicar y la prueba
 * scripts/pruebas/repartir-abono.test.mjs. La pantalla hace la misma cuenta
 * para la vista previa; la que vale es esta.
 */
'use strict';

const centavos = (n) => Math.round(Number(n) * 100);

/**
 * @param {Array<{id:number, balance:number}>} ventas  en orden de cobro
 * @param {number} monto
 * @returns {{ partidas: Array<{sale_id:number, saldo:number, abono:number, queda:number, liquidada:boolean}>,
 *            aplicado:number, sobrante:number }}
 */
function repartirAbono(ventas, monto) {
  let resta = centavos(monto);
  if (!Number.isFinite(resta) || resta <= 0) throw new Error('El monto del abono debe ser mayor a 0.');
  const partidas = [];
  for (const v of ventas || []) {
    if (resta <= 0) break;
    const saldo = centavos(v.balance);
    if (!(saldo > 0)) continue;
    const abono = Math.min(saldo, resta);
    resta -= abono;
    partidas.push({ sale_id: Number(v.id), saldo: saldo / 100, abono: abono / 100, queda: (saldo - abono) / 100, liquidada: abono === saldo });
  }
  const aplicado = partidas.reduce((s, p) => s + centavos(p.abono), 0) / 100;
  return { partidas, aplicado, sobrante: resta / 100 };
}

module.exports = { repartirAbono };
