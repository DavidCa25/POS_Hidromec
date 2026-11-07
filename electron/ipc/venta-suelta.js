/*
 * VENTA SUELTA (0073): vender por pieza lo que se compra en paquete.
 *
 *   venta-suelta:get       de que paquete sale un producto, o que sueltos
 *                          salen de el
 *   venta-suelta:guardar   ligarlo a su paquete (o desligarlo con
 *                          parentProductId null)
 *
 * El descuento -abrir paquetes cuando faltan piezas- no pasa por aqui: lo
 * hace sp_register_sale dentro de la misma transaccion de la venta. Las
 * reglas viven en SQL.
 */
const sesion = require("../seguridad/sesion");

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function registrar({ ipcMain, sql, poolPromise }) {
  const formar = (r) => ({
    paquete: r.recordsets?.[0]?.[0] ?? null,
    sueltos: r.recordsets?.[1] ?? [],
  });

  ipcMain.handle("venta-suelta:get", async (_e, p = {}) => {
    try {
      const r = await (await poolPromise).request()
        .input("product_id", sql.Int, num(p.productId))
        .execute("sp_venta_suelta_get");
      return { success: true, data: formar(r) };
    } catch (e) {
      return { success: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle("venta-suelta:guardar", sesion.proteger("venta-suelta:guardar", async (_e, p = {}, s) => {
    try {
      const r = await (await poolPromise).request()
        .input("product_id", sql.Int, num(p.productId))
        .input("parent_product_id", sql.Int, num(p.parentProductId))
        .input("piezas", sql.Int, num(p.piezas))
        .input("user_id", sql.Int, Number(s?.userId) || null)
        .execute("sp_venta_suelta_guardar");
      return { success: true, data: formar(r) };
    } catch (e) {
      const msg = String(e.message || e);
      console.error("[VENTA SUELTA] guardar:", msg);
      return { success: false, error: msg };
    }
  }));
}

module.exports = { registrar };
