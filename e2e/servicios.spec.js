/**
 * SERVICIOS DE PUNTA A PUNTA.
 *
 *     npm run e2e:servicios
 *
 * Electron arrancado contra `Wybix_E2E_Servicios`, con el módulo encendido.
 * Lo que se comprueba aquí no se puede comprobar leyendo el fuente ni con SQL
 * a secas: que la cadena entera —renderer, preload, proceso principal,
 * autorización, capacidad y base— se comporta como se prometió.
 *
 * En particular, las dos cosas que sólo se ven con todo en marcha:
 *
 *   - un Operador puede abrir una orden pero NO cambiar el catálogo, y eso lo
 *     decide el proceso principal, no la pantalla;
 *   - con el módulo APAGADO, nadie puede operar servicios, ni siquiera el
 *     Administrador. Capacidad y permiso son dos preguntas distintas.
 */
const { test, expect, CUENTAS } = require('./fixtures');

async function entrar(app, cuenta) {
  const { ventana } = app;
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');

  let acceso = null;
  await expect.poll(async () => {
    try {
      const r = await app.invocar('sesion');
      acceso = r?.data ?? null;
      return acceso?.usuario ?? null;
    } catch { return null; }
  }, { timeout: 30000, message: `no se abrio la sesion de ${cuenta.usuario}` })
    .toBe(cuenta.usuario);

  return acceso;
}

/** Deja un cliente y un servicio listos, y devuelve sus identificadores. */
async function prepararCatalogo(app) {
  const clientes = await app.invocar('getCustomers');
  let clienteId = (clientes?.data ?? clientes ?? [])[0]?.id;
  if (!clienteId) {
    const nuevo = await app.invocar('createCustomer',
      'E2E-1', 'Cliente E2E', null, null, '3330000001', 0, 0, 1, null, null, null, 0, 0, 0, 0);
    expect(nuevo.success, JSON.stringify(nuevo)).toBeTruthy();
    const otra = await app.invocar('getCustomers');
    clienteId = (otra?.data ?? otra ?? [])[0]?.id;
  }
  expect(clienteId).toBeTruthy();

  const cat = await app.invocar('serviciosCatalogo', {});
  let servicio = (cat.data ?? [])[0];
  if (!servicio) {
    const alta = await app.invocar('serviciosGuardarServicio', {
      nombre: 'Afinación E2E', precio: 900, duracionMinutos: 60, comisionPct: 10,
    });
    expect(alta.success, JSON.stringify(alta)).toBeTruthy();
    servicio = alta.data[0];
  }
  return { clienteId, servicioId: servicio.product_id };
}

