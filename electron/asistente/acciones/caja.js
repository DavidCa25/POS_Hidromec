'use strict';
/* CAJA: el efectivo, las entradas y salidas, los cortes y el turno. */

/** El turno abierto de la caja, con lo que suman sus movimientos (misma regla que sp_close_shift). */
function turnoAbiertoDe(h, caja) {
  return h.uno(`
    SELECT TOP 1 c.id, c.opened_at, c.opening_cash, ISNULL(c.opening_user_id, c.userId) AS abrio, u.usuario,
           ISNULL(r.name, CONCAT('Caja ', c.register_id)) AS caja,
           (SELECT ISNULL(SUM(CASE WHEN m.typee = 'OPENING' THEN 0 ELSE m.amount END), 0) FROM dbo.cash_movements m
             WHERE m.closure_id = c.id OR (m.closure_id IS NULL AND m.register_id = c.register_id AND m.datee >= c.opened_at)) AS movimientos
      FROM dbo.cash_closures c LEFT JOIN dbo.registers r ON r.id = c.register_id
      LEFT JOIN dbo.users u ON u.id = ISNULL(c.opening_user_id, c.userId)
     WHERE c.closed_at IS NULL AND c.register_id = @caja ORDER BY c.opened_at DESC;`, [['caja', h.sql.Int, caja]]);
}

