/*
 * IMPUESTOS ADEMÁS DEL IVA (0083): IEPS por tasa o por cuota, e impuestos
 * locales (hospedaje).
 *
 *   impuestos:listar                 el catálogo ({ todos: true } incluye los apagados)
 *   impuestos:guardar                crear o corregir uno (Configuración → Impuestos)
 *   producto:impuestos               los que lleva un producto
 *   producto:impuestos-guardar       reemplazar los de un producto
 *
 * El cálculo NO pasa por aquí: lo hace sp_venta_impuestos dentro de la
 * transacción de la venta. Las reglas viven en SQL.
 */
const sesion = require('../seguridad/sesion');

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const texto = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

function registrar({ ipcMain, sql, poolPromise }) {
  const fallo = (donde, e) => {
    const msg = String(e?.message || e);
    console.error(`[IMPUESTOS] ${donde}:`, msg);
    return { success: false, error: msg };
  };

  ipcMain.handle('impuestos:listar', async (_e, p = {}) => {
    try {
      const r = await (await poolPromise).request().input('todos', sql.Bit, p?.todos ? 1 : 0).execute('sp_impuestos_listar');
      return { success: true, data: r.recordset || [] };
    } catch (e) { return fallo('listar', e); }
  });

  ipcMain.handle('impuestos:guardar', sesion.proteger('impuestos:guardar', async (_e, p = {}) => {
    try {
      const r = await (await poolPromise).request()
        .input('id', sql.Int, num(p.id))
        .input('nombre', sql.NVarChar(80), texto(p.nombre, 80) || '')
        .input('clase', sql.VarChar(10), p.clase === 'LOCAL' ? 'LOCAL' : 'IEPS')
        .input('factor', sql.VarChar(6), p.factor === 'Cuota' ? 'Cuota' : 'Tasa')
        .input('tasa', sql.Decimal(9, 6), num(p.tasa))
        .input('cuota', sql.Decimal(12, 4), num(p.cuota))
        .input('unidad', sql.NVarChar(20), texto(p.unidad, 20))
        .input('en_base_iva', sql.Bit, p.enBaseIva == null ? null : (p.enBaseIva ? 1 : 0))
        .input('nota', sql.NVarChar(200), texto(p.nota, 200))
        .input('activo', sql.Bit, p.activo === false ? 0 : 1)
        .execute('sp_impuesto_guardar');
      return { success: true, data: { id: r.recordset?.[0]?.id ?? null } };
    } catch (e) { return fallo('guardar', e); }
  }));

  ipcMain.handle('producto:impuestos', async (_e, p = {}) => {
    try {
      const r = await (await poolPromise).request().input('product_id', sql.Int, num(p.productId)).execute('sp_producto_impuestos_get');
      return { success: true, data: r.recordset || [] };
    } catch (e) { return fallo('producto', e); }
  });

  ipcMain.handle('producto:impuestos-guardar', sesion.proteger('producto:impuestos-guardar', async (_e, p = {}) => {
    try {
      const lista = (Array.isArray(p.impuestos) ? p.impuestos : [])
        .map((x) => ({ id: num(x?.id), cantidad: num(x?.cantidad) }))
        .filter((x) => x.id);
      const r = await (await poolPromise).request()
        .input('product_id', sql.Int, num(p.productId))
        .input('impuestos', sql.NVarChar(sql.MAX), JSON.stringify(lista))
        .execute('sp_producto_impuestos_guardar');
      return { success: true, data: r.recordset || [] };
    } catch (e) { return fallo('producto-guardar', e); }
  }));
}

module.exports = { registrar };
