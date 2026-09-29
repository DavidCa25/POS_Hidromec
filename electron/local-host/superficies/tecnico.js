/**
 * TECHNICIAN — Taller, reparacion, mantenimiento. El tecnico entra y ve SUS
 * trabajos: las lineas de servicio de ordenes abiertas asignadas a el.
 * Un trabajo de otro (o sin asignar) no viaja a su tablet.
 *
 * VE: folio, cliente (solo nombre), el activo (vehiculo/equipo: descripcion y
 * placa o serie), lo que reporto el cliente, la promesa de entrega, su
 * trabajo, los materiales ya puestos (sin precios) y las ultimas notas.
 * NO: precios, totales, telefono, credito, ventas.
 *
 * HACE: EMPEZAR, PAUSAR, REANUDAR, TERMINAR, NOTA, MATERIAL. Nunca cobrar ni
 * tocar precios: esas acciones no existen en esta superficie.
 *
 * Lo que el dominio no tiene y queda fuera (deuda, sin inventar):
 *   - checklist de inspeccion: no existe en las ordenes;
 *   - fotos de la orden: product_images es del catalogo, no hay adjuntos de
 *     orden, y la camara no esta disponible por HTTP en la red local.
 */
const { entero, texto } = require('./comun');
const trabajo = require('./servicios-comun');

