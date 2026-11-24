/**
 * IPC del giro Salud: farmacia, expediente clínico y dental.
 *
 * Mismo criterio que electron/ipc/servicios.js: aquí no hay reglas de
 * negocio. Cada handler traduce el payload a parámetros y ejecuta su
 * procedimiento. Que un documento firmado no se toque, que los lotes no
 * sumen más que la existencia o que un plan aceptado no se reescriba lo
 * decide SQL, siempre.
 *
 * CADA CANAL EXIGE EL MÓDULO
 * --------------------------
 * `salud` encendido en `business_modules`, más el paquete que diga
 * electron/seguridad/canales.js. El expediente es SALUD_EXPEDIENTE incluso
 * para leer: leer un expediente ya es tratar datos sensibles.
 *
 * DOS GANCHOS A LA VENTA
 * ----------------------
 * `frenaLaVenta`  antes del cobro: si un producto exige receta y no viene,
 *                 la venta no se registra (motivo RECETA_REQUERIDA).
 * `despuesDeVender` después del COMMIT: guarda la receta y descuenta lotes
 *                 (FEFO). Nunca tumba la venta: lo cobrado ya entró.
 */
const sesion = require('../seguridad/sesion');
const presets = require('../salud/presets');

const CON_MODULO = { modulo: 'salud' };

/** Errores que SQL lanza con un código delante, para que la pantalla actúe. */
const MOTIVOS = ['DOCUMENTO_FIRMADO', 'SIN_CONSENTIMIENTO', 'SIN_FICHA', 'LOTES_EXCEDEN_STOCK',
  'RECETA_INCOMPLETA', 'CONFLICTO_DE_VERSION', 'SIN_CEDULA', 'CEDULA_INVALIDA', 'ESTUDIO_VALIDADO'];

function traducir(msg) {
  const motivo = MOTIVOS.find((m) => msg.includes(m)) || null;
  const limpio = motivo ? msg.slice(msg.indexOf(motivo) + motivo.length).replace(/^[:\s]+/, '') : msg;
  if (motivo === 'CONFLICTO_DE_VERSION') {
    return { motivo, error: 'Alguien más cambió esta ficha mientras la editabas. Vuelve a abrirla para ver lo último.' };
  }
  return { motivo, error: limpio || msg };
}

/** Envoltorio uniforme: nunca lanza al renderer, siempre {success, ...}. */
async function ejecutar(pool, nombre, construir) {
  try {
    const req = pool.request();
    if (construir) construir(req);
    const r = await req.execute(nombre);
    return { success: true, data: r.recordset ?? [], sets: r.recordsets ?? [] };
  } catch (e) {
    const msg = String(e.message || e);
    console.error(`[SALUD] ${nombre}:`, msg);
    const t = traducir(msg);
    return { success: false, error: t.error, motivo: t.motivo };
  }
}

const txt = (v, n = 400) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const ent = (v) => { const n = num(v); return n == null ? null : Math.trunc(n); };
const bit = (v) => (v ? 1 : 0);
const fecha = (v) => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const json = (v) => (v == null ? null : JSON.stringify(v));
/** El testigo de versión, de texto `0x…` a los 8 bytes que espera SQL. */
const rowver = (v) => {
  if (!v) return null;
  const hex = String(v).trim().replace(/^0x/i, '');
  return /^[0-9a-f]{16}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
};

/**
 * Abre una orden de servicio con sus partidas, DENTRO de la transacción de
 * quien llama. La usan el plan dental aceptado y la orden de estudios: los
 * dos se cobran en la caja como cualquier orden de servicio.
 *
 * @param sql    el módulo mssql que recibe registrar()
 * @param lineas [{ productId, precio, nota }]
 * @returns el id de la orden de servicio
 */
async function abrirOrdenDeServicio(sql, tx, customerId, texto, lineas, userId) {
  const orden = await new sql.Request(tx)
    .input('customer_id', sql.Int, customerId)
    .input('reported_issue', sql.NVarChar(1000), String(texto).slice(0, 1000))
    .input('user_id', sql.Int, userId)
    .execute('sp_service_order_create');
  const ordenId = orden.recordset?.[0]?.id ?? orden.recordset?.[0]?.order_id;
  if (!ordenId) throw new Error('No se pudo abrir la orden de servicio.');
  for (const l of lineas) {
    await new sql.Request(tx)
      .input('order_id', sql.Int, ordenId)
      .input('product_id', sql.Int, l.productId)
      .input('quantity', sql.Decimal(12, 2), 1)
      .input('unit_price', sql.Decimal(12, 2), l.precio)
      .input('notes', sql.NVarChar(400), l.nota ?? null)
      .input('user_id', sql.Int, userId)
      .execute('sp_service_order_add_line');
  }
  return ordenId;
}

