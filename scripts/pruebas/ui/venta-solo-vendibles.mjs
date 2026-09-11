/**
 * El buscador de la venta no ofrece ingredientes.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/venta-solo-vendibles.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * En Retail, "Buscar / Agregar producto" listaba TODO el inventario. Salian
 * el Nescafe y la leche -insumos marcados como "no se vende" en su ficha- y
 * se podian agregar a la venta con un toque.
 *
 * Filtrar es cosa de quien vende, no del catalogo: `sp_get_active_products`
 * devuelve todo a proposito, porque Inventario y Compras necesitan los
 * insumos. Touch ya filtraba -en SQL, dentro de `sp_get_menu_catalog`-; la
 * pantalla de Retail no filtraba en ninguna parte, y leia la lista cruda.
 *
 * QUE COMPRUEBA
 * -------------
 * Sobre la ventana real, con un producto de verdad:
 *
 *     un producto vendible se ve en el buscador
 *     se marca "no se vende" desde Inventario
 *     deja de verse, y el escaner tampoco lo encuentra
 *     se devuelve a vendible y vuelve a estar
 *
 * El producto se crea y se retira aqui mismo: no se toca nada de la caja.
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

  // Un producto propio, para no depender de lo que haya en esta base ni
  // alterar la ficha de un producto de trabajo.
  const creado = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    const pn = 'QA-VENDIBLE-' + Date.now();
    inv.abrirProductoModal();
    inv.form.brand = inv.brands[0].id;
    inv.form.category = inv.categorys[0].id;
    inv.form.partNumber = pn;
    inv.form.name = 'QA insumo o producto';
    inv.form.price = 25;
    inv.form.stock = 9;
    inv.form.sellable = true;
    ng.applyChanges(inv);
    await inv.guardarProducto();
    await new Promise(s => setTimeout(s, 2000));
    document.querySelectorAll('.swal2-container').forEach(e => e.remove());

    const rs = await window.electronAPI.getActiveProducts();
    const l = rs?.data ?? rs?.recordset ?? rs ?? [];
    const p = (Array.isArray(l) ? l : []).find(x => x.part_number === pn);
    return p ? { id: Number(p.id), pn, nombre: p.product_name } : { error: 'no se creo ' + pn };
  `);
  if (creado.error) { mal(creado.error); console.log(`\nRESULTADO: ${fallos} FALLO(S)`); return { fallos }; }
  console.log(`   producto de prueba: ${creado.nombre} (#${creado.id})`);

  /**
   * Marca o desmarca "se vende".
   *
   * Va por el canal (`actualizarProducto`), no por la casilla del formulario:
   * esa casilla solo se muestra en negocios de alimentos y bebidas, y lo que
   * se prueba aqui es la pantalla de VENTA, que tiene que filtrar en
   * cualquier giro. Es el mismo IPC que usa el formulario cuando la casilla
   * existe.
   */
  const marcar = (vendible) => `
    const rs0 = await window.electronAPI.getActiveProducts();
    const l0 = rs0?.data ?? rs0?.recordset ?? rs0 ?? [];
    const antes = (Array.isArray(l0) ? l0 : []).find(x => Number(x.id) === ${creado.id});
    if (!antes) return { error: 'el producto no aparece en Inventario' };
    const r = await window.electronAPI.actualizarProducto({
      product_id: ${creado.id},
      nombre: antes.product_name,
      precio: Number(antes.price),
      stock: Number(antes.stock),
      numero_parte: antes.part_number,
      sellable: ${vendible},
    });
    const rs = await window.electronAPI.getActiveProducts();
    const l = rs?.data ?? rs?.recordset ?? rs ?? [];
    const p = (Array.isArray(l) ? l : []).find(x => Number(x.id) === ${creado.id});
    return { ok: r?.success, error: r?.error, sellable: p ? !!p.sellable : null };
  `;

  /** Lo que ofrece el buscador de la venta, releyendo el catalogo. */
  const enElBuscador = `
    const v = ng.getComponent(document.querySelector('app-venta'));
    await v.cargarProductosActivos();
    const enLista = v.productos.some(p => Number(p.id) === ${creado.id});
    const porParte = !!v['catalog'].findByPartNumber('${creado.pn}');
    const enCatalogo = v['catalog'].products().some(p => Number(p.id) === ${creado.id});
    return { enLista, porParte, enCatalogo };
  `;

  try {
    await ev(perfil('RETAIL_POS'));

    seccion('Un producto vendible se ofrece');
    if (!await ir('/dashboard/venta', 'app-venta')) { mal('no se llego a la venta'); throw new Error('sin venta'); }
    const antes = await ev(enElBuscador);
    if (antes.enLista && antes.porParte) ok('aparece en el buscador y lo encuentra el número de parte');
    else mal('el producto vendible no aparece', JSON.stringify(antes));

    seccion('Se marca "no se vende" en Inventario');
    await ir('/dashboard/inventario', 'app-inventario');
    const apagado = await ev(marcar(false));
    if (apagado.sellable === false) ok('la ficha queda como no vendible');
    else mal('no se pudo marcar como no vendible', JSON.stringify(apagado));

    seccion('Y deja de ofrecerse en la venta');
    if (!await ir('/dashboard/venta', 'app-venta')) { mal('no se volvio a la venta'); throw new Error('sin venta'); }
    const despues = await ev(enElBuscador);
    if (despues.enCatalogo) ok('el catálogo lo sigue trayendo: Inventario y Compras lo necesitan');
    else mal('el producto desaparecio del catálogo entero, no solo de la venta');
    if (!despues.enLista) ok('pero el buscador de la venta ya no lo lista');
    else mal('el buscador sigue ofreciendo un producto que no se vende');
    if (!despues.porParte) ok('y el escáner tampoco lo encuentra por número de parte');
    else mal('el escáner todavía lo cuela a la venta');

    seccion('Al devolverlo a vendible, vuelve');
    await ir('/dashboard/inventario', 'app-inventario');
    const prendido = await ev(marcar(true));
    if (prendido.sellable === true) ok('la ficha vuelve a ser vendible');
    else mal('no se pudo devolver a vendible', JSON.stringify(prendido));

    if (!await ir('/dashboard/venta', 'app-venta')) { mal('no se volvio a la venta'); throw new Error('sin venta'); }
    const final = await ev(enElBuscador);
    if (final.enLista && final.porParte) ok('y el buscador lo ofrece otra vez');
    else mal('el producto no volvio al buscador', JSON.stringify(final));

  } finally {
    await ir('/dashboard/inventario', 'app-inventario').catch(() => {});
    const retirado = await ev(`
      document.querySelectorAll('.swal2-container').forEach(e => e.remove());
      const r = await window.electronAPI.darDeBajaProducto(${creado.id});
      const inv = ng.getComponent(document.querySelector('app-inventario'));
      await inv.consultarInventario();
      return { ok: r?.success };
    `).catch(() => ({}));
    await ev(perfil(perfilOriginal)).catch(() => {});
    console.log(`\n   (producto de prueba ${retirado.ok ? 'retirado' : 'NO retirado'} · perfil ${perfilOriginal})`);
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
