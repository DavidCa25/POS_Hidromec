/*
 * STAFF_DAY — «Mi jornada». Saludo, cuantas citas hoy, la siguiente, y la
 * agenda del dia con sus huecos. Tocar una cita abre lo que se puede hacer:
 * Llego, Empezar, Terminar, una nota rapida y los materiales usados.
 */
(() => {
  'use strict';
  const ETIQUETA = {
    PENDIENTE: ['Por llegar', 'pill'],
    LLEGO: ['Llegó', 'pill pill--azul'],
    EN_CURSO: ['En curso', 'pill pill--cyan'],
    TERMINADA: ['Terminada', 'pill pill--ok'],
    NO_ASISTIO: ['No asistió', 'pill pill--mal'],
  };

  function cita(ctx, id) { return (ctx.datos?.agenda || []).find(x => x.tipo === 'CITA' && x.id === id); }

  function abrirCita(ctx, id) {
    const u = ctx.ui;
    u.cita = id;
    u.nota = '';
    u.consumo = [];
    u.busca = '';
    u.materiales = null;
    ctx.hoja(() => hojaCita(ctx));
  }

  function hojaCita(ctx) {
    const { el } = ctx;
    const u = ctx.ui;
    const c = cita(ctx, u.cita);
    if (!c) return [el('p', { text: 'Esta cita ya no está en tu jornada.' }), el('button', { type: 'button', class: 'btn', text: 'Cerrar', onclick: ctx.cerrarHoja })];
    const [txt, clase] = ETIQUETA[c.estado] || ['', 'pill'];
    const hacer = async (nombre, ok) => {
      const r = await ctx.accion(nombre, { citaId: c.id }, { ok });
      if (r) { await new Promise(res => setTimeout(res, 150)); ctx.pintarHoja(); }
    };
    const botones = [];
    if (c.estado === 'PENDIENTE') botones.push(el('button', { type: 'button', class: 'btn btn--grande', text: 'Llegó', onclick: () => hacer('LLEGO', 'Anotado: llegó.') }));
    if (c.estado === 'PENDIENTE' || c.estado === 'LLEGO') botones.push(el('button', { type: 'button', class: 'btn btn--grande btn--navy', text: 'Empezar', onclick: () => hacer('EMPEZAR', 'Empezaste.') }));
    if (c.estado === 'EN_CURSO' || c.estado === 'LLEGO') botones.push(el('button', { type: 'button', class: 'btn btn--grande btn--verde', text: 'Terminar', onclick: () => hacer('TERMINAR', 'Terminado.') }));

    const agregarMaterial = (m) => {
      const ya = u.consumo.find(x => x.productId === m.id);
      if (ya) ya.cantidad += 1; else u.consumo.push({ productId: m.id, nombre: m.nombre, cantidad: 1 });
      ctx.pintarHoja();
    };
    const buscar = async () => {
      const r = await ctx.consulta('materiales', { q: u.busca });
      u.materiales = r?.materiales || [];
      ctx.pintarHoja();
    };

    return [
      el('div', { class: 'hoja__cab' },
        el('div', {}, el('h2', { text: c.cliente }), el('p', { text: `${c.inicio}–${c.fin} · ${c.servicio}` })),
        el('button', { type: 'button', class: 'btn btn--chico', text: 'Cerrar', onclick: ctx.cerrarHoja })),
      el('span', { class: clase, text: txt }),
      c.nota ? el('p', { class: 'nota-pie', text: c.nota }) : null,
      botones.length ? el('div', { class: 'acciones' }, ...botones) : null,

      c.estado !== 'NO_ASISTIO' ? el('div', { class: 'seccion' },
        el('h3', { text: 'Nota rápida' }),
        el('textarea', { class: 'campo', id: 'nota-cita', maxlength: '300', placeholder: 'Ej. Pidió tono 148', value: u.nota,
          oninput: (e) => { u.nota = e.target.value; } }),
        el('button', { type: 'button', class: 'btn btn--primario', text: 'Guardar nota',
          onclick: async () => { if (!u.nota.trim()) return; const r = await ctx.accion('NOTA', { citaId: c.id, texto: u.nota.trim() }, { ok: 'Nota guardada.' }); if (r) { u.nota = ''; ctx.pintarHoja(); } } })) : null,

      c.estado !== 'NO_ASISTIO' && c.estado !== 'PENDIENTE' ? el('div', { class: 'seccion' },
        el('h3', { text: 'Materiales usados' }),
        el('p', { class: 'nota-pie', text: 'Se agregan a la orden al precio del catálogo y salen del inventario al cobrarse.' }),
        el('div', { class: 'material' },
          el('input', { class: 'campo', id: 'busca-material', type: 'search', placeholder: 'Buscar material', value: u.busca,
            oninput: (e) => { u.busca = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') void buscar(); } }),
          el('button', { type: 'button', class: 'btn', text: 'Buscar', onclick: () => void buscar() })),
        u.materiales ? (u.materiales.length
          ? el('div', { class: 'opciones' }, ...u.materiales.map(m => el('button', { type: 'button', class: 'opcion', text: `+ ${m.nombre}`, onclick: () => agregarMaterial(m) })))
          : el('p', { class: 'vacio-chico', text: 'Sin resultados.' })) : null,
        u.consumo.length ? el('div', { class: 'materiales' }, ...u.consumo.map(x => el('div', { class: 'material' },
          el('span', { text: x.nombre }),
          el('span', { class: 'cantidad' },
            el('button', { type: 'button', text: '−', 'aria-label': 'Menos', onclick: () => { x.cantidad = Math.max(0, x.cantidad - 1); u.consumo = u.consumo.filter(y => y.cantidad > 0); ctx.pintarHoja(); } }),
            el('b', { text: x.cantidad }),
            el('button', { type: 'button', text: '+', 'aria-label': 'Más', onclick: () => { x.cantidad += 1; ctx.pintarHoja(); } }))))) : null,
        u.consumo.length ? el('button', { type: 'button', class: 'btn btn--primario', text: 'Guardar materiales',
          onclick: async () => {
            const r = await ctx.accion('CONSUMO', { citaId: c.id, items: u.consumo.map(x => ({ productId: x.productId, cantidad: x.cantidad })) }, { ok: 'Materiales guardados.' });
            if (r) { u.consumo = []; ctx.pintarHoja(); }
          } }) : null) : null,
    ];
  }

  const CLASE_TL = { TERMINADA: 'es-hecha', EN_CURSO: 'es-curso', LLEGO: 'es-llego', NO_ASISTIO: 'es-hecha' };
  const DETALLE = { TERMINADA: 'terminada', EN_CURSO: 'en curso', LLEGO: 'llegó', NO_ASISTIO: 'no asistió', PENDIENTE: '' };

  /* Las acciones de la cita en curso, dentro de su tarjeta (carcasa B). */
  function accionesEnLinea(ctx, c) {
    const { el } = ctx;
    const hacer = (nombre, ok) => ctx.accion(nombre, { citaId: c.id }, { ok });
    const b = [];
    if (c.estado === 'PENDIENTE') b.push(el('button', { type: 'button', class: 'btn', text: 'Llegó', onclick: () => hacer('LLEGO', 'Anotado: llegó.') }));
    if (c.estado === 'PENDIENTE' || c.estado === 'LLEGO') b.push(el('button', { type: 'button', class: 'btn btn--navy', text: 'Empezar', onclick: () => hacer('EMPEZAR', 'Empezaste.') }));
    if (c.estado === 'EN_CURSO' || c.estado === 'LLEGO') b.push(el('button', { type: 'button', class: 'btn btn--verde', text: 'Terminar', onclick: () => hacer('TERMINAR', 'Terminado.') }));
    b.push(el('button', { type: 'button', class: 'btn', text: 'Nota', onclick: () => abrirCita(ctx, c.id) }));
    if (c.estado !== 'PENDIENTE') b.push(el('button', { type: 'button', class: 'btn', text: 'Materiales', onclick: () => abrirCita(ctx, c.id) }));
    return el('div', { class: 'tl__acc' }, ...b);
  }

  window.WX.superficies.STAFF_DAY = {
    icono: 'calendar-check',
    titulo: (ctx) => ctx.sesion?.persona?.nombre || 'Mi jornada',
    alSincronizar(ctx) { if (ctx.ui.cita) ctx.pintarHoja(); },
    progreso(ctx) {
      const r = ctx.datos?.reposo || {};
      const total = r.citas || 0;
      return total ? { hechas: r.completadas || 0, total, texto: `${r.completadas || 0} de ${total} ${total === 1 ? 'cita atendida' : 'citas atendidas'}` } : { hechas: 0, total: 0, texto: 'Sin citas hoy' };
    },
    pestanas: () => [{ icono: 'calendar-check', texto: 'Hoy', activa: true, onclick: () => window.scrollTo({ top: 0 }) }],
    render(ctx) {
      const { el } = ctx;
      const d = ctx.datos || { agenda: [], reposo: {} };
      const agenda = d.agenda || [];
      if (!agenda.length) return [el('p', { class: 'vacio-chico', text: 'No tienes citas hoy.' })];
      const actual = d.reposo?.siguiente?.id ?? null;
      const ahora = d.ahora || null;
      const filas = [];
      let lineaPuesta = false;
      for (const x of agenda) {
        /* «Ahora» va justo antes de lo primero que empieza despues de ahora. */
        if (ahora && !lineaPuesta && x.inicio > ahora) {
          filas.push(el('span', { 'aria-hidden': 'true' }), el('div', { class: 'tl__ahora', role: 'presentation' }, el('span', { text: 'AHORA' })));
          lineaPuesta = true;
        }
        filas.push(el('span', { class: 'tl__h', text: x.inicio }));
        if (x.tipo === 'LIBRE') {
          filas.push(el('div', { class: 'tl__it es-libre' }, el('b', { text: 'Disponible' }), el('p', { text: `hasta las ${x.fin}` })));
          continue;
        }
        const esActual = x.id === actual;
        const clase = `tl__it ${CLASE_TL[x.estado] || ''} ${esActual ? 'es-actual' : ''}`;
        const detalle = [x.servicio, DETALLE[x.estado]].filter(Boolean).join(' · ');
        filas.push(esActual
          ? el('div', { class: clase, 'data-cita': x.id },
              el('b', { text: x.cliente }), el('p', { text: detalle }),
              x.nota ? el('p', { class: 'nota-pie', text: x.nota }) : null,
              accionesEnLinea(ctx, x))
          : el('button', { type: 'button', class: clase, 'data-cita': x.id, onclick: () => abrirCita(ctx, x.id) },
              el('b', { text: x.cliente }), el('p', { text: detalle })));
      }
      return [el('section', { class: 'tl', 'aria-label': 'Tu día' }, ...filas)];
    },
  };
})();
