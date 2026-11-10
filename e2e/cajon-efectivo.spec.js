/**
 * Las entradas y salidas de efectivo abren el cajón (1.5.7).
 *
 *     npx playwright test e2e/cajon-efectivo.spec.js
 *
 * Sin cajón físico: se configura uno «en la impresora» que no existe, así que
 * la apertura FALLA, y eso basta para saber que se intentó. Sin cajón
 * habilitado, ninguna operación lo toca. Transferir a un proveedor tampoco.
 */
const { test, expect, CUENTAS } = require('./fixtures');

async function entrar(app) {
  const p = app.ventana;
  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }, { timeout: 60000 }).toBe(CUENTAS.admin.usuario);
}

test('entrada, retiro y gasto en efectivo abren el cajón; sin cajón no hacen nada', async ({ app }) => {
  test.setTimeout(180000);
  await entrar(app);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 1000, register_id: 1 });
  const equipo = (await app.invocar('getDeviceConfig'))?.data ?? (await app.invocar('getDeviceConfig'));
  const conCajon = (enabled) => app.invocar('setDeviceConfig', {
    ...equipo,
    drawer: { ...(equipo?.drawer ?? {}), enabled, conexion: 'impresora' },
    printer: { ...(equipo?.printer ?? {}), ticketPrinterName: 'Wybix-E2E-Impresora-Que-No-Existe' },
  });

  // ------------------------------------------------ sin cajón: no lo toca
  await conCajon(false);
  const sinCajon = await app.invocar('registerCashIn', { amount: 50, concept: 'CAMBIO', note: 'e2e cajón' });
  expect(sinCajon?.success, JSON.stringify(sinCajon)).toBeTruthy();
  expect(sinCajon.cajon).toEqual({ abierto: false, motivo: 'sin-cajon' });

  // ------------------------------------------------ con cajón: lo intenta
  await conCajon(true);
  const intento = (r, que) => {
    expect(r?.success, `${que}: ${JSON.stringify(r)}`).toBeTruthy();
    expect(r.cajon?.abierto, `${que} quiso abrir el cajón`).toBe(false);
    expect(String(r.cajon?.error || ''), `${que}: el error es de la impresora, no de permisos`).toMatch(/impresora|pulso/i);
  };
  intento(await app.invocar('registerCashIn', { amount: 50, concept: 'CAMBIO', note: 'e2e cajón' }), 'entrada');
  intento(await app.invocar('registerCashMovement', { amount: 20, note: 'e2e cajón' }), 'retiro');
  const conceptos = await app.invocar('egresosConceptos', {});
  const concepto = (conceptos?.data ?? []).find((c) => String(c.kind ?? c.tipo ?? '').toUpperCase() !== 'PERSONAL' && c.active !== false);
  if (concepto) {
    intento(await app.invocar('egresosRegistrar', { category_id: concepto.id, amount: 10, payment_method: 'EFECTIVO', beneficiary: 'Papelería E2E', note: 'e2e cajón' }), 'gasto');
    const transf = await app.invocar('egresosRegistrar', { category_id: concepto.id, amount: 10, payment_method: 'TRANSFERENCIA', beneficiary: 'Papelería E2E', note: 'e2e cajón' });
    expect(transf?.success, JSON.stringify(transf)).toBeTruthy();
    expect(transf.cajon, 'una transferencia no abre el cajón').toBeUndefined();
  }

  await app.invocar('setDeviceConfig', equipo);
});
