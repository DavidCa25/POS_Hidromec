/**
 * SEGUIMIENTO INDIVIDUAL DEL PEDIDO EN EL TELEFONO DEL CLIENTE.
 *
 * CONSERVADO PARA EL FUTURO. Hoy el QR de la pantalla de la caja lleva al
 * tablero GENERAL (`/pedidos`); este seguimiento sigue funcionando y probado
 * (ruta `/p/:codigo`), pero nadie lo ofrece mientras
 * `qr-pantalla-cliente.js` tenga SEGUIMIENTO_INDIVIDUAL = false.
 *
 * Al cobrar un pedido de mostrador, la pantalla del cliente en la caja ensena
 * su numero y un QR. El cliente lo escanea y, por la red del local, ve el
 * estado de pedidos con el suyo marcado: cuando pasa a Listo, se entera sin
 * mirar la TV.
 *
 * Es lo MAS expuesto del Local Host: un telefono que no esta emparejado, de
 * alguien que no trabaja aqui. Por eso es lo mas pobre:
 *
 *   - la URL lleva el codigo de seguimiento de UN pedido
 *     (`hosp_cuentas.seguimiento`, 128 bits aleatorios); sin el, nada;
 *   - solo vale el dia del pedido;
 *   - solo se LEE: numero y estado del suyo, y el mismo DTO publico que la
 *     TV (numero, estado, primer nombre). Nunca un nombre completo, un total
 *     ni un producto;
 *   - no da credencial, cookie ni sesion: no convierte al telefono en una
 *     pantalla de Wybix;
 *   - solo por la red local: no hay tunel, ni reenvio de puertos, ni nube.
 *     Quien no esta en el Wi-Fi del local no llega (y la pantalla lo dice).
 */
const { pedidosPublicos } = require('./superficies/pedidos-dia');

const CODIGO = /^[0-9A-F]{32}$/;

function crearSeguimiento({ pool, sql }) {
  /** Lo que ve el telefono con ese codigo, o null si no existe o ya no vale. */
  async function leer(codigo) {
    const t = String(codigo || '').toUpperCase();
    if (!CODIGO.test(t)) return null;
    const p = await pool();
    const r = await p.request().input('t', sql.Char(32), t).query(`
      SELECT c.numero_dia, c.estado,
             SUM(CASE WHEN k.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
             SUM(CASE WHEN k.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas,
             SUM(CASE WHEN k.estado = 'ENTREGADA' THEN 1 ELSE 0 END) AS entregadas
        FROM dbo.hosp_cuentas c
        LEFT JOIN dbo.comandas k ON k.cuenta_id = c.id AND k.estado <> 'CANCELADA'
       WHERE c.seguimiento = @t
         AND c.numero_dia IS NOT NULL
         AND c.abierta_dia = CAST(SYSDATETIME() AS DATE)
       GROUP BY c.numero_dia, c.estado;`);
    const f = r.recordset?.[0];
    if (!f) return null;
    let estado = 'RECIBIDO';
    if (f.pendientes > 0) estado = 'PREPARANDO';
    else if (f.listas > 0) estado = 'LISTO';
    else if (f.entregadas > 0) estado = 'ENTREGADO';
    else if (f.estado === 'CANCELADA') estado = 'CANCELADO';
    const { pedidos, negocio } = await pedidosPublicos(p, { mesas: false });
    return { numeroPedido: f.numero_dia, estado, negocio, pedidos };
  }

  return { leer };
}

/**
 * La direccion que lleva el QR de un pedido, o por que no hay.
 *
 * La puede pedir cualquier caja, no solo la que es Host: la direccion del
 * Host sale de su arriendo en la base (`local_host_lease`), vigente.
 * Devuelve { numero, url } o { numero, url: null, motivo }.
 */
async function urlDeSeguimiento({ pool, sql, cuentaId }) {
  const id = Number(cuentaId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await (await pool()).request().input('id', sql.Int, id).query(`
    SELECT c.numero_dia, c.seguimiento, l.direccion, l.puerto
      FROM dbo.hosp_cuentas c
      OUTER APPLY (SELECT TOP 1 direccion, puerto FROM dbo.local_host_lease
                    WHERE id = 1 AND lease_until > SYSUTCDATETIME()) l
     WHERE c.id = @id
       AND c.numero_dia IS NOT NULL
       AND c.abierta_dia = CAST(SYSDATETIME() AS DATE);`);
  const f = r.recordset?.[0];
  if (!f) return null;
  if (!f.seguimiento) return { numero: f.numero_dia, url: null, motivo: 'SIN_CODIGO' };
  if (!f.direccion || !f.puerto) return { numero: f.numero_dia, url: null, motivo: 'SIN_HOST' };
  return { numero: f.numero_dia, url: `http://${f.direccion}:${f.puerto}/p/${String(f.seguimiento).trim()}` };
}

module.exports = { crearSeguimiento, urlDeSeguimiento, CODIGO };