module.exports = (h) => {
  const turnoAbierto = (caja) => turnoAbiertoDe(h, caja);
  const nombreCaja = async (caja) => (await h.uno('SELECT name FROM dbo.registers WHERE id = @caja;', [['caja', h.sql.Int, caja]]))?.name || `Caja ${caja}`;
  return {
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

  /* CORTE: el efectivo contado contra lo esperado, con la misma suma que
     sp_close_shift (fondo + movimientos del turno). Cierra por el canal de
     siempre (sp-close-shift): el procedimiento vuelve a calcular, congela el
     ticket del corte y lo deja en bitácora. */
  async 'caja.corte'(it, ctx) {
    const caja = h.cajaEquipo();
    if (!caja) return h.ir('Este equipo todavía no tiene caja asignada. Te llevo a Corte para elegirla.', '/dashboard/corte-dia');
    const t = await turnoAbierto(caja);
    if (!t) return h.msg(`${await nombreCaja(caja)} no tiene turno abierto: no hay corte que hacer.`, {
      opciones: [{ etiqueta: 'Abrir la caja', intent: 'caja.abrir' }] });
    /* El turno de otra persona lo cierra un encargado con su PIN, en Corte. */
    if (Number(t.abrio) !== Number(ctx.userId)) {
      return h.ir(`Ese turno lo abrió ${t.usuario || 'otra persona'}: cerrarlo pide la autorización de un encargado. Te llevo a Corte.`, '/dashboard/corte-dia');
    }
    const contado = h.r2(h.v(it, 'monto'));
    if (!(contado >= 0)) return h.msg('Dime cuánto efectivo contaste en el cajón.');
    const esperado = h.r2(Number(t.opening_cash) + Number(t.movimientos));
    const diferencia = h.r2(contado - esperado);
    /* Corte ciego: quien no es encargado no ve lo esperado antes de cerrar
       (misma regla que la pantalla de Corte). */
    const ciego = !ctx.puede('VENTAS_SUPERVISAR') && !ctx.puede('CAJA_CORTES');
    const avisos = ['Un corte cerrado ya no se corrige. Lo contado incluye el fondo.'];
    const fondo = Number(t.opening_cash) || 0;
    if (fondo > 0 && Math.abs(contado + fondo - esperado) < 1) avisos.unshift(`¿Contaste también el fondo de ${h.dinero(fondo)}? Tiene que ir en lo contado.`);
    const vista = [{ etiqueta: 'Caja', valor: t.caja }, { etiqueta: 'Turno', valor: `desde ${h.horaTexto(t.opened_at)}` },
                   { etiqueta: 'Efectivo contado', valor: h.dinero(contado) }];
    if (!ciego) {
      vista.push({ etiqueta: 'Esperado', valor: h.dinero(esperado) },
                 { etiqueta: 'Diferencia', valor: Math.abs(diferencia) < 0.5 ? 'cuadra' : `${diferencia > 0 ? 'sobran' : 'faltan'} ${h.dinero(Math.abs(diferencia))}` });
    }
    return h.msg('Este corte voy a cerrar:', { plan: h.plan('caja.corte', {
      titulo: `Corte de ${t.caja} · ${h.dinero(contado)} contados`, vista, avisos,
      ejecutar: { api: 'electronAPI.closeShift', payload: { closure_id: Number(t.id), register_id: caja, cash_delivered: contado,
                                                             cash_left: null, note: 'Corte desde Wybix', blind: ciego } },
      permiso: 'VENTAS_OPERAR',
    }) });
  },

  async 'caja.abrir'(it) {
    const caja = h.cajaEquipo();
    if (!caja) return h.ir('Este equipo todavía no tiene caja asignada. Te llevo a Venta para elegirla y abrir el turno.', '/dashboard/venta');
    const t = await turnoAbierto(caja);
    if (t) return h.msg(`${t.caja} ya está abierta desde las ${h.horaTexto(t.opened_at)}${t.usuario ? `, la abrió ${t.usuario}` : ''}.`);
    const fondo = h.r2(h.v(it, 'monto'));
    if (!(fondo >= 0)) return h.msg('El fondo no puede ser negativo.');
    const nombre = await nombreCaja(caja);
    return h.msg('Así voy a abrir la caja:', { plan: h.plan('caja.abrir', {
      titulo: `Abrir ${nombre} · fondo ${h.dinero(fondo)}`,
      vista: [{ etiqueta: 'Caja', valor: nombre }, { etiqueta: 'Fondo inicial', valor: h.dinero(fondo) }],
      avisos: ['El fondo cuenta en el corte: al cerrar, lo contado lo incluye.'],
      ejecutar: { api: 'electronAPI.openShift', payload: { opening_cash: fondo, opening_note: 'Abierta desde Wybix', register_id: caja } },
      permiso: 'VENTAS_OPERAR',
    }) });
  },

  /* Abrir el cajón sin venta: lo autoriza un encargado (con aprobaciones
     activas) y queda en bitácora; el canal se encarga de las dos cosas. */
  async 'caja.cajon'(it, ctx) {
    const cajon = h.equipo().drawer;
    if (cajon && cajon.enabled === false) return h.msg('Este equipo no tiene cajón activado. Se activa en Configuración → Dispositivos.');
    return h.msg('Voy a abrir el cajón:', { plan: h.plan('caja.cajon', {
      titulo: 'Abrir el cajón',
      vista: [{ etiqueta: 'Motivo', valor: 'Apertura sin venta' }],
      avisos: ['Queda en la bitácora como apertura sin venta.'],
      nivel: ctx.puede('CAJON_SIN_VENTA') ? 'confirmar' : 'autorizar',
      ejecutar: { api: 'electronAPI.openCashDrawer', payload: { reason: 'manual' } },
      permiso: 'VENTAS_OPERAR',
    }) });
  },

  async 'caja.corte_correo'() {
    const caja = h.cajaEquipo();
    const c = await h.uno(`
      SELECT TOP 1 c.id, c.closed_at, c.cash_delivered, c.difference, ISNULL(r.name, CONCAT('Caja ', c.register_id)) AS caja
        FROM dbo.cash_closures c LEFT JOIN dbo.registers r ON r.id = c.register_id
       WHERE c.closed_at IS NOT NULL AND (@caja IS NULL OR c.register_id = @caja)
       ORDER BY c.closed_at DESC;`, [['caja', h.sql.Int, caja]]);
    if (!c) return h.msg('Todavía no hay cortes cerrados que mandar.');
    return h.msg('Este corte voy a mandar por correo:', { plan: h.plan('caja.corte_correo', {
      titulo: `Mandar por correo el corte de ${c.caja}`,
      vista: [{ etiqueta: 'Corte', valor: `${h.diaTexto(c.closed_at)} ${h.horaTexto(c.closed_at)}` }, { etiqueta: 'Caja', valor: c.caja },
              { etiqueta: 'Contado', valor: h.dinero(c.cash_delivered) },
              { etiqueta: 'Diferencia', valor: Math.abs(Number(c.difference)) < 0.5 ? 'cuadró' : h.dinero(c.difference) }],
      avisos: ['Va a los correos configurados en Corte → Correo. La caja tiene que estar vinculada con la nube.'],
      ejecutar: { api: 'electronAPI.corteCorreoEnviar', payload: { closureId: Number(c.id) } },
      permiso: 'CAJA_CORTES',
    }) });
  },
  };
};
