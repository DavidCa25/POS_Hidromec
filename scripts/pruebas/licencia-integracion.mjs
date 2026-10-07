/**
 * LICENCIA CONTRA LA BASE Y EL LOCAL HOST DE VERDAD.
 *
 *     npm run test:licencia-integracion
 *
 * Base temporal (template + TODAS las migraciones, 0048 incluida) y el Local
 * Host real, con la licencia que se le dé en cada paso:
 *
 *   V  Venta Esencial en sp_register_sale: vende sin existencia, no descuenta,
 *      no crea movimientos, no toca productos; el ingrediente no aparece.
 *   Q  Cuota de Pantallas Operativas por giro, en el servidor (emparejar,
 *      canjear el QR, cambiar de función); revocar libera el lugar.
 *   M  Matriz DIRECT/RECIPE/NONE × vendible × existencia en Venta Esencial, y
 *      el regreso a ACTIVE con la configuración intacta.
 *   L  Sin la licencia, las pantallas responden «suscripción» (no «apagada»).
 */
import { createRequire } from 'node:module';
import {
  sql, crearMarcador, nacerBase, borrarBase, abrirPool, crearHost, crearTablet,
} from './lib/arnes-local-host.mjs';
import { ejecutar } from '../db/lib/temporal.mjs';

const require = createRequire(import.meta.url);
const { crearEvaluador } = require('../../electron/licencia/entitlements.js');

const DB = 'Wybix_TmpLicencia';
const PUERTO = Number(process.env.WYBIX_PRUEBA_PUERTO) || 17627;
const { check, seccion, resumen } = crearMarcador();
const BASE = ['sales', 'customers', 'reports', 'invoicing', 'loyalty', 'inventory', 'purchases', 'suppliers', 'cloud_sync', 'backup'];
const RESTAURANTE = ['hospitality', 'hospitality.tables', 'hospitality.kds', 'operational_surfaces', 'operational.preparation', 'operational.waiter', 'operational.customer_status', 'operational.inventory_floor'];
const lic = (modo, screens = { HOSPITALITY: 3 }) => crearEvaluador({ modo, entitlements: [...BASE, ...RESTAURANTE], verticals: ['HOSPITALITY'], screens });

