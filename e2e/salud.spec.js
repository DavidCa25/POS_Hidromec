/**
 * El giro Salud de punta a punta, en la app de verdad (0087).
 *
 *     npm run e2e:salud
 *
 * Base propia, `Wybix_E2E_Salud`, que nace con Salud APAGADO. Tres recorridos
 * en orden (comparten la base, como la compartiría el negocio):
 *
 *   1. FARMACIA. Se enciende desde Aplicaciones como «Farmacia con
 *      consultorio». La ficha sanitaria marca un antibiótico; los lotes no
 *      pueden sumar más que la existencia; la caja pide la receta antes de
 *      cobrar; la salida va primero por el lote que caduca antes (FEFO); el
 *      libro de antibióticos lleva el saldo y la receta. Un Operador no
 *      puede dar de alta lotes.
 *
 *   2. EXPEDIENTE. Alta del paciente con consentimiento obligatorio, nota
 *      SOAP con diagnóstico CIE-10, firma, intento de modificarla (por el
 *      canal y por SQL directo: los dos fallan), adenda, receta y bitácora.
 *      Un Operador no puede leer el expediente.
 *
 *   3. DENTAL. Cambio de giro a consultorio dental, odontograma por caras,
 *      plan de tratamiento que al aceptarse es una orden de servicio y se
 *      cobra en la caja. Los honorarios quedan EXENTOS de IVA (no tasa 0).
 *
 *   4. LABORATORIO E IMAGEN. Cambio de giro a laboratorio; catálogo con
 *      parámetros y valores de referencia; orden de estudios que se cobra
 *      como orden de servicio; captura con bandera fuera de rango; validación
 *      con cédula, inmutable; mastografía con BI-RADS; entrega.
 *
 * Capturas en tmp/e2e-salud/.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorMas, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-salud');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

async function sqlFalla(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  return r.ok ? null : String(r.error);
}

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(c.usuario);
}

async function salir(p) {
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
}


function enDias(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const HOY = enDias(0);

async function cerrarAvisoDeVenta(p) {
  for (let i = 0; i < 2; i++) {
    for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('app-premios-venta').getByRole('button', { name: 'Continuar' }).first()]) {
      try { await b.click({ timeout: 2500 }); } catch { /* no está */ }
    }
  }
}

