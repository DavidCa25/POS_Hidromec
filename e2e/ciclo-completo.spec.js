/**
 * EL CICLO COMPLETO, PULSANDO BOTONES.
 *
 *     npx playwright test e2e/ciclo-completo.spec.js
 *
 * Entra el coche, se abre la orden, se cotiza, el cliente autoriza, se trabaja,
 * se cobra y se entrega. Todo por la interfaz: nada de invocar canales a mano.
 *
 * POR QUÉ ESTA PRUEBA EXISTE
 * --------------------------
 * Las demás llaman al IPC directamente, y por eso daban verde mientras el
 * botón «Cobrar» llevaba a una venta vacía: el procedimiento funcionaba, el
 * canal funcionaba, y el cable entre la pantalla de la orden y la de venta no
 * estaba puesto. Una suite que no pulsa botones no puede ver eso.
 *
 * Aquí se pulsa. Si alguien vuelve a desconectar el cobro, esto falla.
 */
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

/**
 * Un paso del asistente: espera SU diálogo, lo rellena y lo pasa.
 *
 * Se espera por el TÍTULO y no por que el popup desaparezca. SweetAlert
 * reutiliza el mismo contenedor entre diálogos encadenados, así que cuando uno
 * cierra y el siguiente abre, `.swal2-popup` nunca llega a estar oculto: una
 * espera por `hidden` se queda colgada para siempre. Ya pasó.
 */
async function paso(ventana, { titulo, campos = {}, elegir, accion = 'confirmar' }) {
  await expect.poll(async () => {
    try { return await ventana.locator('.swal2-title').innerText(); } catch { return ''; }
  }, { timeout: 20000, message: `no apareció el diálogo «${titulo}»` })
    .toContain(titulo);

  if (elegir !== undefined) {
    await ventana.selectOption('.swal2-popup select', elegir);
  }
  for (const [selector, texto] of Object.entries(campos)) {
    await ventana.fill(selector, texto);
  }

  const boton = { confirmar: '.swal2-confirm', cancelar: '.swal2-cancel', negar: '.swal2-deny' }[accion];
  await ventana.click(boton);

  /* Se espera a que ESTE diálogo deje de estar: o desaparece del todo, o le
     sustituye otro con otro título. Las dos cosas valen. */
  await expect.poll(async () => {
    if (!(await ventana.locator('.swal2-popup').isVisible().catch(() => false))) return 'cerrado';
    try { return await ventana.locator('.swal2-title').innerText(); } catch { return 'cerrado'; }
  }, { timeout: 20000, message: `el diálogo «${titulo}» no avanzó` })
    .not.toContain(titulo);
}

/** Un diálogo que puede o no aparecer. Si está, se pasa; si no, se sigue. */
async function pasoSiAparece(ventana, titulo) {
  const visible = await ventana.locator('.swal2-title')
    .innerText().catch(() => '');
  if (!visible.includes(titulo)) return false;
  await ventana.click('.swal2-cancel');
  await expect.poll(async () => {
    if (!(await ventana.locator('.swal2-popup').isVisible().catch(() => false))) return 'cerrado';
    try { return await ventana.locator('.swal2-title').innerText(); } catch { return 'cerrado'; }
  }, { timeout: 15000 }).not.toContain(titulo);
  return true;
}

