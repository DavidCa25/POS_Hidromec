/**
 * Revision de accesibilidad del Touch, acotada a lo que importa en una caja.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/accesibilidad.mjs
 *
 * No es una auditoria WCAG. Comprueba cinco cosas que, si fallan, dejan la
 * pantalla inutilizable para alguien concreto:
 *   - un boton de solo icono sin nombre accesible no se puede anunciar;
 *   - sin foco visible, quien use teclado no sabe donde esta;
 *   - un boton "desactivado" solo por color se sigue pudiendo pulsar;
 *   - un estado que solo se distingue por color no llega a todo el mundo;
 *   - un objetivo tactil por debajo de 44 px se falla con el dedo.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

export default async function ({ ev, cdp }) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await pausa(700);

  const r = await ev(`
    const t = ng.getComponent(document.querySelector('app-touch-pos'));
    t.volverAlMenu(); t.cart.clearActive();
    const disp = t.productos().filter(function (p) { return p.available_units > 0; });
    for (const p of disp.slice(0, 2)) t.tocar(p);
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 400));

    const problemas = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const nombreDe = (el) =>
      (el.getAttribute('aria-label') || '').trim() ||
      (el.getAttribute('title') || '').trim() ||
      (el.textContent || '').replace(/\\s+/g, ' ').trim();

    // 1) Botones de solo icono con nombre accesible.
    let soloIcono = 0, sinNombre = [];
    for (const b of document.querySelectorAll('.tp button')) {
      if (!visible(b)) continue;
      const texto = (b.textContent || '').replace(/\\s+/g, ' ').trim();
      const tieneIcono = !!b.querySelector('i.ph, i[class*="ph-"]');
      if (tieneIcono && texto.length === 0) {
        soloIcono++;
        if (!nombreDe(b)) sinNombre.push(b.className || b.outerHTML.slice(0, 60));
      }
    }
    if (sinNombre.length) problemas.push(sinNombre.length + ' botones de solo icono sin nombre: ' + sinNombre.join(' | '));

    // 2) El foco se comprueba fuera, con tabulaciones reales: enfocar desde
    //    JS no activa focus-visible, que es justo lo que se quiere medir.

    // 3) Deshabilitado real, no solo visual.
    t.cart.clearActive();
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 300));
    const cobrar = document.querySelector('.tp-cart__foot .tp-primaria');
    const deshabilitadoDeVerdad = cobrar ? cobrar.disabled === true : null;
    if (cobrar && !deshabilitadoDeVerdad) problemas.push('Cobrar se ve apagado con la cuenta vacia pero sigue siendo pulsable');

    // 4) Estados que no dependen solo del color.
    for (const p of disp.slice(0, 2)) t.tocar(p);
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 300));
    const cuentaActiva = document.querySelector('.tp-cuenta.on');
    const catActiva = document.querySelector('.tp-cat.on');
    const agotada = document.querySelector('.tp-card.off');
    const senales = {
      cuentaActiva: cuentaActiva ? (getComputedStyle(cuentaActiva).fontWeight >= 600) : null,
      categoriaActivaConBarra: catActiva ? getComputedStyle(catActiva, '::before').width !== 'auto' : null,
      agotadoConTexto: agotada ? /agotado/i.test(agotada.textContent || '') : null
    };
    if (senales.agotadoConTexto === false) problemas.push('el agotado solo se distingue por color');

    // 5) Objetivos tactiles.
    const chicos = [];
    for (const b of document.querySelectorAll('.tp button:not(:disabled), .tp .tp-cat')) {
      if (!visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.height < 43.5) chicos.push((nombreDe(b) || b.className).slice(0, 28) + ' ' + Math.round(r.height) + 'px');
    }
    if (chicos.length) problemas.push(chicos.length + ' objetivos por debajo de 44px: ' + chicos.join(' | '));

    return {
      botonesSoloIcono: soloIcono,
      sinNombreAccesible: sinNombre.length,
      focoVisible: null,   // lo rellena el recorrido con Tab
      cobrarDeshabilitadoDeVerdad: deshabilitadoDeVerdad,
      senales: senales,
      objetivosPorDebajoDe44: chicos.length,
      problemas: problemas
    };
  `);

  // --- foco con tabulaciones de verdad
  const tab = async () => {
    for (const type of ['keyDown', 'keyUp']) {
      await cdp('Input.dispatchKeyEvent', {
        type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9
      });
    }
    await pausa(60);
  };
  const recorrido = [];
  await ev(`document.body.focus(); return true;`);
  for (let i = 0; i < 14; i++) {
    await tab();
    const paso = await ev(`
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        control: (el.className || el.tagName).toString().split(' ')[0],
        anillo: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
        color: cs.outlineColor
      };
    `);
    if (paso) recorrido.push(paso);
  }
  const conAnillo = recorrido.filter(p => p.anillo).length;
  r.focoVisible = `${conAnillo}/${recorrido.length} controles tabulados muestran anillo`;
  if (recorrido.length && conAnillo < recorrido.length) {
    r.problemas.push('sin anillo de foco: ' +
      recorrido.filter(p => !p.anillo).map(p => p.control).join(', '));
  }

  console.log(JSON.stringify(r, null, 2));
  await cdp('Emulation.clearDeviceMetricsOverride', {});
  console.log(r.problemas.length ? `\n${r.problemas.length} problema(s).` : '\nSin problemas.');
  return r;
}
