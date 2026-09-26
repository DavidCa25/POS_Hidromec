/*
 * SEGUIMIENTO INDIVIDUAL: EL PEDIDO DE UNA PERSONA EN SU TELEFONO.
 *
 * Conservado para una version futura: hoy el QR de la pantalla de la caja
 * lleva al tablero GENERAL (`/pedidos`), no aqui (ver qr-pantalla-cliente.js).
 *
 * Arriba, SU numero y lo que le importa: ¿ya esta? Debajo, el mismo estado
 * de pedidos que la TV del local, con el suyo marcado. Se actualiza solo
 * mientras la pagina esta a la vista; cuando pasa a Listo, vibra.
 *
 * Solo lee (GET /api/p/:codigo). No guarda nada en el telefono.
 */
(() => {
  'use strict';
  const codigo = (location.pathname.match(/^\/p\/([0-9A-Fa-f]{32})$/) || [])[1];
  const raiz = document.getElementById('seg');
  const CADA_MS = 5000;

  const ESTADOS = {
    RECIBIDO: { titulo: 'Recibido', texto: 'Tu pedido está registrado y pasa a preparación en un momento.', icono: 'clipboard-text' },
    PREPARANDO: { titulo: 'En preparación', texto: 'Te avisamos aquí en cuanto esté listo. Deja esta página abierta.', icono: 'clock' },
    LISTO: { titulo: '¡Listo!', texto: 'Pasa por tu pedido al mostrador.', icono: 'check-circle' },
    ENTREGADO: { titulo: 'Entregado', texto: '¡Buen provecho!', icono: 'check-circle' },
    CANCELADO: { titulo: 'Cancelado', texto: 'Pregunta en caja.', icono: 'clipboard-text' },
  };

  let ultimo = null;
  let sinRed = false;
  let temporizador = null;

  function el(tag, attrs = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = String(v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const h of hijos.flat()) if (h != null) n.append(h.nodeType ? h : document.createTextNode(String(h)));
    return n;
  }

  function mensaje(titulo, texto) {
    raiz.replaceChildren(el('section', { class: 'seg__aviso' },
      el('i', { class: 'ico ico-clipboard-text', 'aria-hidden': 'true' }),
      el('h1', { text: titulo }),
      el('p', { text: texto })));
  }

  function chips(lista, clase, mio) {
    if (!lista.length) return el('p', { class: 'seg__nada', text: 'Ninguno por ahora' });
    return el('div', { class: `seg__chips ${clase}` }, ...lista.map(p =>
      el('span', { class: p.numeroPedido === mio ? 'es-mio' : null, 'aria-current': p.numeroPedido === mio ? 'true' : null, text: p.numeroPedido })));
  }

  function pintar(d) {
    const e = ESTADOS[d.estado] || ESTADOS.RECIBIDO;
    const listos = d.pedidos.filter(p => p.estado === 'LISTO' && p.numeroPedido != null);
    const prep = d.pedidos.filter(p => p.estado === 'PREPARANDO' && p.numeroPedido != null);
    document.title = d.estado === 'LISTO' ? `¡Listo! · Pedido ${d.numeroPedido}` : `Pedido ${d.numeroPedido} · ${e.titulo}`;
    raiz.replaceChildren(
      el('header', { class: 'seg__cab' },
        el('span', { class: 'seg__negocio', text: d.negocio || 'Tu pedido' }),
        sinRed ? el('span', { class: 'seg__red', text: 'Sin conexión con el local' }) : null),
      el('section', { class: `seg__tuyo es-${d.estado.toLowerCase()}`, 'aria-label': `Tu pedido ${d.numeroPedido}: ${e.titulo}` },
        el('span', { class: 'seg__et', text: 'Tu pedido' }),
        el('b', { class: 'seg__num', text: d.numeroPedido }),
        el('span', { class: 'seg__estado' }, el('i', { class: `ico ico-${e.icono}`, 'aria-hidden': 'true' }), e.titulo),
        el('p', { class: 'seg__texto', text: e.texto })),
      el('section', { class: 'seg__todos', 'aria-label': 'Estado de pedidos' },
        el('h2', {}, 'Listos', el('b', { text: listos.length })),
        chips(listos, 'seg__chips--listos', d.numeroPedido),
        el('h2', {}, 'En preparación', el('b', { text: prep.length })),
        chips(prep, '', d.numeroPedido)),
      el('p', { class: 'seg__pie', text: sinRed
        ? 'No llegamos al local. Revisa que estés conectado a su Wi-Fi.'
        : 'Esta página se actualiza sola.' }));
  }

  async function leer() {
    clearTimeout(temporizador);
    try {
      const r = await fetch(`/api/p/${codigo}`, { cache: 'no-store', credentials: 'omit' });
      if (r.status === 404) { mensaje('Este pedido ya no está disponible', 'El seguimiento dura el día del pedido. Si tienes dudas, pregunta en caja.'); return; }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      /* Paso a Listo: una vibracion, si el telefono la permite. */
      if (ultimo && ultimo.estado !== 'LISTO' && d.estado === 'LISTO') {
        try { navigator.vibrate?.([220, 120, 220]); } catch { /* sin vibracion */ }
      }
      sinRed = false;
      ultimo = d;
      pintar(d);
    } catch {
      sinRed = true;
      if (ultimo) pintar(ultimo);
      else mensaje('No llegamos al local', 'Conéctate al Wi-Fi del local y vuelve a escanear el código.');
    }
    if (ultimo && (ultimo.estado === 'ENTREGADO' || ultimo.estado === 'CANCELADO')) return;
    if (document.visibilityState === 'visible') temporizador = setTimeout(leer, CADA_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void leer();
    else clearTimeout(temporizador);
  });

  if (!codigo) mensaje('Código no válido', 'Vuelve a escanear el código de la pantalla de la caja.');
  else void leer();
})();
