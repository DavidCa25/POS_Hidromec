/*
 * CUSTOMER_STATUS — el tablero de pedidos (diseño B2: hero + muro de listos).
 *
 * UNA sola superficie para la TV del local, una tablet del negocio y el
 * telefono del cliente (ruta publica /pedidos, que la arranca tablero.js).
 * Los datos son los mismos (`pedidosPublicos` en el Host); lo que cambia de
 * una pantalla a otra lo decide el CSS.
 *
 * Contesta de lejos «¿ya esta el mio?»:
 *   - HERO: el pedido que ACABA de quedar listo, en verde solido, unos
 *     segundos. El verde fuerte significa «recien listo», no «el ultimo».
 *   - LISTOS: el muro. El numero manda; el primer nombre ayuda.
 *   - EN PREPARACION: la franja de abajo.
 *
 * Solo llega el DTO publico { numeroPedido, estado, nombrePublico, reciente,
 * mesa? }: aqui no hay nada que ocultar. Siempre oscura: es una TV del local.
 */
(() => {
  'use strict';
  const hora = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  /* Con un hero a la vista, se relee cada tanto para que pase al muro. */
  const RELEER_HERO_MS = 10000;
  let heroDesde = 0;

  const clave = (p) => (p.numeroPedido != null ? String(p.numeroPedido) : p.mesa);

  window.WX.superficies.CUSTOMER_STATUS = {
    publica: true,
    conSonido: true,
    render(ctx) {
      const { el } = ctx;
      const d = ctx.datos || { pedidos: [] };
      const listos = d.pedidos.filter(p => p.estado === 'LISTO');
      const prep = d.pedidos.filter(p => p.estado === 'PREPARANDO');
      /* El recien listo mas reciente va al hero; los demas, al muro. */
      const hero = listos.find(p => p.reciente) || null;
      const muroListos = hero ? listos.filter(p => p !== hero) : listos;
      heroDesde = hero ? (heroDesde || Date.now()) : 0;

      /* Columnas para que las filas queden parejas (5 = 3+2, 11 = 4+4+3). */
      const n = muroListos.length;
      const COLS = [1, 1, 2, 3, 4, 3, 3, 4, 4, 5, 5, 4, 4, 5, 5, 5, 6, 6, 6];
      /* Con hero, el muro es secundario: fichas de tarjeta, no una sola
         ficha estirada a lo ancho de la pantalla. */
      const cols = hero ? Math.max(4, COLS[Math.min(n, COLS.length - 1)] || 6) : (COLS[Math.min(n, COLS.length - 1)] || 6);
      const filas = Math.max(1, Math.ceil(n / cols));
      const tam = hero ? (n <= 4 ? 'm' : 's') : (n <= 1 ? 'xl' : n <= 4 ? 'l' : n <= 9 ? 'm' : 's');

      const ficha = (p) => el('div', {
        class: `muro__n ${p.numeroPedido == null ? 'muro__n--mesa' : ''} ${p.reciente ? 'es-reciente' : ''}`,
        'data-pedido': p.numeroPedido ?? null, 'data-mesa': p.numeroPedido == null ? p.mesa : null,
      },
        el('b', { text: clave(p) }),
        p.nombrePublico ? el('span', { class: 'muro__nombre', text: p.nombrePublico }) : null,
        el('span', { class: 'muro__estado', text: 'Listo' }));

      const heroEl = hero ? el('section', { class: 'hero', 'aria-label': `Acaba de estar listo: ${clave(hero)}`, 'data-pedido': hero.numeroPedido ?? null },
        el('span', { class: 'hero__et', text: 'Acaba de estar listo' }),
        el('b', { class: `hero__num ${hero.numeroPedido == null ? 'hero__num--mesa' : ''}`, text: clave(hero) }),
        hero.nombrePublico ? el('span', { class: 'hero__nombre', text: hero.nombrePublico }) : null,
        el('span', { class: 'hero__accion', text: 'Pasa por tu pedido' })) : null;

      const muro = n
        ? el('div', { class: `muro muro--c${cols} muro--r${Math.min(filas, 4)} muro--${tam}` }, ...muroListos.map(ficha))
        : (hero ? null : el('div', { class: 'muro__vacio' },
            el('i', { class: 'ico ico-clock', 'aria-hidden': 'true' }),
            el('p', { text: 'Aún no hay pedidos listos' }),
            el('span', { text: 'Tu número aparecerá aquí en cuanto esté' })));

      return [el('div', { class: `pub ${hero ? 'pub--hero' : ''}` },
        el('header', { class: 'pub__cab' },
          el('span', { class: 'pub__negocio', text: d.negocio || 'Pedidos' }),
          ctx.sinConexion ? el('span', { class: 'pub__aviso', text: 'Actualizando…' }) : null,
          el('span', { class: 'pub__hora', id: 'hora-publica', text: hora() })),
        heroEl,
        el('section', { class: 'pub__listos', 'aria-label': 'Pedidos listos', 'aria-live': 'polite' },
          el('div', { class: 'pub__titulo' },
            el('h1', {}, el('i', { class: 'ico ico-check-circle', 'aria-hidden': 'true' }), 'Listos',
              el('b', { class: 'pub__cuenta', text: listos.length })),
            el('p', { class: 'pub__ayuda', text: 'Busca el número de tu ticket' })),
          muro),
        el('footer', { class: 'pub__prep', 'aria-label': 'En preparación' },
          el('h2', {}, 'En preparación', el('b', { text: prep.length })),
          prep.length
            ? el('div', { class: 'pub__nums' }, ...prep.map(p => el('span', {
                class: p.numeroPedido == null ? 'es-mesa' : null,
                'data-pedido': p.numeroPedido ?? null, 'data-mesa': p.numeroPedido == null ? p.mesa : null,
              }, el('b', { text: clave(p) }), p.nombrePublico ? el('small', { text: p.nombrePublico }) : null)))
            : el('div', { class: 'pub__nums' }, el('em', { text: 'Nada por ahora' })),
          el('span', { class: 'pub__msg', text: d.mensaje || 'Gracias por esperar' })))];
    },
    tic(ctx) {
      const h = document.getElementById('hora-publica');
      if (h) h.textContent = hora();
      if (heroDesde && Date.now() - heroDesde > RELEER_HERO_MS) { heroDesde = Date.now(); ctx.refrescar?.(50); }
    },
  };
})();
