/**
 * IPC del dominio Fidelizacion.
 *
 * Mismo criterio que electron/ipc/hospitality.js: aqui no hay reglas de
 * negocio. Cada handler traduce el payload a parametros y ejecuta su
 * procedure. Quien decide que gano una venta, si una dinamica se gana o a
 * quien le toca la rifa es SQL, siempre.
 *
 * Nombres por dominio: loyalty:*, dynamics:*, raffles:*.
 */

/* La puerta de autorizacion es la misma que usa el proceso principal: el
 * paquete que exige cada canal sale de electron/seguridad/canales.js. */
const sesion = require('../seguridad/sesion');


/** Envoltorio uniforme: nunca lanza al renderer, siempre {success, ...}. */
async function ejecutar(pool, nombre, construir) {
  try {
    const req = pool.request();
    if (construir) construir(req);
    const r = await req.execute(nombre);
    return { success: true, data: r.recordset ?? [], sets: r.recordsets ?? [] };
  } catch (e) {
    console.error(`[LOYALTY] ${nombre}:`, e.message);
    return { success: false, error: e.message };
  }
}

/** null cuando el valor no viene o viene vacio; el numero si es un numero. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** null cuando no viene; la cadena recortada si viene. */
function txt(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function registrar({ ipcMain, sql, poolPromise, machineId }) {
  const pool = () => poolPromise;
  const equipo = () => (typeof machineId === 'function' ? machineId() : machineId) || null;

  // --------------------------------------------------------------- catalogo
  /**
   * Todo Fidelizacion en UNA llamada: campanas, recompensas, cupones,
   * dinamicas y rifas. La pantalla de administracion tiene cinco pestanas y
   * el usuario salta entre ellas; pedir cinco veces lo mismo cada vez que
   * cambia de pestana seria pagar cinco viajes para pintar lo ya sabido.
   */
  ipcMain.handle('loyalty:catalog', async () => {
    try {
      const p = await pool();
      const r = await p.request().execute('sp_loyalty_catalog');
      const [campanas = [], recompensas = [], cupones = [], dinamicas = [], rifas = []] = r.recordsets || [];
      return { success: true, data: { campanas, recompensas, cupones, dinamicas, rifas } };
    } catch (e) {
      console.error('[LOYALTY] loyalty:catalog:', e.message);
      return { success: false, error: e.message };
    }
  });

  // -------------------------------------------------------------- campanas
  ipcMain.handle('loyalty:save-campaign', sesion.proteger('loyalty:save-campaign', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_loyalty_save_campaign', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('name', sql.NVarChar(120), txt(p.name))
      .input('description', sql.NVarChar(400), txt(p.description))
      .input('outcome', sql.NVarChar(20), txt(p.outcome))
      .input('reward_definition_id', sql.Int, num(p.rewardDefinitionId))
      .input('coupon_definition_id', sql.Int, num(p.couponDefinitionId))
      .input('dynamic_definition_id', sql.Int, num(p.dynamicDefinitionId))
      .input('raffle_id', sql.Int, num(p.raffleId))
      .input('quantity', sql.Int, num(p.quantity) ?? 1)
      .input('per_amount', sql.Decimal(12, 2), num(p.perAmount))
      .input('min_total', sql.Decimal(12, 2), num(p.minTotal))
      .input('product_id', sql.Int, num(p.productId))
      .input('requires_customer', sql.Bit, p.requiresCustomer ? 1 : 0)
      .input('first_purchase_only', sql.Bit, p.firstPurchaseOnly ? 1 : 0)
      .input('weekday_mask', sql.TinyInt, num(p.weekdayMask))
      .input('time_from', sql.VarChar(8), txt(p.timeFrom))
      .input('time_to', sql.VarChar(8), txt(p.timeTo))
      .input('starts_at', sql.DateTime2, p.startsAt ? new Date(p.startsAt) : null)
      .input('ends_at', sql.DateTime2, p.endsAt ? new Date(p.endsAt) : null)
      .input('priority', sql.Int, num(p.priority) ?? 100)
      .input('active', sql.Bit, p.active === false ? 0 : 1))));

  // --------------------------------- recompensas, cupones y dinamicas
  /**
   * Una sola entrada para las tres definiciones.
   *
   * Son la misma operacion con distinto destino, y `kind_of` ya decide en
   * SQL. Tres handlers identicos habrian sido tres sitios donde olvidarse de
   * anadir el mismo campo.
   */
  ipcMain.handle('loyalty:save-definition', sesion.proteger('loyalty:save-definition', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_loyalty_save_definition', (r) => r
      .input('kind_of', sql.NVarChar(10), txt(p.kindOf))
      .input('id', sql.Int, num(p.id))
      .input('name', sql.NVarChar(120), txt(p.name))
      .input('kind', sql.NVarChar(20), txt(p.kind))
      .input('type', sql.NVarChar(20), txt(p.type))
      .input('description', sql.NVarChar(400), txt(p.description))
      .input('product_id', sql.Int, num(p.productId))
      .input('amount', sql.Decimal(12, 2), num(p.amount))
      .input('discount_pct', sql.Decimal(5, 2), num(p.discountPct))
      .input('valid_days', sql.Int, num(p.validDays))
      .input('uses_allowed', sql.Int, num(p.usesAllowed) ?? 1)
      .input('code_prefix', sql.NVarChar(8), txt(p.codePrefix))
      .input('target_value', sql.Decimal(12, 4), num(p.targetValue))
      .input('tolerance', sql.Decimal(12, 4), num(p.tolerance))
      .input('attempts_allowed', sql.Int, num(p.attemptsAllowed) ?? 1)
      .input('reward_definition_id', sql.Int, num(p.rewardDefinitionId))
      .input('active', sql.Bit, p.active === false ? 0 : 1))));

  // ------------------------------------------------------- venta -> premios
  /**
   * Que gano esta venta.
   *
   * Se llama DESPUES de que la venta ya esta comprometida. Si esto falla, la
   * venta sigue cobrada: por eso devuelve {success:false} y no relanza. El
   * procedure es idempotente por venta, asi que reintentar no premia dos
   * veces.
   */
  ipcMain.handle('loyalty:evaluate-sale', sesion.proteger('loyalty:evaluate-sale', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_loyalty_evaluate_sale', (r) => r
      .input('sale_id', sql.Int, num(p.saleId))
      .input('machine_id', sql.NVarChar(64), equipo()))));

  // -------------------------------------------------------------- dinamicas
  ipcMain.handle('dynamics:pending', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_dynamic_pending', (r) =>
      r.input('sale_id', sql.Int, num(p.saleId))));

  /**
   * Jugar. El resultado lo decide SQL, no esta capa ni la pantalla.
   *
   * El token identifica el intento concreto: sin el no se puede jugar una
   * dinamica que no salio de una venta.
   */
  ipcMain.handle('dynamics:play', sesion.proteger('dynamics:play', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_dynamic_play', (r) => r
      .input('token', sql.NVarChar(32), txt(p.token))
      .input('input_value', sql.Decimal(12, 4), num(p.inputValue) ?? 0)
      .input('machine_id', sql.NVarChar(64), equipo()))));

  // ----------------------------------------------------------- la ruleta
  /** Los sectores de una ruleta, en orden y con su probabilidad real. */
  ipcMain.handle('dynamics:segments', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_dynamic_segments', (r) =>
      r.input('definition_id', sql.Int, num(p.definitionId))));

  /**
   * Crear, cambiar o quitar un sector. Devuelve la lista completa ya
   * recalculada, asi que la pantalla no tiene que volver a pedirla.
   */
  ipcMain.handle('dynamics:save-segment', sesion.proteger('dynamics:save-segment', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_dynamic_save_segment', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('definition_id', sql.Int, num(p.definitionId))
      .input('label', sql.NVarChar(60), txt(p.label))
      .input('outcome', sql.NVarChar(16), txt(p.outcome) || 'NONE')
      .input('reward_definition_id', sql.Int, num(p.rewardDefinitionId))
      .input('raffle_id', sql.Int, num(p.raffleId))
      .input('quantity', sql.Int, num(p.quantity) ?? 1)
      .input('weight', sql.Int, num(p.weight) ?? 1)
      .input('sort_order', sql.Int, num(p.sortOrder))
      .input('borrar', sql.Bit, p.borrar ? 1 : 0))));

  // ------------------------------------------------------------------ rifas
  ipcMain.handle('raffles:save', sesion.proteger('raffles:save', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_raffle_save', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('name', sql.NVarChar(120), txt(p.name))
      .input('description', sql.NVarChar(400), txt(p.description))
      .input('prize', sql.NVarChar(200), txt(p.prize))
      .input('starts_at', sql.DateTime2, p.startsAt ? new Date(p.startsAt) : null)
      .input('ends_at', sql.DateTime2, p.endsAt ? new Date(p.endsAt) : null)
      .input('winners_count', sql.Int, num(p.winnersCount) ?? 1)
      .input('code_prefix', sql.NVarChar(8), txt(p.codePrefix))
      .input('status', sql.NVarChar(10), txt(p.status))
      .input('tickets_total', sql.Int, num(p.ticketsTotal)))));

  ipcMain.handle('raffles:detail', async (_e, p = {}) => {
    try {
      const pl = await pool();
      const r = await pl.request()
        .input('raffle_id', sql.Int, num(p.raffleId))
        .input('top_entries', sql.Int, num(p.topEntries) ?? 200)
        .execute('sp_raffle_detail');
      const [cab = [], participaciones = [], ganadores = []] = r.recordsets || [];
      return { success: true, data: { rifa: cab[0] ?? null, participaciones, ganadores } };
    } catch (e) {
      console.error('[LOYALTY] raffles:detail:', e.message);
      return { success: false, error: e.message };
    }
  });

  /**
   * Sortear.
   *
   * Irreversible por diseno: el procedure congela el universo de boletos y
   * deja constancia del algoritmo, su version y la semilla. Quien pregunte
   * dentro de seis meses si el sorteo fue limpio tiene con que comprobarlo.
   */
  ipcMain.handle('raffles:draw', sesion.proteger('raffles:draw', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_raffle_draw', (r) => r
      .input('raffle_id', sql.Int, num(p.raffleId))
      .input('user_id', sql.Int, num(p.userId))
      .input('register_id', sql.Int, num(p.registerId))
      .input('machine_id', sql.NVarChar(64), equipo())
      .input('winners', sql.Int, num(p.winners))
      .input('alternates', sql.Int, num(p.alternates) ?? 0))));

  /**
   * Cerrar una rifa: deja de admitir boletos y congela cuantos habia.
   * Es un acto propio, distinto de sortear.
   */
  ipcMain.handle('raffles:close', sesion.proteger('raffles:close', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_raffle_close', (r) => r
      .input('raffle_id', sql.Int, num(p.raffleId))
      .input('user_id', sql.Int, num(p.userId)))));

  // ------------------------------------------------------------- cupones
  /** Mirar, sin consumir. Se llama cuando el cajero teclea el codigo. */
  /**
   * Emitir cupones sin venta.
   *
   * Es el unico camino para convertir una definicion en codigos repartibles
   * sin montar una campana y esperar a que alguien compre.
   */
  ipcMain.handle('coupons:issue', sesion.proteger('coupons:issue', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_coupon_issue', (r) => r
      .input('definition_id', sql.Int, num(p.definitionId))
      .input('quantity', sql.Int, num(p.quantity) ?? 1)
      .input('customer_id', sql.Int, num(p.customerId))
      .input('machine_id', sql.NVarChar(64), txt(p.machineId))
      .input('register_id', sql.Int, num(p.registerId)))));

  ipcMain.handle('coupons:validate', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_coupon_validate', (r) =>
      r.input('code', sql.NVarChar(24), txt(p.code))));

  /**
   * Consumir, con la venta ya cobrada.
   *
   * A diferencia de los premios, un fallo aqui SI importa y se devuelve tal
   * cual: el cliente se llevo un beneficio y el cupon tiene que quedar
   * gastado. Quien llama debe ensenar el motivo, no callarselo.
   */
  ipcMain.handle('coupons:redeem', sesion.proteger('coupons:redeem', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_coupon_redeem', (r) => r
      .input('code', sql.NVarChar(24), txt(p.code))
      .input('sale_id', sql.Int, num(p.saleId))
      .input('register_id', sql.Int, num(p.registerId))
      .input('machine_id', sql.NVarChar(64), equipo())
      .input('amount_applied', sql.Decimal(12, 2), num(p.amountApplied) ?? 0))));

  /** Lo repartido de verdad: recompensas o cupones emitidos. */
  ipcMain.handle('loyalty:instances', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_loyalty_instances', (r) => r
      .input('kind_of', sql.NVarChar(10), txt(p.kindOf) || 'REWARD')
      .input('estado', sql.NVarChar(12), txt(p.estado))
      .input('search', sql.NVarChar(120), txt(p.search))
      .input('top', sql.Int, num(p.top) ?? 300)));

  ipcMain.handle('raffles:winner-status', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_raffle_winner_status', (r) => r
      .input('winner_id', sql.Int, num(p.winnerId))
      .input('status', sql.NVarChar(14), txt(p.status))
      .input('user_id', sql.Int, num(p.userId))
      .input('notes', sql.NVarChar(300), txt(p.notes))
      .input('promover_suplente', sql.Bit, p.promoverSuplente ? 1 : 0)));
}

module.exports = { registrar };
