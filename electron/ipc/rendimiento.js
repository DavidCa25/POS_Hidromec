/**
 * CARNE POR RENDIMIENTO (0095) — taquería sin recetas.
 *
 * El taquero dice cuántos tacos le salen por kilo de cada carne y, al cerrar,
 * cuánta le quedó. Wybix calcula cuánto rindió y cuánta carne se fue sin
 * cobrarse. Las reglas viven en SQL (sp_rendimiento_*); aquí solo se traduce
 * el payload y se pone el actor, que lo dice la SESIÓN, nunca el payload.
 *
 * La compra («Llegó la carne») no tiene canal propio: es una compra normal
 * (`sp-register-purchase`) con la presentación Kilo de cada carne.
 *
 * Permisos (seguridad/canales.js):
 *   config, cierre, contar, dia     VENTAS_OPERAR     (lo usa el corte)
 *   guardar, ajustar                CATALOGO_EDITAR   (crea insumos)
 *   mes                             REPORTES_VER
 */
const sesion = require('../seguridad/sesion');

/** Un mensaje de SQL (los nuestros, >= 50000) llega tal cual; lo demás no. */
function paraElUsuario(e, queSeIntentaba) {
  const n = Number(e?.number ?? e?.originalError?.info?.number);
  if (Number.isFinite(n) && n >= 50000) return e.message;
  return `No se pudo ${queSeIntentaba}. Vuelve a intentarlo y, si sigue, avisa a soporte con la hora.`;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const num = (fila) => {
  const o = {};
  for (const [k, v] of Object.entries(fila || {})) o[k] = typeof v === 'number' || v == null || typeof v === 'boolean' || v instanceof Date ? v
    : (/^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v);
  return o;
};

function registrar({ ipcMain, sql, poolPromise }) {
  async function correr(queSeIntentaba, fn) {
    try { return { success: true, data: await fn(await poolPromise) }; }
    catch (e) {
      console.error(`[RENDIMIENTO] ${queSeIntentaba}:`, e.message);
      return { success: false, error: paraElUsuario(e, queSeIntentaba) };
    }
  }
  const config = (r) => {
    const sets = r.recordsets || [];
    const [carnes = [], platillos = []] = sets.slice(-2);
    return { carnes: carnes.map(num), platillos: platillos.map(num) };
  };
  const dia = (r) => {
    const sets = r.recordsets || [];
    const [filas = [], sugerencias = []] = sets.slice(-2);
    return { carnes: filas.map(num), sugerencias: sugerencias.map(num) };
  };

  ipcMain.handle('rendimiento:config', sesion.proteger('rendimiento:config', async () =>
    correr('leer las carnes', async (db) => config(await db.request().execute('sp_rendimiento_config')))));

  ipcMain.handle('rendimiento:guardar', sesion.proteger('rendimiento:guardar', async (_e, p = {}, ses) =>
    correr('guardar las carnes', async (db) => {
      const carnes = (Array.isArray(p.carnes) ? p.carnes : []).slice(0, 30).map((c) => ({
        clave: String(c.clave ?? '').slice(0, 40), nombre: String(c.nombre ?? '').slice(0, 100),
        rinde: numero(c.rinde), activo: c.activo !== false,
      }));
      if (!carnes.length) throw Object.assign(new Error('Elige al menos una carne.'), { number: 50000 });
      return config(await db.request()
        .input('carnes', sql.NVarChar(sql.MAX), JSON.stringify(carnes))
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .execute('sp_rendimiento_guardar'));
    })));

  ipcMain.handle('rendimiento:cierre', sesion.proteger('rendimiento:cierre', async (_e, p = {}) =>
    correr('leer la carne del corte', async (db) => {
      const r = await db.request().input('closure_id', sql.Int, numero(p.closureId)).execute('sp_rendimiento_cierre');
      return (r.recordsets?.[r.recordsets.length - 1] || []).map(num);
    })));

  ipcMain.handle('rendimiento:contar', sesion.proteger('rendimiento:contar', async (_e, p = {}, ses) =>
    correr('guardar la carne que quedó', async (db) => {
      const conteos = (Array.isArray(p.conteos) ? p.conteos : [])
        .map((c) => ({ carne_id: numero(c.carneId ?? c.carne_id), quedo_kg: numero(c.quedoKg ?? c.quedo_kg) }))
        .filter((c) => c.carne_id && c.quedo_kg != null);
      return dia(await db.request()
        .input('closure_id', sql.Int, numero(p.closureId))
        .input('user_id', sql.Int, sesion.actorDe(ses))
        .input('conteos', sql.NVarChar(sql.MAX), JSON.stringify(conteos))
        .execute('sp_rendimiento_contar'));
    })));

  ipcMain.handle('rendimiento:dia', sesion.proteger('rendimiento:dia', async (_e, p = {}) =>
    correr('leer cómo rindió la carne', async (db) =>
      dia(await db.request().input('closure_id', sql.Int, numero(p.closureId)).execute('sp_rendimiento_dia')))));

  ipcMain.handle('rendimiento:ajustar', sesion.proteger('rendimiento:ajustar', async (_e, p = {}) =>
    correr('ajustar el rendimiento', async (db) => {
      const r = await db.request()
        .input('carne_id', sql.Int, numero(p.carneId))
        .input('rinde', sql.Decimal(6, 2), numero(p.rinde))
        .execute('sp_rendimiento_ajustar');
      return num(r.recordset?.[0]);
    })));

  ipcMain.handle('rendimiento:mes', sesion.proteger('rendimiento:mes', async (_e, p = {}) =>
    correr('leer el reporte de carne', async (db) => {
      const desde = p.desde ? String(p.desde) : null, hasta = p.hasta ? String(p.hasta) : null;
      if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) throw Object.assign(new Error('Indica fechas válidas.'), { number: 50000 });
      const r = await db.request()
        .input('desde', sql.Date, desde ? new Date(`${desde}T12:00:00`) : null)
        .input('hasta', sql.Date, hasta ? new Date(`${hasta}T12:00:00`) : null)
        .execute('sp_rendimiento_mes');
      const [resumen = [], dias = [], carnes = []] = r.recordsets || [];
      return {
        actual: num(resumen.find((x) => x.periodo === 'ACTUAL')),
        anterior: num(resumen.find((x) => x.periodo === 'ANTERIOR')),
        dias: dias.map(num), carnes: carnes.map(num),
      };
    })));
}

module.exports = { registrar };
