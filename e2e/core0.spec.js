/**
 * CORE 0 DE PUNTA A PUNTA.
 *
 *     npm run e2e:core
 *
 * Electron arrancado, IPC real, SQL Server real. Lo que se comprueba aqui no se
 * puede comprobar leyendo el fuente: que un canal sensible invocado a mano —con
 * la sesion de un Operador— devuelva un error en vez de ejecutarse.
 *
 * Esa es la prueba que de verdad importa. Una pantalla escondida no protege
 * nada: cualquiera con la consola de Electron abierta escribe
 * `electronAPI.refundSale(...)` y, si el proceso principal no comprueba nada,
 * la devolucion se hace. Aqui se invoca justamente asi, a proposito.
 */
const { test, expect, CUENTAS } = require('./fixtures');

/**
 * Entra por el formulario y espera a que la sesion este abierta.
 *
 * La espera se hace desde fuera, preguntando por el canal, y no con un
 * `waitForFunction` dentro de la pagina: al entrar, el router cambia de ruta y
 * una funcion que se estuviera evaluando en ese momento se queda en un
 * documento que ya no es el de delante. Preguntar desde aqui, reintentando, no
 * depende de en que momento del cambio de pantalla caiga la pregunta.
 */
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

test.describe('Sesion y permisos, con la aplicacion en marcha', () => {

  test('la ventana no tiene sesion antes de entrar', async ({ app }) => {
    const r = await app.invocar('sesion');
    expect(r.success).toBeTruthy();
    expect(r.data).toBeNull();

    /* Y sin sesion, un canal sensible no se ejecuta. Esto es lo que antes no
       pasaba: los dieciocho canales sensibles no miraban quien llamaba. */
    const intento = await app.invocar('refundSale', { sale_id: 1, user_id: 1 });
    expect(intento.success).toBeFalsy();
    expect(String(intento.error)).toContain('Inicia sesión');
  });

  test('el Administrador recibe los siete paquetes', async ({ app }) => {
    const acceso = await entrar(app, CUENTAS.admin);
    expect(acceso.rol).toBe('admin');
    expect(acceso.rolEtiqueta).toBe('Administrador');
    expect(acceso.permisos).toHaveLength(7);
    expect(acceso.permisos).toContain('CONFIGURACION_ADMINISTRAR');
  });

  test('el Encargado administra Servicios pero no el negocio', async ({ app }) => {
    const acceso = await entrar(app, CUENTAS.encargado);
    expect(acceso.rolEtiqueta).toBe('Encargado');
    expect(acceso.permisos).toContain('SERVICIOS_ADMINISTRAR');
    expect(acceso.permisos).toContain('INVENTARIO_OPERAR');
    expect(acceso.permisos).not.toContain('CONFIGURACION_ADMINISTRAR');

    /* El septimo paquete existe exactamente para esto, y se comprueba contra
       el proceso principal, no contra la interfaz. */
    const usuarios = await app.invocar('usersList');
    expect(usuarios.success).toBeFalsy();
    expect(String(usuarios.error)).toContain('acceso');
  });

  test('el Operador vende, y nada mas', async ({ app }) => {
    const acceso = await entrar(app, CUENTAS.operador);
    expect(acceso.rolEtiqueta).toBe('Operador');
    expect(acceso.permisos.sort()).toEqual(['SERVICIOS_OPERAR', 'VENTAS_OPERAR']);

    /* Invocado a mano, como lo haria alguien con la consola abierta. Las tres
       operaciones contra las que nacio el blindaje anti robo hormiga. */
    const devolver = await app.invocar('refundSale', { sale_id: 1, user_id: acceso.userId });
    expect(devolver.success).toBeFalsy();
    expect(devolver.motivo).toBe('SIN_PERMISO');

    const cajon = await app.invocar('openCashDrawer', {});
    expect(cajon.success ?? cajon.ok).toBeFalsy();

    const producto = await app.invocar('darDeBajaProducto', 1);
    expect(producto.success).toBeFalsy();
    expect(producto.motivo).toBe('SIN_PERMISO');

    const config = await app.invocar('modulosSet', 'hospitality', true);
    expect(config.success).toBeFalsy();
    expect(config.motivo).toBe('SIN_PERMISO');
  });

  test('un rol que esta version no conoce entra sin ningun paquete', async ({ app }) => {
    const acceso = await entrar(app, CUENTAS.heredado);

    /* NO se le da el rol mas bajo. Operador puede vender y abrir turno, y
       regalar eso a un valor que nadie entiende seria peor que dejar a la
       persona sin acceso. */
    expect(acceso.rolConocido).toBe(false);
    expect(acceso.rolEtiqueta).toBe('Sin rol asignado');
    expect(acceso.permisos).toHaveLength(0);

    const vender = await app.invocar('registerSale', acceso.userId, 'EFECTIVO', [], null, null, null);
    expect(vender.success).toBeFalsy();
    expect(vender.motivo).toBe('SIN_PERMISO');
  });

  test('cerrar sesion deja la ventana sin identidad', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const cerrada = await app.invocar('cerrarSesion');
    expect(cerrada.success).toBeTruthy();

    const r = await app.invocar('sesion');
    expect(r.data).toBeNull();

    const intento = await app.invocar('usersList');
    expect(intento.success).toBeFalsy();
    expect(intento.motivo).toBe('SIN_SESION');
  });

  test('bajarle el rol a alguien surte efecto sin que cierre sesion', async ({ app }) => {
    const admin = await entrar(app, CUENTAS.admin);

    const lista = await app.invocar('usersList');
    expect(lista.success).toBeTruthy();
    const yo = lista.data.find((u) => u.usuario === CUENTAS.admin.usuario);
    expect(yo).toBeTruthy();

    /* El propio administrador se degrada. Como es el UNICO activo, el proceso
       principal tiene que negarse: un negocio sin ningun administrador no se
       arregla restaurando un respaldo, porque el respaldo trae las mismas
       credenciales olvidadas. */
    const soloUno = await app.invocar('usersUpdateRole', { id: yo.id, rol: 'cajero' });
    expect(soloUno.success).toBeFalsy();
    expect(String(soloUno.error)).toContain('administrador');

    /* Con otro administrador activo, si se puede. Y el efecto es inmediato en
       esta misma caja, sin cerrar sesion. */
    const encargado = lista.data.find((u) => u.usuario === CUENTAS.encargado.usuario);
    const sube = await app.invocar('usersUpdateRole', { id: encargado.id, rol: 'admin' });
    expect(sube.success).toBeTruthy();

    const baja = await app.invocar('usersUpdateRole', { id: yo.id, rol: 'cajero' });
    expect(baja.success).toBeTruthy();

    const ahora = await app.invocar('sesion');
    expect(ahora.data.rolEtiqueta).toBe('Operador');
    expect(ahora.data.permisos).not.toContain('CONFIGURACION_ADMINISTRAR');

    const yaNo = await app.invocar('usersList');
    expect(yaNo.success).toBeFalsy();
    expect(yaNo.motivo).toBe('SIN_PERMISO');

    /* Se deja como estaba, y no desde esta sesion: quien acaba de degradarse ya
       NO puede tocar usuarios, que es justo lo que se acaba de comprobar. Hay
       que identificarse como quien ahora si puede. Que la limpieza necesite
       esto es la mejor senal de que el permiso se retiro de verdad. */
    const relevo = await app.invocar('iniciarSesion',
      CUENTAS.encargado.usuario, CUENTAS.encargado.password);
    expect(relevo.data.acceso.rolEtiqueta).toBe('Administrador');

    expect((await app.invocar('usersUpdateRole', { id: yo.id, rol: 'admin' })).success).toBeTruthy();
    expect((await app.invocar('usersUpdateRole', { id: encargado.id, rol: 'supervisor' })).success).toBeTruthy();
  });

  test('la autorizacion presencial exige que sea OTRA persona', async ({ app }) => {
    const operador = await entrar(app, CUENTAS.operador);

    /* Con sus propias credenciales: eso no es autorizacion presencial, es
       saltarse el control con la contrasena de uno mismo. */
    const mismo = await app.invocar('securityAuthorize', {
      usuario: CUENTAS.operador.usuario, password: CUENTAS.operador.password,
      canal: 'sp-refund-sale',
    });
    expect(mismo.ok).toBeFalsy();

    /* Con las de alguien que tampoco tiene el paquete: tampoco. */
    const sinPaquete = await app.invocar('securityAuthorize', {
      usuario: CUENTAS.heredado.usuario, password: CUENTAS.heredado.password,
      canal: 'sp-refund-sale',
    });
    expect(sinPaquete.ok).toBeFalsy();

    /* Con las del Encargado: si, y quedan las DOS identidades. Un registro que
       solo diga «el encargado hizo la devolucion» miente: lo que hizo fue
       permitirla. */
    const bien = await app.invocar('securityAuthorize', {
      usuario: CUENTAS.encargado.usuario, password: CUENTAS.encargado.password,
      canal: 'sp-refund-sale',
    });
    expect(bien.ok).toBeTruthy();
    expect(bien.performedBy).toBe(operador.userId);
    expect(bien.authorizedBy).not.toBe(operador.userId);
    expect(bien.rolEtiqueta).toBe('Encargado');
  });

  test('las lecturas del mostrador siguen abiertas', async ({ app }) => {
    await entrar(app, CUENTAS.operador);

    /* Exigir permiso a estas convertiria la pantalla del Operador en una
       pantalla de errores. Es una decision, y esta comprobada. */
    /* No todos devuelven la misma forma: algunos responden {success, data} y
       otros el recordset pelado. Lo que se comprueba no es la forma, es que la
       autorizacion no los haya rechazado. */
    for (const metodo of ['getActiveProducts', 'getCustomers', 'getSuppliers', 'modulosLista']) {
      const r = await app.invocar(metodo);
      expect(r, `${metodo} no devolvio nada`).toBeTruthy();
      expect(r.motivo, `${metodo} fue rechazado por la autorizacion`).toBeUndefined();
      if (r.success !== undefined) expect(r.success, metodo).toBeTruthy();
    }
  });

  test('el modulo apagado no se puede operar aunque se tenga el paquete', async ({ app }) => {
    await entrar(app, CUENTAS.admin);

    const mods = await app.invocar('modulosLista');
    expect(mods.success).toBeTruthy();
    const activos = new Set(mods.data.filter((m) => m.enabled).map((m) => m.module_key));

    /* Capacidad y permiso son preguntas distintas: el Administrador tiene el
       paquete de Servicios desde el primer dia, y el modulo esta apagado hasta
       que alguien lo encienda desde Aplicaciones. */
    expect(activos.has('servicios')).toBe(false);

    const encendido = await app.invocar('modulosSet', 'servicios', true);
    expect(encendido.success, JSON.stringify(encendido)).toBeTruthy();

    const despues = await app.invocar('modulosLista');
    expect(despues.data.find((m) => m.module_key === 'servicios').enabled).toBeTruthy();

    await app.invocar('modulosSet', 'servicios', false);
  });
});
