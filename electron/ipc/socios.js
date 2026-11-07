/*
 * SOCIOS y PROPINAS (0079). docs/socios.md.
 *
 *   socios:config            la configuracion, los socios y de quien es cada categoria
 *   socios:activar           contestar el asistente y encender la aplicacion
 *   socios:config-guardar    cambiar las respuestas despues
 *   socios:ejemplo           un producto real para el ejemplo del asistente
 *   socios:producto-dueno    de quien es un producto (leer o guardar)
 *   socios:resumen           lo de cada socio en un periodo (sin cerrar nada)
 *   socios:por-corte         lo de cada socio por corte de caja
 *   socios:liquidar          cerrar el periodo
 *   socios:liquidaciones     la lista de liquidaciones
 *   socios:liquidacion       una liquidacion con sus lineas
 *   socios:movimiento        retiro, pago o aportacion de un socio
 *   socios:movimientos       el historial de esos movimientos
 *   socios:gasto             a cargo de quien es un gasto ya registrado
 *   socios:compra            quien pago una compra ya registrada
 *
 *   propinas:config          la configuracion de Propinas
 *   propinas:activar         contestar sus preguntas y encenderla
 *   propinas:config-guardar  cambiarlas despues
 *   propinas:repartir        calcular (confirmar = false) o pagar el reparto
 *   propinas:historial       propinas y repartos de un rango
 *
 * La propina de una venta y el reparto de cada venta entre socios NO tienen
 * canal propio: los hace el canal de cobro (sp-register-sale) despues del
 * COMMIT, con `despuesDeVender`. Una sola via de cobro.
 *
 * Quien actua sale de la sesion, nunca del payload. Las reglas viven en SQL.
 */
