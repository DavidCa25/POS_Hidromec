/*
 * PREPARATION — el KDS de siempre (concepto A · carriles claros), ahora como
 * una funcion mas de la carcasa. Suena SOLO una comanda nueva que llega en
 * tiempo real; lo que se recupera al reconectar se anuncia una vez en texto.
 */
(() => {
  'use strict';
  const CARRILES = [
    { estado: 'NUEVA', titulo: 'Nuevas', vacio: 'Sin comandas nuevas.' },
    { estado: 'PREPARANDO', titulo: 'En preparación', vacio: 'Nada en preparación.' },
    { estado: 'LISTA', titulo: 'Listas', vacio: 'Nada esperando a salir.' },
  ];
  const PENDIENTES = new Set(['NUEVA', 'PREPARANDO', 'LISTA']);

  const nombreDeMesa = (n) => { const t = String(n ?? '').trim(); return /^\d+$/.test(t) ? `Mesa ${t}` : (t || 'Barra'); };

  function ui(ctx) {
    const u = ctx.ui;
    u.comandas = u.comandas || new Map();
    u.vistas = u.vistas || new Set();
    u.recien = u.recien || new Set();
    u.ocupadas = u.ocupadas || new Set();
    return u;
  }

  function guardar(u, c, dispositivo, ahora = Date.now()) {
    if (!c) return;
    if (!PENDIENTES.has(c.estado)) { u.comandas.delete(Number(c.id)); return; }
    if (dispositivo && !dispositivo.todas && Number(c.stationId) !== Number(dispositivo.stationId)) return;
    u.comandas.set(Number(c.id), { ...c, leidaEn: ahora });
  }

  function marcarRecien(ctx, id) {
    const u = ui(ctx);
    u.recien.add(id);
    setTimeout(() => { u.recien.delete(id); ctx.pintar(); }, 6000);
  }

  const segundos = (c) => Math.max(0, Math.floor(c.segundos + (Date.now() - c.leidaEn) / 1000));
  const reloj = (c) => { const x = segundos(c); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
  function temperatura(ctx, c) {
    if (c.estado === 'LISTA') return 'fria';
    const um = ctx.datos?.umbrales || { avisoMin: 8, atrasoMin: 15 };
    const m = Math.floor(segundos(c) / 60);
    return m >= um.atrasoMin ? 'atraso' : m >= um.avisoMin ? 'aviso' : 'fria';
  }

  async function avanzar(ctx, c) {
    const u = ui(ctx);
    const id = Number(c.id);
    if (u.ocupadas.has(id)) return;
    u.ocupadas.add(id);
    ctx.pintar();
    const r = await ctx.accion('AVANZAR', { id, desde: c.estado });
    u.ocupadas.delete(id);
    if (r?.comanda) {
      guardar(u, r.comanda, ctx.dispositivo);
      if (r.repetido) ctx.avisar('Otra pantalla ya la había movido.');
    }
    ctx.pintar();
  }

  function tarjeta(ctx, c) {
    const { el } = ctx;
    const u = ui(ctx);
    const paso = c.siguiente;
    const clases = ['card', `es-${c.estado.toLowerCase()}`, `t-${temperatura(ctx, c)}`, u.recien.has(Number(c.id)) ? 'es-recien' : ''].join(' ');
    return el('article', { class: clases, 'data-id': c.id, 'aria-label': `Comanda ${c.id}, ${nombreDeMesa(c.destino)}` },
      el('header', { class: 'card__cab' },
        el('b', { class: 'card__dest', text: nombreDeMesa(c.destino) }),
        el('span', { class: 'card__reloj', 'data-reloj': c.id, text: reloj(c) }),
        el('small', { class: 'card__donde' },
          ctx.dispositivo?.todas ? `${c.estacion} · ` : '',
          c.area ? `${c.area} · ` : '',
          el('span', { class: 'card__num', text: `#${c.id}` }))),
      el('ul', { class: 'card__lineas' }, ...(c.lineas || []).map(l =>
        el('li', {},
          el('span', { class: 'l__cant', text: l.cantidad }),
          el('span', { class: 'l__cuerpo' },
            el('span', { class: 'l__nom', text: l.nombre }),
            ...(l.opciones || []).map(o => el('span', { class: 'l__op', text: o })),
            l.nota ? el('span', { class: 'l__nota', text: l.nota }) : null)))),
      paso ? el('button', { type: 'button', class: 'paso', 'data-clave': `paso-${c.id}`,
        disabled: u.ocupadas.has(Number(c.id)), text: paso.texto, onclick: () => avanzar(ctx, c) }) : null);
  }

  window.WX.superficies.PREPARATION = {
    titulo: (ctx) => (ctx.datos?.todas ? 'Todas las estaciones' : (ctx.datos?.estacion || ctx.dispositivo?.estacion || 'Cocina')),

    /** Al (re)sincronizar: lo nuevo que no llego en vivo se ANUNCIA, sin sonar. */
    alSincronizar(ctx, modo) {
      const u = ui(ctx);
      const antes = new Set(u.comandas.keys());
      const ahora = Date.now();
      u.comandas.clear();
      for (const c of ctx.datos?.comandas || []) guardar(u, c, ctx.dispositivo, ahora);
      if (modo === 'inicio') { for (const id of u.comandas.keys()) u.vistas.add(id); return; }
      /* Una comanda de hace un par de segundos puede tener su aviso en camino. */
      const nuevas = [...u.comandas.values()].filter(c =>
        c.estado === 'NUEVA' && !antes.has(Number(c.id)) && !u.vistas.has(Number(c.id)) && c.segundos >= 5);
      if (nuevas.length) {
        for (const c of nuevas) { u.vistas.add(Number(c.id)); marcarRecien(ctx, Number(c.id)); }
        const t = nuevas.length === 1 ? '1 comanda pendiente recuperada.' : `${nuevas.length} comandas pendientes recuperadas.`;
        ctx.franja('aviso', `${t} Llegaron mientras no había conexión.`);
      }
    },

    /** El evento trae la comanda: se actualiza aqui mismo, sin volver a pedir todo. */
    alEvento(ev, ctx) {
      const u = ui(ctx);
      const c = ev.datos?.comanda;
      if (ev.tipo === 'PREPARATION_TICKET_CREATED') {
        const id = Number(ev.id);
        if (u.vistas.has(id)) ev.sonar = false;           // ya anunciada: no suena dos veces
        u.vistas.add(id);
        guardar(u, c, ctx.dispositivo);
        if (u.comandas.has(id)) marcarRecien(ctx, id);
        return true;
      }
      if (ev.tipo === 'PREPARATION_UPDATED') {
        if (c) guardar(u, c, ctx.dispositivo); else u.comandas.delete(Number(ev.id));
        return true;
      }
      return false;
    },

    tic(ctx) {
      const u = ui(ctx);
      let cambio = false;
      for (const nodo of document.querySelectorAll('[data-reloj]')) {
        const c = u.comandas.get(Number(nodo.getAttribute('data-reloj')));
        if (!c) continue;
        nodo.textContent = reloj(c);
        const card = nodo.closest('.card');
        if (card && !card.classList.contains(`t-${temperatura(ctx, c)}`)) cambio = true;
      }
      if (cambio) ctx.pintar();
    },

    render(ctx) {
      const { el } = ctx;
      const u = ui(ctx);
      const lista = [...u.comandas.values()].sort((a, b) => a.id - b.id);
      const n = (e) => lista.filter(c => c.estado === e).length;
      const atrasadas = lista.filter(c => temperatura(ctx, c) === 'atraso').length;
      const prom = ctx.datos?.reposo?.promedioMin;
      const resumen = el('section', { class: 'reposo', 'aria-label': 'Resumen' },
        el('div', {},
          el('ul', { class: 'reposo__cifras' },
            el('li', {}, el('b', { text: n('NUEVA') }), n('NUEVA') === 1 ? 'nueva' : 'nuevas'),
            el('li', {}, el('b', { text: n('PREPARANDO') }), 'preparando'),
            el('li', {}, el('b', { text: n('LISTA') }), n('LISTA') === 1 ? 'lista' : 'listas'),
            atrasadas ? el('li', { class: 'tarde' }, el('b', { text: atrasadas }), atrasadas === 1 ? 'atrasada' : 'atrasadas') : null)),
        prom != null ? el('div', { class: 'reposo__sig' }, el('small', { text: 'Tiempo promedio hoy' }), el('b', { text: `${prom} min` })) : null);

      if (!lista.length) {
        return [resumen, el('section', { class: 'vacio' },
          el('h2', { text: 'Todo al día' }),
          el('p', { text: 'No hay comandas pendientes. Las nuevas aparecen aquí solas, en cuanto una caja las envía.' }))];
      }
      return [resumen, el('div', { class: 'tablero' }, ...CARRILES.map(k => {
        const cs = lista.filter(c => c.estado === k.estado);
        return el('section', { class: `carril es-${k.estado.toLowerCase()}`, 'aria-label': k.titulo },
          el('header', { class: 'carril__cab' },
            el('span', { class: 'carril__punto', 'aria-hidden': 'true' }),
            el('h2', { text: k.titulo }),
            el('span', { class: 'carril__n', text: cs.length })),
          cs.length ? null : el('p', { class: 'carril__nada', text: k.vacio }),
          el('div', { class: 'carril__lista' }, ...cs.map(c => tarjeta(ctx, c))));
      }))];
    },
  };
})();
