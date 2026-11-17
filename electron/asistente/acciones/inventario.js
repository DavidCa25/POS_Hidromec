'use strict';
/* INVENTARIO Y CATÁLOGO: existencias, merma, ajustes, precios, altas y márgenes. */
const crypto = require('crypto');
const E = require('./entidades');

module.exports = (h) => {
  /* ---------------------------------- recetas, fórmulas y presentaciones */
  /** Las líneas dichas con su unidad (o la base del ingrediente) y su nombre. */
  async function lineasDe(lineas) {
    const out = [];
    for (const l of lineas || []) {
      const p = await h.producto(l.productId);
      if (!p) return { error: h.msg(`No encontré «${l.nombre}».`) };
      out.push({ productId: p.id, nombre: p.nombre, cantidad: Number(l.cantidad), unidad: l.unidad || p.base_uom || 'pza' });
    }
    return { lineas: out };
  }
  const textoLinea = (l) => `${h.num(l.cantidad)} ${l.unidad} de ${l.nombre}`;

  /** Alta de categoría o marca: el mismo canal que el botón «+» de la ficha. */
  async function altaCatalogo(it, que) {
    const nombre = String(h.v(it, 'nombre') || '').trim();
    if (!nombre) return h.msg(`¿Cómo se va a llamar la ${que}?`);
    if (nombre.length > 100) return h.msg('Ese nombre es muy largo.');
    const tabla = que === 'categoria' ? 'dbo.CAT_categories' : 'dbo.CAT_brands';
    const ya = await h.uno(`SELECT TOP 1 namee FROM ${tabla} WHERE namee = @n;`, [['n', h.sql.NVarChar(150), nombre]]);
    if (ya) return h.msg(`Ya existe la ${que} «${ya.namee}».`);
    const etiqueta = que === 'categoria' ? 'Categoría' : 'Marca';
    return h.msg('Esto voy a crear:', { plan: h.plan(`${que}.alta`, {
      titulo: `${etiqueta} nueva · ${nombre}`, vista: [{ etiqueta, valor: nombre }],
      ejecutar: { api: que === 'categoria' ? 'electronAPI.createCategory' : 'electronAPI.createBrand', payload: { nombre } },
      permiso: 'CATALOGO_EDITAR',
    }) });
  }

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

    /* «Cambia el costo de la concha a 8», «ponle el código 750… a la coca»,
       «renombra…», «ponle IVA 16…». Los campos, en entidades.js; se guarda por
       el mismo canal que la ficha de Inventario. */
    async 'producto.editar'(it, ctx) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const campo = h.v(it, 'campo');
      const def = E.producto.campos[campo];
      if (!def) return h.msg('Ese dato del producto todavía no lo cambio yo: hazlo en Inventario.', { ruta: '/dashboard/inventario' });
      if (def.permiso && !ctx.puede(def.permiso)) return h.msg(`Tu usuario no puede cambiar ${def.dicho}. Pídeselo a un encargado.`);
      const nuevo = h.v(it, 'valor');
      const error = def.validar(nuevo);
      if (error) return h.msg(error);
      const antes = def.leer(p);
      if (def.igual ? def.igual(antes, nuevo) : String(antes ?? '') === String(nuevo ?? '')) {
        return h.msg(`${p.nombre} ya tiene ${def.dicho} ${def.mostrar(nuevo)}.`);
      }
      const vista = [{ etiqueta: def.etiqueta, valor: `${def.mostrar(antes)} → ${def.mostrar(nuevo)}` }];
      const avisos = [];
      if (campo === 'costo' && Number(nuevo) > 0) {
        const base = Number(p.price) / (1 + tasaDe(p));
        const ganancia = (c) => (c > 0 ? `${Math.round(((base - c) / c) * 1000) / 10}%` : '—');
        vista.push({ etiqueta: 'Ganancia sobre el costo', valor: `${ganancia(Number(p.cost))} → ${ganancia(Number(nuevo))}` });
        if (base < Number(nuevo)) avisos.push('Con este costo vendes con pérdida: el precio sin IVA queda abajo del costo.');
      }
      if (campo === 'codigo_barras' && nuevo) {
        const otro = await h.uno('SELECT TOP 1 nombre FROM dbo.products WHERE bar_code = @c AND id <> @id;', [['c', h.sql.NVarChar(100), String(nuevo)], h.id(p.id)]);
        if (otro) return h.msg(`Ese código de barras ya lo tiene «${otro.nombre}». Un código va en un solo producto.`);
      }
      if (campo === 'sku') {
        const otro = await h.uno('SELECT TOP 1 nombre FROM dbo.products WHERE part_number = @c AND id <> @id;', [['c', h.sql.NVarChar(100), String(nuevo)], h.id(p.id)]);
        if (otro) return h.msg(`Ese número de parte ya lo tiene «${otro.nombre}».`);
      }
      return h.msg('Esto voy a cambiar:', { plan: h.plan('producto.editar', {
        titulo: `${p.nombre} · ${def.dicho.replace(/^el /, '')}`, vista, avisos,
        ejecutar: { api: E.producto.api, payload: E.producto.payload(p, def.cambios(nuevo)) },
        permiso: 'CATALOGO_EDITAR', hallazgoId: ctx.hallazgoId ?? null,
      }) });
    },

    /* «Ponle IEPS 8% a las papas», «quítale el IEPS a las papas». Se guarda la
       lista completa del producto por producto:impuestos-guardar, igual que la
       ficha. Uno por cuota necesita cuánto trae una pieza («0.6 litros»). */
    async 'producto.impuesto'(it, ctx) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const pedido = h.v(it, 'impuesto') || {};
      const dicho = String(pedido.texto || '').toLowerCase();
      let actuales = [], catalogo = [];
      try {
        actuales = await h.q('EXEC dbo.sp_producto_impuestos_get @product_id = @id;', [h.id(p.id)]);
        catalogo = await h.q('EXEC dbo.sp_impuestos_listar @todos = 0;', []);
      } catch { return h.msg('Esta caja todavía no tiene el catálogo de impuestos (necesita la versión 1.6.0).'); }
      const elegir = (lista) => {
        let xs = lista;
        const num = dicho.match(/(\d+(?:\.\d+)?)\s*%/);
        if (num) xs = xs.filter((x) => x.tasa != null && Math.abs(Number(x.tasa) * 100 - Number(num[1])) < 0.01);
        if (/\bieps\b/.test(dicho)) xs = xs.filter((x) => x.clase === 'IEPS');
        if (/\blocal\b|\bhospedaje\b/.test(dicho)) xs = xs.filter((x) => x.clase === 'LOCAL');
        const palabras = dicho.split(/[^a-záéíóúñ]+/).filter((w) => w.length >= 4 && !['ieps', 'impuesto', 'impuestos', 'local'].includes(w));
        if (palabras.length) {
          const conPalabra = xs.filter((x) => palabras.some((w) => String(x.nombre).toLowerCase().includes(w)));
          if (conPalabra.length) xs = conPalabra;
        }
        return xs;
      };
      if (pedido.quitar) {
        if (!actuales.length) return h.msg(`${p.nombre} no lleva otros impuestos además del IVA.`);
        const xs = dicho.replace(/\b(?:el|los|la)\b/g, '').trim() === 'ieps' || dicho.trim() === 'impuestos' ? actuales.filter((x) => x.clase === 'IEPS' || dicho.trim() === 'impuestos') : elegir(actuales);
        if (!xs.length) return h.msg(`${p.nombre} no lleva ese impuesto. Lleva: ${actuales.map((x) => x.nombre).join(', ')}.`);
        const quedan = actuales.filter((x) => !xs.some((y) => y.id === x.id));
        return h.msg('Esto voy a cambiar:', { plan: h.plan('producto.impuesto', {
          titulo: `${p.nombre} · quitar ${xs.map((x) => x.nombre).join(', ')}`,
          vista: [{ etiqueta: 'Otros impuestos', valor: `${actuales.map((x) => x.nombre).join(', ')} → ${quedan.map((x) => x.nombre).join(', ') || 'ninguno'}` }],
          avisos: ['El precio no cambia: lo que se deja de cobrar de impuesto queda como ganancia.'],
          ejecutar: { api: 'electronAPI.productoImpuestosGuardar', payload: { productId: p.id, impuestos: quedan.map((x) => ({ id: x.id, cantidad: x.cantidad })) } },
          permiso: 'CATALOGO_EDITAR', hallazgoId: ctx.hallazgoId ?? null,
        }) });
      }
      const xs = elegir(catalogo.filter((x) => x.activo));
      if (!xs.length) return h.msg('No encontré ese impuesto encendido. Revísalo en Configuración → Impuestos.', { ruta: '/dashboard/configuracion' });
      if (xs.length > 1) {
        return h.msg('¿Cuál de estos?', { opciones: xs.slice(0, 6).map((x) => ({ etiqueta: x.nombre, texto: `ponle ${x.nombre} a ${p.nombre}` })) });
      }
      const imp = xs[0];
      if (actuales.some((x) => x.id === imp.id)) return h.msg(`${p.nombre} ya lleva ${imp.nombre}.`);
      let cantidad = null;
      if (imp.factor === 'Cuota') {
        const m = dicho.match(/(\d+(?:\.\d+)?)\s*(?:l|lt|lts|litros?|ml|cigarros?|piezas?|pzas?)\b/);
        if (!m) return h.msg(`${imp.nombre} es por ${imp.unidad || 'unidad'}: dime cuánto trae una pieza. Por ejemplo: «ponle ${imp.nombre} 0.6 ${imp.unidad || 'litros'} a ${p.nombre}».`);
        cantidad = /\bml\b/.test(m[0]) ? Number(m[1]) / 1000 : Number(m[1]);
      }
      const nueva = [...actuales.map((x) => ({ id: x.id, cantidad: x.cantidad })), { id: imp.id, cantidad }];
      return h.msg('Esto voy a cambiar:', { plan: h.plan('producto.impuesto', {
        titulo: `${p.nombre} · ${imp.nombre}`,
        vista: [{ etiqueta: 'Otros impuestos', valor: `${actuales.map((x) => x.nombre).join(', ') || 'ninguno'} → ${[...actuales.map((x) => x.nombre), imp.nombre].join(', ')}` },
                ...(cantidad != null ? [{ etiqueta: 'Por pieza', valor: `${h.num(cantidad)} ${imp.unidad || ''}`.trim() }] : [])],
        avisos: ['El precio no cambia: el impuesto sale de lo que ya cobras, así que tu ganancia baja.'],
        ejecutar: { api: 'electronAPI.productoImpuestosGuardar', payload: { productId: p.id, impuestos: nueva } },
        permiso: 'CATALOGO_EDITAR', hallazgoId: ctx.hallazgoId ?? null,
      }) });
    },

    /* «Da de baja la concha». Baja lógica por el canal de la ficha
       (sp-delete-product): si es ingrediente de una receta o de un
       modificador, el canal lo dice y no la hace. */
    async 'producto.baja'(it, ctx) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto (o ya está dado de baja).');
      const avisos = [];
      if (p.inventory_mode === 'DIRECT' && Number(p.stock) > 0) avisos.push(`Todavía tiene ${h.cant(p.stock, p.base_uom)} en existencia: dejará de verse en Venta e Inventario.`);
      return h.msg('Esto voy a hacer:', { plan: h.plan('producto.baja', {
        titulo: `Dar de baja ${p.nombre}`,
        vista: [{ etiqueta: 'Producto', valor: p.nombre }, { etiqueta: 'Precio', valor: h.dinero(p.price) }],
        avisos: [...avisos, 'Las ventas pasadas no cambian.'],
        ejecutar: { api: 'electronAPI.darDeBajaProducto', args: [p.id] },
        permiso: 'INVENTARIO_OPERAR', hallazgoId: ctx.hallazgoId ?? null,
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
    /* «Crea la categoría Lácteos» / «agrega la marca Lala». */
    async 'categoria.alta'(it) { return altaCatalogo(it, 'categoria'); },
    async 'marca.alta'(it) { return altaCatalogo(it, 'marca'); },

    /**
     * «Bimbo me surte las conchas» (agregar), «el proveedor principal de la
     * concha es Bimbo» (principal), «Bimbo ya no me surte las conchas»
     * (quitar). Los mismos canales que la pestaña Proveedores de la ficha.
     */
    async 'producto.proveedor'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      const prov = await h.proveedor(h.v(it, 'proveedor'));
      if (!p || !prov) return h.msg('No encontré ese producto o ese proveedor.');
      const accion = h.v(it, 'accion') || 'agregar';
      const liga = await h.uno('SELECT is_default, active, last_cost FROM dbo.product_suppliers WHERE product_id = @p AND supplier_id = @s;',
        [['p', h.sql.Int, p.id], ['s', h.sql.Int, prov.id]]);
      const actual = await h.uno(`SELECT TOP 1 s.nombre FROM dbo.product_suppliers ps JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id
                                     WHERE ps.product_id = @p AND ps.is_default = 1 AND ps.active = 1;`, [['p', h.sql.Int, p.id]]);
      if (accion === 'quitar') {
        if (!liga || !liga.active) return h.msg(`${prov.nombre} no está como proveedor de ${p.nombre}.`);
        return h.msg('Esto voy a cambiar:', { plan: h.plan('producto.proveedor', {
          titulo: `${prov.nombre} deja de surtir ${p.nombre}`,
          vista: [{ etiqueta: 'Producto', valor: p.nombre }, { etiqueta: 'Proveedor', valor: `${prov.nombre} → ya no lo surte` }],
          avisos: liga.is_default ? ['Era su proveedor principal: el producto queda sin principal.'] : [],
          ejecutar: { api: 'electronAPI.removeProductSupplier', args: [p.id, prov.id] }, permiso: 'INVENTARIO_OPERAR',
        }) });
      }
      if (accion === 'principal') {
        if (liga?.active && liga.is_default) return h.msg(`${prov.nombre} ya es el proveedor principal de ${p.nombre}.`);
        /* Sin liga todavía: se crea ya como principal (un solo paso). */
        const ejecutar = liga?.active ? { api: 'electronAPI.setProductDefaultSupplier', args: [p.id, prov.id] }
          : { api: 'electronAPI.upsertProductSupplier', payload: { product_id: p.id, supplier_id: prov.id, is_default: 1, active: 1, last_cost: null } };
        return h.msg('Esto voy a cambiar:', { plan: h.plan('producto.proveedor', {
          titulo: `Proveedor principal de ${p.nombre}`,
          vista: [{ etiqueta: 'Proveedor principal', valor: `${actual?.nombre || 'ninguno'} → ${prov.nombre}` }],
          ejecutar, permiso: 'INVENTARIO_OPERAR',
        }) });
      }
      if (liga?.active) return h.msg(`${prov.nombre} ya está como proveedor de ${p.nombre}.`);
      return h.msg('Esto voy a cambiar:', { plan: h.plan('producto.proveedor', {
        titulo: `${prov.nombre} surte ${p.nombre}`,
        vista: [{ etiqueta: 'Producto', valor: p.nombre }, { etiqueta: 'Proveedor', valor: prov.nombre },
                { etiqueta: 'Principal', valor: actual ? `no (sigue ${actual.nombre})` : 'sí (no tenía)' }],
        ejecutar: { api: 'electronAPI.upsertProductSupplier', payload: { product_id: p.id, supplier_id: prov.id, is_default: actual ? 0 : 1, active: 1, last_cost: null } },
        permiso: 'INVENTARIO_OPERAR',
      }) });
    },

    /* «La hamburguesa lleva 150 g de carne, 1 pan…»: se suma a lo que ya
       lleva (mismo ingrediente: cantidad nueva). «Quítale el queso…». */
    async 'receta.guardar'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const r = await h.uno('SELECT TOP 1 id, notes FROM dbo.recipes WHERE product_id = @p AND variant_option_id IS NULL;', [['p', h.sql.Int, p.id]]);
      const actuales = r ? (await h.q(`SELECT l.ingredient_product_id AS productId, i.nombre, l.input_qty AS cantidad, l.input_uom AS unidad, l.waste_pct
                                         FROM dbo.recipe_lines l JOIN dbo.products i ON i.id = l.ingredient_product_id WHERE l.recipe_id = @r ORDER BY l.sort_order;`, [['r', h.sql.Int, r.id]]))
        .map((x) => ({ ...x, cantidad: Number(x.cantidad) })) : [];
      let nuevas = actuales.map((x) => ({ ...x }));
      const quitar = h.v(it, 'quitarIngrediente');
      if (quitar) {
        if (!nuevas.some((x) => x.productId === quitar)) return h.msg(`La receta de ${p.nombre} no lleva ese ingrediente.`);
        nuevas = nuevas.filter((x) => x.productId !== quitar);
        if (!nuevas.length) return h.msg(`Sería quitarle todo: mejor dime «borra la receta de ${p.nombre.toLowerCase()}».`);
      } else {
        const d = await lineasDe(h.v(it, 'lineas'));
        if (d.error) return d.error;
        for (const l of d.lineas) {
          if (l.productId === p.id) return h.msg('Un producto no puede ser ingrediente de sí mismo.');
          const i = nuevas.findIndex((x) => x.productId === l.productId);
          if (i >= 0) nuevas[i] = { ...nuevas[i], cantidad: l.cantidad, unidad: l.unidad }; else nuevas.push({ ...l, waste_pct: 0 });
        }
      }
      const avisos = [];
      if (p.inventory_mode !== 'RECIPE') avisos.push(`${p.nombre} se maneja con inventario directo: para tener receta, en su ficha cambia «Inventario» a «Por receta».`);
      return h.msg('Así queda la receta:', { plan: h.plan('receta.guardar', {
        titulo: `Receta de ${p.nombre}`,
        vista: nuevas.map((l) => { const a = actuales.find((x) => x.productId === l.productId); return { etiqueta: l.nombre, valor: a ? (a.cantidad === l.cantidad && a.unidad === l.unidad ? textoLinea(l).replace(/ de .*/, '') : `${h.num(a.cantidad)} ${a.unidad} → ${h.num(l.cantidad)} ${l.unidad}`) : `nuevo · ${h.num(l.cantidad)} ${l.unidad}` }; })
          .concat(actuales.filter((a) => !nuevas.some((n) => n.productId === a.productId)).map((a) => ({ etiqueta: a.nombre, valor: 'se quita' }))),
        avisos: [...avisos, 'Cada venta descuenta estos ingredientes del inventario.'],
        ejecutar: { api: 'wybix.recipes.save', payload: { productId: p.id, variantOptionId: null, notes: r?.notes ?? null,
          lines: nuevas.map((l, i) => ({ ingredientProductId: l.productId, inputQty: l.cantidad, inputUom: l.unidad, wastePct: Number(l.waste_pct) || 0, sortOrder: i + 1 })) } },
        permiso: 'CATALOGO_EDITAR',
      }) });
    },

    async 'receta.borrar'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      const r = p && await h.uno('SELECT TOP 1 id FROM dbo.recipes WHERE product_id = @p AND variant_option_id IS NULL;', [['p', h.sql.Int, p.id]]);
      if (!r) return h.msg(`${p?.nombre || 'Ese producto'} no tiene receta.`);
      return h.msg('Esta receta voy a borrar:', { plan: h.plan('receta.borrar', {
        titulo: `Borrar la receta de ${p.nombre}`, vista: [{ etiqueta: 'Producto', valor: p.nombre }],
        avisos: ['Sus ventas dejan de descontar ingredientes.'],
        ejecutar: { api: 'wybix.recipes.remove', payload: { recipeId: Number(r.id) } }, permiso: 'CATALOGO_EDITAR',
      }) });
    },

    /* «La fórmula de las conchas: 1 kilo de harina y 200 gramos de azúcar, rinde 20». */
    async 'formula.guardar'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const d = await lineasDe(h.v(it, 'lineas'));
      if (d.error) return d.error;
      const f = await h.uno('SELECT yield_qty, notes FROM dbo.production_formulas WHERE product_id = @p;', [['p', h.sql.Int, p.id]]).catch(() => null);
      const rinde = Number(h.v(it, 'rinde')) || Number(f?.yield_qty) || null;
      if (!rinde) return h.msg(`¿Cuántas ${p.nombre.toLowerCase()} salen con eso? Dímelo con «rinde 20».`);
      return h.msg('Así queda la fórmula:', { plan: h.plan('formula.guardar', {
        titulo: `Fórmula de ${p.nombre}`,
        vista: [...d.lineas.map((l) => ({ etiqueta: l.nombre, valor: `${h.num(l.cantidad)} ${l.unidad}` })), { etiqueta: 'Rinde', valor: `${h.num(rinde)} piezas` }],
        avisos: f ? ['Reemplaza la fórmula que tenía.'] : ['Con la fórmula, «empieza la tanda» descuenta estos ingredientes.'],
        ejecutar: { api: 'wybix.produccion.guardarFormula', payload: { productId: p.id, rinde, notas: f?.notes ?? null,
          lineas: d.lineas.map((l) => ({ ingredientProductId: l.productId, inputQty: l.cantidad, inputUom: l.unidad, wastePct: 0 })) } },
        permiso: 'PRODUCCION_OPERAR',
      }) });
    },

    async 'formula.quitar'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      const f = p && await h.uno('SELECT product_id FROM dbo.production_formulas WHERE product_id = @p;', [['p', h.sql.Int, p.id]]).catch(() => null);
      if (!f) return h.msg(`${p?.nombre || 'Ese producto'} no tiene fórmula de producción.`);
      return h.msg('Esta fórmula voy a borrar:', { plan: h.plan('formula.quitar', {
        titulo: `Borrar la fórmula de ${p.nombre}`, vista: [{ etiqueta: 'Producto', valor: p.nombre }],
        ejecutar: { api: 'wybix.produccion.quitarFormula', payload: { productId: p.id } }, permiso: 'PRODUCCION_OPERAR',
      }) });
    },

    /* «La coca también se vende en caja de 24»: presentación de compra. */
    async 'presentacion.guardar'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const nombre = h.v(it, 'nombre'), factor = Number(h.v(it, 'factor'));
      const ya = await h.uno('SELECT TOP 1 name FROM dbo.product_presentations WHERE product_id = @p AND active = 1 AND (name = @n OR factor_to_base = @f);',
        [['p', h.sql.Int, p.id], ['n', h.sql.NVarChar(60), nombre], ['f', h.sql.Decimal(14, 4), factor]]).catch(() => null);
      if (ya) return h.msg(`${p.nombre} ya tiene «${ya.name}».`);
      return h.msg('Esta presentación voy a agregar:', { plan: h.plan('presentacion.guardar', {
        titulo: `${p.nombre} · ${nombre}`, vista: [{ etiqueta: 'Presentación', valor: nombre }, { etiqueta: 'Trae', valor: `${h.num(factor)} ${p.base_uom || 'pza'}` }],
        avisos: ['Al registrar una compra en esa presentación, la existencia sube en piezas.'],
        ejecutar: { api: 'wybix.presentations.save', payload: { id: null, productId: p.id, name: nombre, factorToBase: factor, isDefault: false, active: true } },
        permiso: 'CATALOGO_EDITAR',
      }) });
    },

    async 'presentacion.borrar'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const dicho = h.llano(h.v(it, 'presentacion'));
      const ps = await h.q('SELECT id, name, factor_to_base FROM dbo.product_presentations WHERE product_id = @p AND active = 1;', [['p', h.sql.Int, p.id]]).catch(() => []);
      const x = ps.find((y) => h.llano(y.name) === dicho) || ps.find((y) => h.llano(y.name).includes(dicho) || dicho.includes(h.llano(y.name)));
      if (!x) return h.msg(ps.length ? `${p.nombre} tiene: ${ps.map((y) => y.name).join(', ')}.` : `${p.nombre} no tiene presentaciones.`);
      return h.msg('Esta presentación voy a borrar:', { plan: h.plan('presentacion.borrar', {
        titulo: `${p.nombre} · sin «${x.name}»`, vista: [{ etiqueta: 'Presentación', valor: `${x.name} (${h.num(x.factor_to_base)})` }],
        ejecutar: { api: 'wybix.presentations.remove', payload: { id: Number(x.id) } }, permiso: 'CATALOGO_EDITAR',
      }) });
    },

    /* «Crea el grupo Tamaño con chico, mediano +5 y grande +10». */
    async 'opciones.crear'(it) {
      const nombre = String(h.v(it, 'nombre') || '').trim().slice(0, 80);
      const ya = await h.uno('SELECT TOP 1 name FROM dbo.modifier_groups WHERE name = @n AND active = 1;', [['n', h.sql.NVarChar(80), nombre]]).catch(() => null);
      if (ya) return h.msg(`Ya existe el grupo «${ya.name}».`);
      const opciones = h.v(it, 'opciones') || [];
      const rol = h.v(it, 'rol') || 'ADDON';
      const unoSolo = rol === 'SIZE';
      return h.msg('Este grupo voy a crear:', { plan: h.plan('opciones.crear', {
        titulo: `Grupo de opciones · ${nombre}`,
        vista: [...opciones.map((o) => ({ etiqueta: o.nombre, valor: o.precio ? `+${h.dinero(o.precio)}` : 'sin costo extra' })),
                { etiqueta: 'Se elige', valor: unoSolo ? 'una, obligatoria' : 'varias, opcionales' }],
        avisos: ['Para usarlo dime qué productos lo llevan: «el latte lleva el grupo ' + nombre + '».'],
        ejecutar: { api: 'wybix.modifiers.save', payload: { groupId: null, name: nombre, role: rol, minSelect: unoSolo ? 1 : 0, maxSelect: unoSolo ? 1 : opciones.length,
          required: unoSolo, active: true, sortOrder: 0, options: opciones.map((o, i) => ({ id: null, name: o.nombre.charAt(0).toUpperCase() + o.nombre.slice(1), priceDelta: o.precio || 0, effect: 'NONE', active: true, sortOrder: i + 1 })) } },
        permiso: 'CATALOGO_EDITAR',
      }) });
    },

    async 'opciones.producto'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const dicho = h.llano(h.v(it, 'grupo'));
      const grupos = await h.q('SELECT id, name FROM dbo.modifier_groups WHERE active = 1;').catch(() => []);
      const g = grupos.find((x) => h.llano(x.name) === dicho) || grupos.find((x) => h.llano(x.name).includes(dicho));
      if (!g) return h.msg(grupos.length ? `No encuentro el grupo «${h.v(it, 'grupo')}». Hay: ${grupos.map((x) => x.name).join(', ')}.` : 'No hay grupos de opciones todavía.');
      const actuales = (await h.q('SELECT group_id FROM dbo.product_modifier_groups WHERE product_id = @p;', [['p', h.sql.Int, p.id]])).map((x) => Number(x.group_id));
      const quitar = !!h.v(it, 'quitar');
      if (quitar ? !actuales.includes(g.id) : actuales.includes(g.id)) return h.msg(`${p.nombre} ${quitar ? 'no lleva' : 'ya lleva'} «${g.name}».`);
      const nuevos = quitar ? actuales.filter((x) => x !== g.id) : [...actuales, g.id];
      return h.msg('Esto voy a cambiar:', { plan: h.plan('opciones.producto', {
        titulo: `${p.nombre} · ${quitar ? 'sin' : 'con'} «${g.name}»`, vista: [{ etiqueta: g.name, valor: quitar ? 'lo lleva → ya no' : 'no → lo lleva' }],
        avisos: quitar ? [] : ['Al venderlo se piden esas opciones.'],
        ejecutar: { api: 'wybix.modifiers.setProductGroups', payload: { productId: p.id, groupIds: nuevos } }, permiso: 'CATALOGO_EDITAR',
      }) });
    },

    async 'opciones.borrar'(it) {
      const dicho = h.llano(h.v(it, 'grupo'));
      const grupos = await h.q('SELECT id, name, (SELECT COUNT(*) FROM dbo.product_modifier_groups x WHERE x.group_id = g.id) AS productos FROM dbo.modifier_groups g WHERE active = 1;').catch(() => []);
      const g = grupos.find((x) => h.llano(x.name) === dicho) || grupos.find((x) => h.llano(x.name).includes(dicho));
      if (!g) return h.msg(`No encuentro el grupo «${h.v(it, 'grupo')}».`);
      return h.msg('Este grupo voy a borrar:', { plan: h.plan('opciones.borrar', {
        titulo: `Borrar el grupo «${g.name}»`, vista: [{ etiqueta: 'Lo usan', valor: `${g.productos} producto(s)` }],
        avisos: Number(g.productos) ? ['Esos productos dejan de pedir estas opciones; lo ya vendido se queda.'] : [],
        ejecutar: { api: 'wybix.modifiers.remove', payload: { groupId: Number(g.id) } }, permiso: 'CATALOGO_EDITAR',
      }) });
    },

    /* «Las conchas son de Juan» / «… de Juan y Ana» (a partes iguales). */
    async 'producto.dueno'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const ids = h.v(it, 'socios') || [];
      const socios = await h.q(`SELECT id, nombre FROM dbo.socios WHERE id IN (${ids.map((x) => Number(x) || 0).join(',') || 0}) AND activo = 1;`);
      if (socios.length !== ids.length) return h.msg('Alguno de esos socios no está activo.');
      const pct = Math.round((100 / socios.length) * 100) / 100;
      const duenos = socios.map((s, i) => ({ socioId: s.id, pct: i === socios.length - 1 ? Math.round((100 - pct * (socios.length - 1)) * 100) / 100 : pct }));
      return h.msg('Esto voy a cambiar:', { plan: h.plan('producto.dueno', {
        titulo: `${p.nombre} · de ${socios.map((s) => s.nombre).join(' y ')}`,
        vista: duenos.map((d) => ({ etiqueta: socios.find((s) => s.id === d.socioId).nombre, valor: `${d.pct}%` })),
        avisos: ['Desde ahora, la ganancia de sus ventas se reparte así.'],
        ejecutar: { api: 'electronAPI.sociosProductoDueno', payload: { productId: p.id, duenos } }, permiso: 'CATALOGO_EDITAR',
      }) });
    },

    /* «Aplica el conteo de la coca» (lo reportó un dispositivo) / «descarta…». */
    async 'inventario.reporte'(it) {
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto.');
      const r = await h.uno(`SELECT TOP 1 id, tipo, cantidad, stock_al_reportar, nota FROM dbo.inventario_reportes WHERE product_id = @p AND estado = 'PENDIENTE' ORDER BY id DESC;`,
        [['p', h.sql.Int, p.id]]).catch(() => null);
      if (!r) return h.msg(`No hay reportes pendientes de ${p.nombre}.`);
      const accion = h.v(it, 'accion');
      if (accion === 'APLICAR' && r.tipo !== 'CONTEO') return h.msg('Ese reporte es un faltante: se atiende y se descarta, no se aplica.');
      return h.msg('Esto voy a hacer:', { plan: h.plan('inventario.reporte', {
        titulo: `${accion === 'APLICAR' ? 'Aplicar' : 'Descartar'} el reporte de ${p.nombre}`,
        vista: [{ etiqueta: r.tipo === 'CONTEO' ? 'Contaron' : 'Reportan', valor: h.num(r.cantidad) }, { etiqueta: 'En sistema', valor: `${h.num(p.stock)}${accion === 'APLICAR' ? ` → ${h.num(r.cantidad)}` : ''}` },
                ...(r.nota ? [{ etiqueta: 'Nota', valor: r.nota }] : [])],
        ejecutar: { api: 'wybix.inventarioReportes.resolver', payload: { id: Number(r.id), accion } }, permiso: 'INVENTARIO_OPERAR',
      }) });
    },

    async 'inventario.revisado'() {
      return h.msg('Esto voy a marcar:', { plan: h.plan('inventario.revisado', {
        titulo: 'Inventario revisado', vista: [{ etiqueta: 'Aviso de revisar inventario', valor: 'se quita' }],
        ejecutar: { api: 'electronAPI.licenseInventoryReviewDismiss', args: [] }, permiso: 'INVENTARIO_OPERAR',
      }) });
    },
  };
};