const sesion = require("../seguridad/sesion");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 19) : v);
const limpia = (fila) => Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, iso(v)]));
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const txt = (v, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const fecha = (v, campo) => {
  const s = String(v ?? "").slice(0, 10);
  if (!FECHA.test(s)) throw Error(`Indica una fecha valida (${campo}).`);
  return s;
};
const fechaOpcional = (v) => (v == null || v === "" ? null : fecha(v, "fecha"));
/* `sesion.proteger` agrega la sesion como ULTIMO argumento (ver asistencia.js). */
function argumentos(args) {
  const ses = args.length ? args[args.length - 1] : null;
  const p = args.length > 1 && args[0] && typeof args[0] === "object" ? args[0] : {};
  return { p, quien: Number(ses?.userId) || null };
}
const sets = (r) => (r.recordsets ?? []).map((s) => (s ?? []).map(limpia));
const primera = (r) => (r.recordset?.[0] ? limpia(r.recordset[0]) : null);
const filas = (r) => (r.recordset ?? []).map(limpia);

/**
 * La configuracion completa como la usa la pantalla:
 * { config, socios, categorias, productos }.
 */
const config = (r) => {
  const [c, s, k, p] = sets(r);
  return { config: c?.[0] ?? null, socios: s ?? [], categorias: k ?? [], productos: p ?? [] };
};

function registrar({ ipcMain, sql, poolPromise, cajaDeEsteEquipo }) {
  const caja = (p) => num(p?.registerId) ?? (() => { try { return num(cajaDeEsteEquipo?.()); } catch { return null; } })();
  /* Cada canal se escribe con su nombre literal en `ipcMain.handle` y en
     `sesion.proteger`: las pruebas de seguridad lo leen del fuente. */
  const ejecutar = (nombre, construir, formar = filas) =>
    async (_e, ...args) => {
      const { p, quien } = argumentos(args);
      try {
        const req = (await poolPromise).request();
        construir(req, p, quien);
        const r = await req.execute(nombre);
        return { success: true, data: formar(r) };
      } catch (e) {
        const msg = String(e.message || e);
        console.error(`[SOCIOS] ${nombre}:`, msg);
        return { success: false, error: msg };
      }
    };

  // ---------------------------------------------------------------- socios
  ipcMain.handle("socios:config", sesion.proteger("socios:config",
    ejecutar("sp_socios_config_get", () => {}, config)));

  const guardarConfig = (activar) => (req, p, quien) => req
    .input("json", sql.NVarChar(sql.MAX), JSON.stringify(p ?? {}))
    .input("activar", sql.Bit, activar)
    .input("user_id", sql.Int, quien);
  ipcMain.handle("socios:activar", sesion.proteger("socios:activar",
    ejecutar("sp_socios_config_guardar", guardarConfig(1), config)));
  ipcMain.handle("socios:config-guardar", sesion.proteger("socios:config-guardar",
    ejecutar("sp_socios_config_guardar", guardarConfig(0), config)));

  ipcMain.handle("socios:ejemplo", sesion.proteger("socios:ejemplo", ejecutar("sp_socios_ejemplo",
    (req, p) => req.input("product_id", sql.Int, num(p.productId)),
    (r) => { const [prod, insumos, opciones] = sets(r); return { producto: prod?.[0] ?? null, insumos: insumos ?? [], opciones: opciones ?? [] }; })));

  ipcMain.handle("socios:producto-dueno", sesion.proteger("socios:producto-dueno", ejecutar("sp_socios_producto_dueno", (req, p) => {
    const id = num(p.productId);
    if (!id) throw Error("Falta el producto.");
    const guardar = p.duenos !== undefined;
    const duenos = Array.isArray(p.duenos)
      ? p.duenos.slice(0, 10).map((d) => ({ socioId: num(d.socioId), pct: num(d.pct) })) : [];
    req.input("product_id", sql.Int, id)
      .input("duenos", sql.NVarChar(sql.MAX), JSON.stringify(duenos))
      .input("guardar", sql.Bit, guardar ? 1 : 0);
  })));

  ipcMain.handle("socios:resumen", sesion.proteger("socios:resumen", ejecutar("sp_socios_resumen",
    (req, p) => req.input("desde", sql.Date, fechaOpcional(p.desde)).input("hasta", sql.Date, fechaOpcional(p.hasta)))));

  ipcMain.handle("socios:por-corte", sesion.proteger("socios:por-corte", ejecutar("sp_socios_por_corte",
    (req, p) => req.input("closure_id", sql.Int, num(p.closureId))
      .input("desde", sql.Date, fechaOpcional(p.desde)).input("hasta", sql.Date, fechaOpcional(p.hasta)))));

  const liquidacion = (r) => { const [cab, lineas] = sets(r); return { liquidacion: cab?.[0] ?? null, lineas: lineas ?? [] }; };
  ipcMain.handle("socios:liquidar", sesion.proteger("socios:liquidar", ejecutar("sp_socios_liquidar",
    (req, p, quien) => req.input("hasta", sql.Date, fecha(p.hasta, "hasta")).input("user_id", sql.Int, quien), liquidacion)));
  ipcMain.handle("socios:liquidaciones", sesion.proteger("socios:liquidaciones", ejecutar("sp_socios_liquidacion",
    (req) => req.input("id", sql.Int, null))));
  ipcMain.handle("socios:liquidacion", sesion.proteger("socios:liquidacion", ejecutar("sp_socios_liquidacion", (req, p) => {
    const id = num(p.id);
    if (!id) throw Error("Falta la liquidacion.");
    req.input("id", sql.Int, id);
  }, liquidacion)));

  ipcMain.handle("socios:movimiento", sesion.proteger("socios:movimiento", ejecutar("sp_socios_movimiento", (req, p, quien) => {
    req.input("socio_id", sql.Int, num(p.socioId))
      .input("tipo", sql.VarChar(12), txt(p.tipo, 12))
      .input("monto", sql.Decimal(12, 2), num(p.monto))
      .input("metodo", sql.VarChar(20), txt(p.metodo, 20))
      .input("register_id", sql.Int, caja(p))
      .input("nota", sql.NVarChar(255), txt(p.nota))
      .input("user_id", sql.Int, quien);
  }, primera)));
  ipcMain.handle("socios:movimientos", sesion.proteger("socios:movimientos", ejecutar("sp_socios_movimientos",
    (req, p) => req.input("desde", sql.Date, fecha(p.desde, "desde")).input("hasta", sql.Date, fecha(p.hasta, "hasta")))));

  ipcMain.handle("socios:gasto", sesion.proteger("socios:gasto", ejecutar("sp_socios_gasto_guardar", (req, p) => {
    asignarGasto(req, sql, p.expenseId, p);
  })));
  ipcMain.handle("socios:compra", sesion.proteger("socios:compra", ejecutar("sp_socios_compra_guardar", (req, p) => {
    req.input("purchase_id", sql.Int, num(p.purchaseId)).input("pagado_por", sql.Int, num(p.pagadoPor));
  }, primera)));

  // -------------------------------------------------------------- propinas
  ipcMain.handle("propinas:config", sesion.proteger("propinas:config",
    ejecutar("sp_propinas_config_get", () => {}, primera)));
  const guardarPropinas = (activar) => (req, p, quien) => req
    .input("reparto", sql.VarChar(8), txt(p.reparto, 8))
    .input("sugeridas", sql.VarChar(40), txt(Array.isArray(p.sugeridas) ? p.sugeridas.join(",") : p.sugeridas, 40))
    .input("comision_pct", sql.Decimal(5, 2), num(p.comisionPct) ?? 0)
    .input("comision_a", sql.VarChar(8), txt(p.comisionA, 8) ?? "NEGOCIO")
    .input("activar", sql.Bit, activar)
    .input("user_id", sql.Int, quien);
  ipcMain.handle("propinas:activar", sesion.proteger("propinas:activar",
    ejecutar("sp_propinas_config_guardar", guardarPropinas(1), primera)));
  ipcMain.handle("propinas:config-guardar", sesion.proteger("propinas:config-guardar",
    ejecutar("sp_propinas_config_guardar", guardarPropinas(0), primera)));

  /* La caja: la que diga la pantalla, la de este equipo o, en una
     instalacion de una sola caja sin configurar, la unica activa. */
  ipcMain.handle("propinas:repartir", sesion.proteger("propinas:repartir", async (_e, ...args) => {
    const { p, quien } = argumentos(args);
    try {
      const pool = await poolPromise;
      let registro = caja(p);
      if (!registro) {
        const r = await pool.request().query("SELECT id FROM dbo.registers WHERE is_active = 1");
        if (r.recordset.length === 1) registro = r.recordset[0].id;
      }
      if (!registro) throw Error("Falta la caja.");
      const r = await pool.request().input("register_id", sql.Int, registro).input("user_id", sql.Int, quien)
        .input("confirmar", sql.Bit, p.confirmar === true ? 1 : 0).execute("sp_propinas_repartir");
      const [cab, lineas] = sets(r);
      return { success: true, data: { reparto: cab?.[0] ?? null, lineas: lineas ?? [] } };
    } catch (e) {
      const msg = String(e.message || e);
      console.error("[PROPINAS] sp_propinas_repartir:", msg);
      return { success: false, error: msg };
    }
  }));

  ipcMain.handle("propinas:historial", sesion.proteger("propinas:historial", ejecutar("sp_propinas_historial",
    (req, p) => req.input("desde", sql.Date, fecha(p.desde, "desde")).input("hasta", sql.Date, fecha(p.hasta, "hasta"))
      .input("register_id", sql.Int, num(p.registerId)),
    (r) => { const [propinas, repartos, lineas] = sets(r); return { propinas: propinas ?? [], repartos: repartos ?? [], lineas: lineas ?? [] }; })));
}

/** Los parametros de sp_socios_gasto_guardar desde `{ modo, lineas, pagadoPor }`. */
function asignarGasto(req, sql, expenseId, s) {
  const lineas = Array.isArray(s?.lineas)
    ? s.lineas.slice(0, 10).map((l) => ({ socioId: num(l.socioId), pct: num(l.pct) })) : [];
  req.input("expense_id", sql.Int, num(expenseId))
    .input("modo", sql.VarChar(8), String(s?.modo || "COMUN").toUpperCase().slice(0, 8))
    .input("lineas", sql.NVarChar(sql.MAX), JSON.stringify(lineas))
    .input("pagado_por", sql.Int, num(s?.pagadoPor));
}

/**
 * Lo que sigue a una venta ya registrada. Lo llama el canal de cobro DESPUES
 * del COMMIT y nunca tumba la venta:
 *
 *   · el reparto entre socios de esa venta (si la aplicacion esta activada);
 *   · la propina, si la venta trae una (`tip: { monto, metodo }`).
 *
 * Devuelve `{ propina: { ok, error? } | null }` para que la caja diga si la
 * propina no se pudo guardar. El reparto no se reporta: si falla aqui, el
 * siguiente resumen lo hace.
 */
async function despuesDeVender(pool, sql, { saleId, userId, tip }) {
  const out = { propina: null };
  if (!saleId) return out;
  try {
    await pool.request().input("sale_id", sql.Int, saleId).execute("sp_socios_asignar");
  } catch (e) {
    console.warn("[SOCIOS] reparto de la venta", saleId, String(e.message || e));
  }
  const monto = num(tip?.monto);
  if (monto && monto > 0) {
    try {
      await pool.request()
        .input("sale_id", sql.Int, saleId)
        .input("monto", sql.Decimal(10, 2), monto)
        .input("metodo", sql.VarChar(12), String(tip.metodo || "EFECTIVO").toUpperCase().slice(0, 12))
        .input("user_id", sql.Int, num(userId))
        .execute("sp_propina_registrar");
      out.propina = { ok: true };
    } catch (e) {
      const msg = String(e.message || e);
      console.error("[PROPINAS] registrar", saleId, msg);
      out.propina = { ok: false, error: msg };
    }
  }
  return out;
}

/** El reparto de un gasto recien registrado, si la pantalla lo mando. */
async function despuesDeGasto(pool, sql, expenseId, socios) {
  if (!expenseId || !socios) return null;
  try {
    const req = pool.request();
    asignarGasto(req, sql, expenseId, socios);
    await req.execute("sp_socios_gasto_guardar");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** Quien pago una compra recien registrada, si la pantalla lo mando. */
async function despuesDeCompra(pool, sql, purchaseId, pagadoPor) {
  if (!purchaseId || pagadoPor === undefined || pagadoPor === null) return null;
  try {
    await pool.request().input("purchase_id", sql.Int, purchaseId)
      .input("pagado_por", sql.Int, num(pagadoPor)).execute("sp_socios_compra_guardar");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { registrar, despuesDeVender, despuesDeGasto, despuesDeCompra };
