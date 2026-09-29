/**
 * LOS PEDIDOS DEL DIA, COMO LOS VE CUALQUIERA: `pedidosPublicos()`.
 *
 * La UNICA fuente del tablero de pedidos. La usan:
 *   - la TV o tablet del negocio (superficie CUSTOMER_STATUS, con credencial);
 *   - el telefono del cliente que escaneo el QR de la pantalla de la caja
 *     (ruta publica `/pedidos`, sin credencial);
 *   - el seguimiento individual (`/p/:codigo`, conservado para el futuro).
 * La pagina cambia por CSS segun la pantalla; los datos no.
 *
 * El DTO publico es cerrado a proposito, y es todo lo que sale:
 *
 *   { numeroPedido, estado, nombrePublico, reciente?, mesa? }
 *
 *   numeroPedido   el numero del dia (el que va en el ticket). Siempre.
 *   estado         PREPARANDO | LISTO.
 *   nombrePublico  `dbo.fn_nombre_publico_cliente`: solo el primer nombre, o
 *                  null. Se calcula EN SQL: el nombre completo del cliente no
 *                  sale de la base por esta consulta. Nunca telefono, correo,
 *                  RFC, direccion ni datos fiscales.
 *   reciente       acaba de quedar listo (< RECIENTE_SEG): va al hero.
 *   mesa           solo si el negocio eligio incluir mesas en esa pantalla.
 *
 * PREPARANDO mientras alguna comanda este NUEVA o PREPARANDO; LISTO cuando
 * todas estan listas. Un pedido LISTO deja de ensenarse a los `minutosListo`
 * o al entregarse.
 */
const MIN_LISTO = 10;
/* «Acaba de estar listo»: lo que dura el hero antes de pasar al muro. */
const RECIENTE_SEG = 45;

async function pedidosPublicos(pool, { mesas = false, minutosListo = MIN_LISTO } = {}) {
  const r = await pool.request().input('mesas', mesas ? 1 : 0).input('reciente', RECIENTE_SEG).query(`
    SELECT c.numero_dia, c.mesa_id, m.nombre AS mesa,
           dbo.fn_nombre_publico_cliente(cu.customerName) AS nombre_publico,
           SUM(CASE WHEN k.estado IN ('NUEVA', 'PREPARANDO') THEN 1 ELSE 0 END) AS pendientes,
           SUM(CASE WHEN k.estado = 'LISTA' THEN 1 ELSE 0 END) AS listas,
           DATEDIFF(SECOND, MAX(k.lista_en), SYSDATETIME()) AS seg_desde_lista
      FROM dbo.comandas k
      JOIN dbo.hosp_cuentas c ON c.id = k.cuenta_id
      LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
      LEFT JOIN dbo.customers cu ON cu.id = c.customer_id
     WHERE k.creada_en >= CAST(SYSDATETIME() AS DATE) AND k.estado <> 'CANCELADA'
       AND (c.numero_dia IS NOT NULL OR (@mesas = 1 AND c.mesa_id IS NOT NULL))
     GROUP BY c.id, c.numero_dia, c.mesa_id, m.nombre, cu.customerName
    HAVING SUM(CASE WHEN k.estado IN ('NUEVA', 'PREPARANDO', 'LISTA') THEN 1 ELSE 0 END) > 0
     ORDER BY MIN(k.creada_en);
    SELECT TOP 1 business_name FROM dbo.business_config;`);
  const pedidos = [];
  for (const f of r.recordset || []) {
    const listo = f.pendientes === 0 && f.listas > 0;
    /* Segundos calculados en SQL: las horas de las comandas son locales. */
    if (listo && f.seg_desde_lista != null && f.seg_desde_lista >= minutosListo * 60) continue;
    const p = {
      /* Una mesa no tiene numero de pedido: se reconoce por su nombre. */
      numeroPedido: f.numero_dia ?? null,
      estado: listo ? 'LISTO' : 'PREPARANDO',
      nombrePublico: f.nombre_publico || null,
    };
    if (listo && f.seg_desde_lista != null && f.seg_desde_lista < RECIENTE_SEG) p.reciente = true;
    if (f.mesa_id) p.mesa = /^\d+$/.test(f.mesa) ? `Mesa ${f.mesa}` : f.mesa;
    pedidos.push({ p, orden: listo ? (f.seg_desde_lista ?? 0) : 0 });
  }
  /* Listos: el mas reciente primero. */
  const listos = pedidos.filter(x => x.p.estado === 'LISTO').sort((a, b) => a.orden - b.orden).map(x => x.p);
  /* El nombre del negocio es publico (esta en el ticket): da contexto. */
  const negocio = r.recordsets?.[1]?.[0]?.business_name || null;
  return { pedidos: [...listos, ...pedidos.filter(x => x.p.estado !== 'LISTO').map(x => x.p)], negocio };
}

module.exports = { pedidosPublicos, MIN_LISTO, RECIENTE_SEG };
