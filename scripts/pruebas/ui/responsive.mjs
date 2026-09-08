/**
 * Revision responsive del Touch en las tres resoluciones de la caja objetivo.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/responsive.mjs
 *
 * Rechaza lo que no se puede vender: botones cortados o por debajo del area
 * tactil minima, el total fuera de pantalla, un dialogo fuera del viewport,
 * scroll horizontal, y tarjetas de producto de tamano absurdo.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));
const TAMANOS = [
  { w: 1366, h: 768, nombre: '1366x768' },
  { w: 1600, h: 900, nombre: '1600x900' },
  { w: 1920, h: 1080, nombre: '1920x1080' },
  // Escalado de Windows al 125%: la pantalla sigue siendo de 1366x768 fisicos
  // pero el area util en pixeles CSS se encoge a 1092x614. Es el caso mas
  // apretado de la caja objetivo y el que mas gente tiene activado.
  { w: 1092, h: 614, escala: 1.25, nombre: '1366x768-escala125' },
];

const MEDIR = `
  const fuera = (r) => r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5;
  const res = { ancho: innerWidth, alto: innerHeight, problemas: [] };

  res.scrollHorizontal = document.documentElement.scrollWidth > innerWidth + 1;
  if (res.scrollHorizontal) res.problemas.push('la pagina se desplaza en horizontal');

  // Un elemento por debajo del borde dentro de una region con scroll no esta
  // cortado: esta mas abajo en la lista. Lo que no puede pasar es que quede
  // fuera SIN forma de alcanzarlo, o que se salga en horizontal.
  const enRegionConScroll = (el) => {
    let p = el.parentElement;
    while (p) {
      const ov = getComputedStyle(p).overflowY;
      if (ov === 'auto' || ov === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };

  const controles = [...document.querySelectorAll('.tp button:not(:disabled), .tp .tp-cat, .tp .tp-card')];
  let bajos = 0, cortados = 0;
  for (const b of controles) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const seSaleEnHorizontal = r.left < -0.5 || r.right > innerWidth + 0.5;
    const seSaleEnVertical = r.top < -0.5 || r.bottom > innerHeight + 0.5;
    if (seSaleEnHorizontal || (seSaleEnVertical && !enRegionConScroll(b))) cortados++;
    if (r.height < 40) bajos++;
  }
  res.controles = controles.length;
  res.cortados = cortados;
  res.bajos = bajos;
  if (cortados) res.problemas.push(cortados + ' controles inalcanzables o cortados');
  if (bajos) res.problemas.push(bajos + ' controles por debajo de 40px de alto');

  // El total y el boton de cobro son lo que el cajero mira al final.
  const total = document.querySelector('.tp-total');
  if (total) {
    const r = total.getBoundingClientRect();
    res.totalVisible = !fuera(r);
    if (!res.totalVisible) res.problemas.push('el total queda fuera de pantalla');
  }

  // Tamano de tarjeta: ni miniaturas ni bloques absurdos.
  const card = document.querySelector('.tp-card');
  if (card) {
    const r = card.getBoundingClientRect();
    res.card = { ancho: Math.round(r.width), alto: Math.round(r.height) };
    if (r.width < 140 || r.width > 260) res.problemas.push('tarjeta de ' + Math.round(r.width) + 'px');
  }
  const grid = document.querySelector('.tp-grid');
  if (grid) {
    res.columnas = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    if (res.columnas < 3 || res.columnas > 6) res.problemas.push(res.columnas + ' columnas en la rejilla');
  }
  return res;
`;

export default async function ({ ev, captura, cdp }) {
  const informe = [];
  try { await ev(`location.href = 'http://localhost:4200/touch'; return true;`); } catch {}
  await pausa(5000);

  for (const t of TAMANOS) {
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: t.w, height: t.h, deviceScaleFactor: t.escala || 1, mobile: false,
    });
    await pausa(900);

    // --- menu con la cuenta cargada
    const base = await ev(`
      const c = ng.getComponent(document.querySelector('app-touch-pos'));
      for (let i = 0; i < 30 && c.cargando(); i++) await new Promise(s => setTimeout(s, 300));
      c.cerrarHoja && c.cerrarHoja();
      c.mostrarCambio.set(false);
      c.cart.clearActive();
      const p = c.productos().filter(x => x.available_units > 0);
      for (const x of p.slice(0, 3)) c.tocar(x);
      ng.applyChanges(c);
      await new Promise(s => setTimeout(s, 350));
      ${MEDIR}
    `);
    await captura(`docs/evidencias/design/responsive/${t.nombre}-menu.png`);

    // --- hoja de modificadores (el dialogo mas alto)
    const hoja = await ev(`
      const c = ng.getComponent(document.querySelector('app-touch-pos'));
      const m = c.productos().find(x => x.has_modifiers);
      if (m) c.abrirHoja(m);
      ng.applyChanges(c);
      await new Promise(s => setTimeout(s, 600));
      const h = document.querySelector('.tp-hoja');
      const r = h ? h.getBoundingClientRect() : null;
      const out = { hay: !!h, problemas: [] };
      if (!h) out.nota = 'este catalogo no tiene productos con modificadores';
      if (r) {
        out.caja = { ancho: Math.round(r.width), alto: Math.round(r.height) };
        if (r.top < -0.5 || r.bottom > innerHeight + 0.5) out.problemas.push('la hoja se sale en vertical');
        if (r.left < -0.5 || r.right > innerWidth + 0.5) out.problemas.push('la hoja se sale en horizontal');
        const add = document.querySelector('.tp-hoja__add');
        if (add) {
          const ra = add.getBoundingClientRect();
          out.agregarVisible = ra.bottom <= innerHeight + 0.5 && ra.top >= -0.5;
          if (!out.agregarVisible) out.problemas.push('el boton Agregar queda fuera');
        }
      }
      return out;
    `);
    await captura(`docs/evidencias/design/responsive/${t.nombre}-hoja.png`);

    // --- cobro
    const cobro = await ev(`
      const c = ng.getComponent(document.querySelector('app-touch-pos'));
      c.cerrarHoja();
      await c.irACobro();
      ng.applyChanges(c);
      await new Promise(s => setTimeout(s, 500));
      ${MEDIR}
    `);
    await captura(`docs/evidencias/design/responsive/${t.nombre}-cobro.png`);

    await ev(`
      const c = ng.getComponent(document.querySelector('app-touch-pos'));
      c.volverAlMenu(); c.cart.clearActive(); ng.applyChanges(c);
      return true;
    `);

    informe.push({ tamano: t.nombre, menu: base, hoja, cobro });
    const fallos = [...base.problemas, ...hoja.problemas, ...cobro.problemas];
    console.log(`\n${t.nombre}`);
    console.log(`  menu   tarjeta ${base.card?.ancho}x${base.card?.alto}px · ${base.columnas} columnas · ${base.controles} controles`);
    console.log(hoja.hay
      ? `  hoja   ${hoja.caja?.ancho}x${hoja.caja?.alto}px`
      : `  hoja   no evaluable: ${hoja.nota}`);
    console.log(`  cobro  ${cobro.controles} controles`);
    console.log(fallos.length ? '  FALLA: ' + fallos.join('; ') : '  OK  sin recortes, sin scroll horizontal, total visible');
  }

  await cdp('Emulation.clearDeviceMetricsOverride', {});
  const malos = informe.filter(i => i.menu.problemas.length || i.hoja.problemas.length || i.cobro.problemas.length);
  console.log(`\n${informe.length - malos.length}/${informe.length} resoluciones sin problemas.`);
  return informe;
}
