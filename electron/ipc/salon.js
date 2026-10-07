/**
 * MESAS, CUENTAS, COMANDAS Y KDS.
 *
 * Canales finos sobre los procedimientos de 0040. La logica vive en SQL: aqui
 * solo se pasan parametros, se protege cada canal y se imprimen las comandas
 * que van a papel.
 *
 * QUE MODULO EXIGE CADA COSA
 * --------------------------
 *   salon (areas, mesas)            modulo `mesas`
 *   estaciones, KDS, comandas       modulo `comandas`
 *   cuentas                         modulo `hospitality`: una cuenta de barra
 *                                   existe sin mesas, y una mesa sin cocina
 *                                   tambien guarda lo que se pidio.
 *
 * Los paquetes (quien puede) estan en `seguridad/canales.js`, como todos.
 */
const sesion = require('../seguridad/sesion');
const { comandaHtml } = require('../lib/comanda-html');

const MESAS = { modulo: 'mesas' };
const COMANDAS = { modulo: 'comandas' };
const HOSPITALITY = { modulo: 'hospitality' };

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Un error de negocio (RAISERROR) se ensena tal cual; uno interno no. */
function paraElUsuario(e, queSeIntentaba) {
  const n = Number(e?.number ?? e?.originalError?.info?.number);
  const clase = Number(e?.class ?? e?.originalError?.info?.class);
  if ((Number.isFinite(n) && n >= 50000) || clase === 16) return e.message;
  return `No se pudo ${queSeIntentaba}. Vuelve a intentarlo y, si sigue, avisa a soporte con la hora.`;
}

