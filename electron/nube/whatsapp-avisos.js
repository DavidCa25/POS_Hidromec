/*
 * AVISO POR WHATSAPP: «TU PEDIDO ESTÁ LISTO» (0068).
 *
 *   - Cuando las comandas de un pedido de mostrador quedan LISTAS y su
 *     cliente dejó teléfono, la caja principal le pide a la nube (función
 *     whatsapp-avisos) que le mande un WhatsApp con el número del día y el
 *     enlace de seguimiento del Local Host. Sale por el número de WhatsApp
 *     DEL NEGOCIO, que se conecta una vez desde Configuración (conexion()).
 *   - QUIÉN SE AVISA lo decide SQL (sp_whatsapp_pedido_candidatos): la misma
 *     regla de «listo» que el seguimiento del teléfono. Da igual qué pantalla
 *     marcó la comanda (KDS de la caja, tablet del Local Host, otra caja de
 *     la red): el barrido la encuentra.
 *   - LA BANDERA vive en dbo.whatsapp_pedido_avisos (sp_whatsapp_pedido_job):
 *     un aviso ENVIADO u OMITIDO no se vuelve a intentar, y su `id` es la
 *     llave de idempotencia con la nube: un reintento nunca manda dos.
 *   - Encendido/apagado, bajas del cliente y el mensaje viven en la nube.
 *     Aquí solo se guarda en memoria si el aviso está encendido, para no
 *     preguntarle a la nube por cada pedido cuando está apagado.
 *   - Solo la instalación principal barre (como el resto de la nube); sin
 *     nube vinculada no se intenta nada.
 */
const CADA_MS = 15_000;
const CONFIG_MS = 10 * 60_000;
/* Lo que no va a salir y no mejora reintentando: se anota OMITIDO. Sin el
   WhatsApp del negocio conectado (o con la plantilla sin aprobar) un pedido
   que ya está listo tampoco espera: para cuando se conecte, ya lo recogieron. */
const OMITEN = new Set(["DESACTIVADO", "OPT_OUT", "TEL_INVALIDO", "SIN_NUMERO", "PLANTILLA_PENDIENTE"]);

