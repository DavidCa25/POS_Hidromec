'use strict';
/* SERVICIOS: agenda (ver, agendar, cancelar, mover, huecos), profesionales,
   membresías y órdenes de servicio. */

module.exports = (h) => {
  /* ------------------------------------------------ ayudas de órdenes */
  const ESTADO_ORDEN = { BORRADOR: 'borrador', ABIERTA: 'abierta', EN_PROCESO: 'en proceso', TERMINADA: 'terminada', ENTREGADA: 'entregada', CANCELADA: 'cancelada' };
  /** La orden con su testigo de versión (0x…): el canal rechaza si alguien la cambió después. */
  const orden = (id) => h.uno(`
    SELECT o.id, o.folio, o.status, o.customer_id, c.customerName AS cliente, o.customer_asset_id, o.reported_issue, o.diagnosis,
           o.promised_at, o.notes, CONVERT(VARCHAR(18), o.rowver, 1) AS rowver
      FROM dbo.service_orders o LEFT JOIN dbo.customers c ON c.id = o.customer_id WHERE o.id = @id;`, [h.id(id)]);
  const noOrden = (id) => h.msg(`No encuentro la orden ${id}.`);
  const local0 = (iso, dias = 0) => { const [y, m, d] = String(iso).split('-').map(Number); const x = new Date(y, m - 1, d + dias); return local(x); };
  const DIA = ['', 'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

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

    /* ============================================== ÓRDENES DE SERVICIO */
    async 'orden.crear'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré a ese cliente.');
      const reportado = h.v(it, 'reportado');
      return h.msg('Esta orden voy a abrir:', { plan: h.plan('orden.crear', {
        titulo: `Orden nueva · ${c.nombre}`,
        vista: [{ etiqueta: 'Cliente', valor: c.nombre }, { etiqueta: 'Lo que reporta', valor: reportado || '— (lo anotas después)' }],
        ejecutar: { api: 'electronAPI.serviciosOrdenCrear', payload: { clienteId: c.id, activoId: null, reportado: reportado || null, prometidaPara: null,
                                                                        notas: null, cajaId: h.cajaEquipo(), estado: 'ABIERTA' } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'orden.estado'(it) {
      const o = await orden(h.v(it, 'folio'));
      if (!o) return noOrden(h.v(it, 'folio'));
      const estado = h.v(it, 'estado');
      if (o.status === estado) return h.msg(`La orden ${o.folio} ya está ${ESTADO_ORDEN[estado]}.`);
      if (o.status === 'CANCELADA' || o.status === 'ENTREGADA') return h.msg(`La orden ${o.folio} ya está ${ESTADO_ORDEN[o.status]}: no cambia.`);
      const avisos = estado === 'ENTREGADA' ? ['Para entregarla tiene que estar cobrada (o registrada a crédito).']
        : estado === 'TERMINADA' ? ['Necesita al menos un renglón marcado como hecho.'] : [];
      return h.msg('Esto voy a cambiar:', { plan: h.plan('orden.estado', {
        titulo: `Orden ${o.folio} · ${ESTADO_ORDEN[estado]}`,
        vista: [{ etiqueta: 'Cliente', valor: o.cliente || '—' }, { etiqueta: 'Estado', valor: `${ESTADO_ORDEN[o.status]} → ${ESTADO_ORDEN[estado]}` }],
        avisos, ejecutar: { api: 'electronAPI.serviciosOrdenEstado', payload: { id: Number(o.id), estado, rowver: o.rowver } }, permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'orden.autorizar'(it) {
      const o = await orden(h.v(it, 'folio'));
      if (!o) return noOrden(h.v(it, 'folio'));
      const quien = h.v(it, 'autoriza') || o.cliente || 'El cliente';
      const via = h.v(it, 'via') || 'MOSTRADOR';
      return h.msg('Esta autorización voy a registrar:', { plan: h.plan('orden.autorizar', {
        titulo: `Orden ${o.folio} autorizada`,
        vista: [{ etiqueta: 'Autoriza', valor: quien }, { etiqueta: 'Por', valor: { TELEFONO: 'teléfono', WHATSAPP: 'WhatsApp', MOSTRADOR: 'en mostrador' }[via] || via }],
        avisos: ['Queda autorizado el presupuesto de ahora: si después se agrega algo, se vuelve a pedir.'],
        ejecutar: { api: 'electronAPI.serviciosOrdenAutorizar', payload: { id: Number(o.id), autorizaNombre: quien, via, rowver: o.rowver } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'orden.cancelar'(it) {
      const o = await orden(h.v(it, 'folio'));
      if (!o) return noOrden(h.v(it, 'folio'));
      if (o.status === 'CANCELADA') return h.msg(`La orden ${o.folio} ya estaba cancelada.`);
      const motivo = h.v(it, 'motivo');
      if (!motivo) return h.msg('¿Por qué se cancela?', { esperando: { intent: it.intent, slots: it.slots, falta: 'motivo' } });
      return h.msg('Esta orden voy a cancelar:', { plan: h.plan('orden.cancelar', {
        titulo: `Cancelar la orden ${o.folio}`,
        vista: [{ etiqueta: 'Cliente', valor: o.cliente || '—' }, { etiqueta: 'Motivo', valor: motivo }],
        ejecutar: { api: 'electronAPI.serviciosOrdenCancelar', payload: { id: Number(o.id), motivo, rowver: o.rowver } }, permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'orden.diagnostico'(it) {
      const o = await orden(h.v(it, 'folio'));
      if (!o) return noOrden(h.v(it, 'folio'));
      const diagnostico = h.v(it, 'diagnostico');
      return h.msg('Esto voy a anotar:', { plan: h.plan('orden.diagnostico', {
        titulo: `Diagnóstico de la orden ${o.folio}`,
        vista: [{ etiqueta: 'Diagnóstico', valor: `${o.diagnosis ? `«${o.diagnosis}» → ` : ''}«${diagnostico}»` }],
        ejecutar: { api: 'electronAPI.serviciosOrdenActualizar', payload: { id: Number(o.id), activoId: o.customer_asset_id, reportado: o.reported_issue,
                                                                             diagnostico, prometidaPara: o.promised_at, notas: o.notes, rowver: o.rowver } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'orden.linea'(it) {
      const o = await orden(h.v(it, 'folio'));
      if (!o) return noOrden(h.v(it, 'folio'));
      const p = await h.producto(h.v(it, 'producto'));
      if (!p) return h.msg('No encontré ese producto o servicio.');
      const n = Number(h.v(it, 'cantidad')) || 1;
      const avisos = o.status === 'ABIERTA' || o.status === 'EN_PROCESO' ? ['Cambia el presupuesto: si ya estaba autorizado, hay que volver a pedir la autorización.'] : [];
      return h.msg('Esto voy a agregar:', { plan: h.plan('orden.linea', {
        titulo: `Orden ${o.folio} · ${h.num(n)} × ${p.nombre}`,
        vista: [{ etiqueta: `${h.num(n)} × ${p.nombre}`, valor: `${h.dinero(p.price)} c/u · ${h.dinero(Number(p.price) * n)}` }, { etiqueta: 'Cliente', valor: o.cliente || '—' }],
        avisos,
        ejecutar: { api: 'electronAPI.serviciosLineaAgregar', payload: { ordenId: Number(o.id), productoId: p.id, cantidad: n, profesionalId: null,
                                                                          precio: Number(p.price), comisionPct: null, notas: null } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    async 'orden.linea_cambiar'(it) {
      const o = await orden(h.v(it, 'folio'));
      if (!o) return noOrden(h.v(it, 'folio'));
      const l = await h.uno(`SELECT TOP 1 id, name_snapshot AS nombre, quantity, unit_price_snapshot AS precio, professional_id, commission_pct_snapshot AS comision, status, notes
                              FROM dbo.service_order_lines WHERE order_id = @o AND product_id = @p AND status <> 'CANCELADA' ORDER BY line_no;`,
        [['o', h.sql.Int, o.id], ['p', h.sql.Int, h.v(it, 'producto')]]);
      if (!l) return h.msg(`La orden ${o.folio} no tiene ese renglón.`);
      const estado = h.v(it, 'estado'), precio = h.v(it, 'precio');
      const ESTADO_LINEA = { PENDIENTE: 'pendiente', EN_PROCESO: 'en proceso', HECHA: 'hecha', CANCELADA: 'cancelada' };
      const vista = estado ? [{ etiqueta: l.nombre, valor: `${ESTADO_LINEA[l.status] || l.status} → ${ESTADO_LINEA[estado]}` }]
        : [{ etiqueta: `${l.nombre} (precio)`, valor: `${h.dinero(l.precio)} → ${h.dinero(precio)}` }];
      return h.msg('Esto voy a cambiar:', { plan: h.plan('orden.linea_cambiar', {
        titulo: `Orden ${o.folio} · ${l.nombre}`, vista,
        ejecutar: { api: 'electronAPI.serviciosLineaActualizar', payload: { lineaId: Number(l.id), cantidad: Number(l.quantity), precio: precio ?? Number(l.precio),
                                                                             profesionalId: l.professional_id, comisionPct: l.comision, estado: estado || l.status, notas: l.notes } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    /* «Llegó doña Mary a su cita»: la cita de hoy pasa a orden. */
    async 'cita.orden'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré a ese cliente.');
      const a = await h.uno(`SELECT TOP 1 a.id, a.starts_at, p.nombre AS servicio FROM dbo.appointments a LEFT JOIN dbo.products p ON p.id = a.service_product_id
                              WHERE a.customer_id = @c AND a.service_order_id IS NULL AND a.status NOT IN ('CANCELADA', 'NO_ASISTIO')
                                AND CAST(a.starts_at AS DATE) = CAST(GETDATE() AS DATE) ORDER BY a.starts_at;`, [['c', h.sql.Int, c.id]]).catch(() => null);
      if (!a) return h.msg(`${c.nombre} no tiene cita hoy pendiente de atender.`);
      return h.msg('Esta cita voy a pasar a orden:', { plan: h.plan('cita.orden', {
        titulo: `Atender a ${c.nombre}`,
        vista: [{ etiqueta: 'Cita', valor: `${h.horaTexto(a.starts_at)}${a.servicio ? ' · ' + a.servicio : ''}` }, { etiqueta: 'Cliente', valor: c.nombre }],
        avisos: ['Se abre la orden con el servicio de la cita; ahí se cobra.'],
        ejecutar: { api: 'electronAPI.serviciosCitaAOrden', payload: { id: Number(a.id), cajaId: h.cajaEquipo() } }, permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    /* =================================== CATÁLOGO DE SERVICIOS Y GIRO */
    async 'servicio.crear'(it) {
      const nombre = String(h.v(it, 'nombre') || '').trim();
      if (!nombre) return h.msg('¿Cómo se llama el servicio?');
      const ya = await h.uno('SELECT TOP 1 nombre FROM dbo.products WHERE nombre = @n AND active = 1;', [['n', h.sql.NVarChar(100), nombre]]);
      if (ya) return h.msg(`Ya existe «${ya.nombre}».`);
      const precio = h.v(it, 'precio'), dur = h.v(it, 'duracion');
      return h.msg('Este servicio voy a crear:', { plan: h.plan('servicio.crear', {
        titulo: `Servicio nuevo · ${nombre}`,
        vista: [{ etiqueta: 'Servicio', valor: nombre }, { etiqueta: 'Precio', valor: precio != null ? h.dinero(precio) : 'sin precio (se pone después)' },
                { etiqueta: 'Duración', valor: dur ? `${dur} minutos` : 'la de siempre' }],
        ejecutar: { api: 'electronAPI.serviciosGuardarServicio', payload: { productId: null, nombre, precio: precio ?? 0, clave: null, categoriaId: null,
          claveProdServ: null, claveUnidad: null, tasaIva: null, duracionMinutos: dur ?? null, requiereProfesional: true, comisionPct: null, agendable: true, notas: null } },
        permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },

    async 'servicio.activar'(it) {
      const s = await h.uno('SELECT p.id, p.nombre, p.active FROM dbo.services s JOIN dbo.products p ON p.id = s.product_id WHERE s.product_id = @id;', [h.id(h.v(it, 'producto'))]);
      if (!s) return h.msg('Ese no es un servicio del catálogo.');
      const activo = !!h.v(it, 'activo');
      if (!!s.active === activo) return h.msg(`«${s.nombre}» ya está ${activo ? 'activo' : 'desactivado'}.`);
      return h.msg('Esto voy a cambiar:', { plan: h.plan('servicio.activar', {
        titulo: `${activo ? 'Activar' : 'Desactivar'} «${s.nombre}»`, vista: [{ etiqueta: 'Estado', valor: `${s.active ? 'activo' : 'desactivado'} → ${activo ? 'activo' : 'desactivado'}` }],
        avisos: activo ? [] : ['Deja de ofrecerse en la agenda y en Venta; lo ya registrado se queda.'],
        ejecutar: { api: 'electronAPI.serviciosActivarServicio', payload: { productId: s.id, activo } }, permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },

    async 'servicio.giro'(it) {
      const preset = h.v(it, 'preset');
      const nombres = { TALLER_AUTOMOTRIZ: 'Taller automotriz', BELLEZA: 'Belleza y barbería', REPARACION_ELECTRONICA: 'Reparación de electrónicos', MANTENIMIENTO: 'Mantenimiento y servicios técnicos' };
      return h.msg('Así voy a configurar Servicios:', { plan: h.plan('servicio.giro', {
        titulo: `Giro de servicios · ${nombres[preset] || preset}`, vista: [{ etiqueta: 'Giro', valor: nombres[preset] || preset }],
        avisos: ['Cambia cómo se llaman las cosas (orden, cita, vehículo, mascota) y enciende lo que ese giro usa.'],
        ejecutar: { api: 'electronAPI.serviciosElegirGiro', args: [preset] }, permiso: 'CONFIGURACION_ADMINISTRAR',
      }) });
    },

    async 'activo.crear'(it) {
      const c = await h.cliente(h.v(it, 'cliente'));
      if (!c) return h.msg('No encontré a ese cliente.');
      const clase = h.v(it, 'clase') || 'OTRO', etiqueta = h.v(it, 'etiqueta'), ident = h.v(it, 'identificador'), anio = h.v(it, 'anio');
      const nombreClase = { VEHICULO: 'Vehículo', MASCOTA: 'Mascota', EQUIPO: 'Equipo', INMUEBLE: 'Inmueble', OTRO: 'Otro' }[clase];
      return h.msg('Esto voy a registrar:', { plan: h.plan('activo.crear', {
        titulo: `${nombreClase} de ${c.nombre}`,
        vista: [{ etiqueta: nombreClase, valor: etiqueta || '—' }, ...(ident ? [{ etiqueta: 'Placas / identificador', valor: ident }] : []),
                ...(anio ? [{ etiqueta: 'Año', valor: String(anio) }] : []), { etiqueta: 'Cliente', valor: c.nombre }],
        ejecutar: { api: 'electronAPI.serviciosGuardarActivo', payload: { id: null, clienteId: c.id, clase, etiqueta: etiqueta || nombreClase, identificador: ident,
                                                                           identificadorDos: null, marca: null, modelo: null, anioOEdad: anio, color: null, notas: null } },
        permiso: 'SERVICIOS_OPERAR',
      }) });
    },

    /* ==================================================== PROFESIONALES */
    async 'profesional.alta'(it) {
      const nombre = String(h.v(it, 'nombre') || '').trim();
      if (!nombre) return h.msg('¿Cómo se llama?');
      const ya = await h.uno('SELECT TOP 1 full_name, active FROM dbo.professionals WHERE full_name = @n;', [['n', h.sql.NVarChar(120), nombre]]);
      if (ya) return h.msg(ya.active ? `${ya.full_name} ya está en la lista de profesionales.` : `${ya.full_name} existe pero está desactivado: dime «activa a ${ya.full_name}».`);
      const puesto = h.v(it, 'puesto');
      return h.msg('Así lo voy a registrar:', { plan: h.plan('profesional.alta', {
        titulo: `Profesional nuevo · ${nombre}`, vista: [{ etiqueta: 'Nombre', valor: nombre }, ...(puesto ? [{ etiqueta: 'Puesto', valor: puesto }] : [])],
        avisos: ['Después dime qué servicios hace y su horario: «Laura hace cortes», «Laura trabaja de lunes a viernes de 9 a 6».'],
        ejecutar: { api: 'electronAPI.serviciosGuardarProfesional', payload: { id: null, nombre, puesto: puesto || null, telefono: null, email: null, usuarioId: null, comisionPct: null, color: null } },
        permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },

    async 'profesional.activar'(it) {
      const p = await h.uno('SELECT id, full_name AS nombre, active FROM dbo.professionals WHERE id = @id;', [h.id(h.v(it, 'profesional'))]);
      if (!p) return h.msg('No encontré a esa persona.');
      const activo = !!h.v(it, 'activo');
      if (!!p.active === activo) return h.msg(`${p.nombre} ya está ${activo ? 'activo' : 'desactivado'}.`);
      const citas = activo ? null : await h.uno(`SELECT COUNT(*) AS n FROM dbo.appointments WHERE professional_id = @id AND starts_at >= GETDATE() AND status NOT IN ('CANCELADA', 'NO_ASISTIO');`, [h.id(p.id)]).catch(() => null);
      return h.msg('Esto voy a cambiar:', { plan: h.plan('profesional.activar', {
        titulo: `${activo ? 'Activar' : 'Desactivar'} a ${p.nombre}`, vista: [{ etiqueta: 'Estado', valor: `${p.active ? 'activo' : 'desactivado'} → ${activo ? 'activo' : 'desactivado'}` }],
        avisos: citas?.n ? [`Tiene ${citas.n} cita(s) próximas: muévelas o cancélalas.`] : [],
        ejecutar: { api: 'electronAPI.serviciosActivarProfesional', payload: { id: p.id, activo } }, permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },

    /* «Laura hace cortes»: la lista de quién hace ese servicio, con ella (o sin ella). */
    async 'profesional.servicio'(it) {
      const prof = await h.uno('SELECT id, full_name AS nombre FROM dbo.professionals WHERE id = @id;', [h.id(h.v(it, 'profesional'))]);
      const s = await h.uno('SELECT p.id, p.nombre FROM dbo.services s JOIN dbo.products p ON p.id = s.product_id WHERE s.product_id = @id;', [h.id(h.v(it, 'producto'))]);
      if (!prof || !s) return h.msg(!prof ? 'No encontré a esa persona.' : 'Ese no es un servicio del catálogo.');
      const lista = await h.q('SELECT professional_id, commission_pct FROM dbo.service_professionals WHERE service_product_id = @id;', [h.id(s.id)]);
      const quitar = !!h.v(it, 'quitar');
      const tiene = lista.some((x) => x.professional_id === prof.id);
      if (quitar && !tiene) return h.msg(`${prof.nombre} no está en «${s.nombre}».`);
      if (!quitar && tiene) return h.msg(`${prof.nombre} ya hace «${s.nombre}».`);
      const nueva = quitar ? lista.filter((x) => x.professional_id !== prof.id) : [...lista, { professional_id: prof.id, commission_pct: null }];
      return h.msg('Esto voy a cambiar:', { plan: h.plan('profesional.servicio', {
        titulo: `${prof.nombre} ${quitar ? 'deja de hacer' : 'hace'} «${s.nombre}»`,
        vista: [{ etiqueta: s.nombre, valor: `${lista.length} → ${nueva.length} profesional(es)` }],
        ejecutar: { api: 'electronAPI.serviciosAsignarProfesionales', payload: { productId: s.id, asignaciones: nueva.map((x) => ({ professionalId: x.professional_id, commissionPct: x.commission_pct })) } },
        permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },

    /* «Laura trabaja de lunes a viernes de 9 a 6»: esos días se reemplazan, los demás se quedan. */
    async 'profesional.horario'(it) {
      const prof = await h.uno('SELECT id, full_name AS nombre FROM dbo.professionals WHERE id = @id;', [h.id(h.v(it, 'profesional'))]);
      if (!prof) return h.msg('No encontré a esa persona.');
      const dias = h.v(it, 'dias') || [], desde = h.v(it, 'desde'), hasta = h.v(it, 'hasta');
      if (!(desde < hasta)) return h.msg('La hora de salida tiene que ser después de la de entrada.');
      const actual = await h.q(`SELECT weekday, CONVERT(VARCHAR(5), starts_at, 108) AS d, CONVERT(VARCHAR(5), ends_at, 108) AS a FROM dbo.professional_schedules
                                 WHERE professional_id = @id AND active = 1 ORDER BY weekday, starts_at;`, [h.id(prof.id)]);
      const franjas = [...actual.filter((x) => !dias.includes(x.weekday)).map((x) => ({ weekday: x.weekday, startsAt: x.d, endsAt: x.a })),
                       ...dias.map((d) => ({ weekday: d, startsAt: desde, endsAt: hasta }))].sort((a, b) => a.weekday - b.weekday);
      return h.msg('Así queda su horario:', { plan: h.plan('profesional.horario', {
        titulo: `Horario de ${prof.nombre}`,
        vista: [1, 2, 3, 4, 5, 6, 7].map((d) => [d === 1 ? 8 : d, d]).sort((a, b) => a[0] - b[0]).map(([, d]) => {
          const fs = franjas.filter((f) => f.weekday === d);
          return { etiqueta: DIA[d], valor: fs.length ? fs.map((f) => `${f.startsAt}–${f.endsAt}`).join(', ') : 'descansa' };
        }),
        ejecutar: { api: 'electronAPI.serviciosGuardarHorario', payload: { profesionalId: prof.id, franjas } }, permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },

    async 'profesional.ausencia'(it) {
      const prof = await h.uno('SELECT id, full_name AS nombre FROM dbo.professionals WHERE id = @id;', [h.id(h.v(it, 'profesional'))]);
      if (!prof) return h.msg('No encontré a esa persona.');
      const f = h.v(it, 'fechas');
      const motivo = h.v(it, 'motivo') || 'Ausencia';
      const citas = await h.q(`SELECT a.starts_at, c.customerName AS cliente FROM dbo.appointments a LEFT JOIN dbo.customers c ON c.id = a.customer_id
                                WHERE a.professional_id = @p AND a.starts_at >= @d AND a.starts_at < DATEADD(DAY, 1, CAST(@h AS DATE)) AND a.status NOT IN ('CANCELADA', 'NO_ASISTIO');`,
        [['p', h.sql.Int, prof.id], ['d', h.sql.Date, f.desde], ['h', h.sql.Date, f.hasta]]).catch(() => []);
      return h.msg('Esta ausencia voy a registrar:', { plan: h.plan('profesional.ausencia', {
        titulo: `${prof.nombre} · ${motivo.toLowerCase()}`,
        vista: [{ etiqueta: 'Desde', valor: h.diaTexto(h.cuando(f.desde)) }, { etiqueta: 'Hasta', valor: h.diaTexto(h.cuando(f.hasta)) }, { etiqueta: 'Motivo', valor: motivo }],
        avisos: citas.length ? [`Tiene ${citas.length} cita(s) esos días (${citas.slice(0, 3).map((c) => c.cliente).join(', ')}): muévelas.`] : [],
        ejecutar: { api: 'electronAPI.serviciosGuardarAusencia', payload: { id: null, profesionalId: prof.id, desde: local0(f.desde), hasta: local0(f.hasta, 1), motivo } },
        permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },

    async 'profesional.ausencia_borrar'(it) {
      const prof = await h.uno('SELECT id, full_name AS nombre FROM dbo.professionals WHERE id = @id;', [h.id(h.v(it, 'profesional'))]);
      if (!prof) return h.msg('No encontré a esa persona.');
      const f = h.v(it, 'fechas');
      const a = await h.uno(`SELECT TOP 1 id, starts_at, ends_at, reason FROM dbo.professional_time_off
                              WHERE professional_id = @p AND starts_at < DATEADD(DAY, 1, CAST(@d AS DATE)) AND ends_at > CAST(@d AS DATE) ORDER BY starts_at;`,
        [['p', h.sql.Int, prof.id], ['d', h.sql.Date, f.desde]]);
      if (!a) return h.msg(`${prof.nombre} no tiene ausencia ese día.`);
      return h.msg('Esta ausencia voy a quitar:', { plan: h.plan('profesional.ausencia_borrar', {
        titulo: `${prof.nombre} sí viene`,
        vista: [{ etiqueta: 'Ausencia', valor: `${h.diaTexto(a.starts_at)} → ${h.diaTexto(new Date(new Date(a.ends_at).getTime() - 1))}` }, { etiqueta: 'Motivo', valor: a.reason || '—' }],
        avisos: ['Se borra la ausencia completa: si eran varios días, vuelve a registrar los que sí falta.'],
        ejecutar: { api: 'electronAPI.serviciosBorrarAusencia', payload: { id: Number(a.id) } }, permiso: 'SERVICIOS_ADMINISTRAR',
      }) });
    },
  };
};
