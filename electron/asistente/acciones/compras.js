'use strict';
/* COMPRAS: qué comprar, el pedido de cada proveedor, la última compra y el total. */

module.exports = (h) => ({
  async 'consulta.comprar'() {
    const lista = (await h.sensores.reorden.leer()).filter((x) => x.modo === 'DIRECT' || x.limita);
    if (!lista.length) return h.msg('No se te está acabando nada en los próximos 7 días.', { tono: 'exito' });
    return h.msg(`Esto se acaba en los próximos 7 días (${lista.length}):`, {
      datos: lista.slice(0, 12).map((x) => x.limita
        ? { etiqueta: x.limita.nombre, valor: `limita ${x.nombre} · ${h.plural(x.dias, 'día')}` }
        : { etiqueta: x.nombre, valor: `${x.dias <= 0 ? 'agotado' : h.plural(x.dias, 'día')}${x.sugerido ? ` · comprar ${h.cant(x.sugerido, x.uom)}` : ''}` }),
      opciones: [{ etiqueta: 'Registrar compra', intent: 'ir_a', params: { ruta: '/dashboard/registrarCompra', etiqueta: 'Registrar compra' } }] });
  },

  async 'compra.pedido'(it) {
    const prov = await h.proveedor(h.v(it, 'proveedor'));
    if (!prov) return h.msg('No encontré ese proveedor.');
    const suyos = new Set((await h.q('SELECT product_id FROM dbo.product_suppliers WHERE supplier_id = @id AND ISNULL(active, 1) = 1;', [h.id(prov.id)])).map((x) => x.product_id));
    const lista = (await h.sensores.reorden.leer()).filter((x) => suyos.has(x.id) && (x.sugerido > 0 || x.dias <= 7));
    if (!suyos.size) return h.msg(`${prov.nombre} no tiene productos ligados. Lígalos en Inventario (proveedor del producto) y te armo su pedido.`);
    if (!lista.length) return h.msg(`De lo que te surte ${prov.nombre} no se te acaba nada en los próximos 7 días.`, { tono: 'exito' });
    return h.msg(`Pedido sugerido para ${prov.nombre} (${h.plural(lista.length, 'producto')}):`, {
      datos: lista.map((x) => ({ etiqueta: x.nombre, valor: `${x.sugerido ? `pedir ${h.cant(x.sugerido, x.uom)}` : 'revisar'} · alcanza ${h.plural(Math.max(0, x.dias), 'día')}` })),
      opciones: [{ etiqueta: 'Registrar la compra', intent: 'ir_a', params: { ruta: '/dashboard/registrarCompra', etiqueta: 'Registrar compra' } },
                 ...(prov.telefono ? [{ etiqueta: `Teléfono: ${prov.telefono}`, intent: 'proveedor.contacto', params: { proveedorId: prov.id } }] : [])] });
  },

  async 'compra.ultima'(it) {
    const p = await h.producto(h.v(it, 'producto'));
    if (!p) return h.msg('No encontré ese producto.');
    const c = await h.q(`
      SELECT TOP 3 c.datee, d.quantity, d.unitary_price, ISNULL(d.factor_to_base, 1) AS factor, s.nombre AS proveedor
        FROM dbo.purchase_detail d JOIN dbo.purchase c ON c.id = d.puchase_id
        LEFT JOIN dbo.CAT_suppliers s ON s.id = ISNULL(d.supplier_id, c.supplier_id)
       WHERE d.product_id = @id ORDER BY c.datee DESC, d.id DESC;`, [h.id(p.id)]);
    if (!c.length) return h.msg(`No hay compras registradas de ${p.nombre}.`);
    const u = c[0];
    return h.msg(`La última compra de ${p.nombre} fue el ${h.diaTexto(u.datee)}${u.proveedor ? ` a ${u.proveedor}` : ''}: ${h.num(u.quantity)} a ${h.dinero(u.unitary_price)} c/u.`, {
      datos: c.slice(1).map((x) => ({ etiqueta: h.diaTexto(x.datee), valor: `${h.num(x.quantity)} a ${h.dinero(x.unitary_price)}${x.proveedor ? ` · ${x.proveedor}` : ''}` })) });
  },

  async 'compra.resumen'(it) {
    const r = h.rango(h.v(it, 'periodo') === 'hoy' ? 'mes' : h.v(it, 'periodo'));
    const filas = await h.q(`
      SELECT ISNULL(s.nombre, 'Sin proveedor') AS proveedor, COUNT(*) AS compras, SUM(c.total) AS total
        FROM dbo.purchase c LEFT JOIN dbo.CAT_suppliers s ON s.id = c.supplier_id
       WHERE c.datee >= ${r.desde} AND c.datee < ${r.hasta}
       GROUP BY s.nombre ORDER BY SUM(c.total) DESC;`);
    if (!filas.length) return h.msg(`No hay compras ${r.de}.`);
    const total = filas.reduce((a, f) => a + Number(f.total), 0);
    return h.msg(`${r.nombre} compraste ${h.dinero(total)} en ${h.plural(filas.reduce((a, f) => a + f.compras, 0), 'compra')}.`, {
      datos: filas.slice(0, 8).map((f) => ({ etiqueta: f.proveedor, valor: h.dinero(f.total) })) });
  },

  /**
   * «Compré 24 cocas a 12 a Coca-Cola en efectivo». Costo SIN IVA por pieza,
   * como en Registrar compra. sp_register_purchase recalcula el precio de
   * venta con el margen de cada renglón: aquí se manda el margen que DEJA el
   * precio de ahora; si el costo nuevo lo pasa, el precio sube a costo + IVA
   * y la tarjeta lo dice.
   */
  async 'compra.registrar'(it) {
    const prov = h.v(it, 'proveedor') ? await h.proveedor(h.v(it, 'proveedor')) : null;
    const rs = h.v(it, 'renglones') || [];
    if (!rs.length) {
      return h.ir(`Te llevo a Registrar compra${prov ? ` (proveedor ${prov.nombre})` : ''}: agregas los productos con su costo y la existencia sube sola. También me lo puedes dictar: «compré 24 cocas a 12 a Coca-Cola».`, '/dashboard/registrarCompra');
    }
    if (!prov) return h.msg('¿A qué proveedor se lo compraste?', { esperando: { intent: it.intent, slots: it.slots, falta: 'proveedor' } });
    const costos = h.v(it, 'costos') || [];
    const lineas = [];
    for (let i = 0; i < rs.length; i++) {
      const p = await h.producto(rs[i].productId);
      if (!p) continue;
      const costo = costos.length ? Number(costos[i]) : Number(p.cost) || 0;
      if (!(costo > 0)) return h.msg(`¿A cuánto te dejaron ${p.nombre}? Dímelo así: «${h.num(rs[i].cantidad)} ${p.nombre.toLowerCase()} a 12».`);
      const objeto = String(p.objeto_impuesto || '02') === '02';
      const tasa = objeto ? (p.tasa_iva == null ? 0.16 : Number(p.tasa_iva)) : 0;
      const conIva = costo * (1 + tasa);
      /* El margen que deja el precio de ahora (sp_register_purchase lo usa). */
      const margen = p.sellable === false || p.sellable === 0 ? 0 : Math.max(0, Math.min(999.99, Math.round((Number(p.price) / conIva - 1) * 10000) / 100));
      const nuevoPrecio = Math.round(conIva * (1 + margen / 100) * 100) / 100;
      lineas.push({ p, cantidad: Number(rs[i].cantidad), costo, tasa, margen, nuevoPrecio, dicho: costos.length > 0 });
    }
    if (!lineas.length) return h.msg('No encontré esos productos.');
    const subtotal = h.r2(lineas.reduce((a, l) => a + l.costo * l.cantidad, 0));
    const iva = h.r2(lineas.reduce((a, l) => a + l.costo * l.cantidad * l.tasa, 0));
    const total = h.r2(subtotal + iva);
    const metodo = h.v(it, 'metodo') || 'CREDITO';
    const nombreMetodo = { CREDITO: 'A crédito (cuenta por pagar)', EFECTIVO: 'Efectivo de la caja', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta' }[metodo] || metodo;
    const vista = lineas.map((l) => ({ etiqueta: `${h.num(l.cantidad)} × ${l.p.nombre}`, valor: `${h.dinero(l.costo)} c/u${l.dicho ? '' : ' (costo anterior)'} · ${h.dinero(l.costo * l.cantidad)}` }));
    vista.push({ etiqueta: 'Subtotal', valor: h.dinero(subtotal) }, { etiqueta: 'IVA', valor: h.dinero(iva) }, { etiqueta: 'Total', valor: h.dinero(total) },
               { etiqueta: 'Proveedor', valor: prov.nombre }, { etiqueta: 'Pago', valor: nombreMetodo });
    const avisos = ['La existencia sube y el costo de cada producto queda en el de esta compra.'];
    for (const l of lineas) {
      if (Math.abs(l.nuevoPrecio - Number(l.p.price)) > 0.01) avisos.push(`${l.p.nombre}: el precio de venta pasa de ${h.dinero(l.p.price)} a ${h.dinero(l.nuevoPrecio)} (el costo nuevo con IVA ya no cabe en el precio).`);
    }
    if (metodo === 'EFECTIVO') avisos.push('Sale del cajón: necesita la caja abierta y entra al corte.');
    const hoy = await h.uno(`SELECT TOP 1 id, total FROM dbo.purchase WHERE supplier_id = @p AND CAST(datee AS DATE) = CAST(GETDATE() AS DATE) ORDER BY id DESC;`,
      [['p', h.sql.Int, prov.id]]).catch(() => null);
    if (hoy) avisos.unshift(`Hoy ya hay una compra de ${prov.nombre} por ${h.dinero(hoy.total)} (folio ${hoy.id}). Confirma solo si es otra.`);
    return h.msg('Esta compra voy a registrar:', { plan: h.plan('compra.registrar', {
      titulo: `Compra a ${prov.nombre} · ${h.dinero(total)}`, vista, avisos,
      ejecutar: { api: 'electronAPI.registerPurchase', payload: {
        supplier_id: prov.id, tax_rate: subtotal > 0 ? Math.round((iva / subtotal) * 10000) / 10000 : 0.16, tax_amount: iva, subtotal, total,
        payment_method: metodo, register_id: h.cajaEquipo(), apply_payment_id: null, socio_pago_id: null,
        detalles: lineas.map((l) => ({ product_id: l.p.id, quantity: l.cantidad, unit_price: l.costo, profit_percent: l.margen, presentation_id: null })) } },
      permiso: 'INVENTARIO_OPERAR',
    }) });
  },
});
