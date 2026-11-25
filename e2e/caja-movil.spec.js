/**
 * CAJA MÓVIL POR LOCAL HOST (0094), DE PUNTA A PUNTA.
 *
 * La app de escritorio de verdad (Electron, Local Host en un puerto de prueba)
 * y, del otro lado, el MOTOR REAL de Wybix POS Mobile (@wybix/database,
 * @wybix/sync, @wybix/api de wybix-owner) con su base SQLite en memoria,
 * hablando por HTTP como lo haría la tablet:
 *
 *   1. emparejar con el QR de «Caja móvil» y recibir catálogo, personal con
 *      PIN y existencias; la tablet tiene su propia caja en la base.
 *   2. abrir turno, vender (pieza, paquete de venta y venta suelta), cobro
 *      dividido, entrada de efectivo, devolución y corte: todo sin red, y
 *      al sincronizar queda en SQL Server con los SP de siempre.
 *   3. reenviar todo: DUPLICATE, nada se duplica.
 *   4. el siguiente snapshot no reenvía el catálogo.
 *
 *   npm run e2e:caja-movil   (necesita wybix-owner junto a este repo)
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS } = require('./fixtures');

const BASE = 'Wybix_E2E_CajaMovil';
const PUERTO = 17628;
const MOBILE = process.env.WYBIX_MOBILE || path.resolve(__dirname, '..', '..', 'wybix-owner');

async function sql(texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(BASE, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}
const mod = (rel) => import(pathToFileURL(path.join(MOBILE, rel)).href);

test.describe('Caja móvil por Local Host', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!fs.existsSync(path.join(MOBILE, 'packages', 'database', 'src', 'index.ts')), `falta wybix-owner en ${MOBILE}`);

  test.beforeAll(async () => {
    const bases = await import('./preparar-bases.mjs');
    bases.prepararBase(BASE, { perfil: 'RETAIL' });
  });
  test.afterAll(async () => {
    const temporal = await import('../scripts/db/lib/temporal.mjs');
    try { temporal.eliminar(BASE); } catch { /* ya no estaba */ }
  });

  test('emparejar, vender sin red y entregar a SQL Server con los SP de siempre', async () => {
    test.setTimeout(300000);
    const { sqlSembrar } = await import('../scripts/giros/abarrotes.mjs');
    const filas = await sql(sqlSembrar());
    const porPn = Object.fromEntries(filas.map((f) => [f.part_number, f]));
    // La caja principal tiene existencias (una compra cualquiera).
    await sql(`UPDATE dbo.products SET stock = 100 WHERE part_number IN (N'ABA-MP-REFRESCO', N'ABA-CERV-CLARA', N'ABA-CIG-ROJO-PAQ', N'ABA-CHOC-BARRA');
               UPDATE dbo.products SET stock = 0 WHERE part_number = N'ABA-CIG-ROJO';`);
    /* La licencia de prueba trae UNA caja y la caja móvil cuenta como caja.
       Esta prueba no vende en el escritorio: se libera su lugar. */
    await sql(`UPDATE dbo.registers SET is_active = 0;`);

    const perfil = await nuevoPerfil(BASE);
    const opciones = opcionesDeArranque(perfil);
    opciones.env = { ...(opciones.env || process.env), WYBIX_LOCAL_HOST_PUERTO: String(PUERTO) };
    const app = await electron.launch(opciones);
    try {
      const v = await app.firstWindow({ timeout: 120000 });
      await v.waitForFunction(() => !!window.electronAPI, null, { timeout: 60000 });
      await v.waitForSelector('#username', { timeout: 60000 });
      await v.evaluate(() => { try { localStorage.setItem('wx-guide:auto', '0'); } catch { /* noop */ } });
      await v.fill('#username', CUENTAS.admin.usuario);
      await v.fill('#password', CUENTAS.admin.password);
      await v.click('#btnLogin');
      await expect.poll(async () => (await v.evaluate(() => window.electronAPI.sesion()))?.data?.usuario ?? null, { timeout: 30000 }).toBe(CUENTAS.admin.usuario);

      /* En la computadora: Local Host encendido, PIN del administrador y el QR de «Caja móvil». */
      const prep = await v.evaluate(async () => {
        const w = window.wybix;
        const act = await w.localHost.activar({ activo: true });
        const yo = (await window.electronAPI.sesion()).data;
        const pin = await w.localHost.pinTrabajador({ userId: yo.userId, pin: '2580' });
        const q = await w.localHost.emparejar({ superficie: 'CAJA_MOVIL', nombre: 'Tablet Mostrador' });
        return { act: act.data?.fase, pin: pin.success, url: q.data?.url || q.error };
      });
      expect(prep.act).toBe('ACTIVO');
      expect(prep.pin).toBe(true);
      expect(String(prep.url)).toMatch(/\/pair\//);
      const qr = String(prep.url).replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${PUERTO}`);

      /* ---------------- la tablet: el motor real de Wybix POS Mobile ---------------- */
      const { DatabaseSync } = require('node:sqlite');
      const db0 = await mod('packages/database/src/index.ts');
      const { crearSincronizador } = await mod('packages/sync/src/index.ts');
      const api = await mod('packages/api/src/index.ts');
      const db = db0.adaptadorNode(new DatabaseSync(':memory:'));
      await db0.migrar(db);

      const par = await api.emparejarLocalHost(qr);
      expect(par.credencial.length).toBeGreaterThan(40);
      await expect(api.emparejarLocalHost(qr)).rejects.toThrow(/ya se usó/);
      await db0.guardarEnrolamiento(db, { device_uuid: 'tablet-mostrador', device_id: par.device_id, modo: 'SUCURSAL', local_host: par.base });
      const nube = api.crearClienteLocalHost({ base: par.base, credencial: async () => par.credencial, version: '0.4.0' });
      const motor = crearSincronizador({ db, nube, dispositivo: async () => 'tablet-mostrador', version: '0.4.0' });
      const e0 = await motor.sincronizar(true);
      if (!e0.en_linea) { try { await nube.snapshot({ catalog_version: 0, security_revision: 0, snapshot_version: 0 }); } catch (e) { throw new Error('snapshot: ' + e.message); } }
      expect(e0.en_linea, 'la tablet llega a la caja principal').toBe(true);
      const pos = db0.crearPos(db);
      const id = await pos.identidad();
      expect(id.register.name).toBe('Móvil · Tablet Mostrador');
      const cat = await pos.catalogoActual();
      const u = (pn) => [...cat.producto.values()].find((p) => p.part_number === pn).uuid;
      const stock = async (pn) => (await pos.stock()).find((s) => s.product_uuid === u(pn))?.qty;
      expect(await stock('ABA-MP-REFRESCO'), 'existencias de la base').toBe('100');
      const admin = (await db.all(`SELECT uuid, name, role FROM staff`)).find((s) => s.name === CUENTAS.admin.usuario);
      expect(admin?.role, 'el personal con PIN llega con su rol').toBe('ADMIN');
      const yo = { uuid: admin.uuid, name: admin.name, role: admin.role };

      /* Sin red: turno, ventas, entrada, devolución. */
      await pos.abrirTurno(yo, '500');
      const six = cat.producto.get(u('ABA-MP-REFRESCO')).presentations.find((x) => x.name === 'Six 6');
      const v1 = await pos.registrarVenta(yo, [
        { product_uuid: u('ABA-MP-REFRESCO'), quantity: 2 },
        { product_uuid: u('ABA-MP-REFRESCO'), quantity: 6, presentation_id: six.id },
      ], [{ method: 'TARJETA', amount: '50.00' }, { method: 'EFECTIVO', amount: '72.00', received: '100.00' }]);
      expect(v1.total, '2 latas a $16 + six a $90').toBe('122.00');
      // Venta suelta: no hay cigarros sueltos; la base abre la cajetilla.
      const v2 = await pos.registrarVenta(yo, [{ product_uuid: u('ABA-CIG-ROJO'), quantity: 3 }], [{ method: 'EFECTIVO', amount: '18.00' }]);
      await pos.movimientoCaja(yo, 'CASH_IN', '200', 'Cambio del banco');
      await pos.devolverVenta(yo, v1.sale_uuid, [{ line_no: 1, quantity: 1 }], 'Lata abollada');
      const e1 = await motor.sincronizar(true);
      expect([e1.pendientes, e1.rechazados, e1.cuarentena], JSON.stringify(await db.all(`SELECT event_type, last_error FROM outbox WHERE status <> 'SENT'`))).toEqual([0, 0, 0]);

      /* En SQL Server, con los SP de siempre. */
      const caja = (await sql(`SELECT id, code FROM dbo.registers WHERE name = N'Móvil · Tablet Mostrador';`))[0];
      expect(caja?.id).toBeTruthy();
      const ventas = await sql(`SELECT s.id, CAST(s.total AS FLOAT) AS total, s.payment_method, LOWER(CONVERT(VARCHAR(36), s.client_sale_key)) AS k
                                  FROM dbo.sales s WHERE s.register_id = ${caja.id} ORDER BY s.id;`);
      expect(ventas.map((x) => [x.total, x.payment_method])).toEqual([[122, 'MIXTO'], [18, 'EFECTIVO']]);
      expect(ventas[0].k).toBe(v1.sale_uuid);
      expect(Number((await sql(`SELECT CAST(stock AS FLOAT) AS s FROM dbo.products WHERE part_number = N'ABA-MP-REFRESCO';`))[0].s), '100 - 8 + 1 devuelta').toBe(93);
      expect(Number((await sql(`SELECT CAST(stock AS FLOAT) AS s FROM dbo.products WHERE part_number = N'ABA-CIG-ROJO-PAQ';`))[0].s), 'se abrió una cajetilla').toBe(99);
      expect(Number((await sql(`SELECT COUNT(*) AS n FROM dbo.cash_closures WHERE register_id = ${caja.id} AND closed_at IS NULL;`))[0].n), 'turno abierto en su caja').toBe(1);

      /* El corte cierra el turno de su caja. */
      await pos.cerrarTurno(yo, '700');
      const ec = await motor.sincronizar(true);
      expect([ec.pendientes, ec.rechazados], JSON.stringify(await db.all(`SELECT event_type, status, last_error FROM outbox WHERE status <> 'SENT'`))).toEqual([0, 0]);
      expect(Number((await sql(`SELECT COUNT(*) AS n FROM dbo.cash_closures WHERE register_id = ${caja.id} AND closed_at IS NOT NULL;`))[0].n)).toBe(1);

      /* Reenviar todo (se perdió el acuse): nada se duplica. */
      await db.run(`UPDATE outbox SET status = 'PENDING', next_attempt_at = NULL`);
      const e2 = await motor.sincronizar(true);
      expect(e2.pendientes + e2.rechazados).toBe(0);
      expect(Number((await sql(`SELECT COUNT(*) AS n FROM dbo.sales WHERE register_id = ${caja.id};`))[0].n)).toBe(2);
      expect(Number((await sql(`SELECT COUNT(*) AS n FROM dbo.caja_movil_eventos WHERE resultado = 'APPLIED';`))[0].n)).toBeGreaterThanOrEqual(7);

      /* El siguiente snapshot no reenvía catálogo ni personal. */
      const m = await motor.metricas();
      expect(m.catalogo).toBe('sin_cambios');

      /* Revocar en la computadora: la tablet deja de entregar y lo sabe. */
      await v.evaluate(async () => {
        const w = window.wybix;
        const lista = (await w.localHost.estado()).data?.dispositivos ?? [];
        const d = lista.find((x) => x.nombre === 'Tablet Mostrador');
        await w.localHost.revocar({ id: d.id });
      });
      const e3 = await motor.sincronizar(true);
      expect(e3.revocado).toBe(true);
    } finally {
      await app.close().catch(() => {});
      try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
});
