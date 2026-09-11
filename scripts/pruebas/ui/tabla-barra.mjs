/**
 * Filtrar / Agrupar / Columnas: la misma barra en las cinco tablas.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/tabla-barra.mjs
 *
 * QUE SE CONSTRUYO
 * ----------------
 * Las tablas de Wybix no son iguales por dentro: Inventario, Compras y Ventas
 * usan `castrol-table`; Proveedores y Clientes usan `tabla-corte`. Reescribir
 * las cinco para unificarlas seria mucho riesgo por poca ganancia, asi que lo
 * compartido es el ESTADO -`EstadoTabla`- y la barra que lo maneja. Cada
 * pantalla sigue pintando sus propias celdas.
 *
 * QUE COMPRUEBA
 * -------------
 * En las CINCO, sobre la ventana real:
 *
 *     la barra existe y abre sus tres paneles sin que nada los recorte
 *     ocultar una columna quita su <th> y sus <td>
 *     una columna obligatoria no se puede ocultar
 *     filtrar deja exactamente las filas que el propio panel anuncia
 *     agrupar produce cabeceras plegables sin romper la paginacion
 *     la preferencia sobrevive a salir y volver
 *
 * La ultima es la que de verdad importa: si la configuracion no persiste, la
 * funcion es una curiosidad y nadie la usa dos veces.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

/** Las cinco tablas: ruta, selector, y por donde se llega al estado. */
const TABLAS = [
  { nombre: 'Inventario',  ruta: '/dashboard/inventario',  sel: 'app-inventario',
    tabla: 'castrol-table', origen: 'inventarioFiltrado', columnaOcultable: 'brand_name', obligatoria: 'product_name' },
  { nombre: 'Compras',     ruta: '/dashboard/tablaCompra', sel: 'app-tabla-compra',
    tabla: 'castrol-table', origen: 'comprasFiltradas', columnaOcultable: 'fecha', obligatoria: 'id' },
  { nombre: 'Ventas',      ruta: '/dashboard/tablaVenta',  sel: 'app-tabla-venta',
    tabla: 'castrol-table', origen: 'filteredSales', columnaOcultable: 'user_name', obligatoria: 'id' },
  { nombre: 'Proveedores', ruta: '/dashboard/proveedores', sel: 'app-proveedores',
    tabla: 'tabla-corte', origen: 'view', columnaOcultable: 'total_paid', obligatoria: 'nombre' },
  { nombre: 'Clientes',    ruta: '/dashboard/clientes',    sel: 'app-clientes',
    tabla: 'tabla-corte', origen: 'clientesView', columnaOcultable: 'creditLimit', obligatoria: 'name' },
];

