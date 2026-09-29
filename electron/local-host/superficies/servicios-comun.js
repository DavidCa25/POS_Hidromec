/**
 * EL TRABAJO DE UN PROFESIONAL SOBRE UNA ORDEN DE SERVICIO.
 *
 * Lo comparten «Mi jornada» (Belleza, agenda) y «Tecnico» (Taller, ordenes).
 * Ningun dominio nuevo: la linea de la orden ya tiene su estado
 * (PENDIENTE -> EN_PROCESO -> HECHA) y la orden el suyo; se mueven con
 * sp_service_order_update_line y sp_service_order_set_status, los mismos que
 * usa la pantalla de la orden en la caja.
 *
 * Lo que el dominio NO tiene, no se inventa:
 *   - «Pausada» no es un estado: la linea sigue EN_PROCESO y la pausa queda en
 *     el historial (PAUSA / REANUDA, sp_service_order_add_event).
 *   - Consumo interno no cobrado no existe: un material usado entra a la orden
 *     como linea PRODUCTO a precio de catalogo (el tecnico no toca precios) y
 *     sale del inventario cuando se cobra, como cualquier refaccion.
 *
 * Cada cambio va en una transaccion con la fila bloqueada y dice desde que
 * estado lo vio la tablet: si otra tablet (o la caja) ya la movio, no se pisa.
 */
const { negocio, conflicto, prohibido, entero, decimal, texto, sp, esErrorDeNegocio } = require('./comun');

async function leerLinea(tx, sql, lineaId) {
  const r = await new sql.Request(tx).input('id', sql.Int, lineaId).query(`
    SELECT l.id, l.order_id, l.professional_id, l.status, l.line_kind, l.name_snapshot,
           o.status AS orden_status, o.sale_id
      FROM dbo.service_order_lines l WITH (UPDLOCK, ROWLOCK)
      JOIN dbo.service_orders o ON o.id = l.order_id
     WHERE l.id = @id;`);
  return r.recordset?.[0] || null;
}

function exigirMia(ctx, linea) {
  if (!linea) throw negocio('Ese trabajo ya no existe.', { http: 404 });
  if (Number(linea.professional_id) !== Number(ctx.sesion.persona.professionalId)) {
    throw prohibido('Ese trabajo no está asignado a ti.');
  }
  if (linea.sale_id) throw negocio('Esta orden ya se cobró.');
  if (['CANCELADA', 'ENTREGADA'].includes(linea.orden_status)) throw negocio('Esta orden ya está cerrada.');
}

/**
 * Mueve la linea de `desde` a `hacia`. Si ya esta en `hacia`, es un reintento
 * y no pasa nada. Si esta en otro estado, es un conflicto.
 */
