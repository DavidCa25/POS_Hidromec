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
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

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

/**
 * Los diálogos de captura ya no son avisos del sistema: son modales de Wybix
 * con `wx-select` dentro. Eso cambia cómo se conducen, y aquí está el cómo en
 * un solo sitio en vez de repetido por toda la prueba.
 */

/** Espera a que el modal con ese título esté delante. */
async function modal(ventana, titulo) {
  await expect.poll(async () => {
    try { return await ventana.locator('.srv-modal .modal-title').innerText(); } catch { return ''; }
  }, { timeout: 20000, message: `no apareció el modal «${titulo}»` }).toContain(titulo);
}

/**
 * Elige una opción en un `wx-select`.
 *
 * Se abre por su etiqueta —el `<label for>` que ahora existe— y se elige por
 * el texto de la opción. No hay `selectOption` que valga: no es un `<select>`
 * del sistema, y ese es justamente el cambio.
 */
async function elegir(ventana, id, texto) {
  await ventana.click(`#${id} .wx-sel__campo`);
  const opcion = ventana.locator('.wx-pop [role="option"]', { hasText: texto }).first();
  await opcion.waitFor({ state: 'visible', timeout: 15000 });
  await opcion.click();
}

/** Cierra el modal que está delante con su botón principal. */
async function confirmar(ventana, texto) {
  await ventana.click(`.srv-modal .btn-primary:has-text("${texto}")`);
  await expect.poll(async () =>
    ventana.locator('.srv-modal').count(), { timeout: 20000 }).toBe(0);
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
    await irPorDock(ventana, 'Servicios', 'Ordenes');
    await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
    await ventana.click('button:has-text("Nueva orden")');

    /* TODO en una sola pantalla: cliente, sobre qué se trabaja y qué reporta.
       Antes eran cuatro avisos encadenados y no se podía volver atrás. */
    await modal(ventana, 'Recibir trabajo');
    await elegir(ventana, 'srv-cliente', 'Cliente Ciclo');
    await elegir(ventana, 'srv-activo-n', 'Registrar');
    await ventana.fill('#srv-an-label', 'Jetta 2018 gris');
    await ventana.fill('#srv-an-id', 'CIC-123-A');
    await ventana.fill('#srv-reportado', 'Hace un ruido al frenar');
    await confirmar(ventana, 'Abrir orden');

    await ventana.waitForSelector('.os-lineas', { timeout: 30000 });

    /* El coche está en la cabecera: eso es lo que faltaba antes. */
    const cabecera = await ventana.locator('.os-cab').innerText();
    expect(cabecera).toContain('Jetta 2018 gris');
    expect(cabecera).toContain('CIC-123-A');

    const folio = (cabecera.match(/OS-\d{6}/) || [])[0];
    expect(folio, 'la orden tiene folio').toBeTruthy();

    // ---------------------------------------------------------- se cotiza
    await ventana.click('button:has-text("+ Servicio")');
    /* Un modal, no tres avisos: el servicio, la cantidad y quién lo hace en la
       misma pantalla, con el importe calculándose mientras se escribe. */
    await modal(ventana, 'Añadir trabajo');
    await elegir(ventana, 'srv-prod', 'Afinación ciclo');
    await ventana.fill('#srv-cant', '1');
    /* El importe en vivo: es lo que antes no se veía hasta después de guardar. */
    await expect(ventana.locator('.srv-importe')).toContainText('800');
    await confirmar(ventana, 'Añadir a la orden');

    /* Se mira el TOTAL, no el numero de filas: la fila de «todavia no hay nada
       cotizado» tambien es un <tr>, y contarla daba verde con la orden vacia. */
    await expect.poll(async () => ventana.locator('.os-t tbody tr:not(.os-sin-lineas)').count(),
      { timeout: 15000, message: 'la linea no se anadio' }).toBe(1);
    await expect.poll(async () => ventana.locator('.os-resumen').innerText(),
      { timeout: 10000 }).toContain('800');

    // ------------------------------------------------------- el cliente aprueba
    await ventana.click('button:has-text("Registrar autorización")');
    await modal(ventana, 'Registrar autorización');
    await confirmar(ventana, 'Registrar');

    /* Y el botón se va: verlo debajo de una orden ya autorizada invita a
       autorizar dos veces la misma cosa. */
    await expect(ventana.locator('.os-rail-acc button:has-text("Registrar autorización")'))
      .toHaveCount(0);

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

    await irPorDock(ventana, 'Servicios', 'Ordenes');
    await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
    /* «POR COBRAR» YA NO LA TIENE, Y ESO ES EL ARREGLO.
       Esta orden se acaba de cobrar. Antes seguía apareciendo ahí porque el
       tablero filtraba sólo por el estado operativo —TERMINADA— e ignoraba el
       económico. Ahora «Por cobrar» son las terminadas SIN venta, y lo cobrado
       y sin entregar vive en «Por entregar», que es lo que de verdad le falta. */
    await ventana.click('.srv-tab:has-text("Por cobrar")');
    await ventana.waitForTimeout(800);
    await expect(ventana.locator(`tr:has-text("${folio}")`),
      'una orden cobrada no puede seguir en «Por cobrar»').toHaveCount(0);

    await ventana.click('.srv-tab:has-text("Por entregar")');
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
