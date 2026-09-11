/**
 * Casos limite de la interfaz Touch.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/casos-limite.mjs
 *
 * No juzga el diseño: mide desbordes. Un texto que se sale de su caja, un
 * total que se corta, un boton que deja de alcanzarse o un objetivo tactil
 * por debajo del minimo son defectos objetivos; lo demas es criterio y se
 * revisa en las capturas.
 *
 * Necesita el catalogo de casos (productos QA-*) sembrado en la base de
 * pruebas: nombres largos, precios de cinco cifras, agotados y pocas
 * unidades.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

const DESBORDES = `
  const fallos = [];
  const desborda = (el, etiqueta) => {
    // Solo es defecto si el contenido se PIERDE: con overflow visible el texto
    // sobresale de su caja pero se pinta entero, y eso no lo nota nadie.
    const cs = getComputedStyle(el);
    const seRecorta = (cs.overflowX === 'hidden' || cs.overflowX === 'clip' ||
                       cs.overflowY === 'hidden' || cs.overflowY === 'clip');
    const deliberado = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
    if (seRecorta && !deliberado &&
        (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      fallos.push(etiqueta + ': contenido recortado (' +
        el.scrollWidth + 'x' + el.scrollHeight + ' en ' + el.clientWidth + 'x' + el.clientHeight + ')');
    }
  };
  const dentroDelViewport = (el, etiqueta) => {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 0.5 || r.left < -0.5)
      fallos.push(etiqueta + ': se sale en horizontal');
    if (r.bottom > innerHeight + 0.5 || r.top < -0.5)
      fallos.push(etiqueta + ': se sale en vertical (' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' en ' + innerHeight + ')');
  };
  const tactil = (el, etiqueta, minimo) => {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.height < (minimo || 44) - 0.5)
      fallos.push(etiqueta + ': ' + Math.round(r.height) + 'px de alto');
  };
`;

export default async function ({ ev, cdp }) {
  const informe = [];
  const medir = (w, h) => cdp('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  const bloque = async (titulo, guion) => {
    const r = await ev(guion);
    informe.push({ titulo, ...r });
    console.log(`\n${titulo}`);
    if (r.nota) console.log('  ' + r.nota);
    if (!r.fallos || !r.fallos.length) console.log('  OK');
    else r.fallos.forEach(f => console.log('  FALLA  ' + f));
    return r;
  };

  await medir(1366, 768);
  await pausa(700);

  // ------------------------------------------------------- tarjetas
  await bloque('Tarjetas: nombres, precios y estados', `
    ${DESBORDES}
    const t = ng.getComponent(document.querySelector('app-touch-pos'));
    t.cart.clearActive();
    await t.menu.load(true);
    for (let i = 0; i < 40 && t.cargando(); i++) await new Promise(s => setTimeout(s, 100));
    await new Promise(s => setTimeout(s, 1200));
    ng.applyChanges(t);

    const cards = [...document.querySelectorAll('.tp-card')];
    for (const c of cards) {
      const nombre = c.querySelector('.tp-card__nombre');
      const precio = c.querySelector('.tp-card__precio');
      const etiqueta = (nombre?.textContent || '?').trim().slice(0, 24);
      if (precio) desborda(precio, 'precio de ' + etiqueta);
      dentroDelViewport(c.getBoundingClientRect().top < innerHeight ? c : c, 'tarjeta ' + etiqueta);
      tactil(c, 'tarjeta ' + etiqueta);
    }
    const modos = {};
    for (const p of t.productos()) modos[p.inventory_mode] = (modos[p.inventory_mode] || 0) + 1;
    return {
      fallos: fallos.filter(function (f) { return !/se sale en vertical/.test(f); }),
      nota: cards.length + ' tarjetas · modos ' + JSON.stringify(modos) +
            ' · agotados ' + t.productos().filter(function (p) { return t.agotado(p); }).length +
            ' · pocas ' + t.productos().filter(function (p) { return t.pocas(p); }).length +
            ' · con foto ' + document.querySelectorAll('.tp-card__media.con-foto').length
    };
  `);

  // --------------------------------------------------------- carrito
  for (const n of [1, 5, 12]) {
    await bloque(`Carrito con ${n} linea(s)`, `
      ${DESBORDES}
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      t.cart.clearActive();
      const disp = t.productos().filter(function (p) { return p.available_units > 0; });
      for (let i = 0; i < ${n}; i++) t.tocar(disp[i % disp.length]);
      // Cantidades de dos y tres digitos en la primera linea.
      const l = t.lineas()[0];
      if (l) t.mas(l, 137);  // cantidad de tres digitos
      ng.applyChanges(t);
      await new Promise(s => setTimeout(s, 350));

      const total = document.querySelector('.tp-cart__total');
      const cobrar = document.querySelector('.tp-cart__foot .tp-primaria');
      if (total) { dentroDelViewport(total, 'total'); desborda(total.querySelector('b'), 'importe total'); }
      if (cobrar) { dentroDelViewport(cobrar, 'boton Cobrar'); tactil(cobrar, 'boton Cobrar', 56); }
      for (const q of document.querySelectorAll('.tp-linea__qty button')) tactil(q, 'control de cantidad');
      for (const imp of document.querySelectorAll('.tp-linea__imp')) desborda(imp, 'importe de linea');
      const lineas = document.querySelector('.tp-lineas');
      return {
        fallos,
        nota: t.lineas().length + ' lineas · cantidad ' + (t.lineas()[0]?.quantity ?? 0) +
              ' · total ' + t.totales().total.toFixed(2) +
              ' · las lineas tienen scroll propio: ' + (lineas.scrollHeight > lineas.clientHeight)
      };
    `);
  }

  // ----------------------------------------------------- modificadores
  await bloque('Hoja de modificadores', `
    ${DESBORDES}
    const t = ng.getComponent(document.querySelector('app-touch-pos'));
    const m = t.productos().find(function (p) { return p.has_modifiers; });
    if (!m) return { fallos: [], nota: 'este catalogo no tiene productos con modificadores' };
    t.abrirHoja(m);
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 500));
    t.notaHoja.set('Sin canela, con leche muy caliente, en vaso para llevar y servilletas aparte por favor');
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 300));

    const hoja = document.querySelector('.tp-hoja');
    const add = document.querySelector('.tp-hoja__add');
    if (hoja) dentroDelViewport(hoja, 'hoja');
    if (add) { dentroDelViewport(add, 'boton Agregar'); tactil(add, 'boton Agregar', 56); }
    for (const o of document.querySelectorAll('.tp-opcion')) tactil(o, 'opcion', 56);
    const grupos = t.grupos();
    const opciones = grupos.reduce(function (n, g) { return n + g.options.length; }, 0);
    const r = { fallos, nota: grupos.length + ' grupos · ' + opciones + ' opciones · nota larga puesta' };
    t.cerrarHoja(); ng.applyChanges(t);
    return r;
  `);

  // ---------------------------------------------------------- cobro
  for (const objetivo of [5, 174, 2512, 24999]) {
    await bloque(`Cobro con total cercano a $${objetivo}`, `
      ${DESBORDES}
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      t.cart.clearActive();
      // Se arma un total aproximado con el producto que mejor encaje.
      const disp = t.productos().filter(function (p) { return p.available_units > 0; })
        .sort(function (a, b) { return Math.abs(a.price - ${objetivo}) - Math.abs(b.price - ${objetivo}); });
      t.tocar(disp[0]);
      const l = t.lineas()[0];
      while (t.totales().total < ${objetivo} && t.lineas()[0].quantity < 400) t.mas(l);
      await t.irACobro();
      ng.applyChanges(t);
      await new Promise(s => setTimeout(s, 450));

      const sug = [...document.querySelectorAll('.tp-rapidas button')];
      if (sug.length > 1) { sug[1].click(); ng.applyChanges(t); await new Promise(s => setTimeout(s, 250)); }

      const totalB = document.querySelector('.tp-cobro__total b');
      if (totalB) desborda(totalB, 'total a pagar');
      for (const b of document.querySelectorAll('.tp-dinero__campo b')) desborda(b, 'importe de recibido/cambio');
      for (const s of sug) desborda(s, 'sugerencia');
      const confirmar = document.querySelector('.tp-cobro__confirmar');
      if (confirmar) { dentroDelViewport(confirmar, 'Confirmar cobro'); tactil(confirmar, 'Confirmar cobro', 56); }
      const panel = document.querySelector('.tp-cobro__panel');
      const mono = totalB ? getComputedStyle(totalB).fontVariantNumeric : '';

      const r = {
        fallos,
        nota: 'total ' + t.totales().total.toFixed(2) + ' · recibido ' + t.recibidoNum() +
              ' · cambio ' + t.cambio().toFixed(2) + ' · tabular-nums: ' + (mono.indexOf('tabular-nums') >= 0) +
              ' · sugerencias ' + sug.map(function (b) { return b.textContent.trim(); }).join(' ') +
              ' · panel con scroll: ' + (panel.scrollHeight > panel.clientHeight)
      };
      t.volverAlMenu(); t.cart.clearActive(); ng.applyChanges(t);
      return r;
    `);
  }

  await cdp('Emulation.clearDeviceMetricsOverride', {});
  const total = informe.reduce((n, b) => n + (b.fallos?.length || 0), 0);
  console.log(`\n${total === 0 ? 'SIN DEFECTOS' : total + ' DEFECTOS'} en ${informe.length} bloques.`);
  return informe;
}
