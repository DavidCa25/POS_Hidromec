'use strict';
/* VENTA: cuánto, qué, cómo se pagó, a qué hora; tickets y cuentas.
   «¿Por qué subieron o bajaron?» (venta.comparar) está en analisis.js. */

module.exports = (h) => {
  /** Ventas y tickets de un rango, y del rango anterior equivalente. */
  async function totales(r) {
    return h.uno(`
      SELECT (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE datee >= ${r.desde} AND datee < ${r.hasta}) AS total,
             (SELECT COUNT(*) FROM dbo.sales WHERE datee >= ${r.desde} AND datee < ${r.hasta}) AS tickets,
             (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE datee >= ${r.antesDesde} AND datee < ${r.antesHasta}) AS antes,
             (SELECT COUNT(*) FROM dbo.sales WHERE datee >= ${r.antesDesde} AND datee < ${r.antesHasta}) AS tickets_antes;`);
  }

  return {
    async 'consulta.hoy'(it, ctx) {
      const r = h.rango(h.v(it, 'periodo'));
      const x = await totales(r);
      const total = Number(x.total) || 0, tickets = Number(x.tickets) || 0;
      const comp = h.pct(total, x.antes);
      /* Hoy: contra los mismos días de la semana, a la misma hora. */
      const comentario = (h.v(it, 'periodo') || 'hoy') === 'hoy' && tickets ? await h.resumen.comentarioHoy() : null;
      const texto = tickets ? h.di('ventas.total', ctx, { periodo: r.nombre, total: h.dinero(total), tickets: h.plural(tickets, 'ticket') })
                            : h.di('sin.ventas', ctx, { periodo: r.nombre, de: r.de });
      return h.msg([texto, comentario].filter(Boolean).join(' '), {
        datos: [{ etiqueta: 'Ventas', valor: h.dinero(total) }, { etiqueta: 'Tickets', valor: String(tickets) },
                { etiqueta: 'Ticket promedio', valor: h.dinero(tickets ? total / tickets : 0) },
                ...(comp != null ? [{ etiqueta: `Contra ${r.contra}`, valor: h.signo(comp) }] : [])],
        opciones: [{ etiqueta: '¿Qué se vendió más?', intent: 'venta.top', params: { periodo: h.v(it, 'periodo') } },
                   { etiqueta: 'Por forma de pago', intent: 'venta.por_pago', params: { periodo: h.v(it, 'periodo') } }],
        tono: comp != null && comp < -15 ? 'atencion' : 'normal' });
    },

    async 'venta.top'(it) {
      const r = h.rango(h.v(it, 'periodo') || 'semana');
      const pid = h.v(it, 'producto');
      if (pid) {
        const p = await h.producto(pid);
        const x = await h.uno(`
          SELECT ISNULL(SUM(sd.quantity), 0) AS piezas, ISNULL(SUM(sd.subtotal), 0) AS importe, COUNT(DISTINCT s.id) AS tickets
            FROM dbo.sale_detail sd JOIN dbo.sales s ON s.id = sd.sale_id
           WHERE sd.product_id = @id AND s.datee >= ${r.desde} AND s.datee < ${r.hasta};`, [h.id(pid)]);
        return h.msg(`${r.nombre} vendiste ${h.num(x.piezas)} de ${p?.nombre || 'ese producto'} por ${h.dinero(x.importe)}.`, {
          datos: [{ etiqueta: 'Piezas', valor: h.num(x.piezas) }, { etiqueta: 'Importe', valor: h.dinero(x.importe) }, { etiqueta: 'Tickets', valor: String(x.tickets) }] });
      }
      const filas = await h.q(`
        SELECT TOP 10 p.id, p.nombre, SUM(sd.quantity) AS piezas, SUM(sd.subtotal) AS importe
          FROM dbo.sale_detail sd JOIN dbo.sales s ON s.id = sd.sale_id JOIN dbo.products p ON p.id = sd.product_id
         WHERE s.datee >= ${r.desde} AND s.datee < ${r.hasta}
         GROUP BY p.id, p.nombre ORDER BY SUM(sd.quantity) DESC;`);
      if (!filas.length) return h.msg(`${r.nombre} no hay ventas todavía.`);
      return h.msg(`Lo más vendido ${r.de}: ${filas[0].nombre}.`, {
        datos: filas.map((f) => ({ etiqueta: f.nombre, valor: `${h.num(f.piezas)} · ${h.dinero(f.importe)}` })),
        grafica: { tipo: 'barras', puntos: filas.map((f) => ({ etiqueta: f.nombre, valor: Number(f.piezas) })) },
        /* «dime más del segundo»: qué es cada renglón. */
        refs: filas.map((f) => ({ tipo: 'producto', id: Number(f.id), nombre: f.nombre })) });
    },

    async 'venta.por_pago'(it) {
      const r = h.rango(h.v(it, 'periodo'));
      /* Pagos mixtos (sale_payments) y, para ventas sin desglose, su forma de pago. */
      const filas = await h.q(`
        ;WITH v AS (SELECT id, payment_method, total FROM dbo.sales WHERE datee >= ${r.desde} AND datee < ${r.hasta})
        SELECT UPPER(m) AS metodo, SUM(monto) AS monto FROM (
          SELECT sp.payment_method AS m, sp.amount AS monto FROM dbo.sale_payments sp JOIN v ON v.id = sp.sale_id
          UNION ALL
          SELECT v.payment_method, v.total FROM v WHERE NOT EXISTS (SELECT 1 FROM dbo.sale_payments sp WHERE sp.sale_id = v.id)
        ) x GROUP BY UPPER(m) ORDER BY SUM(monto) DESC;`);
      if (!filas.length) return h.msg(`${r.nombre} no hay ventas todavía.`);
      const metodo = h.v(it, 'metodo');
      const total = filas.reduce((a, f) => a + Number(f.monto), 0);
      const nombre = (m) => ({ EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', CREDITO: 'Crédito (fiado)', VALES: 'Vales' }[m] || m);
      if (metodo) {
        const f = filas.find((x) => x.metodo === metodo);
        return h.msg(`${r.nombre}: ${h.dinero(f?.monto || 0)} en ${nombre(metodo).toLowerCase()} (${total ? Math.round((Number(f?.monto || 0) / total) * 100) : 0}% de lo vendido).`);
      }
      return h.msg(`${r.nombre} vendiste ${h.dinero(total)}, así:`, {
        datos: filas.map((f) => ({ etiqueta: nombre(f.metodo), valor: `${h.dinero(f.monto)} · ${total ? Math.round(Number(f.monto) / total * 100) : 0}%` })) });
    },

    async 'venta.horas'() {
      const horas = await h.q(`
        SELECT DATEPART(HOUR, datee) AS h, COUNT(*) AS tickets, SUM(total) AS total
          FROM dbo.sales WHERE datee >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))
         GROUP BY DATEPART(HOUR, datee) ORDER BY SUM(total) DESC;`);
      const dias = await h.q(`
        SELECT DATEPART(WEEKDAY, datee) AS d, DATENAME(WEEKDAY, datee) AS nombre, SUM(total) AS total
          FROM dbo.sales WHERE datee >= DATEADD(DAY, -56, CAST(GETDATE() AS DATE))
         GROUP BY DATEPART(WEEKDAY, datee), DATENAME(WEEKDAY, datee) ORDER BY SUM(total) DESC;`);
      if (!horas.length) return h.msg('Todavía no hay ventas suficientes para saberlo.');
      const pico = horas[0], floja = horas[horas.length - 1];
      return h.msg(`Tu hora pico es de ${pico.h}:00 a ${pico.h + 1}:00 (últimos 30 días).`, {
        datos: [...horas.slice(0, 4).map((x) => ({ etiqueta: `${x.h}:00 – ${x.h + 1}:00`, valor: `${h.dinero(x.total)} · ${x.tickets} tickets` })),
                { etiqueta: 'La más floja', valor: `${floja.h}:00 – ${floja.h + 1}:00` },
                ...(dias.length ? [{ etiqueta: 'Mejor día', valor: dias[0].nombre }, { etiqueta: 'Día más flojo', valor: dias[dias.length - 1].nombre }] : [])] });
    },


    async 'venta.buscar'(it) {
      const folio = h.v(it, 'folio');
      const s = await h.uno(`
        SELECT s.id, s.datee, s.total, s.payment_method, s.balance, u.usuario, c.customerName AS cliente
          FROM dbo.sales s LEFT JOIN dbo.users u ON u.id = s.useer_id LEFT JOIN dbo.customers c ON c.id = s.customer_id
         WHERE s.id = @id;`, [h.id(folio)]);
      if (!s) return h.msg(`No encuentro la venta ${folio}.`);
      const lineas = await h.q(`SELECT p.nombre, sd.quantity, sd.subtotal FROM dbo.sale_detail sd JOIN dbo.products p ON p.id = sd.product_id WHERE sd.sale_id = @id;`, [h.id(folio)]);
      const devuelta = await h.uno(`SELECT ISNULL(SUM(refund_total), 0) AS t FROM dbo.sale_refunds WHERE sale_id = @id;`, [h.id(folio)]);
      return h.msg(`Venta ${s.id} · ${h.diaTexto(s.datee)} ${h.horaTexto(s.datee)} · ${h.dinero(s.total)}${s.usuario ? ` · cobró ${s.usuario}` : ''}.`, {
        datos: [...lineas.map((l) => ({ etiqueta: `${h.num(l.quantity)} × ${l.nombre}`, valor: h.dinero(l.subtotal) })),
                { etiqueta: 'Pago', valor: s.payment_method || '—' },
                ...(s.cliente ? [{ etiqueta: 'Cliente', valor: s.cliente }] : []),
                ...(Number(s.balance) > 0 ? [{ etiqueta: 'Saldo pendiente', valor: h.dinero(s.balance) }] : []),
                ...(Number(devuelta.t) > 0 ? [{ etiqueta: 'Devuelto', valor: h.dinero(devuelta.t) }] : [])],
        opciones: [{ etiqueta: 'Hacer devolución', intent: 'venta.devolucion', params: { folio: s.id } },
                   { etiqueta: 'Facturar', intent: 'factura.emitir', params: { folio: s.id } }] });
    },

    async 'venta.cotizar'(it) {
      const rs = h.v(it, 'renglones') || [];
      let total = 0;
      const datos = [];
      for (const r of rs) {
        const p = await h.producto(r.productId);
        if (!p) continue;
        const imp = h.r2(Number(p.price) * r.cantidad);
        total += imp;
        datos.push({ etiqueta: `${h.num(r.cantidad)} × ${p.nombre}`, valor: `${h.dinero(p.price)} c/u · ${h.dinero(imp)}` });
      }
      return h.msg(`Son ${h.dinero(total)}.`, { datos,
        opciones: [{ etiqueta: 'Cobrarlo en Venta', intent: 'ir_a', params: { ruta: '/dashboard/venta', etiqueta: 'Venta' } }] });
    },

    async 'venta.cobrar'(it) {
      const rs = h.v(it, 'renglones') || [];
      let total = 0;
      const datos = [];
      for (const r of rs) {
        const p = await h.producto(r.productId);
        if (!p) continue;
        total += Number(p.price) * r.cantidad;
        datos.push({ etiqueta: `${h.num(r.cantidad)} × ${p.nombre}`, valor: h.dinero(Number(p.price) * r.cantidad) });
      }
      /* Cobrar es de la pantalla de Venta: ahí se elige la forma de pago, se
         imprime y se abre el cajón. Wybix deja la cuenta hecha. */
      return h.ir(rs.length ? `Son ${h.dinero(total)}. Te llevo a Venta para cobrarlo.` : 'Te llevo a Venta para cobrar.', '/dashboard/venta', {
        datos, carrito: rs.map((r) => ({ productId: r.productId, cantidad: r.cantidad })) });
    },

    async 'venta.devolucion'(it) {
      const folio = h.v(it, 'folio');
      return h.ir(folio
        ? `La devolución del ticket ${folio} se hace en Venta → «Devolución»: ahí eliges qué regresa y cómo se devuelve el dinero.`
        : 'Las devoluciones se hacen en Venta → «Devolución»: buscas el ticket por folio y eliges qué regresa.', '/dashboard/venta',
      { folio: folio ?? null });
    },
  };
};