console.log(`\nLICENCIA · INTEGRACIÓN · base ${DB} · puerto ${PUERTO}\n`);
let pool, host;
let ev = lic('ACTIVE');
try {
  nacerBase(DB, { perfil: 'HOSPITALITY' });
  for (const m of ['hospitality', 'mesas', 'comandas']) ejecutar(DB, `EXEC dbo.sp_set_business_module @module_key = N'${m}', @enabled = 1`);
  pool = await abrirPool(DB);
  const q = async (t) => (await pool.request().query(t)).recordsets;
  const uno = async (t) => (await q(t))[0]?.[0] ?? {};

  // ======================================================== V · Venta Esencial
  seccion('Venta Esencial en la base');
  const user = (await uno('SELECT TOP 1 id FROM dbo.users ORDER BY id')).id;
  await q(`INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA'); INSERT INTO dbo.CAT_categories (namee) VALUES (N'Cafeteria');`);
  const brand = (await uno('SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC')).id;
  const cat = (await uno(`SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id DESC`)).id;
  const alta = async (pn, nombre, stock, sellable) => Number(Object.values((await q(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'${pn}', @name=N'${nombre}', @price=50, @stock=${stock},
      @category=${cat}, @inventory_mode='DIRECT', @sellable=${sellable}, @base_uom='pza', @allow_decimal_qty=0, @cost=10;`))[0][0])[0]);
  const galleta = await alta('LIC-GAL', 'Galleta empaquetada', 0, 1);
  const leche = await alta('LIC-LEC', 'Leche (ingrediente)', 5, 0);
  await q(`EXEC dbo.sp_open_shift @user_id=${user}, @opening_cash=500, @register_id=1;`);
  const antes = await uno(`SELECT stock, sellable, inventory_mode FROM dbo.products WHERE id = ${galleta}`);
  const vender = (esencial) => q(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${galleta}, 2, 50);
    EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo, @venta_esencial=${esencial ? 1 : 0};`);
  /* Por el ejecutor del repo: el driver de las pruebas cambia el mensaje del
     RAISERROR por «statement is not prepared» y no se podria leer la causa. */
  const r0 = ejecutar(DB, `DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${galleta}, 2, 50);
    EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`, { permitirFallo: true });
  const normal = r0.ok ? null : String(r0.error || r0.mensaje || JSON.stringify(r0));
  check('V01', /stock suficiente/i.test(normal || ''), 'con la suscripción vigente, sin existencia no se vende (como siempre)', (normal || '').slice(0, 60));
  let err = null;
  try { await vender(true); } catch (e) { err = e.message; }
  const venta = await uno(`SELECT TOP 1 id, venta_esencial, total FROM dbo.sales ORDER BY id DESC`);
  check('V02', !err && venta.venta_esencial === true && Number(venta.total) === 100, 'Venta Esencial: el producto vendible sin existencia SÍ se vende y cobra', err || `venta ${venta.id}`);
  const despues = await uno(`SELECT stock, sellable, inventory_mode FROM dbo.products WHERE id = ${galleta}`);
  const movs = (await uno(`SELECT COUNT(*) n FROM dbo.inventory_movements WHERE reference = N'${venta.id}'`)).n;
  check('V03', Number(despues.stock) === Number(antes.stock) && movs === 0, 'no se descuenta existencia ni se crean movimientos', `stock ${despues.stock}, movimientos ${movs}`);
  check('V04', despues.sellable === antes.sellable && despues.inventory_mode === antes.inventory_mode
    && (await uno(`SELECT sellable FROM dbo.products WHERE id = ${leche}`)).sellable === false,
    'no se modifica ningún producto; el ingrediente sigue sin ser vendible');
  const menu = JSON.stringify((await q('EXEC dbo.sp_get_menu_catalog'))[0] || []);
  check('V04', !menu.includes('Leche (ingrediente)'), 'el ingrediente no aparece mágicamente en el menú');
  const res = await uno('EXEC dbo.sp_venta_esencial_resumen');
  check('V05', res.ventas === 1 && res.desde && res.hasta, 'el resumen para el aviso de renovación: 1 venta, con fechas', JSON.stringify(res));

  // ======================================================== M · matriz de Venta Esencial
  seccion('Matriz de Venta Esencial: DIRECT · RECIPE · NONE × vendible × existencia');
  {
    /* 12 productos: cada modo de inventario, vendible o no, con y sin
       existencia. En RECIPE la existencia es la del ingrediente (el producto
       de receta no tiene stock propio): cada uno con su propio ingrediente. */
    const casos = [];
    let n = 0;
    for (const modo of ['DIRECT', 'RECIPE', 'NONE']) {
      for (const vendible of [1, 0]) {
        for (const stock of [5, 0]) {
          n++;
          const nombre = `M${n} ${modo} ${vendible ? 'vendible' : 'no vendible'} stock ${stock}`;
          const pid = Number(Object.values((await q(`
            EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'MX-${n}', @name=N'${nombre}', @price=40, @stock=${modo === 'RECIPE' ? 0 : stock},
              @category=${cat}, @inventory_mode='${modo}', @sellable=${vendible}, @base_uom='pza', @allow_decimal_qty=0, @cost=8;`))[0][0])[0]);
          let ingr = null;
          if (modo === 'RECIPE') {
            ingr = Number(Object.values((await q(`
              EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'MX-${n}-I', @name=N'M${n} insumo', @price=1, @stock=${stock},
                @category=${cat}, @inventory_mode='DIRECT', @sellable=0, @base_uom='pza', @allow_decimal_qty=0, @cost=2;`))[0][0])[0]);
            await q(`DECLARE @l dbo.RecipeLineType; INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${ingr}, 1, 'pza');
                     EXEC dbo.sp_save_recipe @product_id = ${pid}, @Lines = @l;`);
          }
          casos.push({ n, modo, vendible, stock, pid, ingr, nombre });
        }
      }
    }
    const foto = async () => JSON.stringify((await q(`
      SELECT p.id, p.stock, p.sellable, p.inventory_mode, p.active,
             (SELECT STRING_AGG(CONCAT(rl.ingredient_product_id, ':', rl.input_qty, rl.input_uom), ',')
                FROM dbo.recipes r JOIN dbo.recipe_lines rl ON rl.recipe_id = r.id WHERE r.product_id = p.id) AS receta
        FROM dbo.products p WHERE p.part_number LIKE N'MX-%' ORDER BY p.id`))[0]);
    const movs = async () => (await uno(`SELECT COUNT(*) n FROM dbo.inventory_movements`)).n;
    const antes = await foto();
    const movsAntes = await movs();
    const ventaSql = (pid, esencial) => `DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
      INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${pid}, 1, 40);
      EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
        @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo, @venta_esencial=${esencial ? 1 : 0};`;
    const ultimaVenta = async () => (await uno(`SELECT TOP 1 id, venta_esencial FROM dbo.sales ORDER BY id DESC`));

    for (const c of casos) {
      const previa = (await ultimaVenta()).id;
      const r = ejecutar(DB, ventaSql(c.pid, true), { permitirFallo: true });
      const tras = await ultimaVenta();
      const etiqueta = `${c.modo} · ${c.vendible ? 'vendible' : 'NO vendible'} · existencia ${c.stock}`;
      if (c.vendible) {
        const movsVenta = (await uno(`SELECT COUNT(*) n FROM dbo.inventory_movements WHERE reference = N'${tras.id}'`)).n;
        check('M01', r.ok && tras.id !== previa && tras.venta_esencial === true && movsVenta === 0,
          `${etiqueta}: se vende y cobra, sin descontar ni generar movimientos`, r.ok ? `venta ${tras.id}` : String(r.error || r.mensaje).slice(0, 80));
      } else {
        /* PowerShell parte el mensaje a lo ancho de la consola: se compara sin espacios. */
        const msg = String(r.error || r.mensaje || '');
        check('M02', !r.ok && tras.id === previa && /noesunproductodeventa/i.test(msg.replace(/\s+/g, '')),
          `${etiqueta}: NO se vende (tampoco llamando el procedimiento a mano)`, msg.slice(0, 70));
      }
    }
    check('M03', (await movs()) === movsAntes, 'ninguna de las 12 generó movimientos de inventario');
    check('M04', (await foto()) === antes, 'ningún producto cambió: existencias, vendible, inventory_mode, activo y recetas intactos');

    const menu = JSON.stringify((await q('EXEC dbo.sp_get_menu_catalog'))[0] || []);
    const retail = (await q('EXEC dbo.sp_get_active_products'))[0] || [];
    const noVendibles = casos.filter(c => !c.vendible);
    check('M05', noVendibles.every(c => !menu.includes(c.nombre)) && !menu.includes('insumo'),
      'los no vendibles y los ingredientes no aparecen en el menú de venta');
    check('M05', noVendibles.every(c => retail.find(p => Number(p.id) === c.pid)?.sellable === false),
      'y el catálogo de la caja los marca no vendibles (la pantalla de venta filtra sellable)');

    // SALE_ONLY -> ACTIVE: la misma base, ya sin Venta Esencial.
    const d5 = casos.find(c => c.modo === 'DIRECT' && c.vendible && c.stock === 5);
    const d0 = casos.find(c => c.modo === 'DIRECT' && c.vendible && c.stock === 0);
    const r5 = casos.find(c => c.modo === 'RECIPE' && c.vendible && c.stock === 5);
    const n5 = casos.find(c => c.modo === 'NONE' && c.vendible && c.stock === 5);
    const nv = casos.find(c => c.modo === 'DIRECT' && !c.vendible && c.stock === 5);
    await q(ventaSql(d5.pid, false));
    await q(ventaSql(r5.pid, false));
    await q(ventaSql(n5.pid, false));
    const st = async (id) => Number((await uno(`SELECT stock FROM dbo.products WHERE id = ${id}`)).stock);
    check('M06', (await st(d5.pid)) === 4 && (await st(r5.ingr)) === 4 && (await st(n5.pid)) === 5,
      'de vuelta en ACTIVE: DIRECT descuenta su existencia, RECIPE descuenta el ingrediente, NONE no lleva inventario');
    const rs0 = ejecutar(DB, ventaSql(d0.pid, false), { permitirFallo: true });
    check('M06', !rs0.ok && /stock suficiente/i.test(String(rs0.error || rs0.mensaje)),
      'de vuelta en ACTIVE: sin existencia vuelve a no venderse (el control regresó intacto)');
    const final = JSON.parse(await foto());
    const inicial = JSON.parse(antes);
    const igualConfig = inicial.every(a => { const b = final.find(x => x.id === a.id);
      return b && b.sellable === a.sellable && b.inventory_mode === a.inventory_mode && b.active === a.active && b.receta === a.receta; });
    check('M07', igualConfig && (await uno(`SELECT sellable FROM dbo.products WHERE id = ${nv.pid}`)).sellable === false,
      'SALE_ONLY -> ACTIVE: toda la configuración original (modo, vendible, recetas) permanece; solo las ventas nuevas movieron existencias');
  }

  // ======================================================== Q · cuotas
  seccion('Pantallas Operativas: cuota por giro en el servidor');
  const cocina = (await uno(`EXEC dbo.sp_prep_station_save @nombre = N'Cocina', @salida = 'PANTALLA'`)).id;
  host = crearHost({ pool, puerto: PUERTO, licencia: () => ev });
  await host.iniciar();
  const emparejarYCanjear = async (superficie, extra = {}) => {
    const r = await host.emparejar({ userId: user, superficie, nombre: `${superficie} ${Math.random().toString(36).slice(2, 6)}`, ...extra });
    if (!r.ok) return { r };
    const tablet = crearTablet(PUERTO);
    const canje = await tablet.post('/api/pair', { token: r.url.split('/pair/')[1] });
    return { r, canje, tablet };
  };
  const p1 = await emparejarYCanjear('PREPARATION', { stationId: cocina });
  const p2 = await emparejarYCanjear('CUSTOMER_STATUS');
  const p3 = await emparejarYCanjear('CUSTOMER_STATUS');
  check('Q01', [p1, p2, p3].every(p => p.r.ok && p.canje.status === 200), 'Restaurantes: 3 pantallas conectadas');
  const p4 = await emparejarYCanjear('WAITER');
  check('Q02', !p4.r.ok && /hasta 3/.test(p4.r.error), 'la 4.ª se rechaza al generar su QR, con un mensaje claro', p4.r.error);
  const lista = (await host.dispositivos()).filter(d => !d.revocado);
  const barra = lista.find(d => d.superficie === 'CUSTOMER_STATUS');
  await host.revocar(barra.id, user);
  const p5 = await emparejarYCanjear('WAITER');
  check('Q03', p5.r.ok && p5.canje.status === 200, 'revocar una libera su lugar: ahora sí entra el mesero');
  check('Q04', (await host.dispositivos()).filter(d => !d.revocado).length === 3, 'ningún dispositivo que ya trabajaba se desconectó');
  // El QR se generó con lugar, pero la licencia bajó antes de canjearlo.
  ev = lic('ACTIVE', { HOSPITALITY: 10 });
  const qr = await host.emparejar({ userId: user, superficie: 'CUSTOMER_STATUS', nombre: 'TV pendiente' });
  ev = lic('ACTIVE', { HOSPITALITY: 3 });
  const tardio = await crearTablet(PUERTO).post('/api/pair', { token: qr.url.split('/pair/')[1] });
  check('Q05', qr.ok && tardio.status === 403 && tardio.json?.motivo === 'CUOTA', 'al canjear se vuelve a revisar la cuota: si ya no cabe, no entra', `${tardio.status}`);
  ev = lic('ACTIVE', { HOSPITALITY: 10 });
  const p6 = await emparejarYCanjear('CUSTOMER_STATUS');
  check('Q06', p6.r.ok && p6.canje.status === 200, 'con la ampliación a 10, la 4.ª entra');
  const mismo = (await host.dispositivos()).find(d => !d.revocado && d.superficie === 'WAITER');
  ev = lic('ACTIVE', { HOSPITALITY: 4 });
  const cambio = await host.cambiarFuncion({ id: mismo.id, superficie: 'CUSTOMER_STATUS', userId: user });
  check('Q07', cambio.ok, 'cambiar la función de una pantalla dentro del mismo giro no cuenta doble');

  // ======================================================== L · licencia
  seccion('Sin suscripción: las pantallas lo dicen');
  ev = lic('SALE_ONLY', { HOSPITALITY: 10 });
  const e1 = await p1.tablet.get('/api/s/estado');
  check('L01', e1.status === 409 && e1.json?.codigo === 'LICENCIA' && /suscripción/i.test(e1.json?.error || ''),
    'Venta Esencial: la cocina responde «suscripción» (no «apagada»), sin tocar el dispositivo', `${e1.status} ${e1.json?.codigo}`);
  const e2 = await host.emparejar({ userId: user, superficie: 'CUSTOMER_STATUS', nombre: 'otra' });
  check('L02', !e2.ok && /suscripción/i.test(e2.error), 'no se emparejan pantallas nuevas en Venta Esencial', e2.error);
  ev = lic('ACTIVE', { HOSPITALITY: 10 });
  const e3 = await p1.tablet.get('/api/s/estado');
  check('L03', e3.status === 200, 'al renovar, la misma pantalla vuelve a funcionar sin volver a emparejarla');
} catch (e) {
  console.error('\nERROR', e.stack || e.message);
  check('Z', false, 'la prueba se interrumpió', e.message);
} finally {
  try { await host?.detener(); } catch { /* noop */ }
  try { await pool?.close(); } catch { /* noop */ }
  borrarBase(DB);
}
const { falla } = resumen({ grupos: { 'Venta Esencial': 'V', 'Matriz Venta Esencial': 'M', 'Cuota de pantallas': 'Q', 'Licencia en pantallas': 'L' } });
process.exit(falla.length ? 1 : 0);
