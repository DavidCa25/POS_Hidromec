/*
 * WAITER — el mesero en la mesa. El salon (sus mesas primero), la cuenta de
 * una mesa con el estado de cada cosa en cocina, y el menu para agregar con
 * sus opciones. «Enviar a preparacion» va por el mismo camino que Touch.
 * El cobro no esta aqui: se hace en caja.
 */
(() => {
  'use strict';
  const PREP = { NUEVA: ['En espera', 'pill pill--azul'], PREPARANDO: ['Preparando', 'pill pill--cyan'], LISTA: ['Listo', 'pill pill--ok'], ENTREGADA: ['Entregado', 'pill'], CANCELADA: ['Cancelado', 'pill pill--mal'] };
  const nombreMesa = (n) => (/^\d+$/.test(String(n)) ? `Mesa ${n}` : n);

  async function asegurarMenu(ctx) {
    const u = ctx.ui;
    if (!u.menu) { u.menu = await ctx.consulta('menu'); if (u.menu && u.cat == null) u.cat = u.menu.categorias[0]?.id ?? null; }
    return u.menu;
  }

  async function abrirMesa(ctx, m) {
    const u = ctx.ui;
    if (m.estado === 'LIBRE') {
      const r = await ctx.accion('ABRIR_MESA', { mesaId: m.id });
      if (!r) return;
      u.cuentaId = r.cuentaId;
    } else u.cuentaId = m.cuentaId;
    u.mesaId = m.id; u.vista = 'mesa'; u.pedido = []; u.cuenta = null;
    ctx.pintar();
    await Promise.all([cargarCuenta(ctx), asegurarMenu(ctx)]);
    ctx.pintar();
  }

  async function cargarCuenta(ctx) {
    const u = ctx.ui;
    if (!u.cuentaId) return;
    const r = await ctx.consulta('cuenta', { id: u.cuentaId });
    if (r) u.cuenta = r;
  }

  function agregar(ctx, p, opciones = [], nota = null) {
    const u = ctx.ui;
    const delta = opciones.reduce((t, o) => t + o.delta * o.quantity, 0);
    u.pedido.push({ productId: p.id, nombre: p.nombre, precio: p.precio + delta, cantidad: 1, opciones, nota, origen: ctx.uuid() });
    ctx.pintar();
  }

  function elegirOpciones(ctx, p) {
    const { el } = ctx;
    const m = ctx.ui.menu;
    const grupos = p.grupos.map(g => m.grupos.find(x => x.id === g)).filter(Boolean);
    const sel = new Map(grupos.map(g => [g.id, []]));
    const est = { nota: '', error: null };
    const render = () => [
      el('div', { class: 'hoja__cab' },
        el('div', {}, el('h2', { text: p.nombre }), el('p', { text: ctx.dinero(p.precio) })),
        el('button', { type: 'button', class: 'btn btn--chico', text: 'Cerrar', onclick: ctx.cerrarHoja })),
      ...grupos.map(g => el('div', { class: 'seccion' },
        el('h3', { text: `${g.nombre}${g.requerido || g.min > 0 ? ' · obligatorio' : ''}${g.max > 1 ? ` · hasta ${g.max}` : ''}` }),
        el('div', { class: 'opciones' }, ...g.opciones.map(o => {
          const lista = sel.get(g.id);
          const on = lista.includes(o.id);
          return el('button', { type: 'button', class: 'opcion', 'aria-pressed': String(on), disabled: !o.disponible,
            text: `${o.nombre}${o.delta ? ` +${ctx.dinero(o.delta)}` : ''}`,
            onclick: () => {
              if (on) sel.set(g.id, lista.filter(x => x !== o.id));
              else if (g.max === 1) sel.set(g.id, [o.id]);
              else if (!g.max || lista.length < g.max) lista.push(o.id);
              ctx.pintarHoja();
            } });
        })))),
      el('div', { class: 'seccion' }, el('h3', { text: 'Nota para cocina' }),
        el('input', { class: 'campo', id: 'nota-producto', maxlength: '200', placeholder: 'Ej. sin cebolla', value: est.nota, oninput: (e) => { est.nota = e.target.value; } })),
      est.error ? el('p', { class: 'error', role: 'alert', text: est.error }) : null,
      el('button', { type: 'button', class: 'btn btn--primario btn--grande', text: 'Agregar a la orden', onclick: () => {
        const falta = grupos.find(g => (g.requerido || g.min > 0) && (sel.get(g.id).length < Math.max(1, g.min || 0)));
        if (falta) { est.error = `Falta elegir ${falta.nombre}.`; ctx.pintarHoja(); return; }
        const opciones = [];
        for (const g of grupos) for (const id of sel.get(g.id)) { const o = g.opciones.find(x => x.id === id); opciones.push({ optionId: id, nombre: o.nombre, delta: o.delta, quantity: 1 }); }
        ctx.cerrarHoja();
        agregar(ctx, p, opciones, est.nota.trim() || null);
      } }),
    ];
    ctx.hoja(render);
  }

  async function enviar(ctx) {
    const u = ctx.ui;
    if (!u.pedido.length || u.enviando) return;
    u.enviando = true; ctx.pintar();
    const r = await ctx.accion('ENVIAR', {
      cuentaId: u.cuentaId,
      lineas: u.pedido.map(l => ({ productId: l.productId, cantidad: l.cantidad, nota: l.nota, origen: l.origen,
        opciones: l.opciones.map(o => ({ optionId: o.optionId, quantity: o.quantity })) })),
    });
    u.enviando = false;
    if (r) {
      const destinos = [...new Set((r.comandas || []).map(k => k.estacion))];
      ctx.avisar(destinos.length ? `Enviado a ${destinos.join(' y ')}.` : 'Enviado.');
      u.pedido = [];
      await cargarCuenta(ctx);
    }
    ctx.pintar();
  }

  function vistaMesa(ctx) {
    const { el } = ctx;
    const u = ctx.ui;
    const mesa = (ctx.datos?.mesas || []).find(m => m.id === u.mesaId);
    const c = u.cuenta;
    const menu = u.menu;
    const totalPedido = u.pedido.reduce((t, l) => t + l.precio * l.cantidad, 0);
    return [
      el('div', { class: 'reposo' },
        el('div', {},
          el('p', { class: 'reposo__hola', text: mesa ? nombreMesa(mesa.nombre) : 'Mesa' }),
          el('p', { class: 'nota-pie', text: [mesa?.area, c ? `${c.cuenta.minutos ?? 0} min` : null].filter(Boolean).join(' · ') })),
        el('button', { type: 'button', class: 'btn', text: '← Mesas', onclick: () => { u.vista = 'mesas'; u.cuenta = null; ctx.pintar(); } })),
      el('div', { class: 'seccion' },
        el('h3', { text: 'Cuenta' }),
        c && c.lineas.length ? el('div', { class: 'lineas-cuenta' }, ...c.lineas.map(l => {
          const [txt, clase] = PREP[l.prep] || ['Sin preparación', 'pill'];
          return el('div', { class: 'lcuenta' },
            el('span', { class: 'l__cant', text: l.cantidad }),
            el('span', { class: 'l__cuerpo' }, el('span', { class: 'l__nom', text: l.nombre }),
              ...l.opciones.map(o => el('span', { class: 'l__op', text: o })), l.nota ? el('span', { class: 'l__nota', text: l.nota }) : null),
            el('span', { class: clase, text: l.estacion && l.prep ? `${txt}` : txt }));
        })) : el('p', { class: 'vacio-chico', text: c ? 'Todavía no se ha pedido nada.' : 'Cargando…' }),
        c ? el('div', { class: 'total' }, el('span', { text: 'Total' }), el('b', { text: ctx.dinero(c.total) })) : null,
        el('p', { class: 'nota-pie', text: 'El cobro se hace en caja.' })),

      u.pedido.length ? el('div', { class: 'seccion' },
        el('h3', { text: 'Por enviar' }),
        el('div', { class: 'materiales' }, ...u.pedido.map((l, i) => el('div', { class: 'material' },
          el('span', {}, el('b', { text: l.nombre }), l.opciones.length ? el('span', { class: 'l__op', text: ` · ${l.opciones.map(o => o.nombre).join(', ')}` }) : null),
          el('span', { class: 'cantidad' },
            el('button', { type: 'button', text: '−', 'aria-label': 'Menos', onclick: () => { l.cantidad -= 1; if (l.cantidad <= 0) u.pedido.splice(i, 1); ctx.pintar(); } }),
            el('b', { text: l.cantidad }),
            el('button', { type: 'button', text: '+', 'aria-label': 'Más', onclick: () => { l.cantidad += 1; ctx.pintar(); } }))))),
        el('button', { type: 'button', class: 'btn btn--primario btn--grande', disabled: !!u.enviando,
          text: u.enviando ? 'Enviando…' : `Enviar a preparación · ${ctx.dinero(totalPedido)}`, onclick: () => void enviar(ctx) })) : null,

      menu ? el('div', { class: 'seccion' },
        el('h3', { text: 'Agregar' }),
        el('div', { class: 'cats', role: 'group', 'aria-label': 'Categorías' }, ...menu.categorias.map(k =>
          el('button', { type: 'button', 'aria-pressed': String(u.cat === k.id), text: k.nombre, onclick: () => { u.cat = k.id; ctx.pintar(); } }))),
        el('div', { class: 'productos' }, ...menu.productos.filter(p => u.cat == null || p.categoriaId === u.cat).map(p =>
          el('button', { type: 'button', class: 'producto', disabled: !p.disponible, 'data-producto': p.id,
            onclick: () => (p.grupos.length ? elegirOpciones(ctx, p) : agregar(ctx, p)) },
            el('span', { text: p.nombre }), el('small', { text: p.disponible ? ctx.dinero(p.precio) : 'Agotado' }))))) : null,
    ];
  }

  function vistaMesas(ctx) {
    const { el } = ctx;
    const u = ctx.ui;
    const d = ctx.datos || { mesas: [], reposo: {} };
    const r = d.reposo || {};
    const filtro = u.filtro || (r.asignadas ? 'mias' : 'todas');
    const mesas = (d.mesas || []).filter(m => filtro === 'todas' || m.mia || m.estado === 'LIBRE');
    const sig = r.siguiente ? (d.mesas || []).find(m => m.id === r.siguiente.mesaId) : null;
    return [
      /* Las cifras ya estan en la banda: aqui, solo a donde ir ahora. */
      sig ? el('button', { type: 'button', class: 'reposo__sig reposo__sig--boton reposo__sig--ancho', onclick: () => void abrirMesa(ctx, sig) },
          el('small', { text: 'Siguiente atención' }), el('b', { text: nombreMesa(sig.nombre) }),
          el('span', { text: r.siguiente.listas ? 'Hay algo listo para servir' : `${sig.minutos ?? 0} min abierta` })) : null,
      el('div', { class: 'entrar__tabs', role: 'group', 'aria-label': 'Qué mesas ver' },
        el('button', { type: 'button', 'aria-pressed': String(filtro === 'mias'), text: 'Mis mesas y libres', onclick: () => { u.filtro = 'mias'; ctx.pintar(); } }),
        el('button', { type: 'button', 'aria-pressed': String(filtro === 'todas'), text: 'Todo el salón', onclick: () => { u.filtro = 'todas'; ctx.pintar(); } })),
      mesas.length ? el('div', { class: 'mesas' }, ...mesas.map(m => el('button', {
        type: 'button', 'data-mesa': m.id,
        class: `mesa ${m.estado === 'LIBRE' ? 'es-libre' : ''} ${m.mia ? 'es-mia' : ''} ${m.listas ? 'es-lista' : ''}`,
        onclick: () => void abrirMesa(ctx, m) },
        el('b', { text: nombreMesa(m.nombre) }),
        el('span', { text: m.area || '' }),
        m.estado === 'LIBRE' ? el('span', { text: 'Libre' })
          : [el('span', { class: 'mesa__total', text: ctx.dinero(m.total) }),
             el('span', { text: `${m.lineas} ${m.lineas === 1 ? 'producto' : 'productos'}${m.pendientes ? ` · ${m.pendientes} en cocina` : ''}` })]))) :
        el('p', { class: 'vacio-chico', text: 'No hay mesas en tus áreas.' }),
    ];
  }

  window.WX.superficies.WAITER = {
    icono: 'fork-knife',
    titulo: (ctx) => ctx.sesion?.persona?.nombre || 'Mesero',
    progreso(ctx) {
      const r = ctx.datos?.reposo || {};
      const n = (x, uno, varios) => `${x ?? 0} ${x === 1 ? uno : varios}`;
      return { hechas: 0, total: 0, texto: `${n(r.asignadas, 'mesa tuya', 'mesas tuyas')} · ${n(r.ocupadas, 'ocupada', 'ocupadas')} · ${n(r.libres, 'libre', 'libres')}` };
    },
    pestanas: (ctx) => [
      { icono: 'armchair', texto: 'Mesas', activa: ctx.ui.vista !== 'mesa', onclick: () => { ctx.ui.vista = 'mesas'; ctx.ui.cuenta = null; ctx.pintar(); } },
      ...(ctx.ui.vista === 'mesa' ? [{ icono: 'clipboard-text', texto: 'Cuenta', activa: true, onclick: () => window.scrollTo({ top: 0 }) }] : []),
    ],
    alEvento(ev, ctx) {
      const u = ctx.ui;
      if (u.vista === 'mesa' && u.cuentaId && (ev.tipo === 'ORDER_UPDATED' || ev.tipo === 'ORDER_READY') && Number(ev.id) === Number(u.cuentaId)) {
        void cargarCuenta(ctx).then(() => ctx.pintar());
      }
      return false;   // y el salon se vuelve a pedir
    },
    render(ctx) { return ctx.ui.vista === 'mesa' ? vistaMesa(ctx) : vistaMesas(ctx); },
  };
})();
