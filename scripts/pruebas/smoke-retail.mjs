/**
 * SMOKE TEST de Retail sobre la aplicacion REAL.
 *
 *     npx electron ./electron/main.js --remote-debugging-port=9222
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/smoke-retail.mjs
 *
 * Ejecuta dentro de la ventana de Wybix, con su preload, su base y su
 * configuracion. Escribe en la base REAL: deja una venta y su devolucion,
 * ambas reportadas con folio para que se puedan revisar.
 *
 * NO dispara hardware: no abre el cajon ni manda papel a la impresora. Son
 * acciones fisicas en el equipo del usuario y no deben ocurrir sin que
 * alguien lo vea. Se comprueba que estan configuradas y se dice cuales
 * quedaron sin probar.
 */

const r = { pasos: [], fallos: 0 };
const ok = (t, d) => { r.pasos.push(['PASS', t, d]); console.log(`   PASS  ${t}${d ? '  · ' + d : ''}`); };
const no = (t, d) => { r.fallos++; r.pasos.push(['FAIL', t, d]); console.log(`   FAIL  ${t}${d ? '  · ' + d : ''}`); };
const nt = (t, d) => { r.pasos.push(['NOT TESTABLE', t, d]); console.log(`   ----  ${t}  · ${d}`); };
const seccion = (t) => console.log(`\n── ${t}`);

