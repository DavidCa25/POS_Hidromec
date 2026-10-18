/**
 * PRODUCCIÓN POR TANDAS (0060).
 *
 * Lo que se fabrica antes de venderse (donas, pan): un producto DIRECT con su
 * fórmula. Las tandas pasan por planeada -> en preparación -> lista, y los
 * ingredientes salen AL EMPEZAR, no al vender. Las reglas viven en SQL
 * (sp_production_*); aquí solo se traduce el payload y se pone el actor.
 *
 * Quién es quién lo dice la SESIÓN, nunca el payload: `user_id` se toma de
 * sesion.actorDe(ses).
 *
 * Permisos (seguridad/canales.js):
 *   tablero, planear, empezar, terminar, cancelar,
 *   merma de producto terminado                     PRODUCCION_OPERAR
 *   fórmulas                                         CATALOGO_EDITAR
 */
const os = require('os');
const sesion = require('../seguridad/sesion');

/** Un mensaje de SQL (los nuestros, >= 50000) llega tal cual; lo demás no. */
function paraElUsuario(e, queSeIntentaba) {
  const n = Number(e?.number ?? e?.originalError?.info?.number);
  if (Number.isFinite(n) && n >= 50000) return e.message;
  return `No se pudo ${queSeIntentaba}. Vuelve a intentarlo y, si sigue, avisa a soporte con la hora.`;
}

function registrar({ ipcMain, sql, poolPromise }) {
  const pool = () => poolPromise;
  const maquina = () => { try { return os.hostname().slice(0, 120); } catch { return null; } };

  async function correr(queSeIntentaba, fn) {
    try { return { success: true, data: await fn(await pool()) }; }
    catch (e) {
      console.error(`[PRODUCCION] ${queSeIntentaba}:`, e.message);
      return { success: false, error: paraElUsuario(e, queSeIntentaba) };
    }
  }
  const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  /* ------------------------------------------------------------- tablero */
  ipcMain.handle('produccion:tablero', sesion.proteger('produccion:tablero', async (_e, p = {}) =>
    correr('leer la produccion', async (db) => {
      const r = await db.request()
        .input('production_date', sql.Date, p.fecha ? new Date(`${p.fecha}T12:00:00`) : null)
        .execute('sp_production_board');
      const [tandas = [], ingredientes = [], productos = []] = r.recordsets || [];
      return { tandas, ingredientes, productos };
    })));

  /* --------------------------------------------------------------- tandas */
  ipcMain.handle('produccion:planear', sesion.proteger('produccion:planear', async (_e, p = {}, ses) =>
    correr('planear la tanda', async (db) => {
      const r = await db.request()
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .input('product_id', sql.Int, numero(p.productId))
        .input('planned_qty', sql.Decimal(12, 2), numero(p.cantidad))
        .input('note', sql.NVarChar(255), p.nota ? String(p.nota).slice(0, 255) : null)
        .input('machine_name', sql.NVarChar(120), maquina())
        .input('uuid', sql.UniqueIdentifier, p.uuid || null)
        .input('batch_id', sql.Int, numero(p.batchId))
        .execute('sp_production_plan');
      return r.recordset?.[0] ?? null;
    })));

  ipcMain.handle('produccion:empezar', sesion.proteger('produccion:empezar', async (_e, p = {}, ses) =>
    correr('empezar la tanda', async (db) => {
      const r = await db.request()
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .input('batch_id', sql.Int, numero(p.batchId))
        .input('machine_name', sql.NVarChar(120), maquina())
        .execute('sp_production_start');
      return r.recordset?.[0] ?? null;
    })));

  ipcMain.handle('produccion:terminar', sesion.proteger('produccion:terminar', async (_e, p = {}, ses) =>
    correr('registrar la tanda', async (db) => {
      const r = await db.request()
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .input('batch_id', sql.Int, numero(p.batchId))
        .input('good_qty', sql.Decimal(12, 2), numero(p.buenas))
        .input('waste_reason', sql.NVarChar(40), p.motivo ? String(p.motivo).slice(0, 40) : null)
        .execute('sp_production_finish');
      return r.recordset?.[0] ?? null;
    })));

  ipcMain.handle('produccion:cancelar', sesion.proteger('produccion:cancelar', async (_e, p = {}, ses) =>
    correr('cancelar la tanda', async (db) => {
      const r = await db.request()
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .input('batch_id', sql.Int, numero(p.batchId))
        .execute('sp_production_cancel');
      return r.recordset?.[0] ?? null;
    })));

  /* Merma de producto TERMINADO (lo que se tiró al cierre). */
  ipcMain.handle('produccion:merma', sesion.proteger('produccion:merma', async (_e, p = {}, ses) =>
    correr('registrar la merma', async (db) => {
      const r = await db.request()
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .input('product_id', sql.Int, numero(p.productId))
        .input('qty', sql.Decimal(12, 2), numero(p.cantidad))
        .input('reason', sql.NVarChar(40), p.motivo ? String(p.motivo).slice(0, 40) : null)
        .input('machine_name', sql.NVarChar(120), maquina())
        .input('uuid', sql.UniqueIdentifier, p.uuid || null)
        .execute('sp_production_waste');
      return r.recordset?.[0] ?? null;
    })));

  /* ------------------------------------------------------------- fórmulas */
  ipcMain.handle('produccion:formula', sesion.proteger('produccion:formula', async (_e, p = {}) =>
    correr('leer la formula', async (db) => {
      const r = await db.request().input('product_id', sql.Int, numero(p.productId)).execute('sp_production_formula_get');
      const [cab = [], lineas = []] = r.recordsets || [];
      return { cabecera: cab[0] ?? null, lineas };
    })));

  ipcMain.handle('produccion:formula-guardar', sesion.proteger('produccion:formula-guardar', async (_e, p = {}, ses) =>
    correr('guardar la formula', async (db) => {
      const tvp = new sql.Table('dbo.RecipeLineType');
      tvp.columns.add('ingredient_product_id', sql.Int, { nullable: false });
      tvp.columns.add('input_qty', sql.Decimal(12, 3), { nullable: false });
      tvp.columns.add('input_uom', sql.NVarChar(10), { nullable: false });
      tvp.columns.add('waste_pct', sql.Decimal(5, 2), { nullable: true });
      tvp.columns.add('sort_order', sql.Int, { nullable: true });
      (Array.isArray(p.lineas) ? p.lineas : []).forEach((l, i) => tvp.rows.add(
        numero(l.ingredientProductId), numero(l.inputQty), String(l.inputUom || ''), numero(l.wastePct) ?? 0, i + 1));
      const r = await db.request()
        .input('product_id', sql.Int, numero(p.productId))
        .input('yield_qty', sql.Decimal(12, 2), numero(p.rinde))
        .input('notes', sql.NVarChar(300), p.notas ? String(p.notas).slice(0, 300) : null)
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .input('Lines', tvp)
        .execute('sp_production_formula_save');
      return r.recordset?.[0] ?? null;
    })));

  ipcMain.handle('produccion:formula-quitar', sesion.proteger('produccion:formula-quitar', async (_e, p = {}) =>
    correr('quitar la formula', async (db) => {
      const r = await db.request().input('product_id', sql.Int, numero(p.productId)).execute('sp_production_formula_delete');
      return r.recordset?.[0] ?? null;
    })));
}

module.exports = { registrar };