/** JSON de la base a objeto; si no se puede leer, el valor por omisión. */
function leerJson(v, porOmision = null) {
  if (v == null || v === '') return porOmision;
  try { return JSON.parse(v); } catch { return porOmision; }
}

/* =======================================================================
 *  GANCHOS DE LA VENTA (los usa electron/main.js)
 * ===================================================================== */

/**
 * ¿Está encendido Salud con farmacia?
 *
 * Lo pregunta CADA venta de cualquier negocio, así que se recuerda unos
 * segundos: un abarrote no paga una consulta extra por cobro. Elegir giro
 * olvida la respuesta (`olvidarFarmacia`); apagar el módulo desde otra caja
 * surte efecto al vencer el plazo, igual que la caché de módulos.
 */
const TTL_FARMACIA_MS = 15000;
let farmaciaCache = { valor: false, leidoEn: 0 };
function olvidarFarmacia() { farmaciaCache = { valor: false, leidoEn: 0 }; }

async function farmaciaActiva(pool) {
  if (Date.now() - farmaciaCache.leidoEn < TTL_FARMACIA_MS) return farmaciaCache.valor;
  let valor = false;
  try {
    const r = await pool.request().query(
      "SELECT TOP (1) farmacia FROM dbo.salud_config WHERE id = 1 " +
      "AND EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'salud' AND enabled = 1)");
    valor = !!r.recordset?.[0]?.farmacia;
  } catch {
    // Base anterior a la 0087: no hay Salud que frenar.
    valor = false;
  }
  farmaciaCache = { valor, leidoEn: Date.now() };
  return valor;
}

/**
 * Antes de cobrar. Devuelve null si la venta puede seguir, o el motivo.
 * Solo frena con farmacia encendida: un abarrote no pregunta por recetas.
 */
async function frenaLaVenta(pool, sql, p) {
  if (!(await farmaciaActiva(pool))) return null;
  const ids = [...new Set((p.lines || []).map((l) => Number(l.productId ?? l.product_id)).filter(Number.isInteger))];
  if (!ids.length) return null;
  const r = await pool.request()
    .input('product_ids', sql.NVarChar(sql.MAX), JSON.stringify(ids))
    .execute('sp_salud_venta_requisitos');
  const exigen = r.recordset || [];
  if (!exigen.length) return null;

  const rec = p.receta || null;
  const completa = rec && txt(rec.medico) && txt(rec.cedula) && fecha(rec.fecha);
  if (completa) return null;
  return {
    motivo: 'RECETA_REQUERIDA',
    productos: exigen.map((x) => ({
      productId: x.product_id, nombre: x.nombre, fraccion: x.fraccion,
      antibiotico: !!x.es_antibiotico, controlado: !!x.es_controlado,
    })),
    error: `Requiere receta: ${exigen.map((x) => x.nombre).join(', ')}.`,
  };
}

/** Después del COMMIT. Nunca lanza: lo que falle se registra y se devuelve. */
async function despuesDeVender(pool, sql, { saleId, receta, userId }) {
  if (!saleId || !(await farmaciaActiva(pool))) return { ok: true };
  try {
    await pool.request()
      .input('sale_id', sql.Int, saleId)
      .input('receta', sql.NVarChar(sql.MAX), receta ? JSON.stringify({
        medico: txt(receta.medico, 120), cedula: txt(receta.cedula, 20), fecha: fecha(receta.fecha),
        institucion: txt(receta.institucion, 160), paciente: txt(receta.paciente, 120),
        retenida: !!receta.retenida, surtidosRestantes: ent(receta.surtidosRestantes),
      }) : null)
      .input('user_id', sql.Int, userId ?? null)
      .execute('sp_salud_venta_aplicar');
    return { ok: true };
  } catch (e) {
    console.error('[SALUD] despues de vender:', e.message);
    return { ok: false, error: `La venta quedó; los lotes y la receta no se registraron (${e.message}).` };
  }
}

/* =======================================================================
 *  CANALES
 * ===================================================================== */