test.describe('De la recepción a la entrega', () => {

  test('el coche entra, se cotiza, se autoriza, se cobra y se entrega',
    async ({ appServicios: app }) => {
    const { ventana } = app;
    ventana.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 200)));
    await entrar(app, CUENTAS.admin);

    // ---------------------------------------------------- lo que hace falta
    await app.invocar('createCustomer', 'CIC-1', 'Cliente Ciclo', null, null,
      '3339998877', 0, 0, 1, null, null, null, 0, 0, 0, 0);
    const clientes = await app.invocar('getCustomers');
    const cliente = (clientes.data ?? []).find((c) => c.customerName === 'Cliente Ciclo');
    expect(cliente, 'el cliente de la prueba existe').toBeTruthy();

    const svc = await app.invocar('serviciosGuardarServicio', {
      nombre: 'Afinación ciclo', precio: 800, duracionMinutos: 60,
    });
    expect(svc.success, JSON.stringify(svc)).toBeTruthy();
    const servicioId = String(svc.data[0].product_id);

    /* Un turno abierto: cobrar lo exige, y es correcto que lo exija.
       Se intenta abrirlo y «ya existe» cuenta como éxito. Preguntar primero y
       abrir después es una carrera —otra prueba de la misma corrida pudo
       abrirlo en medio— y además obliga a acertar la forma exacta de la
       respuesta de `getOpenShift`, que no es la misma que la de los demás. */
    const userId = (await app.invocar('sesion')).data.userId;
    const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
    const hayTurno = abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? ''));
    expect(hayTurno, `no hay turno para cobrar: ${JSON.stringify(abierto)}`).toBeTruthy();

    // ============================================================ la orden
    await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
    await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
    await ventana.click('button:has-text("Nueva orden")');

    await paso(ventana, { titulo: 'Nueva orden', elegir: { label: 'Cliente Ciclo' } });

    /* Sobre qué se trabaja. El cliente es nuevo y no tiene nada registrado:
       se registra aquí mismo, sin salir de la orden. */
    await paso(ventana, { titulo: 'Sobre qué se trabaja', elegir: '__nuevo__' });
    await paso(ventana, {
      titulo: 'Registrar',
      campos: { '#ac-label': 'Jetta 2018 gris', '#ac-id': 'CIC-123-A' },
    });

    await paso(ventana, {
      titulo: 'dijo el cliente',
      campos: { '.swal2-textarea': 'Hace un ruido al frenar' },
    });

    await ventana.waitForSelector('.os-lineas', { timeout: 30000 });

    /* El coche está en la cabecera: eso es lo que faltaba antes. */
    const cabecera = await ventana.locator('.os-cab').innerText();
    expect(cabecera).toContain('Jetta 2018 gris');
    expect(cabecera).toContain('CIC-123-A');

    const folio = (cabecera.match(/OS-\d{6}/) || [])[0];
    expect(folio, 'la orden tiene folio').toBeTruthy();

    // ---------------------------------------------------------- se cotiza
    await ventana.click('button:has-text("+ Servicio")');
    /* Por identificador y no por nombre: con varias pruebas sembrando el mismo
       catalogo, el nombre deja de ser unico y se elige otro servicio. */
    await paso(ventana, { titulo: 'Añadir servicio', elegir: servicioId });
    await paso(ventana, { titulo: 'Cantidad', campos: { '.swal2-input[type="number"]': '1' } });

    /* «¿Quién lo hace?» sólo aparece si hay profesionales dados de alta, y eso
       depende de qué otras pruebas corrieron antes sobre la misma base. Se
       responde si está —sin asignar a nadie— y si no, se sigue. */
    await pasoSiAparece(ventana, 'Quién lo hace');

    /* Se mira el TOTAL, no el numero de filas: la fila de «todavia no hay nada
       cotizado» tambien es un <tr>, y contarla daba verde con la orden vacia. */
    await expect.poll(async () => ventana.locator('.os-t tbody tr:not(.os-sin-lineas)').count(),
      { timeout: 15000, message: 'la linea no se anadio' }).toBe(1);
    await expect.poll(async () => ventana.locator('.os-resumen').innerText(),
      { timeout: 10000 }).toContain('800');

    // ------------------------------------------------------- el cliente aprueba
    await ventana.click('button:has-text("Registrar autorización")');
    await paso(ventana, { titulo: 'Registrar autorización' });

    await expect.poll(async () =>
      (await ventana.locator('.os-cab').innerText()).includes('Sin autorizar'),
      { timeout: 15000 }).toBe(false);

    // ============================================================ se cobra
    await ventana.click('.os-rail-acc button:has-text("Cobrar")');

    /* Aquí es donde estaba el agujero: antes se llegaba a una venta vacía. */
    await ventana.waitForSelector('.venta-orden-servicio', { timeout: 30000 });
    const franja = await ventana.locator('.venta-orden-servicio').innerText();
    expect(franja, 'la venta dice qué orden está cobrando').toContain(folio);

    /* Y el carrito trae la partida, al precio congelado. */
    const carrito = await ventana.locator('.venta-card').innerText();
    expect(carrito).toContain('Afinación ciclo');
    expect(carrito).toContain('800');

    // ------------------------------------------------- se cobra de verdad
    /* Se cuenta ANTES: la base puede traer ventas de otras pruebas, y
       «hay más de cero ventas» habría dado verde aunque ésta no se registrara.
       Fue exactamente el error que tuvo esta prueba en su primera versión. */
    const ventasAntes = ((await app.invocar('getSales')).data ?? []).length;

    await ventana.click('.pos-footer-actions button:has-text("Cobrar")');
    await ventana.waitForSelector('.modal-cobro', { state: 'visible', timeout: 20000 });

    await ventana.fill('.modal-cobro input[name="dineroRecibido"]', '1000');
    await ventana.click('.modal-cobro button.btn-cobrar');

    await expect.poll(async () => ((await app.invocar('getSales')).data ?? []).length,
      { timeout: 30000, message: 'la venta no se registró' })
      .toBe(ventasAntes + 1);

    // =========================================== LA ORDEN QUEDÓ ENLAZADA
    /* Esto es lo que no existía: el botón cobraba y la orden se quedaba
       suelta, pareciendo impagada para siempre.

       Se espera, no se mira una vez: registrar la venta y atarla son dos
       llamadas, y entre una y otra el botón todavía dice «Cobrando…». Leerlo
       de golpe daba un falso rojo. */
    const buscarOrden = async () => {
      const r = await app.invocar('serviciosOrdenes', { estados: [] });
      return (r.data ?? []).find((o) => o.folio === folio) ?? null;
    };

    await expect.poll(async () => (await buscarOrden())?.sale_id ?? null,
      { timeout: 30000, message: `${folio} no quedó atada a su venta` })
      .toBeTruthy();

    const mia = await buscarOrden();
    expect(mia.economic_status).toBe('PAGADA');
    expect(mia.status).toBe('TERMINADA');

    // ============================================================ se entrega
    await ventana.goto(await ventana.evaluate(() =>
      window.location.href.split('/browser/')[0] + '/browser/index.html'));
    await ventana.waitForSelector('#username', { timeout: 60000 });
    await entrar(app, CUENTAS.admin);

    await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
    await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
    await ventana.click('button:has-text("Por cobrar"), .srv-tab:has-text("Por cobrar")');
    await ventana.waitForTimeout(800);
    await ventana.click(`tr:has-text("${folio}")`);

    await ventana.waitForSelector('.os-lineas', { timeout: 30000 });
    await ventana.click('button:has-text("Entregar")');

    await expect.poll(async () => {
      const r = await app.invocar('serviciosOrdenes', { estados: [] });
      return (r.data ?? []).find((o) => o.folio === folio)?.status ?? null;
    }, { timeout: 20000, message: 'la orden no llegó a ENTREGADA' }).toBe('ENTREGADA');
  });
});