async function moverLinea(ctx, lineaId, desdePermitidos, hacia) {
  const { sql } = ctx;
  const p = await ctx.pool();
  const tx = new sql.Transaction(p);
  await tx.begin();
  let linea, repetido = false, ordenTerminada = false;
  try {
    linea = await leerLinea(tx, sql, lineaId);
    exigirMia(ctx, linea);
    if (linea.status === hacia) repetido = true;
    else if (!desdePermitidos.includes(linea.status)) throw conflicto();
    else {
      await new sql.Request(tx)
        .input('line_id', sql.Int, lineaId)
        .input('status', sql.NVarChar(12), hacia)
        .input('user_id', sql.Int, ctx.sesion.persona.userId)
        .execute('sp_service_order_update_line');

      if (hacia === 'EN_PROCESO' && ['BORRADOR', 'ABIERTA'].includes(linea.orden_status)) {
        await new sql.Request(tx)
          .input('id', sql.Int, linea.order_id).input('status', sql.NVarChar(20), 'EN_PROCESO')
          .input('user_id', sql.Int, ctx.sesion.persona.userId)
          .execute('sp_service_order_set_status');
      }
      if (hacia === 'HECHA') {
        /* La orden se da por terminada cuando TODO su trabajo (servicios no
           cancelados) esta hecho. Con trabajo pendiente de otra persona, sigue. */
        const r = await new sql.Request(tx).input('o', sql.Int, linea.order_id).query(`
          SELECT COUNT(*) AS pendientes FROM dbo.service_order_lines
           WHERE order_id = @o AND line_kind = 'SERVICIO' AND status NOT IN ('HECHA', 'CANCELADA');`);
        if ((r.recordset?.[0]?.pendientes ?? 1) === 0 && linea.orden_status !== 'TERMINADA') {
          await new sql.Request(tx)
            .input('id', sql.Int, linea.order_id).input('status', sql.NVarChar(20), 'TERMINADA')
            .input('user_id', sql.Int, ctx.sesion.persona.userId)
            .execute('sp_service_order_set_status');
          ordenTerminada = true;
        }
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    if (esErrorDeNegocio(e)) throw negocio(String(e.message).trim());
    throw e;
  }
  return {
    lineaId, ordenId: linea.order_id, estado: hacia, repetido, ordenTerminada,
    auditoria: { entidad: 'LINEA', entidadId: lineaId, detalle: repetido ? `${hacia} (repetido)` : `${linea.status} -> ${hacia}` },
  };
}

/** La orden debe tener al menos una linea de esta persona. */
async function exigirOrdenMia(ctx, ordenId) {
  const { sql } = ctx;
  const r = await (await ctx.pool()).request()
    .input('o', sql.Int, ordenId).input('p', sql.Int, ctx.sesion.persona.professionalId).query(`
      SELECT o.status, o.sale_id,
             (SELECT COUNT(*) FROM dbo.service_order_lines WHERE order_id = o.id AND professional_id = @p AND status <> 'CANCELADA') AS mias
        FROM dbo.service_orders o WHERE o.id = @o;`);
  const f = r.recordset?.[0];
  if (!f) throw negocio('Esa orden ya no existe.', { http: 404 });
  if (!f.mias) throw prohibido('Esa orden no tiene trabajo tuyo.');
  if (f.sale_id) throw negocio('Esta orden ya se cobró.');
  if (['CANCELADA', 'ENTREGADA'].includes(f.status)) throw negocio('Esta orden ya está cerrada.');
}

async function evento(ctx, ordenId, tipo, detalle) {
  const { sql } = ctx;
  await sp(await ctx.pool(), 'sp_service_order_add_event', (r) => r
    .input('order_id', sql.Int, ordenId)
    .input('event_type', sql.NVarChar(30), tipo)
    .input('detail', sql.NVarChar(400), detalle)
    .input('user_id', sql.Int, ctx.sesion.persona.userId));
}

/** Nota rapida: queda en el historial de la orden, con quien la escribio. */
async function nota(ctx, ordenId, textoNota) {
  const t = texto(textoNota, 300);
  if (!t) throw negocio('La nota está vacía.', { http: 400 });
  await exigirOrdenMia(ctx, ordenId);
  await evento(ctx, ordenId, 'NOTA', `${ctx.sesion.persona.nombre}: ${t}`);
  return { ordenId, auditoria: { entidad: 'ORDEN', entidadId: ordenId, detalle: 'nota' } };
}

/** Pausa y reanudacion: solo historial. `[L<id>]` dice de que trabajo. */
async function pausa(ctx, lineaId, pausar) {
  const { sql } = ctx;
  const p = await ctx.pool();
  const r = await p.request().input('id', sql.Int, lineaId).query(`
    SELECT l.id, l.order_id, l.professional_id, l.status, l.line_kind, o.status AS orden_status, o.sale_id,
           (SELECT TOP 1 e.event_type FROM dbo.service_order_events e
             WHERE e.order_id = l.order_id AND e.event_type IN ('PAUSA', 'REANUDA') AND e.detail LIKE '[[]L' + CONVERT(NVARCHAR(12), l.id) + ']%'
             ORDER BY e.id DESC) AS ultima
      FROM dbo.service_order_lines l JOIN dbo.service_orders o ON o.id = l.order_id WHERE l.id = @id;`);
  const linea = r.recordset?.[0];
  exigirMia(ctx, linea);
  const enPausa = linea.ultima === 'PAUSA';
  if (pausar) {
    if (linea.status !== 'EN_PROCESO') throw conflicto('Solo se pausa un trabajo que está en proceso.');
    if (enPausa) return { lineaId, pausado: true, repetido: true };
  } else if (!enPausa) return { lineaId, pausado: false, repetido: true };
  await evento(ctx, linea.order_id, pausar ? 'PAUSA' : 'REANUDA', `[L${lineaId}] ${ctx.sesion.persona.nombre}`);
  return { lineaId, pausado: pausar, auditoria: { entidad: 'LINEA', entidadId: lineaId, detalle: pausar ? 'pausa' : 'reanuda' } };
}

/**
 * Material o refaccion usada. Entra a la orden como linea PRODUCTO al precio
 * del catalogo; sale del inventario al cobrarse, como cualquier producto.
 */
async function material(ctx, ordenId, productId, cantidad) {
  const { sql } = ctx;
  const q = decimal(cantidad, { min: 0.01, max: 999 });
  if (!entero(productId) || !q) throw negocio('Elige el material y la cantidad.', { http: 400 });
  await exigirOrdenMia(ctx, ordenId);
  const p = await ctx.pool();
  const r = await p.request().input('id', sql.Int, productId).query(`
    SELECT p.id, p.nombre, ISNULL(p.active, 0) AS activo,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.services s WHERE s.product_id = p.id) THEN 1 ELSE 0 END AS es_servicio
      FROM dbo.products p WHERE p.id = @id;`);
  const prod = r.recordset?.[0];
  if (!prod || !prod.activo) throw negocio('Ese material no existe o está dado de baja.');
  if (prod.es_servicio) throw negocio('Eso es un servicio, no un material.');
  await sp(p, 'sp_service_order_add_line', (x) => x
    .input('order_id', sql.Int, ordenId)
    .input('product_id', sql.Int, productId)
    .input('quantity', sql.Decimal(12, 2), q)
    .input('user_id', sql.Int, ctx.sesion.persona.userId));
  return {
    ordenId, productId, cantidad: q, nombre: prod.nombre,
    auditoria: { entidad: 'ORDEN', entidadId: ordenId, detalle: `material ${prod.nombre} x${q}` },
  };
}

/** Materiales que se pueden elegir: productos activos que no son servicios. Sin costos ni precios. */
async function buscarMateriales(ctx, q) {
  const { sql } = ctx;
  const t = texto(q, 60);
  const r = await (await ctx.pool()).request().input('q', sql.NVarChar(62), t ? `%${t}%` : null).query(`
    SELECT TOP 20 p.id, p.nombre, p.part_number, p.base_uom AS unidad
      FROM dbo.products p
     WHERE ISNULL(p.active, 0) = 1
       AND NOT EXISTS (SELECT 1 FROM dbo.services s WHERE s.product_id = p.id)
       AND (@q IS NULL OR p.nombre LIKE @q OR p.part_number LIKE @q OR p.bar_code LIKE @q)
     ORDER BY p.nombre;`);
  return { materiales: r.recordset || [] };
}

module.exports = { moverLinea, nota, pausa, material, buscarMateriales, exigirOrdenMia };