async function ejecutar(pool, nombre, construir, queSeIntentaba = 'completar la operación') {
  try {
    const req = pool.request();
    if (construir) construir(req);
    const r = await req.execute(nombre);
    return { success: true, data: r.recordset ?? [], sets: r.recordsets ?? [] };
  } catch (e) {
    console.error(`[SALON] ${nombre}:`, e.message);
    return { success: false, error: paraElUsuario(e, queSeIntentaba) };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registrar({ ipcMain, sql, poolPromise, imprimirHtml, loadDeviceConfig, alCambiarComandas = () => {} }) {
  const pool = () => poolPromise;
  /* El Local Host se entera igual por la base (sondeo corto); esto solo le
     ahorra la espera cuando el cambio sale de ESTA computadora. */
  const avisar = (r) => { if (r?.success) { try { alCambiarComandas(); } catch { /* noop */ } } return r; };

  // ================================================================ SALON
  ipcMain.handle('salon:get', sesion.proteger('salon:get',
    async () => ejecutar(await pool(), 'sp_salon_get', null, 'leer el salón'), MESAS));

  ipcMain.handle('salon:area-guardar', sesion.proteger('salon:area-guardar',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salon_area_save', (r) => r
      .input('id', sql.Int, numero(p.id))
      .input('nombre', sql.NVarChar(60), String(p.nombre ?? ''))
      .input('orden', sql.Int, Number(p.orden ?? 0))
      .input('activa', sql.Bit, p.activa === false ? 0 : 1), 'guardar el área'), MESAS));

  ipcMain.handle('salon:mesa-guardar', sesion.proteger('salon:mesa-guardar',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salon_mesa_save', (r) => r
      .input('id', sql.Int, numero(p.id))
      .input('area_id', sql.Int, numero(p.areaId))
      .input('nombre', sql.NVarChar(40), String(p.nombre ?? ''))
      .input('capacidad', sql.Int, numero(p.capacidad))
      .input('orden', sql.Int, Number(p.orden ?? 0))
      .input('activa', sql.Bit, p.activa === false ? 0 : 1), 'guardar la mesa'), MESAS));

  // ============================================================ ESTACIONES
  /* Leer las estaciones lo necesita el KDS para su selector: es operacion. */
  ipcMain.handle('estaciones:listar', sesion.proteger('estaciones:listar',
    async () => ejecutar(await pool(), 'sp_prep_stations_get', null, 'leer las estaciones'), COMANDAS));

  ipcMain.handle('estaciones:guardar', sesion.proteger('estaciones:guardar',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_prep_station_save', (r) => r
      .input('id', sql.Int, numero(p.id))
      .input('nombre', sql.NVarChar(40), String(p.nombre ?? ''))
      .input('salida', sql.NVarChar(10), String(p.salida ?? 'PANTALLA'))
      .input('impresora', sql.NVarChar(200), p.impresora ?? null)
      .input('ancho_mm', sql.Int, numero(p.anchoMm))
      .input('orden', sql.Int, Number(p.orden ?? 0))
      .input('activa', sql.Bit, p.activa === false ? 0 : 1), 'guardar la estación'), COMANDAS));

  ipcMain.handle('estaciones:productos', sesion.proteger('estaciones:productos',
    async () => ejecutar(await pool(), 'sp_product_prep_get', null, 'leer los productos'), COMANDAS));

  ipcMain.handle('estaciones:producto-asignar', sesion.proteger('estaciones:producto-asignar',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_product_prep_set', (r) => r
      .input('product_id', sql.Int, numero(p.productId))
      .input('station_id', sql.Int, numero(p.stationId)), 'asignar la estación'), COMANDAS));

  // ============================================================== CUENTAS
  ipcMain.handle('cuentas:abrir', sesion.proteger('cuentas:abrir',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_hosp_cuenta_abrir', (r) => r
      .input('mesa_id', sql.Int, numero(p.mesaId))
      .input('etiqueta', sql.NVarChar(60), p.etiqueta ?? null)
      .input('personas', sql.Int, numero(p.personas))
      .input('user_id', sql.Int, s?.userId ?? null)
      .input('register_id', sql.Int, numero(p.registerId))
      .input('customer_id', sql.Int, numero(p.customerId)), 'abrir la cuenta'), HOSPITALITY));

  /* El cliente de una cuenta abierta: elegirlo, cambiarlo o quitarlo (null).
     La cuenta es la fuente mientras no se cobra; al cobrar manda la venta. */
  ipcMain.handle('cuentas:cliente', sesion.proteger('cuentas:cliente',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_hosp_cuenta_cliente', (r) => r
      .input('cuenta_id', sql.Int, numero(p.cuentaId))
      .input('customer_id', sql.Int, numero(p.customerId))
      .input('user_id', sql.Int, s?.userId ?? null), 'cambiar el cliente de la cuenta'), HOSPITALITY));

  /* Que productos de una lista van a preparacion (estacion activa). Solo
     lectura; la caja lo pregunta antes de cobrar algo que no se envio. */
  ipcMain.handle('cuentas:preparacion', sesion.proteger('cuentas:preparacion',
    async (_e, p = {}) => {
      const ids = (Array.isArray(p.productIds) ? p.productIds : []).map(numero).filter(Boolean).slice(0, 200);
      if (!ids.length) return { success: true, data: [], sets: [[]] };
      return ejecutar(await pool(), 'sp_hosp_productos_con_preparacion', (r) => r
        .input('ids', sql.NVarChar(2000), ids.join(',')), 'revisar qué va a preparación');
    }, HOSPITALITY));

  ipcMain.handle('cuentas:obtener', sesion.proteger('cuentas:obtener',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_hosp_cuenta_get', (r) => r
      .input('cuenta_id', sql.Int, numero(p.cuentaId)), 'leer la cuenta'), HOSPITALITY));

  /**
   * ENVIAR: guarda lo pedido en la cuenta y crea una comanda por estacion.
   *
   * Las comandas de estaciones con impresora se imprimen AQUI, en la caja que
   * envia. Si la impresora falla, el envio NO se deshace: la comanda ya existe,
   * esta en el KDS y se puede reimprimir. Se devuelve que se imprimio y que no.
   *
   * Una sola forma de enviar a preparacion, la use quien la use: Touch y
   * Venta por este canal, y el mesero desde una tablet (Wybix Local Host)
   * llamando a esta MISMA funcion. Mismo procedimiento, misma impresion,
   * mismo aviso. No hay un segundo flujo de Hospitality.
   */
  async function enviarOrden(p = {}, userId = null) {
    const lineas = Array.isArray(p.lineas) ? p.lineas : [];
    if (!lineas.length) return { success: false, error: 'No hay nada que enviar.' };

    /* `origen` lo pone la pantalla a cada linea y no cambia al reintentar:
       la base salta las que ya tiene (0042). Asi un reintento no duplica
       nada en cocina. */
    const tl = new sql.Table('dbo.HospOrdenLineaV2Type');
    tl.columns.add('linea', sql.Int, { nullable: false });
    tl.columns.add('product_id', sql.Int, { nullable: false });
    tl.columns.add('cantidad', sql.Decimal(12, 3), { nullable: false });
    tl.columns.add('nota', sql.NVarChar(200), { nullable: true });
    tl.columns.add('origen', sql.UniqueIdentifier, { nullable: true });
    const to = new sql.Table('dbo.HospOrdenOpcionType');
    to.columns.add('linea', sql.Int, { nullable: false });
    to.columns.add('modifier_option_id', sql.Int, { nullable: false });
    to.columns.add('quantity', sql.Int, { nullable: false });

    lineas.forEach((l, i) => {
      const n = i + 1;
      const origen = UUID.test(String(l.origen ?? '')) ? String(l.origen) : null;
      tl.rows.add(n, Number(l.productId), Number(l.cantidad), l.nota ? String(l.nota).slice(0, 200) : null, origen);
      for (const o of (l.opciones || [])) to.rows.add(n, Number(o.optionId), Math.max(1, Number(o.quantity || 1)));
    });

    const r = await ejecutar(await pool(), 'sp_hosp_orden_enviar', (req) => req
      .input('cuenta_id', sql.Int, numero(p.cuentaId))
      .input('user_id', sql.Int, userId ?? null)
      .input('lineas', tl)
      .input('opciones', to)
      .input('commercial', sql.NVarChar(sql.MAX),p.commercial?JSON.stringify(p.commercial):null), 'enviar la orden');
    if (!r.success) return r;

    const comandas = r.sets[1] || [];
    const impresion = [];
    for (const c of comandas.filter(x => x.salida === 'IMPRESORA' || x.salida === 'AMBOS')) {
      impresion.push({ id: c.id, estacion: c.estacion, ...(await imprimirComanda(c.id, false)) });
    }
    avisar(r);
    return { success: true, data: { orden: r.sets[0]?.[0] ?? null, comandas, impresion } };
  }

  ipcMain.handle('cuentas:enviar', sesion.proteger('cuentas:enviar',
    async (_e, p = {}, s) => enviarOrden(p, s?.userId ?? null), HOSPITALITY));

  ipcMain.handle('cuentas:estado', sesion.proteger('cuentas:estado',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_hosp_cuenta_estado', (r) => r
      .input('cuenta_id', sql.Int, numero(p.cuentaId))
      .input('estado', sql.NVarChar(12), String(p.estado ?? ''))
      .input('user_id', sql.Int, s?.userId ?? null), 'cambiar el estado de la cuenta'), HOSPITALITY));

  ipcMain.handle('cuentas:cobrada', sesion.proteger('cuentas:cobrada',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_hosp_cuenta_cobrar', (r) => r
      .input('cuenta_id', sql.Int, numero(p.cuentaId))
      .input('sale_id', sql.Int, numero(p.saleId))
      .input('user_id', sql.Int, s?.userId ?? null), 'cerrar la cuenta'), HOSPITALITY));

  ipcMain.handle('cuentas:liberar', sesion.proteger('cuentas:liberar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_hosp_cuenta_liberar', (r) => r
      .input('cuenta_id', sql.Int, numero(p.cuentaId))
      .input('user_id', sql.Int, s?.userId ?? null), 'liberar la mesa'), HOSPITALITY));

  // ================================================================== KDS
  ipcMain.handle('kds:listar', sesion.proteger('kds:listar',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_kds_get', (r) => r
      .input('station_id', sql.Int, numero(p.stationId))
      .input('comanda_id', sql.Int, null), 'leer las comandas'), COMANDAS));

  ipcMain.handle('kds:estado', sesion.proteger('kds:estado',
    async (_e, p = {}, s) => avisar(await ejecutar(await pool(), 'sp_comanda_estado', (r) => r
      .input('comanda_id', sql.Int, numero(p.comandaId))
      .input('estado', sql.NVarChar(12), String(p.estado ?? ''))
      .input('user_id', sql.Int, s?.userId ?? null), 'cambiar la comanda')), COMANDAS));

  ipcMain.handle('comandas:cancelar', sesion.proteger('comandas:cancelar',
    async (_e, p = {}, s) => avisar(await ejecutar(await pool(), 'sp_comanda_cancelar', (r) => r
      .input('comanda_id', sql.Int, numero(p.comandaId))
      .input('motivo', sql.NVarChar(200), p.motivo ?? null)
      .input('user_id', sql.Int, s?.userId ?? null), 'cancelar la comanda')), COMANDAS));

  ipcMain.handle('comandas:reimprimir', sesion.proteger('comandas:reimprimir',
    async (_e, p = {}) => {
      const r = await imprimirComanda(numero(p.comandaId), true);
      return r.ok ? { success: true } : { success: false, error: r.error };
    }, COMANDAS));

  // ============================================================ REPORTES
  ipcMain.handle('reportes:actividad-horaria', sesion.proteger('reportes:actividad-horaria',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_report_actividad_horaria', (r) => r
      .input('desde', sql.Date, p.desde ? new Date(`${p.desde}T00:00:00`) : null)
      .input('hasta', sql.Date, p.hasta ? new Date(`${p.hasta}T00:00:00`) : null), 'calcular la actividad')));

  // -------------------------------------------------------------- impresion
  async function imprimirComanda(comandaId, reimpresion) {
    if (!comandaId) return { ok: false, error: 'Falta la comanda.' };
    const r = await ejecutar(await pool(), 'sp_kds_get', (req) => req
      .input('station_id', sql.Int, null)
      .input('comanda_id', sql.Int, comandaId), 'leer la comanda');
    if (!r.success) return { ok: false, error: r.error };
    const [cab, lineas, opciones] = r.sets;
    const c = cab?.[0];
    if (!c) return { ok: false, error: 'La comanda no existe.' };

    const est = await ejecutar(await pool(), 'sp_prep_stations_get');
    const estacion = (est.data || []).find(x => x.id === c.station_id);
    if (!estacion?.impresora) return { ok: false, error: `La estación ${c.estacion} no tiene impresora.` };

    let ancho = Number(estacion.ancho_mm) || 0;
    if (!ancho) {
      try { ancho = /80/.test(String(loadDeviceConfig?.()?.printer?.paperSize || '')) ? 80 : 58; } catch { ancho = 58; }
    }
    const html = comandaHtml(c, lineas || [], opciones || [], { anchoMm: ancho, reimpresion });
    const ok = await imprimirHtml(html, { printerName: estacion.impresora, paperWidthMm: ancho, silent: true });
    return ok ? { ok: true } : { ok: false, error: `No se pudo imprimir en «${estacion.impresora}».` };
  }

  /* Lo que el Local Host reutiliza para el mesero: las mismas funciones que
     atienden a Touch y Venta. */
  const abrirCuenta = async (p = {}, userId = null) => ejecutar(await pool(), 'sp_hosp_cuenta_abrir', (r) => r
    .input('mesa_id', sql.Int, numero(p.mesaId))
    .input('etiqueta', sql.NVarChar(60), p.etiqueta ?? null)
    .input('personas', sql.Int, numero(p.personas))
    .input('user_id', sql.Int, userId)
    .input('register_id', sql.Int, numero(p.registerId)), 'abrir la cuenta');
  const leerCuenta = async (cuentaId) => ejecutar(await pool(), 'sp_hosp_cuenta_get', (r) => r
    .input('cuenta_id', sql.Int, numero(cuentaId)), 'leer la cuenta');
  const leerSalon = async () => ejecutar(await pool(), 'sp_salon_get', null, 'leer el salón');
  const leerMenu = async () => ejecutar(await pool(), 'sp_get_menu_catalog', null, 'leer el menú');
  return { enviarOrden, abrirCuenta, leerCuenta, leerSalon, leerMenu };
}

module.exports = { registrar };
