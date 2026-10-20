/*
 * CORTE DE CAJA POR CORREO (0061).
 *
 *   - Al cerrar un turno, main.js llama a `enviarCorte(id)` sin esperarlo: el
 *     corte ya está cerrado y un correo que falla no lo deshace.
 *   - La BANDERA vive en dbo.cash_closure_email_jobs (sp_cash_closure_email_job):
 *     un corte ENVIADO no se vuelve a mandar, ni solo ni desde "Enviar
 *     pendientes". Dos envíos simultáneos del mismo corte no se duplican.
 *   - Aquí solo se juntan los DATOS del corte. El correo lo arma la nube
 *     (función corte-email) y los destinatarios -los dueños en Owner- también
 *     los decide la nube: el POS no puede elegir a quién se manda.
 *   - Sin nube vinculada no se intenta: el corte queda SIN_ENVIAR y se puede
 *     mandar después.
 */
const sesion = require("../seguridad/sesion");

const MAX_LOTE = 30;
/* Errores que van a repetirse con el siguiente corte: no tiene caso seguir. */
const DETIENEN_LOTE = new Set(["NO_RECIPIENTS", "RATE_LIMIT", "MAIL_NOT_CONFIGURED", "OFFLINE"]);

/* mssql lee DATETIME2 (hora local sin zona) como si fuera UTC: las partes UTC
   del Date son la hora de pared que se guardó. Un string de FOR JSON
   ("2026-10-18T08:00:00") ya es hora de pared. */
