/**
 * INVENTORY_FLOOR — inventario de piso y almacen, en una tablet o telefono.
 *
 * Buscar (por nombre, clave o codigo de barras: un lector de codigos por
 * USB/Bluetooth teclea el codigo), ver existencia y precio, contar, y
 * reportar un faltante.
 *
 * Wybix no maneja hoy ubicaciones ni stock separado de piso y almacen, asi
 * que la V1 NO inventa «Reponer: piso 2 / almacen 18». Queda como deuda.
 *
 * CONTAR respeta los permisos que ya existen:
 *   - con INVENTARIO_OPERAR y en linea: se aplica con sp_inventory_count_apply,
 *     el mismo ajuste de la pantalla Conteo de Wybix.
 *   - sin ese permiso, O si el conteo llega desde la cola sin conexion: se
 *     REPORTA (inventario_reportes) y alguien con permiso lo aplica o lo
 *     descarta desde Wybix. Un conteo de hace una hora aplicado a ciegas
 *     sobrescribiria las ventas de esa hora: eso no se hace en silencio.
 * FALTANTE siempre se reporta.
 */
const { negocio, entero, decimal, texto, sp } = require('./comun');

module.exports = function inventario() {
  const puedeAjustar = (ctx) => !!ctx.sesion?.persona?.paquetes?.has('INVENTARIO_OPERAR');

  async function producto(ctx, productId) {
    const r = await (await ctx.pool()).request().input('id', ctx.sql.Int, productId).query(`
      SELECT id, nombre, stock, ISNULL(active, 0) AS activo, inventory_mode FROM dbo.products WHERE id = @id;`);
    const p = r.recordset?.[0];
    if (!p || !p.activo) throw negocio('Ese producto no existe o está dado de baja.', { http: 404 });
    return p;
  }

  async function reportar(ctx, { tipo, productId, cantidad = null, stock = null, nota = null }) {
    const r = await (await ctx.pool()).request()
      .input('p', ctx.sql.Int, productId)
      .input('t', ctx.sql.NVarChar(10), tipo)
      .input('c', ctx.sql.Decimal(12, 2), cantidad)
      .input('s', ctx.sql.Decimal(12, 2), stock)
      .input('n', ctx.sql.NVarChar(200), nota)
      .input('loc', ctx.sql.DateTime2(0), ctx.localCreadoEn || null)
      .input('u', ctx.sql.Int, ctx.sesion.persona.userId)
      .input('d', ctx.sql.UniqueIdentifier, ctx.disp.id)
      .query(`INSERT INTO dbo.inventario_reportes (product_id, tipo, cantidad, stock_al_reportar, nota, local_creado_en, user_id, dispositivo_id)
              OUTPUT inserted.id VALUES (@p, @t, @c, @s, @n, @loc, @u, @d);`);
    return r.recordset[0].id;
  }

  return {
    tipo: 'INVENTORY_FLOOR',
    familia: 'TRABAJADOR',
    nombre: 'Inventario',
    descripcion: 'Buscar, ver existencia, contar y reportar faltantes',
    icono: 'package',
    identidad: 'TRABAJADOR',
    paquetes: ['INVENTARIO_OPERAR', 'VENTAS_OPERAR'],
    sesion: { inactividadMin: 45 },
    sonido: null,
    fuentes: ['inventario'],
    disponible: (c) => c.inventario,

    async estado(ctx) {
      const r = await (await ctx.pool()).request().input('u', ctx.sql.Int, ctx.sesion.persona.userId).query(`
        SELECT TOP 15 r.id, r.tipo, r.cantidad, r.estado, r.reportado_en, p.nombre
          FROM dbo.inventario_reportes r JOIN dbo.products p ON p.id = r.product_id
         WHERE r.user_id = @u AND r.reportado_en >= DATEADD(HOUR, -18, SYSUTCDATETIME())
         ORDER BY r.id DESC;
        SELECT COUNT(DISTINCT entidad_id) AS contados
          FROM dbo.superficie_auditoria
         WHERE user_id = @u AND accion = 'CONTAR' AND momento >= DATEADD(HOUR, -18, SYSUTCDATETIME());
        SELECT COUNT(*) AS faltantes FROM dbo.inventario_reportes
         WHERE user_id = @u AND tipo = 'FALTANTE' AND reportado_en >= DATEADD(HOUR, -18, SYSUTCDATETIME());`);
      return {
        puedeAjustar: puedeAjustar(ctx),
        recientes: (r.recordsets[0] || []).map(f => ({ id: f.id, producto: f.nombre, tipo: f.tipo, cantidad: f.cantidad == null ? null : Number(f.cantidad), estado: f.estado, en: f.reportado_en })),
        reposo: { revisados: r.recordsets[1]?.[0]?.contados ?? 0, faltantes: r.recordsets[2]?.[0]?.faltantes ?? 0 },
      };
    },

    consultas: {
      /** Solo lo que el piso necesita: sin costo, sin proveedor. */
      async buscar(ctx, q) {
        const t = texto(q.q, 60);
        if (!t) return { productos: [] };
        const r = await (await ctx.pool()).request()
          .input('exacto', ctx.sql.NVarChar(60), t)
          .input('q', ctx.sql.NVarChar(62), `%${t}%`).query(`
          SELECT TOP 20 p.id, p.nombre, p.part_number, p.bar_code, p.stock, p.price, p.base_uom, p.inventory_mode,
                 CASE WHEN p.bar_code = @exacto OR p.part_number = @exacto THEN 0 ELSE 1 END AS orden
            FROM dbo.products p
           WHERE ISNULL(p.active, 0) = 1
             AND NOT EXISTS (SELECT 1 FROM dbo.services s WHERE s.product_id = p.id)
             AND (p.bar_code = @exacto OR p.part_number = @exacto OR p.nombre LIKE @q OR p.part_number LIKE @q)
           ORDER BY orden, p.nombre;`);
        return {
          productos: (r.recordset || []).map(p => ({
            id: p.id, nombre: p.nombre, clave: p.part_number, codigo: p.bar_code,
            existencia: p.inventory_mode === 'RECIPE' ? null : Number(p.stock ?? 0),
            precio: Number(p.price ?? 0), unidad: p.base_uom || 'pza',
            receta: p.inventory_mode === 'RECIPE', sinInventario: p.inventory_mode === 'NONE',
            exacto: p.orden === 0,
          })),
        };
      },
    },

    acciones: {
      CONTAR: {
        modo: 'OFFLINE_SAFE',
        async ejecutar(ctx, d) {
          const productId = entero(d?.productId);
          const cantidad = decimal(d?.cantidad, { min: 0, max: 9999999 });
          if (!productId || cantidad == null) throw negocio('Escribe cuántos contaste.', { http: 400 });
          const p = await producto(ctx, productId);
          if (p.inventory_mode === 'RECIPE') throw negocio('Este producto se prepara con receta: sus existencias son las de sus ingredientes.');
          if (puedeAjustar(ctx) && !ctx.diferida) {
            const sets = await sp(await ctx.pool(), 'sp_inventory_count_apply', (r) => r
              .input('product_id', ctx.sql.Int, productId)
              .input('fisico', ctx.sql.Decimal(12, 2), cantidad)
              .input('user_id', ctx.sql.Int, ctx.sesion.persona.userId));
            const f = sets[0]?.[0] || {};
            return { aplicado: true, productId, cantidad, diferencia: Number(f.diferencia ?? 0),
              auditoria: { entidad: 'PRODUCTO', entidadId: productId, detalle: `conteo aplicado ${cantidad} (dif ${Number(f.diferencia ?? 0)})` } };
          }
          const id = await reportar(ctx, { tipo: 'CONTEO', productId, cantidad, stock: Number(p.stock ?? 0) });
          return { aplicado: false, reporteId: id, productId, cantidad,
            motivo: ctx.diferida ? 'SIN_CONEXION' : 'SIN_PERMISO',
            auditoria: { entidad: 'PRODUCTO', entidadId: productId, detalle: `conteo reportado ${cantidad}` } };
        },
      },
      FALTANTE: {
        modo: 'OFFLINE_SAFE',
        async ejecutar(ctx, d) {
          const productId = entero(d?.productId);
          if (!productId) throw negocio('Elige el producto.', { http: 400 });
          const p = await producto(ctx, productId);
          const id = await reportar(ctx, { tipo: 'FALTANTE', productId, stock: Number(p.stock ?? 0), nota: texto(d?.nota, 200) });
          return { reporteId: id, productId, auditoria: { entidad: 'PRODUCTO', entidadId: productId, detalle: 'faltante' } };
        },
      },
    },

    evento(cambio, ctx) {
      if (cambio.fuente !== 'inventario' || Number(cambio.fila.user_id) !== Number(ctx.sesion?.persona?.userId)) return null;
      return { tipo: 'INVENTORY_TASK_UPDATED', id: cambio.fila.id };
    },
  };
};