function registrar({ ipcMain, sql, poolPromise, olvidarModulos }) {
  const pool = () => poolPromise;

  // -------------------------------------------------------------- el giro
  ipcMain.handle('salud:giros', async () => ({ success: true, data: presets.PRESETS, version: presets.version }));

  ipcMain.handle('salud:config', async () => ejecutar(await pool(), 'sp_salud_config_get'));

  /**
   * Elegir el giro ENCIENDE el módulo. La clínica necesita además Servicios
   * (agenda, profesionales, cobro de órdenes): si no está encendido, se
   * enciende con el giro «Consultorio de salud». Si ya lo estaba con otro
   * giro (una farmacia que también hace entregas), se respeta.
   */
  ipcMain.handle('salud:elegir-giro', sesion.proteger('salud:elegir-giro', async (_e, p = {}, s) => {
    let giro;
    try { giro = presets.exigir(p.preset); } catch (e) { return { success: false, error: e.message, motivo: 'GIRO_DESCONOCIDO' }; }
    const db = await pool();
    const r = await ejecutar(db, 'sp_salud_config_set', (req) => req
      .input('preset', sql.NVarChar(40), giro.id)
      .input('farmacia', sql.Bit, bit(giro.farmacia))
      .input('clinica', sql.Bit, bit(giro.clinica))
      .input('dental', sql.Bit, bit(giro.dental))
      .input('estudios', sql.Bit, bit(giro.estudios))
      .input('user_id', sql.Int, s?.userId ?? null));
    if (!r.success) return r;

    /* Consultorio y estudios cobran con órdenes de servicio y usan la agenda. */
    if (giro.clinica || giro.estudios) {
      const srv = await db.request().query(
        "SELECT (SELECT TOP 1 enabled FROM dbo.business_modules WHERE module_key = N'servicios') AS encendido, " +
        "(SELECT TOP 1 preset FROM dbo.services_config WHERE id = 1) AS preset");
      const f = srv.recordset?.[0] || {};
      if (!f.encendido) {
        const rs = await ejecutar(db, 'sp_set_services_preset', (req) => req
          .input('preset', sql.NVarChar(40), f.preset || 'SALUD')
          .input('user_id', sql.Int, s?.userId ?? null));
        if (!rs.success) return { success: false, error: `Salud quedó activo, pero la agenda no: ${rs.error}` };
      }
    }
    try { olvidarModulos?.(); } catch { /* noop */ }
    olvidarFarmacia();
    return { success: true, data: r.data };
  }));

  // ------------------------------------------------------------ farmacia
  ipcMain.handle('salud:farmacia-resumen', sesion.proteger('salud:farmacia-resumen',
    async () => ejecutar(await pool(), 'sp_salud_farmacia_resumen'), CON_MODULO));

  ipcMain.handle('salud:farmacia-productos', sesion.proteger('salud:farmacia-productos',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salud_productos_list', (req) => req
      .input('buscar', sql.NVarChar(100), txt(p.buscar, 100))
      .input('solo_medicamentos', sql.Bit, bit(p.soloMedicamentos))
      .input('top', sql.Int, ent(p.top) ?? 200)), CON_MODULO));

  ipcMain.handle('salud:producto-guardar', sesion.proteger('salud:producto-guardar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_producto_save', (req) => req
      .input('product_id', sql.Int, ent(p.productId))
      .input('fraccion', sql.TinyInt, ent(p.fraccion))
      .input('es_antibiotico', sql.Bit, bit(p.esAntibiotico))
      .input('sustancia_activa', sql.NVarChar(160), txt(p.sustanciaActiva, 160))
      .input('presentacion', sql.NVarChar(120), txt(p.presentacion, 120))
      .input('registro_sanitario', sql.NVarChar(40), txt(p.registroSanitario, 40))
      .input('refrigeracion', sql.Bit, bit(p.refrigeracion))
      .input('precio_maximo', sql.Decimal(10, 2), num(p.precioMaximo))
      .input('controla_lotes', sql.Bit, p.controlaLotes === false ? 0 : 1)
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:lotes', sesion.proteger('salud:lotes',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salud_lotes_list', (req) => req
      .input('product_id', sql.Int, ent(p.productId))
      .input('dias', sql.Int, ent(p.dias))
      .input('top', sql.Int, ent(p.top) ?? 300)), CON_MODULO));

  ipcMain.handle('salud:lote-entrada', sesion.proteger('salud:lote-entrada',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_lote_entrada', (req) => req
      .input('product_id', sql.Int, ent(p.productId))
      .input('lote', sql.NVarChar(40), txt(p.lote, 40))
      .input('caducidad', sql.Date, fecha(p.caducidad))
      .input('cantidad', sql.Decimal(12, 3), num(p.cantidad))
      .input('costo', sql.Decimal(14, 4), num(p.costo))
      .input('nota', sql.NVarChar(200), txt(p.nota, 200))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:lote-ajustar', sesion.proteger('salud:lote-ajustar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_lote_ajustar', (req) => req
      .input('lote_id', sql.Int, ent(p.loteId))
      .input('cantidad_nueva', sql.Decimal(12, 3), num(p.cantidad))
      .input('nota', sql.NVarChar(200), txt(p.nota, 200))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:libro-control', sesion.proteger('salud:libro-control',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salud_libro_control', (req) => req
      .input('desde', sql.Date, fecha(p.desde))
      .input('hasta', sql.Date, fecha(p.hasta))
      .input('tipo', sql.NVarChar(12), p.tipo === 'ANTIBIOTICOS' ? 'ANTIBIOTICOS' : 'CONTROLADOS')), CON_MODULO));

  ipcMain.handle('salud:temperaturas', sesion.proteger('salud:temperaturas',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salud_temperaturas_list', (req) => req
      .input('dias', sql.Int, ent(p.dias) ?? 30)), CON_MODULO));

  ipcMain.handle('salud:temperatura-guardar', sesion.proteger('salud:temperatura-guardar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_temperatura_save', (req) => req
      .input('equipo', sql.NVarChar(40), txt(p.equipo, 40))
      .input('grados', sql.Decimal(4, 1), num(p.grados))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  // ----------------------------------------------------------- expediente
  ipcMain.handle('salud:cie10', sesion.proteger('salud:cie10',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salud_cie10_buscar', (req) => req
      .input('buscar', sql.NVarChar(100), txt(p.buscar, 100))
      .input('top', sql.Int, ent(p.top) ?? 20)), CON_MODULO));

  ipcMain.handle('salud:pacientes', sesion.proteger('salud:pacientes',
    async (_e, p = {}) => ejecutar(await pool(), 'sp_salud_pacientes_buscar', (req) => req
      .input('buscar', sql.NVarChar(100), txt(p.buscar, 100))
      .input('top', sql.Int, ent(p.top) ?? 50)), CON_MODULO));

  ipcMain.handle('salud:paciente-guardar', sesion.proteger('salud:paciente-guardar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_paciente_save', (req) => req
      .input('customer_id', sql.Int, ent(p.customerId))
      .input('nombre', sql.NVarChar(120), txt(p.nombre, 120))
      .input('telefono', sql.NVarChar(30), txt(p.telefono, 30))
      .input('email', sql.NVarChar(120), txt(p.email, 120))
      .input('fecha_nacimiento', sql.Date, fecha(p.fechaNacimiento))
      .input('curp', sql.NVarChar(18), txt(p.curp, 18))
      .input('sexo', sql.Char(1), txt(p.sexo, 1))
      .input('tutor', sql.NVarChar(120), txt(p.tutor, 120))
      .input('contacto_emergencia', sql.NVarChar(160), txt(p.contactoEmergencia, 160))
      .input('grupo_sanguineo', sql.NVarChar(5), txt(p.grupoSanguineo, 5))
      .input('alergias', sql.NVarChar(600), txt(p.alergias, 600))
      .input('antecedentes', sql.NVarChar(sql.MAX), p.antecedentes ? json(p.antecedentes) : null)
      .input('consentimiento', sql.Bit, bit(p.consentimiento))
      .input('version', sql.Binary(8), rowver(p.version))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:expediente', sesion.proteger('salud:expediente', async (_e, p = {}, s) => {
    const r = await ejecutar(await pool(), 'sp_salud_expediente_get', (req) => req
      .input('customer_id', sql.Int, ent(p.customerId))
      .input('user_id', sql.Int, s?.userId ?? null));
    if (!r.success) return r;
    const [ficha = [], docs = [], dx = [], adendas = []] = r.sets;
    const documentos = docs.map((d) => {
      let contenido = {};
      try { contenido = JSON.parse(d.contenido); } catch { contenido = {}; }
      return {
        ...d, contenido, firmante: leerJson(d.firmante, null),
        diagnosticos: dx.filter((x) => x.documento_id === d.id),
        adendas: adendas.filter((a) => a.documento_id === d.id),
      };
    });
    const f = ficha[0] || null;
    if (f && f.antecedentes) { try { f.antecedentes = JSON.parse(f.antecedentes); } catch { f.antecedentes = null; } }
    return { success: true, data: { ficha: f, documentos } };
  }, CON_MODULO));

  ipcMain.handle('salud:documento-guardar', sesion.proteger('salud:documento-guardar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_documento_guardar', (req) => req
      .input('id', sql.Int, ent(p.id))
      .input('paciente_id', sql.Int, ent(p.pacienteId))
      .input('tipo', sql.NVarChar(20), txt(p.tipo, 20))
      .input('titulo', sql.NVarChar(160), txt(p.titulo, 160))
      .input('contenido', sql.NVarChar(sql.MAX), json(p.contenido ?? {}))
      .input('diagnosticos', sql.NVarChar(sql.MAX), Array.isArray(p.diagnosticos) ? json(p.diagnosticos) : null)
      .input('cita_id', sql.Int, ent(p.citaId))
      .input('orden_id', sql.Int, ent(p.ordenId))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:documento-firmar', sesion.proteger('salud:documento-firmar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_documento_firmar', (req) => req
      .input('id', sql.Int, ent(p.id))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:documento-adenda', sesion.proteger('salud:documento-adenda',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_documento_adenda', (req) => req
      .input('documento_id', sql.Int, ent(p.documentoId))
      .input('texto', sql.NVarChar(2000), txt(p.texto, 2000))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:documento-descartar', sesion.proteger('salud:documento-descartar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_documento_descartar', (req) => req
      .input('id', sql.Int, ent(p.id))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:bitacora', sesion.proteger('salud:bitacora',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_bitacora_list', (req) => req
      .input('customer_id', sql.Int, ent(p.customerId))
      .input('registrar', sql.NVarChar(20), txt(p.registrar, 20))
      .input('documento_id', sql.Int, ent(p.documentoId))
      .input('user_id', sql.Int, s?.userId ?? null)
      .input('top', sql.Int, ent(p.top) ?? 100)), CON_MODULO));

  // --------------------------------------------------------------- dental
  ipcMain.handle('salud:odontograma', sesion.proteger('salud:odontograma', async (_e, p = {}) => {
    const r = await ejecutar(await pool(), 'sp_salud_odontograma_get', (req) => req
      .input('customer_id', sql.Int, ent(p.customerId))
      .input('historial', sql.Int, ent(p.historial) ?? 100));
    if (!r.success) return r;
    return { success: true, data: { actual: r.sets[0] || [], historial: r.sets[1] || [] } };
  }, CON_MODULO));

  ipcMain.handle('salud:odontograma-marcar', sesion.proteger('salud:odontograma-marcar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_odontograma_marcar', (req) => req
      .input('customer_id', sql.Int, ent(p.customerId))
      .input('marcas', sql.NVarChar(sql.MAX), json((p.marcas || []).slice(0, 200)))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:planes', sesion.proteger('salud:planes', async (_e, p = {}) => {
    const r = await ejecutar(await pool(), 'sp_salud_planes_get', (req) => req
      .input('customer_id', sql.Int, ent(p.customerId)));
    if (!r.success) return r;
    const [planes = [], items = []] = r.sets;
    return { success: true, data: planes.map((pl) => ({ ...pl, items: items.filter((i) => i.plan_id === pl.id) })) };
  }, CON_MODULO));

  ipcMain.handle('salud:plan-guardar', sesion.proteger('salud:plan-guardar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_plan_guardar', (req) => req
      .input('id', sql.Int, ent(p.id))
      .input('customer_id', sql.Int, ent(p.customerId))
      .input('titulo', sql.NVarChar(120), txt(p.titulo, 120))
      .input('items', sql.NVarChar(sql.MAX), json((p.items || []).slice(0, 200)))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:plan-estado', sesion.proteger('salud:plan-estado',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_plan_estado', (req) => req
      .input('id', sql.Int, ent(p.id))
      .input('estado', sql.NVarChar(12), txt(p.estado, 12))
      .input('orden_id', sql.Int, null)
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:plan-item', sesion.proteger('salud:plan-item',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_plan_item_hecho', (req) => req
      .input('item_id', sql.Int, ent(p.itemId))
      .input('hecho', sql.Bit, bit(p.hecho))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  /**
   * Aceptar un plan lo convierte en una ORDEN DE SERVICIO: así se cobra con
   * el flujo de siempre (abonos, crédito, factura). Orden, partidas y estado
   * del plan van en UNA transacción: o queda todo, o nada.
   *
   * Cada procedimiento sin servicio del catálogo se da de alta como servicio
   * con su nombre (exento de IVA), para que el ticket diga qué se cobró.
   */
  ipcMain.handle('salud:plan-aceptar', sesion.proteger('salud:plan-aceptar', async (_e, p = {}, s) => {
    const planId = ent(p.id);
    const db = await pool();
    const tx = new sql.Transaction(db);
    try {
      await tx.begin();
      const r = new sql.Request(tx);
      const plan = (await r.input('id', sql.Int, planId).query(
        'SELECT id, paciente_id, titulo, estado FROM dbo.salud_planes WITH (UPDLOCK) WHERE id = @id')).recordset[0];
      if (!plan) throw new Error('El plan no existe.');
      if (plan.estado !== 'PROPUESTO') throw new Error('Este plan ya no está propuesto.');
      const items = (await new sql.Request(tx).input('id', sql.Int, planId).query(
        'SELECT id, fase, diente, procedimiento, product_id, precio FROM dbo.salud_plan_items WHERE plan_id = @id ORDER BY fase, id')).recordset;

      /* Un procedimiento escrito a mano se vuelve servicio del catálogo con
         SU nombre (uno por nombre, reutilizado después). No un genérico
         compartido: la caja junta las partidas del mismo producto en una
         línea, y dos procedimientos distintos se cobrarían con un solo precio. */
      const porNombre = new Map();
      for (const it of items.filter((i) => !i.product_id)) {
        const nombre = String(it.procedimiento).trim().slice(0, 100);
        const clave = nombre.toLocaleLowerCase('es-MX');
        if (porNombre.has(clave)) { it.product_id = porNombre.get(clave); continue; }
        const ya = (await new sql.Request(tx).input('nombre', sql.NVarChar(100), nombre).query(
          'SELECT TOP 1 p.id FROM dbo.products p JOIN dbo.services s ON s.product_id = p.id WHERE p.nombre = @nombre AND p.active = 1')).recordset[0];
        let id = ya?.id;
        if (!id) {
          const nuevo = await new sql.Request(tx)
            .input('nombre', sql.NVarChar(100), nombre)
            .input('price', sql.Decimal(10, 2), it.precio)
            .input('tasa_iva', sql.Decimal(5, 4), 0)   // honorarios médicos y dentales: exentos (art. 15 fr. XIV LIVA)
            .input('iva_exento', sql.Bit, 1)           // 0088: exento, no tasa 0
            .input('duration_minutes', sql.Int, 30)
            .input('requires_professional', sql.Bit, 0)
            .input('schedulable', sql.Bit, 0)
            .execute('sp_service_save');
          id = nuevo.recordset?.[0]?.product_id;
        }
        if (!id) throw new Error(`No se pudo dar de alta «${nombre}» en el catálogo.`);
        porNombre.set(clave, id);
        it.product_id = id;
      }

      const ordenId = await abrirOrdenDeServicio(sql, tx, plan.paciente_id, `Plan de tratamiento: ${plan.titulo}`,
        items.map((it) => ({ productId: it.product_id, precio: it.precio, nota: it.diente ? `Diente ${it.diente}` : null })),
        s?.userId ?? null);

      await new sql.Request(tx)
        .input('id', sql.Int, planId)
        .input('estado', sql.NVarChar(12), 'ACEPTADO')
        .input('orden_id', sql.Int, ordenId)
        .input('user_id', sql.Int, s?.userId ?? null)
        .execute('sp_salud_plan_estado');

      await tx.commit();
      return { success: true, data: { planId, ordenId } };
    } catch (e) {
      try { await tx.rollback(); } catch { /* ya revertida */ }
      const t = traducir(String(e.message || e));
      console.error('[SALUD] plan-aceptar:', e.message);
      return { success: false, error: t.error, motivo: t.motivo };
    }
  }, CON_MODULO));
  // ------------------------------------------------- quién firma (cédula)
  /* Cada quien ve y captura SUS datos: la cédula es de la persona. */
  ipcMain.handle('salud:profesional', sesion.proteger('salud:profesional',
    async (_e, _p = {}, s) => {
      const r = await ejecutar(await pool(), 'sp_salud_profesional_get', (req) => req
        .input('user_id', sql.Int, s?.userId ?? null));
      return r.success ? { success: true, data: r.data[0] ?? null } : r;
    }, CON_MODULO));

  ipcMain.handle('salud:profesional-guardar', sesion.proteger('salud:profesional-guardar',
    async (_e, p = {}, s) => {
      const r = await ejecutar(await pool(), 'sp_salud_profesional_save', (req) => req
        .input('user_id', sql.Int, s?.userId ?? null)
        .input('nombre', sql.NVarChar(160), txt(p.nombre, 160))
        .input('cedula', sql.NVarChar(20), txt(p.cedula, 20))
        .input('institucion', sql.NVarChar(160), txt(p.institucion, 160))
        .input('especialidad', sql.NVarChar(120), txt(p.especialidad, 120))
        .input('cedula_especialidad', sql.NVarChar(20), txt(p.cedulaEspecialidad, 20)));
      return r.success ? { success: true, data: r.data[0] ?? null } : r;
    }, CON_MODULO));

  // ------------------------------------------------ laboratorio e imagen
  const estudioDeFila = (e) => ({ ...e, parametros: leerJson(e.parametros, []) });

  ipcMain.handle('salud:estudios-catalogo', sesion.proteger('salud:estudios-catalogo',
    async (_e, p = {}) => {
      const r = await ejecutar(await pool(), 'sp_salud_estudios_catalogo', (req) => req
        .input('buscar', sql.NVarChar(100), txt(p.buscar, 100))
        .input('tipo', sql.NVarChar(10), txt(p.tipo, 10)));
      return r.success ? { success: true, data: r.data.map(estudioDeFila) } : r;
    }, CON_MODULO));

  /* El estudio es un servicio del catálogo (nombre, precio, IVA) más su
     ficha clínica. Las dos cosas en UNA transacción: no queda un servicio
     sin ficha ni una ficha sin servicio. */
  ipcMain.handle('salud:estudio-guardar', sesion.proteger('salud:estudio-guardar', async (_e, p = {}) => {
    const db = await pool();
    const tx = new sql.Transaction(db);
    try {
      await tx.begin();
      const tasa = num(p.tasaIva) ?? 0.16;
      const srv = await new sql.Request(tx)
        .input('product_id', sql.Int, ent(p.productId))
        .input('nombre', sql.NVarChar(100), txt(p.nombre, 100))
        .input('price', sql.Decimal(10, 2), num(p.precio))
        .input('clave_prod_serv', sql.NVarChar(8), '85121800')   // SAT: laboratorios médicos y de diagnóstico
        .input('tasa_iva', sql.Decimal(5, 4), tasa)
        .input('iva_exento', sql.Bit, tasa === 0 && p.ivaExento ? 1 : 0)
        .input('duration_minutes', sql.Int, ent(p.duracion) ?? 20)
        .input('requires_professional', sql.Bit, 0)
        .input('schedulable', sql.Bit, p.tipo === 'IMAGEN' ? 1 : 0)
        .execute('sp_service_save');
      const productId = srv.recordset?.[0]?.product_id ?? ent(p.productId);
      if (!productId) throw new Error('No se pudo guardar el estudio en el catálogo.');
      await new sql.Request(tx)
        .input('product_id', sql.Int, productId)
        .input('tipo', sql.NVarChar(10), txt(p.tipo, 10))
        .input('modalidad', sql.NVarChar(20), txt(p.modalidad, 20))
        .input('preparacion', sql.NVarChar(400), txt(p.preparacion, 400))
        .input('muestra', sql.NVarChar(60), txt(p.muestra, 60))
        .input('entrega_horas', sql.Int, ent(p.entregaHoras))
        .input('parametros', sql.NVarChar(sql.MAX), Array.isArray(p.parametros) ? json(p.parametros) : null)
        .execute('sp_salud_estudio_ficha_save');
      await tx.commit();
      return { success: true, data: { productId } };
    } catch (e) {
      try { await tx.rollback(); } catch { /* ya revertida */ }
      const t = traducir(String(e.message || e));
      console.error('[SALUD] estudio-guardar:', e.message);
      return { success: false, error: t.error, motivo: t.motivo };
    }
  }, CON_MODULO));

  /* La orden de estudios y la orden de servicio con la que se cobra, en UNA
     transacción: no hay estudios pedidos que nadie pueda cobrar. */
  ipcMain.handle('salud:estudio-orden-crear', sesion.proteger('salud:estudio-orden-crear', async (_e, p = {}, s) => {
    const db = await pool();
    const tx = new sql.Transaction(db);
    const userId = s?.userId ?? null;
    try {
      await tx.begin();
      const items = (Array.isArray(p.estudios) ? p.estudios : []).map((id) => ({ productId: ent(id) })).filter((x) => x.productId);
      const r = await new sql.Request(tx)
        .input('customer_id', sql.Int, ent(p.customerId))
        .input('items', sql.NVarChar(sql.MAX), json(items))
        .input('medico', sql.NVarChar(160), txt(p.medico, 160))
        .input('indicaciones', sql.NVarChar(600), txt(p.indicaciones, 600))
        .input('user_id', sql.Int, userId)
        .execute('sp_salud_estudio_orden_crear');
      const orden = r.recordsets?.[0]?.[0];
      const lineas = r.recordsets?.[1] ?? [];
      if (!orden) throw new Error('No se pudo abrir la orden de estudios.');
      const ordenId = await abrirOrdenDeServicio(sql, tx, ent(p.customerId), `Estudios ${orden.folio}`,
        lineas.map((l) => ({ productId: l.product_id, precio: l.precio, nota: orden.folio })), userId);
      await new sql.Request(tx)
        .input('id', sql.Int, orden.id)
        .input('orden_id', sql.Int, ordenId)
        .execute('sp_salud_estudio_orden_vincular');
      await tx.commit();
      return { success: true, data: { id: orden.id, folio: orden.folio, ordenId } };
    } catch (e) {
      try { await tx.rollback(); } catch { /* ya revertida */ }
      const t = traducir(String(e.message || e));
      console.error('[SALUD] estudio-orden-crear:', e.message);
      return { success: false, error: t.error, motivo: t.motivo };
    }
  }, CON_MODULO));

  ipcMain.handle('salud:estudio-ordenes', sesion.proteger('salud:estudio-ordenes', async (_e, p = {}, s) => {
    const r = await ejecutar(await pool(), 'sp_salud_estudio_ordenes', (req) => req
      .input('id', sql.Int, ent(p.id))
      .input('customer_id', sql.Int, ent(p.customerId))
      .input('estado', sql.NVarChar(12), txt(p.estado, 12))
      .input('buscar', sql.NVarChar(100), txt(p.buscar, 100))
      .input('top', sql.Int, ent(p.top) ?? 100)
      .input('user_id', sql.Int, s?.userId ?? null));
    if (!r.success) return r;
    const [ordenes = [], items = []] = r.sets;
    return {
      success: true,
      data: ordenes.map((o) => ({
        ...o,
        items: items.filter((i) => i.orden_id === o.id).map((i) => ({
          ...i,
          parametros: leerJson(i.parametros, []),
          resultados: leerJson(i.resultados, []),
          firmante: leerJson(i.firmante, null),
        })),
      })),
    };
  }, CON_MODULO));

  ipcMain.handle('salud:estudio-estado', sesion.proteger('salud:estudio-estado',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_estudio_estado', (req) => req
      .input('item_id', sql.Int, ent(p.itemId))
      .input('estado', sql.NVarChar(12), txt(p.estado, 12))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:estudio-capturar', sesion.proteger('salud:estudio-capturar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_estudio_capturar', (req) => req
      .input('item_id', sql.Int, ent(p.itemId))
      .input('resultados', sql.NVarChar(sql.MAX), Array.isArray(p.resultados)
        ? json(p.resultados.map((x) => ({ clave: txt(x?.clave, 20), valor: txt(x?.valor, 60) }))) : null)
      .input('hallazgos', sql.NVarChar(sql.MAX), txt(p.hallazgos, 8000))
      .input('conclusion', sql.NVarChar(1000), txt(p.conclusion, 1000))
      .input('birads', sql.TinyInt, ent(p.birads))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:estudio-validar', sesion.proteger('salud:estudio-validar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_estudio_validar', (req) => req
      .input('item_id', sql.Int, ent(p.itemId))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));

  ipcMain.handle('salud:estudio-entregar', sesion.proteger('salud:estudio-entregar',
    async (_e, p = {}, s) => ejecutar(await pool(), 'sp_salud_estudio_entregar', (req) => req
      .input('id', sql.Int, ent(p.id))
      .input('user_id', sql.Int, s?.userId ?? null)), CON_MODULO));
}

module.exports = { registrar, frenaLaVenta, despuesDeVender, farmaciaActiva, olvidarFarmacia };