function crearAvisosWhatsapp({ pool, sql, llamar, disponible, urlDeSeguimiento = async () => null, log = () => {}, cadaMs = CADA_MS }) {
  let config = null;           // { pedido_listo, membresia, dias_antes, como_renovar }
  let configEn = 0;
  let corriendo = null;
  let reloj = null;
  let prontoT = null;

  async function job(cuentaId, accion, extra = {}) {
    const r = await (await pool()).request()
      .input("cuenta_id", sql.Int, cuentaId)
      .input("accion", sql.VarChar(10), accion)
      .input("code", sql.NVarChar(20), extra.code ? String(extra.code).slice(0, 20) : null)
      .input("error", sql.NVarChar(300), extra.error ? String(extra.error).slice(0, 300) : null)
      .execute("sp_whatsapp_pedido_job");
    return r.recordset[0];
  }

  /** Los ajustes de la nube (con caché). `forzar` vuelve a preguntar. */
  async function leerConfig(forzar = false) {
    if (!forzar && config && Date.now() - configEn < CONFIG_MS) return config;
    const r = await llamar({ action: "config", accion: "leer" });
    config = { ...r.config, cuenta: r.cuenta ?? null }; configEn = Date.now();
    return { ...config, principal: r.principal, proveedor: r.proveedor ?? null, conectable: !!r.conectable };
  }

  async function guardarConfig(nueva) {
    const r = await llamar({ action: "config", accion: "guardar", config: nueva });
    config = { ...r.config, cuenta: r.cuenta ?? null }; configEn = Date.now();
    if (config?.pedido_listo) pronto();
    return { ...config, principal: r.principal, proveedor: r.proveedor ?? null, conectable: !!r.conectable };
  }

  /** Avisa UN pedido ya reservado. Nunca lanza: deja la bandera en su estado. */
  async function avisar(c) {
    const reserva = await job(c.cuenta_id, "RESERVAR");
    if (reserva?.resultado !== "RESERVADO") return { estado: reserva?.resultado };
    try {
      const seg = await urlDeSeguimiento(c.cuenta_id).catch(() => null);
      const r = await llamar({
        action: "pedido_listo",
        id: String(reserva.id).toLowerCase(),
        numero: Number(c.numero_dia),
        telefono: String(c.telefono || "").trim(),
        url: seg?.url || null,
      });
      if (r?.enviado === false && OMITEN.has(r.code)) {
        await job(c.cuenta_id, "OMITIDO", { code: r.code, error: r.error });
        if (r.code === "DESACTIVADO" && config) config = { ...config, pedido_listo: false };
        return { estado: "OMITIDO", code: r.code };
      }
      if (r?.enviado === false) {                      // RATE_LIMIT u otro: se reintenta
        await job(c.cuenta_id, "ERROR", { code: r.code, error: r.error });
        return { estado: "ERROR", code: r.code };
      }
      await job(c.cuenta_id, "ENVIADO", { code: r?.code || "ENCOLADO" });
      return { estado: "ENVIADO", code: r?.code };
    } catch (e) {
      await job(c.cuenta_id, "ERROR", { code: e?.code, error: e?.message }).catch(() => {});
      return { estado: "ERROR", code: e?.code || null, error: e?.message };
    }
  }

  /** Un barrido: los pedidos listos que faltan por avisar. */
  async function revisar() {
    if (corriendo) return corriendo;
    corriendo = (async () => {
      const res = { avisados: 0, omitidos: 0, errores: 0 };
      try {
        if (!(await disponible())) return res;
        const cfg = await leerConfig().catch((e) => { log(`config: ${e.message}`); return null; });
        /* Apagado, o el negocio aún no conecta su WhatsApp: nada que barrer. */
        if (!cfg?.pedido_listo || cfg.cuenta?.status !== "ACTIVA") return res;
        const lista = (await (await pool()).request().input("top", sql.Int, 20)
          .execute("sp_whatsapp_pedido_candidatos")).recordset || [];
        for (const c of lista) {
          const r = await avisar(c);
          if (r.estado === "ENVIADO") res.avisados++;
          else if (r.estado === "OMITIDO") res.omitidos++;
          else if (r.estado === "ERROR") {
            res.errores++;
            if (r.code === "OFFLINE") break;           // sin internet: el siguiente barrido reintenta
          }
        }
      } catch (e) {
        log(`barrido: ${e.message}`);
      }
      return res;
    })().finally(() => { corriendo = null; });
    return corriendo;
  }

  /** Una comanda cambió: barrer en un momento (junta varios toques seguidos). */
  function pronto() {
    clearTimeout(prontoT);
    prontoT = setTimeout(() => { revisar().catch(() => {}); }, 600);
    prontoT.unref?.();
  }

  function iniciar() {
    if (reloj) return;
    reloj = setInterval(() => { revisar().catch(() => {}); }, cadaMs);
    reloj.unref?.();
  }
  function detener() {
    clearInterval(reloj); reloj = null;
    clearTimeout(prontoT); prontoT = null;
  }

  /** Conectar el WhatsApp del negocio: 'iniciar' (enlace de un solo uso),
   *  'estado' (refresca plantillas) o 'desconectar'. Olvida la caché. */
  async function conexion(accion) {
    const r = await llamar({ action: "conexion", accion });
    configEn = 0;
    if (accion !== "iniciar" && config) config = { ...config, cuenta: r.cuenta ?? null };
    if (r.cuenta?.status === "ACTIVA") pronto();
    return r;
  }

  return { revisar, pronto, iniciar, detener, leerConfig, guardarConfig, conexion, llamar };
}

module.exports = { crearAvisosWhatsapp };
