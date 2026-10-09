/**
 * QuickStart · la plantilla del giro, LLENA, se importa entera.
 *
 * Nació de un fallo real (2026-10-09): una panadería de donas bajó la
 * plantilla de Wybix, la llenó con 25 donas y al subirla todas las columnas
 * se llamaban «Lo que vendes al cliente…» (la nota combinada de la fila 1) y
 * nada se reconocía. Además la plantilla traía ejemplos de café americano y
 * no tenía «Vendible».
 *
 * Recorre el camino completo, por los mismos canales que la pantalla:
 * giro -> plantilla -> llenar -> analizar -> importar -> cómo quedó.
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

async function comoQuedo(app, partNumber) {
  const r = await app.invocar('getActiveProducts');
  const filas = Array.isArray(r) ? r
    : (Array.isArray(r?.recordset) ? r.recordset : (Array.isArray(r?.data) ? r.data : []));
  return filas.find(p => p.part_number === partNumber) || null;
}

test.describe('QuickStart · plantilla por giro', () => {
  /* La base Core es compartida: alimentos y el giro se apagan al salir. */
  test.afterEach(async ({ app }) => {
    await app.invocar('modulosSet', 'hospitality', false).catch(() => {});
    await app.invocar('negocioGiroGuardar', { giro: null }).catch(() => {});
  });

  test('panadería de donas: su plantilla, llena, entra completa y respeta «Vendible»', async ({ app }) => {
    test.setTimeout(120000);
    await entrar(app, CUENTAS.admin);
    expect((await app.invocar('modulosSet', 'hospitality', true))?.success).toBeTruthy();

    const g = await app.invocar('negocioGiroGuardar', { giro: 'panaderia' });
    expect(g?.success, JSON.stringify(g)).toBeTruthy();
    expect((await app.invocar('negocioGiro'))?.data?.giro).toBe('panaderia');

    const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-giro-'));
    const p = await app.invocar('qsPlantilla', { destino });
    expect(p?.success, JSON.stringify(p)).toBeTruthy();
    expect(path.basename(p.data.ruta)).toBe('plantilla_wybix_panaderia.xlsx');

    // Se llena como lo haría la persona: debajo de los encabezados de la fila 2.
    const s = Date.now().toString().slice(-6);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(p.data.ruta);
    const ej = wb.getWorksheet('Ejemplos');
    expect(String(ej.getRow(3).getCell(1).value), 'los ejemplos son de donas').toMatch(/Dona/);
    const menu = wb.getWorksheet('Menú');
    const cab = menu.getRow(2).values.slice(1).map(v => String(v).replace(/\s*\*$/, ''));
    expect(cab).toContain('Vendible');
    const fila = (o) => cab.map(c => o[c] ?? null);
    menu.getRow(3).values = fila({ Nombre: `Dona glaseada ${s}`, Precio: 25, Código: `DON-GLA-${s}`, Categoría: 'Donas', Vendible: 'Sí' });
    menu.getRow(4).values = fila({ Nombre: `Dona rellena ${s}`, Precio: 39, Código: `DON-REL-${s}`, Categoría: 'Donas' });
    menu.getRow(5).values = fila({ Nombre: `Glaseado base ${s}`, Precio: 0, Código: `GLA-BAS-${s}`, Categoría: 'Insumos', Vendible: 'No' });
    await wb.xlsx.writeFile(p.data.ruta);

    const r = await app.invocar('qsAnalizarArchivo', { ruta: p.data.ruta });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    expect(String(r.data.hoja), 'se toma la hoja con datos').toBe('Menú');
    expect(r.data.necesitaHoja, 'Insumos vacía no compite con el Menú').toBeFalsy();

    const resumen = await app.invocar('qsCarga', { batchId: r.data.batchId });
    const grupos = (resumen.sets[2] ?? []).map(x => x.codigo);
    expect(grupos, 'ninguna fila sin nombre: la nota no se leyó como encabezado').not.toContain('SIN_NOMBRE');
    expect(resumen.sets[1][0].crear, 'las dos donas entran limpias').toBe(2);
    /* «No» la convirtió en insumo, y un insumo pide unidad para usarse en
       recetas: la hoja Menú no trae esa columna, así que se pregunta. */
    expect(resumen.sets[1][0].pendiente).toBe(1);
    expect(grupos).toContain('SIN_UNIDAD');
    const filas = (await app.invocar('qsFilas', { batchId: r.data.batchId }))?.data ?? [];
    const insumo = filas.find(x => x.part_number === `GLA-BAS-${s}`);
    expect(String(insumo?.tipo), '«No» en Vendible: insumo').toBe('INGREDIENTE');
    expect(insumo?.sellable, 'fuera de la caja').toBeFalsy();

    const ej2 = await app.invocar('qsEjecutar', { batchId: r.data.batchId });
    expect(ej2?.success, JSON.stringify(ej2)).toBeTruthy();

    const glaseada = await comoQuedo(app, `DON-GLA-${s}`);
    expect(Number(glaseada?.sellable), 'la dona se vende').toBe(1);
    expect(Number(glaseada?.price)).toBe(25);
    const rellena = await comoQuedo(app, `DON-REL-${s}`);
    expect(Number(rellena?.sellable), 'Vendible vacío: decide la hoja (Menú se vende)').toBe(1);

    try { fs.rmSync(destino, { recursive: true, force: true }); } catch { /* noop */ }
  });
});
