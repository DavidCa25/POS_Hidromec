/*
 * WAITER — el mesero en la mesa. El salon (sus mesas primero), la cuenta de
 * una mesa con el estado de cada cosa en cocina, y el menu para agregar con
 * sus opciones. «Enviar a preparacion» va por el mismo camino que Touch.
 *
 * 0097: el mesero COBRA cualquier mesa (efectivo, tarjeta o transferencia,
 * con propina) y en «Mi cuenta» ve lo que lleva: mesas, por método,
 * propinas y el efectivo que trae para entregar en caja.
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

  // ------------------------------------------------------------ cobrar
  const METODOS = [['EFECTIVO', 'Efectivo'], ['TARJETA', 'Tarjeta'], ['TRANSFERENCIA', 'Transferencia']];
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  function cobrar(ctx) {
    const { el } = ctx;
    const u = ctx.ui;
    const c = u.cuenta;
    if (!c || !c.total) return;
    /* La clave del cobro se decide al abrir la hoja: reintentar el mismo
       cobro (sin red a medias) no cobra dos veces. */
    const f = { metodo: 'EFECTIVO', pct: 0, propina: 0, otra: '', recibido: '', clave: ctx.uuid(), ocupado: false, hecho: null };
    const propina = () => (f.pct === 'otra' ? r2(Number(String(f.otra).replace(',', '.')) || 0) : r2(c.total * f.pct / 100));
    const aCobrar = () => r2(c.total + propina());
    const cambio = () => {
      const rec = Number(String(f.recibido).replace(',', '.'));
      return f.metodo === 'EFECTIVO' && f.recibido !== '' && Number.isFinite(rec) ? r2(rec - aCobrar()) : null;
    };
    const confirmar = async () => {
      if (f.ocupado) return;
      const cam = cambio();
      if (cam != null && cam < 0) return;
      f.ocupado = true; ctx.pintarHoja();
      const r = await ctx.accion('COBRAR', {
        cuentaId: u.cuentaId, metodo: f.metodo, total: c.total, propina: propina(), clave: f.clave,
        recibido: f.metodo === 'EFECTIVO' && f.recibido !== '' ? Number(String(f.recibido).replace(',', '.')) : null,
      });
      f.ocupado = false;
      if (!r) { await cargarCuenta(ctx); ctx.pintar(); ctx.cerrarHoja(); return; }
      f.hecho = r; ctx.pintarHoja();
    };
    const render = () => {
      if (f.hecho) {
        const h = f.hecho;
        return [
          el('div', { class: 'hoja__cab' }, el('div', {},
            el('h2', { text: 'Mesa cobrada' }),
            el('p', { text: `${ctx.dinero(h.total)}${h.propina ? ` + ${ctx.dinero(h.propina)} de propina` : ''}` }))),
          h.cambio != null ? el('div', { class: 'total' }, el('span', { text: 'Cambio' }), el('b', { text: ctx.dinero(h.cambio) })) : null,
          h.enBolsa ? el('p', { class: 'nota-pie', text: `${ctx.dinero(h.enBolsa)} quedan en tu bolsa para entregar en caja.` }) : null,
          el('button', { type: 'button', class: 'btn btn--primario btn--grande', 'data-cobro': 'listo', text: 'Listo',
            onclick: () => { ctx.cerrarHoja(); u.vista = 'mesas'; u.cuenta = null; ctx.refrescar?.(50); ctx.pintar(); } }),
        ];
      }
      const cam = cambio();
      return [
        el('div', { class: 'hoja__cab' },
          el('div', {}, el('h2', { text: 'Cobrar la mesa' }), el('p', { text: `Cuenta ${ctx.dinero(c.total)}` })),
          el('button', { type: 'button', class: 'btn btn--chico', text: 'Cerrar', onclick: ctx.cerrarHoja })),
        el('div', { class: 'seccion' }, el('h3', { text: '¿Cómo paga?' }),
          el('div', { class: 'opciones', role: 'group', 'aria-label': 'Cómo paga' }, ...METODOS.map(([v, t]) =>
            el('button', { type: 'button', class: 'opcion', 'data-metodo': v, 'aria-pressed': String(f.metodo === v), text: t,
              onclick: () => { f.metodo = v; ctx.pintarHoja(); } })))),
        el('div', { class: 'seccion' }, el('h3', { text: 'Propina' }),
          el('div', { class: 'opciones', role: 'group', 'aria-label': 'Propina' },
            ...[[0, 'Sin propina'], [10, '10 %'], [15, '15 %'], ['otra', 'Otra']].map(([v, t]) =>
              el('button', { type: 'button', class: 'opcion', 'data-propina': String(v), 'aria-pressed': String(f.pct === v), text: t,
                onclick: () => { f.pct = v; ctx.pintarHoja(); } }))),
          f.pct === 'otra' ? el('input', { class: 'campo', id: 'propina-otra', inputmode: 'decimal', placeholder: '$0.00', value: f.otra,
            'aria-label': 'Propina', oninput: (e) => { f.otra = e.target.value; ctx.pintarHoja(); } }) : null,
          propina() ? el('p', { class: 'nota-pie', text: `Propina: ${ctx.dinero(propina())}` }) : null),
        f.metodo === 'EFECTIVO' ? el('div', { class: 'seccion' }, el('h3', { text: '¿Con cuánto paga?' }),
          el('input', { class: 'campo', id: 'cobro-recibido', inputmode: 'decimal', placeholder: ctx.dinero(aCobrar()), value: f.recibido,
            'aria-label': 'Con cuánto paga', oninput: (e) => { f.recibido = e.target.value; ctx.pintarHoja(); } }),
          el('div', { class: 'opciones' }, ...[aCobrar(), 200, 500, 1000].filter((v, i, a) => i === 0 || (v > aCobrar() && a.indexOf(v) === i)).map((v, i) =>
            el('button', { type: 'button', class: 'opcion', text: i === 0 ? 'Exacto' : ctx.dinero(v), onclick: () => { f.recibido = String(v); ctx.pintarHoja(); } }))),
          cam != null ? el('div', { class: 'total' }, el('span', { text: cam < 0 ? 'Falta' : 'Cambio' }), el('b', { text: ctx.dinero(Math.abs(cam)) })) : null) : null,
        el('button', { type: 'button', class: 'btn btn--primario btn--grande', 'data-cobro': 'confirmar',
          disabled: f.ocupado || (cam != null && cam < 0),
          text: f.ocupado ? 'Cobrando…' : `Cobrar ${ctx.dinero(aCobrar())}`, onclick: () => void confirmar() }),
      ];
    };
    ctx.hoja(render);
  }

  // --------------------------------------------------------- mi cuenta
  async function cargarMiCuenta(ctx) {
    const r = await ctx.consulta('micuenta');
    if (r) ctx.ui.mia = r;
  }

  function vistaMiCuenta(ctx) {
    const { el } = ctx;
    const m = ctx.ui.mia;
    if (!m) return [el('p', { class: 'vacio-chico', text: 'Cargando tu cuenta…' })];
    const r = m.resumen;
    const fila = (t, v, fuerte = false) => el('div', { class: 'total' }, el('span', { text: t }), fuerte ? el('b', { text: v }) : el('span', { text: v }));
    return [
      el('div', { class: 'reposo' },
        el('div', {},
          el('p', { class: 'reposo__hola', text: 'Mi cuenta de hoy' }),
          el('p', { class: 'nota-pie', text: `${r.mesas} ${r.mesas === 1 ? 'mesa cobrada' : 'mesas cobradas'}` })),
        el('button', { type: 'button', class: 'btn', text: 'Actualizar', onclick: async () => { await cargarMiCuenta(ctx); ctx.pintar(); } })),
      el('div', { class: 'seccion', 'data-micuenta': 'resumen' },
        fila('Cobrado', ctx.dinero(r.cobrado), true),
        fila('En efectivo', ctx.dinero(r.efectivo)),
        fila('Con tarjeta', ctx.dinero(r.tarjeta)),
        r.transferencia ? fila('Por transferencia', ctx.dinero(r.transferencia)) : null,
        fila('Propinas', ctx.dinero(r.propinas))),
      el('div', { class: 'seccion', 'data-micuenta': 'bolsa' },
        el('h3', { text: 'Tu efectivo' }),
        fila('Traes para entregar', ctx.dinero(r.porEntregar), true),
        r.entregado ? fila('Ya entregaste', ctx.dinero(r.entregado)) : null,
        r.diferencia ? fila(r.diferencia < 0 ? 'Te faltó en tus entregas' : 'Te sobró en tus entregas', ctx.dinero(Math.abs(r.diferencia))) : null,
        el('p', { class: 'nota-pie', text: 'Lo entregas en caja al terminar tu turno.' })),
      el('div', { class: 'seccion' },
        el('h3', { text: 'Tus cobros' }),
        m.cobros.length ? el('div', { class: 'lineas-cuenta' }, ...m.cobros.map(x => el('div', { class: 'lcuenta lcuenta--cobro' },
          el('span', { class: 'l__cuerpo' }, el('span', { class: 'l__nom', text: nombreMesa(x.mesa) }),
            el('span', { class: 'l__op', text: `${new Date(x.hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · ${METODOS.find(([v]) => v === x.metodo)?.[1] || x.metodo}${x.propina ? ` · propina ${ctx.dinero(x.propina)}` : ''}` })),
          el('b', { text: ctx.dinero(x.total) })))) : el('p', { class: 'vacio-chico', text: 'Todavía no has cobrado ninguna mesa.' })),
    ];
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
        /* Con algo por enviar, primero se envía: no se cobra lo que cocina no ha visto. */
        c && c.total > 0 && ctx.datos?.puedeCobrar
          ? el('button', { type: 'button', class: 'btn btn--grande', 'data-cobrar': 'mesa', disabled: u.pedido.length > 0,
              text: u.pedido.length ? 'Envía lo pendiente para cobrar' : `Cobrar · ${ctx.dinero(c.total)}`, onclick: () => cobrar(ctx) })
          : null),

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
      { icono: 'armchair', texto: 'Mesas', activa: ctx.ui.vista !== 'mesa' && ctx.ui.vista !== 'micuenta', onclick: () => { ctx.ui.vista = 'mesas'; ctx.ui.cuenta = null; ctx.pintar(); } },
      ...(ctx.ui.vista === 'mesa' ? [{ icono: 'clipboard-text', texto: 'Cuenta', activa: true, onclick: () => window.scrollTo({ top: 0 }) }] : []),
      { icono: 'check-circle', texto: 'Mi cuenta', activa: ctx.ui.vista === 'micuenta',
        onclick: async () => { ctx.ui.vista = 'micuenta'; ctx.ui.cuenta = null; ctx.pintar(); await cargarMiCuenta(ctx); ctx.pintar(); } },
    ],
    alEvento(ev, ctx) {
      const u = ctx.ui;
      if (u.vista === 'mesa' && u.cuentaId && (ev.tipo === 'ORDER_UPDATED' || ev.tipo === 'ORDER_READY') && Number(ev.id) === Number(u.cuentaId)) {
        void cargarCuenta(ctx).then(() => ctx.pintar());
      }
      return false;   // y el salon se vuelve a pedir
    },
    render(ctx) { return ctx.ui.vista === 'mesa' ? vistaMesa(ctx) : ctx.ui.vista === 'micuenta' ? vistaMiCuenta(ctx) : vistaMesas(ctx); },
  };
})();
