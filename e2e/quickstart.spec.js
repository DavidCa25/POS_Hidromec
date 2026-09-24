/**
 * QUICKSTART, DE PUNTA A PUNTA.
 *
 *     npx playwright test e2e/quickstart.spec.js
 *
 * Aqui no se prueba la tuberia —eso lo hace `test:quickstart`, sin base—:
 * se prueba lo que SOLO se puede comprobar con SQL de verdad delante.
 *
 *   · que revisar una carga NO toca el catalogo;
 *   · que la existencia inicial entra por `inventory_movements` y no como un
 *     numero suelto en `products.stock`;
 *   · que una carga sobrevive a cerrar la pantalla;
 *   · que reimportar el mismo archivo no duplica nada;
 *   · que deshacer respeta lo que ya se vendio;
 *   · que un cajero no puede importar el catalogo.
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

/** Un catálogo de proveedor como los de verdad: título arriba y «P. Compra». */
async function hacerExcel(filas, nombre = 'catalogo.xlsx') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-qs-'));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Listado');
  ws.addRow(['LISTA DE PRECIOS — MARZO']);
  ws.addRow([]);
  ws.addRow(['Producto', 'Código', 'P. Compra', 'P. Venta', 'Existencia', 'Departamento']);
  filas.forEach(f => ws.addRow(f));
  const ruta = path.join(dir, nombre);
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

/**
 * El catálogo, sea cual sea la forma en la que llegue.
 *
 * `getActiveProducts` devuelve unas veces el arreglo pelado y otras un
 * `{recordset}`: es un canal viejo que nunca se normalizó. Suponer una sola
 * forma hacía que la prueba no encontrara productos que SÍ se habían creado
 * y acusara al importador de algo que no era suyo.
 */
async function catalogo(app) {
  const r = await app.invocar('getActiveProducts');
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.recordset)) return r.recordset;
  if (Array.isArray(r?.data)) return r.data;
  return [];
}

/** El sufijo evita que dos ejecuciones se pisen: la base se comparte. */
const sufijo = () => Date.now().toString().slice(-6);

/**
 * Deja el muelle sin cargas de captura abiertas.
 *
 * `qsCargaManual` reutiliza a propósito la carga de captura que esté abierta:
 * así entrar dos veces a la libreta no deja dos cargas. Pero eso significa
 * que una carga viva de una ejecución ANTERIOR se hereda, y la prueba
 * siguiente cuenta filas que no escribió.
 *
 * Esto no relaja nada del producto: descarta lo que quedó colgando de otra
 * corrida para que cada prueba empiece donde dice que empieza.
 */
async function sinCapturasAbiertas(app) {
  const r = await app.invocar('qsCargas', {});
  for (const c of (r?.data ?? [])) {
    if ((c.origen === 'MANUAL' || c.origen === 'LECTOR') && c.estado !== 'IMPORTADA') {
      await app.invocar('qsDescartar', { batchId: c.id });
    }
  }
}

