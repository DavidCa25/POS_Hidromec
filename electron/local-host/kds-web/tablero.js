/*
 * ARRANQUE DEL TABLERO PUBLICO (/pedidos) EN UN TELEFONO.
 *
 * No hay una segunda implementacion del tablero: esto le da a la superficie
 * CUSTOMER_STATUS (s-cliente.js, la de la TV) lo poco que necesita -`el`,
 * sus datos, si hay conexion- y la relee de `/api/pedidos`, que sale de la
 * MISMA funcion que la TV (`pedidosPublicos`). Lo que cambia en el telefono
 * lo decide el CSS.
 *
 * Solo lee. No guarda nada en el telefono.
 */
window.WX = window.WX || { superficies: {} };
(() => {
  'use strict';
  const CADA_MS = 5000;
  const raiz = document.getElementById('app');
  let datos = null;
  let sinConexion = false;
  let temporizador = null;

  function el(tag, attrs = {}, ...hijos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(9)) if (h != null && h !== false) n.append(h.nodeType ? h : document.createTextNode(String(h)));
    return n;
  }

  const ctx = () => ({ el, datos, sinConexion, refrescar: () => leer() });

  function pintar() {
    const s = window.WX.superficies.CUSTOMER_STATUS;
    if (!s) return;
    raiz.replaceChildren(...s.render(ctx()));
  }

  function aviso(titulo, texto) {
    raiz.replaceChildren(el('section', { class: 'seg__aviso' },
      el('i', { class: 'ico ico-clipboard-text', 'aria-hidden': 'true' }),
      el('h1', { text: titulo }), el('p', { text: texto })));
  }

  async function leer() {
    clearTimeout(temporizador);
    try {
      const r = await fetch('/api/pedidos', { cache: 'no-store', credentials: 'omit' });
      if (r.status === 404) { aviso('Pedidos no disponibles', 'Este negocio no tiene el tablero de pedidos encendido.'); return; }
      if (!r.ok) throw new Error(String(r.status));
      datos = await r.json();
      sinConexion = false;
      pintar();
    } catch {
      sinConexion = true;
      if (datos) pintar();
      else aviso('No llegamos al local', 'Conéctate al Wi-Fi del local y vuelve a escanear el código.');
    }
    if (document.visibilityState === 'visible') temporizador = setTimeout(leer, CADA_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void leer();
    else clearTimeout(temporizador);
  });
  setInterval(() => { const s = window.WX.superficies.CUSTOMER_STATUS; if (s?.tic && datos) s.tic(ctx()); }, 1000);
  document.addEventListener('DOMContentLoaded', () => void leer());
})();
