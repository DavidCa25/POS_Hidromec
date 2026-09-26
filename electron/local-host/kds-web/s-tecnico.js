/*
 * TECHNICIAN — los trabajos asignados a quien entro. Tocar uno abre el
 * vehiculo o equipo, lo que reporto el cliente y lo que se puede hacer:
 * Empezar, Pausar/Reanudar, Terminar, una nota y los materiales usados.
 * No hay precios ni cobro en esta pantalla.
 */
(() => {
  'use strict';
  const ETIQUETA = {
    PENDIENTE: ['Pendiente', 'pill'],
    EN_PROCESO: ['En proceso', 'pill pill--cyan'],
    HECHA: ['Terminado', 'pill pill--ok'],
  };

  const trabajo = (ctx, id) => (ctx.datos?.trabajos || []).find(t => t.lineaId === id);

  function abrir(ctx, id) {
    const u = ctx.ui;
    u.linea = id; u.nota = ''; u.busca = ''; u.materiales = null; u.cant = {};
    ctx.hoja(() => hoja(ctx));
  }

  function hoja(ctx) {
    const { el } = ctx;
    const u = ctx.ui;
    const t = trabajo(ctx, u.linea);
    if (!t) return [el('p', { text: 'Este trabajo ya no está asignado a ti.' }), el('button', { type: 'button', class: 'btn', text: 'Cerrar', onclick: ctx.cerrarHoja })];
    const [txt, clase] = ETIQUETA[t.estado] || ['', 'pill'];
    const hacer = (nombre, ok) => ctx.accion(nombre, { lineaId: t.lineaId }, { ok });
    const botones = [];
    if (t.estado === 'PENDIENTE') botones.push(el('button', { type: 'button', class: 'btn btn--grande btn--navy', text: 'Empezar', onclick: () => hacer('EMPEZAR', 'Trabajo empezado.') }));
    if (t.estado === 'EN_PROCESO' && !t.pausado) botones.push(el('button', { type: 'button', class: 'btn btn--grande btn--aviso', text: 'Pausar', onclick: () => hacer('PAUSAR', 'En pausa.') }));
    if (t.estado === 'EN_PROCESO' && t.pausado) botones.push(el('button', { type: 'button', class: 'btn btn--grande btn--navy', text: 'Continuar', onclick: () => hacer('REANUDAR', 'Continuando.') }));
    if (t.estado !== 'HECHA') botones.push(el('button', { type: 'button', class: 'btn btn--grande btn--verde', text: 'Terminar', onclick: () => hacer('TERMINAR', 'Trabajo terminado.') }));

    const buscar = async () => { const r = await ctx.consulta('materiales', { q: u.busca }); u.materiales = r?.materiales || []; ctx.pintarHoja(); };

    return [
      el('div', { class: 'hoja__cab' },
        el('div', {}, el('h2', { text: t.activo || t.trabajo }), el('p', { text: `${t.folio} · ${t.trabajo}` })),
        el('button', { type: 'button', class: 'btn btn--chico', text: 'Cerrar', onclick: ctx.cerrarHoja })),
      el('div', { class: 'opciones' }, el('span', { class: clase, text: t.pausado ? 'En pausa' : txt }), t.autorizada ? null : el('span', { class: 'pill pill--aviso', text: 'Sin autorizar' })),
      el('dl', { class: 'datos' },
        el('dt', { text: 'Cliente' }), el('dd', { text: t.cliente }),
        t.identificador ? [el('dt', { text: 'Placa / serie' }), el('dd', { text: t.identificador })] : null,
        t.color ? [el('dt', { text: 'Color' }), el('dd', { text: t.color })] : null,
        t.reportado ? [el('dt', { text: 'Reportó' }), el('dd', { text: t.reportado })] : null,
        t.promesa ? [el('dt', { text: 'Entrega' }), el('dd', { text: t.promesa })] : null),
      botones.length ? el('div', { class: 'acciones' }, ...botones) : null,

      el('div', { class: 'seccion' },
        el('h3', { text: 'Nota' }),
        ...(t.notas || []).map(n => el('p', { class: 'nota-pie', text: `${n.hora} · ${n.texto}` })),
        el('textarea', { class: 'campo', id: 'nota-trabajo', maxlength: '300', placeholder: 'Ej. Balatas traseras al 20%', value: u.nota, oninput: (e) => { u.nota = e.target.value; } }),
        el('button', { type: 'button', class: 'btn btn--primario', text: 'Guardar nota',
          onclick: async () => { if (!u.nota.trim()) return; if (await ctx.accion('NOTA', { ordenId: t.ordenId, texto: u.nota.trim() }, { ok: 'Nota guardada.' })) { u.nota = ''; ctx.pintarHoja(); } } })),

      el('div', { class: 'seccion' },
        el('h3', { text: 'Refacciones y materiales' }),
        (t.materiales || []).length ? el('div', { class: 'materiales' }, ...t.materiales.map(m => el('div', { class: 'material' }, el('span', { text: m.nombre }), el('b', { text: `× ${m.cantidad}` })))) : null,
        el('div', { class: 'material' },
          el('input', { class: 'campo', id: 'busca-refaccion', type: 'search', placeholder: 'Buscar refacción o material', value: u.busca,
            oninput: (e) => { u.busca = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') void buscar(); } }),
          el('button', { type: 'button', class: 'btn', text: 'Buscar', onclick: () => void buscar() })),
        u.materiales ? (u.materiales.length ? el('div', { class: 'materiales' }, ...u.materiales.map(m => {
          const q = u.cant[m.id] || 1;
          return el('div', { class: 'material' },
            el('span', { text: m.nombre }),
            el('span', { class: 'cantidad' },
              el('button', { type: 'button', text: '−', 'aria-label': 'Menos', onclick: () => { u.cant[m.id] = Math.max(1, q - 1); ctx.pintarHoja(); } }),
              el('b', { text: q }),
              el('button', { type: 'button', text: '+', 'aria-label': 'Más', onclick: () => { u.cant[m.id] = q + 1; ctx.pintarHoja(); } }),
              el('button', { type: 'button', class: 'btn btn--chico btn--primario', text: 'Agregar',
                onclick: async () => { if (await ctx.accion('MATERIAL', { ordenId: t.ordenId, productId: m.id, cantidad: q }, { ok: `${m.nombre} agregado.` })) { u.cant[m.id] = 1; } } })));
        })) : el('p', { class: 'vacio-chico', text: 'Sin resultados.' })) : null,
        el('p', { class: 'nota-pie', text: 'Entra a la orden al precio del catálogo. Tú no cambias precios.' })),
    ];
  }

  function accionesEnLinea(ctx, t) {
    const { el } = ctx;
    const hacer = (nombre, ok) => ctx.accion(nombre, { lineaId: t.lineaId }, { ok });
    const b = [];
    if (t.estado === 'PENDIENTE') b.push(el('button', { type: 'button', class: 'btn btn--navy', text: 'Empezar', onclick: () => hacer('EMPEZAR', 'Trabajo empezado.') }));
    if (t.estado === 'EN_PROCESO' && !t.pausado) b.push(el('button', { type: 'button', class: 'btn btn--aviso', text: 'Pausar', onclick: () => hacer('PAUSAR', 'En pausa.') }));
    if (t.estado === 'EN_PROCESO' && t.pausado) b.push(el('button', { type: 'button', class: 'btn btn--navy', text: 'Continuar', onclick: () => hacer('REANUDAR', 'Continuando.') }));
    if (t.estado !== 'HECHA') b.push(el('button', { type: 'button', class: 'btn btn--verde', text: 'Terminar', onclick: () => hacer('TERMINAR', 'Trabajo terminado.') }));
    b.push(el('button', { type: 'button', class: 'btn', text: 'Nota y materiales', onclick: () => abrir(ctx, t.lineaId) }));
    return el('div', { class: 'tl__acc' }, ...b);
  }

  window.WX.superficies.TECHNICIAN = {
    icono: 'wrench',
    titulo: (ctx) => ctx.sesion?.persona?.nombre || 'Técnico',
    alSincronizar(ctx) { if (ctx.ui.linea) ctx.pintarHoja(); },
    progreso(ctx) {
      const r = ctx.datos?.reposo || {};
      const total = (r.pendientes || 0) + (r.enProceso || 0) + (r.hechos || 0);
      return total ? { hechas: r.hechos || 0, total, texto: `${r.hechos || 0} de ${total} ${total === 1 ? 'trabajo terminado' : 'trabajos terminados'}${r.enProceso ? ` · ${r.enProceso} en proceso` : ''}` } : { hechas: 0, total: 0, texto: 'Sin trabajos asignados' };
    },
    pestanas: () => [{ icono: 'wrench', texto: 'Trabajos', activa: true, onclick: () => window.scrollTo({ top: 0 }) }],
    render(ctx) {
      const { el } = ctx;
      const ts = ctx.datos?.trabajos || [];
      if (!ts.length) return [el('p', { class: 'vacio-chico', text: 'No tienes trabajos asignados.' })];
      const actual = ctx.datos?.reposo?.siguiente?.lineaId ?? null;
      const filas = [];
      for (const t of ts) {
        const esActual = t.lineaId === actual;
        const clase = `tl__it ${t.estado === 'HECHA' ? 'es-hecha' : t.estado === 'EN_PROCESO' ? 'es-curso' : ''} ${esActual ? 'es-actual' : ''}`;
        const estado = t.estado === 'HECHA' ? 'terminado' : t.pausado ? 'en pausa' : t.estado === 'EN_PROCESO' ? 'en proceso' : '';
        const detalle = [t.trabajo, t.identificador, estado].filter(Boolean).join(' · ');
        /* La hora es la promesa de entrega; sin promesa, la columna queda limpia. */
        filas.push(el('span', { class: 'tl__h', text: t.promesa ? t.promesa.replace(/^Hoy /, '') : '' }));
        filas.push(esActual
          ? el('div', { class: clase, 'data-linea': t.lineaId },
              el('b', { text: t.activo || t.cliente }), el('p', { text: detalle }),
              t.reportado ? el('p', { class: 'nota-pie', text: `Reportó: ${t.reportado}` }) : null,
              t.autorizada ? null : el('span', { class: 'pill pill--aviso', text: 'Sin autorizar' }),
              accionesEnLinea(ctx, t))
          : el('button', { type: 'button', class: clase, 'data-linea': t.lineaId, onclick: () => abrir(ctx, t.lineaId) },
              el('b', { text: t.activo || t.cliente }), el('p', { text: detalle })));
      }
      return [el('section', { class: 'tl', 'aria-label': 'Tus trabajos' }, ...filas)];
    },
  };
})();
