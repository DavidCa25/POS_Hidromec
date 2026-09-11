/**
 * Codigo de barras e imagen: opcionales, y de ida y vuelta.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/producto-extras.mjs
 *
 * QUE CAMBIO
 * ----------
 * "Numero de parte" pasa a llamarse "Codigo interno / SKU" -misma columna,
 * mismo contrato, solo un nombre que no obliga a pensar en refacciones-, el
 * codigo de barras deja de ser un campo siempre presente para pasar a estar
 * detras de una casilla, y el producto puede llevar una imagen.
 *
 * QUE COMPRUEBA
 * -------------
 * Que los tres son OPCIONALES y que lo guardado vuelve: se crea un producto
 * con codigo e imagen, se comprueba en SQL, se reabre para editarlo -ahi es
 * donde se ve si lo guardado se carga-, se le quitan las dos cosas y se
 * comprueba otra vez. Al final el producto se retira por la via normal.
 *
 * La imagen se genera aqui con un canvas: asi la prueba no depende de que
 * exista ningun archivo en el disco de quien la ejecute.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Retira cualquier aviso que se haya quedado puesto.
 *
 * SweetAlert2 cierra al terminar su animacion de salida, y con la ventana
 * oculta -que es como corre esto- Chromium las congela: un aviso con `timer`
 * se queda en pantalla para siempre y tapa lo que viene detras. No es un
 * defecto de la aplicacion, es que nadie la esta mirando.
 */
const SIN_AVISOS = `
  document.querySelectorAll('.swal2-container').forEach(e => e.remove());
  return true;
`;

/** PNG minimo, generado en la pagina. */
const IMAGEN = `
  const c = document.createElement('canvas');
  c.width = 240; c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#45B3C3'; g.fillRect(0, 0, 240, 240);
  g.fillStyle = '#0b1b2b'; g.fillRect(60, 60, 120, 120);
  const dataUrl = c.toDataURL('image/png');
`;

