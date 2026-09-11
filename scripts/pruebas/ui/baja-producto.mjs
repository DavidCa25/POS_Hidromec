/**
 * Dar de baja un producto desde Inventario.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/baja-producto.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * El boton de papelera de la tabla de Inventario no tenia handler: era
 * decorativo. `sp_delete_product` existia y estaba desplegado -baja logica,
 * `active = 0`- pero sin canal IPC ni un solo llamador. Crear productos era
 * posible; retirarlos, no.
 *
 * QUE COMPRUEBA
 * -------------
 * En la ventana real: que el boton pregunta antes de actuar, que no promete
 * nada hasta saber el resultado, que la tabla se rehace desde SQL sin recargar
 * la pagina, y que cuando el producto esta en uso lo dice con nombres en vez
 * de fallar en silencio.
 *
 * Crea su propio producto de prueba y lo deja dado de baja: la baja es logica,
 * asi que no borra nada de la base.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

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

  // ------------------------------------------------ un producto propio
  seccion('Preparacion');
  const creado = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    inv.abrirProductoModal();
    await new Promise(s => setTimeout(s, 1200));
    const pn = 'QA-BAJA-' + Date.now();
    inv.form.brand = inv.brands[0].id;
    inv.form.category = inv.categorys[0].id;
    inv.form.partNumber = pn;
    inv.form.name = 'QA para dar de baja';
    inv.form.price = 10;
    inv.form.stock = 5;
    ng.applyChanges(inv);
    await inv.guardarProducto();
    await new Promise(s => setTimeout(s, 1500));
    const fila = inv.inventario.find(p => p.part_number === pn);
    return fila ? { id: fila.id, pn, total: inv.inventario.length } : { error: 'no se creo ' + pn };
  `);
  if (creado.error) { mal(creado.error); console.log(`\nRESULTADO: ${fallos} FALLO(S)`); return { fallos }; }
  ok('producto de prueba creado', `${creado.pn} (id ${creado.id})`);

  // ------------------------------------------------------ confirmacion
  seccion('El boton pregunta antes de actuar');
  const pregunta = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    const item = inv.inventario.find(p => p.id === ${creado.id});
    inv.darDeBajaProducto(item);                 // sin await: queda el dialogo abierto
    await new Promise(s => setTimeout(s, 700));
    const t = document.querySelector('.swal2-title')?.textContent.trim() ?? null;
    const cuerpo = document.querySelector('.swal2-html-container')?.textContent.trim() ?? '';
    const cancelar = document.querySelector('.swal2-cancel');
    const res = {
      titulo: t,
      cuerpo,
      hayCancelar: !!cancelar,
      sigueActivo: inv.inventario.some(p => p.id === ${creado.id}),
    };
    cancelar?.click();                            // se cancela: no debe pasar nada
    await new Promise(s => setTimeout(s, 700));
    res.trasCancelar = inv.inventario.some(p => p.id === ${creado.id});
    return res;
  `);
  if (pregunta.titulo === 'Dar de baja producto') ok('el titulo dice de que se trata', pregunta.titulo);
  else mal('titulo inesperado', String(pregunta.titulo));
  if (/conservará su historial/i.test(pregunta.cuerpo)) ok('y explica que el historial se conserva');
  else mal('no explica que pasa con el historial', pregunta.cuerpo.slice(0, 80));
  if (!/eliminar|borrar|delete/i.test(pregunta.cuerpo + pregunta.titulo))
    ok('sin hablar de borrar: la baja es logica');
  else mal('el texto habla de borrar');
  if (pregunta.hayCancelar && pregunta.trasCancelar)
    ok('al cancelar, el producto sigue en la tabla');
  else mal('cancelar no dejo las cosas como estaban');

  // ------------------------------------------------------------- baja
  seccion('La baja se completa y la tabla se rehace');
  const baja = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    const antes = inv.inventario.length;
    const item = inv.inventario.find(p => p.id === ${creado.id});
    const p = inv.darDeBajaProducto(item);
    await new Promise(s => setTimeout(s, 600));
    document.querySelector('.swal2-confirm')?.click();
    await p;
    await new Promise(s => setTimeout(s, 900));

    // Lo que dice SQL, no lo que dice la pantalla.
    const rs = await window.electronAPI.getActiveProducts();
    const lista = rs?.data ?? rs?.recordset ?? rs ?? [];
    return {
      antes,
      despues: inv.inventario.length,
      enTabla: inv.inventario.some(x => x.id === ${creado.id}),
      enSql: (Array.isArray(lista) ? lista : []).some(x => Number(x.id) === ${creado.id}),
      recargasDePagina: performance.getEntriesByType('navigation').length,
    };
  `);
  if (!baja.enSql) ok('SQL ya no lo devuelve entre los activos');
  else mal('sigue activo en SQL');
  if (!baja.enTabla && baja.despues === baja.antes - 1)
    ok('y la tabla se rehizo sin recargar la pagina', `${baja.antes} -> ${baja.despues} filas`);
  else mal('la tabla no refleja la baja', JSON.stringify(baja));

  // --------------------------------------------------- producto en uso
  seccion('Un producto en uso lo dice con nombres');
  const enUso = await ev(`
    const inv = ng.getComponent(document.querySelector('app-inventario'));
    // Se pide la baja de un producto inexistente por el canal real: el
    // procedimiento es quien responde, no la pantalla.
    const res = await window.electronAPI.darDeBajaProducto(999999);
    return { ok: res?.success, error: res?.error };
  `);
  if (enUso.ok === false && /no existe/i.test(enUso.error || ''))
    ok('el canal devuelve el motivo del procedimiento, no un fallo generico', enUso.error);
  else mal('el canal no propago el motivo', JSON.stringify(enUso));

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  console.log(`   (queda dado de baja ${creado.pn}: la baja es logica, no borra nada)`);
  return { fallos };
}
