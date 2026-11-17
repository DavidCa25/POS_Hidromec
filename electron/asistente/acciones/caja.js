'use strict';
/* CAJA: el efectivo, las entradas y salidas, los cortes y el turno. */

module.exports = (h) => ({
  async 'caja.efectivo'() {
    /* Lo que hay en cada cajón desde su último corte: todos los movimientos
       sin corte (fondo, ventas en efectivo, entradas, retiros, gastos). */
    const cajas = await h.q(`
      SELECT m.register_id, ISNULL(r.name, CONCAT('Caja ', m.register_id)) AS caja, SUM(m.amount) AS efectivo,
             SUM(CASE WHEN m.typee = 'OPENING' THEN m.amount ELSE 0 END) AS fondo,
             SUM(CASE WHEN m.typee = 'SALE' THEN m.amount ELSE 0 END) AS ventas,
             SUM(CASE WHEN m.typee NOT IN ('OPENING', 'SALE') THEN m.amount ELSE 0 END) AS otros
        FROM dbo.cash_movements m LEFT JOIN dbo.registers r ON r.id = m.register_id
       WHERE m.closure_id IS NULL
       GROUP BY m.register_id, r.name ORDER BY m.register_id;`);
    if (!cajas.length) return h.msg('No hay efectivo pendiente de corte: la caja está en ceros o sin abrir.');
    const total = cajas.reduce((a, c) => a + Number(c.efectivo), 0);
    if (cajas.length === 1) {
      const c = cajas[0];
      return h.msg(`En caja debe haber ${h.dinero(c.efectivo)}.`, {
        datos: [{ etiqueta: 'Fondo', valor: h.dinero(c.fondo) }, { etiqueta: 'Ventas en efectivo', valor: h.dinero(c.ventas) },
                { etiqueta: 'Entradas y salidas', valor: h.dinero(c.otros) }],
        opciones: [{ etiqueta: 'Hacer el corte', intent: 'caja.corte' }] });
    }
    return h.msg(`Entre todas las cajas debe haber ${h.dinero(total)}.`, {
      datos: cajas.map((c) => ({ etiqueta: c.caja, valor: h.dinero(c.efectivo) })) });
  },

  async 'caja.entrada'(it, ctx) {
    const monto = h.r2(h.v(it, 'monto'));
    if (!(monto > 0)) return h.msg('El monto tiene que ser mayor a cero.');
    const nota = h.v(it, 'nota');
    return h.msg('Esta entrada voy a registrar:', { plan: h.plan('caja.entrada', {
      titulo: `Entrada de efectivo · ${h.dinero(monto)}`,
      vista: [{ etiqueta: 'Monto', valor: h.dinero(monto) }, ...(nota ? [{ etiqueta: 'Nota', valor: nota }] : [])],
      avisos: ['Se abre el cajón y el corte la suma en «Otras entradas».'],
      nivel: ctx.puede('RETIROS_EGRESOS') ? 'confirmar' : 'autorizar',
      ejecutar: { api: 'electronAPI.registerCashIn', payload: { amount: monto, concept: 'Asistente', note: nota || 'Registrada desde Wybix' } },
      permiso: 'RETIROS_EGRESOS',
    }) });
  },

  async 'caja.salida'(it, ctx) {
    const monto = h.r2(h.v(it, 'monto'));
    if (!(monto > 0)) return h.msg('El monto tiene que ser mayor a cero.');
    const nota = h.v(it, 'nota');
    const hay = await h.uno('SELECT ISNULL(SUM(amount), 0) AS e FROM dbo.cash_movements WHERE closure_id IS NULL;');
    const avisos = ['Un retiro no es un gasto: si es para pagar algo, dime «pagué … de luz» y lo registro como gasto.'];
    if (monto > Number(hay?.e || 0)) avisos.unshift(`En caja solo debería haber ${h.dinero(hay?.e || 0)}.`);
    return h.msg('Este retiro voy a registrar:', { plan: h.plan('caja.salida', {
      titulo: `Retiro de efectivo · ${h.dinero(monto)}`,
      vista: [{ etiqueta: 'Monto', valor: h.dinero(monto) }, { etiqueta: 'Efectivo en caja', valor: `${h.dinero(hay?.e || 0)} → ${h.dinero(Number(hay?.e || 0) - monto)}` },
              ...(nota ? [{ etiqueta: 'Nota', valor: nota }] : [])],
      avisos, nivel: ctx.puede('RETIROS_EGRESOS') ? 'confirmar' : 'autorizar',
      ejecutar: { api: 'electronAPI.registerCashMovement', payload: { amount: monto, note: nota || 'Retiro desde Wybix' } },
      permiso: 'RETIROS_EGRESOS',
    }) });
  },

  async 'caja.cortes'(it) {
    const periodo = h.v(it, 'periodo');
    const r = h.rango(periodo === 'hoy' ? 'semana' : periodo);
    const cortes = await h.q(`
      SELECT TOP 10 c.id, c.closed_at, c.cash_expected, c.cash_delivered, c.difference, u.usuario
        FROM dbo.cash_closures c LEFT JOIN dbo.users u ON u.id = ISNULL(c.closed_by_user_id, c.userId)
       WHERE c.closed_at IS NOT NULL AND c.closed_at >= ${r.desde} AND c.closed_at < ${r.hasta}
       ORDER BY c.closed_at DESC;`);
    if (!cortes.length) return h.msg(`No hay cortes ${r.de}.`);
    const faltas = cortes.filter((c) => Number(c.difference) < -0.5);
    const suma = faltas.reduce((a, c) => a + Number(c.difference), 0);
    return h.msg(faltas.length
      ? `De ${h.plural(cortes.length, 'corte')} ${r.de}, ${faltas.length} salieron con faltante (${h.dinero(-suma)} en total).`
      : `Los ${h.plural(cortes.length, 'corte')} ${r.de} cuadraron.`, {
      datos: cortes.map((c) => ({ etiqueta: `${h.diaTexto(c.closed_at)}${c.usuario ? ` · ${c.usuario}` : ''}`,
                                  valor: Math.abs(Number(c.difference)) < 0.5 ? 'cuadró' : `${Number(c.difference) > 0 ? 'sobró' : 'faltó'} ${h.dinero(Math.abs(c.difference))}` })),
      tono: faltas.length ? 'atencion' : 'exito' });
  },

  async 'caja.turno'() {
    const t = await h.q(`
      SELECT c.register_id, ISNULL(r.name, CONCAT('Caja ', c.register_id)) AS caja, c.opened_at, c.opening_cash, u.usuario
        FROM dbo.cash_closures c LEFT JOIN dbo.registers r ON r.id = c.register_id
        LEFT JOIN dbo.users u ON u.id = ISNULL(c.opening_user_id, c.userId)
       WHERE c.closed_at IS NULL ORDER BY c.opened_at;`);
    if (!t.length) return h.msg('No hay ninguna caja abierta.');
    return h.msg(t.length === 1
      ? `${t[0].caja} está abierta desde las ${h.horaTexto(t[0].opened_at)}${t[0].usuario ? `, la abrió ${t[0].usuario}` : ''}, con ${h.dinero(t[0].opening_cash)} de fondo.`
      : `Hay ${t.length} cajas abiertas.`, {
      datos: t.length > 1 ? t.map((x) => ({ etiqueta: x.caja, valor: `desde ${h.horaTexto(x.opened_at)} · ${x.usuario || '—'} · fondo ${h.dinero(x.opening_cash)}` })) : [] });
  },

  async 'caja.corte'() {
    return h.ir('El corte se hace en su pantalla: cuentas el efectivo y Wybix lo compara con lo esperado. Te llevo.', '/dashboard/corte-dia');
  },
});
