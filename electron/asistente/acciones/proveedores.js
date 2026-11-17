'use strict';
/* PROVEEDORES: deudas, pagos, altas, quién surte qué y cómo contactarlos. */

module.exports = (h) => ({
  async 'proveedor.deuda'(it) {
    const pid = h.v(it, 'proveedor');
    if (pid) {
      const prov = await h.proveedor(pid);
      const x = await h.uno(`
        SELECT ISNULL(SUM(balance), 0) AS saldo, COUNT(*) AS compras, MIN(datee) AS mas_vieja
          FROM dbo.purchase WHERE supplier_id = @id AND balance > 0.005;`, [h.id(pid)]);
      if (!Number(x.saldo)) return h.msg(`No le debes nada a ${prov?.nombre || 'ese proveedor'}.`, { tono: 'exito' });
      return h.msg(`Le debes ${h.dinero(x.saldo)} a ${prov.nombre} (${h.plural(x.compras, 'compra')} sin liquidar, la más vieja del ${h.diaTexto(x.mas_vieja)}).`, {
        opciones: [{ etiqueta: `Pagarle a ${prov.nombre}`, intent: 'proveedor.pago', params: { proveedorId: prov.id } }] });
    }
    const filas = await h.q(`
      SELECT s.id, s.nombre, SUM(c.balance) AS saldo, MIN(c.datee) AS mas_vieja
        FROM dbo.purchase c JOIN dbo.CAT_suppliers s ON s.id = c.supplier_id
       WHERE c.balance > 0.005 GROUP BY s.id, s.nombre ORDER BY SUM(c.balance) DESC;`);
    if (!filas.length) return h.msg('No le debes nada a ningún proveedor.', { tono: 'exito' });
    const total = filas.reduce((a, f) => a + Number(f.saldo), 0);
    return h.msg(`Le debes ${h.dinero(total)} a ${h.plural(filas.length, 'proveedor', 'proveedores')}:`, {
      datos: filas.slice(0, 10).map((f) => ({ etiqueta: f.nombre, valor: `${h.dinero(f.saldo)} · desde ${h.fechaCorta(new Date(f.mas_vieja).toISOString())}` })) });
  },

  async 'proveedor.pago'(it, ctx) {
    const prov = await h.proveedor(h.v(it, 'proveedor'));
    if (!prov) return h.msg('No encontré ese proveedor.');
    const monto = h.r2(h.v(it, 'monto'));
    if (!(monto > 0)) return h.msg('El monto tiene que ser mayor a cero.');
    const metodo = h.v(it, 'metodo');
    const x = await h.uno('SELECT ISNULL(SUM(balance), 0) AS saldo FROM dbo.purchase WHERE supplier_id = @id AND balance > 0.005;', [h.id(prov.id)]);
    const saldo = Number(x?.saldo || 0);
    const avisos = [];
    if (saldo <= 0) avisos.push(`No tienes compras pendientes con ${prov.nombre}: quedará como saldo a favor.`);
    else if (monto > saldo) avisos.push(`Le debes ${h.dinero(saldo)}: estás pagando ${h.dinero(monto - saldo)} de más.`);
    if (metodo === 'EFECTIVO') avisos.push('Sale del cajón: se abre y el corte lo descuenta.');
    return h.msg('Este pago voy a registrar:', { plan: h.plan('proveedor.pago', {
      titulo: `Pago a ${prov.nombre} · ${h.dinero(monto)}`,
      vista: [{ etiqueta: 'Monto', valor: h.dinero(monto) }, { etiqueta: 'Forma de pago', valor: metodo.toLowerCase() },
              { etiqueta: 'Saldo con el proveedor', valor: `${h.dinero(saldo)} → ${h.dinero(Math.max(0, saldo - monto))}` }],
      avisos, nivel: ctx.puede('RETIROS_EGRESOS') ? 'confirmar' : 'autorizar',
      ejecutar: { api: 'electronAPI.registerSupplierPayment', payload: { supplier_id: prov.id, purchase_id: null, amount: monto, payment_method: metodo, note: 'Registrado desde Wybix' } },
      permiso: 'RETIROS_EGRESOS',
    }) });
  },

  async 'proveedor.alta'(it) {
    const nombre = String(h.v(it, 'nombre')).trim();
    const tel = h.v(it, 'telefono');
    const ya = await h.uno('SELECT TOP 1 id, nombre FROM dbo.CAT_suppliers WHERE nombre = @n;', [['n', h.sql.NVarChar(100), nombre]]);
    if (ya) return h.msg(`Ya tienes a «${ya.nombre}» como proveedor.`, { opciones: [{ etiqueta: 'Ver sus datos', intent: 'proveedor.contacto', params: { proveedorId: ya.id } }] });
    return h.msg('Este proveedor voy a dar de alta:', { plan: h.plan('proveedor.alta', {
      titulo: `Proveedor · ${nombre}`,
      vista: [{ etiqueta: 'Nombre', valor: nombre }, { etiqueta: 'Teléfono', valor: tel || '—' }],
      ejecutar: { api: 'electronAPI.supplierSave', payload: { nombre, telefono: tel || null } },
      permiso: 'INVENTARIO_OPERAR',
    }) });
  },

  async 'proveedor.quien'(it) {
    const p = await h.producto(h.v(it, 'producto'));
    if (!p) return h.msg('No encontré ese producto.');
    const filas = await h.q(`
      SELECT s.id, s.nombre, s.telefono, ps.is_default, ps.last_cost
        FROM dbo.product_suppliers ps JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id
       WHERE ps.product_id = @id AND ISNULL(ps.active, 1) = 1 ORDER BY ps.is_default DESC, ps.last_cost;`, [h.id(p.id)]);
    if (!filas.length) {
      const ult = await h.uno(`
        SELECT TOP 1 s.nombre FROM dbo.purchase_detail d JOIN dbo.purchase c ON c.id = d.puchase_id JOIN dbo.CAT_suppliers s ON s.id = ISNULL(d.supplier_id, c.supplier_id)
         WHERE d.product_id = @id ORDER BY c.datee DESC;`, [h.id(p.id)]);
      return h.msg(ult ? `La última vez le compraste ${p.nombre} a ${ult.nombre}.` : `${p.nombre} no tiene proveedor registrado.`);
    }
    return h.msg(`${p.nombre} te lo surte${filas.length > 1 ? 'n' : ''} ${filas.map((f) => f.nombre).join(', ')}.`, {
      datos: filas.map((f) => ({ etiqueta: `${f.nombre}${f.is_default ? ' (principal)' : ''}`, valor: `${f.last_cost ? `último costo ${h.dinero(f.last_cost)}` : ''}${f.telefono ? ` · ${f.telefono}` : ''}` })) });
  },

  async 'proveedor.contacto'(it) {
    const prov = await h.proveedor(h.v(it, 'proveedor'));
    if (!prov) return h.msg('No encontré ese proveedor.');
    const datos = [['Contacto', prov.contacto], ['Teléfono', prov.telefono], ['Correo', prov.correo], ['RFC', prov.rfc]]
      .filter(([, x]) => x).map(([etiqueta, valor]) => ({ etiqueta, valor: String(valor) }));
    return h.msg(datos.length ? `Datos de ${prov.nombre}:` : `${prov.nombre} no tiene datos de contacto registrados.`, { datos,
      opciones: [{ etiqueta: 'Abrir proveedores', intent: 'ir_a', params: { ruta: '/dashboard/proveedores', etiqueta: 'Proveedores' } }] });
  },
});
