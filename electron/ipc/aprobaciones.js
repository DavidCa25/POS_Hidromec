/**
 * ROLES V2 · PEDIRLE AUTORIZACIÓN AL DUEÑO DESDE LA CAJA.
 *
 * Una operación aprobable (ver `canales.APROBABLES`) que el Operador no puede
 * hacer solo se autoriza de dos formas:
 *
 *   PIN       un Encargado o el Administrador, ahí, en la caja. Sin Internet.
 *             (`security:authorize`, ya existía.)
 *   APP       el dueño o un admin, desde Wybix Owner. Es esta pieza.
 *
 * Las dos terminan igual: un COMPROBANTE local de un solo uso, atado a esta
 * ventana, a quien opera y al canal, que la operación lleva en
 * `payload.autorizacion` y gasta `sesion.proteger` (o el propio canal).
 *
 * Lo que viaja a la nube es un RESUMEN legible de la operación (las llaves en
 * español, porque Owner las muestra tal cual). La nube calcula su hash: quien
 * aprueba firma lo que VIO, y al consumir se manda el mismo resumen. Si la
 * operación cambia, es otra solicitud.
 */
const crypto = require('crypto');

const ETIQUETAS = {
  RETIRO: 'Retiro de efectivo',
  EGRESO: 'Egreso',
  DEVOLUCION: 'Devolución',
  MODIFICAR_VENTA: 'Modificar una venta',
  ABRIR_CAJON: 'Abrir el cajón sin venta',
  AJUSTE: 'Ajuste de existencias',
  COMPRA: 'Compra a proveedor',
  PAGO_PROVEEDOR: 'Pago a proveedor',
  PROMOCION: 'Promoción fuera de límite',
};

const dinero = (n) => `$${Number(n).toFixed(2)}`;

/** Lo que el dueño ve en su teléfono. Corto (la nube admite 4 KB) y sin ids internos. */
function resumen(accion, canal, p = {}, extra = {}) {
  const r = { 'Operación': ETIQUETAS[accion] || accion };
  const monto = [p.amount, p.monto, p.total, p.refundAmount].map(Number).find((n) => Number.isFinite(n) && n > 0);
  if (monto != null) r['Monto'] = dinero(monto);
  const nota = p.note || p.nota || p.concepto || p.reason || p.motivo;
  if (nota && typeof nota === 'string') r['Nota'] = nota.slice(0, 140);
  if (p.nombre || p.name) r['Producto'] = String(p.nombre || p.name).slice(0, 80);
  if (p.sale_id || p.saleId) r['Venta'] = `#${p.sale_id || p.saleId}`;
  for (const [k, v] of Object.entries(extra || {})) if (v != null && v !== '') r[k] = String(v).slice(0, 160);
  return r;
}

function registrar({ ipcMain, sesion, canales, reautenticacion, cloudSync, loadDeviceConfig, permisos }) {
  /** id -> { canal, accion, resumen, webContentsId, actorId } (solo en memoria: una solicitud no sobrevive a reiniciar Wybix). */
  const pendientes = new Map();

  /* ¿Se le puede pedir al dueño desde esta caja? (nube activa y vinculada). */
  ipcMain.handle('aprobaciones:disponible', sesion.proteger('aprobaciones:disponible', async () => {
    try { return { success: true, data: { disponible: cloudSync.aprobaciones.disponible() } }; }
    catch { return { success: true, data: { disponible: false } }; }
  }));

  /**
   * { canal, payload, detalle? } -> { id, expira }.
   * `detalle` son renglones extra que el canal quiere que el dueño vea
   * (p. ej. «De 120 a 80 piezas»); vienen de la respuesta del propio canal.
   */
  ipcMain.handle('aprobaciones:solicitar', sesion.proteger('aprobaciones:solicitar', async (evento, p = {}, ses) => {
    try {
      const canal = String(p.canal || '');
      const ap = canales.aprobable(canal);
      if (!ap) return { success: false, error: 'Esa operación no se autoriza a distancia.' };
      if (!cloudSync.aprobaciones.disponible()) {
        return { success: false, error: 'Esta caja no está conectada a la nube: pide el PIN de un encargado.' };
      }
      const caja = loadDeviceConfig()?.register?.name;
      const r = resumen(ap.accion, canal, p.payload, { ...(p.detalle || {}), ...(caja ? { Caja: caja } : {}) });
      const id = crypto.randomUUID();
      const out = await cloudSync.aprobaciones.solicitar({
        id, approval_action: ap.accion, payload: r,
        requested_by: { name: ses.usuario, role: permisos.etiquetaDeRol(ses.rol) },
      });
      pendientes.set(id, { canal, accion: ap.accion, resumen: r, webContentsId: evento.sender.id, actorId: ses.userId });
      return { success: true, data: { id, expira: out.expires_at } };
    } catch (e) {
      return { success: false, error: e.code === 'NOT_REMOTE' ? 'Esa operación no se autoriza a distancia.' : (e.message || 'No se pudo enviar la solicitud.') };
    }
  }));

  /**
   * { id } -> { status } y, cuando el dueño ya aprobó, la consume UNA vez y
   * devuelve el comprobante local con el que la operación se ejecuta.
   */
  ipcMain.handle('aprobaciones:estado', sesion.proteger('aprobaciones:estado', async (evento, p = {}, ses) => {
    try {
      const id = String(p.id || '');
      const sol = pendientes.get(id);
      if (!sol || sol.webContentsId !== evento.sender.id || Number(sol.actorId) !== Number(ses.userId)) {
        return { success: false, error: 'Esa solicitud no es de esta caja.' };
      }
      const e = await cloudSync.aprobaciones.estado(id);
      if (e.status !== 'APPROVED') {
        if (e.status !== 'PENDING') pendientes.delete(id);
        return { success: true, data: { status: e.status, decidio: e.decided_name || null, nota: e.decision_note || null } };
      }
      const c = await cloudSync.aprobaciones.consumir(id, sol.resumen);
      pendientes.delete(id);
      const comprobante = reautenticacion.emitir({
        webContentsId: evento.sender.id, actorId: ses.userId,
        autorizadorId: null, autorizadorUsuario: c.approver?.name || c.decided_name || 'el dueño',
        autorizadorRol: 'OWNER', canal: sol.canal, via: 'APP', aprobacionId: id,
      });
      return { success: true, data: { status: 'APPROVED', decidio: c.approver?.name || c.decided_name, autorizacion: comprobante.token } };
    } catch (e) {
      return { success: false, error: e.message || 'No se pudo consultar la solicitud.' };
    }
  }));

  ipcMain.handle('aprobaciones:cancelar', sesion.proteger('aprobaciones:cancelar', async (evento, p = {}) => {
    const id = String(p.id || '');
    const sol = pendientes.get(id);
    if (!sol || sol.webContentsId !== evento.sender.id) return { success: true };
    pendientes.delete(id);
    try { await cloudSync.aprobaciones.cancelar(id); } catch { /* ya no estaba pendiente */ }
    return { success: true };
  }));
}

module.exports = { registrar, resumen, ETIQUETAS };
