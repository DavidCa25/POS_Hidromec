/**
 * El modal de producto sabe crear un ingrediente y una receta.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/producto-hospitality.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * En la prueba de VM no se pudo crear un producto Hospitality desde Inventario.
 * El formulario mandaba marca, categoria, numero de parte, nombre, precio y
 * stock, y nada mas, asi que todo nacia DIRECT / vendible / pza aunque el
 * procedimiento aceptara los cinco campos del dominio desde el principio. Hubo
 * que convertir el producto con un UPDATE a mano, y de paso el formulario dejo
 * capturar "Stock = 3" para algo que no puede tener existencias propias.
 *
 * QUE COMPRUEBA
 * -------------
 * Lo que ve y toca el usuario, en la ventana real:
 *
 *   - en un negocio RETAIL el formulario sigue igual de simple;
 *   - en HOSPITALITY aparece el control del producto;
 *   - elegir "se prepara por receta" retira el stock de la pantalla;
 *   - la unidad base y los decimales van juntos, pero se pueden separar;
 *   - los desplegables son wx-select, no controles del sistema operativo.
 *
 * El giro del negocio se cambia por el mismo canal que usa Configuracion y se
 * restaura al terminar. No se crea ningun producto: eso ya esta probado contra
 * SQL en `npm run db:test-latte`.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

const CAPS = `const caps = ng.getComponent(document.querySelector('app-dashboard')).caps;`;

/**
 * Cambia el giro conservando el resto de la ficha del negocio.
 *
 * La escritura NO depende de que Angular este montado: si la restauracion
 * necesitara `ng`, un fallo a mitad dejaria la base de desarrollo en otro giro.
 * El refresco de capacidades se intenta despues, y solo si hay dashboard.
 */
const ponerGiro = (perfil) => `
  const cfg = await window.electronAPI.getConfig();
  const d = cfg?.data ?? cfg ?? {};
  const res = await window.electronAPI.updateBusinessConfig({
    business_name: d.business_name, address: d.address, phone: d.phone,
    rfc: d.rfc, ticket_footer: d.ticket_footer, business_profile: '${perfil}',
  });
  if (!res?.success) return { error: res?.error || 'no se pudo cambiar el giro' };
  const dash = document.querySelector('app-dashboard');
  if (dash && typeof ng !== 'undefined') await ng.getComponent(dash).caps.load(true);
  const leido = await window.electronAPI.getConfig();
  return { businessProfile: (leido?.data ?? leido ?? {}).business_profile };
`;

/** Abre el alta y describe lo que hay en pantalla. */
const MIRAR_MODAL = `
  const inv = ng.getComponent(document.querySelector('app-inventario'));
  inv.abrirProductoModal();
  ng.applyChanges(inv);
  await new Promise(s => setTimeout(s, 900));
  const modal = document.querySelector('.producto-modal');
  const campo = (n) => !!modal?.querySelector('[name="' + n + '"]');
  return {
    hayModal: !!modal,
    control: !!modal?.querySelector('.prod-control'),
    modos: [...(modal?.querySelectorAll('.prod-modo__t') ?? [])].map(e => e.textContent.trim()),
    stock: campo('stock'),
    unidad: campo('baseUom'),
    decimales: campo('allowDecimalQty'),
    vendible: campo('sellable'),
    selectsNativos: modal?.querySelectorAll('select').length ?? -1,
  };
`;

/** Elige un tipo por el boton real y devuelve como queda el formulario. */
const elegirModo = (indice) => `
  const inv = ng.getComponent(document.querySelector('app-inventario'));
  const botones = [...document.querySelectorAll('.producto-modal .prod-modo')];
  botones[${indice}].click();
  ng.applyChanges(inv);
  await new Promise(s => setTimeout(s, 400));
  const modal = document.querySelector('.producto-modal');
  return {
    modo: inv.form.inventoryMode,
    stockEnPantalla: !!modal.querySelector('[name="stock"]'),
    nota: modal.querySelector('.prod-nota')?.textContent.trim() ?? null,
    marcado: botones[${indice}].classList.contains('on'),
    baseUom: inv.form.baseUom,
    decimales: inv.form.allowDecimalQty,
  };
`;

