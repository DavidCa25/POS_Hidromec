/**
 * EL PEDIDO EN LA PANTALLA DEL CLIENTE (customer display) AL COBRAR.
 *
 * Tres cosas distintas, que no hay que mezclar:
 *
 *   CUSTOMER DISPLAY   la pantalla de cobro, frente a quien esta pagando.
 *                      Ensena su numero de pedido, su nombre COMPLETO si la
 *                      venta tiene cliente (customerDisplayName: es suyo y lo
 *                      tiene delante) y un QR.
 *   ORDER BOARD        el tablero publico de pedidos (CUSTOMER_STATUS): TV,
 *                      tablet o telefono. Solo numero, estado y primer nombre
 *                      (publicCustomerName, calculado en SQL).
 *   SEGUIMIENTO        `/p/:codigo`, el pedido de UNA persona. Conservado para
 *                      el futuro (seguimiento.js).
 *
 * EL QR, HOY, LLEVA AL TABLERO GENERAL: `http://HOST:7427/pedidos`, la misma
 * superficie que la TV, adaptada al telefono. Con SEGUIMIENTO_INDIVIDUAL en
 * true llevaria a `/p/:codigo` sin tocar nada mas. Nunca los dos QR a la vez.
 *
 * Solo red local: la direccion es la del Local Host vigente
 * (`local_host_lease`). Sin Host vigente no hay QR, y el cobro sigue igual.
 */
const { urlDeSeguimiento } = require('./seguimiento');

/** Interruptor interno. Sin configuracion visible todavia. */
const SEGUIMIENTO_INDIVIDUAL = false;
const RUTA_TABLERO = '/pedidos';

/** La direccion del Local Host vigente, la pida la caja que la pida. */
async function direccionDelHost({ pool }) {
  const r = await (await pool()).request().query(`
    SELECT TOP 1 direccion, puerto FROM dbo.local_host_lease
     WHERE id = 1 AND lease_until > SYSUTCDATETIME();`);
  const f = r.recordset?.[0];
  return f?.direccion && f?.puerto ? `http://${f.direccion}:${f.puerto}` : null;
}

/** La direccion del tablero general, o null si no hay Local Host vigente. */
async function urlDelTablero({ pool }) {
  const base = await direccionDelHost({ pool });
  return base ? `${base}${RUTA_TABLERO}` : null;
}

/** El nombre que ve quien paga: el de su ficha, sin nada mas. */
function nombreParaPantallaCliente(v) {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, 60) : null;
}

/**
 * Lo que la pantalla del cliente recibe del pedido: { numero, cliente, qr }.
 * `pedido` llega de la caja: { numero, cuentaId?, cliente? }. El QR ya va
 * hecho imagen: la pantalla no consulta nada.
 */
async function pedidoParaPantallaCliente({ pool, sql, QRCode, pedido, individual = SEGUIMIENTO_INDIVIDUAL }) {
  const numero = Number(pedido?.numero);
  if (!Number.isInteger(numero) || numero <= 0) return null;
  const cliente = nombreParaPantallaCliente(pedido?.cliente);
  let url = null;
  try {
    if (individual) url = (await urlDeSeguimiento({ pool, sql, cuentaId: pedido?.cuentaId }))?.url ?? null;
    else url = await urlDelTablero({ pool });
  } catch { url = null; }
  const qr = url ? await QRCode.toDataURL(url, { margin: 1, width: 420, errorCorrectionLevel: 'M' }) : null;
  return { numero, cliente, qr };
}

module.exports = { pedidoParaPantallaCliente, urlDelTablero, nombreParaPantallaCliente, SEGUIMIENTO_INDIVIDUAL, RUTA_TABLERO };
