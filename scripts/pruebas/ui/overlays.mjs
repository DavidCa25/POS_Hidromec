/**
 * Anclaje de menus y orden de los avisos, en la ventana real.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/overlays.mjs
 *
 * Cubre los dos defectos que aparecieron en la prueba sobre maquina limpia:
 *
 *   MENU DESANCLADO   Las opciones de un desplegable se abrian lejos de su
 *                     campo, a veces en la esquina contraria de la pantalla.
 *                     Todas las instancias compartian un mismo `anchor-name`,
 *                     y un nombre de ancla repetido resuelve -por
 *                     especificacion- al ULTIMO elemento del arbol. Con cuatro
 *                     desplegables en Inventario, tres apuntaban al equivocado.
 *
 *   AVISO POR DEBAJO  Un error se pintaba DETRAS del modal que lo provocaba.
 *                     SweetAlert2 trae z-index 1060 de fabrica y los modales
 *                     de la aplicacion van de 2000 a 12500.
 *
 * Para el segundo no se comparan numeros: se pregunta quien recibe el clic
 * donde esta el boton del aviso. Es lo que averigua el usuario al intentar
 * pulsarlo.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

const TAMANOS = [
  { w: 1366, h: 768 },
  { w: 1600, h: 900 },
  { w: 1920, h: 1080 },
];

/** Abre cada wx-select visible y mide donde cae respecto de SU campo. */
const MEDIR_ANCLAJE = `
  const salida = { total: 0, fallos: [], detalle: [] };
  for (const p of document.querySelectorAll(':popover-open')) p.hidePopover();
  for (const sel of document.querySelectorAll('wx-select')) {
    const campo = sel.querySelector('.wx-sel__campo');
    const panel = sel.querySelector('.wx-sel__panel');
    if (!campo || !panel || campo.disabled) continue;
    const rc = campo.getBoundingClientRect();
    if (rc.width === 0) continue;                 // dentro de un paso oculto

    // Con la ventana en segundo plano el compositor no entrega fotogramas y
    // requestAnimationFrame no se dispara nunca: se espera por reloj.
    panel.showPopover();
    await new Promise(s => setTimeout(s, 120));
    const rp = panel.getBoundingClientRect();
    panel.hidePopover();

    salida.total++;
    const etiqueta = (campo.textContent || '').trim().slice(0, 22) || '(sin texto)';

    // Abajo o arriba del campo: el navegador voltea cuando no cabe. Lo que no
    // puede pasar es que aparezca a media pantalla de distancia.
    const separacion = Math.min(Math.abs(rp.top - rc.bottom), Math.abs(rc.top - rp.bottom));
    if (separacion > 24)
      salida.fallos.push(etiqueta + ': abre a ' + Math.round(separacion) + 'px de su campo');

    // Alineado con SU campo, no con otro cualquiera.
    const desvioX = Math.min(Math.abs(rp.left - rc.left), Math.abs(rp.right - rc.right));
    if (desvioX > 24)
      salida.fallos.push(etiqueta + ': se desvia ' + Math.round(desvioX) + 'px en horizontal');

    if (rp.left < -0.5 || rp.right > innerWidth + 0.5 || rp.top < -0.5 || rp.bottom > innerHeight + 0.5)
      salida.fallos.push(etiqueta + ': el menu se sale del viewport');

    const ancla = getComputedStyle(campo).anchorName;
    if (!ancla || ancla === 'none')
      salida.fallos.push(etiqueta + ': el campo no declara anchor-name');

    salida.detalle.push({ etiqueta, ancla, separacion: Math.round(separacion), desvioX: Math.round(desvioX) });
  }
  return salida;
`;

/** Un nombre de ancla repetido es la causa exacta del defecto. */
const ANCLAS_UNICAS = `
  const nombres = [...document.querySelectorAll('wx-select .wx-sel__campo, wx-date .wx-date__campo')]
    .map(e => getComputedStyle(e).anchorName).filter(n => n && n !== 'none');
  return { total: nombres.length, repetidos: [...new Set(nombres.filter((n, i) => nombres.indexOf(n) !== i))] };
`;

