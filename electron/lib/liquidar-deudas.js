/**
 * LIQUIDAR DEUDAS CON UN ABONO, en la base.
 *
 * Un solo monto se reparte entre las ventas a crédito del cliente, de la más
 * vencida a la más nueva (repartir-abono.js): liquida las que alcanza y la
 * siguiente queda con su faltante. Cada parte es un
 * sp_register_customer_payment, todas en UNA transacción: o se aplica el
 * reparto completo o no se aplica nada.
 *
 * El reparto se calcula aquí con los saldos de la base, nunca con los que
 * mandó la pantalla. Vive fuera de main.js para que la prueba
 * scripts/db/pruebas/liquidar-deudas.mjs lo corra contra SQL Server de verdad.
 */
'use strict';

const { repartirAbono } = require('./repartir-abono');

/**
 * @param {{ pool:any, sql:any }} db
 * @param {{ customerId:number, monto:number, metodo?:string, nota?:string|null, quien:number|null,
 *           op:{ registerId:number|null, machineId:string|null, machineName:string|null } }} p
 */
async function liquidarDeudas({ pool, sql }, p) {
  const customerId = Number(p.customerId);
  const monto = Number(p.monto);
  if (!Number.isInteger(customerId) || customerId <= 0) return { success: false, error: 'Cliente inválido.' };
  if (!Number.isFinite(monto) || monto <= 0) return { success: false, error: 'El monto del abono debe ser mayor a 0.' };
  const metodo = String(p.metodo || 'EFECTIVO');
  const nota = p.nota ? String(p.nota).slice(0, 200) : null;
  const op = p.op || {};
  let tx = null;
  try {
    tx = new sql.Transaction(pool);
    await tx.begin();
    const abiertas = await new sql.Request(tx).input('customer_id', sql.Int, customerId).execute('sp_get_customer_open_credit_sales');
    const ventas = (abiertas.recordset || []).map((r) => ({ id: r.id, balance: Number(r.balance) }));
    if (!ventas.length) { await tx.rollback(); return { success: false, error: 'El cliente no tiene ventas a crédito con saldo.' }; }
    const reparto = repartirAbono(ventas, monto);
    if (reparto.sobrante > 0) {
      await tx.rollback();
      return { success: false, error: `El abono es mayor a la deuda: el cliente debe $${reparto.aplicado.toFixed(2)}.` };
    }
    for (const parte of reparto.partidas) {
      await new sql.Request(tx)
        .input('customer_id',    sql.Int,           customerId)
        .input('sale_id',        sql.Int,           parte.sale_id)
        .input('amount',         sql.Decimal(10,2), parte.abono)
        .input('user_id',        sql.Int,           p.quien ?? null)
        .input('payment_method', sql.NVarChar(50),  metodo)
        .input('note',           sql.NVarChar(255), nota ? `${nota} · liquidación` : 'Liquidación de deudas')
        .input('register_id',    sql.Int,           op.registerId ?? null)
        .input('machine_id',     sql.NVarChar(64),  op.machineId ?? null)
        .input('machine_name',   sql.NVarChar(120), op.machineName ?? null)
        .execute('sp_register_customer_payment');
    }
    await tx.commit();
    return { success: true, data: reparto };
  } catch (err) {
    /* El procedimiento hace ROLLBACK en su CATCH: la transacción puede ya no existir. */
    if (tx) await tx.rollback().catch(() => {});
    return { success: false, error: err.message };
  }
}

module.exports = { liquidarDeudas };