export default async function ({ ev, cdp }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };
  const seccion = (t) => console.log(`\n-- ${t}`);

  const ir = async (ruta, selector) => {
    await cdp('Page.navigate', { url: 'http://localhost:4200' + ruta });
    for (let k = 0; k < 20; k++) {
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
  if (!await ir('/dashboard/inventario', 'app-inventario')) {
    mal('no se llego a Inventario');
    console.log(`\nRESULTADO: ${fallos} FALLO(S)`);
    return { fallos };
  }

  // ==================================================== el modal en reposo
  seccion('Lo opcional no estorba');
  const reposo = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    inv.abrirProductoModal();
    ng.applyChanges(inv);
    await new Promise(s => setTimeout(s, 1000));
    const modal = document.querySelector('.producto-modal');
    const etiquetas = [...modal.querySelectorAll('label')].map(l => l.textContent.trim());
    return {
      sku: etiquetas.some(t => /Código interno \\/ SKU/.test(t)),
      numeroDeParte: etiquetas.some(t => /^Número de parte$/.test(t)),
      casillaCodigo: !!modal.querySelector('[name="tieneCodigoBarras"]'),
      campoCodigo: !!modal.querySelector('[name="barCode"]'),
      bloqueImagen: !!modal.querySelector('.prod-imagen'),
      hayPrevia: !!modal.querySelector('.prod-imagen__marco img'),
      requeridos: [...modal.querySelectorAll('[required]')].map(e => e.getAttribute('name')),
    };
  `);
  if (reposo.sku && !reposo.numeroDeParte) ok('el campo se llama "Código interno / SKU"');
  else mal('la etiqueta no cambio', JSON.stringify(reposo));
  if (reposo.casillaCodigo && !reposo.campoCodigo)
    ok('el código de barras empieza oculto tras su casilla');
  else mal('el campo de código de barras se muestra sin pedirlo');
  if (reposo.bloqueImagen && !reposo.hayPrevia) ok('la imagen aparece vacía, no obliga a nada');
  else mal('el bloque de imagen no esta como se espera', JSON.stringify(reposo));
  if (!reposo.requeridos.includes('barCode')) ok('y ninguno de los dos es obligatorio', `requeridos: ${reposo.requeridos.join(', ')}`);
  else mal('el código de barras quedo obligatorio');

  seccion('La casilla abre y cierra el campo');
  const alterna = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    inv.alternarCodigoBarras(true); ng.applyChanges(inv);
    await new Promise(s => setTimeout(s, 300));
    const visible = !!document.querySelector('.producto-modal [name="barCode"]');
    inv.form.barCode = '7501234567890';
    inv.alternarCodigoBarras(false); ng.applyChanges(inv);
    await new Promise(s => setTimeout(s, 300));
    return { visible, trasDesmarcar: inv.form.barCode, campo: !!document.querySelector('.producto-modal [name="barCode"]') };
  `);
  if (alterna.visible) ok('al marcarla aparece el campo');
  else mal('el campo no aparecio');
  if (!alterna.campo && alterna.trasDesmarcar === '')
    ok('al desmarcarla se oculta y se limpia lo escrito');
  else mal('desmarcar dejo residuo', JSON.stringify(alterna));

  // ============================================================ alta
  seccion('Alta con código de barras e imagen');
  const creado = await ev(`
    ${IMAGEN}
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    const pn = 'QA-EXTRA-' + Date.now();
    const cb = String(Date.now()).slice(-13);
    inv.form.brand = inv.brands[0].id;
    inv.form.category = inv.categorys[0].id;
    inv.form.partNumber = pn;
    inv.form.name = 'QA con extras';
    inv.form.price = 30;
    inv.form.stock = 4;
    inv.alternarCodigoBarras(true);
    inv.form.barCode = cb;
    // Misma ruta que el selector de archivo: deja la vista previa y marca que
    // el usuario la toco.
    inv.imagenPrevia = dataUrl;
    inv['imagenTocada'] = true;
    ng.applyChanges(inv);
    await inv.guardarProducto();
    await new Promise(s => setTimeout(s, 2000));

    const rs = await window.electronAPI.getActiveProducts();
    const lista = rs?.data ?? rs?.recordset ?? rs ?? [];
    const p = (Array.isArray(lista) ? lista : []).find(x => x.part_number === pn);
    return p ? { id: p.id, pn, cb, barCodeEnSql: p.bar_code, version: Number(p.image_version ?? 0) }
             : { error: 'no se creo ' + pn };
  `);
  if (creado.error) { mal(creado.error); console.log(`\nRESULTADO: ${fallos} FALLO(S)`); return { fallos }; }
  if (creado.barCodeEnSql === creado.cb) ok('el código de barras llego a SQL', creado.barCodeEnSql);
  else mal('el código de barras no se guardo', String(creado.barCodeEnSql));
  if (creado.version > 0) ok('y la imagen quedo asociada', `image_version ${creado.version}`);
  else mal('la imagen no se guardo', `image_version ${creado.version}`);

  // ============================================================ edicion
  seccion('Al editar, lo guardado vuelve');
  await ev(SIN_AVISOS);
  const editado = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    // Se abre pulsando el lapiz de la fila, no llamando al metodo: un clic
    // real entra en la zona de Angular, y la vista previa llega por una
    // promesa. Invocando el metodo desde fuera, la pantalla no se entera.
    inv.filtro = '${creado.pn}';
    inv.onFilterChange();
    ng.applyChanges(inv);
    await new Promise(s => setTimeout(s, 900));
    const boton = document.querySelector('.castrol-table tbody tr .btn-editar');
    if (!boton) return { error: 'no se encontro la fila del producto' };
    boton.click();
    // La miniatura llega por IPC: una sola espera, no un bucle de temporizadores.
    // Con la ventana oculta Chromium estrangula las cadenas de setTimeout y un
    // sondeo de 20 vueltas tarda minutos en vez de segundos.
    await new Promise(s => setTimeout(s, 2500));
    return {
      casillaMarcada: inv.form.tieneCodigoBarras,
      codigo: inv.form.barCode,
      campoVisible: !!document.querySelector('.producto-modal [name="barCode"]'),
      hayPrevia: !!inv.imagenPrevia,
      previaEnPantalla: !!document.querySelector('.prod-imagen__marco img'),
    };
  `);
  if (editado.error) mal(editado.error);
  else if (editado.casillaMarcada && editado.codigo === creado.cb && editado.campoVisible)
    ok('la casilla nace marcada con su código', editado.codigo);
  else mal('el código no se cargo al editar', JSON.stringify(editado));
  if (editado.hayPrevia && editado.previaEnPantalla) ok('y la imagen guardada se ve en la vista previa');
  else mal('la imagen guardada no se cargo', JSON.stringify(editado));

  seccion('Y se pueden quitar las dos');
  const quitado = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    inv.alternarCodigoBarras(false);
    inv.quitarImagen();
    ng.applyChanges(inv);
    await inv.guardarProducto();
    await new Promise(s => setTimeout(s, 2000));

    const rs = await window.electronAPI.getActiveProducts();
    const lista = rs?.data ?? rs?.recordset ?? rs ?? [];
    const p = (Array.isArray(lista) ? lista : []).find(x => Number(x.id) === ${creado.id});
    // La miniatura se borra de verdad: se pide de nuevo y no debe llegar.
    const sync = await window.wybix.images.sync({ versions: { ${creado.id}: 99 } });
    const url = (sync?.data ?? sync ?? {})['${creado.id}'];
    return { barCode: p?.bar_code ?? null, quedaMiniatura: !!url };
  `);
  if (!quitado.barCode) ok('el código de barras se limpio en SQL', 'bar_code = NULL');
  else mal('el código sigue guardado', String(quitado.barCode));
  if (!quitado.quedaMiniatura) ok('y la miniatura se borro');
  else mal('la miniatura sigue ahi');

  // ============================================================ limpieza
  seccion('Limpieza');
  await ev(SIN_AVISOS);
  const retirado = await ev(`
    const r = await window.electronAPI.darDeBajaProducto(${creado.id});
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    await inv.consultarInventario();
    return { ok: r?.success, error: r?.error };
  `);
  if (retirado.ok) ok('el producto de prueba se retira por la via normal', creado.pn);
  else mal('no se pudo retirar el producto de prueba', String(retirado.error));

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
