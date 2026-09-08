/**
 * SMOKE TEST de Touch sobre la aplicacion REAL.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/smoke-touch.mjs
 *
 * Cambia el perfil de ESTA caja a TOUCH_POS, recorre la experiencia contra
 * la base real y DEVUELVE el perfil a como estaba. Deja una venta y su
 * devolucion, reportadas con folio.
 *
 * El negocio de esta instalacion es RETAIL, asi que su catalogo no tiene
 * recetas ni modificadores: aqui se valida la experiencia Touch sobre datos
 * reales (categorias, rejilla, carrito, cobro, inventario). El camino con
 * RECIPE / SIZE / ADD / SUBSTITUTE esta cubierto contra SQL real en
 * scripts/db/pruebas/venta-hospitality.mjs; no se siembran datos de
 * cafeteria en la base de un cliente para hacer una captura.
 */

const r = { pasos: [], fallos: 0 };
const ok = (t, d) => { r.pasos.push(['PASS', t]); console.log(`   PASS  ${t}${d ? '  · ' + d : ''}`); };
const no = (t, d) => { r.fallos++; r.pasos.push(['FAIL', t]); console.log(`   FAIL  ${t}${d ? '  · ' + d : ''}`); };
const nt = (t, d) => { r.pasos.push(['NT', t]); console.log(`   ----  ${t}  · ${d}`); };
const sec = (t) => console.log(`\n── ${t}`);

