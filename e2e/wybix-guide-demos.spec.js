/**
 * WYBIX GUIDE: LAS DEMOSTRACIONES, DESDE UNA DEMO RECIEN CREADA.
 *
 *     npx playwright test e2e/wybix-guide-demos.spec.js
 *
 * Reproducen los fallos que encontro la QA manual y que la suite no veia,
 * porque la prueba anterior preparaba el mundo a la medida del recorrido:
 *
 *   RETAIL        Marca «Sin resultados» y luego «No pude seguir: limite».
 *                 La demo real no tenia marcas; la prueba le metia una.
 *   HOSPITALITY   «No pude seguir: no apareció lo que esperaba» con la
 *                 comanda YA en la cocina: la segunda vuelta encontraba la
 *                 caja atada a la cuenta cobrada de la primera.
 *   TOMAR EL      Al continuar, el motor repetia su instruccion vieja
 *   CONTROL       («pulsa Enviar») sobre algo que la persona ya habia hecho.
 *   SERVICES      Solo enseñaba a crear y vender un producto.
 *
 * Cada caso parte de una demo creada por el MISMO camino del gestor
 * (e2e/demo-real.js): plantilla, migraciones y la semilla del perfil.
 */
const { test, expect } = require('@playwright/test');
const { prepararDemoReal, arrancarDemoReal, entrarDemo, borrarDemo, estadoGuia } = require('./demo-real');

/* Lo que jamas debe ver una persona. */
const INTERNO = /l[ií]mite|no-encontrado|no apareci[oó] lo que esperaba|target|timeout|mismatch|objetivo|hecho |undefined|NaN/i;

async function sql(base, q) {
  const { consultar } = await import('../scripts/db/lib/sql.mjs');
  return consultar(base, q);
}
async function escribirSql(base, q) {
  const { ejecutar } = await import('../scripts/db/lib/temporal.mjs');
  return ejecutar(base, q);
}

/** Corre un recorrido hasta el cierre (o hasta que falle) y devuelve lo que paso. */
async function correr(ventana, id, { alPaso, limite = 240000 } = {}) {
  expect(await ventana.evaluate((x) => window.wybixGuide.iniciar(x), id), `${id} arranca`).toBe(true);
  const traza = [];
  const vistos = new Set();
  let ultimo = '';
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    const e = await estadoGuia(ventana);
    const firma = `${e.fase}|${e.paso?.id}|${e.frase}|${e.paso?.pausado}`;
    if (firma !== ultimo) { traza.push({ fase: e.fase, paso: e.paso?.id, frase: e.frase, aviso: e.aviso }); ultimo = firma; }
    if (e.paso?.id && !vistos.has(e.paso.id)) {
      vistos.add(e.paso.id);
      if (alPaso) await alPaso(e.paso.id, e);
    }
    if (e.fase !== 'recorrido') break;
    if (e.frase && /No encontré esta parte|Falta algo para continuar|todavía no terminó|No pude completar|no salió como esperaba/.test(e.frase)) break;
    await ventana.waitForTimeout(300);
  }
  const final = await estadoGuia(ventana);
  return { traza, final, diag: final.diag || [] };
}

function sinTextosInternos(r) {
  for (const t of r.traza) {
    expect(t.frase || '', `frase visible en ${t.paso}`).not.toMatch(INTERNO);
    expect(t.aviso || '', `aviso visible en ${t.paso}`).not.toMatch(INTERNO);
  }
}

function terminoBien(r, id) {
  expect(r.final.fase, `${id}: termina en el cierre (último: ${JSON.stringify(r.traza.slice(-3))} · diag: ${JSON.stringify(r.diag.slice(-3))})`).toBe('cierre');
}

async function conDemo({ base, perfil, preset = null, touch = false }, cuerpo) {
  const demo = await prepararDemoReal({ base, perfil, preset });
  const app = await arrancarDemoReal({ base, perfil, instancia: demo.instancia, touch });
  try {
    await entrarDemo(app.ventana);
    await cuerpo(app);
  } finally {
    await app.cerrar();
    await borrarDemo(base);
  }
}

