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

  async 'compra.registrar'(it) {
    const prov = h.v(it, 'proveedor') ? await h.proveedor(h.v(it, 'proveedor')) : null;
    return h.ir(`Te llevo a Registrar compra${prov ? ` (proveedor ${prov.nombre})` : ''}: agregas los productos con su costo y la existencia sube sola.`, '/dashboard/registrarCompra');
  },
});