function partes(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime()))
    return [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes()];
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(v ?? ""));
  return m ? m.slice(1).map(Number) : null;
}
const dos = (n) => String(n).padStart(2, "0");
function fechaHora(v) {
  const p = partes(v);
  return p ? `${dos(p[2])}/${dos(p[1])}/${p[0]} ${dos(p[3])}:${dos(p[4])}` : "";
}
function hora(v) {
  const p = partes(v);
  return p ? `${dos(p[3])}:${dos(p[4])}` : "";
}
function duracion(desde, hasta) {
  const a = partes(desde), b = partes(hasta);
  if (!a || !b) return "";
  const min = Math.round((Date.UTC(b[0], b[1] - 1, b[2], b[3], b[4]) - Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4])) / 60000);
  if (!(min >= 0)) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function registrar({ ipcMain, sql, poolPromise, cloudSync }) {
  /** Junta lo que el correo necesita. No escribe nada. */
  async function datosCorte(closureId) {
    const pool = await poolPromise;
    const [ticket, extra, movs] = await Promise.all([
      pool.request().input("closure_id", sql.Int, closureId).execute("sp_cash_closure_ticket"),
      pool.request().input("closure_id", sql.Int, closureId).execute("sp_cash_closure_email_data"),
      pool.request().input("closure_id", sql.Int, closureId).execute("sp_get_cash_movements"),
    ]);
    const s = JSON.parse(ticket.recordset[0].document_json);
    const [cab = {}] = extra.recordsets[0] || [];
    const tot = (extra.recordsets[2] || [])[0] || {};
    return {
      uuid: String(cab.uuid || "").toLowerCase(),
      folio: closureId,
      negocio: cab.business_name || "",
      caja: s.register_name || cab.register_name || "",
      abrio: cab.opened_by || s.cashier || "",
      cerro: cab.closed_by || "",
      autorizo: cab.authorized_by || "",
      abierto: fechaHora(s.opened_at),
      cerrado: fechaHora(s.closed_at),
      duracion: duracion(s.opened_at, s.closed_at),
      ciego: !!cab.blind_count,
      ventas: { total: n(s.total), tickets: n(s.tickets), descuentos: n(s.discount), devoluciones: n(s.refunds), iva: n(s.tax) },
      pagos: (s.payments || []).map((p) => ({ metodo: p.payment_method || "", importe: n(p.amount) })),
      arqueo: {
        fondo: n(s.opening_cash), esperado: n(s.cash_expected), contado: n(s.cash_delivered),
        diferencia: n(s.difference), dejaEnCaja: s.cash_left == null ? null : n(s.cash_left),
      },
      efectivo: (movs.recordsets[2] || []).map((d) => ({
        grupo: d.grupo, concepto: d.concepto, total: n(d.total), movimientos: n(d.movimientos),
      })),
      // Lo que no es venta ni fondo: retiros, egresos, pagos, entradas.
      movimientos: (movs.recordsets[0] || [])
        .filter((m) => m.grupo !== "VENTAS" && m.typee !== "OPENING")
        .slice(0, 100)
        .map((m) => ({ hora: hora(m.datee), concepto: m.concepto || m.tipo_label || m.typee, importe: n(m.amount), quien: m.user_name || "", nota: m.note || "" })),
      productos: (extra.recordsets[1] || []).map((p) => ({ nombre: p.producto, cantidad: n(p.cantidad), importe: n(p.importe) })),
      productosTotal: { productos: n(tot.productos), piezas: n(tot.piezas) },
      devoluciones: (extra.recordsets[3] || []).map((d) => ({
        hora: hora(d.datee), folio: n(d.sale_id), importe: n(d.refund_total), metodo: d.payment_method || "", nota: d.note || "", quien: d.quien || "",
      })),
      bitacora: (extra.recordsets[4] || []).map((b) => ({ evento: b.event_type, veces: n(b.veces), monto: b.monto == null ? null : n(b.monto) })),
      nota: s.closing_note || "",
    };
  }

  async function job(closureId, accion, extra = {}) {
    const pool = await poolPromise;
    const r = await pool.request()
      .input("closure_id", sql.Int, closureId)
      .input("accion", sql.VarChar(10), accion)
      .input("user_id", sql.Int, extra.userId ?? null)
      .input("recipients", sql.Int, extra.recipients ?? null)
      .input("error", sql.NVarChar(300), extra.error ? String(extra.error).slice(0, 300) : null)
      .execute("sp_cash_closure_email_job");
    return r.recordset[0];
  }

  function nubeLista() {
    const c = cloudSync.getCloudConfig?.() || {};
    return !!(c.enabled && c.equipo?.registrado);
  }

  /**
   * Manda el correo de UN corte. Nunca lanza: devuelve el resultado.
   *   { ok:true, estado:'ENVIADO', recipients }  salió (o ya había salido)
   *   { ok:false, estado, error }                no salió; se puede reintentar
   */
  async function enviarCorte(closureId, userId = null) {
    if (!nubeLista())
      return { ok: false, estado: "SIN_NUBE", error: "Vincula la caja con Wybix en la nube para enviar cortes por correo." };
    let reserva;
    try {
      reserva = await job(closureId, "RESERVAR", { userId });
    } catch (e) {
      return { ok: false, estado: "ERROR", error: e.message };
    }
    if (reserva.resultado === "YA_ENVIADO") return { ok: true, estado: "ENVIADO", recipients: reserva.recipients, ya: true };
    if (reserva.resultado === "OCUPADO") return { ok: false, estado: "ENVIANDO", error: "Este corte se está enviando en este momento." };
    try {
      const corte = await datosCorte(closureId);
      const r = await cloudSync.llamarFiscal("corte-email", { id: String(reserva.id).toLowerCase(), corte });
      const recipients = Number(r?.recipients ?? r?.data?.recipients) || 0;
      await job(closureId, "ENVIADO", { recipients });
      return { ok: true, estado: "ENVIADO", recipients };
    } catch (e) {
      const error = e?.message || "No se confirmó el envío. Puedes reintentar: no se duplicará.";
      await job(closureId, "ERROR", { error }).catch(() => {});
      return { ok: false, estado: "ERROR", error, code: e?.code || null };
    }
  }

  ipcMain.handle(
    "corte:correo-lista",
    sesion.proteger("corte:correo-lista", async (_e, p = {}) => {
      try {
        const pool = await poolPromise;
        const r = await pool.request()
          .input("desde", sql.Date, p.desde || null)
          .input("hasta", sql.Date, p.hasta || null)
          .input("register_id", sql.Int, Number(p.registerId) || null)
          .input("solo_pendientes", sql.Bit, p.soloPendientes ? 1 : 0)
          .input("top", sql.Int, 200)
          .execute("sp_cash_closure_email_list");
        return { success: true, data: r.recordset, nube: nubeLista() };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );

  /* Un corte ({closureId}) o los pendientes de un periodo ({pendientes:true,
     desde, hasta}). Los ENVIADOS nunca entran: ni el SP los devuelve como
     pendientes ni la reserva los deja salir otra vez. */
  ipcMain.handle(
    "corte:correo-enviar",
    sesion.proteger("corte:correo-enviar", async (_e, p = {}, ses) => {
      try {
        const actor = sesion.actorDe(ses);
        if (!p.pendientes) {
          const id = Number(p.closureId);
          if (!Number.isSafeInteger(id) || id < 1) throw Error("Indica el corte.");
          const r = await enviarCorte(id, actor);
          return r.ok ? { success: true, data: r } : { success: false, error: r.error, data: r };
        }
        if (!nubeLista()) throw Error("Vincula la caja con Wybix en la nube para enviar cortes por correo.");
        const pool = await poolPromise;
        const lista = (await pool.request()
          .input("desde", sql.Date, p.desde || null)
          .input("hasta", sql.Date, p.hasta || null)
          .input("register_id", sql.Int, Number(p.registerId) || null)
          .input("solo_pendientes", sql.Bit, 1)
          .input("top", sql.Int, MAX_LOTE)
          .execute("sp_cash_closure_email_list")).recordset;
        const res = { enviados: 0, fallidos: 0, restantes: 0, errores: [] };
        // Uno por uno: la nube limita por hora y un error no debe frenar a los demás,
        // salvo que sea de configuración (sin dueños, límite): ahí se para.
        for (const c of lista) {
          const r = await enviarCorte(c.id, actor);
          if (r.ok) res.enviados++;
          else {
            res.fallidos++;
            res.errores.push({ id: c.id, error: r.error });
            if (DETIENEN_LOTE.has(r.code)) break;
          }
        }
        res.restantes = (await pool.request()
          .input("desde", sql.Date, p.desde || null)
          .input("hasta", sql.Date, p.hasta || null)
          .input("register_id", sql.Int, Number(p.registerId) || null)
          .input("solo_pendientes", sql.Bit, 1)
          .input("top", sql.Int, 500)
          .execute("sp_cash_closure_email_list")).recordset.length;
        return { success: true, data: res };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );

  return { enviarCorte };
}

module.exports = { registrar, _prueba: { fechaHora, hora, duracion } };
