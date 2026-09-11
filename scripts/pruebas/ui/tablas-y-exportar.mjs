/**
 * La barra de las tablas se lee en los dos temas, y Exportar funciona.
 *
 *     node scripts/pruebas/conducir-app.mjs scripts/pruebas/ui/tablas-y-exportar.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * TEMA OSCURO. La barra de herramientas -recuento, buscador, rango, "Mostrar",
 * paginacion- estaba COPIADA en tablaCompra.css, tablaVenta.css e
 * inventario.css, y las tres copias pintaban con literales de tema claro:
 * #f1f6ff de fondo, rgba(11,27,77,...) de texto. En oscuro los tokens cambian
 * pero los literales no, asi que "4 compras registradas", "1-4 de 4",
 * "Mostrar" y los botones Anterior/Siguiente quedaban texto claro sobre fondo
 * claro. Solo inventario.css tenia un parche puntual, que es la senal de que
 * se estaba tapando el sintoma pantalla por pantalla.
 *
 * EXPORTAR. El menu era un <div> absoluto dentro de una cabecera con
 * `overflow: hidden`, asi que quedaba RECORTADO: se veia la opcion PDF y la de
 * Excel no. No era z-index -subirlo nunca lo iba a arreglar-, era recorte.
 *
 * Y el PDF reventaba en la aplicacion empaquetada con "g is not a function":
 * `import('jspdf-autotable')` es un bundle UMD y, segun como lo procese el
 * empaquetador, llega como funcion, como {default:fn} o como
 * {default:{default:fn}}. Se asumia una sola forma.
 *
 * QUE COMPRUEBA
 * -------------
 * Sobre la ventana real: contraste medido (WCAG) en claro y en oscuro en las
 * TRES tablas, que el menu abra completo y con las dos opciones alcanzables, y
 * que exportar produzca bytes de un PDF y de un XLSX de verdad.
 */
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

/** Umbral AA para texto normal. */
const AA = 4.5;

