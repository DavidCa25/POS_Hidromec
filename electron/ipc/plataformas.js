/*
 * LIQUIDACIONES DE PLATAFORMA (0069): Uber Eats, Didi Food, Rappi.
 *
 *   plataformas:canales         que canal de venta es de que plataforma
 *   plataformas:canal-guardar   ligar / desligar un canal
 *   plataformas:listar          liquidaciones de un rango + lo que deben hoy
 *   plataformas:ver             una liquidacion y su conciliacion
 *   plataformas:guardar         crear o cambiar un borrador (con sus pedidos)
 *   plataformas:emparejar       emparejar a mano un pedido con una venta
 *   plataformas:confirmar       contar la liquidacion en resultados
 *   plataformas:cancelar        anularla (con motivo)
 *   plataformas:deposito        el deposito que de verdad llego
 *
 * Mismo criterio que egresos.js: aqui no hay reglas. Emparejar, repartir y
 * el egreso de comision los decide SQL. El archivo de la plataforma lo lee el
 * renderer (shared/plataformas.ts) y llega aqui ya como pedidos; aqui solo se
 * acotan tipos y tamanos. Quien guarda o confirma sale de la sesion, nunca
 * del payload.
 */
const sesion = require("../seguridad/sesion");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PLATAFORMAS = ["UBER_EATS", "DIDI_FOOD", "RAPPI"];
/* mssql entrega un DATE como medianoche UTC: su parte ISO es la fecha. Un
   DATETIME2 llega como hora local leida como UTC: igual, su ISO sin zona. */
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 19) : v);
const limpia = (fila) => Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, iso(v)]));
const txt = (v, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const dinero = (v) => {
  const n = num(v);
  return n == null ? 0 : Math.round(n * 100) / 100;
};
const fecha = (v, campo) => {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!FECHA.test(s)) throw Error(`Indica una fecha valida (${campo}).`);
  return s;
};
const quien = (resto) => Number(resto.length ? resto[resto.length - 1]?.userId : null) || null;

