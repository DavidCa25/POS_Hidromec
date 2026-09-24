/**
 * QUICKSTART POR MODELO DE NEGOCIO.
 *
 *     npx playwright test e2e/quickstart-modelos.spec.js
 *
 * Lo que `quickstart.spec.js` prueba es la tuberia; lo que se prueba aqui es
 * que cada cosa entre como lo que ES. Con SQL de verdad delante, porque la
 * pregunta no es «¿se guardo?» sino «¿con que `inventory_mode` y con que
 * `sellable` quedo?», y eso solo lo contesta la base.
 *
 * LOS DOS CASOS QUE LO ORIGINARON
 * -------------------------------
 * En QA manual, con un catalogo de cafeteria:
 *
 *   · «Cafe en grano» —un ingrediente— pidio precio de venta, se le puso $12
 *     a los doce insumos de golpe, y acabo a la venta en la caja.
 *   · «Cafe Americano» —un producto de menu— entro con stock 0 y la caja lo
 *     dio por agotado.
 *
 * Los dos estan abajo, con nombre y apellido.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const { test, expect, CUENTAS } = require('./fixtures');

async function entrar(app, cuenta) {
  const { ventana } = app;
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(cuenta.usuario);
}

/** Un libro con las hojas que se le pidan. */
async function libro(hojas, nombre = 'catalogo.xlsx') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-mod-'));
  const wb = new ExcelJS.Workbook();
  for (const [titulo, filas] of hojas) {
    const ws = wb.addWorksheet(titulo);
    filas.forEach(f => ws.addRow(f));
  }
  const ruta = path.join(dir, nombre);
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

/** El producto tal y como quedo en la base, no como lo mando la pantalla. */
async function comoQuedo(app, partNumber) {
  const r = await app.invocar('getActiveProducts');
  const filas = Array.isArray(r) ? r
    : (Array.isArray(r?.recordset) ? r.recordset : (Array.isArray(r?.data) ? r.data : []));
  return filas.find(p => p.part_number === partNumber) || null;
}

const sufijo = () => Date.now().toString().slice(-6);

/**
 * Enciende el modulo que hace falta para el giro que se esta probando.
 *
 * Y COMPRUEBA QUE SE ENCENDIO. Tragarse el fallo aqui hacia que la prueba
 * midiera una cosa distinta de la que dice medir: sin `hospitality`, «Insumos»
 * son productos —y con razon—, asi que la asercion fallaba en el sitio
 * equivocado y el motivo real quedaba tres capas mas abajo.
 */
async function conModulo(app, clave) {
  const r = await app.invocar('modulosSet', clave, true);
  expect(r?.success, `no se pudo encender «${clave}»: ${JSON.stringify(r)}`).toBeTruthy();
}