export default async function ({ ev, cdp }) {
  // Navegar por el protocolo y no desde la pagina: un `location.href` dentro
  // de una evaluacion destruye su propio contexto y su respuesta se pierde.
  const ir = async (ruta, selector) => {
    await cdp('Page.navigate', { url: 'http://localhost:4200' + ruta });
    for (let k = 0; k < 20; k++) {
      await pausa(1000);
      const listo = await ev(`return !!document.querySelector('${selector}') && typeof ng !== 'undefined';`).catch(() => false);
      if (listo) return true;
    }
    return false;
  };
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };
  const seccion = (t) => console.log(`\n-- ${t}`);

  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    location.href = location.origin + '/dashboard/inventario';
    return true;
  `);
  await pausa(7000);

  const giroOriginal = await ev(`
    const cfg = await window.electronAPI.getConfig();
    return (cfg?.data ?? cfg ?? {}).business_profile || 'RETAIL';
  `);
  if (!giroOriginal) { mal('no se llego al dashboard'); return { fallos }; }
  console.log(`   giro de partida: ${giroOriginal}`);

  try {
    // ============================================================ RETAIL
    seccion('Un negocio Retail no ve nada de esto');
    let r = await ev(ponerGiro('RETAIL'));
    if (r.error) { mal('no se pudo poner RETAIL', r.error); }
    let m = await ev(MIRAR_MODAL);
    if (!m.hayModal) mal('el modal no abrio');
    else {
      if (!m.control) ok('el formulario Retail sigue sin el bloque de control');
      else mal('Retail vio controles de alimentos y bebidas');
      if (m.stock) ok('y conserva su campo de Stock de siempre');
      else mal('Retail perdio el campo de Stock');
    }

    // ======================================================= HOSPITALITY
    seccion('Un negocio de alimentos y bebidas si');
    r = await ev(ponerGiro('HOSPITALITY'));
    if (r.error) { mal('no se pudo poner HOSPITALITY', r.error); }
    m = await ev(MIRAR_MODAL);
    if (!m.control) mal('el bloque de control no aparecio');
    else {
      ok('aparece el control del producto', m.modos.join(' / '));
      if (m.modos.length === 3) ok('con los tres tipos del dominio');
      else mal('numero de tipos inesperado', String(m.modos.length));
      if (m.unidad && m.decimales && m.vendible) ok('unidad base, decimales y "se vende en caja"');
      else mal('faltan campos del control', JSON.stringify(m));
    }
    if (m.selectsNativos === 0) ok('sin ningun <select> nativo en el modal');
    else mal('quedan selects nativos en el modal', String(m.selectsNativos));

    seccion('El formulario reacciona al tipo elegido');
    const directo = await ev(elegirModo(0));
    if (directo.modo === 'DIRECT' && directo.stockEnPantalla) ok('inventario directo: se captura Stock');
    else mal('inventario directo no muestra Stock', JSON.stringify(directo));

    const receta = await ev(elegirModo(1));
    if (receta.modo === 'RECIPE' && !receta.stockEnPantalla)
      ok('por receta: el Stock desaparece de la pantalla');
    else mal('por receta sigue pidiendo Stock', JSON.stringify(receta));
    if (/ingredientes de la receta/i.test(receta.nota || ''))
      ok('y lo explica en una linea', receta.nota);
    else mal('no explica de donde sale la disponibilidad', String(receta.nota));
    if (receta.baseUom === 'pza') ok('la unidad vuelve a pieza, que es lo normal en un preparado');
    else mal('la unidad quedo en ' + receta.baseUom);

    const sinInventario = await ev(elegirModo(2));
    if (sinInventario.modo === 'NONE' && !sinInventario.stockEnPantalla)
      ok('sin inventario: tampoco pide Stock');
    else mal('sin inventario sigue pidiendo Stock', JSON.stringify(sinInventario));

    seccion('Unidad y decimales van juntos, pero no atados');
    const uni = await ev(`
      const inv = ng.getComponent(document.querySelector('app-inventario'));
      inv.cambiarModo('DIRECT');
      inv.cambiarUnidad('g');
      const trasGramos = { uom: inv.form.baseUom, dec: inv.form.allowDecimalQty };
      inv.cambiarUnidad('pza');
      const trasPiezas = { uom: inv.form.baseUom, dec: inv.form.allowDecimalQty };
      // El usuario puede desmarcar la sugerencia: el modelo lo permite.
      inv.form.allowDecimalQty = true;
      const forzado = { uom: inv.form.baseUom, dec: inv.form.allowDecimalQty };
      ng.applyChanges(inv);
      // El catalogo llega por IPC: se espera a que este, en vez de leerlo en
      // el mismo instante en que se abrio el modal.
      for (let k = 0; k < 20 && !inv.unidadesBase.length; k++) await new Promise(s => setTimeout(s, 250));
      return { trasGramos, trasPiezas, forzado, unidades: inv.unidadesBase.map(u => u.code) };
    `);
    if (uni.trasGramos.dec === true) ok('gramos sugiere cantidades decimales');
    else mal('gramos no sugirio decimales');
    if (uni.trasPiezas.dec === false) ok('piezas sugiere que no');
    else mal('piezas sugirio decimales');
    if (uni.forzado.dec === true) ok('pero el usuario puede decidir lo contrario');
    else mal('la sugerencia no se puede cambiar');
    if (uni.unidades.length && uni.unidades.every(u => ['pza', 'g', 'ml', 'cm'].includes(u)))
      ok('solo se ofrecen unidades base del dominio', uni.unidades.join(', '));
    else mal('el catalogo de unidades no cuadra', JSON.stringify(uni.unidades));

    seccion('El desplegable responde a raton y a teclado');
    const teclado = await ev(`
      const sel = document.querySelector('.producto-modal wx-select[name="baseUom"]');
      const campo = sel.querySelector('.wx-sel__campo');
      const panel = sel.querySelector('.wx-sel__panel');
      const inv = ng.getComponent(document.querySelector('app-inventario'));

      // Raton: se abre pulsando el campo y se elige una opcion.
      campo.click();
      await new Promise(s => setTimeout(s, 350));
      const abierto = panel.matches(':popover-open');
      const opciones = [...panel.querySelectorAll('.wx-opt')].map(o => o.textContent.trim());
      const gramo = [...panel.querySelectorAll('.wx-opt')].find(o => /Gramo/i.test(o.textContent));
      gramo?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise(s => setTimeout(s, 350));
      const trasRaton = inv.form.baseUom;

      // Teclado: se abre y se recorre con flechas hasta elegir con Enter.
      campo.click();
      await new Promise(s => setTimeout(s, 350));
      const tecla = (k) => panel.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      // Dos flechas desde el principio: una sola caeria sobre la opcion que ya
      // estaba elegida y la prueba no distinguiria "funciona" de "no hizo nada".
      tecla('Home'); tecla('ArrowDown'); tecla('ArrowDown');
      const resaltado = ng.getComponent(sel).indice;
      tecla('Enter');
      await new Promise(s => setTimeout(s, 350));
      return {
        abierto, opciones, trasRaton, resaltado,
        trasTeclado: inv.form.baseUom,
        cerradoAlElegir: !panel.matches(':popover-open'),
      };
    `);
    if (teclado.abierto) ok('abre al pulsar el campo', `${teclado.opciones.length} opciones`);
    else mal('no abrio con el raton');
    if (teclado.trasRaton === 'g') ok('y elegir con el raton fija el valor', teclado.trasRaton);
    else mal('el raton no fijo el valor', String(teclado.trasRaton));
    if (teclado.trasTeclado === 'ml' && teclado.resaltado === 2)
      ok('flechas y Enter tambien eligen', `${teclado.trasRaton} -> ${teclado.trasTeclado}`);
    else mal('el teclado no cambio la seleccion', JSON.stringify(teclado));
    if (teclado.cerradoAlElegir) ok('y el panel se cierra al elegir');
    else mal('el panel se quedo abierto');

    // ============================================================ recetas
    seccion('La pantalla de Recetas usa los controles de Wybix');
    const llego = await ir('/dashboard/recetas', 'app-hospitality-admin');
    const rec = !llego ? { error: 'no se llego a Recetas' } : await ev(`
      const host = document.querySelector('app-hospitality-admin');
      if (!host) return { error: 'no se llego a Recetas (ruta ' + location.pathname + ')' };
      const nativos = host.querySelectorAll('select').length;
      // "Guardar receta" solo existe con un producto elegido. La accion
      // primaria que siempre esta es "Nuevo grupo", en Modificadores, y lleva
      // la misma clase: es la que dice si el sistema visual llego aqui.
      const admin = ng.getComponent(host);
      admin.tab = 'modificadores';
      ng.applyChanges(admin);
      await new Promise(s => setTimeout(s, 600));
      const guardar = host.querySelector('.btn-primary');
      const cs = guardar ? getComputedStyle(guardar) : null;
      return {
        nativos,
        wxSelects: host.querySelectorAll('wx-select').length,
        primario: guardar ? {
          texto: guardar.textContent.trim().slice(0, 24),
          fondo: cs.backgroundColor,
          radio: cs.borderRadius,
          alto: Math.round(guardar.getBoundingClientRect().height),
          fuente: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        } : null,
      };
    `);
    if (rec.error) mal(rec.error);
    else {
      if (rec.nativos === 0) ok('ningun <select> nativo en Recetas y modificadores');
      else mal('quedan selects nativos en Recetas', String(rec.nativos));
      // Un boton de navegador no tiene el acento del tema, ni el radio del
      // sistema, ni la tipografia de la aplicacion. Se comprueban los tres.
      const acento = await ev(`
        const c = document.createElement('span');
        c.style.color = getComputedStyle(document.documentElement).getPropertyValue('--wx-accent').trim();
        document.body.appendChild(c);
        const rgb = getComputedStyle(c).color;
        c.remove();
        return rgb;
      `);
      const p = rec.primario;
      if (p && p.fondo === acento) ok('la accion principal usa el acento del tema', p.fondo);
      else mal('la accion principal no usa el acento del tema', JSON.stringify(p));
      if (p && parseFloat(p.radio) > 0 && /Geist/i.test(p.fuente))
        ok('y la caja y la tipografia del sistema', `radio ${p.radio}, ${p.fuente}, ${p.alto}px`);
      else mal('conserva caja o tipografia de navegador', JSON.stringify(p));
    }

  } finally {
    // Volver al dashboard y esperar a que Angular exista otra vez: tras un
    // `location.href` la pagina se recarga entera y `ng` tarda en aparecer.
    await ir('/dashboard/inventario', 'app-inventario');
    let fin = { error: 'sin dashboard' };
    for (let k = 0; k < 12 && !fin.businessProfile; k++) {
      await pausa(2000);
      fin = await ev(ponerGiro(giroOriginal)).catch(() => ({ error: 'aun cargando' }));
    }
    console.log('   (giro restaurado: ' + (fin.businessProfile ?? fin.error) + ')');
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
