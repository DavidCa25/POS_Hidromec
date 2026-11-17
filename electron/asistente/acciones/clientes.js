'use strict';
/* CLIENTES: fiado, abonos, altas, mejores clientes, ficha, puntos y cumpleaños. */

module.exports = (h) => {
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
  };
};
