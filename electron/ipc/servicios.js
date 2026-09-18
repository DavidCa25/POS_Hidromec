/**
 * IPC del dominio Servicios.
 *
 * Mismo criterio que electron/ipc/hospitality.js: aqui no hay reglas de
 * negocio. Cada handler traduce el payload a parametros y ejecuta su
 * procedure. Que un presupuesto necesite reautorizacion, quien puede hacer
 * que servicio y cuanto comisiona cada linea lo decide SQL, siempre.
 *
 * EL PREFIJO ES `servicios:`, NO `services:`
 * ------------------------------------------
 * `services:` ya existe y significa otra cosa: los servicios de WINDOWS, que
 * el panel de red arranca y para para SQL Server. Reutilizar ese prefijo
 * habria puesto dos cosas sin ninguna relacion en la misma familia de canales,
 * y el dia que alguien filtrara por `services:` se llevaria las dos.
 *
 * CADA ESCRITURA EXIGE PAQUETE Y MODULO
 * -------------------------------------
 * Dos preguntas distintas: «¿esta persona puede?» y «¿el negocio tiene esta
 * funcion?». La primera la responde el paquete; la segunda, el modulo. Un
 * Administrador de un negocio sin Servicios encendido no puede abrir una orden
 * de servicio, y eso no es un fallo de permisos.
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
    const msg = String(e.message || e);
    console.error(`[SERVICIOS] ${nombre}:`, msg);
    /* El conflicto de version no es un error tecnico: es algo que le pasa a
       dos personas trabajando a la vez, y la pantalla tiene que poder
       distinguirlo para ofrecer recargar en vez de un "Error". */
    if (msg.includes('CONFLICTO_DE_VERSION')) {
      return {
        success: false,
        motivo: 'CONFLICTO_DE_VERSION',
        error: 'Alguien más cambió esta orden mientras la editabas. Vuelve a abrirla para ver lo último.',
      };
    }
    return { success: false, error: msg };
  }
}

/** Solo el modulo: la capacidad del negocio, sin exigir paquete. */
const CON_MODULO = { modulo: 'servicios' };

