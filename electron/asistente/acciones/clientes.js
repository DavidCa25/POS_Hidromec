'use strict';
/* CLIENTES: fiado, abonos, altas, mejores clientes, ficha, puntos y cumpleaños. */

module.exports = (h) => {
  /** Cerrar (deja de admitir boletos) o sortear (irreversible) la rifa nombrada. */
  async function rifa(it, que) {
    const dicho = h.llano(h.v(it, 'textoRifa'));
    const rifas = await h.q(`SELECT id, name, status, winners_count, closed_entries_count, (SELECT COUNT(*) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id) AS boletos
                              FROM dbo.raffle_definitions r WHERE status IN ('OPEN', 'CLOSED');`).catch(() => []);
    const r = rifas.find((x) => h.llano(x.name) === dicho) || rifas.find((x) => h.llano(x.name).includes(dicho) || dicho.includes(h.llano(x.name)));
    if (!r) return h.msg(rifas.length ? `No encuentro esa rifa. Abiertas: ${rifas.map((x) => x.name).join(', ')}.` : 'No hay rifas abiertas ni cerradas por sortear.');
    if (que === 'cerrar') {
      if (r.status !== 'OPEN') return h.msg(`«${r.name}» ya está cerrada: falta sortearla.`);
      return h.msg('Esta rifa voy a cerrar:', { plan: h.plan('rifa.cerrar', {
        titulo: `Cerrar la rifa «${r.name}»`, vista: [{ etiqueta: 'Boletos', valor: h.num(r.boletos) }],
        avisos: ['Ya no entra ningún boleto. Sortear es aparte.'],
        ejecutar: { api: 'wybix.raffles.close', payload: { raffleId: Number(r.id), userId: null } }, permiso: 'VENTAS_SUPERVISAR',
      }) });
    }
    if (r.status !== 'CLOSED') return h.msg(`Primero hay que cerrar «${r.name}»: dime «cierra la rifa ${r.name}».`);
    const ganadores = Number(h.v(it, 'ganadores')) || Number(r.winners_count) || 1;
    const suplentes = Number(h.v(it, 'suplentes')) || 0;
    return h.msg('Este sorteo voy a hacer:', { plan: h.plan('rifa.sortear', {
      titulo: `Sortear «${r.name}»`,
      vista: [{ etiqueta: 'Boletos', valor: h.num(r.closed_entries_count ?? r.boletos) }, { etiqueta: 'Ganadores', valor: String(ganadores) }, ...(suplentes ? [{ etiqueta: 'Suplentes', valor: String(suplentes) }] : [])],
      avisos: ['Es irreversible: queda registrado el sorteo con su semilla para comprobarlo después.'],
      ejecutar: { api: 'wybix.raffles.draw', payload: { raffleId: Number(r.id), userId: null, registerId: h.cajaEquipo(), winners: ganadores, alternates: suplentes } },
      permiso: 'VENTAS_SUPERVISAR',
    }) });
  }

  const notasAbiertas = (cid) => h.q(`
    SELECT id, datee, total, balance, due_date FROM dbo.sales
     WHERE customer_id = @id AND balance > 0.005 ORDER BY datee;`, [h.id(cid)]);

  return {
    async 'cliente.deuda'(it) {
      const cid = h.v(it, 'cliente');
      if (cid) {
        const c = await h.cliente(cid);
        const notas = await notasAbiertas(cid);
        if (!notas.length) return h.msg(`${c?.nombre || 'Ese cliente'} no debe nada.`, { tono: 'exito' });
        const saldo = notas.reduce((a, n) => a + Number(n.balance), 0);
        const vencidas = notas.filter((n) => n.due_date && Date.parse(n.due_date) < Date.now());
        return h.msg(`${c.nombre} debe ${h.dinero(saldo)} en ${h.plural(notas.length, 'nota')}${vencidas.length ? ` (${vencidas.length} vencida${vencidas.length === 1 ? '' : 's'})` : ''}.`, {
          datos: [...notas.slice(0, 6).map((n) => ({ etiqueta: `Nota ${n.id} · ${h.diaTexto(n.datee)}`, valor: h.dinero(n.balance) })),
                  ...(Number(c.credit_limit) > 0 ? [{ etiqueta: 'Crédito disponible', valor: h.dinero(Math.max(0, Number(c.credit_limit) - saldo)) }] : [])],
          opciones: [{ etiqueta: 'Registrar un abono', intent: 'cliente.abono', params: { clienteId: c.id } }],
          tono: vencidas.length ? 'atencion' : 'normal' });
      }
      const filas = await h.q(`
        SELECT c.id, c.customerName AS nombre, SUM(s.balance) AS saldo, MIN(s.datee) AS desde,
               SUM(CASE WHEN s.due_date < GETDATE() THEN s.balance ELSE 0 END) AS vencido
          FROM dbo.sales s JOIN dbo.customers c ON c.id = s.customer_id
         WHERE s.balance > 0.005 GROUP BY c.id, c.customerName ORDER BY SUM(s.balance) DESC;`);
      if (!filas.length) return h.msg('Nadie te debe.', { tono: 'exito' });
      const total = filas.reduce((a, f) => a + Number(f.saldo), 0);
      const vencido = filas.reduce((a, f) => a + Number(f.vencido), 0);
      return h.msg(`Te deben ${h.dinero(total)} entre ${h.plural(filas.length, 'cliente')}${vencido > 0 ? ` (${h.dinero(vencido)} ya vencido)` : ''}:`, {
        datos: filas.slice(0, 10).map((f) => ({ etiqueta: f.nombre, valor: `${h.dinero(f.saldo)}${Number(f.vencido) > 0 ? ' · vencido' : ''}` })),
        tono: vencido > 0 ? 'atencion' : 'normal' });
    },

    async 'cliente.abono'(it, ctx) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré ese cliente.');
      const monto = h.r2(h.v(it, 'monto'));
      if (!(monto > 0)) return h.msg('El monto tiene que ser mayor a cero.');
      const metodo = h.v(it, 'metodo');
      const notas = await notasAbiertas(c.id);
      if (!notas.length) return h.msg(`${c.nombre} no tiene nada pendiente: no hay a qué abonar.`);
      const saldo = notas.reduce((a, n) => a + Number(n.balance), 0);
      /* Un abono va a UNA nota. Si cabe en la más vieja, se arma el plan; si
         no, se reparte en la pantalla de Clientes, donde se ve nota por nota. */
      const nota = notas[0];
      if (monto > Number(nota.balance) + 0.005) {
        return h.ir(`${c.nombre} debe ${h.dinero(saldo)} en ${h.plural(notas.length, 'nota')} y la más vieja es de ${h.dinero(nota.balance)}. Para repartir ${h.dinero(monto)} entre varias notas, hazlo en su estado de cuenta. Te llevo.`, '/dashboard/clientes');
      }
      return h.msg('Este abono voy a registrar:', { plan: h.plan('cliente.abono', {
        titulo: `Abono de ${c.nombre} · ${h.dinero(monto)}`,
        vista: [{ etiqueta: 'Monto', valor: h.dinero(monto) }, { etiqueta: 'Forma de pago', valor: metodo.toLowerCase() },
                { etiqueta: `Nota ${nota.id}`, valor: `${h.dinero(nota.balance)} → ${h.dinero(Number(nota.balance) - monto)}` },
                { etiqueta: 'Saldo total', valor: `${h.dinero(saldo)} → ${h.dinero(saldo - monto)}` }],
        avisos: metodo === 'EFECTIVO' ? ['Entra al cajón de esta caja.'] : [],
        ejecutar: { api: 'electronAPI.registerCustomerPayment', args: [c.id, nota.id, monto, ctx.userId ?? null, metodo, 'Abono desde Wybix'] },
        permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'cliente.alta'(it) {
      const nombre = String(h.v(it, 'nombre')).trim();
      const tel = h.v(it, 'telefono');
      const ya = await h.uno('SELECT TOP 1 id, customerName AS nombre FROM dbo.customers WHERE customerName = @n;', [['n', h.sql.NVarChar(120), nombre]]);
      if (ya) return h.msg(`Ya tienes a «${ya.nombre}» como cliente.`, { opciones: [{ etiqueta: 'Ver su ficha', intent: 'cliente.info', params: { clienteId: ya.id } }] });
      return h.msg('Este cliente voy a dar de alta:', { plan: h.plan('cliente.alta', {
        titulo: `Cliente · ${nombre}`,
        vista: [{ etiqueta: 'Nombre', valor: nombre }, { etiqueta: 'Teléfono', valor: tel || '—' }, { etiqueta: 'Crédito', valor: 'sin crédito' }],
        avisos: ['El crédito (fiado) se asigna después en su ficha, con permiso de crédito.'],
        ejecutar: { api: 'electronAPI.createCustomer', args: [null, nombre, null, null, tel || null, 0, 0, 1, null, null, null, 0, 0, 0, null] },
        permiso: 'VENTAS_OPERAR',
      }) });
    },

    async 'cliente.top'(it) {
      const r = h.rango(h.v(it, 'periodo') === 'hoy' ? 'mes' : h.v(it, 'periodo'));
      const filas = await h.q(`
        SELECT TOP 10 c.id, c.customerName AS nombre, COUNT(*) AS visitas, SUM(s.total) AS total
          FROM dbo.sales s JOIN dbo.customers c ON c.id = s.customer_id
         WHERE s.datee >= ${r.desde} AND s.datee < ${r.hasta}
         GROUP BY c.id, c.customerName ORDER BY SUM(s.total) DESC;`);
      if (!filas.length) return h.msg(`No hay ventas con cliente registrado ${r.de}. Si asignas el cliente al cobrar, te digo quién compra más.`);
      return h.msg(`Tu mejor cliente ${r.de} es ${filas[0].nombre}.`, {
        datos: filas.map((f) => ({ etiqueta: f.nombre, valor: `${h.dinero(f.total)} · ${h.plural(f.visitas, 'compra')}` })),
        refs: filas.map((f) => ({ tipo: 'cliente', id: Number(f.id), nombre: f.nombre })) });
    },

    async 'cliente.info'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré ese cliente.');
      const x = await h.uno(`
        SELECT MAX(datee) AS ultima, COUNT(*) AS compras, ISNULL(SUM(total), 0) AS total,
               ISNULL(SUM(CASE WHEN datee >= DATEADD(DAY, -90, GETDATE()) THEN total END), 0) AS total90,
               ISNULL(SUM(balance), 0) AS saldo
          FROM dbo.sales WHERE customer_id = @id;`, [h.id(c.id)]);
      const top = await h.q(`
        SELECT TOP 3 p.nombre, SUM(sd.quantity) AS q FROM dbo.sale_detail sd JOIN dbo.sales s ON s.id = sd.sale_id JOIN dbo.products p ON p.id = sd.product_id
         WHERE s.customer_id = @id GROUP BY p.nombre ORDER BY SUM(sd.quantity) DESC;`, [h.id(c.id)]);
      const tel = c.mobile || c.phone;
      return h.msg(x.ultima ? `${c.nombre} vino por última vez el ${h.diaTexto(x.ultima)}.` : `${c.nombre} no tiene compras registradas.`, {
        datos: [...(tel ? [{ etiqueta: 'Teléfono', valor: tel }] : []), ...(c.email ? [{ etiqueta: 'Correo', valor: c.email }] : []),
                { etiqueta: 'Compras', valor: `${x.compras} · ${h.dinero(x.total)}` }, { etiqueta: 'Últimos 90 días', valor: h.dinero(x.total90) },
                ...(Number(x.saldo) > 0 ? [{ etiqueta: 'Debe', valor: h.dinero(x.saldo) }] : []),
                ...(top.length ? [{ etiqueta: 'Lo que más compra', valor: top.map((t) => t.nombre).join(', ') }] : [])] });
    },

    async 'cliente.puntos'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré ese cliente.');
      const filas = await h.q(`SELECT program, SUM(delta) AS saldo FROM dbo.loyalty_ledger WHERE customer_id = @id GROUP BY program;`, [h.id(c.id)]);
      if (!filas.length) return h.msg(`${c.nombre} no tiene puntos ni sellos todavía.`);
      const nombre = (p) => ({ POINTS: 'Puntos', PUNTOS: 'Puntos', STAMPS: 'Sellos', SELLOS: 'Sellos', WALLET: 'Monedero', MONEDERO: 'Monedero' }[String(p).toUpperCase()] || p);
      return h.msg(`${c.nombre} tiene:`, { datos: filas.map((f) => ({ etiqueta: nombre(f.program), valor: h.num(f.saldo) })) });
    },

    async 'cliente.cumple'(it) {
      const periodo = h.v(it, 'periodo');
      const dias = periodo === 'mes' ? 31 : periodo === 'semana' ? 7 : 1;
      /* Cumpleaños en los próximos N días (sin importar el año de nacimiento). */
      const filas = await h.q(`
        ;WITH c AS (
          SELECT customerName AS nombre, phone, mobile, birthdate,
                 DATEFROMPARTS(YEAR(GETDATE()), MONTH(birthdate), CASE WHEN MONTH(birthdate) = 2 AND DAY(birthdate) = 29 THEN 28 ELSE DAY(birthdate) END) AS este
            FROM dbo.customers WHERE active = 1 AND birthdate IS NOT NULL)
        SELECT nombre, phone, mobile, este FROM c
         WHERE DATEDIFF(DAY, CAST(GETDATE() AS DATE), este) BETWEEN 0 AND @dias - 1
         ORDER BY este;`, [['dias', h.sql.Int, dias]]);
      const cuando = dias === 1 ? 'hoy' : dias === 7 ? 'esta semana' : 'este mes';
      if (!filas.length) return h.msg(`Nadie cumple años ${cuando} (de los clientes con fecha de nacimiento).`);
      return h.msg(`${h.plural(filas.length, 'cliente')} cumple${filas.length === 1 ? '' : 'n'} años ${cuando}:`, {
        datos: filas.map((f) => ({ etiqueta: f.nombre, valor: `${h.fechaCorta(new Date(f.este).toISOString())}${f.mobile || f.phone ? ` · ${f.mobile || f.phone}` : ''}` })) });
    },
    /* «Cambia el teléfono de doña Mary a 55…», «ponle límite de 2000 a don Pepe». */
    async 'cliente.editar'(it, ctx) {
      return require('./entidades').editarFicha(h, ctx, { ent: require('./entidades').cliente, tipo: 'cliente', id: h.v(it, 'cliente'),
        campo: h.v(it, 'campo'), nuevo: h.v(it, 'valor'), intent: 'cliente.editar' });
    },

    /* «Ponle 100 puntos a doña Mary porque…» / «quítale 50 puntos…». */
    async 'puntos.ajustar'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré a ese cliente.');
      const n = Math.trunc(Number(h.v(it, 'cantidad')) || 0);
      if (!n) return h.msg('¿Cuántos puntos?');
      const saldo = await h.uno('SELECT ISNULL(SUM(delta), 0) AS p FROM dbo.loyalty_ledger WHERE customer_id = @c AND card_id IS NULL;', [['c', h.sql.Int, c.id]]).catch(() => null);
      const antes = saldo ? Number(saldo.p) : null;
      if (antes != null && antes + n < 0) return h.msg(`${c.nombre} solo tiene ${h.num(antes)} puntos.`);
      const nota = h.v(it, 'nota') || 'Ajuste desde Wybix';
      return h.msg('Este ajuste voy a registrar:', { plan: h.plan('puntos.ajustar', {
        titulo: `${n > 0 ? 'Abonar' : 'Quitar'} ${h.num(Math.abs(n))} puntos · ${c.nombre}`,
        vista: [{ etiqueta: 'Cliente', valor: c.nombre }, ...(antes != null ? [{ etiqueta: 'Puntos', valor: `${h.num(antes)} → ${h.num(antes + n)}` }] : []),
                { etiqueta: 'Motivo', valor: nota }],
        avisos: ['Queda en el historial de puntos con quién lo hizo.'],
        ejecutar: { api: 'electronAPI.puntosAjustar', payload: { customerId: c.id, cantidad: n, tarjetaId: null, nota } }, permiso: 'VENTAS_SUPERVISAR',
      }) });
    },

    async 'club.cancelar'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré a ese cliente.');
      const m = await h.uno(`SELECT TOP 1 m.id, p.name AS plan, m.paid_until FROM dbo.customer_memberships m JOIN dbo.membership_plans p ON p.id = m.plan_id
                              WHERE m.customer_id = @c AND m.status = N'ACTIVE' ORDER BY m.paid_until DESC;`, [['c', h.sql.Int, c.id]]).catch(() => null);
      if (!m) return h.msg(`${c.nombre} no tiene membresía activa.`);
      const nota = h.v(it, 'nota');
      return h.msg('Esta membresía voy a cancelar:', { plan: h.plan('club.cancelar', {
        titulo: `Cancelar la membresía de ${c.nombre}`,
        vista: [{ etiqueta: 'Plan', valor: m.plan }, { etiqueta: 'Pagada hasta', valor: m.paid_until ? h.diaTexto(m.paid_until) : '—' }, ...(nota ? [{ etiqueta: 'Motivo', valor: nota }] : [])],
        avisos: ['Deja de dar el beneficio desde ya; lo pagado no se devuelve solo.'],
        ejecutar: { api: 'electronAPI.clubGestionar', payload: { accion: 'CANCELAR', id: Number(m.id), nota: nota || null } }, permiso: 'VENTAS_SUPERVISAR',
      }) });
    },

    async 'rifa.cerrar'(it) { return rifa(it, 'cerrar'); },
    async 'rifa.sortear'(it) { return rifa(it, 'sortear'); },

    /* «Dale a doña Mary un cupón de 10%», «genera 20 cupones de 2x1». */
    async 'cupon.emitir'(it) {
      const dicho = h.llano(h.v(it, 'textoCupon'));
      const defs = await h.q('SELECT id, name, kind, amount, discount_pct, valid_days FROM dbo.coupon_definitions WHERE active = 1;').catch(() => []);
      const pct = (dicho.match(/(\d+)\s*%|(\d+)\s*por ciento/) || []).slice(1).find(Boolean);
      const monto = (dicho.match(/\$\s*(\d+)|(\d+)\s*pesos/) || []).slice(1).find(Boolean);
      const d = defs.find((x) => h.llano(x.name) === dicho) || defs.find((x) => h.llano(x.name).includes(dicho) || dicho.includes(h.llano(x.name)))
        || (pct && defs.find((x) => Number(x.discount_pct) === Number(pct))) || (monto && defs.find((x) => Number(x.amount) === Number(monto)));
      if (!d) return h.msg(defs.length ? `No tengo un cupón «${h.v(it, 'textoCupon')}». Hay: ${defs.slice(0, 6).map((x) => x.name).join(', ')}.` : 'No hay cupones dados de alta: créalos en Fidelización.');
      const n = Math.max(1, Math.min(500, Number(h.v(it, 'cantidad')) || 1));
      const c = h.v(it, 'cliente') ? await h.cliente(h.v(it, 'cliente')) : null;
      return h.msg('Estos cupones voy a emitir:', { plan: h.plan('cupon.emitir', {
        titulo: `${n === 1 ? 'Un cupón' : `${n} cupones`} · ${d.name}${c ? ' para ' + c.nombre : ''}`,
        vista: [{ etiqueta: 'Cupón', valor: d.name }, { etiqueta: 'Cuántos', valor: String(n) }, ...(c ? [{ etiqueta: 'Para', valor: c.nombre }] : []),
                ...(d.valid_days ? [{ etiqueta: 'Vale', valor: `${d.valid_days} días` }] : [])],
        avisos: ['Los códigos salen al confirmar; se pueden imprimir o mandar desde Fidelización.'],
        ejecutar: { api: 'wybix.coupons.issue', payload: { definitionId: Number(d.id), quantity: n, customerId: c?.id ?? null, machineId: null, registerId: h.cajaEquipo() } },
        permiso: 'CREDITO_CUPONES',
      }) });
    },

    /* «Da 1 punto por cada 10 pesos», «los puntos caducan a los 12 meses»: la configuración completa con ese cambio. */
    async 'puntos.config'(it) {
      const c = await h.uno('SELECT TOP 1 enabled, per_amount, points_per, visit_points, expiry_months FROM dbo.loyalty_points_config;').catch(() => null)
        || { enabled: false, per_amount: null, points_per: 1, visit_points: 0, expiry_months: null };
      const nuevo = { activo: !!c.enabled, cadaMonto: c.per_amount != null ? Number(c.per_amount) : null, puntos: Number(c.points_per) || 1,
                      porVisita: Number(c.visit_points) || 0, caducaMeses: c.expiry_months != null ? Number(c.expiry_months) : null };
      const cambios = [];
      if (h.v(it, 'puntos') != null) { nuevo.puntos = h.v(it, 'puntos'); nuevo.cadaMonto = h.v(it, 'cadaMonto'); nuevo.activo = true; cambios.push('regla'); }
      if (h.v(it, 'caducaMeses') != null) { nuevo.caducaMeses = h.v(it, 'caducaMeses') || null; cambios.push('caducidad'); }
      if (h.v(it, 'porVisita') != null) { nuevo.porVisita = h.v(it, 'porVisita'); nuevo.activo = true; cambios.push('visita'); }
      if (h.v(it, 'activo') != null) { nuevo.activo = !!h.v(it, 'activo'); cambios.push('estado'); }
      const regla = (x) => (x.cadaMonto ? `${x.puntos} punto(s) por cada ${h.dinero(x.cadaMonto)}` : 'sin puntos por compra');
      const antes = { activo: !!c.enabled, cadaMonto: c.per_amount, puntos: c.points_per, porVisita: c.visit_points, caducaMeses: c.expiry_months };
      return h.msg('Así quedan los puntos:', { plan: h.plan('puntos.config', {
        titulo: 'Configuración de puntos',
        vista: [{ etiqueta: 'Puntos', valor: `${antes.activo ? 'encendidos' : 'apagados'} → ${nuevo.activo ? 'encendidos' : 'apagados'}` },
                { etiqueta: 'Por compra', valor: `${regla(antes)} → ${regla(nuevo)}` },
                { etiqueta: 'Por visita', valor: `${antes.porVisita || 0} → ${nuevo.porVisita || 0}` },
                { etiqueta: 'Caducan', valor: `${antes.caducaMeses ? antes.caducaMeses + ' meses' : 'nunca'} → ${nuevo.caducaMeses ? nuevo.caducaMeses + ' meses' : 'nunca'}` }],
        ejecutar: { api: 'electronAPI.puntosConfigGuardar', payload: nuevo }, permiso: 'COMERCIAL_ADMINISTRAR',
      }) });
    },
  };
};
