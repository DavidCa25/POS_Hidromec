/**
 * Evidencia visual de Wybix Touch.
 *
 *     npx electron ./electron/main.js --remote-debugging-port=9222
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/capturas.mjs
 *
 * Genera el set que se conserva como referencia del diseño cerrado: las
 * pantallas del Touch en tema claro y oscuro, el asistente, y el catalogo y
 * el cobro en las dos resoluciones de la caja objetivo. La pantalla de
 * cliente vive en otra ventana y tiene su propio guion (customer-display.mjs).
 *
 * El tema se fija a proposito: si cambia entre capturas, comparar dos series
 * no dice nada sobre el diseño.
 *
 * Registra UNA venta real, la del modal de cambio. Correr contra la base de
 * pruebas, nunca contra la del cliente.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));
const DIR = 'docs/evidencias/touch-v1';

const TEMA = (oscuro) => `
  localStorage.setItem('ui-dark', ${oscuro ? "'1'" : "'0'"});
  document.documentElement.classList.toggle('dark', ${oscuro});
  return true;
`;

export default async function ({ ev, captura, cdp }) {
  const hechas = [];
  const tomar = async (nombre, etiqueta) => {
    await cdp('Page.bringToFront', {});
    await pausa(300);
    await captura(`${DIR}/${nombre}.png`);
    hechas.push(`${DIR}/${nombre}.png`);
    console.log(`   ${DIR}/${nombre}.png   ${etiqueta}`);
  };
  const medir = (w, h) => cdp('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const tp = (cuerpo) => ev(`
    const t = ng.getComponent(document.querySelector('app-touch-pos'));
    for (let i = 0; i < 30 && t.cargando(); i++) await new Promise(s => setTimeout(s, 300));
    ${cuerpo}
  `);
  const conCuenta = (n) => tp(`
    t.volverAlMenu(); t.cart.clearActive();
    const disp = t.productos().filter(function (p) { return p.available_units > 0; });
    for (const p of disp.slice(0, ${n})) t.tocar(p);
    ng.applyChanges(t);
    return true;
  `);

  await ev(`
    const api = window.electronAPI;
    const users = await api.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    await api.setDeviceConfig({ deviceProfile: 'TOUCH_POS' });
    return true;
  `);

  await medir(1366, 768);
  await pausa(500);
  try { await ev(`location.href = 'http://localhost:4200/touch'; return true;`); } catch { /* navegar rompe el contexto */ }
  await pausa(5500);

  // ------------------------------------------------------------- temas
  console.log('\n── Touch');
  await ev(TEMA(true));
  await conCuenta(2);
  await pausa(800);
  await tomar('01-touch-dark', 'catalogo en tema oscuro');

  await ev(TEMA(false));
  await pausa(600);
  await tomar('02-touch-light', 'catalogo en tema claro');

  // ------------------------------------------------------------ cuenta
  await conCuenta(3);
  await tp(`
    const m = t.productos().find(function (p) { return p.has_modifiers; });
    if (m) {
      t.abrirHoja(m);
      await new Promise(s => setTimeout(s, 400));
      const g = t.grupos();
      const size = g.find(function (x) { return x.role === 'SIZE'; });
      if (size) t.alternarOpcion(size, size.options[size.options.length - 1]);
      const add = g.find(function (x) { return x.role === 'ADDON'; });
      if (add) t.alternarOpcion(add, add.options[0]);
      t.notaHoja.set('Sin canela');
      t.confirmarHoja();
    }
    ng.applyChanges(t);
    return true;
  `);
  await pausa(800);
  await tomar('03-touch-cart', 'cuenta con modificadores y nota');

  await tp(`
    const m = t.productos().find(function (p) { return p.has_modifiers; });
    if (m) t.abrirHoja(m);
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 500));
    const g = t.grupos();
    const size = g.find(function (x) { return x.role === 'SIZE'; });
    if (size) t.alternarOpcion(size, size.options[size.options.length - 1]);
    const add = g.find(function (x) { return x.role === 'ADDON'; });
    if (add) t.alternarOpcion(add, add.options[0]);
    ng.applyChanges(t);
    return true;
  `);
  await pausa(700);
  await tomar('04-touch-modifiers', 'hoja de opciones con seleccion');

  // ------------------------------------------------------------- cobro
  await tp(`t.cerrarHoja(); await t.irACobro(); ng.applyChanges(t); return true;`);
  await pausa(700);
  await tp(`const s = t.sugerencias(); if (s.length > 1) t.usarSugerencia(s[1]); ng.applyChanges(t); return true;`);
  await pausa(600);
  await tomar('05-touch-checkout', 'cobro en efectivo con cambio');

  const venta = await tp(`
    const res = await t.sale.checkout({ method: 'EFECTIVO', received: t.recibidoNum() },
                                      { openDrawer: false, autoPrint: false });
    if (res.ok) {
      t.ultimoCambio.set(res.change ?? 0); t.ultimoFolio.set(res.saleId);
      t.vista.set('menu'); t.mostrarCambio.set(true); t.menu.load(true);
    }
    ng.applyChanges(t);
    return { ok: res.ok, folio: res.saleId, cambio: res.change, error: res.error };
  `);
  await pausa(1100);
  await tomar('06-touch-success', `venta registrada, folio ${venta.folio}`);
  await tp(`t.cerrarCambio(); ng.applyChanges(t); return true;`);

  // --------------------------------------------------------- responsive
  console.log('\n── Responsive');
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    await medir(w, h);
    await pausa(700);
    await conCuenta(2);
    await pausa(600);
    await tomar(`10-catalogo-${w}`, `catalogo a ${w}x${h}`);
    await tp(`await t.irACobro(); ng.applyChanges(t); return true;`);
    await pausa(700);
    await tomar(`11-cobro-${w}`, `cobro a ${w}x${h}`);
    await tp(`t.volverAlMenu(); t.cart.clearActive(); ng.applyChanges(t); return true;`);
  }

  // ---------------------------------------------------------- asistente
  console.log('\n── Asistente');
  await medir(1366, 768);
  try { await ev(`location.href = 'http://localhost:4200/login'; return true;`); } catch { /* navegar */ }
  await pausa(4200);
  await ev(`
    const root = ng.getComponent(document.querySelector('app-root'));
    root.necesitaSetup = true; ng.applyChanges(root);
    return true;
  `);
  await pausa(1800);
  await ev(`
    const s = ng.getComponent(document.querySelector('app-setup-inicial'));
    s.paso = 2; s.businessName = 'Cafe Wybix'; s.address = 'Av. Hidalgo 100';
    ng.applyChanges(s);
    return true;
  `);
  await pausa(700);
  await tomar('07-setup-business', 'tipo de negocio');

  await ev(`
    const s = ng.getComponent(document.querySelector('app-setup-inicial'));
    s.elegirTipoNegocio('HOSPITALITY'); s.paso = 35;
    ng.applyChanges(s);
    return true;
  `);
  await pausa(700);
  await tomar('08-setup-device', 'uso de esta computadora');

  await ev(`
    const root = ng.getComponent(document.querySelector('app-root'));
    root.necesitaSetup = false; ng.applyChanges(root);
    return true;
  `);
  await cdp('Emulation.clearDeviceMetricsOverride', {});

  console.log('\nCapturas:');
  hechas.forEach(h => console.log('  ' + h));
  console.log('\nFalta la pantalla de cliente: node scripts/pruebas/ui/customer-display.mjs');
  return hechas;
}
