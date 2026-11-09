/**
 * MultiEmpresa (0080), en la app de verdad. docs/multiempresa.md.
 *
 *   1. El administrador da de alta una segunda empresa DESDE LA PANTALLA:
 *      se restaura la plantilla, se migra, nace con el mismo administrador y
 *      las dos quedan en el mismo grupo, con AUTO_CLOSE apagado.
 *   2. Cambia a ella con la pastilla del negocio: la ventana se recarga con la
 *      sesión, el nombre y los datos de la otra base. El turno abierto de la
 *      primera no se ve en la segunda; el cajón de cada una es suyo.
 *   3. Mis empresas pone a las dos lado a lado con sus números reales y
 *      «Entrar» regresa a la primera.
 *   4. Permisos: un cajero no ve el selector ni puede cambiar por el canal;
 *      con EMPRESAS_CAMBIAR otorgado, tampoco entra donde no existe.
 *   5. Cambios recibidos: la bitácora de lo que otra empresa aplicó aquí.
 *
 * Lo de 2, 3 y 4 empresas y los pedidos lo prueba scripts/db/pruebas/
 * empresas.mjs; la nube, wybix-owner/scripts/probar-grupos.mjs; el ciclo
 * (vuelta atrás, servicios), scripts/pruebas/empresas.test.mjs.
 *
 *     npm run e2e:empresas
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-empresas');
const NOMBRE = 'E2E Pachoncitos';
/* La base que crea el alta (electron/empresas/alta.js): Wybix_POS_<Nombre>. */
const SEGUNDA = 'Wybix_POS_E2EPachoncitos';

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }, { timeout: 60000 }).toBe(c.usuario);
}

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

/* La segunda empresa la crea la prueba con el alta real, así que su nombre
   no es de los temporales: se borra aquí, por nombre exacto, y en ningún otro
   caso. */
async function borrarSegunda() {
  const { ejecutar } = await import('../scripts/db/lib/temporal.mjs');
  ejecutar('master', `IF DB_ID(N'${SEGUNDA}') IS NOT NULL BEGIN
    ALTER DATABASE [${SEGUNDA}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${SEGUNDA}]; END`);
}

async function limpiar(base) {
  await borrarSegunda();
  await sql(base, `EXEC dbo.sp_empresas_grupo_fijar @grupo = NULL;
                   DELETE FROM dbo.empresas_comandos;
                   DELETE FROM dbo.user_permissions WHERE permiso = N'EMPRESAS_CAMBIAR';`);
}

test.afterAll(async () => { await borrarSegunda().catch(() => {}); });

