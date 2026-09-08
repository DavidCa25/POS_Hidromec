/**
 * Touch lee el stock de nuevo cada vez que se entra.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/catalogo-fresco.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * En la VM un producto por receta salia "Agotado" porque a un ingrediente le
 * faltaba stock. Se corrigio el inventario, se volvio a Touch... y seguia
 * "Agotado". El motivo no era el calculo -que estaba bien- sino que el
 * catalogo se leia UNA vez por sesion:
 *
 *     async load(force = false) { if (!force && this.products().length) return; ... }
 *
 * y Touch lo llamaba sin forzar. El stock cambia constantemente y siempre
 * FUERA de esa pantalla: se edita en Inventario, entra por una compra, lo
 * consume otra caja de la red. Con el catalogo congelado, la unica forma de
 * ver la realidad era reiniciar la aplicacion.
 *
 * QUE COMPRUEBA
 * -------------
 * Lo que hizo el usuario, en la ventana real: mirar Touch, cambiar el stock
 * por fuera, volver a entrar y ver el cambio. Sin reiniciar nada.
 *
 * El stock se toca por el canal real y se restaura al terminar.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

export default async function ({ ev, cdp }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };
  const seccion = (t) => console.log(`\n-- ${t}`);

  const ir = async (ruta, selector) => {
    await cdp('Page.navigate', { url: 'http://localhost:4200' + ruta });
    for (let k = 0; k < 25; k++) {
      await pausa(1000);
      const listo = await ev(`return !!document.querySelector('${selector}') && typeof ng !== 'undefined';`).catch(() => false);
      if (listo) return true;
    }
    return false;
  };
  const perfil = (p) => `
    const dash = document.querySelector('app-dashboard');
    if (dash) await ng.getComponent(dash).caps.setDeviceProfile('${p}');
    return true;
  `;

  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    return true;
  `).catch(() => {});

  if (!await ir('/dashboard/inventario', 'app-inventario')) {
    mal('no se llego a Inventario');
    console.log(`\nRESULTADO: ${fallos} FALLO(S)`);
    return { fallos };
  }
  const perfilOriginal = await ev(`
    const c = await window.electronAPI.getDeviceConfig();
    return (c?.data ?? c ?? {}).deviceProfile ?? 'RETAIL_POS';
  `);

  // Un producto DIRECT vendible cualquiera, con existencias: sirve para ver si
  // el catalogo se refresca, sin depender de que haya recetas en esta base.
  const elegido = await ev(`
    const rs = await window.electronAPI.getActiveProducts();
    const lista = rs?.data ?? rs?.recordset ?? rs ?? [];
    const p = (Array.isArray(lista) ? lista : []).find(x =>
      (x.inventory_mode ?? 'DIRECT') === 'DIRECT' && (x.sellable ?? 1) && Number(x.stock) > 3);
    return p ? { id: Number(p.id), nombre: p.product_name ?? p.nombre, stock: Number(p.stock),
                 pn: p.part_number, precio: Number(p.price), marca: p.brand_id, cat: p.category_id } : null;
  `);
  if (!elegido) {
    console.log('   ---- no hay ningun producto vendible con existencias en esta base.');
    return { fallos: 0, omitida: true };
  }
  console.log(`   producto de prueba: ${elegido.nombre} (stock ${elegido.stock})`);

  try {
    seccion('Touch parte con el stock actual');
    await ev(perfil('TOUCH_POS'));
    if (!await ir('/touch', 'app-touch-pos')) { mal('no se llego a Touch'); throw new Error('sin touch'); }

    const antes = await ev(`
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      const p = t['menu'].products().find(x => Number(x.id) === ${elegido.id});
      return p ? { disponibles: Number(p.available_units) } : { error: 'el producto no esta en el catalogo Touch' };
    `);
    if (antes.error) { mal(antes.error); throw new Error(antes.error); }
    ok('el producto aparece con existencias', `${antes.disponibles} disponibles`);

    seccion('Se cambia el stock FUERA de Touch');
    const nuevoStock = elegido.stock + 25;
    const cambiado = await ev(`
      const r = await window.electronAPI.actualizarProducto({
        product_id: ${elegido.id}, nombre: '${String(elegido.nombre).replace(/'/g, "''")}',
        precio: ${elegido.precio}, stock: ${nuevoStock}, numero_parte: '${elegido.pn}' });
      return { ok: r?.success, error: r?.error };
    `);
    if (!cambiado.ok) { mal('no se pudo cambiar el stock', String(cambiado.error)); throw new Error('sin cambio'); }
    ok('stock actualizado desde Inventario', `${elegido.stock} -> ${nuevoStock}`);

    seccion('Al volver a Touch, se ve el cambio');
    await ir('/dashboard/inventario', 'app-inventario');
    if (!await ir('/touch', 'app-touch-pos')) { mal('no se volvio a Touch'); throw new Error('sin touch'); }

    const despues = await ev(`
      const t = ng.getComponent(document.querySelector('app-touch-pos'));
      const p = t['menu'].products().find(x => Number(x.id) === ${elegido.id});
      return p ? { disponibles: Number(p.available_units) } : { error: 'el producto desaparecio del catalogo' };
    `);
    if (despues.error) mal(despues.error);
    else if (despues.disponibles === antes.disponibles + 25)
      ok('el catalogo se releyo: refleja el stock nuevo sin reiniciar',
         `${antes.disponibles} -> ${despues.disponibles}`);
    else
      mal('el catalogo siguio congelado', `${antes.disponibles} -> ${despues.disponibles}, se esperaba ${antes.disponibles + 25}`);

  } finally {
    // Se devuelve el stock a como estaba: esta es una base de trabajo.
    await ir('/dashboard/inventario', 'app-inventario').catch(() => {});
    const rest = await ev(`
      const r = await window.electronAPI.actualizarProducto({
        product_id: ${elegido.id}, nombre: '${String(elegido.nombre).replace(/'/g, "''")}',
        precio: ${elegido.precio}, stock: ${elegido.stock}, numero_parte: '${elegido.pn}' });
      const rs = await window.electronAPI.getActiveProducts();
      const l = rs?.data ?? rs?.recordset ?? rs ?? [];
      const p = (Array.isArray(l) ? l : []).find(x => Number(x.id) === ${elegido.id});
      return { ok: r?.success, stock: Number(p?.stock) };
    `).catch(() => ({}));
    await ev(perfil(perfilOriginal)).catch(() => {});
    console.log(`\n   (stock restaurado a ${rest.stock} · perfil ${perfilOriginal})`);
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
