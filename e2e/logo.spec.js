/**
 * EL LOGO DEL NEGOCIO, SUBIDO DE VERDAD.
 *
 *     npx playwright test e2e/logo.spec.js
 *
 * POR QUE ESTA PRUEBA EXISTE
 * --------------------------
 * La comprobacion que habia vivia en `test:onboarding` y reimplementaba las
 * guardas del canal para poder correr sin Electron. Eso comprueba que las
 * REGLAS son correctas, pero no que el canal las aplique: si el manejador
 * cambiara de forma sin cambiar sus mensajes, aquella prueba seguiria verde.
 *
 * Aqui se llama al canal de verdad, en la aplicacion de verdad, con su guarda
 * de permisos puesta, y se mira el ARCHIVO que queda en disco.
 *
 * Y no, no hacia falta resolver nada del catalogo para esto: el logo es un
 * archivo en la carpeta de datos y no toca la base. Lo unico que comparte con
 * productos y marcas es la pantalla desde la que se sube.
 */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, CUENTAS } = require('./fixtures');

/* Un PNG de 1x1 valido, con su firma de verdad. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function entrar(app, cuenta) {
  const { ventana } = app;
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(cuenta.usuario);
}

/* El proceso principal escribe en `app.getPath('userData')`, que en las
   pruebas es el perfil aislado de esta ejecucion. */
const rutaLogo = (app) => path.join(app.perfil, 'ticket-logo.png');

test.describe('El logo del negocio', () => {

  test('un administrador lo sube, y el archivo queda en disco', async ({ app }) => {
    await entrar(app, CUENTAS.admin);

    expect(fs.existsSync(rutaLogo(app)), 'no hay logo antes de subirlo').toBe(false);

    const r = await app.invocar('ticketGuardarLogo', { base64: PNG_1X1 });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();

    /* El archivo existe Y son los bytes que se mandaron, no un archivo vacio
       ni el nombre puesto sobre otra cosa. */
    expect(fs.existsSync(rutaLogo(app)), 'el archivo existe').toBe(true);
    expect(fs.readFileSync(rutaLogo(app)).equals(Buffer.from(PNG_1X1, 'base64')),
      'y son exactamente los bytes que se enviaron').toBe(true);

    /* Y la pantalla puede volver a leerlo: subir algo que despues no se ve
       seria lo mismo que no subirlo. */
    const leido = await app.invocar('ticketLogo');
    expect(leido?.success).toBeTruthy();
    expect(String(leido?.logoUrl || ''), 'la ruta apunta al PNG').toContain('ticket-logo.png');
  });

  test('tambien llegando como data: URI, que es como lo manda la pantalla', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    const r = await app.invocar('ticketGuardarLogo',
      { base64: 'data:image/png;base64,' + PNG_1X1 });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    expect(fs.existsSync(rutaLogo(app))).toBe(true);
  });

  test('lo que no es un PNG se rechaza, y no se escribe nada', async ({ app }) => {
    await entrar(app, CUENTAS.admin);

    /* Primero uno bueno, para poder comprobar algo que importa mas que el
       rechazo: que un intento fallido NO se lleve por delante el logo que ya
       estaba. Un negocio no puede perder su logo porque alguien probo a subir
       el archivo equivocado. */
    await app.invocar('ticketGuardarLogo', { base64: PNG_1X1 });
    const antes = fs.readFileSync(rutaLogo(app));

    const casos = [
      ['vacia', ''],
      ['un archivo que no es imagen', Buffer.from('<?php echo 1; ?>').toString('base64')],
      ['un JPEG de verdad, que tampoco vale', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0]).toString('base64')],
      ['una imagen enorme', Buffer.alloc(5 * 1024 * 1024, 0x89).toString('base64')],
    ];

    for (const [nombre, base64] of casos) {
      const r = await app.invocar('ticketGuardarLogo', { base64 });
      expect(r?.success, `${nombre}: tiene que rechazarse`).toBeFalsy();
      expect(String(r?.error || ''), `${nombre}: y decir por que`).not.toBe('');
    }

    expect(fs.readFileSync(rutaLogo(app)).equals(antes),
      'el logo que ya estaba sigue intacto tras los rechazos').toBe(true);
  });

  test('un operador no puede cambiar el logo del negocio', async ({ app }) => {
    await entrar(app, CUENTAS.operador);

    const r = await app.invocar('ticketGuardarLogo', { base64: PNG_1X1 });
    expect(r?.success, 'el canal exige el paquete de configuracion').toBeFalsy();
    expect(fs.existsSync(rutaLogo(app)),
      'y no deja rastro en disco').toBe(false);
  });

  test('y el administrador puede quitarlo', async ({ app }) => {
    await entrar(app, CUENTAS.admin);
    await app.invocar('ticketGuardarLogo', { base64: PNG_1X1 });
    expect(fs.existsSync(rutaLogo(app))).toBe(true);

    const r = await app.invocar('ticketBorrarLogo');
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    expect(fs.existsSync(rutaLogo(app)), 'el archivo se fue').toBe(false);
  });
});