/**
 * Deja una capa tan alta como el modal mas alto que declara la aplicacion.
 * 12500 es el maximo de hoy (pantalla de venta y cancelacion de factura): si
 * el aviso gana aqui, gana en todas.
 */
const PONER_TOPE = `
  const t = document.createElement('div');
  t.id = 'qa-tope';
  t.style.cssText = 'position:fixed;inset:0;z-index:12500;background:rgba(0,0,0,.35)';
  document.body.appendChild(t);
  return true;
`;
const QUITAR_TOPE = `document.getElementById('qa-tope')?.remove(); return true;`;

/**
 * Con el aviso ya abierto: quien recibe el clic donde esta el boton de
 * aceptar, y de donde salio la capa del contenedor. Lo primero es la pregunta
 * del usuario; lo segundo dice si la capa vino del token o de otro sitio.
 */
const MIRAR_AVISO = `
  const cont = document.querySelector('.swal2-container');
  const boton = document.querySelector('.swal2-confirm');
  if (!cont || !boton) return { pintado: false };
  const r = boton.getBoundingClientRect();
  const encima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    pintado: r.width > 0 && r.height > 0,
    alcanzable: !!encima && !!encima.closest('.swal2-container'),
    recibeElClic: encima ? (encima.className || encima.tagName) : '(nada)',
    capa: getComputedStyle(cont).zIndex,
    techo: getComputedStyle(document.documentElement).getPropertyValue('--wx-z-alerta').trim(),
    icono: (document.querySelector('.swal2-icon.swal2-info') && 'info') ||
           (document.querySelector('.swal2-icon.swal2-warning') && 'warning') ||
           (document.querySelector('.swal2-icon.swal2-error') && 'error') ||
           (document.querySelector('.swal2-icon.swal2-question') && 'question') || '(sin icono)',
    conCancelar: !!document.querySelector('.swal2-cancel'),
  };
`;

/**
 * Cierra el aviso y dice si desaparecio de verdad.
 *
 * SweetAlert2 quita el contenedor cuando termina la animacion de salida. Si la
 * ventana esta oculta -minimizada o tapada- Chromium congela las animaciones,
 * el evento no llega nunca y el aviso se queda puesto. Eso no dice nada sobre
 * la aplicacion, asi que en ese caso la comprobacion se declara no medible en
 * vez de darla por buena o por mala.
 */
const CERRAR_AVISO = `
  const b = document.querySelector('.swal2-cancel') || document.querySelector('.swal2-confirm');
  if (b) b.click();
  await new Promise(s => setTimeout(s, 600));
  const cont = document.querySelector('.swal2-container');
  if (document.visibilityState !== 'visible')
    return { medible: false, cerrando: !cont || /swal2-backdrop-hide/.test(cont.className) };
  return { medible: true, cerrado: !cont };
`;

/**
 * Los cuatro avisos salen de codigo REAL de la pantalla, no de un Swal
 * inventado por la prueba: si manana alguien cambia como se avisa, la prueba
 * cambia con la aplicacion. Ninguno escribe en la base: todos son la rama de
 * validacion que devuelve antes de llamar a nada.
 */
const inv = `const c = ng.getComponent(document.querySelector('app-inventario'));`;
const CASOS = [
  { nombre: 'error (campos incompletos)',
    disparar: `${inv} c.form = { brand: null, category: null, partNumber: '', name: '', price: null, stock: 0 }; c.addProduct(); return true;` },
  { nombre: 'aviso (falta el nombre de la categoria)',
    disparar: `${inv} c.newCategoryName = ''; c.crearCategoryCatalogo(); return true;` },
  { nombre: 'aviso (falta elegir proveedor)',
    disparar: `${inv} c.supplierToAdd = null; c.agregarProveedorAlProducto(); return true;` },
  { nombre: 'confirmacion (quitar proveedor)', cancelar: true,
    disparar: `${inv} c.quitarProveedor({ supplier_name: 'Proveedor de prueba', supplier_id: -1 }); return true;` },
];