test.describe('Servicios, con la aplicacion en marcha', () => {

  test('el modulo esta encendido en esta base', async ({ appServicios: app }) => {
    await entrar(app, CUENTAS.admin);
    const mods = await app.invocar('modulosLista');
    expect(mods.success).toBeTruthy();
    const activos = new Set(mods.data.filter((m) => m.enabled).map((m) => m.module_key));
    expect(activos.has('servicios')).toBe(true);
  });

  test('un servicio nace siendo un producto', async ({ appServicios: app }) => {
    await entrar(app, CUENTAS.admin);

    const alta = await app.invocar('serviciosGuardarServicio', {
      nombre: 'Lavado E2E', precio: 250, duracionMinutos: 30, comisionPct: 5,
    });
    expect(alta.success, JSON.stringify(alta)).toBeTruthy();
    const productId = alta.data[0].product_id;

    /* Y aparece en el catálogo de VENTA, que es lo que se gana al no inventar
       una tabla aparte: se cobra, se factura y se reporta como todo lo demás. */
    const productos = await app.invocar('getActiveProducts');
    const lista = productos?.data ?? productos ?? [];
    expect(lista.some((p) => p.id === productId)).toBe(true);
  });

  test('el Operador abre ordenes pero no toca el catalogo', async ({ appServicios: app }) => {
    const admin = await entrar(app, CUENTAS.admin);
    expect(admin.permisos).toContain('SERVICIOS_ADMINISTRAR');
    const { clienteId } = await prepararCatalogo(app);

    /* Ahora entra el Operador en la misma ventana. */
    const op = await app.invocar('iniciarSesion', CUENTAS.operador.usuario, CUENTAS.operador.password);
    expect(op.success).toBeTruthy();
    expect(op.data.acceso.permisos).toContain('SERVICIOS_OPERAR');
    expect(op.data.acceso.permisos).not.toContain('SERVICIOS_ADMINISTRAR');

    const orden = await app.invocar('serviciosOrdenCrear', {
      clienteId, reportado: 'Hace un ruido al frenar',
    });
    expect(orden.success, JSON.stringify(orden)).toBeTruthy();

    /* Y el catálogo, no. Invocado a mano, como lo haría alguien con la consola
       abierta: lo que responde es el proceso principal, no la pantalla. */
    const catalogo = await app.invocar('serviciosGuardarServicio', { nombre: 'Colado', precio: 1 });
    expect(catalogo.success).toBeFalsy();
    expect(catalogo.motivo).toBe('SIN_PERMISO');

    const profesional = await app.invocar('serviciosGuardarProfesional', { nombre: 'Colado' });
    expect(profesional.success).toBeFalsy();
    expect(profesional.motivo).toBe('SIN_PERMISO');
  });

  test('la orden congela el precio y la autorizacion es de una version', async ({ appServicios: app }) => {
    await entrar(app, CUENTAS.admin);
    const { clienteId, servicioId } = await prepararCatalogo(app);

    const creada = await app.invocar('serviciosOrdenCrear', { clienteId, reportado: 'Revisión' });
    expect(creada.success).toBeTruthy();
    const ordenId = creada.sets[0][0].id;

    const conLinea = await app.invocar('serviciosLineaAgregar', {
      ordenId, productoId: servicioId, cantidad: 1,
    });
    expect(conLinea.success, JSON.stringify(conLinea)).toBeTruthy();
    const precioCotizado = conLinea.sets[1][0].unit_price_snapshot;
    expect(Number(precioCotizado)).toBeGreaterThan(0);

    /* El cliente aprueba. */
    const aut = await app.invocar('serviciosOrdenAutorizar', {
      id: ordenId, autorizaNombre: 'Cliente E2E', via: 'TELEFONO',
    });
    expect(aut.success).toBeTruthy();
    expect(aut.sets[0][0].needs_reauthorization).toBeFalsy();

    /* Sube el precio del catálogo: lo cotizado NO se mueve. */
    const subida = await app.invocar('serviciosGuardarServicio', {
      productId: servicioId, nombre: 'Afinación E2E', precio: 9999,
    });
    expect(subida.success).toBeTruthy();

    const relectura = await app.invocar('serviciosOrden', { id: ordenId });
    const linea = relectura.sets[1][0];
    expect(Number(linea.unit_price_snapshot)).toBe(Number(precioCotizado));
    expect(Number(linea.current_price)).toBe(9999);

    /* Añadir trabajo invalida lo que el cliente aprobó. */
    const mas = await app.invocar('serviciosLineaAgregar', {
      ordenId, productoId: servicioId, cantidad: 1,
    });
    expect(mas.success).toBeTruthy();
    expect(mas.sets[0][0].needs_reauthorization).toBeTruthy();
  });

  test('dos ventanas sobre la misma orden no se pisan', async ({ appServicios: app }) => {
    await entrar(app, CUENTAS.admin);
    const { clienteId } = await prepararCatalogo(app);

    const creada = await app.invocar('serviciosOrdenCrear', { clienteId, reportado: 'Ruido' });
    const cab = creada.sets[0][0];

    /* Quien guarda con el testigo que leyó al abrir, guarda. */
    const primera = await app.invocar('serviciosOrdenActualizar', {
      id: cab.id, diagnostico: 'Balatas gastadas', rowver: cab.rowver,
    });
    expect(primera.success, JSON.stringify(primera)).toBeTruthy();

    /* Quien guarda con el testigo VIEJO, no: su escritura habría borrado la
       otra sin que nadie se enterara. */
    const segunda = await app.invocar('serviciosOrdenActualizar', {
      id: cab.id, diagnostico: 'Otra cosa', rowver: cab.rowver,
    });
    expect(segunda.success).toBeFalsy();
    expect(segunda.motivo).toBe('CONFLICTO_DE_VERSION');
    expect(String(segunda.error)).toContain('mientras');

    const final = await app.invocar('serviciosOrden', { id: cab.id });
    expect(final.sets[0][0].diagnosis).toBe('Balatas gastadas');
  });

  test('la agenda no promete dos cosas a la vez', async ({ appServicios: app }) => {
    await entrar(app, CUENTAS.admin);
    const { clienteId, servicioId } = await prepararCatalogo(app);

    const prof = await app.invocar('serviciosGuardarProfesional', {
      nombre: 'Agenda E2E', comisionPct: 10,
    });
    expect(prof.success, JSON.stringify(prof)).toBeTruthy();
    const profesionalId = prof.data[0].id;

    /* Un servicio con duración conocida, y no el primero que haya en el
       catálogo: con uno de 30 minutos, las 10:00 y las 10:30 son citas
       consecutivas y NO se enciman. Dejar que la duración dependa del orden
       del catálogo habría hecho que esta prueba pasara o fallara según qué
       otra prueba corriera antes. */
    const svc = await app.invocar('serviciosGuardarServicio', {
      nombre: 'Servicio de una hora E2E', precio: 500, duracionMinutos: 60,
    });
    expect(svc.success, JSON.stringify(svc)).toBeTruthy();
    const deUnaHora = svc.data[0].product_id;

    const uno = await app.invocar('serviciosCitaGuardar', {
      clienteId, servicioId: deUnaHora, profesionalId, desde: '2027-03-08T10:00:00',
    });
    expect(uno.success, JSON.stringify(uno)).toBeTruthy();
    /* 10:00 + 60 min = 11:00. La siguiente a las 10:30 cae dentro. */

    const choque = await app.invocar('serviciosCitaGuardar', {
      clienteId, servicioId: deUnaHora, profesionalId, desde: '2027-03-08T10:30:00',
    });
    expect(choque.success).toBeFalsy();
    expect(String(choque.error)).toMatch(/ya hay una cita/i);

    /* Y una consecutiva NO es un choque: a las 11:00 en punto cabe. */
    const pegada = await app.invocar('serviciosCitaGuardar', {
      clienteId, servicioId: deUnaHora, profesionalId, desde: '2027-03-08T11:00:00',
    });
    expect(pegada.success, JSON.stringify(pegada)).toBeTruthy();

    /* Forzarlo se puede, y queda dicho: hay negocios que sobreagendan a
       propósito. Lo que no puede es pasar en silencio. */
    const forzada = await app.invocar('serviciosCitaGuardar', {
      clienteId, servicioId: deUnaHora, profesionalId, desde: '2027-03-08T10:30:00',
      permitirEncimar: true,
    });
    expect(forzada.success).toBeTruthy();
    expect(String(forzada.data[0].notes)).toMatch(/Encimada/);

    /* El cliente llega: la cita se convierte en orden y queda atendida. */
    const citaId = uno.data[0].id;
    const orden = await app.invocar('serviciosCitaAOrden', { id: citaId });
    expect(orden.success, JSON.stringify(orden)).toBeTruthy();
    expect(Number(orden.sets[0][0].total)).toBeGreaterThan(0);

    const cita = await app.invocar('serviciosCita', { id: citaId });
    expect(cita.data[0].status).toBe('ATENDIDA');
    expect(cita.data[0].service_order_id).toBe(orden.sets[0][0].id);
  });

  test('las comisiones las ve quien ve los numeros del negocio', async ({ appServicios: app }) => {
    await entrar(app, CUENTAS.operador);
    const negado = await app.invocar('serviciosComisiones', { desde: '2020-01-01', hasta: '2030-01-01' });
    expect(negado.success).toBeFalsy();
    expect(negado.motivo).toBe('SIN_PERMISO');

    await app.invocar('iniciarSesion', CUENTAS.encargado.usuario, CUENTAS.encargado.password);
    const permitido = await app.invocar('serviciosComisiones', { desde: '2020-01-01', hasta: '2030-01-01' });
    expect(permitido.success, JSON.stringify(permitido)).toBeTruthy();
  });
});

