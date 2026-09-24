/**
 * LA REVISION DE INGREDIENTES, MIRANDO LA PANTALLA.
 *
 *     npx playwright test e2e/quickstart-revision-ui.spec.js
 *
 * POR QUE ESTA PRUEBA EXISTE
 * --------------------------
 * `quickstart-modelos.spec.js` ya comprobaba que un ingrediente acaba con
 * `sellable = 0` en la base. Pasaba en verde mientras la pantalla seguia
 * ofreciendo «12 sin precio de venta · Ponerles precio» en Demo Hospitality.
 *
 * Las dos cosas eran ciertas a la vez porque la prueba llamaba al canal con
 * `{ hoja: 'Insumos' }` ya resuelto, y lo que fallaba estaba ANTES: el
 * proceso principal no sabia que el negocio era una cafeteria, asi que la
 * hoja se clasificaba como productos. Una prueba que le pasa la respuesta al
 * codigo no puede descubrir que el codigo no sabia la respuesta.
 *
 * Asi que aqui se entra por donde entra una persona —el dock, Migracion, el
 * boton— se suelta el archivo en el `input` de verdad, y se lee el DOM:
 * los rotulos de las columnas, los chips con sus numeros y los grupos de
 * problemas. Nada de `invocar` para llegar; solo para comprobar despues.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const { test, expect, CUENTAS, irPorMas } = require('./fixtures');

async function entrar(app, cuenta) {
  const { ventana } = app;
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(cuenta.usuario);
}

/** El libro de QA: la carta por un lado y el almacen por otro. */
async function libroCafeteria(s) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-ui-'));
  const wb = new ExcelJS.Workbook();

  /* Los encabezados son los del archivo real de QA, no los canonicos: «Unidad
     Base», «Costo Unit.», «Existencia Inicial». Si la prueba usara los
     nombres que el mapeo reconoce de memoria, no probaria el mapeo. */
  const ins = wb.addWorksheet('Insumos');
  ins.addRow(['Código Insumo', 'Descripción', 'Unidad Base', 'Costo Unit.', 'Existencia Inicial', 'Categoría']);
  ins.addRow([`ING-CAF-${s}`, `Café en grano ${s}`, 'g', 0.42, 5000, 'Café']);
  ins.addRow([`ING-LEC-${s}`, `Leche entera ${s}`, 'ml', 0.03, 12000, 'Lácteos']);
  ins.addRow([`ING-AZU-${s}`, `Azúcar ${s}`, 'g', 0.03, 4000, 'Polvos']);

  const menu = wb.addWorksheet('Menú');
  menu.addRow(['Nombre', 'Código', 'Categoría', 'Precio']);
  menu.addRow([`Café Americano ${s}`, `MEN-AME-${s}`, 'Bebidas', 35]);

  const ruta = path.join(dir, `QA_QuickStart_Hospitality_${s}.xlsx`);
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

/** El texto de un chip de filtro, por su rotulo. Sin depender del orden. */
async function chip(ventana, rotulo) {
  return ventana.evaluate((n) => {
    const b = [...document.querySelectorAll('.qs__chip')]
      .find((x) => x.textContent.trim().startsWith(n));
    return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
  }, rotulo);
}

/** Los rotulos de las columnas de la tabla de revision, en orden. */
const columnas = (ventana) => ventana.evaluate(() =>
  [...document.querySelectorAll('.qs__th.es-dinamica > span')]
    .map((x) => x.textContent.trim()).filter(Boolean));

const sufijo = () => Date.now().toString().slice(-6);

/**
 * Deja el muelle sin cargas de captura abiertas.
 *
 * La base es una sola para toda la suite. Si otra prueba dejo una carga de
 * libreta viva, QuickStart la reabre —hace bien: es trabajo de alguien— y la
 * pantalla arranca en la CAPTURA, que tambien tiene una `.qs__tabla`. La
 * prueba leia entonces los encabezados de la tabla equivocada y fallaba
 * diciendo que faltaba la Unidad. Uno de cada tres intentos.
 *
 * Esto no relaja nada del producto: descarta lo que quedo colgando de otra
 * corrida para que esta empiece donde dice que empieza.
 */
async function sinCapturasAbiertas(app) {
  const r = await app.invocar('qsCargas', {});
  for (const c of (r?.data ?? [])) {
    if ((c.origen === 'MANUAL' || c.origen === 'LECTOR') && c.estado !== 'IMPORTADA') {
      await app.invocar('qsDescartar', { batchId: c.id });
    }
  }
}

