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
function registrar({ ipcMain, sql, poolPromise, cajaDeEsteEquipo, identidad, alSacarEfectivo = async () => null }) {
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
  /**
   * ¿Cuánto hay en el cajón de esa caja? Fondo + movimientos del turno
   * abierto, con la misma regla que sp_close_shift. null sin turno o sin caja.
   */
  async function enElCajon(registerId) {
    if (!registerId) return null;
    const r = await (await poolPromise).request().input('caja', sql.Int, registerId).query(`
      SELECT TOP 1 c.opening_cash + (SELECT ISNULL(SUM(CASE WHEN m.typee = 'OPENING' THEN 0 ELSE m.amount END), 0)
                                       FROM dbo.cash_movements m
                                      WHERE m.closure_id = c.id OR (m.closure_id IS NULL AND m.register_id = c.register_id AND m.datee >= c.opened_at)) AS efectivo
        FROM dbo.cash_closures c WHERE c.closed_at IS NULL AND c.register_id = @caja ORDER BY c.opened_at DESC;`);
    const v = r.recordset?.[0]?.efectivo;
    return v == null ? null : Number(v);
  }
  const CUBRIR = { PRESTAMO: 'Préstamo', DUENO: 'Dinero del dueño', OTRO: 'Otra entrada' };

  /*
   * 0096 · CUANDO EL CAJÓN NO ALCANZA. Un gasto en efectivo mayor a lo que
   * hay NO se bloquea (muchos negocios piden prestado o el dueño pone de su
   * bolsa), pero tampoco se deja pasar a ciegas: el corte esperaría efectivo
   * que nunca existió (lo encontró la simulación de la taquería, sábados de
   * sueldos con el cajón en −$1,235).
   *
   *   sin `cubrir`          responde EFECTIVO_INSUFICIENTE con lo que hay y
   *                         lo que falta; no registra nada. La pantalla pregunta.
   *   cubrir.origen         PRESTAMO | DUENO | OTRO: entra lo que falta como
   *                         entrada de efectivo y sale el gasto, en UNA
   *                         transacción (o las dos, o ninguna).
   *   cubrir === 'NO'       se paga igual, como antes.
   */
  ipcMain.handle('egresos:registrar', sesion.proteger('egresos:registrar', async (_e, p = {}, ...resto) => {
    const ses = resto.length ? resto[resto.length - 1] : null;
    const eq = equipo();
    const enEfectivo = String(p?.payment_method || '').toUpperCase() === 'EFECTIVO';
    let faltan = 0;
    if (enEfectivo && p?.cubrir !== 'NO') {
      const hay = await enElCajon(caja(p)).catch(() => null);
      const monto = num(p?.amount) ?? 0;
      if (hay != null && monto > hay + 0.004) {
        faltan = Math.round((monto - Math.max(0, hay)) * 100) / 100;
        if (!p?.cubrir?.origen) {
          return { success: false, motivo: 'EFECTIVO_INSUFICIENTE', disponible: hay, faltan,
            error: `En el cajón hay ${hay.toFixed(2)} y el gasto es de ${monto.toFixed(2)}.` };
        }
      }
    }
    const cubrir = faltan > 0 && CUBRIR[p?.cubrir?.origen] ? { concepto: CUBRIR[p.cubrir.origen], nota: txt(p.cubrir.nota) } : null;

    let tx = null;
    if (cubrir) {
      tx = new sql.Transaction(await poolPromise);
      await tx.begin();
      try {
        await tx.request()
          .input('user_id', sql.Int, quien(ses))
          .input('amount', sql.Decimal(10, 2), faltan)
          .input('concept', sql.NVarChar(60), cubrir.concepto)
          .input('note', sql.NVarChar(255), cubrir.nota || `Para pagar: ${txt(p?.note, 200) || 'gasto en efectivo'}`)
          .input('register_id', sql.Int, caja(p))
          .input('machine_id', sql.NVarChar(64), eq.machineId || null)
          .input('machine_name', sql.NVarChar(120), eq.machineName || null)
          .execute('sp_register_cash_in');
      } catch (e) {
        await tx.rollback().catch(() => {});
        return { success: false, error: String(e.message || e) };
      }
    }
    const r = await ejecutar(tx ? Promise.resolve({ request: () => tx.request() }) : poolPromise, 'sp_register_expense', (r) => {
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
    if (tx) {
      if (r.success) await tx.commit(); else await tx.rollback().catch(() => {});
      if (r.success) r.cubierto = { monto: faltan, concepto: cubrir.concepto };
    }
    /* 0079: a cargo de que socios es y quien lo pago, si Socios esta activado
       y la pantalla lo pregunto. El egreso ya quedo: un fallo aqui se dice
       aparte y se corrige desde Socios. */
    if (r.success && p?.socios) {
      r.socios = await require('./socios').despuesDeGasto(await poolPromise, sql, r.data?.[0]?.expense_id, p.socios);
    }
    /* Pagado en efectivo: sp_register_expense lo saca hoy del cajón, así que se abre. */
    if (r.success && String(p?.payment_method || '').toUpperCase() === 'EFECTIVO') {
      r.cajon = await alSacarEfectivo('gasto en efectivo');
    }
    return r;
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
