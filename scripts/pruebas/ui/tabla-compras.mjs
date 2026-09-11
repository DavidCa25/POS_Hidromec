/**
 * La tabla de compras muestra el producto y el proveedor.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/tabla-compras.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * Al abrir una compra, las columnas Producto y Proveedor salian en blanco.
 * No era la pantalla: `sp_get_purchases` devolvia DOS columnas llamadas
 * `nombre` -el producto y el proveedor-. Un recordset no puede tener dos
 * columnas iguales, asi que el driver renombraba la segunda a `nombre1` y la
 * pantalla, que pedia `product_name` y `supplier_name`, no encontraba
 * ninguna de las dos.
 *
 * QUE COMPRUEBA
 * -------------
 * Que lo que llega por el canal trae los nombres, y que lo que se pinta en
 * la fila y en el detalle no esta vacio. Sobre las compras que YA existen en
 * esta base: registrar una compra sube stock y reescribe costos, y eso no se
 * hace desde una prueba contra una base de trabajo.
 *
 * Si la base no tiene compras, la prueba se salta y lo dice: es preferible a
 * un verde que no midio nada.
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

  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    return true;
  `).catch(() => {});

  if (!await ir('/dashboard/tablaCompra', 'app-tabla-compra')) {
    mal('no se llego a la tabla de compras');
    console.log(`\nRESULTADO: ${fallos} FALLO(S)`);
    return { fallos };
  }

  // ================================================== lo que llega del canal
  seccion('Lo que devuelve el canal');
  const crudo = await ev(`
    const r = await window.electronAPI.getPurchases();
    const filas = r?.data ?? r?.recordset ?? [];
    if (!filas.length) return { vacio: true };
    const cols = Object.keys(filas[0]);
    const repetidas = cols.filter((c, i) => cols.indexOf(c) !== i);
    return {
      filas: filas.length,
      cols,
      repetidas,
      sinProducto: filas.filter(f => f.purchase_detail_id != null && !f.product_name).length,
      // Una compra puede no tener proveedor de verdad -las hay anteriores al
      // catalogo de proveedores-. Lo que no puede pasar es que TENGA uno y el
      // nombre no llegue: eso es el defecto de las columnas repetidas.
      conProveedor: filas.filter(f => f.supplier_id != null).length,
      idSinNombre: filas.filter(f => f.supplier_id != null && !f.supplier_name).length,
    };
  `);

  if (crudo.vacio) {
    console.log('   ---- esta base no tiene compras registradas: no hay nada que mapear.');
    console.log('        Registra una compra y vuelve a ejecutarla.');
    return { fallos: 0, omitida: true };
  }

  if (!crudo.repetidas.length) ok('ninguna columna viene repetida', `${crudo.cols.length} columnas`);
  else mal('hay columnas repetidas: el driver descarta una', crudo.repetidas.join(', '));

  if (crudo.cols.includes('product_name') && crudo.cols.includes('supplier_name'))
    ok('llegan product_name y supplier_name');
  else mal('faltan las columnas que pide la pantalla', crudo.cols.join(', '));

  if (crudo.sinProducto === 0) ok('ninguna partida viene sin producto', `${crudo.filas} filas`);
  else mal('hay partidas sin producto', `${crudo.sinProducto} de ${crudo.filas}`);

  if (crudo.conProveedor === 0)
    console.log('   ---- ninguna compra de esta base tiene proveedor asignado: nada que comprobar ahi.');
  else if (crudo.idSinNombre === 0)
    ok('toda compra con proveedor trae su nombre', `${crudo.conProveedor} de ${crudo.filas} filas`);
  else mal('hay compras con proveedor pero sin nombre', `${crudo.idSinNombre} de ${crudo.conProveedor}`);

  // ======================================================= lo que se pinta
  seccion('Lo que se pinta en pantalla');
  const pintado = await ev(`
    const t = ng.getComponent(document.querySelector('app-tabla-compra'));
    await t.cargarCompras();
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 600));
    // pagedCompras devuelve ITEMS -cabecera de grupo o fila- desde que la
    // tabla comparte estado con la barra de Filtrar/Agrupar/Columnas.
    const primera = (t.pagedCompras.find(i => i.tipo === 'fila') || {}).fila;
    if (!primera) return { error: 'la tabla quedo vacia' };
    t.toggle(primera.id);
    ng.applyChanges(t);
    await new Promise(s => setTimeout(s, 600));

    const fila = document.querySelector('.castrol-table tbody tr.parent-row');
    const celdas = [...fila.querySelectorAll('td')].map(c => c.textContent.replace(/[\\s\\u00a0]+/g, ' ').trim());
    const detalle = [...document.querySelectorAll('.inner-table tbody tr')]
      .map(tr => [...tr.querySelectorAll('td')].map(c => c.textContent.replace(/[\\s\\u00a0]+/g, ' ').trim()));
    return {
      id: primera.id,
      proveedorEnModelo: primera.supplierLabel,
      estado: primera.paymentStatus,
      proveedorEnCelda: celdas[2],
      chipPago: fila.querySelector('.pago-chip')?.textContent.trim() ?? null,
      detalle,
      partidas: primera.details.length,
    };
  `);

  if (pintado.error) {
    mal(pintado.error);
    console.log(`\nRESULTADO: ${fallos} FALLO(S)`);
    return { fallos };
  }

  if (pintado.proveedorEnCelda && pintado.proveedorEnCelda !== '—')
    ok('la columna Proveedor tiene texto', pintado.proveedorEnCelda);
  else mal('la columna Proveedor sale en blanco', JSON.stringify(pintado.proveedorEnCelda));

  if (pintado.chipPago) ok('y se ve el estado de pago', `${pintado.chipPago} (${pintado.estado})`);
  else mal('no se pinto el estado de pago');

  const sinNombre = pintado.detalle.filter(f => f.length > 1 && !f[1]);
  if (pintado.partidas > 0 && pintado.detalle.length > 0 && sinNombre.length === 0)
    ok('y en el detalle, ninguna partida sale sin producto',
       pintado.detalle.map(f => f[1]).join(' · '));
  else if (pintado.partidas === 0)
    ok('la compra no tiene partidas y la tabla lo dice, sin inventar filas');
  else mal('hay partidas sin nombre de producto', `${sinNombre.length} de ${pintado.detalle.length}`);

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