test.describe('Con el modulo APAGADO', () => {

  test('ni el Administrador puede operar servicios', async ({ app }) => {
    /* Esta prueba corre contra `Wybix_E2E_Core`, donde Servicios está apagado.
       Es la única forma de comprobar que capacidad y permiso son dos preguntas
       distintas: aquí el permiso sobra y sigue sin poder. */
    const acceso = await entrar(app, CUENTAS.admin);
    expect(acceso.permisos).toContain('SERVICIOS_ADMINISTRAR');

    const mods = await app.invocar('modulosLista');
    const activos = new Set(mods.data.filter((m) => m.enabled).map((m) => m.module_key));
    expect(activos.has('servicios')).toBe(false);

    const intento = await app.invocar('serviciosGuardarServicio', { nombre: 'Colado', precio: 1 });
    expect(intento.success).toBeFalsy();
    expect(intento.motivo).toBe('MODULO_APAGADO');

    const orden = await app.invocar('serviciosOrdenCrear', { clienteId: 1 });
    expect(orden.success).toBeFalsy();
    expect(orden.motivo).toBe('MODULO_APAGADO');

    /* Las lecturas siguen abiertas: un catálogo vacío no es un error, y la
       pantalla de Aplicaciones necesita poder preguntar. */
    const catalogo = await app.invocar('serviciosCatalogo', {});
    expect(catalogo.success).toBeTruthy();
  });
});