test.describe('QuickStart · Hospitality', () => {

  /*
   * Y SE APAGA AL SALIR.
   *
   * `Wybix_E2E_Core` es UNA base compartida por toda la suite, y encender
   * `hospitality` no es un ajuste de esta prueba: cambia lo que significa una
   * hoja con precios para todas las de despues. Dejarlo encendido hizo que
   * dos pruebas de Retail leyeran su hoja «Productos» como carta —MENU, sin
   * existencia— y se quedaran con stock 0. El fallo aparecia a ocho minutos
   * de distancia de su causa.
   *
   * Va en `afterEach` y no al final del cuerpo para que tambien se apague
   * cuando la prueba falla, que es justo cuando mas importa.
   */
  test.afterEach(async ({ app }) => {
    await app.invocar('modulosSet', 'hospitality', false).catch(() => {});
  });

  test('un ingrediente NO pide precio y NO se vende; un producto de menú se vende sin existencia', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    await conModulo(app, 'hospitality');
    const s = sufijo();

    /* El libro de QA: insumos por un lado, carta por otro, y dos hojas de
       notas que no son datos. */
    const ruta = await libro([
      ['Insumos', [
        ['Nombre', 'Código', 'Categoría', 'Unidad', 'Costo', 'Existencia'],
        [`Café en grano ${s}`, `ING-CAF-${s}`, 'Almacén', 'g', 380, 5000],
        [`Leche entera ${s}`, `ING-LEC-${s}`, 'Almacén', 'ml', 22, 12000],
      ]],
      ['Menú', [
        ['Nombre', 'Código', 'Categoría', 'Precio'],
        [`Café Americano ${s}`, `MEN-AME-${s}`, 'Bebidas', 35],
        [`Latte ${s}`, `MEN-LAT-${s}`, 'Bebidas', 48],
      ]],
      ['Notas QA', [['Este archivo es de QA'], ['No importar esta hoja']]],
      ['Notas proveedor', [['Entrega los martes']]],
    ], 'QA_Hospitality.xlsx');

    // ---------------------------------------------------------- los insumos
    const insumos = await app.invocar('qsAnalizarArchivo', { ruta, hoja: 'Insumos' });
    expect(insumos?.success, JSON.stringify(insumos)).toBeTruthy();
    expect(String(insumos.data.tipo), 'la hoja de insumos son ingredientes').toBe('INGREDIENTE');

    /* NO puede aparecer «sin precio de venta»: un ingrediente no se vende. */
    const resIns = await app.invocar('qsCarga', { batchId: insumos.data.batchId });
    const gruposIns = (resIns.sets[2] ?? []).map(g => g.codigo);
    expect(gruposIns, 'a un ingrediente no se le pide precio').not.toContain('SIN_PRECIO');
    expect(resIns.sets[1][0].crear, 'los dos insumos entran limpios').toBe(2);

    const ejIns = await app.invocar('qsEjecutar', { batchId: insumos.data.batchId });
    expect(ejIns?.success, JSON.stringify(ejIns)).toBeTruthy();

    const grano = await comoQuedo(app, `ING-CAF-${s}`);
    expect(grano, 'el café en grano está en el catálogo').toBeTruthy();
    expect(String(grano.inventory_mode), 'es mercancía de almacén').toBe('DIRECT');
    expect(Number(grano.sellable), 'pero NO se vende').toBe(0);
    expect(Number(grano.stock), 'con sus 5000').toBe(5000);
    expect(String(grano.base_uom), 'en gramos').toBe('g');
    expect(Number(grano.price), 'y sin precio de venta inventado').toBe(0);

    // ------------------------------------------------------------ la carta
    const menu = await app.invocar('qsOtraHoja', { batchId: insumos.data.batchId, hoja: 'Menú' });
    expect(menu?.success, 'la otra hoja se carga SIN volver a elegir el archivo').toBeTruthy();
    expect(String(menu.data.tipo), 'la carta son productos de menú').toBe('MENU');

    const ejMenu = await app.invocar('qsEjecutar', { batchId: menu.data.batchId });
    expect(ejMenu?.success, JSON.stringify(ejMenu)).toBeTruthy();

    const americano = await comoQuedo(app, `MEN-AME-${s}`);
    expect(americano, 'el americano está en el catálogo').toBeTruthy();
    expect(Number(americano.sellable), 'se vende').toBe(1);
    expect(Number(americano.price), 'a $35').toBe(35);
    /* LO QUE FALLABA: entraba DIRECT con stock 0 y la caja lo daba por
       agotado. `NONE` es lo que `sp_get_menu_catalog` traduce a 999999
       unidades disponibles mientras no tenga receta. */
    expect(String(americano.inventory_mode), 'y NO se agota por no tener receta').toBe('NONE');

    /* LA PRUEBA QUE IMPORTA: que llega a la CAJA.
       `catalog:menu` es la consulta de la pantalla de venta —filtra
       `sellable = 1` y calcula las unidades disponibles—, y vive en
       `window.wybix`, no en `electronAPI`. Es la unica forma de comprobar
       los dos fallos de QA donde de verdad se vieron. */
    const menuCat = await app.ventana.evaluate(() => window.wybix.catalog.menu());
    expect(menuCat?.success, JSON.stringify(menuCat)).toBeTruthy();
    const enVenta = menuCat.data.productos || [];

    const ameEnCaja = enVenta.find(x => x.part_number === `MEN-AME-${s}`);
    expect(ameEnCaja, 'el americano SI llega a la caja').toBeTruthy();
    /* Esto es lo que fallaba: con DIRECT y stock 0 daba 0 y la caja lo
       pintaba agotado el primer dia, antes de que nadie hiciera recetas. */
    expect(Number(ameEnCaja.available_units), 'y no aparece agotado').toBeGreaterThan(0);

    expect(enVenta.some(x => x.part_number === `ING-CAF-${s}`),
      'y el café en grano NO se puede vender por kilo desde la caja').toBe(false);

    /* Pero SI esta disponible como ingrediente, que es para lo que entro. */
    const ings = await app.ventana.evaluate(() => window.wybix.catalog.ingredients({}));
    const listaIng = ings?.data || [];
    expect(listaIng.some(x => x.part_number === `ING-CAF-${s}`),
      'esta disponible para armar una receta').toBe(true);
  });

  test('las hojas de notas no compiten con las de datos', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    await conModulo(app, 'hospitality');
    const s = sufijo();

    const ruta = await libro([
      ['Notas QA', [['Este archivo es de QA'], ['No importar']]],
      ['Menú', [['Nombre', 'Código', 'Categoría', 'Precio'], [`Capuchino ${s}`, `CAP-${s}`, 'Bebidas', 42]]],
    ], 'QA_notas.xlsx');

    const r = await app.invocar('qsAnalizarArchivo', { ruta });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    expect(r.data.necesitaHoja, 'una hoja de notas no es una duda').toBeFalsy();
    expect(String(r.data.hoja), 'se eligió la de datos aunque va segunda').toBe('Menú');
  });
});