export default async function ({ ev, cdp }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };

  const medir = (w, h) => cdp('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  // ------------------------------------------------ sesion e Inventario
  // Igual que el resto de smokes: se establece la sesion como hace el login
  // tras validar, porque lo que se prueba aqui no es la autenticacion.
  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    location.href = location.origin + '/dashboard/inventario';
    return true;
  `);
  await pausa(6000);

  console.log('\n-- Desplegables dentro del modal de producto (Inventario)');
  const estado = await ev(`
    const host = document.querySelector('app-inventario');
    if (!host) return 'no se llego a Inventario (ruta ' + location.pathname + ')';
    const c = ng.getComponent(host);
    c.abrirProductoModal();
    ng.applyChanges(c);
    await new Promise(s => setTimeout(s, 1200));
    return document.querySelectorAll('wx-select').length + ' desplegables en pantalla';
  `);
  console.log('   ' + estado);
  if (/no se llego/.test(String(estado))) {
    mal('no se pudo abrir Inventario');
    console.log(`\nRESULTADO: ${fallos} FALLO(S)`);
    return { fallos };
  }

  for (const { w, h } of TAMANOS) {
    await medir(w, h);
    await pausa(700);
    const r = await ev(MEDIR_ANCLAJE);
    const et = `${w}x${h}`;
    if (!r.total) { mal(`${et}: no se encontro ningun desplegable que medir`); continue; }
    if (r.fallos.length) r.fallos.forEach(f => mal(`${et}  ${f}`));
    else ok(`${et}: ${r.total} menus abren sobre su propio campo`,
            r.detalle.map(d => `${d.separacion}px`).join(' / '));
  }

  const anclas = await ev(ANCLAS_UNICAS);
  if (anclas.repetidos.length) mal('nombres de ancla repetidos', anclas.repetidos.join(', '));
  else ok(`los ${anclas.total} campos anclables tienen nombre propio`);

  // ------------------------------------------------------------- avisos
  console.log('\n-- Un aviso nunca queda detras del modal que lo provoca');
  // SweetAlert2 cierra al terminar su animacion de salida. Con la ventana en
  // segundo plano el compositor no anima, el evento no llega y el aviso se
  // queda abierto: no es un defecto de la aplicacion, es que nadie la mira.
  await cdp('Page.bringToFront');
  await medir(1366, 768);
  await pausa(500);
  for (const caso of CASOS) {
    await ev(PONER_TOPE);
    await ev(caso.disparar);
    await pausa(700);
    const r = await ev(MIRAR_AVISO);
    if (!r.pintado) mal(`${caso.nombre}: el aviso no llego a pintarse`);
    else if (!r.alcanzable) mal(`${caso.nombre}: el clic lo recibe "${r.recibeElClic}"`);
    else if (r.capa !== r.techo) mal(`${caso.nombre}: capa ${r.capa}, se esperaba el token ${r.techo}`);
    else if (caso.cancelar && !r.conCancelar) mal(`${caso.nombre}: se esperaba una confirmacion con Cancelar`);
    else ok(`${caso.nombre}: por encima del modal y pulsable`, `icono ${r.icono} / capa ${r.capa}`);
    const cierre = await ev(CERRAR_AVISO);
    if (cierre.medible && !cierre.cerrado) mal(`${caso.nombre}: el aviso no se cerro al pulsar`);
    else if (!cierre.medible && !cierre.cerrando) mal(`${caso.nombre}: al pulsar ni siquiera empezo a cerrarse`);
    else if (!cierre.medible) console.log('          (cierre no medible: la ventana esta oculta y Chromium congela la animacion; solo se comprueba que arranca)');
    await ev(QUITAR_TOPE);
    await pausa(300);
  }

  await ev(`
    const host = document.querySelector('app-inventario');
    if (host) { const c = ng.getComponent(host); c.cerrarProductoModal(); ng.applyChanges(c); }
    return true;
  `);
  await cdp('Emulation.clearDeviceMetricsOverride');

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
