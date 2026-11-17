'use strict';
/* SERVICIOS: agenda (ver, agendar, cancelar, mover, huecos), profesionales,
   membresías y órdenes de servicio. */

module.exports = (h) => {
  /** «2026-11-15T17:00:00» en hora local: así lo lee el canal de citas. */
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
  const profesionales = () => h.q('SELECT id, full_name AS nombre FROM dbo.professionals WHERE active = 1 ORDER BY full_name;');
  const citasDel = (fecha, profId = null) => h.q(`
    SELECT a.id, a.starts_at, a.ends_at, a.status, a.professional_id, c.customerName AS cliente, pr.full_name AS profesional, p.nombre AS servicio
      FROM dbo.appointments a
      LEFT JOIN dbo.customers c ON c.id = a.customer_id
      LEFT JOIN dbo.professionals pr ON pr.id = a.professional_id
      LEFT JOIN dbo.products p ON p.id = a.service_product_id
     WHERE CAST(a.starts_at AS DATE) = @f AND a.status IN ('AGENDADA', 'CONFIRMADA', 'ATENDIDA')
       AND (@pr IS NULL OR a.professional_id = @pr)
     ORDER BY a.starts_at;`, [['f', h.sql.Date, fecha], ['pr', h.sql.Int, profId]]);
  const proximaDe = (clienteId) => h.uno(`
    SELECT TOP 1 a.id, a.starts_at, a.ends_at, a.professional_id, pr.full_name AS profesional, p.nombre AS servicio
      FROM dbo.appointments a LEFT JOIN dbo.professionals pr ON pr.id = a.professional_id LEFT JOIN dbo.products p ON p.id = a.service_product_id
     WHERE a.customer_id = @id AND a.status IN ('AGENDADA', 'CONFIRMADA') AND a.starts_at >= CAST(GETDATE() AS DATE)
     ORDER BY a.starts_at;`, [h.id(clienteId)]);
  const encima = (profId, desde, hasta, sinId = 0) => h.uno(`
    SELECT TOP 1 a.starts_at, c.customerName AS cliente FROM dbo.appointments a LEFT JOIN dbo.customers c ON c.id = a.customer_id
     WHERE a.professional_id = @pr AND a.id <> @sin AND a.status IN ('AGENDADA', 'CONFIRMADA')
       AND a.starts_at < @hasta AND a.ends_at > @desde;`,
  [['pr', h.sql.Int, profId], ['sin', h.sql.Int, sinId], ['desde', h.sql.DateTime2, desde], ['hasta', h.sql.DateTime2, hasta]]);
  const cuandoTexto = (d) => `${h.diaTexto(d)} a las ${h.horaTexto(d)}`;

  /** Pregunta por un dato que el intent no exige siempre (profesional, hora). */
  const pedir = (it, falta, texto, opciones = []) => h.msg(texto, {
    opciones: opciones.map((o) => ({ etiqueta: o.etiqueta, texto: o.etiqueta })),
    esperando: { intent: it.intent, slots: { ...it.slots, [falta]: { valor: null, confianza: 'dudoso', opciones } }, falta } });

  return {
    async 'cita.lista'(it) {
      const fecha = h.v(it, 'fecha') || h.hoyIso();
      const citas = await citasDel(fecha, h.v(it, 'profesional'));
      const cuando = fecha === h.hoyIso() ? 'hoy' : `el ${h.diaTexto(h.cuando(fecha))}`;
      const de = it.slots.profesional?.texto ? ` de ${it.slots.profesional.texto}` : '';
      if (!citas.length) return h.msg(`No hay citas${de} ${cuando}.`);
      const pendientes = citas.filter((c) => c.status !== 'ATENDIDA');
      return h.msg(`${cuando[0].toUpperCase()}${cuando.slice(1)} hay ${h.plural(citas.length, 'cita')}${de} (${pendientes.length} por atender).`, {
        datos: citas.map((c) => ({ etiqueta: `${h.horaTexto(c.starts_at)} · ${c.cliente || 'Sin cliente'}`,
                                   valor: `${c.servicio || 'servicio'}${c.profesional ? ` · ${c.profesional}` : ''}${c.status === 'ATENDIDA' ? ' · atendida' : c.status === 'CONFIRMADA' ? ' · confirmada' : ''}` })),
        opciones: [{ etiqueta: 'Abrir agenda', intent: 'ir_a', params: { ruta: '/dashboard/agenda', etiqueta: 'Agenda' } }] });
    },

    async 'cita.agendar'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      const serv = await h.uno(`
        SELECT p.id, p.nombre, ISNULL(s.duration_minutes, 60) AS minutos, ISNULL(s.requires_professional, 0) AS requiere
          FROM dbo.products p LEFT JOIN dbo.services s ON s.product_id = p.id WHERE p.id = @id;`, [h.id(h.v(it, 'servicio'))]);
      if (!c || !serv) return h.msg('No encontré el cliente o el servicio.');
      let profId = h.v(it, 'profesional');
      if (!profId && serv.requiere) {
        const pros = await profesionales();
        return pedir(it, 'profesional', `¿Con quién? ${serv.nombre} necesita profesional.`, pros.map((p) => ({ etiqueta: p.nombre, valor: p.id })));
      }
      const desde = h.cuando(h.v(it, 'fecha'), h.v(it, 'hora'));
      const hasta = new Date(desde.getTime() + Number(serv.minutos) * 60000);
      if (desde.getTime() < Date.now() - 5 * 60000) return h.msg(`Esa hora (${cuandoTexto(desde)}) ya pasó. ¿Para cuándo?`);
      const avisos = [];
      if (profId) {
        const choque = await encima(profId, desde, hasta);
        if (choque) avisos.push(`${it.slots.profesional.texto} ya tiene a ${choque.cliente || 'alguien'} a las ${h.horaTexto(choque.starts_at)}: se encimaría y no se va a poder.`);
      }
      return h.msg('Esta cita voy a agendar:', { plan: h.plan('cita.agendar', {
        titulo: `Cita · ${c.nombre} · ${cuandoTexto(desde)}`,
        vista: [{ etiqueta: 'Cliente', valor: c.nombre }, { etiqueta: 'Servicio', valor: `${serv.nombre} · ${serv.minutos} min` },
                { etiqueta: 'Cuándo', valor: `${cuandoTexto(desde)} – ${h.horaTexto(hasta)}` },
                { etiqueta: 'Con', valor: it.slots.profesional?.texto || 'sin profesional' }],
        avisos,
        ejecutar: { api: 'electronAPI.serviciosCitaGuardar', payload: { clienteId: c.id, profesionalId: profId ?? null, servicioId: serv.id,
                                                                        desde: local(desde), hasta: local(hasta), notas: 'Agendada desde Wybix' } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'cita.cancelar'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré ese cliente.');
      const a = await proximaDe(c.id);
      if (!a) return h.msg(`${c.nombre} no tiene citas próximas.`);
      return h.msg('Esta cita voy a cancelar:', { plan: h.plan('cita.cancelar', {
        titulo: `Cancelar cita · ${c.nombre}`,
        vista: [{ etiqueta: 'Cuándo', valor: cuandoTexto(a.starts_at) }, { etiqueta: 'Servicio', valor: a.servicio || '—' }, { etiqueta: 'Con', valor: a.profesional || '—' }],
        avisos: ['El horario queda libre en la agenda.'],
        ejecutar: { api: 'electronAPI.serviciosCitaEstado', payload: { id: a.id, estado: 'CANCELADA', notas: 'Cancelada desde Wybix' } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'cita.mover'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré ese cliente.');
      const a = await proximaDe(c.id);
      if (!a) return h.msg(`${c.nombre} no tiene citas próximas para mover.`);
      const fecha = h.v(it, 'fecha'), hora = h.v(it, 'hora');
      if (!fecha && !hora) return pedir(it, 'hora', `${c.nombre} tiene cita el ${cuandoTexto(a.starts_at)}. ¿A qué hora (o qué día) la paso?`);
      const antes = new Date(a.starts_at);
      const dur = new Date(a.ends_at).getTime() - antes.getTime();
      const dia = fecha || `${antes.getFullYear()}-${String(antes.getMonth() + 1).padStart(2, '0')}-${String(antes.getDate()).padStart(2, '0')}`;
      const desde = h.cuando(dia, hora || { h: antes.getHours(), m: antes.getMinutes() });
      const hasta = new Date(desde.getTime() + dur);
      const profId = h.v(it, 'profesional') ?? a.professional_id;
      const avisos = [];
      if (profId) { const choque = await encima(profId, desde, hasta, a.id); if (choque) avisos.push(`A esa hora ya hay cita con ${choque.cliente || 'alguien'}: se encimaría y no se va a poder.`); }
      return h.msg('Así voy a mover la cita:', { plan: h.plan('cita.mover', {
        titulo: `Mover cita · ${c.nombre}`,
        vista: [{ etiqueta: 'Antes', valor: cuandoTexto(antes) }, { etiqueta: 'Ahora', valor: cuandoTexto(desde) }, { etiqueta: 'Servicio', valor: a.servicio || '—' }],
        avisos,
        ejecutar: { api: 'electronAPI.serviciosCitaReprogramar', payload: { id: a.id, desde: local(desde), hasta: local(hasta), profesionalId: profId ?? null, motivo: 'Cambio pedido a Wybix' } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'cita.libre'(it) {
      const fecha = h.v(it, 'fecha') || h.hoyIso();
      const hora = h.v(it, 'hora');
      const pros = h.v(it, 'profesional') ? [{ id: h.v(it, 'profesional'), nombre: it.slots.profesional.texto }] : await profesionales();
      if (!pros.length) return h.msg('No hay profesionales dados de alta.');
      const citas = await citasDel(fecha);
      const ocupado = (pid, ini, fin) => citas.some((c) => c.professional_id === pid && c.status !== 'ATENDIDA'
        && Date.parse(c.starts_at) < fin.getTime() && Date.parse(c.ends_at) > ini.getTime());
      const cuando = fecha === h.hoyIso() ? 'hoy' : `el ${h.diaTexto(h.cuando(fecha))}`;
      if (hora) {
        const ini = h.cuando(fecha, hora), fin = new Date(ini.getTime() + 60 * 60000);
        const libres = pros.filter((p) => !ocupado(p.id, ini, fin));
        return h.msg(libres.length ? `${cuando} a las ${h.horaTexto(ini)} ${libres.length === pros.length ? 'están todos libres' : `está libre ${libres.map((p) => p.nombre).join(', ')}`}.`
                                   : `${cuando} a las ${h.horaTexto(ini)} no hay nadie libre.`, { tono: libres.length ? 'exito' : 'atencion' });
      }
      /* Horas libres (bloques de 1 h entre 9 y 20) por profesional. */
      const ahora = Date.now();
      const datos = pros.map((p) => {
        const horas = [];
        for (let hh = 9; hh < 20; hh++) {
          const ini = h.cuando(fecha, { h: hh, m: 0 }), fin = new Date(ini.getTime() + 3600000);
          if (ini.getTime() > ahora && !ocupado(p.id, ini, fin)) horas.push(`${hh}:00`);
        }
        return { etiqueta: p.nombre, valor: horas.length ? horas.slice(0, 8).join(' · ') : 'sin espacio' };
      });
      return h.msg(`Espacios libres ${cuando}:`, { datos });
    },

    async 'servicios.profesional'(it) {
      const r = h.rango(h.v(it, 'periodo') === 'hoy' ? 'semana' : h.v(it, 'periodo'));
      const pid = h.v(it, 'profesional');
      const filas = await h.q(`
        SELECT pr.id, pr.full_name AS nombre,
               (SELECT COUNT(*) FROM dbo.appointments a WHERE a.professional_id = pr.id AND a.status = 'ATENDIDA' AND a.starts_at >= ${r.desde} AND a.starts_at < ${r.hasta}) AS atendidas,
               (SELECT ISNULL(SUM(sc.base_amount), 0) FROM dbo.service_commissions sc WHERE sc.professional_id = pr.id AND sc.earned_at >= ${r.desde} AND sc.earned_at < ${r.hasta}) AS generado,
               (SELECT ISNULL(SUM(sc.amount), 0) FROM dbo.service_commissions sc WHERE sc.professional_id = pr.id AND sc.earned_at >= ${r.desde} AND sc.earned_at < ${r.hasta}) AS comision
          FROM dbo.professionals pr WHERE pr.active = 1 AND (@pr IS NULL OR pr.id = @pr)
         ORDER BY generado DESC;`, [['pr', h.sql.Int, pid]]);
      if (!filas.length) return h.msg('No hay profesionales dados de alta.');
      if (pid) {
        const f = filas[0];
        return h.msg(`${r.nombre} ${f.nombre} generó ${h.dinero(f.generado)} y lleva ${h.dinero(f.comision)} de comisión (${h.plural(f.atendidas, 'cita')} atendida${f.atendidas === 1 ? '' : 's'}).`);
      }
      return h.msg(`${r.nombre} quien más generó fue ${filas[0].nombre}.`, {
        datos: filas.map((f) => ({ etiqueta: f.nombre, valor: `${h.dinero(f.generado)} · comisión ${h.dinero(f.comision)} · ${f.atendidas} citas` })) });
    },

    async 'membresia.vencer'() {
      const filas = await h.q(`
        SELECT c.customerName AS cliente, ISNULL(c.mobile, c.phone) AS tel, p.name AS plan_nombre, m.paid_until
          FROM dbo.customer_memberships m JOIN dbo.customers c ON c.id = m.customer_id JOIN dbo.membership_plans p ON p.id = m.plan_id
         WHERE m.status = 'ACTIVE' AND m.paid_until < DATEADD(DAY, 8, CAST(GETDATE() AS DATE))
         ORDER BY m.paid_until;`);
      if (!filas.length) return h.msg('Ninguna membresía vence en los próximos 7 días.', { tono: 'exito' });
      const hoy = h.hoyIso();
      const vencidas = filas.filter((f) => new Date(f.paid_until).toISOString().slice(0, 10) < hoy);
      return h.msg(`${h.plural(filas.length, 'membresía')} por renovar${vencidas.length ? ` (${vencidas.length} ya vencida${vencidas.length === 1 ? '' : 's'})` : ''}:`, {
        datos: filas.map((f) => ({ etiqueta: `${f.cliente} · ${f.plan_nombre}`, valor: `${new Date(f.paid_until).toISOString().slice(0, 10) < hoy ? 'venció' : 'vence'} ${h.fechaCorta(new Date(f.paid_until).toISOString())}${f.tel ? ` · ${f.tel}` : ''}` })),
        tono: vencidas.length ? 'atencion' : 'normal' });
    },

    async 'orden.pendientes'() {
      const filas = await h.q(`
        SELECT o.folio, o.status, o.promised_at, o.reported_issue, c.customerName AS cliente
          FROM dbo.service_orders o LEFT JOIN dbo.customers c ON c.id = o.customer_id
         WHERE o.status NOT IN ('ENTREGADA', 'CANCELADA') ORDER BY ISNULL(o.promised_at, '9999-12-31'), o.opened_at;`);
      if (!filas.length) return h.msg('No hay órdenes de servicio abiertas.', { tono: 'exito' });
      const atrasadas = filas.filter((f) => f.promised_at && Date.parse(f.promised_at) < Date.now());
      return h.msg(`Hay ${h.plural(filas.length, 'orden', 'órdenes')} abierta${filas.length === 1 ? '' : 's'}${atrasadas.length ? `, ${atrasadas.length} pasada${atrasadas.length === 1 ? '' : 's'} de la fecha prometida` : ''}.`, {
        datos: filas.slice(0, 10).map((f) => ({ etiqueta: `${f.folio || 'Orden'} · ${f.cliente || 'Sin cliente'}`,
                                               valor: `${String(f.status).toLowerCase()}${f.promised_at ? ` · para el ${h.fechaCorta(new Date(f.promised_at).toISOString())}` : ''}` })),
        opciones: [{ etiqueta: 'Abrir órdenes', intent: 'ir_a', params: { ruta: '/dashboard/ordenes-de-servicio', etiqueta: 'Órdenes de servicio' } }],
        tono: atrasadas.length ? 'atencion' : 'normal' });
    },
  };
};