test.describe('QuickStart · Servicios por giro', () => {

  /* Los cinco presets. Lo que cambia es el VOCABULARIO, no el motor: una
     refaccion y un producto de peluqueria son la misma clase de cosa. */
  const GIROS = [
    ['TALLER_AUTOMOTRIZ', 'Refacción', ['Cambio de aceite', 'Filtro de aceite']],
    ['BELLEZA', 'Producto', ['Corte de caballero', 'Shampoo 400 ml']],
    ['REPARACION_ELECTRONICA', 'Componente', ['Cambio de pantalla', 'Pantalla OEM']],
    ['MANTENIMIENTO', 'Material', ['Mantenimiento de minisplit', 'Filtro de aire']],
    ['OTRO', 'Material', ['Servicio general', 'Material genérico']],
  ];

  for (const [preset, material, [nombreServicio, nombreMaterial]] of GIROS) {
    test(`${preset}: el servicio no lleva existencia y el material sí`, async ({ appServicios: app }) => {
      await entrar(app, CUENTAS.admin);
      const s = sufijo();

      /* El giro decide el vocabulario de la columna «Tipo». */
      try { await app.invocar('serviciosElegirGiro', preset); } catch { /* ya estaba */ }

      const ruta = await libro([
        ['Catálogo', [
          ['Tipo', 'Nombre', 'Código', 'Categoría', 'Precio', 'Existencia', 'Duración (min)'],
          ['Servicio', `${nombreServicio} ${s}`, `SRV-${s}`, 'Servicios', 450, '', 40],
          [material, `${nombreMaterial} ${s}`, `MAT-${s}`, 'Refacciones', 129, 18, ''],
        ]],
      ], `QA_${preset}.xlsx`);

      const r = await app.invocar('qsAnalizarArchivo', { ruta });
      expect(r?.success, JSON.stringify(r)).toBeTruthy();

      const ej = await app.invocar('qsEjecutar', { batchId: r.data.batchId });
      expect(ej?.success, JSON.stringify(ej)).toBeTruthy();

      const servicio = await comoQuedo(app, `SRV-${s}`);
      expect(servicio, 'el servicio está en el catálogo').toBeTruthy();
      expect(String(servicio.inventory_mode), 'un servicio no tiene existencia').toBe('NONE');
      expect(Number(servicio.sellable), 'y se cobra').toBe(1);

      const mat = await comoQuedo(app, `MAT-${s}`);
      expect(mat, `el ${material.toLowerCase()} está en el catálogo`).toBeTruthy();
      expect(String(mat.inventory_mode), `un ${material.toLowerCase()} sí tiene existencia`).toBe('DIRECT');
      expect(Number(mat.stock), 'con sus 18 piezas').toBe(18);
      expect(Number(mat.sellable), 'y se vende').toBe(1);
    });
  }
});