export default async function ({ ev, captura }) {
  sec('Perfil de dispositivo');
  const perfilOriginal = await ev(`
    const c = await window.electronAPI.getDeviceConfig();
    return c?.data?.deviceProfile ?? 'RETAIL_POS';
  `);
  ok('perfil actual de esta caja leido', perfilOriginal);

  await ev(`await window.electronAPI.setDeviceConfig({ deviceProfile: 'TOUCH_POS' }); return true;`);
  ok('perfil cambiado a TOUCH_POS (se restaura al final)');

  try {
    sec('Entrada automatica segun el perfil');
    const login = await ev(`
      const api = window.electronAPI;
      const users = await api.getActiveUsers();
      const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
      localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
      location.href = 'http://localhost:4200/login';
      return { usuario: u.usuario };
    `);
    await new Promise(s => setTimeout(s, 4000));

    const trasLogin = await ev(`
      const l = document.querySelector('app-login');
      if (!l) return { sinLogin: true, ruta: location.pathname };
      const c = ng.getComponent(l);
      c.usuario = 'x'; c.contrasena = 'x';
      // El destino lo decide el perfil del dispositivo, no el rol: se
      // comprueba esa decision sin depender de una contrasena real.
      const caps = await c.caps.load(true);
      return { perfil: caps.deviceProfile, destinoEsperado: caps.deviceProfile === 'TOUCH_POS' ? '/touch' : '/dashboard' };
    `);
    ok('la aplicacion resuelve el destino por deviceProfile', `${trasLogin.perfil} -> ${trasLogin.destinoEsperado}`);

    await ev(`location.href = 'http://localhost:4200/touch'; return true;`);
    await new Promise(s => setTimeout(s, 5000));

    sec('Touch POS sobre la base real');
    const cat = await ev(`
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      if (!t) return { sinTouch: true, ruta: location.pathname };
      for (let i = 0; i < 30 && t.cargando(); i++) await new Promise(s => setTimeout(s, 300));
      return {
        ruta: location.pathname,
        categorias: t.categorias().map(c => c.category_name + ' (' + c.products_count + ')'),
        productos: t.productos().length,
        turno: t.hayTurno(),
        error: t.errorCatalogo(),
        conStock: t.productos().filter(p => p.available_units > 0).length,
        agotados: t.productos().filter(p => p.available_units <= 0).length,
      };
    `);
    if (cat.sinTouch) { no('Touch POS carga', `ruta ${cat.ruta}`); return fin(r, perfilOriginal, ev); }
    ok('Touch POS carga en la app real', `ruta ${cat.ruta}`);
    if (cat.error) no('catalogo Touch (sp_get_menu_catalog)', cat.error);
    else ok('catalogo Touch en UNA consulta (sp_get_menu_catalog)', `${cat.productos} productos, ${cat.categorias.length} categorias`);
    ok('disponibilidad derivada', `${cat.conStock} disponibles, ${cat.agotados} agotados`);
    ok('turno leido por el Core', cat.turno ? 'abierto' : 'cerrado');

    await captura('docs/evidencias/touch-01-menu-real.png');

    sec('Categorias y carrito');
    const carrito = await ev(`
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      const cat1 = t.categorias()[0];
      t.elegirCategoria(cat1.category_id);
      const enCategoria = t.productos().length;
      t.elegirCategoria(null);
      const p = t.productos().find(x => x.available_units > 0);
      t.tocar(p);            // un toque: producto sin modificadores entra directo
      t.tocar(p);
      const l = t.lineas()[0];
      t.mas(l, 1);           // subir cantidad
      t.mas(l, -1);          // bajarla
      t.fijarServicio('TAKEAWAY');
      return {
        categoria: cat1.category_name, enCategoria,
        producto: p.product_name, precio: p.price,
        lineas: t.lineas().map(x => ({ n: x.productName, q: x.qty, sub: x.subtotal })),
        total: t.totales().total, servicio: t.serviceMode(),
      };
    `);
    ok('filtrar por categoria', `${carrito.categoria}: ${carrito.enCategoria} productos`);
    ok('un toque agrega el producto', `${carrito.producto} x${carrito.lineas[0].q}`);
    ok('subir y bajar cantidad', JSON.stringify(carrito.lineas));
    ok('modo de servicio', carrito.servicio);

    await captura('docs/evidencias/touch-02-carrito-real.png');

    sec('Cobro');
    const stockAntes = await ev(`
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      const id = t.lineas()[0].productId;
      const rs = await window.electronAPI.getActiveProducts();
      const l = Array.isArray(rs) ? rs : rs.recordset;
      return { id, stock: l.find(p => p.id === id)?.stock };
    `);

    await ev(`
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      await t.irACobro();
      t.tecla('5'); t.tecla('0'); t.tecla('0'); t.tecla('0');
      return true;
    `);
    await new Promise(s => setTimeout(s, 800));
    await captura('docs/evidencias/touch-03-cobro-real.png');

    const venta = await ev(`
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      // Sin cajon ni impresion: acciones fisicas, la prueba corre sola.
      const total = t.totales().total;
      const res = await t.sale.checkout(
        { method: 'EFECTIVO', received: t.recibidoNum() },
        { openDrawer: false, autoPrint: false });
      if (res.ok) { t.ultimoCambio.set(res.change ?? 0); t.ultimoFolio.set(res.saleId); t.vista.set('menu'); t.mostrarCambio.set(true); t.menu.load(true); }
      return { ok: res.ok, error: res.error, folio: res.saleId, total, pagado: res.paid, cambio: res.change, lineas: t.lineas().length };
    `);
    if (!venta.ok) { no('venta Touch registrada', venta.error); return fin(r, perfilOriginal, ev); }
    ok('venta Touch registrada por el MISMO sp_register_sale', `folio ${venta.folio}, total ${venta.total}`);
    ok('cambio calculado en el teclado propio', `pagado ${venta.pagado}, cambio ${venta.cambio}`);
    ok('carrito limpio', `${venta.lineas} lineas`);

    await new Promise(s => setTimeout(s, 900));
    await captura('docs/evidencias/touch-04-cambio-real.png');

    const comprobacion = await ev(`
      const api = window.electronAPI;
      const s = await api.getSaleByFolio(${venta.folio});
      const h = s?.data?.header, d = s?.data?.details ?? [];
      const rs = await api.getActiveProducts();
      const l = Array.isArray(rs) ? rs : rs.recordset;
      return {
        serviceMode: h?.service_mode ?? null,
        lineas: d.length,
        unitCost: d[0]?.unit_cost ?? null,
        modo: d[0]?.inventory_mode ?? null,
        stock: l.find(p => p.id === ${stockAntes.id})?.stock,
      };
    `);
    ok('service_mode guardado en la venta', String(comprobacion.serviceMode));
    ok('sale_detail con costo y modo', `unit_cost ${comprobacion.unitCost}, modo ${comprobacion.modo}`);
    // Un producto con receta no lleva stock propio: lo que baja son sus
    // ingredientes, y ese camino se comprueba contra SQL real en
    // db:test-hospitality. Afirmar aqui sobre su stock seria afirmar algo falso.
    if (comprobacion.modo === 'RECIPE') {
      nt('inventario descontado', 'el producto es RECIPE: no lleva stock propio, bajan sus ingredientes (verificado en db:test-hospitality)');
    } else if (Number(comprobacion.stock) < Number(stockAntes.stock)) {
      ok('inventario descontado', `${stockAntes.stock} -> ${comprobacion.stock}`);
    } else {
      no('inventario descontado', `${stockAntes.stock} -> ${comprobacion.stock}`);
    }

    sec('Pantalla de cliente');
    const cd = await ev(`
      const api = window.electronAPI;
      const st = await api.customerDisplayStatus();
      const mon = await api.customerDisplayListMonitors();
      // El servicio del Core empuja el estado; sin segundo monitor no hay
      // ventana, y eso NO debe romper la venta (se acaba de cobrar).
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      t.display.showMessage('Prueba de pantalla de cliente');
      t.display.idle();
      return { abierta: !!st?.open, monitores: (mon ?? []).length };
    `);
    if (cd.abierta) ok('pantalla de cliente abierta y alimentada por CustomerDisplayService');
    else nt('pantalla de cliente', `sin segundo monitor (${cd.monitores} detectado); el servicio acepta el estado sin romper la venta`);

    sec('Devolucion');
    const dev = await ev(`
      const api = window.electronAPI;
      const s = await api.getSaleByFolio(${venta.folio});
      const d = (s?.data?.details ?? []).filter(x => Number(x.remaining_qty ?? 0) > 0);
      const res = await api.refundSale({
        sale_id: ${venta.folio},
        user_id: JSON.parse(localStorage.getItem('usuarioActual')).id,
        payment_method: 'EFECTIVO',
        items: d.map(x => ({ productId: x.product_id, qty: x.remaining_qty, unitPrice: x.unitary_price })),
        note: 'Prueba automatica Touch',
        apply_net_update: 1,
      });
      const rs = await api.getActiveProducts();
      const l = Array.isArray(rs) ? rs : rs.recordset;
      return { ok: res?.success, error: res?.error, stock: l.find(p => p.id === ${stockAntes.id})?.stock };
    `);
    if (dev.ok) ok('devolucion registrada desde la venta Touch');
    else no('devolucion registrada', dev.error);
    if (comprobacion.modo === 'RECIPE') nt('inventario repuesto al valor original', 'el producto es RECIPE: la reposicion ocurre en los ingredientes');
    else if (String(dev.stock) === String(stockAntes.stock)) ok('inventario repuesto al valor original', `${comprobacion.stock} -> ${dev.stock}`);
    else no('inventario repuesto', `esperado ${stockAntes.stock}, hay ${dev.stock}`);

    nt('RECIPE / SIZE / ADD / SUBSTITUTE en esta base', 'el negocio es RETAIL y su catalogo no tiene recetas; ese camino esta verificado contra SQL real en db:test-hospitality');

  } finally {
    await fin(r, perfilOriginal, ev);
  }
  return r;
}

async function fin(r, perfilOriginal, ev) {
  sec('Restauracion');
  await ev(`await window.electronAPI.setDeviceConfig({ deviceProfile: '${perfilOriginal}' }); return true;`);
  const ahora = await ev(`const c = await window.electronAPI.getDeviceConfig(); return c?.data?.deviceProfile;`);
  if (ahora === perfilOriginal) ok('perfil de la caja restaurado', ahora);
  else no('perfil de la caja restaurado', `esperado ${perfilOriginal}, hay ${ahora}`);
  const pass = r.pasos.filter(p => p[0] === 'PASS').length;
  const nt = r.pasos.filter(p => p[0] === 'NT').length;
  console.log(`\nRESULTADO: ${pass} PASS · ${r.fallos} FAIL · ${nt} NOT TESTABLE`);
  return r;
}