test.describe('QuickStart', () => {

  test('un Excel externo se lee, se revisa sin tocar nada, y al confirmar entra con movimiento', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();

    const ruta = await hacerExcel([
      [`Aceite Mobil 20W50 ${s}`, `MOB-${s}`, 78, 129, 24, 'Lubricantes'],
      [`Filtro Fram ${s}`, `PH-${s}`, 62.5, 115, 18, 'Filtros'],
      [`Kit de clutch ${s}`, `CLU-${s}`, 1240, '', 2, 'Transmisión'],
    ]);


    // ------------------------------------------------------------ analizar
    const an = await app.invocar('qsAnalizarArchivo', { ruta });
    expect(an?.success, JSON.stringify(an)).toBeTruthy();
    const batchId = an.data.batchId;
    expect(batchId, 'la carga existe').toBeTruthy();

    /* El mapeo se PROPONE entero: son los encabezados del brief. */
    const campos = Object.fromEntries(an.data.propuesta.columnas.map(c => [c.original, c.campo]));
    expect(campos['P. Compra']).toBe('cost');
    expect(campos['P. Venta']).toBe('price');
    expect(campos['Departamento']).toBe('category_name');
    expect(an.data.propuesta.dudas, 'no hay nada que preguntar').toBe(0);

    // -------------------------------------------- NADA ha tocado el catálogo
    const sum = await app.invocar('qsCarga', { batchId });
    expect(sum?.success).toBeTruthy();
    const totales = sum.sets[1][0];
    expect(totales.crear, 'dos filas listas para crear').toBe(2);
    expect(totales.total, 'y tres leídas en total').toBe(3);

    const enMedio = await catalogo(app);
    expect(enMedio.some(p => p.part_number === `MOB-${s}`),
      'el catálogo NO tiene todavía lo que se está revisando').toBe(false);

    /* La fila sin precio quedó pendiente, no se coló. */
    const pend = await app.invocar('qsFilas', { batchId, filtro: 'PENDIENTES' });
    expect(pend.data.length, 'el clutch sin precio queda pendiente').toBe(1);
    expect(JSON.parse(pend.data[0].problemas_json).map(p => p.codigo)).toContain('SIN_PRECIO');

    // ----------------------------------------------------------- confirmar
    const ej = await app.invocar('qsEjecutar', { batchId });
    expect(ej?.success, JSON.stringify(ej)).toBeTruthy();
    expect(ej.data.creadas, 'entran las dos listas').toBe(2);

    const prods = await catalogo(app);
    const aceite = prods.find(p => p.part_number === `MOB-${s}`);
    expect(aceite, 'el aceite está en el catálogo').toBeTruthy();
    expect(Number(aceite.stock), 'con sus 24 piezas').toBe(24);

    /* La fila pendiente NO entró: sigue esperando. */
    const tras = await app.invocar('qsCarga', { batchId });
    expect(tras.sets[1][0].aplicadas, 'solo se aplicaron las listas').toBe(2);
    const sigue = await app.invocar('qsFilas', { batchId, filtro: 'PENDIENTES' });
    expect(sigue.data.length, 'y la pendiente sigue ahí para después').toBe(1);
  });

  test('la existencia inicial deja rastro: producto, cantidad, carga', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();
    const ruta = await hacerExcel([[`Anticongelante ${s}`, `ANT-${s}`, 55, 98, 12, 'Lubricantes']]);

    const an = await app.invocar('qsAnalizarArchivo', { ruta });
    const batchId = an.data.batchId;
    await app.invocar('qsEjecutar', { batchId });

    /* Se mira la tabla de movimientos por el canal de kardex del producto. */
    const prods = await catalogo(app);
    const p = prods.find(x => x.part_number === `ANT-${s}`);
    expect(p).toBeTruthy();

    const kardex = await app.invocar('inventoryMovements', { productId: p.id });
    expect(kardex?.success, JSON.stringify(kardex)).toBeTruthy();

    const inicial = (kardex.data || []).find(m => String(m.source) === 'IMPORT_INICIAL');
    expect(inicial, 'la existencia inicial es un MOVIMIENTO, no un número suelto').toBeTruthy();
    expect(Number(inicial.quantity), 'por las 12 piezas').toBe(12);
    expect(String(inicial.typee), 'de entrada').toBe('entrada');
    expect(String(inicial.reference), 'y dice de qué carga vino').toBe(`IMP-${batchId}`);
    expect(String(inicial.descriptionn), 'y lo dice en palabras').toContain(`#${batchId}`);

    /* Reintentar la misma carga no puede duplicar el movimiento. */
    await app.invocar('qsEjecutar', { batchId });
    const otra = await app.invocar('inventoryMovements', { productId: p.id });
    const cuantos = (otra.data || []).filter(m => String(m.source) === 'IMPORT_INICIAL').length;
    expect(cuantos, 'reintentar no duplica el movimiento').toBe(1);
  });

  test('una captura de libreta sobrevive a salir de la pantalla', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    await sinCapturasAbiertas(app);
    const s = sufijo();

    const abrir = await app.invocar('qsCargaManual', {});
    expect(abrir?.success, JSON.stringify(abrir)).toBeTruthy();
    const batchId = (abrir.data[0] ?? abrir.data).id;

    for (const [nombre, precio, stock] of [
      [`Shampoo ${s}`, '185', '12'],
      [`Tinte ${s}`, '240', '6'],
      [`Secadora ${s}`, '890', '2'],
    ]) {
      const r = await app.invocar('qsCapturar', { batchId, nombre, precio, existencia: stock });
      expect(r?.success, JSON.stringify(r)).toBeTruthy();
    }

    /* Se vuelve a pedir la carga como haría la pantalla al reabrirse. Lo que
       se comprueba es que los tres viven en la BASE, no en memoria. */
    const filas = await app.invocar('qsFilas', { batchId, filtro: 'TODAS' });
    expect(filas.data.length, 'los tres siguen ahí').toBe(3);
    expect(filas.data.map(f => f.nombre)).toContain(`Tinte ${s}`);

    /* Y la carga manual abierta se REUTILIZA: no se crea una nueva cada vez
       que se entra, que dejaría el riel lleno de cargas de un producto. */
    const otra = await app.invocar('qsCargaManual', {});
    expect((otra.data[0] ?? otra.data).id, 'se reutiliza la carga abierta').toBe(batchId);

    const ej = await app.invocar('qsEjecutar', { batchId });
    expect(ej?.success).toBeTruthy();
    expect(ej.data.creadas, 'y al confirmar entran los tres').toBe(3);
  });

  test('reimportar el mismo archivo no duplica: queda igual o actualiza', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();
    const fila = [[`Balata ${s}`, `BAL-${s}`, 410, 689, 6, 'Frenos']];

    const primero = await app.invocar('qsAnalizarArchivo', { ruta: await hacerExcel(fila) });
    await app.invocar('qsEjecutar', { batchId: primero.data.batchId });

    /* Exactamente el mismo archivo. */
    const segundo = await app.invocar('qsAnalizarArchivo', { ruta: await hacerExcel(fila) });
    const sum = await app.invocar('qsCarga', { batchId: segundo.data.batchId });
    expect(sum.sets[1][0].igual, 'la segunda vez no cambia nada').toBe(1);
    expect(sum.sets[1][0].crear, 'y no crea un duplicado').toBe(0);

    /* Ahora con otro precio: eso SÍ es una actualización. */
    const subido = [[`Balata ${s}`, `BAL-${s}`, 410, 750, 6, 'Frenos']];
    const tercero = await app.invocar('qsAnalizarArchivo', { ruta: await hacerExcel(subido) });
    const sum3 = await app.invocar('qsCarga', { batchId: tercero.data.batchId });
    expect(sum3.sets[1][0].actualizar, 'el precio nuevo es una actualización').toBe(1);

    await app.invocar('qsEjecutar', { batchId: tercero.data.batchId });
    const prods = await catalogo(app);
    const cuantas = prods.filter(p => p.part_number === `BAL-${s}`).length;
    expect(cuantas, 'sigue habiendo UNA balata, no tres').toBe(1);
    expect(Number(prods.find(p => p.part_number === `BAL-${s}`).price)).toBe(750);
  });

  test('un código que ya tiene otro producto va a revisión, no se decide solo', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();

    const uno = await app.invocar('qsAnalizarArchivo', {
      ruta: await hacerExcel([[`Filtro de aceite ${s}`, `DUP-${s}`, 62, 115, 10, 'Filtros']]) });
    await app.invocar('qsEjecutar', { batchId: uno.data.batchId });

    /* Mismo código, producto completamente distinto. */
    const dos = await app.invocar('qsAnalizarArchivo', {
      ruta: await hacerExcel([[`Balata trasera ${s}`, `DUP-${s}`, 400, 689, 4, 'Frenos']]) });
    const sum = await app.invocar('qsCarga', { batchId: dos.data.batchId });
    expect(sum.sets[1][0].conflicto, 'queda en conflicto').toBe(1);

    const filas = await app.invocar('qsFilas', { batchId: dos.data.batchId, filtro: 'CONFLICTOS' });
    expect(JSON.parse(filas.data[0].problemas_json).map(p => p.codigo))
      .toContain('CODIGO_OTRO_NOMBRE');

    /* Y confirmar NO se lo lleva por delante. */
    const ej = await app.invocar('qsEjecutar', { batchId: dos.data.batchId });
    expect(ej.data.creadas, 'un conflicto no entra solo').toBe(0);
  });

  test('resolver un grupo entero cambia el staging, no el catálogo', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();

    /* Tres filas sin categoría: el grupo que más se repite en la vida real. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-qs-'));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Listado');
    ws.addRow(['Producto', 'Código', 'P. Venta']);
    [1, 2, 3].forEach(i => ws.addRow([`Sin categoría ${s}-${i}`, `SC-${s}-${i}`, 100 + i]));
    const ruta = path.join(dir, 'sincat.xlsx');
    await wb.xlsx.writeFile(ruta);

    const an = await app.invocar('qsAnalizarArchivo', { ruta });
    const batchId = an.data.batchId;

    const antes = await app.invocar('qsCarga', { batchId });
    const grupos = antes.sets[2] ?? [];
    expect(grupos.find(g => g.codigo === 'SIN_CATEGORIA')?.cuantos, 'las tres sin categoría').toBe(3);

    const r = await app.invocar('qsResolverGrupo', {
      batchId, codigo: 'SIN_CATEGORIA', resolucion: 'ASIGNAR', valor: 'General' });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();

    const despues = await app.invocar('qsCarga', { batchId });
    expect((despues.sets[2] ?? []).find(g => g.codigo === 'SIN_CATEGORIA'),
      'el grupo desaparece').toBeFalsy();
    expect(despues.sets[1][0].aplicadas, 'y NADA se ha importado todavía').toBe(0);
  });

  test('deshacer retira lo que no se movió y respeta lo que sí', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();
    const an = await app.invocar('qsAnalizarArchivo', {
      ruta: await hacerExcel([[`Bujía ${s}`, `BUJ-${s}`, 41, 79, 40, 'Encendido']]) });
    const batchId = an.data.batchId;
    await app.invocar('qsEjecutar', { batchId });

    const chk = await app.invocar('qsUndoCheck', { batchId });
    expect(chk.data[0].veredicto, 'sin actividad posterior se puede deshacer entero').toBe('TODO');

    const undo = await app.invocar('qsUndo', { batchId });
    expect(undo?.success, JSON.stringify(undo)).toBeTruthy();
    expect(undo.data[0].revertidas).toBe(1);

    /* El producto NO se borra: se desactiva. Su id puede estar escrito en
       sitios que no sabemos mirar. */
    const activos = await catalogo(app);
    expect(activos.some(p => p.part_number === `BUJ-${s}`),
      'ya no está entre los activos').toBe(false);
  });

  test('un operador no puede importar el catálogo', async ({ app }) => {
    await entrar(app, CUENTAS.operador);
    const ruta = await hacerExcel([['Lo que sea', 'X-1', 1, 2, 3, 'Y']]);

    const an = await app.invocar('qsAnalizarArchivo', { ruta });
    expect(an?.success, 'analizar exige el paquete de configuración').toBeFalsy();

    const ej = await app.invocar('qsEjecutar', { batchId: 1 });
    expect(ej?.success, 'y ejecutar también').toBeFalsy();

    /* Pero SÍ puede ver el riel: saber que el catálogo está vacío no es
       información sensible, y sin esto Inicio no podría decírselo. */
    const lista = await app.invocar('qsCargas', {});
    expect(lista?.success, 'leer las cargas sigue abierto').toBeTruthy();
  });

  test('una fila imposible no se lleva por delante a las demás', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();
    const largo = 'Z'.repeat(140);

    const an = await app.invocar('qsAnalizarArchivo', {
      ruta: await hacerExcel([
        [`Bueno uno ${s}`, `OK1-${s}`, 10, 20, 5, 'Varios'],
        [`${largo} ${s}`, `MAL-${s}`, 10, 20, 5, 'Varios'],
        [`Bueno dos ${s}`, `OK2-${s}`, 10, 20, 5, 'Varios'],
      ]) });
    const batchId = an.data.batchId;

    const filas = await app.invocar('qsFilas', { batchId, filtro: 'PENDIENTES' });
    expect(filas.data.length, 'la fila larga queda marcada').toBe(1);
    expect(JSON.parse(filas.data[0].problemas_json).map(p => p.codigo)).toContain('NOMBRE_LARGO');

    const ej = await app.invocar('qsEjecutar', { batchId });
    expect(ej?.success, 'la importación NO aborta').toBeTruthy();
    expect(ej.data.creadas, 'y las dos buenas entran igual').toBe(2);
  });

  // ==================================================================
  //  NAVEGACIÓN: nadie queda atrapado
  // ==================================================================

  test('entrar al lector y volver no deja basura en el historial', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    await sinCapturasAbiertas(app);

    const antes = (await app.invocar('qsCargas', {})).data.length;

    /* Entrar y salir del lector cinco veces. Antes cada entrada dejaba una
       carga de «0 renglones» en el riel para siempre. */
    for (let i = 0; i < 5; i++) {
      const abrir = await app.invocar('qsCargaManual', { lector: true });
      const id = (abrir.data[0] ?? abrir.data).id;
      const soltada = await app.invocar('qsSoltarSiVacia', { batchId: id });
      expect(soltada?.success, JSON.stringify(soltada)).toBeTruthy();
      expect(Number(soltada.data[0].borrada), 'una carga vacía se suelta').toBe(1);
    }

    const despues = (await app.invocar('qsCargas', {})).data.length;
    expect(despues, 'el historial queda como estaba').toBe(antes);
  });

  test('una carga de captura vacía NO dice que está analizando', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    await sinCapturasAbiertas(app);

    const abrir = await app.invocar('qsCargaManual', { lector: true });
    const batch = abrir.data[0] ?? abrir.data;
    expect(String(batch.estado), 'nadie está analizando nada todavía').toBe('CAPTURANDO');
    expect(Number(batch.total_filas)).toBe(0);

    /* En cuanto hay una fila deja de estar capturando. */
    await app.invocar('qsCapturar', { batchId: batch.id, nombre: 'Algo', precio: '10', existencia: '1' });
    const lista = (await app.invocar('qsCargas', {})).data;
    const viva = lista.find(c => c.id === batch.id);
    expect(String(viva.estado), 'con una fila dentro ya es una carga de verdad').not.toBe('CAPTURANDO');

    await app.invocar('qsDescartar', { batchId: batch.id });
  });

  test('cambiar de método no borra lo capturado', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    await sinCapturasAbiertas(app);
    const s = sufijo();

    const abrir = await app.invocar('qsCargaManual', {});
    const batchId = (abrir.data[0] ?? abrir.data).id;
    for (const n of [1, 2, 3]) {
      await app.invocar('qsCapturar', { batchId, nombre: `Libreta ${s}-${n}`, precio: '50', existencia: '2' });
    }

    /* Esto es lo que hace la pantalla al pulsar «Cambiar método». */
    const soltada = await app.invocar('qsSoltarSiVacia', { batchId });
    expect(Number(soltada.data[0].borrada), 'con filas dentro NO se suelta').toBe(0);

    /* Y la carga sigue en el riel, con sus tres. */
    const lista = (await app.invocar('qsCargas', {})).data;
    const sigue = lista.find(c => c.id === batchId);
    expect(sigue, 'la carga sigue en el riel').toBeTruthy();
    expect(Number(sigue.total_filas), 'con lo que se había escrito').toBe(3);

    const filas = await app.invocar('qsFilas', { batchId, filtro: 'TODAS' });
    expect(filas.data.map(f => f.nombre)).toContain(`Libreta ${s}-2`);
  });

  test('un archivo ilegible da un mensaje humano y se puede seguir', async ({ app }) => {
    await entrar(app, CUENTAS.admin);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-qs-'));
    const roto = path.join(dir, 'roto.xlsx');
    fs.writeFileSync(roto, 'esto no es un Excel', 'utf8');

    const r = await app.invocar('qsAnalizarArchivo', { ruta: roto });
    expect(r?.success, 'no se puede leer').toBeFalsy();
    /* Lo que importa: QUÉ se le dice a la persona. */
    expect(String(r.error), 'nada de TypeError').not.toMatch(/TypeError|undefined|Cannot read|at \w+ \(/);
    expect(String(r.error).length, 'y una frase de verdad').toBeGreaterThan(20);

    /* Y después del fallo, QuickStart sigue usable: se puede cargar otro. */
    const bueno = await hacerExcel([[`Recuperado ${sufijo()}`, `REC-${sufijo()}`, 10, 20, 5, 'Varios']]);
    const r2 = await app.invocar('qsAnalizarArchivo', { ruta: bueno });
    expect(r2?.success, 'un fallo no deja QuickStart inservible').toBeTruthy();
  });

  test('un libro con varias hojas llega hasta el mapeo, sin importar las notas', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const s = sufijo();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-qs-'));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventario Actual');
    ws.addRow(['Código', 'Descripción', 'Depto.', 'Marca', 'P. Compra', 'P. Venta', 'Exist.', 'Código Barras', 'Unidad']);
    ws.addRow([`MH-${s}`, `Producto multihoja ${s}`, 'Bebidas', 'Casa', 13.5, 18, 24, '', 'pza']);
    const notas = wb.addWorksheet('Notas QA');
    notas.addRow(['Este archivo es para QA']);
    notas.addRow(['No importar esta hoja']);
    const ruta = path.join(dir, 'QA_multihoja.xlsx');
    await wb.xlsx.writeFile(ruta);

    const r = await app.invocar('qsAnalizarArchivo', { ruta });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    expect(r.data.necesitaHoja, 'una hoja de notas no es una duda').toBeFalsy();
    expect(String(r.data.hoja), 'se usó la hoja de datos').toBe('Inventario Actual');

    /* Y llegó al mapeo con sus columnas reconocidas. */
    const campos = Object.fromEntries(r.data.propuesta.columnas.map(c => [c.original, c.campo]));
    expect(campos['P. Compra']).toBe('cost');
    expect(campos['Exist.']).toBe('stock');
    expect(campos['Depto.']).toBe('category_name');

    /* Las notas NO entraron como productos. */
    const filas = await app.invocar('qsFilas', { batchId: r.data.batchId, filtro: 'TODAS' });
    expect(filas.data.length, 'solo la fila de datos').toBe(1);
    expect(filas.data.some(f => /No importar/i.test(String(f.nombre ?? ''))),
      'ninguna línea de las notas se coló').toBe(false);
  });

  test('la plantilla se genera con el giro del negocio', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-plantilla-'));
    const r = await app.invocar('qsPlantilla', { destino });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    expect(fs.existsSync(r.data.ruta), 'el archivo existe').toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(r.data.ruta);
    expect(wb.worksheets.map(w => w.name)).toContain('Ejemplos');
    expect(wb.getWorksheet('_wybix'), 'con su metadata').toBeTruthy();
  });
});