test.describe('QuickStart · estado de una carga a medias', () => {

  test('lo ya importado no se vuelve a ofrecer, y el pendiente se puede resolver', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();

    /* Uno que ya existe: provoca el conflicto de nombre parecido. */
    const primero = await app.invocar('qsAnalizarArchivo', {
      ruta: await libro([['Datos', [
        ['Nombre', 'Código', 'Categoría', 'Precio'],
        [`Latte QA ${s}`, `LAT-${s}`, 'Bebidas', 48],
      ]]]) });
    await app.invocar('qsEjecutar', { batchId: primero.data.batchId });

    /* Ahora nueve nuevos y el mismo Latte, con OTRO codigo: nombre igual,
       codigo distinto. Es el caso que en QA se detectaba y no se podia
       resolver. */
    const filas = [['Nombre', 'Código', 'Categoría', 'Precio']];
    for (let i = 1; i <= 9; i++) filas.push([`Bebida ${s}-${i}`, `BEB-${s}-${i}`, 'Bebidas', 30 + i]);
    filas.push([`Latte QA ${s}`, `OTRO-${s}`, 'Bebidas', 52]);

    const segundo = await app.invocar('qsAnalizarArchivo', { ruta: await libro([['Datos', filas]]) });
    const batchId = segundo.data.batchId;

    const antes = await app.invocar('qsCarga', { batchId });
    expect(antes.sets[1][0].crear, 'nueve listas').toBe(9);
    expect(antes.sets[1][0].conflicto, 'y una en conflicto').toBe(1);

    // ------------------------------------------------------ importar las 9
    const ej = await app.invocar('qsEjecutar', { batchId });
    expect(ej.data.creadas).toBe(9);
    /* El avance nunca pudo superar lo planificado. */
    expect(ej.data.procesadas, 'no se procesan mas filas de las que habia')
      .toBeLessThanOrEqual(ej.data.planificadas);

    // ------------------------------- EL BUG: seguia ofreciendo «Importar 9»
    const despues = await app.invocar('qsCarga', { batchId });
    expect(despues.sets[1][0].crear, 'ya no quedan filas por crear').toBe(0);
    expect(despues.sets[1][0].aplicadas, 'las nueve estan dentro').toBe(9);
    expect(despues.sets[1][0].conflicto, 'y sigue habiendo una por resolver').toBe(1);

    // --------------------------------------------- y el conflicto se resuelve
    const pend = await app.invocar('qsFilas', { batchId, filtro: 'CONFLICTOS' });
    expect(pend.data.length).toBe(1);

    const res = await app.invocar('qsResolverFila', { rowId: pend.data[0].id, resolucion: 'CREAR_OTRO' });
    expect(res?.success, JSON.stringify(res)).toBeTruthy();

    const tras = await app.invocar('qsCarga', { batchId });
    expect(tras.sets[1][0].conflicto, 'el conflicto se resolvió').toBe(0);
    expect(tras.sets[1][0].crear, 'y ahora hay UNA lista para entrar').toBe(1);

    const ej2 = await app.invocar('qsEjecutar', { batchId });
    expect(ej2.data.creadas, 'entra solo la que faltaba, no las nueve otra vez').toBe(1);
  });
});
