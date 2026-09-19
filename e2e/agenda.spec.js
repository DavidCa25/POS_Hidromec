/**
 * LA AGENDA, MIRADA DE VERDAD.
 *
 *     npx playwright test e2e/agenda.spec.js
 *
 * Siembra un día realista —tres personas, horarios, citas y una ausencia—,
 * elige un color de negocio y comprueba que la pantalla se dibuja como se
 * prometió: una columna por persona, los bloques colocados donde toca y el
 * color del cliente en la cabecera.
 *
 * POR QUÉ ESTO NO SE PUEDE COMPROBAR LEYENDO EL FUENTE
 * ----------------------------------------------------
 * Que una regla CSS diga `var(--inv-main, …)` no significa que se pinte: la
 * variable puede no existir, otra regla puede ganarle, o el bloque puede
 * quedar fuera de la ventana horaria y no verse. Aquí se lee el color que el
 * navegador calculó y la posición que el navegador dio.
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

/** El lunes de la semana que viene: un día estable, sin depender de hoy. */
function proximoLunes() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Lleva la agenda a un dia concreto pulsando la flecha de "dia siguiente".
 *
 * Antes se escribia la fecha en un `input[type=date]`. Ese control ya no
 * existe: la agenda usa `wx-date`, el calendario de Wybix, como el resto de
 * la aplicacion. Se conduce como lo conduce una persona -avanzando dias- en
 * vez de buscarle un hueco donde escribir, que seria conducir el control y no
 * la pantalla.
 */
async function irAlDia(ventana, destino) {
  const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
  const fin = new Date(destino + 'T12:00:00');
  const dias = Math.round((fin - hoy) / 86400000);
  for (let i = 0; i < dias; i++) {
    await ventana.click('button[aria-label="Día siguiente"]');
  }
  await ventana.waitForTimeout(600);
}

