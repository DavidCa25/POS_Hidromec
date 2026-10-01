/**
 * IPC de EGRESOS y PAGOS AL PERSONAL.
 *
 * Mismo criterio que electron/ipc/servicios.js: aqui no hay reglas de
 * negocio. Si un egreso en efectivo necesita turno, de que caja sale, que un
 * pago al personal exige a la persona y el periodo: todo eso lo decide SQL
 * (sp_register_expense y compania). Cada handler traduce el payload y ejecuta
 * su procedure.
 *
 * QUIEN REGISTRA ES LA SESION
 * ---------------------------
 * El `user_id` que se guarda como "quien lo registro" sale de la sesion que
 * autorizo la llamada, nunca del payload: la pantalla no puede decir que lo
 * registro otra persona.
 *
 * LA CAJA ES LA DE ESTE EQUIPO
 * ----------------------------
 * Para un egreso en efectivo se manda la caja que diga la pantalla o, si no,
 * la de este equipo (su device-config), mas la identidad del equipo. SQL
 * (sp_resolve_cash_register) valida que esa caja sea de este equipo en
 * MultiCaja. Nunca "la primera caja de la tabla".
 */
const sesion = require('../seguridad/sesion');

async function ejecutar(pool, nombre, construir) {
  try {
    const req = (await pool).request();
    if (construir) construir(req);
    const r = await req.execute(nombre);
    return { success: true, data: r.recordset ?? [], sets: r.recordsets ?? [] };
  } catch (e) {
    const msg = String(e.message || e);
    console.error(`[EGRESOS] ${nombre}:`, msg);
    return { success: false, error: msg };
  }
}

/**
 * @param {object} deps
 * @param {() => number|null} deps.cajaDeEsteEquipo   caja del device-config
 * @param {() => {machineId: string, machineName: string}} deps.identidad
 */
function registrar({ ipcMain, sql, poolPromise, cajaDeEsteEquipo, identidad }) {
  const txt = (v, n = 255) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const fecha = (v) => (v ? String(v).slice(0, 10) : null);   // 'AAAA-MM-DD'; SQL la toma como DATE
  const quien = (ses) => Number(ses?.userId) || null;
  const caja = (p) => num(p?.register_id) ?? (() => { try { return num(cajaDeEsteEquipo()); } catch { return null; } })();
  const equipo = () => { try { return identidad() || {}; } catch { return {}; } };

  // ------------------------------------------------------------ conceptos
  ipcMain.handle('egresos:conceptos', sesion.proteger('egresos:conceptos', async (_e, p = {}) =>
    ejecutar(poolPromise, 'sp_expense_category_list', (r) => {
      r.input('include_inactive', sql.Bit, p?.include_inactive ? 1 : 0);
    })));

  ipcMain.handle('egresos:concepto-guardar', sesion.proteger('egresos:concepto-guardar', async (_e, p = {}) =>
    ejecutar(poolPromise, 'sp_expense_category_save', (r) => {
      r.input('id', sql.Int, num(p?.id))
       .input('name', sql.NVarChar(60), txt(p?.name, 60))
       .input('active', sql.Bit, p?.active === false || p?.active === 0 ? 0 : 1)
       .input('sort_order', sql.Int, num(p?.sort_order));
    })));

  ipcMain.handle('egresos:concepto-mover', sesion.proteger('egresos:concepto-mover', async (_e, p = {}) =>
    ejecutar(poolPromise, 'sp_expense_category_move', (r) => {
      r.input('id', sql.Int, num(p?.id))
       .input('direction', sql.Int, Number(p?.direction) < 0 ? -1 : 1);
    })));

  // --------------------------------------------------------------- personal
  ipcMain.handle('egresos:personal', sesion.proteger('egresos:personal', async () =>
    ejecutar(poolPromise, 'sp_expense_staff_list')));

  // --------------------------------------------------------------- egresos
  ipcMain.handle('egresos:registrar', sesion.proteger('egresos:registrar', async (_e, p = {}, ...resto) => {
    const ses = resto.length ? resto[resto.length - 1] : null;
    const eq = equipo();
    return ejecutar(poolPromise, 'sp_register_expense', (r) => {
      r.input('user_id', sql.Int, quien(ses))
       .input('category_id', sql.Int, num(p?.category_id))
       .input('amount', sql.Decimal(12, 2), num(p?.amount))
       .input('payment_method', sql.VarChar(20), txt(p?.payment_method, 20))
       .input('expense_date', sql.Date, fecha(p?.expense_date))
       .input('note', sql.NVarChar(255), txt(p?.note))
       .input('beneficiary', sql.NVarChar(120), txt(p?.beneficiary, 120))
       .input('staff_user_id', sql.Int, num(p?.staff_user_id))
       .input('period_kind', sql.VarChar(10), txt(p?.period_kind, 10))
       .input('period_from', sql.Date, fecha(p?.period_from))
       .input('period_to', sql.Date, fecha(p?.period_to))
       .input('register_id', sql.Int, caja(p))
       .input('machine_id', sql.NVarChar(64), eq.machineId || null)
       .input('machine_name', sql.NVarChar(120), eq.machineName || null);
    });
  }));

  ipcMain.handle('egresos:cancelar', sesion.proteger('egresos:cancelar', async (_e, p = {}, ...resto) => {
    const ses = resto.length ? resto[resto.length - 1] : null;
    return ejecutar(poolPromise, 'sp_void_expense', (r) => {
      r.input('expense_id', sql.Int, num(p?.expense_id))
       .input('user_id', sql.Int, quien(ses))
       .input('reason', sql.NVarChar(200), txt(p?.reason, 200));
    });
  }));

  ipcMain.handle('egresos:listar', sesion.proteger('egresos:listar', async (_e, p = {}) => {
    const r = await ejecutar(poolPromise, 'sp_get_expenses', (q) => {
      q.input('date_from', sql.Date, fecha(p?.date_from))
       .input('date_to', sql.Date, fecha(p?.date_to))
       .input('category_id', sql.Int, num(p?.category_id))
       .input('payment_method', sql.VarChar(20), txt(p?.payment_method, 20))
       .input('staff_user_id', sql.Int, num(p?.staff_user_id))
       .input('only_staff', sql.Bit, p?.only_staff ? 1 : 0)
       .input('register_id', sql.Int, num(p?.register_id))
       .input('include_voided', sql.Bit, p?.include_voided ? 1 : 0);
    });
    if (!r.success) return r;
    const s = r.sets;
    return {
      success: true,
      data: {
        filas: s[0] ?? [],
        porConcepto: s[1] ?? [],
        porPersona: s[2] ?? [],
        porForma: s[3] ?? [],
        total: (s[4] ?? [])[0] ?? { total: 0, del_cajon: 0, egresos: 0 },
      },
    };
  }));
}

module.exports = { registrar };
