/*
 * CLUB (0063): membresías.
 *
 *   club:estado         lo que la caja enseña del cliente elegido (VENTAS_OPERAR)
 *   club:admin          Fidelización > Club: indicadores, planes, socios, dobles (REPORTES_VER)
 *   club:plan-guardar   alta/cambio de un plan (COMERCIAL_ADMINISTRAR)
 *   club:gestionar      cancelar una membresía o revisar un canje doble (VENTAS_SUPERVISAR)
 *   club:sincronizar    bajar ya lo de las demás sucursales (VENTAS_OPERAR)
 *   club:wallet-emitir  la tarjeta del cliente en Apple/Google Wallet (VENTAS_OPERAR)
 *   club:wallet-resolver  la caja leyó WXC-<serial>: ¿qué cliente es? (VENTAS_OPERAR)
 *
 * Cobrar, afiliar, renovar y dar el beneficio NO pasan por aquí: son una venta
 * (sp_register_sale -> sp_membership_apply_sale) y su cotización.
 */
const sesion = require("../seguridad/sesion");

function registrar({ ipcMain, sql, poolPromise, cloudSync }) {
  const pool = () => poolPromise;
  const fallo = (e) => ({ success: false, error: String(e?.message || e) });

  ipcMain.handle("club:estado", sesion.proteger("club:estado", async (_e, p = {}) => {
    try {
      const id = Number(p.customerId);
      if (!Number.isSafeInteger(id) || id < 1) return { success: true, data: { membresias: [], productos: [], planes: [] } };
      const r = await (await pool()).request().input("customer_id", sql.Int, id).execute("sp_membership_status");
      return { success: true, data: { membresias: r.recordsets[0] ?? [], productos: r.recordsets[1] ?? [], planes: r.recordsets[2] ?? [] } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("club:admin", sesion.proteger("club:admin", async (_e, p = {}) => {
    try {
      const r = await (await pool()).request()
        .input("buscar", sql.NVarChar(80), p.buscar ? String(p.buscar).slice(0, 80) : null)
        .input("estado", sql.VarChar(12), p.estado || null)
        .execute("sp_membership_admin");
      const [k = [], planes = [], socios = [], dobles = []] = r.recordsets;
      return {
        success: true,
        data: {
          resumen: k[0] ?? null,
          planes: planes.map((x) => ({ ...x, productos: x.productos_json ? JSON.parse(x.productos_json) : [] })),
          socios, dobles,
          nube: !!(cloudSync.getCloudConfig?.()?.enabled),
        },
      };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("club:plan-guardar", sesion.proteger("club:plan-guardar", async (_e, p = {}) => {
    try {
      const productos = Array.isArray(p.productos) ? p.productos.map(Number).filter((x) => Number.isSafeInteger(x) && x > 0).slice(0, 200) : [];
      const r = await (await pool()).request()
        .input("id", sql.Int, Number(p.id) || null)
        .input("name", sql.NVarChar(80), String(p.nombre ?? "").slice(0, 80))
        .input("sale_product_id", sql.Int, Number(p.productoCobro) || null)
        .input("period_days", sql.Int, Number(p.dias) || 30)
        .input("daily_limit", sql.Int, Number(p.limiteDiario) || 1)
        .input("grace_days", sql.Int, Number(p.gracia) || 0)
        .input("active", sql.Bit, p.activo === false ? 0 : 1)
        .input("products_json", sql.NVarChar(sql.MAX), JSON.stringify(productos))
        .execute("sp_membership_plan_save");
      cloudSync.hechosAhora?.();
      return { success: true, data: { id: r.recordset?.[0]?.id ?? null } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("club:gestionar", sesion.proteger("club:gestionar", async (_e, p = {}, ses) => {
    try {
      const accion = p.accion === "CANCELAR" ? "CANCELAR" : p.accion === "REVISAR" ? "REVISAR" : null;
      if (!accion) throw Error("Acción no válida.");
      await (await pool()).request()
        .input("accion", sql.VarChar(10), accion)
        .input("id", sql.Int, Number(p.id))
        .input("user_id", sql.Int, sesion.actorDe(ses))
        .input("nota", sql.NVarChar(200), p.nota ? String(p.nota).slice(0, 200) : null)
        .execute("sp_membership_manage");
      cloudSync.hechosAhora?.();
      return { success: true };
    } catch (e) { return fallo(e); }
  }));

  /* ---------------------------------------------- 0066 · tarjeta en Wallet */
  const COLOR = /^#[0-9a-f]{6}$/i;
  const png = (x) => (typeof x === "string" && x.length < 250000 && /^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(x) ? x : null);
  let marcaSubida = null;
  const aplicarPases = async (pases) => (await pool()).request()
    .input("payload", sql.NVarChar(sql.MAX), JSON.stringify(pases)).execute("sp_club_wallet_apply");
  const resolverLocal = async (serial) => (await (await pool()).request()
    .input("serial", sql.VarChar(40), serial).execute("sp_club_wallet_resolve")).recordset?.[0] ?? null;

  /* La marca (colores y logo del addon, si lo hay) sube una vez por arranque:
     la nube la usa para pintar todos los pases de la empresa. */
  async function subirMarca(m) {
    if (!m || ![m.fondo, m.texto, m.etiqueta].every((c) => typeof c === "string" && COLOR.test(c))) return;
    const marca = { fondo: m.fondo, texto: m.texto, etiqueta: m.etiqueta, logo_png: png(m.logo_png), icon_png: png(m.icon_png) };
    const huella = JSON.stringify(marca);
    if (huella === marcaSubida) return;
    await cloudSync.clubWallet("marca", marca);
    marcaSubida = huella;
  }

  ipcMain.handle("club:wallet-emitir", sesion.proteger("club:wallet-emitir", async (_e, p = {}) => {
    try {
      const id = Number(p.customerId);
      if (!Number.isSafeInteger(id) || id < 1) throw Error("Elige un cliente.");
      const c = (await (await pool()).request().input("customer_id", sql.Int, id).execute("sp_club_wallet_customer")).recordset?.[0];
      if (!c) throw Error("El cliente no existe.");
      if (!c.phone_key) throw Error("El cliente necesita un teléfono de 10 dígitos para su tarjeta.");
      if (!cloudSync.getCloudConfig?.()?.enabled || !cloudSync.clubWallet) throw Error("La tarjeta en Wallet necesita la nube de Wybix activa (Configuración > Nube).");
      try { await subirMarca(p.marca); } catch { /* sin marca, el pase sale con los colores de Wybix */ }
      const r = await cloudSync.clubWallet("emitir", { phone: c.phone_key, customer_name: c.customer_name });
      await aplicarPases([{ serial: r.serial, phone: c.phone_key, customer_name: c.customer_name }]);
      return { success: true, data: { url: r.url, codigo: r.codigo, apple: r.apple ?? null, google: r.google ?? null, nombre: c.customer_name } };
    } catch (e) { return fallo(e); }
  }));

  /* Primero la base local (sin internet); si el pase no está, la nube (uno
     emitido en otra sucursal antes de la siguiente bajada del Club). */
  ipcMain.handle("club:wallet-resolver", sesion.proteger("club:wallet-resolver", async (_e, p = {}) => {
    try {
      const m = /^\s*WXC-([0-9a-f]{24})\s*$/i.exec(String(p.codigo ?? ""));
      if (!m) throw Error("Ese código no es una tarjeta del Club.");
      const serial = m[1].toLowerCase();
      let f = await resolverLocal(serial);
      if (!f?.pase && cloudSync.getCloudConfig?.()?.enabled && cloudSync.clubWallet) {
        try {
          const r = await cloudSync.clubWallet("resolver", { codigo: "WXC-" + serial });
          await aplicarPases([{ serial, phone: r.phone, customer_name: r.customer_name }]);
          f = await resolverLocal(serial);
        } catch (e) {
          if (e.code === "OFFLINE") throw Error("Esta tarjeta no está en esta caja y no hay internet para buscarla. Busca al cliente por su teléfono.");
          throw e;
        }
      }
      if (!f?.pase) throw Error("Esta tarjeta no es de este negocio.");
      if (!f.customer_id) throw Error("No se encontró al cliente de esta tarjeta. Búscalo por su teléfono.");
      return { success: true, data: { customerId: f.customer_id, nombre: f.customer_name } };
    } catch (e) { return fallo(e); }
  }));

  ipcMain.handle("club:sincronizar", sesion.proteger("club:sincronizar", async () => {
    try {
      const r = await cloudSync.club?.bajar?.();
      if (r?.error) throw Error(r.error);
      return { success: true, data: r ?? null };
    } catch (e) { return fallo(e); }
  }));
}

module.exports = { registrar };