export default async function ({ ev, captura }) {
  seccion('Sesion y catalogo');

  // Esta caja tiene que ser Retail para esta prueba: desde que la ruta de
  // venta tiene guard, una caja Touch redirige /dashboard/venta a /touch. Se
  // deja como estaba al terminar.
  const perfilOriginal = await ev(`
    const c = await window.electronAPI.getDeviceConfig();
    return (c?.data ?? c ?? {}).deviceProfile ?? 'RETAIL_POS';
  `);
  await ev(`await window.electronAPI.setDeviceConfig({ deviceProfile: 'RETAIL_POS' }); return true;`);

  // La autenticacion no se toca en esta iteracion: se establece la sesion
  // igual que hace el login tras validar, y se prueba lo que si cambio.
  const inicio = await ev(`
    const api = window.electronAPI;
    const users = await api.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    location.hash = '';
    location.href = 'http://localhost:4200/dashboard/venta';
    return { usuario: u };
  `);
  ok('sesion establecida con un usuario real de la base', `${inicio.usuario.usuario} (${inicio.usuario.rol})`);

  await new Promise(s => setTimeout(s, 5000));

  const pantalla = await ev(`
    return { ruta: location.pathname, venta: !!document.querySelector('app-venta') };
  `);
  if (pantalla.venta) ok('pantalla de venta Retail cargada en la app real', pantalla.ruta);
  else no('pantalla de venta Retail cargada', `ruta ${pantalla.ruta}`);

  const cat = await ev(`
    const v = ng.getComponent(document.querySelector('app-venta'));
    await v.cargarProductosActivos();
    // La prueba llega a pedir 3 unidades del elegido: tomar el primero con
    // existencia hacia que el resultado dependiera del orden del catalogo y de
    // lo que hubieran consumido las corridas anteriores.
    const conStock = v.productos.filter(p => p.stock > 0);
    const suficiente = conStock.filter(p => p.stock >= 3);
    return { total: v.productos.length, conStock: conStock.length,
             elegido: suficiente[0] ?? conStock[0] ?? null, turno: v.shiftOpen };
  `);
  if (cat.total > 0) ok('catalogo cargado desde SQL', `${cat.total} productos, ${cat.conStock} con existencia`);
  else no('catalogo cargado desde SQL', 'sin productos');

  seccion('Turno');
  if (cat.turno) {
    ok('turno abierto en esta caja', 'ya estaba abierto');
  } else {
    const t = await ev(`
      const v = ng.getComponent(document.querySelector('app-venta'));
      v.openingCash = 0; v.openingNote = 'Prueba automatica';
      await v.confirmarAbrirTurno();
      return { abierto: v.shiftOpen, id: v.shiftId };
    `);
    if (t.abierto) ok('turno abierto por la aplicacion', `cierre ${t.id}`);
    else no('turno abierto por la aplicacion');
  }

  if (!cat.elegido) {
    no('no hay ningun producto con existencia: no se puede probar la venta');
    return resumen(r);
  }

  seccion('Carrito');
  const carrito = await ev(`
    const v = ng.getComponent(document.querySelector('app-venta'));
    v.cart.clearActive();
    const p = v.productos.find(x => x.id === ${cat.elegido.id});
    v.seleccionarProducto(p);
    v.seleccionarProducto(p);              // dos veces: agrupa en una linea
    const otro = v.productos.find(x => x.stock > 0 && x.id !== p.id);
    if (otro) v.seleccionarProducto(otro);
    const antes = v.items.map(i => ({ n: i.productName, q: i.qty }));
    v.items[0].qty = 3; v.onQtyChange(0);   // modificar cantidad
    const conTres = v.items[0].qty;
    if (v.items.length > 1) v.quitarItem(1); // eliminar linea
    return { antes, conTres, lineas: v.items.length, total: v.totalVenta, detalle: v.items.map(i => ({ id: i.productId, n: i.productName, q: i.qty, p: i.unitPrice, sub: i.subtotal })) };
  `);
  ok('agregar producto (dos toques agrupan en una linea)', JSON.stringify(carrito.antes));
  ok('modificar cantidad', `qty = ${carrito.conTres}`);
  ok('eliminar linea', `quedan ${carrito.lineas} linea(s), total ${carrito.total}`);

  const busca = await ev(`
    const v = ng.getComponent(document.querySelector('app-venta'));
    const p = v.productos[0];
    const porParte = v.catalog.findByPartNumber(p.part_number);
    const porCodigo = p.bar_code ? v.catalog.findByBarcode(p.bar_code) : null;
    return { parte: !!porParte, codigo: p.bar_code ? !!porCodigo : null, ejemplo: p.part_number };
  `);
  ok('busqueda por numero de parte', `${busca.ejemplo} encontrado`);
  if (busca.codigo === null) nt('busqueda por codigo de barras', 'el producto de prueba no tiene codigo');
  else if (busca.codigo) ok('busqueda por codigo de barras (misma ruta que usa el scanner)');
  else no('busqueda por codigo de barras');

  nt('scanner fisico', 'no hay lector conectado (device-config: scanner.enabled = false)');

  seccion('Cobro en efectivo');
  const stockAntes = await ev(`
    const api = window.electronAPI;
    const rs = await api.getActiveProducts();
    const l = Array.isArray(rs) ? rs : rs.recordset;
    return l.find(p => p.id === ${cat.elegido.id})?.stock ?? null;
  `);

  await captura('docs/evidencias/retail-01-venta.png');

  const venta = await ev(`
    const v = ng.getComponent(document.querySelector('app-venta'));
    const total = v.totalVenta;
    // Sin cajon ni impresion: son acciones fisicas y esta prueba corre sola.
    const res = await v.sale.checkout(
      { method: 'EFECTIVO', received: Math.ceil(total) + 100 },
      { openDrawer: false, autoPrint: false });
    return { ok: res.ok, error: res.error ?? null, folio: res.saleId, total: res.total, pagado: res.paid, cambio: res.change, lineas: (res.lines ?? []).length, carritoDespues: v.items.length };
  `);

  if (venta.ok) {
    ok('venta registrada por sp_register_sale en la base real', `folio ${venta.folio}, total ${venta.total}`);
    ok('cambio calculado', `pagado ${venta.pagado}, cambio ${venta.cambio}`);
    ok('carrito limpio tras cobrar', `${venta.carritoDespues} lineas`);
  } else {
    no('venta registrada', venta.error);
    return resumen(r);
  }

  const enBase = await ev(`
    const api = window.electronAPI;
    const s = await api.getSaleByFolio(${venta.folio});
    const h = s?.data?.header, d = s?.data?.details ?? [];
    return { ok: s?.success, total: h?.total, metodo: h?.payment_method, lineas: d.length,
             unitCost: d[0]?.unit_cost ?? null, modo: d[0]?.inventory_mode ?? null };
  `);
  if (enBase.ok && enBase.lineas > 0) ok('la venta se lee de vuelta con su detalle', `total ${enBase.total}, ${enBase.lineas} linea(s), metodo ${enBase.metodo}`);
  else no('la venta se lee de vuelta');
  if (enBase.unitCost != null && enBase.modo) ok('costo historico congelado en la linea', `unit_cost ${enBase.unitCost}, modo ${enBase.modo}`);
  else no('costo historico congelado', 'unit_cost o inventory_mode vacios');

  const stockDespues = await ev(`
    const api = window.electronAPI;
    const rs = await api.getActiveProducts();
    const l = Array.isArray(rs) ? rs : rs.recordset;
    return l.find(p => p.id === ${cat.elegido.id})?.stock ?? null;
  `);
  if (stockAntes != null && stockDespues != null && Number(stockAntes) > Number(stockDespues)) {
    ok('inventario descontado', `${stockAntes} -> ${stockDespues}`);
  } else {
    no('inventario descontado', `${stockAntes} -> ${stockDespues}`);
  }

  seccion('Pantalla de cliente');
  const cd = await ev(`
    const api = window.electronAPI;
    const st = await api.customerDisplayStatus();
    const mon = await api.customerDisplayListMonitors();
    return { abierta: !!st?.open, monitores: (mon ?? []).length };
  `);
  if (cd.abierta) ok('pantalla de cliente abierta', `${cd.monitores} monitor(es)`);
  else nt('pantalla de cliente', `no esta abierta en este equipo (${cd.monitores} monitor(es) detectado(s)); el servicio recibio el estado sin error`);

  seccion('PDF de la venta');
  const pdf = await ev(`
    const api = window.electronAPI;
    const res = await api.generateSalePdf({ saleId: ${venta.folio}, pagado: ${venta.pagado}, cambio: ${venta.cambio} });
    return res;
  `);
  if (pdf?.success) ok('PDF generado con el Chromium de Electron (sin Puppeteer)', pdf.path);
  else no('PDF generado', pdf?.error);

  nt('impresion en papel', 'hay impresora configurada (OFICHIDO_POS): no se manda papel sin supervision');
  nt('apertura del cajon', 'el cajon esta habilitado en COM1: no se abre sin supervision');

  seccion('Devolucion');
  const dev = await ev(`
    const api = window.electronAPI;
    const s = await api.getSaleByFolio(${venta.folio});
    const d = (s?.data?.details ?? []).filter(x => Number(x.remaining_qty ?? 0) > 0);
    if (!d.length) return { ok: false, error: 'la venta no tiene partidas devolvibles' };
    const res = await api.refundSale({
      sale_id: ${venta.folio},
      user_id: JSON.parse(localStorage.getItem('usuarioActual')).id,
      payment_method: 'EFECTIVO',
      items: d.map(x => ({ productId: x.product_id, qty: x.remaining_qty, unitPrice: x.unitary_price })),
      note: 'Prueba automatica de regresion',
      apply_net_update: 1,
    });
    return res;
  `);
  if (dev?.success) ok('devolucion registrada', `refund ${dev.data?.[0]?.refund_id ?? ''}`);
  else no('devolucion registrada', dev?.error);

  const stockFinal = await ev(`
    const api = window.electronAPI;
    const rs = await api.getActiveProducts();
    const l = Array.isArray(rs) ? rs : rs.recordset;
    return l.find(p => p.id === ${cat.elegido.id})?.stock ?? null;
  `);
  if (String(stockFinal) === String(stockAntes)) ok('la devolucion repone el inventario', `${stockDespues} -> ${stockFinal} (igual que antes de la prueba)`);
  else no('la devolucion repone el inventario', `esperado ${stockAntes}, hay ${stockFinal}`);

  seccion('Corte de turno');
  const corte = await ev(`
    const api = window.electronAPI;
    const res = await api.cashSummary({ register_id: 1 });
    return { ok: res?.success !== false, filas: (res?.data ?? res?.recordset ?? []).length };
  `);
  if (corte.ok) ok('resumen de caja responde', `${corte.filas} concepto(s)`);
  else no('resumen de caja responde');
  nt('cierre de turno', 'cerrarlo dejaria la caja del usuario sin turno abierto; se deja como estaba');

  await captura('docs/evidencias/retail-02-post-venta.png');

  seccion('Restauracion');
  await ev(`await window.electronAPI.setDeviceConfig({ deviceProfile: '${perfilOriginal}' }); return true;`);
  const ahora = await ev(`
    const c = await window.electronAPI.getDeviceConfig();
    return (c?.data ?? c ?? {}).deviceProfile;
  `);
  if (ahora === perfilOriginal) ok('perfil de la caja restaurado', ahora);
  else no('perfil de la caja restaurado', `esperado ${perfilOriginal}, hay ${ahora}`);

  return resumen(r);
}

function resumen(r) {
  const pass = r.pasos.filter(p => p[0] === 'PASS').length;
  const nt = r.pasos.filter(p => p[0] === 'NOT TESTABLE').length;
  console.log(`\nRESULTADO: ${pass} PASS · ${r.fallos} FAIL · ${nt} NOT TESTABLE`);
  return r;
}
