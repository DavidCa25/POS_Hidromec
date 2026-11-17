'use strict';
/* INVENTARIO Y CATÁLOGO: existencias, merma, ajustes, precios, altas y márgenes. */
const crypto = require('crypto');

module.exports = (h) => {
  const NOMBRE_MOTIVO = Object.fromEntries(h.MOTIVOS.map((m) => [m.valor, m.etiqueta.toLowerCase()]));
  const tasaDe = (p) => ((p.objeto_impuesto || '02') === '02' ? Number(p.tasa_iva ?? 0.16) : 0);

  return {
    async 'consulta.existencia'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      if (p.inventory_mode === 'NONE') return h.msg(`${p.nombre} no lleva existencia (es un servicio o se vende sin inventario).`);
      const reo = (await h.sensores.reorden.leer()).find((x) => x.id === p.id);
      if (p.inventory_mode === 'RECIPE') {
        return h.msg(reo ? `Te alcanza para unos ${h.num(reo.stock)} ${p.nombre}${reo.limita ? `; lo que limita es ${reo.limita.nombre}` : ''}.` : `${p.nombre} se prepara al momento; revisa sus ingredientes en Recetas.`);
      }
      return h.msg(`Quedan ${h.cant(p.stock, p.base_uom)} de ${p.nombre}.`, {
        datos: reo ? [{ etiqueta: 'Vendes al día', valor: h.cant(reo.promDiario, reo.uom) }, { etiqueta: 'Te alcanza para', valor: h.plural(reo.dias, 'día') }] : [],
        opciones: [{ etiqueta: 'Ajustar existencia', intent: 'inventario.ajuste', params: { productId: p.id } }],
        tono: Number(p.stock) <= 0 ? 'atencion' : 'normal' });
    },

    async 'producto.info'(it, ctx) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const datos = [{ etiqueta: 'Precio', valor: h.dinero(p.price) }];
      if (p.inventory_mode === 'DIRECT') datos.push({ etiqueta: 'Existencia', valor: h.cant(p.stock, p.base_uom) });
      if (p.bar_code) datos.push({ etiqueta: 'Código de barras', valor: p.bar_code });
      if (p.part_number) datos.push({ etiqueta: 'Clave', valor: p.part_number });
      if (p.categoria) datos.push({ etiqueta: 'Categoría', valor: p.categoria });
      if (ctx.puede('VER_COSTOS') && Number(p.cost) > 0) datos.push({ etiqueta: 'Costo', valor: h.dinero(p.cost) });
      return h.msg(`${p.nombre} está a ${h.dinero(p.price)}.`, { datos,
        opciones: [{ etiqueta: 'Cambiar el precio', intent: 'producto.precio', params: { productId: p.id } }] });
    },

    async 'inventario.agotados'() {
      const filas = await h.q(`
        SELECT TOP 15 p.id, p.nombre, p.stock,
               (SELECT ISNULL(SUM(sd.quantity), 0) FROM dbo.sale_detail sd JOIN dbo.sales s ON s.id = sd.sale_id
                 WHERE sd.product_id = p.id AND s.datee >= DATEADD(DAY, -30, GETDATE())) AS vendidos30
          FROM dbo.products p
         WHERE p.active = 1 AND p.inventory_mode = 'DIRECT' AND ISNULL(p.sellable, 1) = 1 AND p.stock <= 0
         ORDER BY vendidos30 DESC, p.nombre;`);
      if (!filas.length) return h.msg('No tienes nada agotado.', { tono: 'exito' });
      return h.msg(`Tienes ${h.plural(filas.length, 'producto')} en cero${filas.length === 15 ? ' (los que más se venden primero)' : ''}:`, {
        datos: filas.map((f) => ({ etiqueta: f.nombre, valor: Number(f.stock) < 0 ? `en negativo (${h.num(f.stock)})` : `vendías ${h.num(f.vendidos30)} al mes` })),
        opciones: [{ etiqueta: '¿Qué me falta comprar?', intent: 'consulta.comprar' }], tono: 'atencion' });
    },

    async 'inventario.sin_movimiento'(_it, ctx) {
      const hace60 = Date.now() - 60 * 86_400_000;
      const lista = (await h.sensores.sinMovimiento.leer())
        .filter((x) => (x.ultimaVenta ? Date.parse(x.ultimaVenta) < hace60 : (!x.alta || Date.parse(x.alta) < hace60)))
        .sort((a, b) => b.stock * b.costo - a.stock * a.costo).slice(0, 12);
      if (!lista.length) return h.msg('Todo lo que tienes se ha vendido en los últimos 60 días.', { tono: 'exito' });
      const parado = lista.reduce((a, x) => a + x.stock * x.costo, 0);
      return h.msg(`Esto lleva más de 60 días sin venderse${ctx.puede('VER_COSTOS') && parado ? ` (unos ${h.dinero(parado)} parados)` : ''}:`, {
        datos: lista.map((x) => ({ etiqueta: x.nombre, valor: `${h.num(x.stock)} en existencia · ${x.ultimaVenta ? `última venta ${h.fechaCorta(x.ultimaVenta)}` : 'nunca se ha vendido'}` })),
        opciones: [{ etiqueta: 'Abrir ofertas', intent: 'ir_a', params: { ruta: '/dashboard/inventario/ofertas', etiqueta: 'Ofertas' } }] });
    },

    async 'inventario.valor'() {
      const x = await h.uno(`
        SELECT ISNULL(SUM(stock * ISNULL(cost, 0)), 0) AS costo, ISNULL(SUM(stock * price), 0) AS venta, COUNT(*) AS productos,
               SUM(CASE WHEN ISNULL(cost, 0) = 0 THEN 1 ELSE 0 END) AS sin_costo
          FROM dbo.products WHERE active = 1 AND inventory_mode = 'DIRECT' AND stock > 0;`);
      return h.msg(`Tu inventario vale ${h.dinero(x.costo)} a costo.`, {
        datos: [{ etiqueta: 'A precio de venta', valor: h.dinero(x.venta) }, { etiqueta: 'Productos con existencia', valor: String(x.productos) },
                ...(Number(x.sin_costo) ? [{ etiqueta: 'Sin costo registrado', valor: `${x.sin_costo} (no suman)` }] : [])] });
    },

    async 'inventario.movimientos'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const m = await h.q(`
        SELECT TOP 10 typee, quantity, datee, descriptionn, source FROM dbo.inventory_movements
         WHERE product_id = @id ORDER BY datee DESC, id DESC;`, [h.id(p.id)]);
      if (!m.length) return h.msg(`${p.nombre} no tiene movimientos registrados.`);
      const tipo = (t) => ({ SALE: 'venta', VENTA: 'venta', PURCHASE: 'compra', COMPRA: 'compra', ADJUSTMENT: 'ajuste', AJUSTE: 'ajuste',
                             WASTE: 'merma', MERMA: 'merma', REFUND: 'devolución', TRANSFER: 'traspaso' }[String(t).toUpperCase()] || String(t).toLowerCase());
      return h.msg(`Últimos movimientos de ${p.nombre} (existencia actual ${h.cant(p.stock, p.base_uom)}):`, {
        datos: m.map((x) => ({ etiqueta: `${h.diaTexto(x.datee)} · ${tipo(x.typee)}`, valor: `${Number(x.quantity) > 0 ? '+' : ''}${h.num(x.quantity)}${x.descriptionn ? ` · ${x.descriptionn}` : ''}` })) });
    },

    async 'inventario.ajuste'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      if (p.inventory_mode !== 'DIRECT') return h.msg(`${p.nombre} no lleva existencia propia.`);
      const n = Number(h.v(it, 'cantidad'));
      if (!(n >= 0)) return h.msg('La existencia no puede ser negativa.');
      const dif = n - Number(p.stock);
      if (Math.abs(dif) < 0.0001) return h.msg(`${p.nombre} ya tiene ${h.cant(n, p.base_uom)}.`);
      return h.msg('Este ajuste voy a registrar:', { plan: h.plan('inventario.ajuste', {
        titulo: `Ajuste · ${p.nombre} a ${h.num(n)}`,
        vista: [{ etiqueta: 'Existencia', valor: `${h.num(p.stock)} → ${h.num(n)}` }, { etiqueta: 'Diferencia', valor: `${dif > 0 ? '+' : ''}${h.num(dif)}` },
                ...(Number(p.cost) > 0 ? [{ etiqueta: 'A costo', valor: h.dinero(dif * Number(p.cost)) }] : [])],
        avisos: Math.abs(dif) > Math.max(10, Number(p.stock) * 0.3) ? ['Es una diferencia grande: revisa que el conteo esté bien.'] : [],
        ejecutar: { api: 'electronAPI.inventoryApplyCount', payload: { items: [{ product_id: p.id, fisico: n }] } },
        permiso: 'INVENTARIO_OPERAR',
      }) });
    },

    async 'merma.registrar'(it, ctx) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      if (p.inventory_mode !== 'DIRECT') return h.msg(`${p.nombre} no lleva existencia propia (es ${p.inventory_mode === 'RECIPE' ? 'una receta' : 'un servicio'}): la merma se registra en sus ingredientes.`);
      const n = Number(h.v(it, 'cantidad'));
      if (!(n > 0)) return h.msg('La cantidad tiene que ser mayor a cero.');
      const motivo = h.v(it, 'motivo');
      const semana = (await h.uno(`SELECT ISNULL(SUM(qty), 0) AS q FROM dbo.production_waste WHERE product_id = @id AND waste_date >= DATEADD(DAY, -7, CAST(GETDATE() AS DATE));`, [h.id(p.id)]))?.q || 0;
      const avisos = [];
      if (n > Number(p.stock)) avisos.push(`Solo hay ${h.cant(p.stock, p.base_uom)}: la existencia quedaría en negativo y no se va a poder.`);
      const vista = [{ etiqueta: 'Existencia', valor: `${h.num(p.stock)} → ${h.num(Number(p.stock) - n)}` }];
      if (ctx.puede('VER_COSTOS') && Number(p.cost) > 0) vista.push({ etiqueta: 'Costo de la merma', valor: h.dinero(n * Number(p.cost)) });
      vista.push({ etiqueta: 'Merma de la semana', valor: `${h.num(Number(semana) + n)} ${p.base_uom || 'pzas'}` });
      return h.msg('Esto voy a registrar:', { plan: h.plan('merma.registrar', {
        titulo: `Merma · ${h.num(n)} ${p.nombre} · ${NOMBRE_MOTIVO[motivo] || motivo}`, vista, avisos,
        ejecutar: { api: 'wybix.produccion.merma', payload: { productId: p.id, cantidad: n, motivo, uuid: crypto.randomUUID() } },
        permiso: 'PRODUCCION_OPERAR',
      }) });
    },

    async 'producto.precio'(it, ctx) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const delta = it.slots.precio?.delta;
      const nuevo = h.r2(delta != null ? Number(p.price) + delta : h.v(it, 'precio'));
      if (!(nuevo > 0)) return h.msg('El precio nuevo tiene que ser mayor a cero.');
      if (Math.abs(nuevo - Number(p.price)) < 0.005) return h.msg(`${p.nombre} ya cuesta ${h.dinero(nuevo)}.`);
      const vista = [{ etiqueta: 'Precio', valor: `${h.dinero(p.price)} → ${h.dinero(nuevo)}` }];
      const tasa = tasaDe(p);
      if (ctx.puede('VER_COSTOS') && Number(p.cost) > 0) {
        const pct = (precio) => Math.round(((precio / (1 + tasa) - p.cost) / p.cost) * 1000) / 10;
        vista.push({ etiqueta: 'Ganancia sobre el costo', valor: `${pct(Number(p.price))}% → ${pct(nuevo)}%` });
      }
      const avisos = [];
      if (Number(p.cost) > 0 && nuevo / (1 + tasa) < Number(p.cost)) avisos.push('Con este precio vendes con pérdida.');
      return h.msg('Este precio voy a cambiar:', { plan: h.plan('producto.precio', {
        titulo: `${p.nombre} a ${h.dinero(nuevo)}`, vista, avisos,
        nivel: ctx.puede('PRECIOS') ? 'confirmar' : 'autorizar',
        ejecutar: { api: 'electronAPI.actualizarProducto', payload: {
          product_id: p.id, nombre: p.nombre, precio: nuevo, stock: Number(p.stock) || 0, numero_parte: p.part_number || '',
          bar_code: p.bar_code ?? null, clave_prod_serv: p.clave_prod_serv ?? null, clave_unidad: p.clave_unidad ?? null,
          objeto_impuesto: p.objeto_impuesto ?? null, tasa_iva: p.tasa_iva ?? null } },
        permiso: 'CATALOGO_EDITAR', hallazgoId: ctx.hallazgoId ?? null,
      }) });
    },

    async 'producto.crear'(it) {
      const nombre = String(h.v(it, 'nombre')).trim();
      const precio = h.r2(h.v(it, 'precio'));
      const cat = it.slots.categoria;
      const ya = await h.uno('SELECT TOP 1 id, nombre, price FROM dbo.products WHERE active = 1 AND nombre = @n;', [['n', h.sql.NVarChar(100), nombre]]);
      if (ya) return h.msg(`Ya existe «${ya.nombre}» a ${h.dinero(ya.price)}.`, { opciones: [{ etiqueta: `Cambiar su precio a ${h.dinero(precio)}`, intent: 'producto.precio', params: { productId: ya.id, precio } }] });
      const marca = await h.uno("SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY CASE WHEN namee IN (N'Genérico', N'Generico', N'Sin marca') THEN 0 ELSE 1 END, id;");
      if (!marca) return h.msg('Antes da de alta al menos una marca en Inventario.');
      const sku = `WX-${nombre.normalize('NFD').replace(/[^\w]/g, '').toUpperCase().slice(0, 8)}-${Math.floor(Math.random() * 900 + 100)}`;
      const costo = h.v(it, 'costo') != null ? h.r2(h.v(it, 'costo')) : null;
      const existencia = h.v(it, 'existencia') != null ? Number(h.v(it, 'existencia')) : 0;
      const avisos = [];
      if (!existencia) avisos.push('Nace con existencia 0.');
      if (costo == null) avisos.push('El costo se llena con su primera compra.');
      else if (costo * 1.16 >= precio) avisos.push(`Con ese costo, a ${h.dinero(precio)} vendes con pérdida.`);
      return h.msg('Este producto voy a dar de alta:', { plan: h.plan('producto.crear', {
        titulo: `${nombre} · ${h.dinero(precio)}`,
        vista: [{ etiqueta: 'Nombre', valor: nombre }, { etiqueta: 'Precio con IVA', valor: h.dinero(precio) },
                { etiqueta: 'Categoría', valor: cat.texto },
                ...(costo != null ? [{ etiqueta: 'Costo sin IVA', valor: h.dinero(costo) }] : []),
                ...(existencia ? [{ etiqueta: 'Existencia', valor: h.num(existencia) }] : []),
                { etiqueta: 'Código', valor: sku }],
        avisos,
        ejecutar: { api: 'electronAPI.agregarProducto', args: [marca.id, cat.valor, sku, nombre, precio, existencia, '01010101', 'H87', '02', 0.16, null, costo != null ? { cost: costo } : null] },
        permiso: 'CATALOGO_EDITAR',
      }) });
    },

    async 'consulta.ganancia'(it) {
      const m = (await h.sensores.margenes.leer()).find((x) => x.id === Number(h.v(it, 'producto')));
      if (!m) return h.msg('Ese producto no se vende o no tiene precio.');
      if (m.costo == null) return h.msg(`${m.nombre} no tiene costo todavía: se llena con su primera compra${m.modo === 'RECIPE' ? ' o con el costo de sus ingredientes' : ''}.`);
      return h.msg(`Con ${m.nombre} ganas ${h.dinero(m.ganancia)} por pieza (${m.pctSobreCosto}% sobre el costo).`, {
        datos: [{ etiqueta: 'Precio final', valor: h.dinero(m.precio) }, { etiqueta: 'Sin IVA', valor: h.dinero(m.base) },
                { etiqueta: 'Costo', valor: h.dinero(m.costo) }, { etiqueta: 'Vendidos en 30 días', valor: String(m.vendidos30) }],
        tono: m.ganancia < 0 ? 'atencion' : 'normal' });
    },

    async 'inventario.traspaso'() {
      return h.ir('Los traspasos se hacen en su pantalla: eliges la sucursal y los productos, y la otra los recibe. Te llevo.', '/dashboard/traspasos');
    },
  };
};
