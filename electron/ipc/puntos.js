/*
 * PUNTOS Y SELLOS (0064).
 *
 *   puntos:estado            saldo, tarjetas y catálogo de canje del cliente elegido (VENTAS_OPERAR)
 *   puntos:admin             Fidelización > Puntos: configuración, indicadores, tarjetas,
 *                            recompensas y clientes (REPORTES_VER)
 *   puntos:historial         movimientos de un cliente (REPORTES_VER)
 *   puntos:config-guardar    cómo se ganan (COMERCIAL_ADMINISTRAR)
 *   puntos:tarjeta-guardar   alta/cambio de una tarjeta de sellos (COMERCIAL_ADMINISTRAR)
 *   puntos:costo             costo en puntos de una recompensa (COMERCIAL_ADMINISTRAR)
 *   puntos:ajustar           sumar o restar a un cliente, con motivo (VENTAS_SUPERVISAR)
 *
 * Ganar, canjear y revertir NO pasan por aquí: son la venta
 * (sp_loyalty_evaluate_sale, sp_register_sale) y la devolución (sp_refund_sale).
 */
const sesion = require("../seguridad/sesion");

function registrar({ ipcMain, sql, poolPromise, cloudSync }) {
  const pool = () => poolPromise;
  const fallo = (e) => ({ success: false, error: String(e?.message || e) });
  const entero = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
  const json = (v) => { try { return v ? JSON.parse(v) : []; } catch { return []; } };

  ipcMain.handle("puntos:estado", sesion.proteger("puntos:estado", async (_e, p = {}) => {
    try {
      const id = entero(p.customerId);
      if (!id) return { success: true, data: null };
      const r = await (await pool()).request().input("customer_id", sql.Int, id).execute("sp_loyalty_customer_status");
      const [[resumen] = [], tarjetas = [], productos = [], recompensas = []] = r.recordsets;
      return { success: true, data: { resumen: resumen ?? null, tarjetas, productos, recompensas } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("puntos:admin", sesion.proteger("puntos:admin", async (_e, p = {}) => {
    try {
      const r = await (await pool()).request()
        .input("buscar", sql.NVarChar(80), p.buscar ? String(p.buscar).slice(0, 80) : null)
        .execute("sp_loyalty_points_admin");
      const [[config] = [], [resumen] = [], tarjetas = [], recompensas = [], clientes = []] = r.recordsets;
      return {
        success: true,
        data: {
          config: config ?? null, resumen: resumen ?? null, recompensas,
          tarjetas: tarjetas.map((t) => ({ ...t, productos: json(t.productos_json) })),
          clientes: clientes.map((c) => ({ ...c, sellos: json(c.sellos_json) })),
        },
      };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("puntos:historial", sesion.proteger("puntos:historial", async (_e, p = {}) => {
    try {
      const id = entero(p.customerId);
      if (!id) throw Error("Elige un cliente.");
      const r = await (await pool()).request().input("customer_id", sql.Int, id).execute("sp_loyalty_points_ledger");
      return { success: true, data: r.recordset ?? [] };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("puntos:config-guardar", sesion.proteger("puntos:config-guardar", async (_e, p = {}) => {
    try {
      await (await pool()).request()
        .input("enabled", sql.Bit, p.activo ? 1 : 0)
        .input("per_amount", sql.Decimal(12, 2), Number(p.cadaMonto) > 0 ? Number(p.cadaMonto) : null)
        .input("points_per", sql.Int, entero(p.puntos) ?? 1)
        .input("visit_points", sql.Int, Math.max(0, Math.trunc(Number(p.porVisita) || 0)))
        .input("expiry_months", sql.Int, entero(p.caducaMeses))
        .execute("sp_loyalty_points_config_save");
      cloudSync.hechosAhora?.();
      return { success: true };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("puntos:tarjeta-guardar", sesion.proteger("puntos:tarjeta-guardar", async (_e, p = {}) => {
    try {
      const productos = Array.isArray(p.productos) ? p.productos.map(Number).filter((x) => Number.isSafeInteger(x) && x > 0).slice(0, 200) : [];
      const r = await (await pool()).request()
        .input("id", sql.Int, entero(p.id))
        .input("name", sql.NVarChar(80), String(p.nombre ?? "").slice(0, 80))
        .input("stamps_required", sql.Int, Math.trunc(Number(p.sellos) || 0))
        .input("reward_product_id", sql.Int, entero(p.productoPremio))
        .input("active", sql.Bit, p.activo === false ? 0 : 1)
        .input("products_json", sql.NVarChar(sql.MAX), JSON.stringify(productos))
        .execute("sp_loyalty_stamp_card_save");
      cloudSync.hechosAhora?.();
      return { success: true, data: { id: r.recordset?.[0]?.id ?? null } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("puntos:costo", sesion.proteger("puntos:costo", async (_e, p = {}) => {
    try {
      await (await pool()).request()
        .input("accion", sql.VarChar(10), "COSTO")
        .input("id", sql.Int, entero(p.recompensaId))
        .input("valor", sql.Int, entero(p.costo))
        .execute("sp_loyalty_points_manage");
      return { success: true };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("puntos:ajustar", sesion.proteger("puntos:ajustar", async (_e, p = {}, ses) => {
    try {
      await (await pool()).request()
        .input("accion", sql.VarChar(10), "AJUSTE")
        .input("id", sql.Int, entero(p.customerId))
        .input("valor", sql.Int, Math.trunc(Number(p.cantidad) || 0))
        .input("card_id", sql.Int, entero(p.tarjetaId))
        .input("nota", sql.NVarChar(200), p.nota ? String(p.nota).slice(0, 200) : null)
        .input("user_id", sql.Int, sesion.actorDe(ses))
        .execute("sp_loyalty_points_manage");
      cloudSync.hechosAhora?.();
      return { success: true };
    } catch (e) { return fallo(e); }
  }));
}

module.exports = { registrar };