test.describe.serial('giro Salud', () => {
  test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

  // =====================================================================
  test('farmacia: se activa, pide receta, sale por FEFO y llena el libro', async ({ appSalud: app }) => {
    test.setTimeout(300000);
    const p = app.ventana;
    const foto = (n) => p.screenshot({ path: path.join(SHOTS, `farmacia-${n}.png`) });
    await p.setViewportSize?.({ width: 1366, height: 820 });

    /* Un antibiótico y algo de venta libre, como los daría de alta Inventario. */
    await sql(app.base, `
      IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'Genérico') INSERT INTO dbo.CAT_brands (namee) VALUES (N'Genérico');
      IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Medicamentos') INSERT INTO dbo.CAT_categories (namee) VALUES (N'Medicamentos');
      DECLARE @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Genérico');
      DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'Medicamentos');
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code)
      SELECT v.pn, v.nombre, v.precio, v.stock, 1, 1, 'DIRECT', @c, @b, v.precio / 2, '02', 0, GETDATE(), NULL
        FROM (VALUES (N'AMOX-500', N'Amoxicilina 500 mg cápsulas', 120.00, 10),
                     (N'PARA-500', N'Paracetamol 500 mg tabletas', 35.00, 20)) v(pn, nombre, precio, stock)
       WHERE NOT EXISTS (SELECT 1 FROM dbo.products p WHERE p.part_number = v.pn);`);
    const [{ id: amox }] = await sql(app.base, `SELECT id FROM dbo.products WHERE part_number = N'AMOX-500'`);

    await login(app, CUENTAS.admin);
    const yo = (await app.invocar('sesion')).data.userId;

    // --------------------------------------------- 1. Activar desde Aplicaciones
    await irPorMas(p, 'Aplicaciones');
    await p.waitForSelector('app-aplicaciones .apps-card', { timeout: 30000 });
    const tarjeta = p.locator('.apps-card').filter({ has: p.locator('h3', { hasText: /^Salud$/ }) });
    await tarjeta.getByRole('button', { name: /Activar/ }).click();
    await p.locator('[data-guide=salud-giro-FARMACIA_CONSULTORIO]').click();
    await foto('1-elegir-giro');
    await p.getByRole('button', { name: 'Activar Salud' }).click();
    await expect(tarjeta.locator('.apps-card__giro')).toContainText('Farmacia con consultorio');

    const [mod] = await sql(app.base, `
      SELECT (SELECT enabled FROM dbo.business_modules WHERE module_key = N'salud') AS salud,
             (SELECT enabled FROM dbo.business_modules WHERE module_key = N'servicios') AS servicios,
             (SELECT preset FROM dbo.services_config WHERE id = 1) AS preset,
             (SELECT CAST(farmacia AS INT) + CAST(clinica AS INT) * 2 FROM dbo.salud_config WHERE id = 1) AS partes`);
    expect(mod.salud).toBe(true);
    expect(mod.servicios).toBe(true);            // la clínica enciende la agenda
    expect(mod.preset).toBe('SALUD');
    expect(mod.partes).toBe(3);                  // farmacia + clínica

    // ----------------------------------------------------- 2. Ficha sanitaria
    await irPorDock(p, 'Salud');
    await p.waitForSelector('[data-guide=salud-productos]');
    await expect(p).toHaveURL(/salud\/farmacia/);
    const fila = p.locator('[data-guide=salud-productos] tr[data-guide-clave="AMOX-500"]');
    await fila.click();
    await p.locator('[data-guide=salud-ficha-sustancia]').fill('Amoxicilina');
    await p.locator('[data-guide=salud-ficha-antibiotico]').check();
    await foto('2-ficha');
    await p.locator('[data-guide=salud-ficha-guardar]').click();
    await expect(fila).toContainText('Receta');
    await expect(fila).toContainText('Antibiótico');

    // ------------------------------------------------------------ 3. Lotes
    const lote = (l, cad, q) => app.invocar('saludLoteEntrada', { productId: amox, lote: l, caducidad: cad, cantidad: q });
    expect((await lote('L-TARDE', enDias(400), 4)).success).toBe(true);
    expect((await lote('L-PRONTO', enDias(200), 4)).success).toBe(true);
    const excede = await lote('L-SOBRA', enDias(300), 5);
    expect(excede.success).toBe(false);
    expect(excede.motivo).toBe('LOTES_EXCEDEN_STOCK');
    const caducado = await lote('L-VIEJO', enDias(-1), 1);
    expect(caducado.success).toBe(false);

    // ------------------------------------------ 4. La caja pide la receta (UI)
    await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });
    await irPorDock(p, 'Venta');
    await p.waitForSelector('.pos-wrap');
    await p.getByRole('button', { name: /Agregar producto/ }).click();
    await p.locator('[data-guide=venta-buscar]').fill('Amoxicilina');
    await p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: 'Amoxicilina' }).first().click();
    await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(1);
    await p.locator('[data-guide=venta-cobrar]').click();
    await p.locator('[data-guide=venta-recibido]').fill('200');
    await p.locator('[data-guide=venta-confirmar-cobro]').click();

    await expect(p.locator('[data-guide=receta-productos]')).toContainText('Amoxicilina');
    await foto('3-receta');
    await p.locator('#rx-medico').fill('Dra. Laura Méndez');
    await p.locator('#rx-cedula').fill('1234567');
    await p.locator('#rx-ret').check();
    await p.getByRole('button', { name: 'Registrar y cobrar' }).click();
    await expect.poll(async () => (await sql(app.base, `
      SELECT COUNT(*) n FROM dbo.salud_recetas_surtidas WHERE medico = N'Dra. Laura Méndez' AND cedula = N'1234567' AND retenida = 1`))[0].n,
      { timeout: 30000 }).toBe(1);
    await cerrarAvisoDeVenta(p);

    /* FEFO: la pieza salió del lote que caduca primero. */
    const lotes = async () => Object.fromEntries((await sql(app.base, `
      SELECT lote, CAST(cantidad AS INT) q FROM dbo.salud_lotes WHERE product_id = ${amox}`)).map((x) => [x.lote, x.q]));
    expect(await lotes()).toEqual({ 'L-PRONTO': 3, 'L-TARDE': 4 });

    // --------------------------------- 5. Por el canal: sin receta no se cobra
    const venta = (receta) => app.invocar('registerSaleV2', {
      userId: yo, paymentMethod: 'EFECTIVO', registerId: 1, customerId: null, dueDate: null, serviceMode: null,
      lines: [{ productId: amox, qty: 5, unitPrice: 120, catalogPrice: null, note: null, options: [] }], receta,
    });
    const sin = await venta(null);
    expect(sin.success).toBe(false);
    expect(sin.motivo).toBe('RECETA_REQUERIDA');
    expect(sin.productos.map((x) => x.nombre)).toContain('Amoxicilina 500 mg cápsulas');
    const con = await venta({ medico: 'Dr. Pedro Ruiz', cedula: '7654321', fecha: HOY, retenida: false });
    expect(con.success).toBe(true);
    /* 5 piezas: las 3 del lote que vence antes y 2 del siguiente. */
    expect(await lotes()).toEqual({ 'L-PRONTO': 0, 'L-TARDE': 2 });

    // ------------------------------------------------- 6. Libro de antibióticos
    const libro = await app.invocar('saludLibroControl', { desde: HOY, hasta: HOY, tipo: 'ANTIBIOTICOS' });
    expect(libro.success).toBe(true);
    const movs = libro.data;
    expect(movs.filter((m) => m.tipo === 'ENTRADA')).toHaveLength(2);
    expect(movs.filter((m) => m.tipo === 'SALIDA').reduce((s, m) => s + Number(m.salida), 0)).toBe(6);
    expect(Number(movs[movs.length - 1].saldo)).toBe(2);
    expect(movs.some((m) => m.medico === 'Dr. Pedro Ruiz' && m.cedula === '7654321')).toBe(true);

    await irPorDock(p, 'Salud', 'Libro de control');
    await p.locator('[data-guide=salud-libro-antibioticos]').click();
    await expect(p.locator('[data-guide=salud-libro]')).toContainText('Dra. Laura Méndez');
    await foto('4-libro');

    // ----------------------------------------- 7. Caducidades y temperaturas
    await irPorDock(p, 'Salud', 'Caducidades');
    await p.locator('[data-guide=salud-plazo-todos]').click();
    await expect(p.locator('[data-guide=salud-lotes] tr[data-guide-clave="L-TARDE"]')).toBeVisible();
    await expect(p.locator('[data-guide=salud-lotes] tr[data-guide-clave="L-PRONTO"]')).toHaveCount(0);   // agotado
    await p.locator('[data-guide=salud-tab-temperaturas]').click();
    await p.locator('[data-guide=salud-temp-grados]').fill('24.5');
    await p.locator('[data-guide=salud-temp-guardar]').click();
    await expect(p.locator('[data-guide=salud-temperaturas]')).toContainText('24.5');
    await foto('5-temperaturas');

    // ---------------------------------- 8. El Operador vende, pero no da lotes
    await salir(p);
    await login(app, CUENTAS.operador);
    const op = await app.invocar('saludLoteEntrada', { productId: amox, lote: 'X', caducidad: enDias(100), cantidad: 1 });
    expect(op.success).toBe(false);
    expect(op.motivo).toBe('SIN_PERMISO');
    const opLee = await app.invocar('saludFarmaciaProductos', { buscar: 'Amox' });
    expect(opLee.success).toBe(true);           // la ficha la ve quien vende
  });

  // =====================================================================
  test('expediente: consentimiento, nota firmada inmutable, adenda, receta y bitácora', async ({ appSalud: app }) => {
    test.setTimeout(300000);
    const p = app.ventana;
    const foto = (n) => p.screenshot({ path: path.join(SHOTS, `expediente-${n}.png`) });
    await p.setViewportSize?.({ width: 1366, height: 860 });
    await login(app, CUENTAS.admin);

    // -------------------------------------------- 1. Alta con consentimiento
    await irPorDock(p, 'Salud', 'Pacientes');
    await p.locator('[data-guide=salud-paciente-nuevo]').click();
    await p.locator('[data-guide=salud-pac-nombre]').fill('María Fernanda Solís');
    await p.locator('[data-guide=salud-pac-telefono]').fill('3312345678');
    await p.locator('[data-guide=salud-pac-alergias]').fill('Penicilina');
    await p.locator('[data-guide=salud-pac-guardar]').click();
    await expect(p.locator('.srv-error')).toContainText('autorización');      // sin consentimiento no hay alta
    await p.locator('[data-guide=salud-pac-consentimiento]').check();
    await foto('1-alta');
    await p.locator('[data-guide=salud-pac-guardar]').click();
    await expect(p.locator('[data-guide=salud-alergias]')).toContainText('Penicilina');
    const pacienteId = Number((p.url().match(/paciente\/(\d+)/) || [])[1]);
    expect(pacienteId).toBeGreaterThan(0);

    // ------------------------------------------------ 2. Nota SOAP y firma
    await p.locator('[data-guide=salud-doc-nuevo-NOTA]').click();
    await p.locator('[data-guide=doc-subjetivo]').fill('Dolor de garganta desde hace tres días, sin fiebre.');
    await p.locator('[data-guide=doc-vital-ta]').fill('120/80');
    await p.locator('[data-guide=doc-vital-temp]').fill('36.8');
    await p.locator('[data-guide=doc-objetivo]').fill('Faringe hiperémica, sin exudado.');
    await p.locator('[data-guide=doc-plan]').fill('Analgésico, líquidos, control en 5 días.');
    await p.locator('[data-guide=doc-dx]').fill('faringitis');
    await p.locator('[data-guide="dx-J02.9"]').click();
    await foto('2-nota');
    await p.locator('[data-guide=doc-firmar]').click();
    const nota = p.locator('[data-guide=salud-linea] article[data-guide-clave=NOTA]');
    await expect(nota).toHaveAttribute('data-guide-estado', 'FIRMADO');
    await expect(nota).toContainText('J02.9');
    await expect(nota).toContainText('120/80');

    // ------------------------------------------- 3. Lo firmado no se toca
    const [{ id: notaId }] = await sql(app.base, `SELECT TOP 1 id FROM dbo.salud_documentos WHERE paciente_id = ${pacienteId} AND tipo = N'NOTA'`);
    const reescribir = await app.invocar('saludDocumentoGuardar', { id: notaId, pacienteId, tipo: 'NOTA', contenido: { subjetivo: 'otra cosa' } });
    expect(reescribir.success).toBe(false);
    expect(reescribir.motivo).toBe('DOCUMENTO_FIRMADO');
    const porSql = await sqlFalla(app.base, `UPDATE dbo.salud_documentos SET contenido = N'{"x":1}' WHERE id = ${notaId}`);
    expect(porSql).toContain('DOCUMENTO_FIRMADO');
    const borrar = await sqlFalla(app.base, `DELETE FROM dbo.salud_diagnosticos WHERE documento_id = ${notaId}`);
    expect(borrar).toContain('DOCUMENTO_FIRMADO');

    // --------------------------------------------------------- 4. Adenda
    await nota.locator('[data-guide=doc-adenda]').click();
    await p.locator('.swal2-textarea').fill('Se agrega: refiere alergia a penicilina, se evita betalactámico.');
    await p.getByRole('button', { name: 'Agregar adenda' }).click();
    await expect(nota.locator('.sl-adenda')).toContainText('betalactámico');

    // --------------------------------------------------------- 5. Receta
    /* Una receta sin cédula no se firma: se piden los datos del médico ahí
       mismo y, al guardarlos, la receta se firma con su copia. */
    await p.locator('[data-guide=salud-doc-nuevo-RECETA]').click();
    await p.locator('[data-guide=rx-med-0]').fill('Paracetamol 500 mg tabletas');
    await p.locator('[data-guide=rx-dosis-0]').fill('1 tableta');
    await p.locator('[data-guide=rx-frec-0]').fill('cada 8 horas');
    await p.locator('[data-guide=doc-firmar]').click();
    await p.locator('[data-guide=salud-firma-nombre]').fill('Laura Méndez Ortiz');
    await p.locator('[data-guide=salud-firma-cedula]').fill('12345678');
    await p.locator('[data-guide=salud-firma-institucion]').fill('UNAM');
    await foto('3-cedula');
    await p.locator('[data-guide=salud-firma-guardar]').click();
    const receta = p.locator('[data-guide=salud-linea] article[data-guide-clave=RECETA]');
    await expect(receta).toHaveAttribute('data-guide-estado', 'FIRMADO');
    await expect(receta).toContainText('Paracetamol 500 mg');
    const [rx] = await sql(app.base, `SELECT JSON_VALUE(firmante, '$.cedula') cedula, JSON_VALUE(firmante, '$.institucion') inst
      FROM dbo.salud_documentos WHERE paciente_id = ${pacienteId} AND tipo = N'RECETA'`);
    expect(rx).toEqual({ cedula: '12345678', inst: 'UNAM' });
    /* Cambiar la cédula después no toca lo firmado. */
    expect((await app.invocar('saludProfesionalGuardar', { nombre: 'Laura Méndez Ortiz', cedula: '87654321', institucion: 'UNAM' })).success).toBe(true);
    const [rx2] = await sql(app.base, `SELECT JSON_VALUE(firmante, '$.cedula') cedula FROM dbo.salud_documentos WHERE paciente_id = ${pacienteId} AND tipo = N'RECETA'`);
    expect(rx2.cedula).toBe('12345678');
    await foto('3-expediente');

    // ------------------------------------------------------ 6. Bitácora
    await p.locator('[data-guide=salud-pac-tab-bitacora]').click();
    const bit = p.locator('[data-guide=salud-bitacora]');
    for (const a of ['ALTA', 'VER', 'FIRMAR', 'ADENDA']) await expect(bit.locator(`tr[data-guide-estado=${a}]`).first()).toBeVisible();
    await foto('4-bitacora');
    const huella = await sql(app.base, `SELECT COUNT(*) n FROM dbo.salud_documentos WHERE paciente_id = ${pacienteId} AND estado = N'FIRMADO' AND huella IS NOT NULL`);
    expect(huella[0].n).toBe(2);
    const intento = await sqlFalla(app.base, `DELETE FROM dbo.salud_bitacora WHERE paciente_id = ${pacienteId}`);
    expect(intento).toBeTruthy();                // la bitácora no se borra

    // -------------------------- 7. El Operador no lee expedientes (ni por canal)
    await salir(p);
    await login(app, CUENTAS.operador);
    const r = await app.invocar('saludExpediente', { customerId: pacienteId });
    expect(r.success).toBe(false);
    expect(r.motivo).toBe('SIN_PERMISO');
  });

  // =====================================================================
  test('dental: odontograma por caras y plan que se cobra como orden de servicio', async ({ appSalud: app }) => {
    test.setTimeout(300000);
    const p = app.ventana;
    const foto = (n) => p.screenshot({ path: path.join(SHOTS, `dental-${n}.png`) });
    await p.setViewportSize?.({ width: 1440, height: 900 });
    await login(app, CUENTAS.admin);
    const yo = (await app.invocar('sesion')).data.userId;

    // ------------------------------------------------ 1. Cambiar a dental
    await irPorMas(p, 'Aplicaciones');
    await p.waitForSelector('app-aplicaciones .apps-card', { timeout: 30000 });
    const tarjeta = p.locator('.apps-card').filter({ has: p.locator('h3', { hasText: /^Salud$/ }) });
    await tarjeta.locator('.apps-card__cambiar').click();
    await p.locator('[data-guide=salud-giro-DENTAL]').click();
    await p.getByRole('button', { name: 'Guardar el giro' }).click();
    await expect(tarjeta.locator('.apps-card__giro')).toContainText('Consultorio dental');

    const alta = await app.invocar('saludPacienteGuardar', { nombre: 'Jorge Arturo Peña', telefono: '3398765432', consentimiento: true });
    expect(alta.success).toBe(true);
    const pacienteId = alta.data[0].customer_id;

    // ------------------------------------------------------ 2. Odontograma
    await irPorDock(p, 'Salud', 'Pacientes');
    await p.locator('[data-guide=salud-buscar-paciente]').fill('Jorge Arturo');
    await p.locator('[data-guide=salud-pacientes] tr[data-guide-clave="Jorge Arturo Peña"]').click();
    await p.locator('[data-guide=salud-pac-tab-odontograma]').click();
    await p.locator('[data-guide=odonto-estado-CARIES]').click();
    await p.locator('[data-guide=diente-36-O]').click();
    await p.locator('[data-guide=diente-36-M]').click();
    await p.locator('[data-guide=odonto-estado-AUSENTE]').click();
    await p.locator('[data-guide=diente-18-O]').click();
    await foto('1-odontograma');
    await p.locator('[data-guide=odonto-guardar]').click();
    await expect.poll(async () => (await sql(app.base, `
      SELECT STRING_AGG(CONCAT(diente, cara, ':', estado), ',') WITHIN GROUP (ORDER BY diente, cara) s
        FROM dbo.salud_odontograma WHERE paciente_id = ${pacienteId}`))[0].s, { timeout: 20000 })
      .toBe('18T:AUSENTE,36M:CARIES,36O:CARIES');
    await expect(p.locator('[data-guide=diente-36-O]')).toHaveClass(/st-CARIES/);

    // ------------------------------------------------- 3. Plan de tratamiento
    await p.locator('[data-guide=salud-pac-tab-planes]').click();
    await p.locator('[data-guide=plan-nuevo]').click();
    await p.locator('[data-guide=plan-titulo]').fill('Rehabilitación inferior');
    await p.locator('[data-guide=plan-diente-0]').fill('36');
    await p.locator('[data-guide=plan-proc-0]').fill('Resina oclusal');
    await p.locator('[data-guide=plan-precio-0]').fill('800');
    await p.locator('[data-guide=plan-agregar]').click();
    await p.locator('[data-guide=plan-proc-1]').fill('Limpieza dental');
    await p.locator('[data-guide=plan-precio-1]').fill('600');
    await foto('2-plan');
    await p.locator('[data-guide=plan-guardar]').click();
    const plan = p.locator('.srv-tarjeta[data-guide-clave="Rehabilitación inferior"]');
    await expect(plan).toHaveAttribute('data-guide-estado', 'PROPUESTO');

    await plan.locator('[data-guide=plan-aceptar]').click();
    await p.getByRole('button', { name: 'Aceptar plan' }).click();
    await expect(plan).toHaveAttribute('data-guide-estado', 'ACEPTADO');
    const [orden] = await sql(app.base, `
      SELECT pl.orden_id, COUNT(l.id) partidas, CAST(SUM(l.line_total) AS FLOAT) total
        FROM dbo.salud_planes pl JOIN dbo.service_order_lines l ON l.order_id = pl.orden_id
       WHERE pl.paciente_id = ${pacienteId} GROUP BY pl.orden_id`);
    expect(orden.partidas).toBe(2);
    expect(orden.total).toBe(1400);
    /* Honorarios dentales: EXENTOS (TipoFactor Exento en el CFDI), no tasa 0. */
    const exentos = await sql(app.base, `
      SELECT COUNT(*) n FROM dbo.service_order_lines l JOIN dbo.products pr ON pr.id = l.product_id
       WHERE l.order_id = ${orden.orden_id} AND pr.tasa_iva = 0 AND pr.iva_exento = 1`);
    expect(exentos[0].n).toBe(2);

    /* Aceptado ya no se reescribe. */
    const [{ id: planId }] = await sql(app.base, `SELECT id FROM dbo.salud_planes WHERE paciente_id = ${pacienteId}`);
    const reescribir = await app.invocar('saludPlanGuardar', { id: planId, customerId: pacienteId, titulo: 'X', items: [{ procedimiento: 'Y', precio: 1 }] });
    expect(reescribir.success).toBe(false);

    // ----------------------------- 4. Avance: al terminar todo, el plan se cierra
    const items = await sql(app.base, `SELECT id FROM dbo.salud_plan_items WHERE plan_id = ${planId}`);
    for (const it of items) await plan.locator(`[data-guide=plan-hecho-${it.id}]`).check();
    await expect(plan).toHaveAttribute('data-guide-estado', 'TERMINADO');

    // ------------------------------------------- 5. Se cobra en la caja
    await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });
    await plan.locator('[data-guide=plan-cobrar]').click();
    await p.waitForSelector('.pos-wrap');
    await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(2);
    /* Cada procedimiento con SU precio: 800 + 600, no dos veces el primero. */
    await expect.poll(async () => Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, ''))).toBe(1400);
    await foto('3-cobro');
  });

  // =====================================================================
  test('laboratorio e imagen: catálogo, orden cobrable, captura con bandera, validación con cédula y entrega', async ({ appSalud: app }) => {
    test.setTimeout(300000);
    const p = app.ventana;
    const foto = (n) => p.screenshot({ path: path.join(SHOTS, `estudios-${n}.png`) });
    await p.setViewportSize?.({ width: 1440, height: 900 });
    await login(app, CUENTAS.admin);

    // ------------------------------------------- 1. Cambiar a laboratorio
    await irPorMas(p, 'Aplicaciones');
    await p.waitForSelector('app-aplicaciones .apps-card', { timeout: 30000 });
    const tarjeta = p.locator('.apps-card').filter({ has: p.locator('h3', { hasText: /^Salud$/ }) });
    await tarjeta.locator('.apps-card__cambiar').click();
    await p.locator('[data-guide=salud-giro-LABORATORIO]').click();
    await p.getByRole('button', { name: 'Guardar el giro' }).click();
    await expect(tarjeta.locator('.apps-card__giro')).toContainText('Laboratorio clínico');

    // ------------------------------------------------ 2. Catálogo (UI)
    await irPorDock(p, 'Salud', 'Estudios');
    await p.locator('[data-guide=salud-tab-catalogo-estudios]').click();
    await p.locator('[data-guide=estudios-catalogo-nuevo]').click();
    await p.locator('[data-guide=estudio-cat-nombre]').fill('Química sanguínea de 2 elementos');
    await p.locator('[data-guide=estudio-cat-precio]').fill('350');
    await p.locator('[data-guide=estudio-param-clave-0]').fill('GLU');
    await p.locator('[data-guide=estudio-param-nombre-0]').fill('Glucosa');
    await p.locator('[data-guide=estudio-param-min-0]').fill('70');
    await p.locator('[data-guide=estudio-param-max-0]').fill('100');
    await p.locator('[data-guide=estudio-param-agregar]').click();
    await p.locator('[data-guide=estudio-param-clave-1]').fill('CREA');
    await p.locator('[data-guide=estudio-param-nombre-1]').fill('Creatinina');
    await p.locator('[data-guide=estudio-param-min-1]').fill('0.6');
    await p.locator('[data-guide=estudio-param-max-1]').fill('1.2');
    await foto('1-catalogo');
    await p.locator('[data-guide=estudio-cat-guardar]').click();
    await expect(p.locator('[data-guide=estudios-catalogo] tr[data-guide-clave="Química sanguínea de 2 elementos"]')).toBeVisible();

    /* Mastografía (imagen) por el canal: BI-RADS es solo de mastografía. */
    const masto = await app.invocar('saludEstudioGuardar', {
      nombre: 'Mastografía bilateral', precio: 900, tasaIva: 0.16, ivaExento: false, tipo: 'IMAGEN', modalidad: 'MASTOGRAFIA',
      preparacion: 'Sin desodorante ni talco el día del estudio', entregaHoras: 48 });
    expect(masto.success).toBe(true);
    const [lab] = await sql(app.base, `
      SELECT e.product_id id, p.tasa_iva, p.iva_exento, JSON_QUERY(e.parametros) params FROM dbo.salud_estudios e
        JOIN dbo.products p ON p.id = e.product_id WHERE p.nombre = N'Química sanguínea de 2 elementos'`);
    expect(Number(lab.tasa_iva)).toBe(0.16);
    expect(JSON.parse(lab.params).map((x) => x.clave)).toEqual(['GLU', 'CREA']);

    /* Un estudio de laboratorio sin parámetros no entra. */
    const sinParam = await app.invocar('saludEstudioGuardar', { nombre: 'X', precio: 1, tasaIva: 0.16, tipo: 'LAB', parametros: [] });
    expect(sinParam.success).toBe(false);

    // ------------------------------------------------ 3. Orden de estudios
    const alta = await app.invocar('saludPacienteGuardar', { nombre: 'Rosa Elena Ibarra', telefono: '3311223344', fechaNacimiento: '1975-04-12', sexo: 'F', consentimiento: true });
    expect(alta.success).toBe(true);
    const pacienteId = alta.data[0].customer_id;

    await p.locator('[data-guide=salud-tab-estudios]').click();
    await p.locator('[data-guide=estudios-nueva]').click();
    await p.locator('[data-guide=estudios-paciente]').fill('Rosa Elena');
    await p.locator('.sl-opcion[data-guide-clave="Rosa Elena Ibarra"]').click();
    await p.locator('[data-guide-clave="Química sanguínea de 2 elementos"]').check();
    await p.locator('[data-guide-clave="Mastografía bilateral"]').check();
    await p.locator('[data-guide=estudios-medico]').fill('Dra. Laura Méndez');
    await foto('2-orden');
    await p.locator('[data-guide=estudios-crear]').click();
    await p.getByRole('button', { name: 'Después' }).click();
    await p.waitForURL(/salud\/estudios\/\d+/);
    const ordenId = Number(p.url().match(/estudios\/(\d+)/)[1]);

    const [cobro] = await sql(app.base, `
      SELECT COUNT(l.id) partidas, CAST(SUM(l.line_total) AS FLOAT) total FROM dbo.salud_estudio_ordenes o
        JOIN dbo.service_order_lines l ON l.order_id = o.orden_id WHERE o.id = ${ordenId}`);
    expect(cobro).toEqual({ partidas: 2, total: 1250 });

    // -------------------------------- 4. Captura de laboratorio con bandera
    const qs = p.locator('.sl-estudio[data-guide-clave="Química sanguínea de 2 elementos"]');
    await qs.locator('[data-guide=estudio-tomado]').click();
    await expect(qs).toHaveAttribute('data-guide-estado', 'TOMADO');
    await qs.locator('[data-guide=estudio-capturar]').click();
    await qs.locator('[data-guide=estudio-valor-GLU]').fill('112');
    await qs.locator('[data-guide=estudio-valor-CREA]').fill('0.9');
    await expect(qs.locator('.sl-fuera').first()).toBeVisible();        // el aviso sale mientras se escribe
    await qs.locator('[data-guide=estudio-guardar]').click();
    await expect(qs).toHaveAttribute('data-guide-estado', 'CAPTURADO');
    const [res] = await sql(app.base, `SELECT resultados FROM dbo.salud_estudio_items WHERE orden_id = ${ordenId} AND tipo = N'LAB'`);
    expect(JSON.parse(res.resultados)).toEqual([
      { clave: 'GLU', valor: '112', bandera: 'A' },
      { clave: 'CREA', valor: '0.9', bandera: null },
    ]);

    /* El Operador no captura ni ve resultados. */
    // (se comprueba al final, con su sesión)

    // ------------------------------------- 5. Validar: firma con cédula
    await qs.locator('[data-guide=estudio-validar]').click();
    await expect(qs).toHaveAttribute('data-guide-estado', 'VALIDADO');
    await expect(qs).toContainText('87654321');
    const [itLab] = await sql(app.base, `SELECT id, JSON_VALUE(firmante, '$.cedula') cedula, CASE WHEN huella IS NULL THEN 0 ELSE 1 END h
      FROM dbo.salud_estudio_items WHERE orden_id = ${ordenId} AND tipo = N'LAB'`);
    expect(itLab.cedula).toBe('87654321');
    expect(itLab.h).toBe(1);
    const porSql = await sqlFalla(app.base, `UPDATE dbo.salud_estudio_items SET resultados = N'[]' WHERE id = ${itLab.id}`);
    expect(porSql).toContain('ESTUDIO_VALIDADO');
    const recaptura = await app.invocar('saludEstudioCapturar', { itemId: itLab.id, resultados: [{ clave: 'GLU', valor: '90' }] });
    expect(recaptura.motivo).toBe('ESTUDIO_VALIDADO');

    // ----------------------------------------- 6. Mastografía con BI-RADS
    const [itMas] = await sql(app.base, `SELECT id FROM dbo.salud_estudio_items WHERE orden_id = ${ordenId} AND tipo = N'IMAGEN'`);
    const sinBirads = await app.invocar('saludEstudioCapturar', { itemId: itMas.id, hallazgos: 'Mamas de densidad heterogénea.', conclusion: 'Sin hallazgos sospechosos.' });
    expect(sinBirads.success).toBe(false);
    expect((await app.invocar('saludEstudioCapturar', {
      itemId: itMas.id, hallazgos: 'Mamas de densidad heterogénea (ACR C). Sin masas ni microcalcificaciones sospechosas.',
      conclusion: 'Estudio sin hallazgos sospechosos.', birads: 2 })).success).toBe(true);
    expect((await app.invocar('saludEstudioValidar', { itemId: itMas.id })).success).toBe(true);
    /* La app corre en file://: sin recargar, se vuelve por la lista (ya está «Para entregar»). */
    const [{ folio }] = await sql(app.base, `SELECT folio FROM dbo.salud_estudio_ordenes WHERE id = ${ordenId}`);
    await p.locator('[data-guide=salud-tab-estudios]').click();
    await p.locator('[data-guide=estudios-filtro-LISTA]').click();
    await p.locator(`[data-guide=estudios-lista] tr[data-guide-clave="${folio}"]`).click();
    await expect(p.locator('.sl-estudio[data-guide-clave="Mastografía bilateral"]')).toContainText('BI-RADS 2');

    // ------------------------------------------------------- 7. Entrega
    await foto('3-resultados');
    await p.locator('[data-guide=estudios-entregar]').click();
    await expect.poll(async () => (await sql(app.base, `SELECT estado FROM dbo.salud_estudio_ordenes WHERE id = ${ordenId}`))[0].estado).toBe('ENTREGADA');
    const bit = await sql(app.base, `SELECT accion FROM dbo.salud_bitacora WHERE paciente_id = ${pacienteId} ORDER BY id`);
    for (const a of ['ESTUDIO', 'VALIDAR', 'ENTREGAR']) expect(bit.map((b) => b.accion)).toContain(a);

    // ---------------------------- 8. El Operador no ve ni captura resultados
    await salir(p);
    await login(app, CUENTAS.operador);
    const ver = await app.invocar('saludEstudioOrdenes', { id: ordenId });
    expect(ver.motivo).toBe('SIN_PERMISO');
    const cap = await app.invocar('saludEstudioCapturar', { itemId: itMas.id, hallazgos: 'x' });
    expect(cap.motivo).toBe('SIN_PERMISO');
  });
});
