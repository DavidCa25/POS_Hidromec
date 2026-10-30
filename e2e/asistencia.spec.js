/**
 * Asistencia (0071), en la app de verdad.
 *
 *   1. El administrador la activa en Aplicaciones contestando las preguntas.
 *   2. Asigna un horario: elige una jornada (en a. m./p. m.), escribe el
 *      descanso de corrido (el campo NO pierde el foco) y la semana cabe sin
 *      barra de desplazamiento, tambien en una pantalla tactil de 1024.
 *   3. El Operador, con su sesion y sin PIN, no puede cobrar sin entrada (la
 *      regla lo frena y abre Checar), checa entrada y ve las acciones que
 *      tocan. La hora que ensena es la de la caja.
 *   4. El Encargado ve la semana con «Trabajando», corrige la entrada con
 *      motivo y la tabla lo marca como corregida.
 *
 * Nace de un fallo real: Checar se abria vacio (el canal tomaba la sesion por
 * payload) y nada lo decia. Ninguna prueba de base de datos lo podia ver.
 *
 *     npm run e2e:asistencia
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, BASE_CORE, irPorMas } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-asistencia');

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}

async function salir(app) {
  const p = app.ventana;
  const aviso = p.getByRole('button', { name: 'Salir', exact: true });
  if (await aviso.isVisible().catch(() => false)) await aviso.click();
  if (await p.locator('#username').isVisible().catch(() => false)) return;
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
}

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

/** La hora local de la caja, HH:mm, como la deberia ensenar Checar. */
const ahoraHHmm = () => new Date().toTimeString().slice(0, 5);
const cerca = (a, b) => {
  const m = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return Math.abs(m(a) - m(b)) <= 2;
};

/** Ninguna barra horizontal: ni en la pagina ni en la tabla de la semana. */
async function sinScrollHorizontal(p, sel = '.asis-semana') {
  return p.evaluate((s) => {
    const t = document.querySelector(s);
    const doc = document.scrollingElement;
    return {
      tabla: t ? t.scrollWidth - t.clientWidth : -1,
      pagina: doc.scrollWidth - doc.clientWidth,
    };
  }, sel);
}

/* La regla «checar antes de cobrar» se queda puesta al terminar y frenaria las
   ventas de las pruebas que vienen despues (Club, Puntos...): se apaga
   Asistencia al salir, pase lo que pase. */
test.afterEach(async () => {
  await sql(BASE_CORE, `EXEC dbo.sp_set_business_module @module_key = N'asistencia', @enabled = 0;`).catch(() => {});
});

