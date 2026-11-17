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

    /**
     * Con forma de pago, cobra desde el chat: la tarjeta muestra el total con
     * las mismas ofertas que cobraría Venta (motor comercial) y, al confirmar,
     * la pantalla registra la venta con SaleService.checkout en una cuenta
     * aparte (ticket, cajón, premios y cupones incluidos). Sin forma de pago,
     * o con un producto que lleva opciones, deja la cuenta en Venta.
     */
    async 'venta.cobrar'(it) {
      const rs = h.v(it, 'renglones') || [];
      /* El slot completo: valor (EFECTIVO…) y cómo se dijo. */
      const metodo = it.slots.metodo?.valor ? it.slots.metodo : null;
      const lineas = [];
      for (const r of rs) {
        const p = await h.producto(r.productId);
        if (p) lineas.push({ p, cantidad: Number(r.cantidad) });
      }
      const lista = h.r2(lineas.reduce((a, l) => a + Number(l.p.price) * l.cantidad, 0));
      const carrito = lineas.map((l) => ({ productId: l.p.id, cantidad: l.cantidad }));
      const llevar = (texto) => h.ir(texto, '/dashboard/venta', {
        datos: lineas.map((l) => ({ etiqueta: `${h.num(l.cantidad)} × ${l.p.nombre}`, valor: h.dinero(Number(l.p.price) * l.cantidad) })), carrito });
      if (!lineas.length) return h.ir('Te llevo a Venta para cobrar.', '/dashboard/venta');
      if (!metodo) return llevar(`Son ${h.dinero(lista)}. Te llevo a Venta para cobrarlo, o dime «en efectivo» o «con tarjeta» y lo cobro aquí.`);
      const conOpciones = await h.q(`SELECT DISTINCT p.nombre FROM dbo.product_modifier_groups pmg JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1
                                       JOIN dbo.products p ON p.id = pmg.product_id WHERE pmg.product_id IN (${carrito.map((c) => Number(c.productId)).join(',')});`);
      if (conOpciones.length) return llevar(`${conOpciones.map((x) => x.nombre).join(', ')} lleva opciones (tamaño, sabor…): se eligen en Venta. Te dejo la cuenta ahí.`);
      const precio = await h.cotizarCuenta(carrito);
      const total = precio.total;
      const recibido = h.v(it, 'monto') != null ? h.r2(h.v(it, 'monto')) : null;
      if (metodo.valor === 'EFECTIVO' && recibido != null && recibido < total) {
        return h.msg(`Son ${h.dinero(total)} y me dices que te dieron ${h.dinero(recibido)}: no alcanza.`);
      }
      const nombre = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia' }[metodo.valor] || metodo.texto;
      const vista = lineas.map((l, i) => {
        const q = precio.lineas[i];
        const unit = q ? q.unitPrice : Number(l.p.price);
        return { etiqueta: `${h.num(l.cantidad)} × ${l.p.nombre}`, valor: `${h.dinero(unit * l.cantidad)}${q?.oferta ? ` · ${q.oferta}` : ''}` };
      });
      vista.push({ etiqueta: 'Total', valor: h.dinero(total) }, { etiqueta: 'Forma de pago', valor: nombre });
      if (metodo.valor === 'EFECTIVO' && recibido != null) vista.push({ etiqueta: 'Recibido', valor: h.dinero(recibido) }, { etiqueta: 'Cambio', valor: h.dinero(recibido - total) });
      const avisos = [];
      if (total < lista - 0.004) avisos.push(`Con las ofertas de hoy: ${h.dinero(lista - total)} menos que el precio de lista.`);
      avisos.push(metodo.valor === 'EFECTIVO' ? 'Se registra la venta, se imprime el ticket y se abre el cajón, igual que en Venta.'
        : 'Se registra la venta y se imprime el ticket. Cóbrala en la terminal antes de confirmar.');
      return h.msg('Esta venta voy a cobrar:', { plan: h.plan('venta.cobrar', {
        titulo: `Cobrar ${h.dinero(total)} en ${nombre.toLowerCase()}`, vista, avisos,
        ejecutar: { api: 'pantalla.cobrar', payload: { lineas: carrito, metodo: metodo.valor, recibido, total } },
        permiso: 'VENTAS_OPERAR',
      }) });
    },

    /** «Reimprime el ticket 123» / «el último»: el mismo canal que el botón de Historial. */
    async 'venta.reimprimir'(it) {
      const s = await ventaDe(h.v(it, 'folio'));
      if (!s) return h.msg(h.v(it, 'folio') && h.v(it, 'folio') !== 'ultimo' ? `No encuentro la venta ${h.v(it, 'folio')}.` : 'Todavía no hay ventas que reimprimir.');
      return h.msg('Este ticket voy a imprimir:', { plan: h.plan('venta.reimprimir', {
        titulo: `Reimprimir ticket ${s.id}`,
        vista: [{ etiqueta: 'Venta', valor: `${s.id} · ${h.diaTexto(s.datee)} ${h.horaTexto(s.datee)}` }, { etiqueta: 'Total', valor: h.dinero(s.total) },
                { etiqueta: 'Pago', valor: s.payment_method || '—' }],
        ejecutar: { api: 'electronAPI.printSaleTicket', payload: { saleId: Number(s.id), paymentMethod: s.payment_method || null } },
        permiso: 'VENTAS_OPERAR',
      }) });
    },

    /**
     * Devolución por sp-refund-sale, con lo que todavía se puede devolver de
     * cada renglón (sp_get_sale_by_folio) y el motivo. El dinero regresa con
     * la regla del procedimiento; la tarjeta lo anticipa como la pantalla.
     */
    async 'venta.devolucion'(it, ctx) {
      const folio = h.v(it, 'folio');
      /* Sin folio no se adivina: se pregunta, y la respuesta vuelve a este intent. */
      if (folio == null) return h.msg('¿De qué ticket? Dime el folio o «el último».', { esperando: { intent: it.intent, slots: it.slots, falta: 'folio' } });
      const base = await ventaDe(folio);
      if (!base) return h.msg(folio === 'ultimo' ? 'Todavía no hay ventas.' : `No encuentro la venta ${folio}.`);
      const [[cab] = [], detalle = []] = await h.sp('sp_get_sale_by_folio', [['sale_id', h.sql.Int, Number(base.id)]]);
      if (!cab) return h.msg(`No encuentro la venta ${base.id}.`);
      const quedan = detalle.filter((d) => Number(d.remaining_qty ?? 0) > 0).map((d) => ({
        productId: Number(d.product_id), nombre: String(d.product_name ?? d.nombre ?? `Producto ${d.product_id}`),
        precio: Number(d.unitary_price ?? 0), maximo: Number(d.remaining_qty ?? 0) }));
      if (!quedan.length) return h.msg(`El ticket ${base.id} ya se devolvió completo.`);
      const pedidos = h.v(it, 'renglones');
      let items;
      if (pedidos?.length) {
        items = [];
        for (const r of pedidos) {
          const d = quedan.find((x) => x.productId === Number(r.productId));
          if (!d) return h.msg(`En el ticket ${base.id} no hay ${r.nombre} por devolver.`);
          if (Number(r.cantidad) > d.maximo) return h.msg(`Del ticket ${base.id} solo se pueden devolver ${h.num(d.maximo)} de ${d.nombre}.`);
          items.push({ ...d, cantidad: Number(r.cantidad) });
        }
      } else items = quedan.map((d) => ({ ...d, cantidad: d.maximo }));
      const total = h.r2(items.reduce((a, l) => a + l.cantidad * l.precio, 0));
      const motivo = h.v(it, 'razon');
      const metodo = String(cab.payment_method ?? '');
      let pagos = [];
      try { pagos = JSON.parse(cab.payments_json || '[]').map((x) => ({ metodo: String(x.payment_method), monto: Number(x.amount) })); } catch { pagos = []; }
      const regresa = comoRegresa({ metodo, pagos, balance: Number(cab.balance ?? 0), devuelto: Number(cab.refund_total ?? 0) }, total);
      return h.msg('Esta devolución voy a registrar:', { plan: h.plan('venta.devolucion', {
        titulo: `Devolución del ticket ${base.id} · ${h.dinero(total)}`,
        vista: [...items.map((l) => ({ etiqueta: `${h.num(l.cantidad)} × ${l.nombre}`, valor: h.dinero(l.cantidad * l.precio) })),
                { etiqueta: 'Motivo', valor: motivo },
                ...regresa.map((r) => ({ etiqueta: r.texto, valor: h.dinero(r.monto) }))],
        avisos: ['Lo devuelto regresa al inventario y el corte lo descuenta.'],
        nivel: ctx.puede('DEVOLUCIONES') ? 'confirmar' : 'autorizar',
        ejecutar: { api: 'electronAPI.refundSale', payload: {
          sale_id: Number(base.id), payment_method: metodo === 'CREDITO' ? 'EFECTIVO' : (metodo || 'EFECTIVO'),
          items: items.map((l) => ({ productId: l.productId, qty: l.cantidad, unitPrice: l.precio })),
          motivo, note: 'Desde Wybix', apply_net_update: 0, amount: total, reason: `Devolución · ${motivo} · folio #${base.id}` } },
        permiso: 'DEVOLUCIONES',
      }) });
    },

    /* «Cambia la coca del ticket 120 por una pepsi»: sp_exchange_sale en una
       sola operación; la diferencia se paga o se regresa en efectivo. */
    async 'venta.cambio'(it, ctx) {
      const folio = h.v(it, 'folio');
      const { cab, quedan } = await quedanDe(folio);
      if (!cab) return h.msg(`No encuentro la venta ${folio}.`);
      const sale = quedan.find((x) => x.productId === Number(h.v(it, 'devuelve')));
      if (!sale) return h.msg(`En el ticket ${folio} no hay ${it.slots.devuelve?.texto || 'ese producto'} por devolver.`);
      const nDev = Math.min(Number(it.slots.devuelve?.cantidad) || 1, sale.maximo);
      const lleva = await h.producto(h.v(it, 'lleva'));
      if (!lleva) return h.msg('No encontré lo que se lleva.');
      const nLleva = Number(it.slots.lleva?.cantidad) || nDev;
      const devuelto = h.r2(nDev * sale.precio), nuevo = h.r2(nLleva * Number(lleva.price)), dif = h.r2(nuevo - devuelto);
      const motivo = h.v(it, 'razon') || 'Se equivocó de producto';
      return h.msg('Este cambio voy a registrar:', { plan: h.plan('venta.cambio', {
        titulo: `Cambio en el ticket ${folio}`,
        vista: [{ etiqueta: `Devuelve ${h.num(nDev)} × ${sale.nombre}`, valor: h.dinero(devuelto) }, { etiqueta: `Se lleva ${h.num(nLleva)} × ${lleva.nombre}`, valor: h.dinero(nuevo) },
                { etiqueta: dif > 0 ? 'Paga la diferencia' : dif < 0 ? 'Se le regresa' : 'Diferencia', valor: dif === 0 ? 'nada' : h.dinero(Math.abs(dif)) }, { etiqueta: 'Motivo', valor: motivo }],
        avisos: [dif !== 0 ? 'La diferencia se cobra o se regresa en efectivo de esta caja.' : 'Sin diferencia de dinero.'],
        nivel: ctx.puede('DEVOLUCIONES') ? 'confirmar' : 'autorizar',
        ejecutar: { api: 'electronAPI.refundExchange', payload: { sale_id: Number(folio), items: [{ productId: sale.productId, qty: nDev, unitPrice: sale.precio }],
          motivo, note: 'Desde Wybix', lleva: [{ productId: lleva.id, qty: nLleva }], diff_method: dif !== 0 ? 'EFECTIVO' : null,
          received: dif > 0 ? dif : null, amount: devuelto, reason: `Cambio · ${motivo} · folio #${folio}` } },
        permiso: 'DEVOLUCIONES',
      }) });
    },

    /* «Corrige la venta 120: eran 3 conchas»: sp_update_sale con la venta completa y esa cantidad. */
    async 'venta.corregir'(it) {
      const folio = h.v(it, 'folio');
      const { cab, detalle } = await quedanDe(folio);
      if (!cab) return h.msg(`No encuentro la venta ${folio}.`);
      const r = h.v(it, 'renglon');
      const lineas = detalle.map((d) => ({ productId: Number(d.product_id), nombre: String(d.product_name ?? d.nombre ?? ''), qty: Number(d.quantity), unitPrice: Number(d.unitary_price) }));
      const l = lineas.find((x) => x.productId === Number(r.productId));
      if (!l) return h.msg(`La venta ${folio} no tiene ${it.slots.renglon?.texto || 'ese producto'}.`);
      if (Number(l.qty) === Number(r.cantidad)) return h.msg(`La venta ${folio} ya tiene ${h.num(r.cantidad)} de ${l.nombre}.`);
      const antes = h.r2(lineas.reduce((a, x) => a + x.qty * x.unitPrice, 0));
      l.qty = Number(r.cantidad);
      const despues = h.r2(lineas.reduce((a, x) => a + x.qty * x.unitPrice, 0));
      return h.msg('Esta corrección voy a registrar:', { plan: h.plan('venta.corregir', {
        titulo: `Corregir la venta ${folio}`,
        vista: [{ etiqueta: l.nombre, valor: `${h.num(detalle.find((d) => Number(d.product_id) === l.productId).quantity)} → ${h.num(l.qty)}` },
                { etiqueta: 'Total', valor: `${h.dinero(antes)} → ${h.dinero(despues)}` }],
        avisos: [despues > antes ? 'La diferencia se cobra en esta caja.' : 'La diferencia se regresa en esta caja.', 'El inventario se ajusta.'],
        ejecutar: { api: 'electronAPI.updateSale', payload: { sale_id: Number(folio), items: lineas.filter((x) => x.qty > 0).map((x) => ({ productId: x.productId, qty: x.qty, unitPrice: x.unitPrice })),
          note: 'Corrección desde Wybix' } },
        permiso: 'MODIFICAR_VENTA',
      }) });
    },

    /* «El cigarro suelto sale de la cajetilla de 20». */
    async 'venta.suelta'(it) {
      const p = await h.producto(h.v(it, 'producto')), padre = await h.producto(h.v(it, 'padre'));
      if (!p || !padre) return h.msg('No encontré esos productos.');
      if (p.id === padre.id) return h.msg('El producto suelto y el paquete tienen que ser distintos.');
      const n = Number(h.v(it, 'piezas'));
      return h.msg('Esto voy a guardar:', { plan: h.plan('venta.suelta', {
        titulo: `${p.nombre} sale de ${padre.nombre}`, vista: [{ etiqueta: 'Suelto', valor: p.nombre }, { etiqueta: 'Paquete', valor: `${padre.nombre} (${h.num(n)} piezas)` }],
        avisos: ['Al vender sueltos, se abren paquetes solos cuando hace falta.'],
        ejecutar: { api: 'electronAPI.ventaSueltaGuardar', payload: { productId: p.id, parentProductId: padre.id, piezas: n } }, permiso: 'CATALOGO_EDITAR',
      }) });
    },

    async 'ticket.correo'(it) {
      const s = await ventaDe(h.v(it, 'folio'));
      if (!s) return h.msg(`No encuentro la venta ${h.v(it, 'folio')}.`);
      const correo = String(h.v(it, 'correo'));
      if (!/^\S+@\S+\.\S+$/.test(correo)) return h.msg('Ese correo no se ve bien.');
      return h.msg('Este ticket voy a mandar:', { plan: h.plan('ticket.correo', {
        titulo: `Ticket ${s.id} a ${correo}`, vista: [{ etiqueta: 'Venta', valor: `${s.id} · ${h.dinero(s.total)}` }, { etiqueta: 'Correo', valor: correo }],
        ejecutar: { api: 'electronAPI.ticketEmail', payload: { saleId: Number(s.id), email: correo } }, permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'ticket.imprimir'(it) {
      const doc = h.v(it, 'documento');
      if (doc === 'closure') {
        const c = await h.uno('SELECT TOP 1 id, closed_at FROM dbo.cash_closures WHERE closed_at IS NOT NULL AND (@caja IS NULL OR register_id = @caja) ORDER BY closed_at DESC;', [['caja', h.sql.Int, h.cajaEquipo()]]);
        if (!c) return h.msg('Todavía no hay cortes cerrados.');
        return h.msg('Este corte voy a imprimir:', { plan: h.plan('ticket.imprimir', {
          titulo: `Imprimir el corte del ${h.diaTexto(c.closed_at)}`, vista: [{ etiqueta: 'Corte', valor: `${h.diaTexto(c.closed_at)} ${h.horaTexto(c.closed_at)}` }],
          ejecutar: { api: 'electronAPI.ticketPrintDocument', payload: { document: 'closure', id: Number(c.id) } }, permiso: 'VENTAS_OPERAR',
        }) });
      }
      const r = await h.uno('SELECT id, sale_id, refund_total FROM dbo.sale_refunds WHERE id = @id;', [h.id(h.v(it, 'folio'))]).catch(() => null);
      if (!r) return h.msg(`No encuentro la devolución ${h.v(it, 'folio')}.`);
      return h.msg('Este comprobante voy a imprimir:', { plan: h.plan('ticket.imprimir', {
        titulo: `Imprimir la devolución ${r.id}`, vista: [{ etiqueta: 'Devolución', valor: `${r.id} · venta ${r.sale_id} · ${h.dinero(r.refund_total)}` }],
        ejecutar: { api: 'electronAPI.ticketPrintDocument', payload: { document: 'refund', id: Number(r.id) } }, permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'ticket.logo_quitar'() {
      return h.msg('Esto voy a cambiar:', { plan: h.plan('ticket.logo_quitar', {
        titulo: 'Quitar el logo del ticket', vista: [{ etiqueta: 'Logo', valor: 'se quita' }],
        ejecutar: { api: 'electronAPI.ticketBorrarLogo', args: [] }, permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    },

    /* «Pon la coca a 15 los martes», «10% en panadería los fines de semana», «2x1 en conchas»:
       la política comercial completa con una promoción más, por commercial:save (que
       pide autorización si pasa del límite de un operador y lo deja en bitácora). */
    async 'promo.crear'(it) {
      const servicio = require('../../comercial/servicio.cjs');
      let pol;
      try { ({ policy: pol } = await servicio.catalogo(await h.pool())); } catch (e) { return h.msg(`No pude leer las promociones: ${e.message}`); }
      const tipo = h.v(it, 'tipo'), c = h.v(it, 'cuando') || {};
      let selector, que;
      if (h.v(it, 'categoria') != null) {
        const k = await h.uno('SELECT namee, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.CAT_categories WHERE id = @id;', [h.id(h.v(it, 'categoria'))]);
        if (!k) return h.msg('No encontré esa categoría.');
        selector = { categories: [k.uuid] }; que = k.namee;
      } else {
        const p = await h.uno('SELECT nombre, price, cost, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.products WHERE id = @id;', [h.id(h.v(it, 'producto'))]);
        if (!p) return h.msg('No encontré ese producto.');
        selector = { products: [p.uuid] }; que = p.nombre;
        if (tipo === 'PRICE' && Number(h.v(it, 'valor')) >= Number(p.price)) return h.msg(`${p.nombre} ya cuesta ${h.dinero(p.price)}: una oferta tiene que ser más barata.`);
        if (tipo === 'PRICE' && Number(p.cost) > 0 && Number(h.v(it, 'valor')) < Number(p.cost)) it.slots._bajoCosto = { valor: true };
      }
      const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      const nombre = (tipo === 'PRICE' ? `${que} a ${h.dinero(h.v(it, 'valor'))}` : tipo === 'PERCENT' ? `${h.v(it, 'valor')}% en ${que}` : `${h.v(it, 'buy')}x${h.v(it, 'pay')} en ${que}`).slice(0, 100);
      const promo = { id: `wybix-${Date.now().toString(36)}`, name: nombre, active: true, priority: 100, kind: tipo, selector,
        ...(tipo === 'BUY_PAY' ? { buy: Number(h.v(it, 'buy')), pay: Number(h.v(it, 'pay')) } : { value: Number(h.v(it, 'valor')).toFixed(2) }),
        ...(c.weekdays ? { weekdays: c.weekdays } : {}), ...(c.windows ? { windows: c.windows } : {}), ...(c.starts ? { starts: c.starts, ends: c.ends } : {}) };
      const vigencia = [c.weekdays ? c.weekdays.map((d) => DIA[d]).join(', ') : null, c.windows ? `de ${c.windows[0].from} a ${c.windows[0].to}` : null,
                        c.starts ? (c.starts === c.ends ? `solo el ${h.diaTexto(h.cuando(c.starts))}` : `del ${h.diaTexto(h.cuando(c.starts))} al ${h.diaTexto(h.cuando(c.ends))}`) : null].filter(Boolean).join(' · ') || 'siempre';
      return h.msg('Esta promoción voy a crear:', { plan: h.plan('promo.crear', {
        titulo: `Promoción · ${nombre}`, vista: [{ etiqueta: 'Promoción', valor: nombre }, { etiqueta: 'Cuándo', valor: vigencia }],
        avisos: [...(it.slots._bajoCosto ? ['Ese precio queda abajo del costo.'] : []), 'Se aplica sola al cobrar, en todas las cajas. Si pasa del límite de un operador, la autoriza un encargado.'],
        ejecutar: { api: 'electronAPI.commercialSave', payload: { version: pol.version, policy: { ...pol, promotions: [...(pol.promotions || []), promo] } } },
        permiso: 'COMERCIAL_ADMINISTRAR',
      }) });
    },

    async 'promo.quitar'(it) {
      const servicio = require('../../comercial/servicio.cjs');
      let pol;
      try { ({ policy: pol } = await servicio.catalogo(await h.pool())); } catch (e) { return h.msg(`No pude leer las promociones: ${e.message}`); }
      const activas = (pol.promotions || []).filter((p) => p.active);
      let uuid = null;
      if (h.v(it, 'producto') != null) uuid = (await h.uno('SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS u FROM dbo.products WHERE id = @id;', [h.id(h.v(it, 'producto'))]))?.u;
      const dicho = h.llano(h.v(it, 'texto'));
      const xs = activas.filter((p) => (uuid && (p.selector?.products || []).includes(uuid)) || h.llano(p.name).includes(dicho));
      if (!xs.length) return h.msg(activas.length ? `No encuentro esa promoción. Activas: ${activas.map((p) => p.name).join(', ')}.` : 'No hay promociones activas.');
      if (xs.length > 1) return h.msg(`Hay ${xs.length} que coinciden: ${xs.map((p) => p.name).join(', ')}. Dime cuál.`);
      const nueva = (pol.promotions || []).map((p) => (p.id === xs[0].id ? { ...p, active: false } : p));
      return h.msg('Esta promoción voy a apagar:', { plan: h.plan('promo.quitar', {
        titulo: `Apagar «${xs[0].name}»`, vista: [{ etiqueta: 'Promoción', valor: `${xs[0].name} → apagada` }],
        ejecutar: { api: 'electronAPI.commercialSave', payload: { version: pol.version, policy: { ...pol, promotions: nueva } } }, permiso: 'COMERCIAL_ADMINISTRAR',
      }) });
    },
  };

  /** Lo que todavía se puede devolver de una venta (sp_get_sale_by_folio). */
  async function quedanDe(id) {
    const [[cab] = [], detalle = []] = await h.sp('sp_get_sale_by_folio', [['sale_id', h.sql.Int, Number(id)]]);
    return { cab, quedan: detalle.filter((d) => Number(d.remaining_qty ?? 0) > 0).map((d) => ({
      productId: Number(d.product_id), nombre: String(d.product_name ?? d.nombre ?? ''), precio: Number(d.unitary_price ?? 0), maximo: Number(d.remaining_qty ?? 0),
      vendidas: Number(d.quantity ?? d.remaining_qty ?? 0) })), detalle };
  }

  /** La venta por folio, o la última de esta caja («el último ticket»). */
  async function ventaDe(folio) {
    if (folio != null && folio !== 'ultimo') return h.uno('SELECT id, datee, total, payment_method FROM dbo.sales WHERE id = @id;', [h.id(folio)]);
    return h.uno(`SELECT TOP 1 id, datee, total, payment_method FROM dbo.sales WHERE (@caja IS NULL OR register_id = @caja) ORDER BY id DESC;`,
      [['caja', h.sql.Int, h.cajaEquipo()]]);
  }
};

const ETIQUETA_REGRESO = { EFECTIVO: 'Se regresa en efectivo', TARJETA: 'Se regresa a la tarjeta', TRANSFERENCIA: 'Se regresa por transferencia',
                           CREDITO: 'Baja lo que debe (crédito)' };
/** Por dónde regresa el dinero: la misma regla que devoluciones.service.ts (comoRegresa) y sp_refund_sale. */
function comoRegresa(v, monto) {
  const partes = [];
  const poner = (metodo, m) => { if (m > 0.004) partes.push({ metodo, monto: Math.round(m * 100) / 100, texto: ETIQUETA_REGRESO[metodo] || `Se regresa por ${metodo.toLowerCase()}` }); };
  if (!v.pagos.length) {
    if (v.metodo === 'CREDITO') { const deuda = Math.min(Math.max(v.balance, 0), monto); poner('CREDITO', deuda); poner('EFECTIVO', monto - deuda); }
    else poner(v.metodo || 'EFECTIVO', monto);
    return partes;
  }
  const orden = [...v.pagos].sort((a, b) => (a.metodo === 'EFECTIVO' ? 0 : 1) - (b.metodo === 'EFECTIVO' ? 0 : 1));
  let previo = v.devuelto, resta = monto;
  for (const p of orden) {
    let disponible = p.monto;
    const usado = Math.min(previo, disponible);
    previo -= usado; disponible -= usado;
    const parte = Math.min(disponible, resta);
    poner(p.metodo, parte);
    resta -= parte;
  }
  return partes;
}