// ===================================================================== RETAIL
test.describe('Demo Retail', () => {
  test('sin marcas ni categorías: crea y vende, y no dice «límite»', async ({}, info) => {
    test.setTimeout(600000);
    const base = 'Wybix_E2E_GuiaRetail';
    await conDemo({ base, perfil: 'retail' }, async ({ ventana }) => {
      /* El estado que vio la QA: sin una sola marca ni categoria. */
      await escribirSql(base, `UPDATE dbo.products SET brand_id = NULL, category_id = NULL;
        DELETE FROM dbo.CAT_brands; DELETE FROM dbo.CAT_categories;`);
      expect((await sql(base, 'SELECT COUNT(*) AS n FROM dbo.CAT_brands'))[0].n).toBe(0);

      const r = await correr(ventana, 'demo.retail');
      await info.attach('traza-retail.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      terminoBien(r, 'demo.retail');
      sinTextosInternos(r);

      const p = await sql(base, `SELECT p.id, p.active, b.namee AS marca, c.namee AS categoria
        FROM dbo.products p LEFT JOIN dbo.CAT_brands b ON b.id = p.brand_id LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
        WHERE p.part_number = N'DEMO-GUIA-CAFE'`);
      expect(p.length, 'creó el producto').toBe(1);
      expect(p[0]).toMatchObject({ marca: 'General', categoria: 'General' });
      const vendido = await sql(base, `SELECT COUNT(*) AS n FROM dbo.sale_detail WHERE product_id = ${Number(p[0].id)}`);
      expect(vendido[0].n, 'y lo vendió').toBe(1);
    });
  });

  test('idempotente: tres vueltas, un solo producto a la venta', async () => {
    test.setTimeout(900000);
    const base = 'Wybix_E2E_GuiaRetail3';
    await conDemo({ base, perfil: 'retail' }, async ({ ventana }) => {
      for (let i = 1; i <= 3; i++) {
        const r = await correr(ventana, 'demo.retail');
        terminoBien(r, `demo.retail vuelta ${i}`);
        await ventana.evaluate(() => window.wybixGuide.detener());
      }
      const activos = await sql(base, `SELECT COUNT(*) AS n FROM dbo.products WHERE part_number = N'DEMO-GUIA-CAFE' AND active = 1`);
      expect(activos[0].n, 'uno solo a la venta').toBe(1);
      const nombres = await sql(base, `SELECT COUNT(*) AS n FROM dbo.products WHERE active = 1 AND nombre LIKE N'Café de la demo%(%'`);
      expect(nombres[0].n, 'sin «(2)»').toBe(0);
      const marcas = await sql(base, `SELECT COUNT(*) AS n FROM dbo.CAT_brands WHERE namee = N'General'`);
      expect(marcas[0].n, 'una sola marca General').toBe(1);
    });
  });
});

// ================================================================ HOSPITALITY
async function contarHosp(base) {
  return (await sql(base, `SELECT
    (SELECT COUNT(*) FROM dbo.prep_stations WHERE nombre = N'Barra') AS barras,
    (SELECT COUNT(*) FROM dbo.salon_mesas WHERE nombre = N'1') AS mesas1,
    (SELECT COUNT(*) FROM dbo.salon_areas WHERE nombre = N'Salón') AS salones,
    (SELECT COUNT(*) FROM dbo.products WHERE part_number = N'DEMO-AMERICANO-GUIDE') AS americanos,
    (SELECT COUNT(*) FROM dbo.hosp_cuentas WHERE estado IN ('ABIERTA','POR_COBRAR')) AS abiertas`))[0];
}

test.describe('Demo Hospitality', () => {
  test('Touch: Mesa 1 → Americano → Barra → KDS → cobro, y otra vez (la vuelta que fallaba)', async ({}, info) => {
    test.setTimeout(900000);
    const base = 'Wybix_E2E_GuiaHospT';
    await conDemo({ base, perfil: 'hospitality', touch: true }, async ({ ventana }) => {
      for (const vuelta of [1, 2]) {
        const r = await correr(ventana, 'demo.hospitality');
        await info.attach(`traza-hosp-${vuelta}.json`, { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
        terminoBien(r, `demo.hospitality vuelta ${vuelta}`);
        sinTextosInternos(r);
        const k = await sql(base, `SELECT TOP 1 k.estado, m.nombre AS mesa, s.nombre AS estacion, l.nombre AS linea, c.estado AS cuenta
          FROM dbo.comandas k JOIN dbo.hosp_cuentas c ON c.id = k.cuenta_id JOIN dbo.salon_mesas m ON m.id = c.mesa_id
          JOIN dbo.prep_stations s ON s.id = k.station_id JOIN dbo.hosp_orden_lineas l ON l.comanda_id = k.id
          ORDER BY k.id DESC`);
        expect(k[0], `vuelta ${vuelta}: persistió en la base`).toMatchObject({ estado: 'LISTA', mesa: '1', estacion: 'Barra', linea: 'Americano Demo', cuenta: 'COBRADA' });
        await ventana.evaluate(() => window.wybixGuide.detener());
      }
      const n = await contarHosp(base);
      expect(n, 'sin duplicados tras dos vueltas').toMatchObject({ barras: 1, mesas1: 1, salones: 1, americanos: 1, abiertas: 0 });
      const comandas = await sql(base, 'SELECT COUNT(*) AS n FROM dbo.comandas');
      expect(comandas[0].n, 'una comanda por vuelta, nunca repetida').toBe(2);
    });
  });

  test('escritorio: la misma demo por el salón y Venta', async ({}, info) => {
    test.setTimeout(600000);
    const base = 'Wybix_E2E_GuiaHospE';
    await conDemo({ base, perfil: 'hospitality', touch: false }, async ({ ventana }) => {
      const r = await correr(ventana, 'demo.hospitality');
      await info.attach('traza-hosp-escritorio.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      terminoBien(r, 'demo.hospitality escritorio');
      sinTextosInternos(r);
      const c = await sql(base, `SELECT TOP 1 c.estado FROM dbo.hosp_cuentas c ORDER BY c.id DESC`);
      expect(c[0].estado).toBe('COBRADA');
    });
  });

  test('tomar el control ANTES del KDS: yo envío y abro Cocina; «Continuar» sigue sin repetir', async ({}, info) => {
    test.setTimeout(600000);
    const base = 'Wybix_E2E_GuiaHospTk1';
    await conDemo({ base, perfil: 'hospitality', touch: true }, async ({ ventana }) => {
      let hecho = false;
      const r = await correr(ventana, 'demo.hospitality', {
        alPaso: async (paso) => {
          if (paso !== 'enviar' || hecho) return;
          hecho = true;
          /* Un clic de verdad fuera del presentador: toma el control. Sobre el
             titulo de la mesa, que no hace nada: un punto fijo de la cabecera
             caia en «Aquí» y abria el selector de mesas encima de «Enviar». */
          const caja = await ventana.locator('[data-guide="touch-cuenta-mesa"]').boundingBox();
          await ventana.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
          await expect.poll(async () => (await estadoGuia(ventana)).paso?.pausado).toBe(true);
          /* Lo envio yo… */
          await ventana.locator('[data-guide="touch-enviar"]').click();
          await expect(ventana.locator('[data-guide="touch-enviar"]')).toHaveCount(0, { timeout: 15000 });
          /* …salgo de la caja y abro Cocina por el Dock, como una persona. */
          await ventana.locator('[aria-label="Salir del punto de venta"]').click();
          await ventana.click('.wxdock button.wxdock__btn:has-text("Venta")');
          await ventana.click('.wxdock__panel a:has-text("Cocina")');
          await ventana.waitForSelector('app-kds', { timeout: 30000 });
          /* Mas de lo que antes duraba cualquier espera: el reloj no corre en pausa. */
          await ventana.waitForTimeout(15000);
          await ventana.locator('.wxgl__pausa').click();
        },
      });
      await info.attach('traza-takeover-antes.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      terminoBien(r, 'takeover antes del KDS');
      sinTextosInternos(r);
      expect(r.diag.some(d => d.codigo === 'REANUDA'), 'al continuar, reevaluó').toBe(true);
      const k = await sql(base, 'SELECT COUNT(*) AS n FROM dbo.comandas');
      expect(k[0].n, 'una sola comanda: nada se envió dos veces').toBe(1);
    });
  });

  test('tomar el control DESPUÉS del envío: empiezo la comanda yo; la demo lo reconoce', async ({}, info) => {
    test.setTimeout(600000);
    const base = 'Wybix_E2E_GuiaHospTk2';
    await conDemo({ base, perfil: 'hospitality', touch: true }, async ({ ventana }) => {
      let hecho = false;
      const r = await correr(ventana, 'demo.hospitality', {
        alPaso: async (paso) => {
          if (paso !== 'cocina' || hecho) return;
          hecho = true;
          await ventana.waitForSelector('[data-guide="kds-paso"]', { timeout: 30000 });
          const t = await ventana.locator('[data-guide="kds-ticket"]').first().boundingBox();
          await ventana.mouse.click(t.x + 10, t.y + 10);
          await expect.poll(async () => (await estadoGuia(ventana)).paso?.pausado).toBe(true);
          /* La barista la empieza a mano. */
          await ventana.locator('[data-guide="kds-paso"]').first().click();
          await expect(ventana.locator('[data-guide="kds-ticket"][data-guide-estado="PREPARANDO"]')).toHaveCount(1, { timeout: 15000 });
          await ventana.locator('.wxgl__pausa').click();
        },
      });
      await info.attach('traza-takeover-despues.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      terminoBien(r, 'takeover después del envío');
      sinTextosInternos(r);
      const k = await sql(base, 'SELECT estado FROM dbo.comandas');
      expect(k, 'una comanda, lista: nadie la pasó dos veces por el mismo paso').toEqual([{ estado: 'LISTA' }]);
    });
  });

  test('el negocio manda: el ticket tarda en verse y la demo lo dice sin romperse', async ({}, info) => {
    test.setTimeout(600000);
    const base = 'Wybix_E2E_GuiaHospDom';
    await conDemo({ base, perfil: 'hospitality', touch: true }, async ({ ventana }) => {
      let quitado = false;
      const r = await correr(ventana, 'demo.hospitality', {
        alPaso: async (paso) => {
          /* Justo al mandar: el ticket de la cocina no se deja ver. */
          if (paso === 'enviar') {
            await ventana.addStyleTag({ content: '[data-guide="kds-ticket"]{display:none!important}' });
          }
          /* En cuanto la demo pasa por la cocina sin verlo, vuelve a verse. */
          if (paso === 'prepara' && !quitado) {
            quitado = true;
            await ventana.evaluate(() => document.querySelectorAll('style').forEach(s => { if (s.textContent.includes('kds-ticket')) s.remove(); }));
          }
        },
      });
      await info.attach('traza-negocio-antes-que-dom.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      terminoBien(r, 'negocio antes que el DOM');
      sinTextosInternos(r);
      expect(r.diag.some(d => d.codigo === 'SIN_DOM' && d.paso === 'cocina'), 'la cocina se dijo por el negocio').toBe(true);
    });
  });
});

// =================================================================== SERVICES
test.describe('Demo Services', () => {
  test('Taller: orden, vehículo, cotización, autorización, trabajo y cobro', async ({}, info) => {
    test.setTimeout(600000);
    const base = 'Wybix_E2E_GuiaTallerD';
    await conDemo({ base, perfil: 'servicios', preset: 'TALLER_AUTOMOTRIZ' }, async ({ ventana }) => {
      const r = await correr(ventana, 'demo.services.workshop');
      await info.attach('traza-taller.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      terminoBien(r, 'demo.services.workshop');
      sinTextosInternos(r);
      const pasos = r.traza.map(t => t.paso);
      for (const p of ['vehiculo', 'servicio', 'autoriza', 'proceso', 'termina', 'pago']) expect(pasos, `enseña «${p}»`).toContain(p);
      const o = await sql(base, `SELECT TOP 1 o.status, o.sale_id, o.authorized_at, a.identifier,
          (SELECT COUNT(*) FROM dbo.service_order_lines l JOIN dbo.products p ON p.id = l.product_id WHERE l.order_id = o.id AND p.part_number = N'SRV-ACE') AS aceite
        FROM dbo.service_orders o JOIN dbo.customers c ON c.id = o.customer_id
        LEFT JOIN dbo.customer_assets a ON a.id = o.customer_asset_id
        WHERE c.customerName = N'David Demo' ORDER BY o.id DESC`);
      expect(o[0].status).toBe('TERMINADA');
      expect(o[0].sale_id, 'cobrada').not.toBeNull();
      expect(o[0].authorized_at, 'autorizada').not.toBeNull();
      expect(o[0].identifier, 'sobre su vehículo').toBe('ABC-123');
      expect(o[0].aceite, 'con el cambio de aceite').toBe(1);
    });
  });

  test('Belleza: cita, llegada y cobro', async ({}, info) => {
    test.setTimeout(600000);
    const base = 'Wybix_E2E_GuiaBellezaD';
    await conDemo({ base, perfil: 'servicios', preset: 'BELLEZA' }, async ({ ventana }) => {
      const r = await correr(ventana, 'demo.services.beauty');
      await info.attach('traza-belleza.json', { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      terminoBien(r, 'demo.services.beauty');
      sinTextosInternos(r);
      const pasos = r.traza.map(t => t.paso);
      for (const p of ['cliente', 'servicio', 'quien', 'agendar', 'llego', 'pago']) expect(pasos, `enseña «${p}»`).toContain(p);
      expect(pasos, 'no es la demo de Retail').not.toContain('marca');
      const c = await sql(base, `SELECT TOP 1 a.status, o.sale_id, p.full_name AS quien
        FROM dbo.appointments a JOIN dbo.customers c ON c.id = a.customer_id
        LEFT JOIN dbo.service_orders o ON o.id = a.service_order_id
        LEFT JOIN dbo.professionals p ON p.id = a.professional_id
        WHERE c.customerName = N'Mariana López' ORDER BY a.id DESC`);
      expect(c[0].quien).toBe('Ana Torres');
      expect(c[0].sale_id, 'la orden de la cita quedó cobrada').not.toBeNull();
    });
  });

  test('cada giro ve SU demo: Taller no ve la de Belleza ni la de Retail', async () => {
    test.setTimeout(400000);
    const base = 'Wybix_E2E_GuiaTallerH';
    await conDemo({ base, perfil: 'servicios', preset: 'TALLER_AUTOMOTRIZ' }, async ({ ventana }) => {
      await ventana.click('.wxdock__pulso');
      const hub = ventana.locator('.wxg');
      await expect(hub.locator('[data-escenario="demo.services.workshop"]')).toBeVisible({ timeout: 15000 });
      await expect(hub.locator('[data-escenario="demo.services.beauty"]')).toHaveCount(0);
      await expect(hub.locator('[data-escenario="demo.hospitality"]')).toHaveCount(0);
    });
  });
});

// ===================================================================== RUNNER
test.describe('Motor', () => {
  test('un objetivo que no llega: frase clara, diagnóstico completo, sin «límite»', async () => {
    test.setTimeout(400000);
    const base = 'Wybix_E2E_GuiaTimeout';
    await conDemo({ base, perfil: 'retail' }, async ({ ventana }) => {
      await ventana.addStyleTag({ content: '[data-guide="agregar-producto"]{display:none!important}' });
      const r = await correr(ventana, 'demo.retail', { limite: 90000 });
      expect(r.final.frase).toBe('No encontré esta parte de Wybix.');
      sinTextosInternos(r);
      const d = r.diag.find(x => x.codigo === 'OBJETIVO_NO_ENCONTRADO');
      expect(d, 'quedó anotado por dentro').toBeTruthy();
      expect(d).toMatchObject({ escenario: 'demo.retail', paso: 'agregar' });
      expect(d.objetivo).toContain('agregar-producto');
      expect(d.ruta).toContain('/dashboard/inventario');
      expect(typeof d.ms).toBe('number');
      /* Y detenerla limpia todo. */
      await ventana.evaluate(() => window.wybixGuide.detener());
      await expect(ventana.locator('.wxgl')).toHaveCount(0);
      await expect(ventana.locator('.driver-active-element')).toHaveCount(0);
    });
  });

  test('un objetivo que tarda: se espera sin fallar', async () => {
    test.setTimeout(400000);
    const base = 'Wybix_E2E_GuiaTarde';
    await conDemo({ base, perfil: 'retail' }, async ({ ventana }) => {
      await ventana.addStyleTag({ content: '[data-guide="producto-guardar"]{visibility:hidden!important}' });
      let quitado = false;
      const r = await correr(ventana, 'demo.retail', {
        alPaso: async (paso) => {
          if (paso === 'guardar' && !quitado) {
            quitado = true;
            await ventana.waitForTimeout(4000);
            await ventana.evaluate(() => document.querySelectorAll('style').forEach(s => { if (s.textContent.includes('producto-guardar')) s.remove(); }));
          }
        },
      });
      terminoBien(r, 'objetivo tardío');
    });
  });
});