test('Asistencia: activar, horario, checar con la sesión y corregir', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1280, height: 800 });
  await sql(app.base, `
    DELETE FROM dbo.asistencia_correcciones; DELETE FROM dbo.asistencia_descansos;
    DELETE FROM dbo.asistencia_jornadas; DELETE FROM dbo.asistencia_horarios; DELETE FROM dbo.asistencia_reglas;
    DELETE FROM dbo.business_modules WHERE module_key = N'asistencia';`);

  // ---------------------------------------------------------- 1. activar
  await login(app, CUENTAS.admin);
  await irPorMas(p, 'Aplicaciones');
  const tarjeta = p.locator('article').filter({ has: p.locator('h3', { hasText: 'Asistencia' }) });
  await tarjeta.getByRole('button', { name: /Activar/ }).click();
  await expect(p.locator('.swal2-popup')).toContainText('Activar Asistencia');
  await expect(p.locator('.asis-preg')).toHaveCount(6);
  /* La regla de cobrar viene en No: se cambia a Si, como lo haria el dueno. */
  await p.locator('.asis-preg').filter({ hasText: 'checar entrada antes de cobrar' }).locator('label', { hasText: 'Sí' }).click();
  await p.locator('.swal2-confirm').click();
  await expect(p.locator('.swal2-popup')).toContainText('Asistencia activada');
  const reglas = await sql(app.base, 'SELECT tolerancia_min, entrada_para_vender FROM dbo.asistencia_reglas;');
  expect(reglas[0]).toMatchObject({ tolerancia_min: 10, entrada_para_vender: true });

  // ---------------------------------------------------------- 2. horario
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await irPorMas(p, 'Asistencia');
  await expect(p.locator('.asis-cab h1')).toHaveText('Asistencia');
  await p.locator('[data-guide="asistencia-tab-horarios"]').click();
  await p.locator('.asis-lista__item', { hasText: CUENTAS.operador.usuario }).click();
  await p.locator('[data-guide="asistencia-jornada"]').getByRole('combobox').click();
  await p.getByRole('option', { name: /8 a\. m\. a 4 p\. m\./ }).first().click();
  const filas = p.locator('.asis-semana tbody tr');
  await expect(filas).toHaveCount(7);
  await expect(filas.nth(0)).toContainText('7:30');
  await expect(filas.nth(0).locator('.wx-time__doce').first()).toHaveText('8:00 a. m.');
  await expect(filas.nth(6)).toContainText('Descanso semanal');

  /* El descanso se escribe de corrido: el campo no pierde el foco. */
  const descanso = filas.nth(0).locator('input.asis-num');
  await descanso.click();
  await descanso.fill('');
  await p.keyboard.type('45');
  expect(await descanso.evaluate((el) => el === document.activeElement)).toBe(true);
  await expect(descanso).toHaveValue('45');
  await descanso.blur();
  await expect(filas.nth(0)).toContainText('7:15');

  expect(await sinScrollHorizontal(p)).toEqual({ tabla: 0, pagina: 0 });
  await p.screenshot({ path: path.join(SHOTS, '1-horario-1280.png') });
  await p.setViewportSize?.({ width: 1024, height: 768 });
  const angosto = await sinScrollHorizontal(p);
  expect(angosto.tabla).toBeLessThanOrEqual(0);
  expect(angosto.pagina).toBeLessThanOrEqual(0);
  await p.screenshot({ path: path.join(SHOTS, '2-horario-1024.png') });
  await p.setViewportSize?.({ width: 1280, height: 800 });

  await p.getByRole('button', { name: 'Guardar horario' }).click();
  await expect(p.locator('.swal2-popup')).toContainText('Horario guardado');
  const h = await sql(app.base, `SELECT COUNT(*) AS n, MIN(descanso_min) AS d FROM dbo.asistencia_horarios h
    JOIN dbo.users u ON u.id = h.user_id WHERE u.usuario = N'${CUENTAS.operador.usuario}';`);
  expect(h[0]).toMatchObject({ n: 6, d: 30 });
  await expect(p.locator('.asis-lista__item', { hasText: CUENTAS.operador.usuario })).toContainText('Lun–Sáb 08:00–16:00');
  await salir(app);

  // ------------------------------------- 3. el operador checa con su sesion
  await login(app, CUENTAS.operador);
  const op = (await app.invocar('sesion')).data.userId;
  /* Sin entrada, el cobro lo frena la regla (en el proceso principal). */
  /* Un producto propio: en una base recien preparada no hay ninguno. */
  const prod = (await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-ASIS-1')
      INSERT INTO dbo.products (part_number, nombre, price, stock, cost, objeto_impuesto, tasa_iva, active, registrated_date)
      VALUES (N'E2E-ASIS-1', N'Café de prueba', 35, 100, 10, '02', 0.16, 1, GETDATE());
    SELECT id, price FROM dbo.products WHERE part_number = N'E2E-ASIS-1';`))[0];
  const venta = await app.invocar('registerSaleV2', {
    userId: op, paymentMethod: 'EFECTIVO', lines: [{ productId: prod.id, qty: 1, unitPrice: Number(prod.price) || 1 }],
  });
  expect(venta).toMatchObject({ success: false, motivo: 'ASISTENCIA_SIN_ENTRADA' });

  /* Al llegar no hay turno y la caja abre en Inicio: Checar esta en el dock,
     en cualquier pantalla (antes solo vivia en Venta y no se podia checar). */
  const aviso = p.getByRole('button', { name: 'Salir', exact: true });
  if (await aviso.isVisible().catch(() => false)) await aviso.click();
  await expect(p.locator('[data-guide="dock-checar"]')).toBeVisible();
  await p.locator('[data-guide="dock-checar"]').click();
  const dialogo = p.locator('[data-guide="asistencia-checar"]');
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText(CUENTAS.operador.usuario);
  await expect(dialogo).toContainText('Sin entrada registrada hoy');
  const reloj = (await dialogo.locator('.asis-hora__reloj').textContent()).trim();
  expect(cerca(reloj, ahoraHHmm()), `Checar ensena ${reloj}, la caja dice ${ahoraHHmm()}`).toBe(true);
  await p.screenshot({ path: path.join(SHOTS, '3-checar-sin-entrada.png') });

  await dialogo.locator('[data-guide="asistencia-entrada"]').click();
  await expect(dialogo).toContainText('Entrada registrada');
  await expect(dialogo).toBeHidden({ timeout: 10000 });
  await p.locator('[data-guide="dock-checar"]').click();
  await expect(dialogo).toContainText(/Entró a las \d{2}:\d{2}/);
  await expect(dialogo.locator('[data-guide="asistencia-descanso"]')).toBeVisible();
  await expect(dialogo.locator('[data-guide="asistencia-salida"]')).toBeVisible();
  await expect(dialogo.locator('[data-guide="asistencia-entrada"]')).toHaveCount(0);
  await p.screenshot({ path: path.join(SHOTS, '4-checar-trabajando.png') });
  await p.keyboard.press('Escape');

  /* Con entrada, la regla ya no frena (lo que siga es la venta normal). */
  const venta2 = await app.invocar('registerSaleV2', {
    userId: op, paymentMethod: 'EFECTIVO', lines: [{ productId: prod.id, qty: 1, unitPrice: Number(prod.price) || 1 }],
  });
  expect(venta2?.motivo).not.toBe('ASISTENCIA_SIN_ENTRADA');
  await salir(app);

  // ------------------------------------------ 4. el encargado ve y corrige
  await login(app, CUENTAS.encargado);
  await irPorMas(p, 'Asistencia');
  const fila = p.locator('.asis-tabla tbody tr', { hasText: CUENTAS.operador.usuario });
  await expect(fila).toContainText('Trabajando');
  expect(await sinScrollHorizontal(p, '.asis-tabla')).toEqual({ tabla: 0, pagina: 0 });
  await p.screenshot({ path: path.join(SHOTS, '5-semana.png') });
  await fila.click();
  const detalle = p.locator('.asis-detalle');
  await expect(detalle).toContainText(CUENTAS.operador.usuario);
  await detalle.getByRole('button', { name: 'Corregir' }).first().click();
  const form = p.locator('[data-guide="asistencia-corregir"]');
  const entrada = form.locator('wx-time[name="he"] input');
  /* Media hora antes de ahora: siempre en el pasado y antes de su entrada real. */
  const antes = new Date(Date.now() - 30 * 60000).toTimeString().slice(0, 5);
  await entrada.fill(antes);
  await form.locator('#asis-motivo').fill('Llegó antes y no checó');
  await form.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(detalle).toContainText('Corregida');
  await expect(detalle).toContainText('Llegó antes y no checó');
  const corr = await sql(app.base, 'SELECT COUNT(*) AS n FROM dbo.asistencia_correcciones;');
  expect(corr[0].n).toBe(1);
  await p.screenshot({ path: path.join(SHOTS, '6-corregida.png') });
});