/** Contraste WCAG de los elementos de la barra, en el tema que este puesto. */
const MEDIR = `
  const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => {
    const m = String(c || '').match(/[0-9.]+/g);
    if (!m || m.length < 3) return null;
    return 0.2126 * canal(+m[0]) + 0.7152 * canal(+m[1]) + 0.0722 * canal(+m[2]);
  };
  // El fondo real: se sube por los ancestros hasta uno opaco de verdad.
  const opaco = (el) => {
    let n = el;
    while (n) {
      const c = getComputedStyle(n).backgroundColor;
      const m = String(c).match(/[0-9.]+/g);
      const alfa = m && m.length > 3 ? +m[3] : 1;
      if (m && alfa > 0.5) return c;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const medir = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const lt = lum(getComputedStyle(el).color);
    const lf = lum(opaco(el));
    if (lt == null || lf == null) return null;
    return Number((((Math.max(lt, lf) + 0.05) / (Math.min(lt, lf) + 0.05))).toFixed(2));
  };
  return {
    'recuento':   medir('.ventas-stats-badge'),
    'rango':      medir('.ventas-meta .range'),
    'Mostrar':    medir('.ventas-page-size span'),
    'Anterior':   medir('.pager-btn'),
    'paginacion': medir('.page-btn'),
    'buscador':   medir('.ventas-search input'),
  };
`;

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
  const tema = (oscuro) => `
    document.documentElement.classList.${oscuro ? 'add' : 'remove'}('dark');
    await new Promise(s => setTimeout(s, 500));
    return document.documentElement.className;
  `;

  await ev(`
    const users = await window.electronAPI.getActiveUsers();
    const u = (users?.data ?? users?.recordset ?? users ?? [])[0];
    localStorage.setItem('usuarioActual', JSON.stringify({ id: u.id, nombre: u.usuario, rol: u.rol }));
    return true;
  `).catch(() => {});

  const TABLAS = [
    ['Compras',    '/dashboard/tablaCompra', 'app-tabla-compra'],
    ['Inventario', '/dashboard/inventario',  'app-inventario'],
    ['Ventas',     '/dashboard/tablaVenta',  'app-tabla-venta'],
  ];

  const temaOriginal = await ev(`return document.documentElement.classList.contains('dark');`).catch(() => false);

  try {
    // ================================================ contraste en los dos temas
    for (const [etiqueta, oscuro] of [['claro', false], ['oscuro', true]]) {
      seccion(`La barra de herramientas se lee en tema ${etiqueta}`);
      const porTabla = {};
      for (const [nombre, ruta, sel] of TABLAS) {
        if (!await ir(ruta, sel)) { mal(`no se llego a ${nombre}`); continue; }
        await ev(tema(oscuro));
        const m = await ev(MEDIR);
        porTabla[nombre] = m;

        const medidos = Object.entries(m).filter(([, v]) => typeof v === 'number');
        const flojos = medidos.filter(([, v]) => v < AA);
        if (!medidos.length) { mal(`${nombre}: no se pudo medir ningun elemento`); continue; }
        if (flojos.length === 0) {
          const min = Math.min(...medidos.map(([, v]) => v));
          ok(`${nombre}: los ${medidos.length} elementos pasan AA`, `el peor, ${min}:1`);
        } else {
          mal(`${nombre}: ${flojos.length} por debajo de ${AA}:1`,
              flojos.map(([k, v]) => `${k}=${v}`).join(', '));
        }
      }

      // Si las tres tablas dan el MISMO numero, es que comparten una sola
      // definicion. Si divergen, alguien volvio a copiar la barra.
      const firmas = Object.entries(porTabla).map(([n, m]) => [n, JSON.stringify(m)]);
      const distintas = new Set(firmas.map(([, f]) => f));
      if (firmas.length === 3 && distintas.size === 1)
        ok('y las tres tablas miden lo mismo: comparten una sola definicion');
      else if (firmas.length === 3)
        mal('las tablas miden distinto: hay estilos duplicados otra vez',
            firmas.map(([n, f]) => n + '=' + f).join(' | '));
    }

    // ============================================================ el menu
    seccion('El menu de Exportar abre entero');
    if (!await ir('/dashboard/inventario', 'app-inventario')) throw new Error('sin inventario');
    await ev(tema(false));
    const menu = await ev(`
      const b = document.querySelector('wx-menu button');
      if (!b) return { error: 'no hay wx-menu en la pantalla' };
      b.click();
      await new Promise(s => setTimeout(s, 500));
      const panel = document.querySelector('wx-menu .wx-pop');
      if (!panel) return { error: 'no se encontro el panel' };
      const r = panel.getBoundingClientRect();
      // Alcanzable de verdad: lo que hay en el centro de cada opcion es la
      // opcion. Si algo la tapa o la recorta, esto lo caza.
      const ops = [...panel.querySelectorAll('button')].map(x => {
        const rb = x.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(rb.left + rb.width / 2), Math.round(rb.top + rb.height / 2));
        return { texto: x.textContent.trim(), alcanzable: el === x || x.contains(el), alto: Math.round(rb.height) };
      });
      const dentroDePantalla = r.top >= 0 && r.left >= 0 &&
                               r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
      if (panel.hidePopover) panel.hidePopover();
      return { abierto: true, dentroDePantalla, ops, alto: Math.round(r.height) };
    `);
    if (menu.error) mal(menu.error);
    else {
      const tapadas = (menu.ops || []).filter(o => !o.alcanzable);
      if (menu.ops?.length >= 2) ok('el panel trae sus dos opciones', menu.ops.map(o => o.texto).join(', '));
      else mal('faltan opciones en el menu', JSON.stringify(menu.ops));
      if (tapadas.length === 0) ok('ninguna queda tapada ni recortada', `alto total ${menu.alto}px`);
      else mal('hay opciones inalcanzables', tapadas.map(o => o.texto).join(', '));
      if (menu.dentroDePantalla) ok('y el panel cabe completo en la ventana');
      else mal('el panel se sale de la ventana');
    }

    // ============================================ el boton, no solo el menu
    //
    // REGRESION: al mover el disparador dentro de `wx-menu`, dejo de recibir
    // los estilos de la pantalla -Angular encapsula por componente- y salio
    // con el gris por defecto del navegador. Aqui se compara contra un boton
    // HERMANO de la misma fila: si vuelve a desincronizarse, se ve.
    seccion('El botón de Exportar se ve como sus vecinos');
    for (const [pantalla, ruta, sel, hermano] of [
      ['Inventario', '/dashboard/inventario', 'app-inventario', 'Agregar Marca'],
      ['Ventas',     '/dashboard/tablaVenta', 'app-tabla-venta', 'Descargar PDFs'],
    ]) {
      if (!await ir(ruta, sel)) { mal(`no se llego a ${pantalla}`); continue; }
      // La cabecera puede tardar un instante mas que el componente.
      await pausa(800);
      const m = await ev(`
        const cs = (el) => { const s = getComputedStyle(el);
          return { fondo: s.backgroundColor, texto: s.color, radio: s.borderTopLeftRadius,
                   alto: Math.round(el.getBoundingClientRect().height) }; };
        const disparador = document.querySelector('wx-menu .wx-menu__btn');
        // Sin expresion regular: al viajar por el protocolo, un \s se
        // convierte en una 's' literal y el filtro borraria todas las eses.
        const limpio = (t) => String(t || '').split(String.fromCharCode(10)).join(' ')
                                             .split(String.fromCharCode(9)).join(' ').trim();
        const vecino = [...document.querySelectorAll('button, a')]
          .find(b => limpio(b.textContent).indexOf('${hermano}') >= 0);
        if (!disparador || !vecino) return { error: 'falta ' +
          (!disparador ? 'el disparador de wx-menu' : '') +
          (!disparador && !vecino ? ' y ' : '') +
          (!vecino ? 'el vecino "${hermano}"' : '') };
        return { menu: cs(disparador), vecino: cs(vecino) };
      `);
      if (m.error) { mal(`${pantalla}: ${m.error}`); continue; }

      // Estilo nativo del navegador: gris claro y sin radio. Es lo que se vio.
      const nativo = /rgb\(239, 239, 239|buttonface/i.test(m.menu.fondo);
      if (!nativo) ok(`${pantalla}: el disparador NO cayó al estilo del navegador`, m.menu.fondo);
      else mal(`${pantalla}: el botón volvió al gris nativo`, m.menu.fondo);

      if (m.menu.alto === m.vecino.alto && m.menu.radio === m.vecino.radio)
        ok(`  y tiene el mismo alto y radio que "${hermano}"`, `${m.menu.alto}px · radio ${m.menu.radio}`);
      else mal(`  desalineado con "${hermano}"`,
               `menu ${m.menu.alto}px/${m.menu.radio} vs vecino ${m.vecino.alto}px/${m.vecino.radio}`);

      if (m.menu.texto === m.vecino.texto)
        ok('  y el mismo color de texto', m.menu.texto);
      else mal('  distinto color de texto', `${m.menu.texto} vs ${m.vecino.texto}`);
    }

    if (!await ir('/dashboard/inventario', 'app-inventario')) throw new Error('sin inventario');

    // ======================================================= exportaciones
    seccion('Exportar produce archivos de verdad');
    const exp = await ev(`
      const inv = ng.getComponent(document.querySelector('app-inventario'));
      const srv = inv.reports;
      // El puente de Electron esta congelado (contextBridge) y no se puede
      // sustituir. Se intercepta el metodo del servicio, que si es un objeto
      // normal: lo que se comprueba es que los BYTES se generen bien.
      const vistos = [];
      const original = srv.entregar;
      srv.entregar = async (bytes, nombre, ext) => {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        vistos.push({ ext, nombre, bytes: u8.length, firma: Array.from(u8.slice(0, 4)) });
      };
      const out = {};
      try { await srv.exportPdf(inv.cfgReporteInv()); out.pdf = 'ok'; } catch (e) { out.pdf = String(e && e.message); }
      try { await srv.exportExcel(inv.cfgReporteInv()); out.excel = 'ok'; } catch (e) { out.excel = String(e && e.message); }
      srv.entregar = original;
      return { ...out, archivos: vistos, canal: typeof window.electronAPI.guardarArchivo };
    `);

    if (exp.pdf === 'ok') ok('el PDF se genera sin error');
    else mal('el PDF fallo', String(exp.pdf));
    if (exp.excel === 'ok') ok('el Excel se genera sin error');
    else mal('el Excel fallo', String(exp.excel));

    const pdf = (exp.archivos || []).find(a => a.ext === 'pdf');
    const xls = (exp.archivos || []).find(a => a.ext === 'xlsx');
    // %PDF = 37 80 68 70 · PK.. = 80 75 3 4
    if (pdf && pdf.bytes > 1000 && pdf.firma.join(',') === '37,80,68,70')
      ok('y es un PDF de verdad', `${pdf.bytes} bytes, empieza por %PDF`);
    else mal('el PDF no tiene la firma esperada', JSON.stringify(pdf));
    if (xls && xls.bytes > 1000 && xls.firma.join(',') === '80,75,3,4')
      ok('y el Excel tambien', `${xls.bytes} bytes, empieza por PK`);
    else mal('el Excel no tiene la firma esperada', JSON.stringify(xls));

    if (exp.canal === 'function')
      ok('el canal de guardado esta expuesto: el archivo llega al disco, no a una descarga del navegador');
    else mal('falta electronAPI.guardarArchivo: la exportacion no podria guardar nada en la app empaquetada');

  } finally {
    await ev(tema(temaOriginal)).catch(() => {});
  }

  console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
  return { fallos };
}