function registrar({ ipcMain, sql, poolPromise }) {
  const pool = () => poolPromise;

  const txt = (v, n = 400) => (v == null || v === '' ? null : String(v).slice(0, n));
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const bit = (v, porOmision = false) => (v == null ? (porOmision ? 1 : 0) : (v ? 1 : 0));
  const fecha = (v) => (v ? new Date(v) : null);
  /**
   * El testigo de version, de vuelta a los ocho bytes que espera SQL Server.
   *
   * Sale de la base como texto -`0x00000000000007D1`- justamente para poder
   * cruzar el puente de contextos sin deformarse: un Buffer llega al renderer
   * como una lista de numeros y ya no se puede reconstruir.
   *
   * Si lo que llega no es un testigo reconocible, se devuelve `null`, y `null`
   * significa «no compruebes la version». Eso es correcto para las llamadas
   * internas que ya saben que trabajan sobre la version buena, y seria un
   * agujero si una pantalla lo mandara mal: de eso se encarga la prueba de
   * extremo a extremo, que guarda dos veces con el mismo testigo y exige que
   * la segunda falle.
   */
  const rowver = (v) => {
    if (!v) return null;
    if (Buffer.isBuffer(v)) return v.length === 8 ? v : null;
    const hex = String(v).trim().replace(/^0x/i, '');
    return /^[0-9a-f]{16}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
  };

  // =====================================================================
  //  CATALOGO DE SERVICIOS
  // =====================================================================
  ipcMain.handle('servicios:catalogo', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_get_services', (r) => r
      .input('solo_activos', sql.Bit, bit(p.soloActivos, true))
      .input('busqueda', sql.NVarChar(100), txt(p.busqueda, 100))));

  ipcMain.handle('servicios:guardar-servicio', sesion.proteger('servicios:guardar-servicio',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_service_save', (r) => r
      .input('product_id', sql.Int, num(p.productId))
      .input('nombre', sql.NVarChar(100), txt(p.nombre, 100))
      .input('price', sql.Decimal(10, 2), num(p.precio))
      .input('part_number', sql.NVarChar(100), txt(p.clave, 100))
      .input('category_id', sql.Int, num(p.categoriaId))
      .input('clave_prod_serv', sql.NVarChar(8), txt(p.claveProdServ, 8))
      .input('clave_unidad', sql.NVarChar(5), txt(p.claveUnidad, 5))
      .input('tasa_iva', sql.Decimal(5, 4), num(p.tasaIva))
      .input('duration_minutes', sql.Int, num(p.duracionMinutos) ?? 30)
      .input('requires_professional', sql.Bit, bit(p.requiereProfesional, true))
      .input('default_commission_pct', sql.Decimal(5, 2), num(p.comisionPct))
      .input('schedulable', sql.Bit, bit(p.agendable, true))
      .input('notes', sql.NVarChar(400), txt(p.notas))),
    CON_MODULO));

  ipcMain.handle('servicios:activar-servicio', sesion.proteger('servicios:activar-servicio',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_service_set_active', (r) => r
      .input('product_id', sql.Int, num(p.productId))
      .input('active', sql.Bit, bit(p.activo))),
    CON_MODULO));

  ipcMain.handle('servicios:asignar-profesionales', sesion.proteger('servicios:asignar-profesionales',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_set_service_professionals', (r) => r
      .input('service_product_id', sql.Int, num(p.productId))
      .input('asignaciones_json', sql.NVarChar(sql.MAX), JSON.stringify(p.asignaciones || []))),
    CON_MODULO));

  // =====================================================================
  //  ACTIVOS DEL CLIENTE
  // =====================================================================
  ipcMain.handle('servicios:activos', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_get_customer_assets', (r) => r
      .input('customer_id', sql.Int, num(p.clienteId))
      .input('busqueda', sql.NVarChar(60), txt(p.busqueda, 60))
      .input('solo_activos', sql.Bit, bit(p.soloActivos, true))));

  ipcMain.handle('servicios:guardar-activo', sesion.proteger('servicios:guardar-activo',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_customer_asset_save', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('customer_id', sql.Int, num(p.clienteId))
      .input('kind', sql.NVarChar(20), txt(p.clase, 20) || 'OTRO')
      .input('label', sql.NVarChar(120), txt(p.etiqueta, 120))
      .input('identifier', sql.NVarChar(60), txt(p.identificador, 60))
      .input('secondary_identifier', sql.NVarChar(60), txt(p.identificadorDos, 60))
      .input('brand', sql.NVarChar(60), txt(p.marca, 60))
      .input('model', sql.NVarChar(60), txt(p.modelo, 60))
      .input('year_or_age', sql.NVarChar(20), txt(p.anioOEdad, 20))
      .input('color', sql.NVarChar(40), txt(p.color, 40))
      .input('notes', sql.NVarChar(400), txt(p.notas))),
    CON_MODULO));

  ipcMain.handle('servicios:activar-activo', sesion.proteger('servicios:activar-activo',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_customer_asset_set_active', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('active', sql.Bit, bit(p.activo))),
    CON_MODULO));

  // =====================================================================
  //  PROFESIONALES Y HORARIOS
  // =====================================================================
  ipcMain.handle('servicios:profesionales', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_get_professionals', (r) => r
      .input('solo_activos', sql.Bit, bit(p.soloActivos, true))
      .input('service_product_id', sql.Int, num(p.servicioId))));

  ipcMain.handle('servicios:guardar-profesional', sesion.proteger('servicios:guardar-profesional',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_professional_save', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('full_name', sql.NVarChar(120), txt(p.nombre, 120))
      .input('title', sql.NVarChar(60), txt(p.puesto, 60))
      .input('phone', sql.NVarChar(30), txt(p.telefono, 30))
      .input('email', sql.NVarChar(120), txt(p.email, 120))
      .input('user_id', sql.Int, num(p.usuarioId))
      .input('default_commission_pct', sql.Decimal(5, 2), num(p.comisionPct) ?? 0)
      .input('color', sql.NVarChar(9), txt(p.color, 9))),
    CON_MODULO));

  ipcMain.handle('servicios:activar-profesional', sesion.proteger('servicios:activar-profesional',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_professional_set_active', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('active', sql.Bit, bit(p.activo))),
    CON_MODULO));

  ipcMain.handle('servicios:horario', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_get_professional_schedule', (r) => r
      .input('professional_id', sql.Int, num(p.profesionalId))));

  ipcMain.handle('servicios:guardar-horario', sesion.proteger('servicios:guardar-horario',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_set_professional_schedule', (r) => r
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('franjas_json', sql.NVarChar(sql.MAX), JSON.stringify(p.franjas || []))),
    CON_MODULO));

  ipcMain.handle('servicios:guardar-ausencia', sesion.proteger('servicios:guardar-ausencia',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_professional_time_off_save', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('starts_at', sql.DateTime2, fecha(p.desde))
      .input('ends_at', sql.DateTime2, fecha(p.hasta))
      .input('reason', sql.NVarChar(200), txt(p.motivo, 200))),
    CON_MODULO));

  ipcMain.handle('servicios:borrar-ausencia', sesion.proteger('servicios:borrar-ausencia',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_professional_time_off_delete', (r) => r
      .input('id', sql.Int, num(p.id))),
    CON_MODULO));

  // =====================================================================
  //  ORDENES DE SERVICIO
  // =====================================================================
  ipcMain.handle('servicios:ordenes', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_service_order_list', (r) => r
      .input('estados', sql.NVarChar(200), txt(Array.isArray(p.estados) ? p.estados.join(',') : p.estados, 200))
      .input('customer_id', sql.Int, num(p.clienteId))
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('desde', sql.Date, p.desde ? new Date(p.desde) : null)
      .input('hasta', sql.Date, p.hasta ? new Date(p.hasta) : null)
      .input('busqueda', sql.NVarChar(100), txt(p.busqueda, 100))
      .input('top', sql.Int, num(p.top) ?? 200)));

  ipcMain.handle('servicios:orden', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_service_order_get', (r) => r
      .input('id', sql.Int, num(p.id))));

  ipcMain.handle('servicios:orden-crear', sesion.proteger('servicios:orden-crear',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_create', (r) => r
      .input('customer_id', sql.Int, num(p.clienteId))
      .input('customer_asset_id', sql.Int, num(p.activoId))
      .input('reported_issue', sql.NVarChar(1000), txt(p.reportado, 1000))
      .input('promised_at', sql.DateTime2, fecha(p.prometidaPara))
      .input('notes', sql.NVarChar(1000), txt(p.notas, 1000))
      /* El usuario sale de la SESION, no del payload: quien abre la orden es
         quien tiene la ventana, y el renderer no puede decir que fue otro. */
      .input('user_id', sql.Int, s?.userId ?? null)
      .input('register_id', sql.Int, num(p.cajaId))
      .input('status', sql.NVarChar(20), txt(p.estado, 20) || 'ABIERTA')),
    CON_MODULO));

  ipcMain.handle('servicios:orden-actualizar', sesion.proteger('servicios:orden-actualizar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_update', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('customer_asset_id', sql.Int, num(p.activoId))
      .input('reported_issue', sql.NVarChar(1000), txt(p.reportado, 1000))
      .input('diagnosis', sql.NVarChar(1000), txt(p.diagnostico, 1000))
      .input('promised_at', sql.DateTime2, fecha(p.prometidaPara))
      .input('notes', sql.NVarChar(1000), txt(p.notas, 1000))
      .input('rowver', sql.Binary(8), rowver(p.rowver))
      .input('user_id', sql.Int, s?.userId ?? null)),
    CON_MODULO));

  ipcMain.handle('servicios:orden-estado', sesion.proteger('servicios:orden-estado',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_set_status', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('status', sql.NVarChar(20), txt(p.estado, 20))
      .input('user_id', sql.Int, s?.userId ?? null)
      .input('rowver', sql.Binary(8), rowver(p.rowver))),
    CON_MODULO));

  ipcMain.handle('servicios:orden-autorizar', sesion.proteger('servicios:orden-autorizar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_authorize', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('by_name', sql.NVarChar(120), txt(p.autorizaNombre, 120))
      .input('channel', sql.NVarChar(20), txt(p.via, 20) || 'MOSTRADOR')
      .input('user_id', sql.Int, s?.userId ?? null)
      .input('rowver', sql.Binary(8), rowver(p.rowver))),
    CON_MODULO));

  ipcMain.handle('servicios:orden-cancelar', sesion.proteger('servicios:orden-cancelar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_cancel', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('reason', sql.NVarChar(400), txt(p.motivo))
      .input('user_id', sql.Int, s?.userId ?? null)
      .input('rowver', sql.Binary(8), rowver(p.rowver))),
    CON_MODULO));

  ipcMain.handle('servicios:linea-agregar', sesion.proteger('servicios:linea-agregar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_add_line', (r) => r
      .input('order_id', sql.Int, num(p.ordenId))
      .input('product_id', sql.Int, num(p.productoId))
      .input('quantity', sql.Decimal(12, 2), num(p.cantidad) ?? 1)
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('unit_price', sql.Decimal(12, 2), num(p.precio))
      .input('commission_pct', sql.Decimal(5, 2), num(p.comisionPct))
      .input('notes', sql.NVarChar(400), txt(p.notas))
      .input('user_id', sql.Int, s?.userId ?? null)),
    CON_MODULO));

  ipcMain.handle('servicios:linea-actualizar', sesion.proteger('servicios:linea-actualizar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_update_line', (r) => r
      .input('line_id', sql.Int, num(p.lineaId))
      .input('quantity', sql.Decimal(12, 2), num(p.cantidad))
      .input('unit_price', sql.Decimal(12, 2), num(p.precio))
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('commission_pct', sql.Decimal(5, 2), num(p.comisionPct))
      .input('status', sql.NVarChar(12), txt(p.estado, 12))
      .input('notes', sql.NVarChar(400), txt(p.notas))
      .input('user_id', sql.Int, s?.userId ?? null)),
    CON_MODULO));

  // =====================================================================
  //  COBRO
  // =====================================================================
  ipcMain.handle('servicios:cobro-previa', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_service_order_charge_preview', (r) => r
      .input('order_id', sql.Int, num(p.ordenId))));

  ipcMain.handle('servicios:orden-enlazar-venta', sesion.proteger('servicios:orden-enlazar-venta',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_service_order_link_sale', (r) => r
      .input('order_id', sql.Int, num(p.ordenId))
      .input('sale_id', sql.Int, num(p.ventaId))
      .input('user_id', sql.Int, s?.userId ?? null)),
    CON_MODULO));

  // =====================================================================
  //  AGENDA
  // =====================================================================
  ipcMain.handle('servicios:citas', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_appointment_list', (r) => r
      .input('desde', sql.DateTime2, fecha(p.desde))
      .input('hasta', sql.DateTime2, fecha(p.hasta))
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('estados', sql.NVarChar(200), txt(Array.isArray(p.estados) ? p.estados.join(',') : p.estados, 200))
      .input('customer_id', sql.Int, num(p.clienteId))));

  ipcMain.handle('servicios:cita', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_appointment_get', (r) => r
      .input('id', sql.Int, num(p.id))));

  ipcMain.handle('servicios:cita-guardar', sesion.proteger('servicios:cita-guardar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_appointment_save', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('customer_id', sql.Int, num(p.clienteId))
      .input('customer_asset_id', sql.Int, num(p.activoId))
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('service_product_id', sql.Int, num(p.servicioId))
      .input('starts_at', sql.DateTime2, fecha(p.desde))
      .input('ends_at', sql.DateTime2, fecha(p.hasta))
      .input('notes', sql.NVarChar(400), txt(p.notas))
      .input('permitir_encimar', sql.Bit, bit(p.permitirEncimar))
      .input('user_id', sql.Int, s?.userId ?? null)),
    CON_MODULO));

  ipcMain.handle('servicios:cita-estado', sesion.proteger('servicios:cita-estado',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_appointment_set_status', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('status', sql.NVarChar(15), txt(p.estado, 15))
      .input('notes', sql.NVarChar(400), txt(p.notas))
      .input('user_id', sql.Int, s?.userId ?? null)),
    CON_MODULO));

  ipcMain.handle('servicios:cita-reprogramar', sesion.proteger('servicios:cita-reprogramar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_appointment_reschedule', (r) => r
      .input('id', sql.Int, num(p.id))
      .input('starts_at', sql.DateTime2, fecha(p.desde))
      .input('ends_at', sql.DateTime2, fecha(p.hasta))
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('reason', sql.NVarChar(200), txt(p.motivo, 200))
      .input('permitir_encimar', sql.Bit, bit(p.permitirEncimar))
      .input('user_id', sql.Int, s?.userId ?? null)),
    CON_MODULO));

  ipcMain.handle('servicios:cita-a-orden', sesion.proteger('servicios:cita-a-orden',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_appointment_to_order', (r) => r
      .input('appointment_id', sql.Int, num(p.id))
      .input('user_id', sql.Int, s?.userId ?? null)
      .input('register_id', sql.Int, num(p.cajaId))),
    CON_MODULO));

  ipcMain.handle('servicios:disponibilidad', async (_e, p = {}) =>
    ejecutar(await pool(), 'sp_professional_availability', (r) => r
      .input('fecha', sql.Date, p.fecha ? new Date(p.fecha) : null)
      .input('professional_id', sql.Int, num(p.profesionalId))
      .input('service_product_id', sql.Int, num(p.servicioId))
      .input('duracion_minutos', sql.Int, num(p.duracionMinutos))
      .input('paso_minutos', sql.Int, num(p.pasoMinutos) ?? 15)));

  // =====================================================================
  //  COMISIONES
  // =====================================================================
  ipcMain.handle('servicios:comisiones', sesion.proteger('servicios:comisiones',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_commissions_report', (r) => r
      .input('desde', sql.Date, p.desde ? new Date(p.desde) : null)
      .input('hasta', sql.Date, p.hasta ? new Date(p.hasta) : null)
      .input('professional_id', sql.Int, num(p.profesionalId))),
    CON_MODULO));
}

module.exports = { registrar };