function registrar({ ipcMain, sql, poolPromise }) {
  /* Cada canal se escribe con su nombre literal en `ipcMain.handle` y en
     `sesion.proteger`: las pruebas de seguridad lo leen del fuente. */
  const ejecutar = (nombre, construir, formar = (r) => r.recordset ?? []) =>
    async (_e, p = {}, ...resto) => {
      try {
        const req = (await poolPromise).request();
        construir(req, p || {}, quien(resto));
        const r = await req.execute(nombre);
        return { success: true, data: formar(r) };
      } catch (e) {
        const msg = String(e.message || e);
        console.error(`[PLATAFORMAS] ${nombre}:`, msg);
        return { success: false, error: msg };
      }
    };

  ipcMain.handle("plataformas:canales", sesion.proteger("plataformas:canales", ejecutar("sp_platform_channels_get", () => {}, (r) => ({
    canales: (r.recordsets[0] ?? []).map(limpia),
    sinCanal: (r.recordsets[1] ?? [])[0] ?? { ventas: 0, importe: 0 },
  }))));

  ipcMain.handle("plataformas:canal-guardar", sesion.proteger("plataformas:canal-guardar", ejecutar("sp_platform_channel_set", (q, p, u) => {
    const plataforma = p.plataforma == null || p.plataforma === "" ? null : String(p.plataforma);
    if (plataforma && !PLATAFORMAS.includes(plataforma)) throw Error("Plataforma no admitida.");
    q.input("channel_id", sql.NVarChar(64), txt(p.channel_id, 64))
     .input("platform", sql.VarChar(12), plataforma)
     .input("user_id", sql.Int, u);
  })));

  ipcMain.handle("plataformas:listar", sesion.proteger("plataformas:listar", ejecutar("sp_platform_settlement_list", (q, p) => {
    q.input("platform", sql.VarChar(12), PLATAFORMAS.includes(p.plataforma) ? p.plataforma : null)
     .input("desde", sql.Date, fecha(p.desde, "desde"))
     .input("hasta", sql.Date, fecha(p.hasta, "hasta"))
     .input("include_voided", sql.Bit, p.canceladas ? 1 : 0);
  }, (r) => ({
    liquidaciones: (r.recordsets[0] ?? []).map(limpia),
    porCobrar: (r.recordsets[1] ?? []).map(limpia),
    sinPlataforma: (r.recordsets[2] ?? [])[0] ?? { ventas: 0, importe: 0 },
  }))));

  ipcMain.handle("plataformas:ver", sesion.proteger("plataformas:ver", ejecutar("sp_platform_settlement_get", (q, p) => {
    q.input("settlement_id", sql.Int, num(p.id));
  }, (r) => ({
    liquidacion: (r.recordsets[0] ?? []).map(limpia)[0] ?? null,
    pedidos: (r.recordsets[1] ?? []).map(limpia),
    sobrantes: (r.recordsets[2] ?? []).map(limpia),
  }))));

  ipcMain.handle("plataformas:guardar", sesion.proteger("plataformas:guardar", ejecutar("sp_platform_settlement_save", (q, p, u) => {
    if (!PLATAFORMAS.includes(p.plataforma)) throw Error("Elige la plataforma.");
    let pedidos = null;
    if (Array.isArray(p.pedidos)) {
      if (p.pedidos.length > 20000) throw Error("El archivo trae mas de 20,000 pedidos: divide el periodo.");
      pedidos = JSON.stringify(p.pedidos.map((x) => ({
        id: txt(x?.id, 100),
        at: typeof x?.at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(x.at) ? x.at : null,
        customer: txt(x?.customer, 120),
        fulfillment: txt(x?.fulfillment, 40),
        status: txt(x?.status, 40),
        base: num(x?.base), tax: num(x?.tax), total: num(x?.total), net: num(x?.net),
        cancelled: x?.cancelled === true,
      })));
    }
    q.input("id", sql.Int, num(p.id))
     .input("user_id", sql.Int, u)
     .input("platform", sql.VarChar(12), p.plataforma)
     .input("period_from", sql.Date, fecha(p.desde, "desde"))
     .input("period_to", sql.Date, fecha(p.hasta, "hasta"))
     .input("source_file", sql.NVarChar(200), txt(p.archivo, 200))
     .input("gross_sales", sql.Decimal(14, 2), dinero(p.ventas))
     .input("marketing", sql.Decimal(14, 2), dinero(p.marketing))
     .input("service_fees", sql.Decimal(14, 2), dinero(p.comision))
     .input("refunds", sql.Decimal(14, 2), dinero(p.reembolsos))
     .input("isr_withheld", sql.Decimal(14, 2), dinero(p.isr))
     .input("iva_withheld", sql.Decimal(14, 2), dinero(p.iva))
     .input("other_adjustments", sql.Decimal(14, 2), dinero(p.otros))
     .input("iva_rate", sql.Decimal(5, 4), num(p.tasaIva) ?? 0.16)
     .input("deposit_real", sql.Decimal(14, 2), num(p.depositoReal))
     .input("deposit_date", sql.Date, fecha(p.fechaDeposito, "deposito"))
     .input("note", sql.NVarChar(255), txt(p.nota))
     .input("orders_json", sql.NVarChar(sql.MAX), pedidos);
  }, (r) => ({ id: Number((r.recordset ?? [])[0]?.id) || null }))));

  ipcMain.handle("plataformas:emparejar", sesion.proteger("plataformas:emparejar", ejecutar("sp_platform_settlement_link", (q, p) => {
    q.input("settlement_id", sql.Int, num(p.id))
     .input("order_line_id", sql.Int, num(p.pedido))
     .input("sale_id", sql.Int, num(p.venta));
  })));

  ipcMain.handle("plataformas:confirmar", sesion.proteger("plataformas:confirmar", ejecutar("sp_platform_settlement_confirm", (q, p, u) => {
    q.input("settlement_id", sql.Int, num(p.id)).input("user_id", sql.Int, u);
  }, (r) => (r.recordset ?? [])[0] ?? null)));

  ipcMain.handle("plataformas:cancelar", sesion.proteger("plataformas:cancelar", ejecutar("sp_platform_settlement_void", (q, p, u) => {
    q.input("settlement_id", sql.Int, num(p.id))
     .input("user_id", sql.Int, u)
     .input("reason", sql.NVarChar(200), txt(p.motivo, 200));
  })));

  ipcMain.handle("plataformas:deposito", sesion.proteger("plataformas:deposito", ejecutar("sp_platform_settlement_deposit", (q, p) => {
    q.input("settlement_id", sql.Int, num(p.id))
     .input("amount", sql.Decimal(14, 2), num(p.importe))
     .input("deposit_date", sql.Date, fecha(p.fecha, "deposito"));
  }, (r) => (r.recordset ?? []).map(limpia)[0] ?? null)));
}

module.exports = { registrar };
