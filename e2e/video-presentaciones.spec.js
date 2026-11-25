/**
 * VIDEO (solo para revisar): productos con muchas presentaciones, a ritmo de
 * persona y con letreros. No es una prueba de la suite: la cuenta de $651 y
 * las existencias las comprueba e2e/abarrotes.spec.js.
 *
 *   WYBIX_E2E_VIDEO=tmp/video npx playwright test e2e/video-presentaciones.spec.js
 */
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('video · un producto, muchas presentaciones', async ({ app }) => {
  test.setTimeout(600000);
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });
  const pausa = (ms = 1300) => p.waitForTimeout(ms);
  /* Un letrero abajo, como subtítulo, para saber qué está pasando. */
  const letrero = async (texto) => {
    await p.evaluate((t) => {
      let d = document.getElementById('vid-letrero');
      if (!d) {
        d = document.createElement('div');
        d.id = 'vid-letrero';
        d.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:999999;max-width:1100px;'
          + 'background:rgba(15,24,38,.92);color:#fff;font:600 20px/1.35 Geist,system-ui,sans-serif;padding:12px 22px;'
          + 'border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35);text-align:center;pointer-events:none';
        document.body.appendChild(d);
      }
      d.textContent = t;
    }, texto);
    await pausa(1800);
  };

  const { ABARROTES, PRESENTACIONES, sqlSembrar } = await import('../scripts/giros/abarrotes.mjs');
  const filas = await sql(app.base, sqlSembrar());
  const porPn = Object.fromEntries(filas.map((f) => [f.part_number, f]));
  const stock = async (pn) => Number((await sql(app.base, `SELECT CAST(stock AS FLOAT) s FROM dbo.products WHERE part_number = N'${pn}';`))[0].s);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 }).toBe(CUENTAS.admin.usuario);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });

  /* La compra: cada producto por su presentación de compra (bulto, caja). */
  const detalles = [];
  const CUANTOS = { 'ABA-MP-PAPEL': 2, 'ABA-MP-REFRESCO': 2, 'ABA-MP-CERVEZA': 2, 'ABA-MP-AGUA': 2 };
  for (const [pn, , , , [, factor, costoPres]] of PRESENTACIONES) {
    const f = porPn[pn];
    detalles.push({ product_id: f.id, quantity: CUANTOS[pn] ?? 1, unit_price: costoPres, presentation_id: f.presentation_id,
      profit_percent: Math.round((f.price / ((costoPres / factor) * 1.16) - 1) * 10000) / 100 });
  }
  for (const [pn, , , , , factor, costoPres, suelto] of ABARROTES.filter((r) => r[0] === 'ABA-PAPEL6-ROLLO')) {
    const f = porPn[`${pn}-PAQ`];
    detalles.push({ product_id: f.id, quantity: 1, unit_price: costoPres, presentation_id: f.presentation_id,
      profit_percent: Math.round((f.price / ((costoPres / factor) * 1.16) - 1) * 10000) / 100 });
    void suelto;
  }
  const subtotal = detalles.reduce((a, d) => a + d.quantity * d.unit_price, 0);
  const compra = await app.invocar('registerPurchase', { user_id: yo, supplier_id: porPn['ABA-MP-PAPEL'].supplier_id, tax_rate: 0.16,
    tax_amount: Math.round(subtotal * 16) / 100, subtotal, total: Math.round(subtotal * 116) / 100, payment_method: 'CREDITO', register_id: 1,
    apply_payment_id: null, socio_pago_id: null, detalles });
  expect(compra?.success, JSON.stringify(compra)).toBeTruthy();

  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  await letrero('Ya se compraron por bulto y caja: 96 rollos de papel, 48 latas, 360 huevos…');

  const buscar = async (texto) => {
    await p.locator('.modal-productos').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await p.getByRole('button', { name: /Agregar producto/ }).click();
    await pausa(600);
    const b = p.locator('[data-guide=venta-buscar]');
    await b.fill('');
    await b.pressSequentially(texto, { delay: 70 });
    await pausa(1100);
  };
  const paquete = async (texto, pn, nombre) => {
    await buscar(texto);
    const k = p.locator(`.modal-productos [data-guide=venta-paquete][data-guide-clave="${pn}|${nombre}"]`);
    await k.hover();
    await pausa(700);
    await k.click();
    await pausa(900);
  };

  await letrero('Un solo producto, «Papel higiénico rollo doble hoja», con 4 paquetes que se venden enteros');
  await buscar('papel higienico rollo doble');
  await pausa(2200);
  await letrero('El rollo suelto a $10 · 2 rollos');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-MP-PAPEL"]').click();
  const rollo = p.locator(`[data-guide=venta-linea][data-guide-clave="${porPn['ABA-MP-PAPEL'].id}"]`).first();
  await rollo.locator('input[type=number]').first().fill('2');
  await rollo.locator('input[type=number]').first().press('Tab');
  await pausa();
  for (const [n, precio] of [['Paquete 4', 36], ['Paquete 6', 52], ['Paquete 12', 98], ['Paquete 18', 150]]) {
    await letrero(`${n} a $${precio}: entran sus ${n.split(' ')[1]} rollos en un renglón`);
    await paquete('papel higienico doble', 'ABA-MP-PAPEL', n);
  }
  await letrero('Huevo: la docena a $40 y la reja de 30 a $95');
  await paquete('huevo rojo', 'ABA-MP-HUEVO', 'Docena');
  await paquete('huevo rojo reja', 'ABA-MP-HUEVO', 'Reja 30');
  await letrero('Refresco de lata: el six a $90');
  await paquete('refresco lata six', 'ABA-MP-REFRESCO', 'Six 6');
  await letrero('Papel jumbo de venta suelta (paquete de 6): un rollo suelto a $12…');
  await buscar('papel higienico jumbo');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-PAPEL6-ROLLO"]').click();
  await pausa();
  await letrero('…y un paquete jumbo de 6 entero a $58');
  await buscar('papel higienico jumbo paquete');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-PAPEL6-ROLLO-PAQ"]').click();
  await pausa();

  await letrero('La cuenta: 10 renglones, $651. Cada paquete cobra su precio entero');
  await p.mouse.wheel(0, 400);
  await pausa(2500);
  await p.mouse.wheel(0, -400);
  await pausa(1200);

  await letrero('Cobrar: «Dinero recibido» ya trae el total; el cliente paga con $700');
  await p.locator('[data-guide=venta-cobrar]').click();
  await pausa(2000);
  const recibido = p.locator('[data-guide=venta-recibido]');
  await recibido.click();
  await pausa(600);
  await recibido.pressSequentially('700', { delay: 150 });
  await pausa(2000);
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(() => stock('ABA-MP-PAPEL'), { timeout: 30000 }).toBe(54);
  await pausa(1500);
  for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('.swal2-confirm')]) {
    try { await b.click({ timeout: 2000 }); } catch { /* no está */ }
  }

  await letrero(`Inventario: papel ${await stock('ABA-MP-PAPEL')} rollos (96 − 42), huevo ${await stock('ABA-MP-HUEVO')} (360 − 42), refresco ${await stock('ABA-MP-REFRESCO')} (48 − 6)`);
  await pausa(2500);
  await letrero(`Jumbo: quedan ${await stock('ABA-PAPEL6-ROLLO-PAQ')} paquetes cerrados y ${await stock('ABA-PAPEL6-ROLLO')} rollos sueltos del paquete que se abrió`);
  await pausa(2500);
  await letrero('La siguiente venta empieza en Efectivo');
  await buscar('chocolate con leche barra');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-CHOC-BARRA"]').click();
  await pausa(900);
  await p.keyboard.press('F8');
  await pausa(3500);
});
