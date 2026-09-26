/**
 * MODO TERMINAL, EN PANTALLA Y EN EL ARENERO.
 *
 *     npx playwright test e2e/modo-terminal.spec.js
 *
 * Las pruebas arrancan con `WYBIX_E2E=1`, y con eso el proceso principal
 * escribe en `HKCU\Software\Wybix\TerminalSandbox\<SID>`, nunca en las
 * directivas reales. La prueba lo comprueba antes de pulsar nada: si la
 * pantalla no dijera «Modo de prueba», se detiene.
 */
const { execFileSync } = require('node:child_process');
const { test, expect, CUENTAS, irPorMas } = require('./fixtures');

async function entrar(app, cuenta) {
  const { ventana } = app;
  await ventana.waitForSelector('#username', { timeout: 60000 });
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(cuenta.usuario);
}

const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
  { encoding: 'utf8' }).trim();

function limpiarArenero() {
  try {
    ps(String.raw`Remove-Item -LiteralPath 'HKCU:\Software\Wybix\TerminalSandbox' -Recurse -Force -ErrorAction SilentlyContinue;
      $w = 'HKCU:\Software\Wybix';
      if ((Test-Path $w) -and @(Get-ChildItem $w).Count -eq 0 -and (Get-Item $w).ValueCount -eq 0) { Remove-Item $w -Force }`);
  } catch { /* limpio */ }
}

test.skip(process.platform !== 'win32', 'El modo terminal es de Windows');

test('Modo terminal: auditar, activar y restaurar (arenero)', async ({ app }) => {
  test.setTimeout(180000);
  const { ventana } = app;
  limpiarArenero();
  const politicaReal = ps(String.raw`(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' -Name RestrictRun -ErrorAction SilentlyContinue).RestrictRun`);

  try {
    await entrar(app, CUENTAS.admin);
    await irPorMas(ventana, 'Configuracion');
    await ventana.waitForSelector('.cs-tile', { timeout: 30000 });
    await ventana.locator('.cs-tile').filter({ hasText: 'Modo terminal' }).click();
    await ventana.waitForSelector('app-modo-terminal-panel', { timeout: 15000 });

    const panel = ventana.locator('app-modo-terminal-panel');
    await expect(panel.locator('.mt-arenero'), 'la prueba corre en el arenero, o no sigue').toBeVisible({ timeout: 60000 });

    // --------------------------------------------------------- auditoria
    await expect(panel.locator('.mt-equipo'), 'dice que Windows es').toContainText('Windows');
    const caps = panel.locator('.mt-caps li');
    expect(await caps.count(), 'lista lo que permite este Windows').toBeGreaterThanOrEqual(4);
    await expect(caps.filter({ hasText: 'lo aplica Wybix' }), 'y solo una cosa la aplica Wybix').toHaveCount(1);
    await expect(panel.locator('.mt-bloquea li').first(), 'explica que se bloqueara').toBeVisible();

    // ----------------------------------------------------------- activar
    const activar = panel.locator('button', { hasText: 'Activar modo terminal' });
    await expect(activar, 'sin «Entiendo» no se puede').toBeDisabled();
    await panel.locator('label.mt-op', { hasText: 'También Excel' }).click();
    await expect(panel.locator('.mt-bloquea'), 'la vista previa cambia con las opciones').toContainText('EXCEL.EXE');
    await panel.locator('label.mt-confirma').click();
    await expect(activar).toBeEnabled();
    await activar.click();

    await expect(ventana.locator('.swal2-title'), JSON.stringify(await ventana.locator('.swal2-html-container').textContent().catch(() => '')))
      .toHaveText('Modo terminal activado', { timeout: 60000 });
    await ventana.click('.swal2-confirm');

    const aud = await ventana.evaluate(() => window.wybix.terminal.auditar({}));
    const sid = aud.data.windows.sid;
    const raiz = `HKCU:\\Software\\Wybix\\TerminalSandbox\\${sid}\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer`;
    const leer = (clave, n) => ps(`(Get-ItemProperty -LiteralPath '${clave}' -Name '${n}' -ErrorAction SilentlyContinue).'${n}'`);
    expect(leer(raiz, 'RestrictRun'), 'la directiva queda puesta en el arenero').toBe('1');
    expect(leer(`${raiz}\\RestrictRun`, '2'), 'con Excel en la lista').toBe('EXCEL.EXE');

    await expect(panel.locator('.mt-activo'), 'la pantalla lo muestra activo').toBeVisible();
    await expect(panel.locator('.mt-activo'), 'con la ruta del respaldo').toContainText('respaldo');

    const otra = await ventana.evaluate(() => window.wybix.terminal.activar({}));
    expect(otra.success, 'activar dos veces no pisa el respaldo').toBe(false);

    // --------------------------------------------------------- restaurar
    await panel.locator('button', { hasText: 'Restaurar configuración' }).click();
    await ventana.click('.swal2-confirm'); // «¿Restaurar?»
    await expect(ventana.locator('.swal2-title')).toHaveText('Configuración restaurada', { timeout: 60000 });
    await ventana.click('.swal2-confirm');

    expect(leer(raiz, 'RestrictRun'), 'lo que no existia desaparece').toBe('');
    await expect(panel.locator('.mt-activo')).toHaveCount(0);
    await expect(activar, 'y se puede volver a activar').toBeVisible();

    const cfg = await app.invocar('getDeviceConfig');
    const t = cfg?.terminal ?? cfg?.data?.terminal;
    expect(t?.activo, 'el estado del equipo dice restaurado').toBe(false);
  } finally {
    limpiarArenero();
  }

  const politicaDespues = ps(String.raw`(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer' -Name RestrictRun -ErrorAction SilentlyContinue).RestrictRun`);
  expect(politicaDespues, 'las directivas REALES de este equipo no se tocaron').toBe(politicaReal);
});