export default async function ({ ev, cdp }) {
  let fallos = 0;
  const ok = (t, d = '') => console.log(`   ok     ${t}${d ? '  · ' + d : ''}`);
  const mal = (t, d = '') => { fallos++; console.log(`   FALLA  ${t}${d ? '  · ' + d : ''}`); };
  const seccion = (t) => console.log(`\n-- ${t}`);

  const ir = async (ruta, selector) => {
    await cdp('Page.navigate', { url: 'http://localhost:4200' + ruta });
    for (let k = 0; k < 30; k++) {
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

  // Se parte de cero para que una preferencia guardada de otra corrida no
  // haga pasar por bueno un estado que la prueba no puso.
  await ev(`
    Object.keys(localStorage).filter(k => k.startsWith('wx-tabla:')).forEach(k => localStorage.removeItem(k));
    return true;
  `).catch(() => {});

  for (const t of TABLAS) {
    seccion(t.nombre);
    if (!await ir(t.ruta, t.sel)) { mal(`no se llego a ${t.nombre}`); continue; }

    // OJO: con la ventana oculta Chromium estrangula las cadenas de
    // setTimeout, asi que un solo `ev` con muchas esperas encadenadas tarda
    // minutos y agota el tiempo del protocolo. Se parte en llamadas cortas.
    const base = await ev(`
      document.querySelectorAll('.wx-pop').forEach(p => { try { if (p.matches(':popover-open')) p.hidePopover(); } catch {} });
      const c = ng.getComponent(document.querySelector('${t.sel}'));
      if (!c.tabla) return { error: 'la pantalla no tiene EstadoTabla' };
      return {
        hayBarra: !!document.querySelector('wx-tabla-barra'),
        filas: (c['${t.origen}'] || []).length,
        botones: [...document.querySelectorAll('wx-tabla-barra .wx-tb__btn')]
                   .map(b => b.textContent.replace(/\s+/g, ' ').trim()),
        filtrables: c.tabla.columnasFiltrables.map(x => x.clave),
        agrupables: c.tabla.columnasAgrupables.map(x => x.clave),
      };
    `);
    if (base.error) { mal(base.error); continue; }

    // Un panel por llamada: una sola espera cada vez.
    const paneles = [];
    for (let k = 0; k < (base.botones || []).length; k++) {
      paneles.push(await ev(`
        const b = [...document.querySelectorAll('wx-tabla-barra .wx-tb__btn')][${k}];
        b.click();
        await new Promise(s => setTimeout(s, 300));
        const p = [...document.querySelectorAll('wx-tabla-barra .wx-pop')].find(x => x.matches(':popover-open'));
        if (!p) return { abre: false };
        const q = p.getBoundingClientRect();
        const r = { abre: true, alto: Math.round(q.height),
                    dentro: q.top >= 0 && q.left >= 0 && q.bottom <= innerHeight + 1 && q.right <= innerWidth + 1 };
        p.hidePopover();
        return r;
      `));
    }

    const cols = await ev(`
      const c = ng.getComponent(document.querySelector('${t.sel}'));
      const est = c.tabla;
      const ths = () => document.querySelectorAll('.${t.tabla} thead th').length;
      const tds = () => {
        const f = document.querySelector('.${t.tabla} tbody tr:not(.wx-grupo-fila):not(.detail-row)');
        return f ? f.querySelectorAll('td').length : 0;
      };
      const thsAntes = ths(), tdsAntes = tds();
      est.alternarColumna('${t.columnaOcultable}'); ng.applyChanges(c);
      await new Promise(s => setTimeout(s, 250));
      const thsDespues = ths(), tdsDespues = tds();
      est.alternarColumna('${t.columnaOcultable}'); ng.applyChanges(c);
      await new Promise(s => setTimeout(s, 250));
      const puedeOcultarObligatoria = est.puedeOcultar('${t.obligatoria}');
      est.alternarColumna('${t.obligatoria}');
      return { thsAntes, tdsAntes, thsDespues, tdsDespues, thsVuelta: ths(),
               puedeOcultarObligatoria, obligatoriaSigue: est.esVisible('${t.obligatoria}') };
    `);

    const datos = await ev(`
      const c = ng.getComponent(document.querySelector('${t.sel}'));
      const est = c.tabla;
      const origen = () => c['${t.origen}'] || [];
      const out = {};
      const filtrables = est.columnasFiltrables;
      if (filtrables.length && origen().length) {
        const clave = filtrables[0].clave;
        const ops = est.opcionesDeFiltro(clave, origen());
        if (ops.length) {
          est.alternarFiltro(clave, ops[0].valor);
          out.filtro = { clave, valor: ops[0].valor, anunciadas: ops[0].n, reales: est.filtrar(origen()).length };
          est.limpiarFiltros();
          out.trasLimpiar = est.filtrar(origen()).length;
        }
      }
      const agrupables = est.columnasAgrupables;
      if (agrupables.length && origen().length) {
        est.agruparPor(agrupables[0].clave);
        ng.applyChanges(c);
        await new Promise(s => setTimeout(s, 350));
        const items = est.aplanar(est.filtrar(origen()));
        const grupos = items.filter(i => i.tipo === 'grupo');
        out.grupos = grupos.length;
        out.filasAgrupadas = items.filter(i => i.tipo === 'fila').length;
        out.cabecerasPintadas = document.querySelectorAll('.wx-grupo-fila').length;
        if (grupos.length) {
          est.alternarGrupo(grupos[0].clave);
          out.trasPlegar = est.aplanar(est.filtrar(origen())).filter(i => i.tipo === 'fila').length;
          out.plegadas = grupos[0].total;
          est.alternarGrupo(grupos[0].clave);
        }
        est.agruparPor(null);
      }
      // Se deja algo puesto para comprobar la persistencia al volver.
      est.alternarColumna('${t.columnaOcultable}');
      return out;
    `);

    const r = { ...base, ...cols, ...datos, paneles };

    if (r.error) { mal(r.error); continue; }

    if (r.hayBarra) ok('la barra está en la pantalla', `${r.filas} filas`);
    else { mal('no hay barra en esta tabla'); continue; }

    if (r.botones?.length === 3) ok('con sus tres controles', r.botones.join(' | '));
    else mal('faltan controles', JSON.stringify(r.botones));

    const cerrados = (r.paneles || []).filter(p => !p.abre);
    const recortados = (r.paneles || []).filter(p => p.abre && !p.dentro);
    if (!cerrados.length && !recortados.length)
      ok('los tres paneles abren completos y dentro de la ventana',
         (r.paneles || []).map(p => p.alto + 'px').join(', '));
    else mal('algún panel no abre o se sale', JSON.stringify(r.paneles));

    if (r.thsDespues === r.thsAntes - 1 && r.tdsDespues === r.tdsAntes - 1)
      ok('ocultar una columna quita su encabezado Y sus celdas',
         `${r.thsAntes} -> ${r.thsDespues} columnas`);
    else mal('la columna no se ocultó bien',
             `th ${r.thsAntes}->${r.thsDespues}, td ${r.tdsAntes}->${r.tdsDespues}`);

    if (r.thsVuelta === r.thsAntes) ok('y volver a mostrarla la devuelve');
    else mal('la columna no volvió', `${r.thsVuelta} vs ${r.thsAntes}`);

    if (r.puedeOcultarObligatoria === false && r.obligatoriaSigue === true)
      ok('una columna obligatoria no se puede quitar', 'la tabla no se puede dejar inutilizable');
    else mal('se pudo ocultar una columna obligatoria');

    if (r.filtro) {
      if (r.filtro.reales === r.filtro.anunciadas)
        ok('filtrar deja justo las filas que el panel anuncia',
           `${r.filtro.clave} = ${r.filtro.valor}: ${r.filtro.reales}`);
      else mal('el filtro no cuadra con su contador',
               `anuncia ${r.filtro.anunciadas}, deja ${r.filtro.reales}`);
      if (r.trasLimpiar === r.filas) ok('y limpiar devuelve todas', `${r.trasLimpiar}`);
      else mal('limpiar no devolvió todas', `${r.trasLimpiar} de ${r.filas}`);
    } else if (!r.filas) {
      console.log('   ----   esta base no tiene filas en esta tabla: filtro y agrupacion no se ejercitan');
    } else if (r.filtrables?.length) {
      console.log('   ----   sin valores suficientes para ejercitar el filtro');
    } else {
      mal('esta tabla no ofrece ningún filtro');
    }

    if (r.grupos != null) {
      if (r.grupos > 0 && r.filasAgrupadas === r.filas)
        ok('agrupar conserva todas las filas', `${r.grupos} grupos, ${r.filasAgrupadas} filas`);
      else mal('agrupar perdió o duplicó filas', `${r.filasAgrupadas} de ${r.filas}`);
      if (r.cabecerasPintadas > 0) ok('y las cabeceras se pintan en la tabla', `${r.cabecerasPintadas} visibles en la página`);
      else mal('no se pintó ninguna cabecera de grupo');
      if (r.trasPlegar === r.filas - r.plegadas)
        ok('plegar un grupo retira exactamente sus filas', `${r.filas} -> ${r.trasPlegar}`);
      else mal('plegar no cuadra', `${r.trasPlegar}, se esperaba ${r.filas - r.plegadas}`);
    } else if (!r.filas) {
      // ya se dijo arriba
    } else if (r.agrupables?.length) {
      console.log('   ----   sin valores suficientes para ejercitar la agrupación');
    } else {
      mal('esta tabla no ofrece ninguna agrupación');
    }

    // ---- la preferencia sobrevive a salir y volver ----
    await ir('/dashboard/estadisticas', 'app-dashboard');
    if (!await ir(t.ruta, t.sel)) { mal('no se pudo volver a la pantalla'); continue; }
    const persiste = await ev(`
      const c = ng.getComponent(document.querySelector('${t.sel}'));
      return { oculta: !c.tabla.esVisible('${t.columnaOcultable}') };
    `);
    if (persiste.oculta) ok('la columna sigue oculta al volver a entrar', 'la preferencia se guardó');
    else mal('la preferencia se perdió al salir de la pantalla');

    // Se deja como estaba.
    await ev(`
      const c = ng.getComponent(document.querySelector('${t.sel}'));
      c.tabla.mostrarTodasLasColumnas(); c.tabla.limpiarFiltros(); c.tabla.agruparPor(null);
      return true;
    `).catch(() => {});
  }

  await ev(`
    Object.keys(localStorage).filter(k => k.startsWith('wx-tabla:')).forEach(k => localStorage.removeItem(k));
    return true;
  `).catch(() => {});

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
