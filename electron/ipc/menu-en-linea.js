/*
 * MENÚ EN LÍNEA (0067): pedidos para recoger desde el celular del cliente.
 *
 *   menu-linea:config        la configuración y cómo va la nube (VENTAS_OPERAR: la
 *                            bandeja la necesita para saber si hay menú)
 *   menu-linea:guardar       publicar, dejar de recibir, dirección, tiempo, marca
 *                            (CONFIGURACION_ADMINISTRAR)
 *   menu-linea:pedidos       la bandeja: pendientes y los de hoy (VENTAS_OPERAR)
 *   menu-linea:aceptar       aceptar = abrir su cuenta (número del día) y mandarlo
 *                            a preparación con el MISMO canal que Touch
 *                            (salon.js#enviarOrden). No cobra ni descuenta.
 *   menu-linea:rechazar      con motivo, que el cliente ve
 *   menu-linea:sincronizar   publicar y bajar ya, sin esperar el ciclo
 *
 * Cobrar es lo de siempre: la cuenta queda abierta en Touch con su número.
 */
const sesion = require('../seguridad/sesion');

const HOSPITALITY = { modulo: 'hospitality' };

function numero(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Un error de negocio (RAISERROR) se enseña tal cual; uno interno no. */
function paraElUsuario(e, queSeIntentaba) {
  const n = Number(e?.number ?? e?.originalError?.info?.number);
  const clase = Number(e?.class ?? e?.originalError?.info?.class);
  if ((Number.isFinite(n) && n >= 50000) || clase === 16) return e.message;
  return `No se pudo ${queSeIntentaba}. Vuelve a intentarlo y, si sigue, avisa a soporte con la hora.`;
}

/** Lo que guarda la base -> lo que pinta la bandeja. */
function publico(x) {
  let lineas = [];
  try { lineas = JSON.parse(x.lineas || '[]'); } catch { lineas = []; }
  return {
    id: x.id, uuid: String(x.uuid).toLowerCase(), origen: x.origen, nombre: x.cliente_nombre, telefono: x.cliente_telefono,
    nota: x.nota, total: Number(x.total_cliente) || 0, minutos: Math.max(0, Number(x.minutos_espera) || 0), estado: x.estado, estadoCliente: x.estado_cliente,
    motivo: x.motivo, cuentaId: x.cuenta_id, numero: x.numero_dia ?? null,
    lineas: lineas.map((l) => ({
      nombre: l.nombre, cantidad: Number(l.cantidad) || 1, precio: Number(l.precio) || 0, nota: l.nota || null,
      opciones: (l.opciones || []).map((o) => ({ nombre: o.nombre, delta: Number(o.price_delta) || 0, cantidad: Number(o.quantity) || 1 })),
    })),
  };
}

function registrar({ ipcMain, sql, poolPromise, cloudSync, hospitality, cajaDeEsteEquipo = () => null }) {
  const pool = () => poolPromise;

  async function leerConfig() {
    const r = await (await pool()).request().input('guardar', sql.Bit, 0).execute('sp_menu_en_linea_config');
    return r.recordset?.[0] ?? null;
  }

  ipcMain.handle('menu-linea:config', sesion.proteger('menu-linea:config', async () => {
    try {
      const c = await leerConfig();
      const nube = cloudSync.getCloudConfig?.() || {};
      return {
        success: true,
        data: {
          activo: !!c?.activo, recibePedidos: !!c?.recibe_pedidos, slug: c?.slug ?? null,
          minutos: Number(c?.minutos_estimados) || 15, mensaje: c?.mensaje ?? null, pendientes: Number(c?.pendientes) || 0,
          nube: !!nube.enabled, sincronizacion: cloudSync.menuEnLinea?.estado?.() ?? null,
        },
      };
    } catch (e) { return { success: false, error: paraElUsuario(e, 'leer el menú en línea') }; }
  }, HOSPITALITY));

  ipcMain.handle('menu-linea:guardar', sesion.proteger('menu-linea:guardar', async (_e, p = {}, s) => {
    try {
      const r = await (await pool()).request()
        .input('guardar', sql.Bit, 1)
        .input('activo', sql.Bit, p.activo == null ? null : !!p.activo)
        .input('recibe_pedidos', sql.Bit, p.recibePedidos == null ? null : !!p.recibePedidos)
        .input('slug', sql.NVarChar(40), p.slug ? String(p.slug).slice(0, 40) : null)
        .input('minutos_estimados', sql.Int, numero(p.minutos))
        .input('mensaje', sql.NVarChar(200), p.mensaje ? String(p.mensaje).slice(0, 200) : null)
        .input('user_id', sql.Int, sesion.actorDe(s))
        .execute('sp_menu_en_linea_config');
      /* La marca sale del addon (hueco `menuEnLinea`): logo y colores. El núcleo
         solo la guarda y la publica; no sabe de quién es. */
      if (p.marca !== undefined) cloudSync.guardarMarcaMenu?.(limpiarMarca(p.marca));
      let publicado = null;
      try { publicado = await cloudSync.menuEnLinea?.publicar?.(true); } catch { publicado = null; }
      return { success: true, data: { config: r.recordset?.[0] ?? null, publicado } };
    } catch (e) { return { success: false, error: paraElUsuario(e, 'guardar el menú en línea') }; }
  }, HOSPITALITY));

  ipcMain.handle('menu-linea:pedidos', sesion.proteger('menu-linea:pedidos', async () => {
    try {
      const r = await (await pool()).request().input('por_publicar', sql.Bit, 0).execute('sp_pedidos_en_linea_listar');
      return { success: true, data: (r.recordset || []).map(publico) };
    } catch (e) { return { success: false, error: paraElUsuario(e, 'leer los pedidos en línea') }; }
  }, HOSPITALITY));

  ipcMain.handle('menu-linea:aceptar', sesion.proteger('menu-linea:aceptar', async (_e, p = {}, s) => {
    const id = numero(p.id);
    if (!id) return { success: false, error: 'Falta el pedido.' };
    const userId = sesion.actorDe(s);
    let r;
    try {
      r = await (await pool()).request()
        .input('id', sql.Int, id).input('user_id', sql.Int, userId).input('register_id', sql.Int, numero(cajaDeEsteEquipo()))
        .execute('sp_pedido_en_linea_aceptar');
    } catch (e) { return { success: false, error: paraElUsuario(e, 'aceptar el pedido') }; }
    const cab = r.recordsets?.[0]?.[0];
    const lineas = (r.recordsets?.[1] || []).map((l) => {
      let ops = [];
      try { ops = JSON.parse(l.opciones || '[]'); } catch { ops = []; }
      return { productId: l.product_id, cantidad: Number(l.cantidad), nota: l.nota || null, origen: String(l.origen).toLowerCase(),
               opciones: ops.map((o) => ({ optionId: o.option_id, quantity: o.quantity || 1 })) };
    });
    /* El mismo envío que Touch: líneas, comandas por estación, impresión y
       aviso al Local Host. Si falla y no llegó nada a cocina, se deshace. */
    const env = await hospitality.enviarOrden({ cuentaId: cab.cuenta_id, lineas }, userId);
    if (!env.success) {
      try {
        await (await pool()).request().input('id', sql.Int, id).input('user_id', sql.Int, userId).execute('sp_pedido_en_linea_revertir');
      } catch { /* sigue ACEPTADO: aceptar otra vez reintenta el envío */ }
      return { success: false, error: env.error || 'No se pudo mandar a preparación.' };
    }
    void cloudSync.menuEnLinea?.bandeja?.();
    return { success: true, data: { cuentaId: cab.cuenta_id, numero: cab.numero_dia, impresion: env.data?.impresion ?? [] } };
  }, HOSPITALITY));

  ipcMain.handle('menu-linea:rechazar', sesion.proteger('menu-linea:rechazar', async (_e, p = {}, s) => {
    try {
      await (await pool()).request()
        .input('id', sql.Int, numero(p.id))
        .input('motivo', sql.NVarChar(200), String(p.motivo ?? '').slice(0, 200))
        .input('user_id', sql.Int, sesion.actorDe(s))
        .execute('sp_pedido_en_linea_rechazar');
      void cloudSync.menuEnLinea?.bandeja?.();
      return { success: true };
    } catch (e) { return { success: false, error: paraElUsuario(e, 'rechazar el pedido') }; }
  }, HOSPITALITY));

  ipcMain.handle('menu-linea:sincronizar', sesion.proteger('menu-linea:sincronizar', async () => {
    const r = await cloudSync.menuEnLinea?.sincronizar?.();
    return r?.error ? { success: false, error: 'Sin conexión con la nube. Los pedidos llegan cuando vuelva.' } : { success: true, data: r ?? null };
  }, HOSPITALITY));
}

/** Solo lo que la página sabe pintar: un logo pequeño y dos colores. */
function limpiarMarca(m) {
  if (!m || typeof m !== 'object') return null;
  const color = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);
  const logo = typeof m.logo === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(m.logo) && m.logo.length <= 90000 ? m.logo : null;
  const r = { logo, color: color(m.color), acento: color(m.acento) };
  return r.logo || r.color || r.acento ? r : null;
}

module.exports = { registrar, limpiarMarca };