module.exports = function tecnico() {
  async function misTrabajos(ctx) {
    const { sql } = ctx;
    const p = await ctx.pool();
    const r = await p.request().input('p', sql.Int, ctx.sesion.persona.professionalId).query(`
      SELECT l.id, l.order_id, l.name_snapshot, l.status, l.quantity,
             o.folio, o.status AS orden_status, o.reported_issue, o.promised_at, o.authorized_at, o.opened_at,
             CASE WHEN o.promised_at IS NULL THEN NULL
                  WHEN CAST(o.promised_at AS DATE) = CAST(SYSDATETIME() AS DATE) THEN 'Hoy ' + CONVERT(CHAR(5), o.promised_at, 108)
                  ELSE CONVERT(CHAR(5), o.promised_at, 103) + ' ' + CONVERT(CHAR(5), o.promised_at, 108) END AS promesa_txt,
             c.customerName AS cliente,
             ca.label, ca.brand, ca.model, ca.identifier, ca.year_or_age, ca.color,
             (SELECT TOP 1 e.event_type FROM dbo.service_order_events e
               WHERE e.order_id = l.order_id AND e.event_type IN ('PAUSA', 'REANUDA')
                 AND e.detail LIKE '[[]L' + CONVERT(NVARCHAR(12), l.id) + ']%'
               ORDER BY e.id DESC) AS ultima_pausa
        FROM dbo.service_order_lines l
        JOIN dbo.service_orders o ON o.id = l.order_id
        JOIN dbo.customers c ON c.id = o.customer_id
        LEFT JOIN dbo.customer_assets ca ON ca.id = o.customer_asset_id
       WHERE l.professional_id = @p AND l.line_kind = 'SERVICIO' AND l.status <> 'CANCELADA'
         AND o.status NOT IN ('CANCELADA', 'ENTREGADA') AND o.sale_id IS NULL
         AND (l.status <> 'HECHA' OR o.status <> 'TERMINADA' OR CAST(o.opened_at AS DATE) = CAST(SYSDATETIME() AS DATE))
       ORDER BY CASE l.status WHEN 'EN_PROCESO' THEN 0 WHEN 'PENDIENTE' THEN 1 ELSE 2 END,
                ISNULL(o.promised_at, '9999-12-31'), o.id;`);
    const filas = r.recordset || [];
    const ordenes = [...new Set(filas.map(f => f.order_id))];
    const extra = new Map(ordenes.map(o => [o, { materiales: [], notas: [] }]));
    if (ordenes.length) {
      const lista = ordenes.join(',');   // enteros de la base: seguro para IN (...)
      const m = await p.request().query(`
        SELECT order_id, name_snapshot, quantity FROM dbo.service_order_lines
         WHERE order_id IN (${lista}) AND line_kind = 'PRODUCTO' AND status <> 'CANCELADA' ORDER BY id;
        SELECT order_id, detail, hora FROM (
          SELECT order_id, detail, CONVERT(CHAR(5), happened_at, 108) AS hora, happened_at,
                 ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY id DESC) AS n
            FROM dbo.service_order_events WHERE order_id IN (${lista}) AND event_type = 'NOTA') x
         WHERE n <= 3 ORDER BY happened_at DESC;`);
      for (const f of m.recordsets[0] || []) extra.get(f.order_id).materiales.push({ nombre: f.name_snapshot, cantidad: Number(f.quantity) });
      for (const f of m.recordsets[1] || []) extra.get(f.order_id).notas.push({ texto: f.detail, hora: f.hora });
    }
    return filas.map(f => ({
      lineaId: f.id,
      ordenId: f.order_id,
      folio: f.folio,
      trabajo: f.name_snapshot,
      estado: f.status,
      pausado: f.status === 'EN_PROCESO' && f.ultima_pausa === 'PAUSA',
      cliente: f.cliente,
      activo: [f.brand, f.model, f.year_or_age].filter(Boolean).join(' ') || f.label || null,
      identificador: f.identifier || null,
      color: f.color || null,
      reportado: f.reported_issue || null,
      promesa: f.promesa_txt || null,
      autorizada: !!f.authorized_at,
      ...extra.get(f.order_id),
    }));
  }

  return {
    tipo: 'TECHNICIAN',
    familia: 'TRABAJADOR',
    nombre: 'Técnico',
    descripcion: 'Cada técnico ve sus trabajos asignados y los avanza',
    icono: 'wrench',
    identidad: 'TRABAJADOR',
    requiereProfesional: true,
    permiteProfesionalSinUsuario: true,
    paquetes: ['SERVICIOS_OPERAR'],
    sesion: { inactividadMin: 120 },
    sonido: 'Cuando te asignan un trabajo nuevo',
    fuentes: ['lineas'],
    disponible: (c) => c.ordenes,

    async estado(ctx) {
      const trabajos = await misTrabajos(ctx);
      const siguiente = trabajos.find(t => t.estado === 'EN_PROCESO') || trabajos.find(t => t.estado === 'PENDIENTE') || null;
      return {
        trabajos,
        reposo: {
          pendientes: trabajos.filter(t => t.estado === 'PENDIENTE').length,
          enProceso: trabajos.filter(t => t.estado === 'EN_PROCESO').length,
          hechos: trabajos.filter(t => t.estado === 'HECHA').length,
          siguiente: siguiente ? { lineaId: siguiente.lineaId, activo: siguiente.activo, trabajo: siguiente.trabajo, promesa: siguiente.promesa } : null,
        },
      };
    },

    consultas: {
      materiales: (ctx, q) => trabajo.buscarMateriales(ctx, q.q),
    },

    acciones: {
      EMPEZAR: { modo: 'OFFLINE_SAFE', ejecutar: (ctx, d) => trabajo.moverLinea(ctx, entero(d?.lineaId), ['PENDIENTE'], 'EN_PROCESO') },
      TERMINAR: { modo: 'OFFLINE_SAFE', ejecutar: (ctx, d) => trabajo.moverLinea(ctx, entero(d?.lineaId), ['PENDIENTE', 'EN_PROCESO'], 'HECHA') },
      PAUSAR: { modo: 'OFFLINE_SAFE', ejecutar: (ctx, d) => trabajo.pausa(ctx, entero(d?.lineaId), true) },
      REANUDAR: { modo: 'OFFLINE_SAFE', ejecutar: (ctx, d) => trabajo.pausa(ctx, entero(d?.lineaId), false) },
      NOTA: { modo: 'OFFLINE_SAFE', ejecutar: (ctx, d) => trabajo.nota(ctx, entero(d?.ordenId), texto(d?.texto, 300)) },
      MATERIAL: { modo: 'OFFLINE_SAFE', ejecutar: (ctx, d) => trabajo.material(ctx, entero(d?.ordenId), d?.productId, d?.cantidad) },
    },

    evento(cambio, ctx) {
      const yo = Number(ctx.sesion?.persona?.professionalId);
      if (!yo || cambio.fuente !== 'lineas' || Number(cambio.fila.professional_id) !== yo) return null;
      if (cambio.fila.line_kind !== 'SERVICIO') return { tipo: 'WORK_UPDATED', id: cambio.fila.id };
      /* Nuevo trabajo para mi: una linea nueva, o una que me acaban de asignar. */
      if (cambio.nueva || (cambio.anteriorProfesional != null && Number(cambio.anteriorProfesional) !== yo)) {
        return { tipo: 'WORK_ASSIGNED', id: cambio.fila.id, sonar: true };
      }
      return { tipo: 'WORK_UPDATED', id: cambio.fila.id };
    },
  };
};