test.describe('QuickStart · la revisión de una hoja de insumos', () => {

  /* Encender Hospitality cambia lo que significa una hoja con precios para
     TODA la suite, y la base es una sola. Se apaga aunque la prueba falle. */
  test.afterEach(async ({ app }) => {
    await app.invocar('modulosSet', 'hospitality', false).catch(() => {});
  });

  test('a doce ingredientes no se les pide precio, y la Unidad se ve', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    const r = await app.invocar('modulosSet', 'hospitality', true);
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    await sinCapturasAbiertas(app);

    const s = sufijo();
    const ruta = await libroCafeteria(s);

    // ------------------------------------------------- por donde se entra
    /* Dock → Más → Migracion → «Los productos se cargan en QuickStart».
       Es el camino que hay; si algun dia se rompe, esta prueba lo dice. */
    await irPorMas(ventana, 'Migracion');
    await ventana.waitForSelector('.mig-vacio', { timeout: 30000 });
    await ventana.click('.mig-vacio .mig-btn');
    await ventana.waitForSelector('.qs__pozo', { timeout: 30000 });

    // --------------------------------------------- el archivo, de verdad
    /* `input type=file` oculto tras un `<label>`: la excepcion documentada
       del contrato de interfaz. `setInputFiles` da un `File` real, que es lo
       que `webUtils.getPathForFile` necesita para devolver la ruta. */
    await ventana.setInputFiles('.qs__pozo input[type=file]', ruta);

    /* Dos hojas con datos: la pantalla pregunta cual. Se elige como una
       persona, pulsando «Insumos». */
    await ventana.waitForSelector('.qs__hojacard, .qs__th.es-dinamica', { timeout: 60000 });

    /* Con un `locator` y no con un `click()` despachado desde `evaluate`.
       El despachado no espera a que el boton sea pulsable: llegaba antes de
       que Angular hubiera atado el manejador y se perdia en silencio, y la
       pantalla se quedaba en la eleccion de hoja. Uno de cada cuatro
       intentos, que es la peor frecuencia posible. */
    const tarjeta = ventana.locator('.qs__hojacard').filter({ hasText: /Insumos/ }).first();
    if (await tarjeta.count()) await tarjeta.click({ timeout: 30000 });
    /* La tabla de la REVISION y no «alguna tabla»: la captura tiene la
       suya, con otros encabezados. */
    await ventana.waitForSelector('.qs__th.es-dinamica', { timeout: 60000 });

    // =============================================== LO QUE SE VE EN PANTALLA

    /* 1) NADA de precio de venta. Ni el grupo, ni el boton. Esto es lo que
          ofrecia ponerle $12 a doce insumos de una sola pulsacion. */
    const grupos = await ventana.evaluate(() =>
      [...document.querySelectorAll('.qs__grupo')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    expect(grupos.join(' | '), 'no se pide precio de venta a un ingrediente')
      .not.toMatch(/sin precio de venta/i);
    expect(await ventana.locator('.qs__grupoacc button', { hasText: 'Ponerles precio' }).count(),
      'y no existe el botón que se lo ponía a todos').toBe(0);

    /* 2) Las columnas son las de un almacen, no las de una tienda. */
    const cols = await columnas(ventana);
    expect(cols, 'se revisa con la Unidad delante: «5000» sin ella no dice nada')
      .toContain('Unidad');
    expect(cols, 'y sin una columna de Precio que no aplica').not.toContain('Precio');
    expect(cols, 'ni Marca, que un insumo no necesita').not.toContain('Marca');
    expect(cols, 'la Categoría sí, que el mapeo la reconoció').toContain('Categoría');

    /* 3) Los tres números de la cabecera dicen lo mismo. En QA la cabecera
          decía «12 por resolver» y el chip de al lado «Por revisar 0». */
    expect(await chip(ventana, 'Todas'), 'las tres filas del archivo').toBe('Todas 3');
    expect(await chip(ventana, 'Listas'), 'y las tres entran limpias').toBe('Listas 3');
    expect(await chip(ventana, 'Por revisar'), 'sin nada que decidir').toBe('Por revisar 0');

    /* 4) Y la fila de Café en grano enseña sus gramos. */
    const grano = await ventana.evaluate((n) => {
      const tr = [...document.querySelectorAll('.qs__tr')].find((x) => x.textContent.includes(n));
      return tr ? [...tr.querySelectorAll('span')].map((x) => x.textContent.trim()) : null;
    }, `Café en grano ${s}`);
    expect(grano, 'el café en grano está en la revisión').toBeTruthy();
    expect(grano.join(' '), 'con su unidad').toContain('g');
    expect(grano.join(' '), 'y sus 5,000').toMatch(/5[.,]?000/);

    /* 5) El botón dice «Importar 3», no «Resolver 3». Es el mismo sitio de
          la cabecera: si quedara algo por decidir, ahí pondría otra cosa. */
    const cta = await ventana.locator('.qs__cab .qs__btn.es-primario').textContent();
    expect(cta.replace(/\s+/g, ' ').trim(),
      'se puede importar sin decidir nada antes').toBe('Importar 3');

    // ================================================= Y EN LA BASE, IGUAL
    await ventana.click('.qs__cab .qs__btn.es-primario');
    /* La confirmación de SweetAlert, pulsada como se pulsa. */
    await ventana.waitForSelector('.swal2-confirm', { timeout: 30000 });
    await ventana.click('.swal2-confirm');

    await expect.poll(async () => {
      const r2 = await app.invocar('getActiveProducts');
      const filas = Array.isArray(r2) ? r2
        : (Array.isArray(r2?.recordset) ? r2.recordset : (Array.isArray(r2?.data) ? r2.data : []));
      return filas.find((p) => p.part_number === `ING-CAF-${s}`) || null;
    }, { timeout: 60000 }).not.toBeNull();

    const r3 = await app.invocar('getActiveProducts');
    const filas = Array.isArray(r3) ? r3
      : (Array.isArray(r3?.recordset) ? r3.recordset : (Array.isArray(r3?.data) ? r3.data : []));
    const grano2 = filas.find((p) => p.part_number === `ING-CAF-${s}`);

    expect(String(grano2.inventory_mode), 'es mercancía de almacén').toBe('DIRECT');
    expect(Number(grano2.sellable), 'y NO se vende').toBe(0);
    expect(Number(grano2.stock), 'con sus 5000').toBe(5000);
    expect(String(grano2.base_uom), 'en gramos').toBe('g');
    expect(Number(grano2.price), 'y sin el precio que la pantalla ofrecía inventar').toBe(0);

    const leche = filas.find((p) => p.part_number === `ING-LEC-${s}`);
    expect(Number(leche.sellable), 'la leche tampoco se vende').toBe(0);
    expect(Number(leche.stock), 'con sus 12000').toBe(12000);
    expect(String(leche.base_uom), 'en mililitros').toBe('ml');
  });
});