test('MultiEmpresa: alta, cambio con la pastilla, Mis empresas y permisos', async ({ app }) => {
  test.setTimeout(600000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  await limpiar(app.base);
  const negocioCore = (await sql(app.base, 'SELECT TOP 1 business_name AS n FROM dbo.business_config ORDER BY id;'))[0].n;

  await login(app, CUENTAS.admin);

  /* El cajón de la primera empresa: pin 2. */
  const equipo = (await app.invocar('getDeviceConfig'))?.data ?? (await app.invocar('getDeviceConfig'));
  await app.invocar('setDeviceConfig', { ...equipo, drawer: { ...(equipo?.drawer ?? {}), pin: 0, enabled: true } });

  /* Un turno abierto y una venta en la primera, para ver que no cruzan. */
  await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = 1)
      EXEC dbo.sp_open_shift @user_id = 1, @opening_cash = 500, @register_id = 1;
    INSERT INTO dbo.sales (useer_id, total, payment_method, paid_amount, register_id) VALUES (1, 123.45, N'EFECTIVO', 123.45, 1);`);

  // ------------------------------------------------------------ 1. alta
  const pastilla = p.locator('[data-guide="empresa-selector"]');
  await expect(pastilla, 'un administrador sin otras empresas ya tiene el botón (para agregar)').toBeVisible({ timeout: 30000 });
  await expect(pastilla).toContainText(negocioCore);
  await pastilla.click();
  await expect(p.locator('[data-guide="empresa-panel"]')).toBeVisible();
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, '01-panel-sola.png') });
  await p.click('[data-guide="empresa-agregar"]');
  await expect(p.locator('[data-guide="empresas-alta"]')).toBeVisible();

  await p.fill('[data-guide="empresas-alta-nombre"]', NOMBRE);
  await p.click('[data-guide="empresas-alta-giro"] button, [data-guide="empresas-alta-giro"] [role="combobox"]');
  await p.locator('.wx-opt', { hasText: 'Restaurante o cafetería' }).first().click();
  await p.screenshot({ path: path.join(SHOTS, '02-alta.png') });
  await p.click('[data-guide="empresas-alta-crear"]');
  await p.click('.swal2-confirm');
  await expect(p.locator('.swal2-title'), 'el alta termina').toContainText('está lista', { timeout: 420000 });
  await p.screenshot({ path: path.join(SHOTS, '03-alta-lista.png') });
  await p.click('.swal2-cancel');   // «Después»

  /* La segunda se lee DESDE la primera (tres partes): la herramienta de
     pruebas solo abre bases temporales, y esta la creó la aplicación. */
  const S = `[${SEGUNDA}].dbo`;
  const segunda = (await sql(app.base, `
    SELECT (SELECT TOP 1 business_name FROM ${S}.business_config) AS negocio,
           (SELECT TOP 1 business_profile FROM ${S}.business_config) AS giro,
           (SELECT valor FROM ${S}.database_metadata WHERE clave = N'empresas_grupo') AS grupo,
           (SELECT password_hash FROM ${S}.users WHERE usuario = N'${CUENTAS.admin.usuario}' AND active = 1) AS hash,
           (SELECT COUNT(*) FROM ${S}.empresas_grupo_bases) AS miembros,
           (SELECT COUNT(*) FROM ${S}.sales) AS ventas;`))[0];
  const primera = (await sql(app.base, `
    SELECT (SELECT valor FROM dbo.database_metadata WHERE clave = N'empresas_grupo') AS grupo,
           (SELECT password_hash FROM dbo.users WHERE usuario = N'${CUENTAS.admin.usuario}') AS hash,
           (SELECT is_auto_close_on FROM sys.databases WHERE name = N'${SEGUNDA}') AS auto_close;`))[0];
  expect(segunda.negocio).toBe(NOMBRE);
  expect(segunda.giro).toBe('HOSPITALITY');
  expect(segunda.grupo, 'las dos en el mismo grupo').toBe(primera.grupo);
  expect(segunda.hash, 'el mismo administrador, con su misma contraseña').toBe(primera.hash);
  expect(segunda.miembros).toBe(2);
  expect(segunda.ventas, 'nace vacía').toBe(0);
  expect(primera.auto_close, 'se queda abierta').toBe(false);
  const archivoEquipo = path.join(app.perfil, 'empresas', SEGUNDA, 'device-config.json');
  expect(fs.existsSync(archivoEquipo), 'hereda la impresora y el cajón').toBe(true);
  expect(JSON.parse(fs.readFileSync(archivoEquipo, 'utf8')).register, 'pero no la caja').toBeUndefined();

  // ----------------------------------------------- 2. cambiar con la pastilla
  await pastilla.click();
  const fila = p.locator('[data-guide="empresa-local"]', { hasText: NOMBRE });
  await expect(fila).toBeVisible();
  await p.waitForTimeout(300);   // que termine de entrar el panel
  await p.screenshot({ path: path.join(SHOTS, '04-panel-dos.png') });
  const t0Cambio = Date.now();
  await fila.click();

  /* La ventana se recarga sola con la otra empresa y la misma persona. */
  await expect.poll(async () => {
    try { return (await app.invocar('empresasListar'))?.data?.activa?.base; } catch { return null; }
  }, { timeout: 120000 }).toBe(SEGUNDA);
  await expect(p.locator('[data-guide="empresa-selector"]')).toContainText(NOMBRE, { timeout: 60000 });
  /* Cuánto siente la persona: del clic a la otra empresa en pantalla. */
  const msCambio = Date.now() - t0Cambio;
  fs.writeFileSync(path.join(SHOTS, 'cambio.json'), JSON.stringify({ ms: msCambio }, null, 2));
  console.log(`[E2E] cambio de empresa en ${msCambio} ms`);
  for (const l of (app.registro || []).join('').split(String.fromCharCode(10)).filter(x => x.includes('[EMPRESA] cambio a'))) console.log(l.trim());
  expect(msCambio, 'cambiar de empresa no tarda más de 8 s').toBeLessThan(8000);
  expect((await app.invocar('sesion'))?.data?.usuario).toBe(CUENTAS.admin.usuario);
  await p.screenshot({ path: path.join(SHOTS, '05-en-la-segunda.png') });

  const turno = await app.invocar('getOpenShift', { register_id: 1 }).catch(() => null);
  expect(turno?.data ?? turno?.recordset?.[0] ?? null, 'el turno de la primera no aparece aquí').toBeFalsy();
  const equipo2 = (await app.invocar('getDeviceConfig'))?.data ?? (await app.invocar('getDeviceConfig'));
  await app.invocar('setDeviceConfig', { ...equipo2, drawer: { ...(equipo2?.drawer ?? {}), pin: 1, enabled: true } });

  // --------------------------------------------------------- 3. Mis empresas
  await pastilla.click();
  await p.click('[data-guide="empresa-mis-empresas"]');
  const tarjetas = p.locator('[data-guide="empresas-tarjetas"] article');
  await expect(tarjetas).toHaveCount(2, { timeout: 60000 });
  const tarjetaCore = p.locator(`[data-guide="empresas-tarjetas"] article[data-guide-clave="${app.base}"]`);
  const ventasCore = (await sql(app.base, `SELECT CAST(SUM(total) AS DECIMAL(18,2)) AS v FROM dbo.sales
                                            WHERE datee >= CAST(GETDATE() AS DATE);`))[0].v;
  await expect(tarjetaCore).toContainText(Number(ventasCore).toLocaleString('es-MX', { minimumFractionDigits: 2 }));
  await expect(p.locator('[data-guide="empresas-total"]')).toBeVisible();
  await p.screenshot({ path: path.join(SHOTS, '06-mis-empresas.png'), fullPage: true });

  await tarjetaCore.locator('[data-guide="empresas-entrar"]').click();
  await expect.poll(async () => {
    try { return (await app.invocar('empresasListar'))?.data?.activa?.base; } catch { return null; }
  }, { timeout: 120000 }).toBe(app.base);

  /* Cada empresa conserva su cajón. */
  const deVuelta = (await app.invocar('getDeviceConfig'))?.data ?? (await app.invocar('getDeviceConfig'));
  expect(deVuelta?.drawer?.pin, 'el cajón de la primera sigue en el pin 2').toBe(0);
  const archivoSegunda = JSON.parse(fs.readFileSync(archivoEquipo, 'utf8'));
  expect(archivoSegunda.drawer.pin, 'y el de la segunda en el pin 5').toBe(1);

  // ------------------------------------------------------- 5. recibidos
  await sql(app.base, `INSERT INTO dbo.empresas_comandos (comando_id, tipo, origen_empresa, origen_usuario, payload, resultado, detalle)
    VALUES (NEWID(), N'PRODUCTO_PRECIO', N'Birrialtlan', N'david', N'{"nombre":"Taco","precio":38}', N'APLICADO', N'Precio actualizado a $38.00.');`);
  await p.locator('[data-guide="empresa-selector"]').click();
  await p.click('[data-guide="empresa-mis-empresas"]');
  await p.click('[data-guide="empresas-tab-recibidos"]');
  await expect(p.locator('[data-guide="empresas-recibidos"]')).toContainText('Birrialtlan');
  await expect(p.locator('[data-guide="empresas-recibidos"]')).toContainText('Precio de Taco a');
  await p.screenshot({ path: path.join(SHOTS, '07-recibidos.png') });

  // ------------------------------------------------------- 4. permisos
  await app.invocar('cerrarSesion');
  /* Rutas con path sobre file://: se vuelve a la entrada, no se recarga la ruta. */
  await p.goto(p.url().replace(/\/browser\/.*$/, '/browser/index.html'));
  await p.waitForSelector('#username', { timeout: 60000 });
  await login(app, CUENTAS.operador);
  await expect(p.locator('.wx-negocio').first()).toBeVisible({ timeout: 30000 });
  await expect(p.locator('[data-guide="empresa-selector"]'), 'un cajero no tiene el selector').toHaveCount(0);
  const negado = await app.invocar('empresasCambiar', { base: SEGUNDA });
  expect(negado.success).toBe(false);

  /* Con el permiso otorgado, el cajero tampoco entra donde no existe. */
  /* Como lo haría «Usuarios y permisos»: el extra y la revisión de seguridad,
     para que la sesión abierta lo note sin volver a entrar. */
  await sql(app.base, `INSERT INTO dbo.user_permissions (user_id, permiso)
    SELECT id, 'EMPRESAS_CAMBIAR' FROM dbo.users WHERE usuario = N'${CUENTAS.operador.usuario}';
    EXEC dbo.sp_bump_security_revision;`);
  await expect.poll(async () => (await app.invocar('empresasListar'))?.success, { timeout: 30000 }).toBe(true);
  const lista = await app.invocar('empresasListar');
  expect(lista.data.locales.map((e) => e.base), 'la segunda no se le ofrece: ahí no existe').not.toContain(SEGUNDA);
  const sinUsuario = await app.invocar('empresasCambiar', { base: SEGUNDA });
  expect(sinUsuario.success).toBe(false);
  expect(sinUsuario.code).toBe('NO_USER');
  expect((await app.invocar('empresasListar')).data.activa.base, 'y sigue en su empresa').toBe(app.base);

  await limpiar(app.base);
});