test.describe('Agenda', () => {

  test('columnas por persona, con el color del negocio', async ({ appServicios: app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    const dia = proximoLunes();
    const lunes = 2;   // DATEPART(WEEKDAY): 1 = domingo

    // ------------------------------------------------- el día, sembrado
    const cliente = await app.invocar('getCustomers');
    let clienteId = (cliente?.data ?? cliente ?? [])[0]?.id;
    if (!clienteId) {
      await app.invocar('createCustomer', 'AG-1', 'Cliente Agenda', null, null,
        '3331112233', 0, 0, 1, null, null, null, 0, 0, 0, 0);
      clienteId = (await app.invocar('getCustomers')).data[0].id;
    }

    const svc = await app.invocar('serviciosGuardarServicio', {
      nombre: 'Afinación agenda', precio: 900, duracionMinutos: 60,
    });
    expect(svc.success, JSON.stringify(svc)).toBeTruthy();
    const servicioId = svc.data[0].product_id;

    /* Nombres únicos por ejecución. Las pruebas comparten la base, y con
       nombres fijos cada corrida apilaba otro «Luis Agenda»: al pasar de seis
       personas, el tope de columnas dejaba fuera justo a las que la prueba
       buscaba. Una prueba que depende de cuántas veces se ha ejecutado antes
       no prueba nada. */
    const sufijo = Date.now().toString().slice(-5);
    const gente = [];
    for (const [base, color] of [['Luis', '#45B3C3'], ['Ana', '#A16207'], ['Beto', '#157347']]) {
      const nombre = `${base} ${sufijo}`;
      const p = await app.invocar('serviciosGuardarProfesional', { nombre, color, comisionPct: 10 });
      expect(p.success, JSON.stringify(p)).toBeTruthy();
      gente.push({ id: p.data[0].id, nombre });
      await app.invocar('serviciosGuardarHorario', {
        profesionalId: p.data[0].id,
        franjas: [{ weekday: lunes, startsAt: '09:00', endsAt: '18:00' }],
      });
    }

    /* Las dos citas son de la MISMA persona: así se puede filtrar por ella y
       comprobar la colocación sin depender de quién más haya en la base. */
    await app.invocar('serviciosCitaGuardar', {
      clienteId, servicioId, profesionalId: gente[0].id, desde: `${dia}T09:00:00`,
    });
    await app.invocar('serviciosCitaGuardar', {
      clienteId, servicioId, profesionalId: gente[0].id, desde: `${dia}T11:00:00`,
    });
    await app.invocar('serviciosGuardarAusencia', {
      profesionalId: gente[2].id, desde: `${dia}T14:00:00`, hasta: `${dia}T18:00:00`,
      motivo: 'Cita médica',
    });

    // ------------------------------------------- el color que eligió el negocio
    const VERDE = '#1B7F3B';
    await ventana.evaluate((c) => {
      try { localStorage.setItem('inv-main-color', c); } catch { /* sin almacenamiento */ }
    }, VERDE);

    // ------------------------------------------------------------ la pantalla
    /* El tema se aplica al construir su servicio, así que hay que volver a
       arrancar la interfaz. NO con `reload()`: la barra de direcciones lleva
       una ruta de Angular (`…/browser/agenda`), que como archivo no existe.
       Se vuelve al índice, que es el único archivo real. */
    const indice = await ventana.evaluate(() =>
      window.location.href.split('/browser/')[0] + '/browser/index.html');
    await ventana.goto(indice);
    await ventana.waitForSelector('#username', { timeout: 60000 });
    await entrar(app, CUENTAS.admin);

    /* Se navega por la interfaz, no por la URL: así se comprueba de paso que
       la entrada del menú lleva a donde dice. */
    await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
    await ventana.click('a[href$="/agenda"]');
    await ventana.waitForSelector('.ag-rejilla', { timeout: 30000 });

    await irAlDia(ventana, dia);

    // -------------------------------------------- hay una columna por persona
    expect(await ventana.locator('.ag-col').count(), 'la agenda es de columnas')
      .toBeGreaterThanOrEqual(1);

    /* Se filtra por la persona de esta prueba. La base la comparten todas las
       pruebas, y sin filtrar habría que suponer cuánta gente más hay: una
       suposición que el tope de seis columnas rompe en cuanto la base crece. */
    /* El filtro es `wx-select`, no un `<select>` del sistema: se abre y se
       elige, como lo hace una persona. Conducir el control nativo era
       conducir algo que ya no existe en esta pantalla. */
    await ventana.click('.ag-cab wx-select .wx-sel__campo');
    await ventana.locator('.wx-pop [role="option"]', { hasText: gente[0].nombre })
      .first().click();
    await ventana.waitForTimeout(1200);

    const cabeceras = await ventana.locator('.ag-col-nombre').allInnerTexts();
    expect(cabeceras.join(' '), 'la columna es la de esa persona').toContain(gente[0].nombre);

    // ------------------------------------------------------- los bloques existen
    const bloques = ventana.locator('.ag-bloque');
    await expect.poll(async () => bloques.count(), { timeout: 15000 }).toBe(2);

    /* Y están colocados: la de las 11:00 va MÁS ABAJO que la de las 09:00.
       Una agenda donde las nueve y las once caen a la misma altura no es una
       agenda, es una lista. */
    const tops = await bloques.evaluateAll((els) =>
      els.map((e) => ({ top: parseFloat(e.style.top), texto: e.textContent.trim() })));
    const nueve = tops.find((t) => /09:00/.test(t.texto));
    const once = tops.find((t) => /11:00/.test(t.texto));
    expect(nueve, 'la cita de las 09:00 está dibujada').toBeTruthy();
    expect(once, 'la cita de las 11:00 está dibujada').toBeTruthy();
    expect(once.top, 'las 11:00 van por debajo de las 09:00').toBeGreaterThan(nueve.top);

    // ------------------------------------------------------------ la ausencia
    await ventana.click('.ag-cab wx-select .wx-sel__campo');
    await ventana.locator('.wx-pop [role="option"]', { hasText: gente[2].nombre })
      .first().click();
    await ventana.waitForTimeout(1200);
    await expect.poll(async () => ventana.locator('.ag-ausencia').count(),
      { timeout: 15000, message: 'la ausencia no se dibuja' }).toBeGreaterThanOrEqual(1);

    // -------------------------------------------------- el color DEL NEGOCIO
    const fondo = await ventana.locator('.ag-cols').evaluate(
      (el) => getComputedStyle(el).backgroundColor);
    /* #1B7F3B = rgb(27, 127, 59). Si la cabecera saliera en el cian de Wybix
       —rgb(69, 179, 195)— esto fallaría, que es de lo que se trata. */
    expect(fondo.replace(/\s/g, '')).toBe('rgb(27,127,59)');

    const tabla = await ventana.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--inv-main').trim());
    expect(tabla.toLowerCase()).toBe('#1b7f3b');
  });
});

test.describe('Evidencia visual', () => {
  /**
   * Una captura de la agenda con datos y con el color del negocio.
   *
   * No comprueba nada: existe para poder MIRAR el resultado sin arrancar la
   * aplicación a mano. Las comprobaciones de verdad están arriba.
   */
  test('captura de la agenda', async ({ appServicios: app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    await ventana.evaluate(() => {
      try { localStorage.setItem('inv-main-color', '#1B7F3B'); } catch { /* noop */ }
    });
    const indice = await ventana.evaluate(() =>
      window.location.href.split('/browser/')[0] + '/browser/index.html');
    await ventana.goto(indice);
    await ventana.waitForSelector('#username', { timeout: 60000 });
    await entrar(app, CUENTAS.admin);

    await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
    await ventana.click('a[href$="/agenda"]');
    await ventana.waitForSelector('.ag-rejilla', { timeout: 30000 });
    await irAlDia(ventana, proximoLunes());

    await ventana.screenshot({ path: 'test-results/agenda-A.png', fullPage: false });

    await ventana.click('a[href$="/ordenes"]');
    await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
    await ventana.waitForTimeout(600);
    await ventana.screenshot({ path: 'test-results/ordenes.png', fullPage: false });
  });
});
