/**
 * UN MES DE UNA TAQUERÍA, AUDITADO PESO POR PESO Y GRAMO POR GRAMO.
 *
 *     npm run e2e:taqueria             (30 días)
 *     TAQUERIA_DIAS=5 npm run e2e:taqueria     (de 1 a 90 días)
 *
 * Electron de verdad, con los MISMOS canales que usan las pantallas (Touch,
 * Mesas, Compras, Egresos, Corte): nada se escribe a mano en SQL salvo la
 * fecha. La taquería tiene carne por kilo y recetas en gramos, mesas con
 * comandas a la plancha, mostrador para llevar, refrescos de reventa,
 * proveedores a crédito y de contado, gastos, sueldos semanales, conteos de
 * carne y un corte cada noche.
 *
 * Mientras opera, la prueba lleva SU PROPIA contabilidad (lo que un contador
 * esperaría) y al final la compara con lo que dice Wybix:
 *
 *   · cada corte: efectivo esperado y diferencia;
 *   · cada insumo: existencia y kárdex contra compras − recetas − conteos;
 *   · el estado de resultados del mes: tickets, ventas, IVA, costo congelado,
 *     ajustes, egresos, sueldos y utilidad;
 *   · cuánto se vendió de cada platillo, y la cuenta del proveedor a crédito;
 *   · que no quede ninguna mesa, cuenta ni turno abierto.
 *
 * LA FECHA
 * --------
 * La hora la pone SQL Server. Cada día se opera de verdad y al terminarlo se
 * mueve, en esta base desechable, todo lo que se escribió ese día a su fecha
 * simulada (mismo criterio que usuario-5-dias). El periodo son los N días que
 * terminan ayer.
 *
 * NO SE DETIENE EN EL PRIMER PROBLEMA
 * -----------------------------------
 * Es una auditoría: lo que no cuadra se anota y el negocio sigue. Al final se
 * escribe tmp/e2e-taqueria/reporte.json y la prueba falla si hubo hallazgos.
 *
 * La base es Wybix_E2E_Taqueria (giro HOSPITALITY), nace aquí y se borra al
 * terminar salvo con TAQUERIA_CONSERVAR=1.
 */
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { test, expect, _electron: electron } = require('@playwright/test');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS } = require('./fixtures');

const DB = 'Wybix_E2E_Taqueria';
const DIAS = Math.max(1, Math.min(90, Number(process.env.TAQUERIA_DIAS) || 30));
const SALIDA = path.join(__dirname, '..', 'tmp', 'e2e-taqueria');

// ------------------------------------------------------------------ bitácora
const hallazgos = [];
const notas = [];
const anotar = (dia, que, detalle = '') => {
  hallazgos.push({ dia, que, detalle });
  console.log(`   HALLAZGO [${dia}] ${que}${detalle ? ' · ' + detalle : ''}`);
};
const nota = (que) => { notas.push(que); console.log(`   nota  ${que}`); };

// ------------------------------------------------------- azar reproducible
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(Number(process.env.TAQUERIA_SEMILLA) || 2026);
const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const elegir = (pesos) => { let r = rnd() * pesos.reduce((s, [, p]) => s + p, 0);
  for (const [v, p] of pesos) { r -= p; if (r <= 0) return v; } return pesos[pesos.length - 1][0]; };

const c2 = (n) => Math.round(n * 100) / 100;
const $ = (n) => `$${Number(n).toFixed(2)}`;
const pad = (n) => String(n).padStart(2, '0');
const fechaLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ------------------------------------------------------------------- el menú
/* Insumos: carne y verdura en GRAMOS (la unidad base que Wybix acepta) y se
   compran por KILO (presentación de compra de 1000 g); tortillas por pieza.
   `precios` y `meta` van en la unidad de COMPRA. Los precios cambian semana
   a semana, como en el mercado. */
const INSUMOS = {
  pastor:   { pn: 'INS-PAS', nombre: 'Carne al pastor',    kilo: true, precios: [165, 172, 168, 175, 170], meta: 30,   prov: 'carnes' },
  bistec:   { pn: 'INS-BIS', nombre: 'Bistec de res',      kilo: true, precios: [210, 215, 212, 220, 218], meta: 12,   prov: 'carnes' },
  suadero:  { pn: 'INS-SUA', nombre: 'Suadero',            kilo: true, precios: [190, 192, 195, 190, 198], meta: 10,   prov: 'carnes' },
  tortilla: { pn: 'INS-TOR', nombre: 'Tortilla de maíz',               precios: [0.55, 0.55, 0.6, 0.6, 0.6], meta: 1600, prov: 'tortilleria' },
  harina:   { pn: 'INS-HAR', nombre: 'Tortilla de harina',             precios: [2.5, 2.5, 2.6, 2.6, 2.6],  meta: 120,  prov: 'tortilleria' },
  cebolla:  { pn: 'INS-CEB', nombre: 'Cebolla blanca',     kilo: true, precios: [28, 32, 30, 26, 29],      meta: 8,    prov: 'mercado' },
  cilantro: { pn: 'INS-CIL', nombre: 'Cilantro',           kilo: true, precios: [45, 50, 40, 48, 44],      meta: 3,    prov: 'mercado' },
  pina:     { pn: 'INS-PIN', nombre: 'Piña',               kilo: true, precios: [25, 22, 24, 26, 25],      meta: 6,    prov: 'mercado' },
  queso:    { pn: 'INS-QUE', nombre: 'Queso Oaxaca',       kilo: true, precios: [140, 142, 145, 145, 148], meta: 5,    prov: 'mercado' },
};
for (const i of Object.values(INSUMOS)) { i.uom = i.kilo ? 'g' : 'pza'; i.factor = i.kilo ? 1000 : 1; }
const c4 = (n) => Math.round(n * 10000) / 10000;
/* Platillos: precio con IVA; receta en GRAMOS para lo que se compra por kilo. */
const PLATOS = {
  pastor:  { pn: 'TAC-PAS', nombre: 'Taco al pastor',    precio: 22,  estacion: 'plancha', opciones: true,
             receta: { pastor: 70, tortilla: 2, cebolla: 10, cilantro: 5, pina: 8 } },
  bistec:  { pn: 'TAC-BIS', nombre: 'Taco de bistec',    precio: 25,  estacion: 'plancha', opciones: true,
             receta: { bistec: 75, tortilla: 2, cebolla: 10, cilantro: 5 } },
  suadero: { pn: 'TAC-SUA', nombre: 'Taco de suadero',   precio: 24,  estacion: 'plancha', opciones: true,
             receta: { suadero: 70, tortilla: 2, cebolla: 10, cilantro: 5 } },
  gringa:  { pn: 'GRI-PAS', nombre: 'Gringa al pastor',  precio: 65,  estacion: 'plancha',
             receta: { pastor: 100, harina: 1, queso: 40, pina: 10 } },
  orden:   { pn: 'ORD-PAS5', nombre: 'Orden de 5 al pastor', precio: 100, estacion: 'plancha', opciones: true,
             receta: { pastor: 350, tortilla: 10, cebolla: 50, cilantro: 25, pina: 40 } },
  horchata:{ pn: 'BEB-HOR', nombre: 'Agua de horchata 1 L', precio: 25, estacion: 'barra' },
  refresco:{ pn: 'BEB-REF', nombre: 'Refresco 600 ml',   precio: 28,  reventa: { precios: [15, 15, 15.5, 15.5, 16], meta: 120 } },
};
const PESOS = [['pastor', 34], ['bistec', 14], ['suadero', 12], ['gringa', 10], ['orden', 8], ['horchata', 11], ['refresco', 11]];
const CANTIDAD = { pastor: [2, 6], bistec: [2, 5], suadero: [2, 5], gringa: [1, 2], orden: [1, 1], horchata: [1, 3], refresco: [1, 3] };
const TICKETS_POR_DIA = [30, 28, 32, 34, 46, 55, 50];   // lunes a domingo
const FONDO = 1000;

// ------------------------------------------------------------- las sesiones
async function abrir() {
  const perfil = await nuevoPerfil(DB);
  const app = await electron.launch(opcionesDeArranque(perfil));
  const registro = [];
  app.process().stderr.on('data', (d) => registro.push(String(d)));
  const ventana = await app.firstWindow({ timeout: 120000 });
  await ventana.waitForFunction(() => !!window.electronAPI, null, { timeout: 60000 });
  await ventana.waitForSelector('#username', { timeout: 60000 });
  await ventana.evaluate(() => { try { localStorage.setItem('wx-guide:auto', '0'); } catch { /* noop */ } });
  await ventana.fill('#username', CUENTAS.admin.usuario);
  await ventana.fill('#password', CUENTAS.admin.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await ventana.evaluate(() => window.electronAPI.sesion()))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(CUENTAS.admin.usuario);
  const cerrar = async () => {
    await app.close().catch(() => {});
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
  };
  return { app, ventana, cerrar, registro };
}

test.describe.configure({ mode: 'serial' });

test('Un mes de taquería: mesas, mostrador, compras, gastos, cortes y estado de resultados cuadran', async () => {
  test.setTimeout(3 * 60 * 60 * 1000);
  fs.rmSync(SALIDA, { recursive: true, force: true });
  fs.mkdirSync(SALIDA, { recursive: true });

  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  bases.prepararBase(DB, { perfil: 'HOSPITALITY', modulos: ['hospitality', 'mesas', 'comandas'] });

  const sqlSets = (texto) => { const r = consultarTemporal(DB, texto); if (!r.ok) throw new Error(r.error); return r.sets; };
  const sql = (texto) => { const s = sqlSets(texto); return s.length ? s[s.length - 1] : []; };

  const sesion = await abrir();
  const { ventana } = sesion;
  const api = (m, ...a) => ventana.evaluate(([mm, aa]) => window.electronAPI[mm](...aa), [m, a]);
  const wy = (ruta, p) => ventana.evaluate(([r, pp]) => r.split('.').reduce((o, k) => o[k], window.wybix)(pp), [ruta, p]);
  const filas = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));
  const exigir = (r, que) => { if (!r?.success) throw new Error(`${que}: ${r?.error ?? JSON.stringify(r)}`); return r; };

  try {
    const yo = (await api('sesion')).data.userId;
    const personal = sql(`SELECT id, usuario FROM dbo.users WHERE usuario IN (N'${CUENTAS.encargado.usuario}', N'${CUENTAS.operador.usuario}');`);

    // ==================================================== CONFIGURACIÓN
    /* Como la haría el dueño en Configuración e Inventario, por los canales. */
    await api('createCategory', { nombre: 'Tacos' });
    await api('createCategory', { nombre: 'Bebidas' });
    await api('createCategory', { nombre: 'Insumos' });
    await api('createBrand', { nombre: 'Casa' });
    const cats = filas(await api('getCategories'));
    const cat = (n) => Number(cats.find((c) => (c.namee ?? c.name ?? c.nombre) === n)?.id);
    const marca = Number(filas(await api('getBrands'))[0]?.id);

    const alta = async (pn, nombre, precio, categoria, tasa, control) => {
      const r = await api('agregarProducto', marca, cat(categoria), pn, nombre, precio, 0, null, null, '02', tasa, null, control);
      if (r && r.success === false) throw new Error(`alta de ${nombre}: ${r.error}`);
    };
    for (const i of Object.values(INSUMOS)) await alta(i.pn, i.nombre, 0, 'Insumos', 0, { inventory_mode: 'DIRECT', sellable: 0, base_uom: i.uom, allow_decimal_qty: !!i.kilo });
    for (const p of Object.values(PLATOS)) {
      await alta(p.pn, p.nombre, p.precio, p.reventa || p.pn.startsWith('BEB') ? 'Bebidas' : 'Tacos', 0.16,
        { inventory_mode: p.reventa ? 'DIRECT' : (p.receta ? 'RECIPE' : 'NONE'), sellable: 1, base_uom: 'pza' });
    }
    const ids = Object.fromEntries(sql(`SELECT part_number, id FROM dbo.products;`).map((r) => [r.part_number, Number(r.id)]));
    for (const [k, i] of Object.entries(INSUMOS)) { i.id = ids[i.pn]; expect(i.id, `insumo ${k}`).toBeTruthy(); }
    for (const [k, p] of Object.entries(PLATOS)) { p.id = ids[p.pn]; expect(p.id, `platillo ${k}`).toBeTruthy(); }

    /* Lo que se compra por kilo lleva su presentación «Kilo» = 1000 g. */
    for (const i of Object.values(INSUMOS).filter((x) => x.kilo)) {
      exigir(await wy('presentations.save', { productId: i.id, name: 'Kilo', factorToBase: 1000, isDefault: true }), `presentación Kilo de ${i.nombre}`);
      i.presentacion = Number(sql(`SELECT TOP 1 id FROM dbo.product_presentations WHERE product_id = ${i.id} ORDER BY id DESC;`)[0]?.id);
      expect(i.presentacion, `presentación de ${i.nombre}`).toBeTruthy();
    }

    /* Recetas: en gramos lo que se compra por kilo. */
    for (const p of Object.values(PLATOS).filter((x) => x.receta)) {
      const lines = Object.entries(p.receta).map(([k, q]) => ({
        ingredientProductId: INSUMOS[k].id, inputQty: q, inputUom: INSUMOS[k].uom }));
      exigir(await wy('recipes.save', { productId: p.id, lines }), `receta de ${p.nombre}`);
    }
    const recetaGuardada = sql(`SELECT r.product_id, l.ingredient_product_id, l.qty_base FROM dbo.recipe_lines l JOIN dbo.recipes r ON r.id = l.recipe_id;`);
    for (const p of Object.values(PLATOS).filter((x) => x.receta)) {
      for (const [k, q] of Object.entries(p.receta)) {
        const fila = recetaGuardada.find((x) => Number(x.product_id) === p.id && Number(x.ingredient_product_id) === INSUMOS[k].id);
        if (!fila || Math.abs(Number(fila.qty_base) - q) > 1e-6)
          anotar('config', `La receta de ${p.nombre} no guarda ${q} ${INSUMOS[k].uom} de ${INSUMOS[k].nombre}`, `qty_base ${fila?.qty_base} ≠ ${q}`);
      }
    }

    /* Extras y quitar, en los tacos y la orden. */
    const extras = exigir(await wy('modifiers.save', { name: 'Extras', role: 'ADDON', minSelect: 0, maxSelect: 2, required: false,
      options: [{ name: 'Con queso', priceDelta: 8, effect: 'ADD', ingredientProductId: INSUMOS.queso.id, qtyBase: 30 }] }), 'grupo Extras');
    const quitar = exigir(await wy('modifiers.save', { name: 'Quitar', role: 'ADDON', minSelect: 0, maxSelect: 2, required: false,
      options: [{ name: 'Sin cebolla', priceDelta: 0, effect: 'REMOVE', replacesProductId: INSUMOS.cebolla.id },
                { name: 'Sin cilantro', priceDelta: 0, effect: 'REMOVE', replacesProductId: INSUMOS.cilantro.id }] }), 'grupo Quitar');
    for (const p of Object.values(PLATOS).filter((x) => x.opciones))
      exigir(await wy('modifiers.setProductGroups', { productId: p.id, groupIds: [extras.groupId, quitar.groupId] }), `opciones de ${p.nombre}`);
    const opc = Object.fromEntries(sql(`SELECT name, id FROM dbo.modifier_options;`).map((r) => [r.name, Number(r.id)]));
    const OPCION = {
      queso:    { id: opc['Con queso'], delta: 8, agrega: ['queso', 30] },
      cebolla:  { id: opc['Sin cebolla'], delta: 0, quita: 'cebolla' },
      cilantro: { id: opc['Sin cilantro'], delta: 0, quita: 'cilantro' },
    };

    /* Plancha y barra; el refresco no se prepara. */
    const estacion = {};
    for (const n of ['plancha', 'barra']) {
      const r = exigir(await wy('estaciones.guardar', { nombre: n === 'plancha' ? 'Plancha' : 'Barra', salida: 'PANTALLA' }), `estación ${n}`);
      estacion[n] = r.data[0].id;
    }
    for (const p of Object.values(PLATOS).filter((x) => x.estacion))
      exigir(await wy('estaciones.asignar', { productId: p.id, stationId: estacion[p.estacion] }), `estación de ${p.nombre}`);

    /* El salón: 8 mesas. */
    const area = exigir(await wy('salon.guardarArea', { nombre: 'Salón' }), 'área');
    const mesas = [];
    for (let i = 1; i <= 8; i++) mesas.push(exigir(await wy('salon.guardarMesa', { areaId: area.data[0].id, nombre: `Mesa ${i}` }), `mesa ${i}`).data[0].id);

    /* Proveedores: carnes a crédito; tortillería, mercado y refrescos de contado. */
    const prov = {};
    for (const [k, n] of [['carnes', 'Carnes Don Beto'], ['tortilleria', 'Tortillería La Esperanza'], ['mercado', 'Mercado de Abastos'], ['refrescos', 'Distribuidora de Refrescos']]) {
      prov[k] = Number(exigir(await api('addSupplier', n), `proveedor ${n}`).data.id);
    }

    // ======================================================= EL MODELO
    /* Lo que un contador esperaría, calculado aquí sin preguntarle a Wybix. */
    const modelo = {
      stock: Object.fromEntries([...Object.keys(INSUMOS), 'refresco'].map((k) => [k, 0])),
      costo: Object.fromEntries([...Object.keys(INSUMOS), 'refresco'].map((k) => [k, 0])),
      vendidos: Object.fromEntries(Object.keys(PLATOS).map((k) => [k, 0])),
      tickets: 0, cobrado: 0, devuelto: 0, costoVentas: 0, ajustes: 0, mermas: 0,
      egresos: 0, personal: 0, deudaCarnes: 0, deriva: {},
    };
    const productoDe = (k) => (k === 'refresco' ? PLATOS.refresco : INSUMOS[k]);

    /** Insumos y costo de UNA línea, con sus opciones. */
    function consumoDe(plato, qty, opciones) {
      const p = PLATOS[plato];
      const uso = {};
      if (p.reventa) uso.refresco = qty;
      for (const [k, q] of Object.entries(p.receta || {})) uso[k] = q * qty;
      for (const o of opciones) {
        if (o.quita) delete uso[o.quita];
        if (o.agrega) uso[o.agrega[0]] = (uso[o.agrega[0]] || 0) + o.agrega[1] * qty;
      }
      return uso;
    }

    // ===================================================== EL MES
    const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
    const diaSim = (i) => { const d = new Date(hoy); d.setDate(hoy.getDate() - (DIAS - i)); return d; };   // i = 0..DIAS-1
    const primerDia = fechaLocal(diaSim(0)), ultimoDia = fechaLocal(diaSim(DIAS - 1));
    console.log(`\n== La taquería, del ${primerDia} al ${ultimoDia} (${DIAS} días)`);

    sql(`IF OBJECT_ID('dbo.zz_e2e_marca') IS NULL CREATE TABLE dbo.zz_e2e_marca (tabla SYSNAME NOT NULL PRIMARY KEY, col SYSNAME NOT NULL, max_id BIGINT NOT NULL);`);
    const TIPOS_FECHA = `('date','datetime','datetime2','smalldatetime','datetimeoffset')`;
    const marcar = () => sql(`
      DELETE FROM dbo.zz_e2e_marca;
      DECLARE @s NVARCHAR(MAX) = N'';
      SELECT @s += N'INSERT dbo.zz_e2e_marca SELECT N''' + t.name + N''', N''' + c.name + N''', ISNULL(MAX(' + QUOTENAME(c.name) + N'), 0) FROM dbo.' + QUOTENAME(t.name) + N';'
        FROM sys.tables t JOIN sys.identity_columns c ON c.object_id = t.object_id
       WHERE t.schema_id = SCHEMA_ID('dbo') AND t.name NOT LIKE N'zz[_]%' AND t.name NOT LIKE N'%lease%' AND t.name NOT LIKE N'%licen%'
         AND EXISTS (SELECT 1 FROM sys.columns d JOIN sys.types y ON y.user_type_id = d.user_type_id
                      WHERE d.object_id = t.object_id AND y.name IN ${TIPOS_FECHA} AND d.is_computed = 0);
      EXEC sp_executesql @s;`);
    const mover = (dias) => sql(`
      DECLARE @s NVARCHAR(MAX) = N'';
      SELECT @s += N'DISABLE TRIGGER ALL ON dbo.' + QUOTENAME(m.tabla) + N'; UPDATE dbo.' + QUOTENAME(m.tabla) + N' SET '
               + STRING_AGG(CAST(QUOTENAME(d.name) + N' = DATEADD(day, -${dias}, ' + QUOTENAME(d.name) + N')' AS NVARCHAR(MAX)), N', ')
               + N' WHERE ' + QUOTENAME(m.col) + N' > ' + CAST(m.max_id AS NVARCHAR(20)) + N'; ENABLE TRIGGER ALL ON dbo.' + QUOTENAME(m.tabla) + N';'
        FROM dbo.zz_e2e_marca m
        JOIN sys.columns d ON d.object_id = OBJECT_ID(N'dbo.' + m.tabla)
        JOIN sys.types y ON y.user_type_id = d.user_type_id
       WHERE y.name IN ${TIPOS_FECHA} AND d.is_computed = 0
       GROUP BY m.tabla, m.col, m.max_id;
      EXEC sp_executesql @s;`);

    const cortes = [];
    let devolucionHecha = false, cancelacionHecha = false, mermaIntentada = false;

    for (let i = 0; i < DIAS; i++) {
      const fecha = diaSim(i);
      const dia = fechaLocal(fecha);
      const dow = (fecha.getDay() + 6) % 7;          // 0 = lunes
      const semana = Math.floor(i / 7);
      const t0 = Date.now();
      marcar();

      // ------------------------------------------------ abrir el turno
      exigir(await api('openShift', { user_id: yo, opening_cash: FONDO }), `[${dia}] abrir turno`);
      const turno = sql(`SELECT TOP 1 id, register_id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;`)[0];
      const caja = Number(turno.register_id);
      let efectivo = FONDO;

      // ------------------------------------- compras de la mañana
      const comprar = async (proveedor, metodo, renglones) => {
        if (!renglones.length) return;
        const subtotal = c2(renglones.reduce((s, r) => s + r.cantidad * r.precio, 0));
        const iva = proveedor === 'refrescos' ? c2(subtotal * 0.16) : 0;
        const r = await api('registerPurchase', {
          user_id: yo, supplier_id: prov[proveedor], tax_rate: iva ? 0.16 : 0, tax_amount: iva, subtotal, total: c2(subtotal + iva),
          payment_method: metodo, register_id: caja,
          detalles: renglones.map((x) => ({ product_id: productoDe(x.k).id, cantidad: x.cantidad, precio_unitario: x.precio,
                                            profit_percent: x.margen ?? 0, presentation_id: productoDe(x.k).presentacion ?? null })),
        });
        if (!r?.success) { anotar(dia, `No se registró la compra a ${proveedor}`, r?.error); return; }
        for (const x of renglones) {
          const f = productoDe(x.k).factor ?? 1;
          modelo.stock[x.k] += x.cantidad * f; modelo.costo[x.k] = c4(x.precio / f);
        }
        if (metodo === 'EFECTIVO') efectivo -= c2(subtotal + iva);
        if (metodo === 'CREDITO') modelo.deudaCarnes += c2(subtotal + iva);
      };
      const porSurtir = {};
      for (const [k, ins] of Object.entries(INSUMOS)) {
        const hay = modelo.stock[k] / ins.factor;            // en unidad de compra
        if (hay < ins.meta * 0.5) {
          const falta = ins.meta - hay;
          const cantidad = ins.kilo ? Math.ceil(falta) : Math.ceil(falta / 50) * 50;
          (porSurtir[ins.prov] ||= []).push({ k, cantidad, precio: ins.precios[semana % ins.precios.length] });
        }
      }
      await comprar('carnes', 'CREDITO', porSurtir.carnes || []);
      await comprar('tortilleria', 'EFECTIVO', porSurtir.tortilleria || []);
      await comprar('mercado', 'EFECTIVO', porSurtir.mercado || []);
      const ref = PLATOS.refresco.reventa;
      if (modelo.stock.refresco < ref.meta * 0.4) {
        const costo = ref.precios[semana % ref.precios.length];
        /* El margen que conserva el precio de hoy, como lo calcula Compras. */
        const margen = c2((PLATOS.refresco.precio / (costo * 1.16) - 1) * 100);
        await comprar('refrescos', 'TRANSFERENCIA', [{ k: 'refresco', cantidad: ref.meta - modelo.stock.refresco, precio: costo, margen }]);
        const precio = Number(sql(`SELECT price FROM dbo.products WHERE id = ${PLATOS.refresco.id};`)[0].price);
        if (Math.abs(precio - PLATOS.refresco.precio) > 0.004) {
          anotar(dia, 'Comprar refrescos cambió su precio de venta', `${$(PLATOS.refresco.precio)} → ${$(precio)} con margen ${margen}%`);
          PLATOS.refresco.precio = precio;
        }
      }

      // ---------------------------------------------------- vender
      const nTickets = Math.round(TICKETS_POR_DIA[dow] * (0.85 + rnd() * 0.3));
      const delDia = { tickets: 0, total: 0, efectivo: 0 };

      const armarLineas = () => {
        const n = elegir([[1, 45], [2, 35], [3, 20]]);
        const lineas = [];
        for (let j = 0; j < n; j++) {
          const plato = elegir(PESOS);
          const [a, b] = CANTIDAD[plato];
          const opciones = [];
          if (PLATOS[plato].opciones) {
            if (rnd() < 0.15) opciones.push(OPCION.queso);
            if (rnd() < 0.10) opciones.push(OPCION.cebolla);
            if (rnd() < 0.05) opciones.push(OPCION.cilantro);
          }
          lineas.push({ plato, qty: entre(a, b), opciones });
        }
        return lineas;
      };
      const precioDe = (l) => PLATOS[l.plato].precio + l.opciones.reduce((s, o) => s + o.delta, 0);

      /** ¿Alcanza el inventario? (lo decide el modelo, que es la verdad del negocio). */
      const alcanza = (lineas) => {
        const uso = {};
        for (const l of lineas) for (const [k, q] of Object.entries(consumoDe(l.plato, l.qty, l.opciones))) uso[k] = (uso[k] || 0) + q;
        return Object.entries(uso).every(([k, q]) => modelo.stock[k] + 1e-9 >= q);
      };

      const cobrar = async (lineas, metodo, modo) => {
        const r = await api('registerSaleV2', {
          userId: yo, paymentMethod: metodo, registerId: caja, serviceMode: modo,
          lines: lineas.map((l) => ({ productId: PLATOS[l.plato].id, qty: l.qty, unitPrice: precioDe(l), catalogPrice: null,
                                       options: l.opciones.map((o) => ({ optionId: o.id, quantity: 1 })) })),
        });
        if (!r?.success) { anotar(dia, 'Una venta no se registró', `${r?.error} · ${JSON.stringify(lineas.map((l) => `${l.qty} ${l.plato}`))}`); return null; }
        const total = c2(lineas.reduce((s, l) => s + l.qty * precioDe(l), 0));
        if (r.total != null && Math.abs(Number(r.total) - total) > 0.004) anotar(dia, `La venta ${r.saleId} cobró otro total`, `${$(r.total)} ≠ ${$(total)}`);
        for (const l of lineas) {
          modelo.vendidos[l.plato] += l.qty;
          for (const [k, q] of Object.entries(consumoDe(l.plato, l.qty, l.opciones))) {
            modelo.stock[k] -= q; modelo.costoVentas += q * modelo.costo[k];
          }
        }
        modelo.tickets++; modelo.cobrado += total;
        delDia.tickets++; delDia.total += total;
        if (metodo === 'EFECTIVO') { efectivo += total; delDia.efectivo += total; }
        return { saleId: r.saleId, total, lineas, metodo };
      };

      const ventasDelDia = [];
      for (let t = 0; t < nTickets; t++) {
        let lineas = armarLineas();
        if (!alcanza(lineas)) { nota(`[${dia}] un pedido no alcanzó inventario y se cambió por refresco/horchata`); lineas = [{ plato: 'horchata', qty: 1, opciones: [] }]; }
        const metodo = elegir([['EFECTIVO', 60], ['TARJETA', 30], ['TRANSFERENCIA', 10]]);
        if (rnd() < 0.45) {
          /* MESA: abrir, mandar a la plancha (a veces otra ronda), cobrar, liberar. */
          const mesa = mesas[t % mesas.length];
          const cuenta = exigir(await wy('cuentas.abrir', { mesaId: mesa, personas: entre(1, 4) }), `[${dia}] abrir mesa`).data[0].id;
          const enviar = async (ls) => exigir(await wy('cuentas.enviar', { cuentaId: cuenta, lineas: ls.map((l) => ({
            productId: PLATOS[l.plato].id, cantidad: l.qty, nota: null, origen: randomUUID(),
            opciones: l.opciones.map((o) => ({ optionId: o.id, quantity: 1 })) })) }), `[${dia}] enviar a cocina`);
          await enviar(lineas);
          let cobradas = [...lineas];
          if (rnd() < 0.25) {
            const otra = armarLineas().filter((l) => l.plato !== 'refresco');
            if (otra.length && alcanza([...cobradas, ...otra])) {
              const e = await enviar(otra);
              const comandas = e.data?.comandas ?? e.sets?.[1] ?? [];
              if (!cancelacionHecha && i >= Math.min(7, DIAS - 1) && comandas.length) {
                /* «Ya no quiero lo último»: se cancela la comanda antes de prepararla. */
                const c = exigir(await wy('kds.cancelar', { comandaId: comandas[0].id, motivo: 'El cliente ya no lo quiso' }), `[${dia}] cancelar comanda`);
                cancelacionHecha = !!c;
                const cancelados = new Set(sql(`SELECT product_id FROM dbo.hosp_orden_lineas WHERE cuenta_id = ${cuenta} AND estado <> 'ACTIVA';`).map((x) => Number(x.product_id)));
                cobradas = [...cobradas, ...otra.filter((l) => !cancelados.has(PLATOS[l.plato].id))];
                nota(`[${dia}] mesa ${cuenta}: se canceló una comanda (${[...cancelados].length} producto(s))`);
              } else cobradas = [...cobradas, ...otra];
            }
          }
          /* La caja cobra lo que dice la cuenta, como Touch al abrir la mesa. */
          const enCuenta = (await wy('cuentas.obtener', { cuentaId: cuenta })).sets?.[1] ?? [];
          const totalCuenta = c2(enCuenta.filter((x) => x.estado === 'ACTIVA').reduce((s, x) => s + Number(x.cantidad) * Number(x.precio_unitario), 0)
            + cobradas.reduce((s, l) => s + l.qty * l.opciones.reduce((a, o) => a + o.delta, 0), 0));
          const v = await cobrar(cobradas, metodo, 'DINE_IN');
          if (v) {
            if (Math.abs(totalCuenta - v.total) > 0.004) anotar(dia, `La mesa (cuenta ${cuenta}) dice un total y se cobró otro`, `${$(totalCuenta)} ≠ ${$(v.total)}`);
            exigir(await wy('cuentas.cobrada', { cuentaId: cuenta, saleId: v.saleId }), `[${dia}] liberar mesa`);
            ventasDelDia.push(v);
          }
        } else {
          const v = await cobrar(lineas, metodo, 'TAKEAWAY');
          if (v) ventasDelDia.push(v);
        }
      }

      // ------------------------------------------- devolución (una)
      if (!devolucionHecha && i >= Math.min(14, DIAS - 1)) {
        const v = ventasDelDia.find((x) => x.metodo === 'EFECTIVO' && x.lineas.some((l) => l.plato === 'refresco'));
        if (v) {
          const r = await api('refundSale', { sale_id: v.saleId, user_id: yo, payment_method: 'EFECTIVO', motivo: 'Producto en mal estado',
            note: 'Refresco sin gas', items: [{ product_id: PLATOS.refresco.id, productId: PLATOS.refresco.id, qty: 1, quantity: 1, unit_price: PLATOS.refresco.precio, unitPrice: PLATOS.refresco.precio }] });
          if (!r?.success) anotar(dia, 'No se pudo devolver un refresco', r?.error);
          else {
            devolucionHecha = true;
            efectivo -= PLATOS.refresco.precio; modelo.devuelto += PLATOS.refresco.precio;
            modelo.stock.refresco += 1; modelo.costoVentas -= modelo.costo.refresco;
            nota(`[${dia}] se devolvió un refresco de la venta ${v.saleId}`);
          }
        }
      }

      // ------------------------------------------- merma (una vez)
      if (!mermaIntentada && i >= Math.min(9, DIAS - 1)) {
        mermaIntentada = true;
        const r = await wy('produccion.merma', { productId: INSUMOS.pastor.id, cantidad: 500, motivo: 'Se quemó en el trompo' });
        if (r?.success) { modelo.stock.pastor -= 500; modelo.mermas += 500 * modelo.costo.pastor; nota(`[${dia}] merma de 500 g de pastor registrada`); }
        else nota(`[${dia}] Producción › Merma no acepta un insumo (${r?.error}); la carne quemada sale en el conteo`);
      }

      // ------------------------------------------------- gastos
      const gasto = async (categoria, monto, metodo, notaTxt, extra = {}) => {
        const pago = { category_id: categoria, amount: monto, payment_method: metodo, note: notaTxt, register_id: caja, ...extra };
        let r = await api('egresosRegistrar', pago);
        /* 0096: no alcanza el cajón. Wybix avisa cuánto hay y cuánto falta sin
           registrar nada; el taquero contesta «me los prestaron» y entran al
           cajón junto con el gasto. */
        let prestado = 0;
        if (!r?.success && r?.motivo === 'EFECTIVO_INSUFICIENTE') {
          if (Math.abs(Number(r.disponible) - efectivo) > 0.004)
            anotar(dia, 'El aviso de efectivo dice otro saldo del cajón', `Wybix ${$(r.disponible)} · contador ${$(efectivo)}`);
          r = await api('egresosRegistrar', { ...pago, cubrir: { origen: 'PRESTAMO' } });
          if (r?.success) { prestado = Number(r.cubierto?.monto ?? 0); modelo.prestamos = (modelo.prestamos || 0) + prestado; }
          if (r?.success && Math.abs(prestado - (monto - Math.max(0, efectivo))) > 0.004)
            anotar(dia, 'Entró otro monto de préstamo', `${$(prestado)} ≠ ${$(monto - Math.max(0, efectivo))}`);
        }
        if (!r?.success) { anotar(dia, `No se registró el gasto «${notaTxt}»`, r?.error); return; }
        if (metodo === 'EFECTIVO') {
          efectivo += prestado - monto;
          /* Un cajón no tiene dinero negativo: si Wybix lo deja salir, el corte
             esperará efectivo que nunca existió. */
          if (efectivo < -0.004) anotar(dia, `Wybix dejó sacar del cajón más efectivo del que había («${notaTxt}»)`, `la caja queda en ${$(efectivo)}`);
        }
        if (categoria === 1) modelo.personal += monto; else modelo.egresos += monto;
      };
      /* Renta y luz, cada 30 días (un periodo largo paga varios meses). */
      if (i % 30 === 0) await gasto(2, 9500, 'TRANSFERENCIA', 'Renta del local');
      if (i % 30 === Math.min(14, DIAS - 1)) await gasto(3, 1350, 'TRANSFERENCIA', 'Recibo de luz');
      if (dow === 0 || dow === 3) await gasto(5, 420, 'EFECTIVO', 'Tanque de gas');
      if (dow === 2) await gasto(8, 180, 'EFECTIVO', 'Artículos de limpieza');
      if (dow === 5) for (const p of personal)
        await gasto(1, 2600, 'EFECTIVO', `Sueldo semanal ${p.usuario}`, { staff_user_id: p.id, period_kind: 'SEMANA' });

      // ------------------------------- conteo de carne (cada domingo)
      if (dow === 6) {
        const sistema = Object.fromEntries(sql(`SELECT id, stock FROM dbo.products WHERE id IN (${Object.values(INSUMOS).map((x) => x.id).join(',')});`).map((r) => [Number(r.id), Number(r.stock)]));
        for (const [k, ins] of Object.entries(INSUMOS)) {
          const d = c2(sistema[ins.id] - modelo.stock[k]);
          if (Math.abs(d) >= 0.015) (modelo.deriva[k] ||= []).push({ dia, sistema: sistema[ins.id], real: Number(modelo.stock[k].toFixed(4)), diferencia: d });
        }
        /* El taquero pesa la carne: falta lo que se quemó o se regaló. */
        const fisico = c2(Math.max(0, modelo.stock.pastor - 400));
        const r = await api('inventoryApplyCount', { items: [{ product_id: INSUMOS.pastor.id, fisico }] }).catch((e) => ({ success: false, error: e.message }));
        if (!r?.success) anotar(dia, 'No se pudo aplicar el conteo de carne', r?.error);
        else {
          modelo.ajustes += (fisico - sistema[INSUMOS.pastor.id]) * modelo.costo.pastor;
          modelo.stock.pastor = fisico;
        }
      }

      // --------------------------------------------------- el corte
      /* Lo que cuenta la cajera: dos noches no cuadra. */
      const descuadre = i === Math.min(9, DIAS - 1) ? -40 : i === Math.min(20, DIAS - 1) ? 15 : 0;
      const esperado = c2(efectivo);
      const entregado = c2(esperado + descuadre);
      const r = await api('closeShift', { closure_id: turno.id, cash_delivered: entregado, register_id: caja });
      if (!r?.success) anotar(dia, 'El corte no se pudo cerrar', r?.error);
      const fila = sql(`SELECT cash_expected, cash_delivered, difference, closed_at FROM dbo.cash_closures WHERE id = ${turno.id};`)[0];
      const vendido = sql(`SELECT COUNT(*) n, ISNULL(SUM(total), 0) total FROM dbo.sales WHERE closure_id = ${turno.id};`)[0];
      if (Math.abs(Number(fila.cash_expected) - esperado) > 0.004)
        anotar(dia, 'El corte espera otro efectivo', `Wybix ${$(fila.cash_expected)} · contador ${$(esperado)} (fondo ${FONDO} + ventas ${$(delDia.efectivo)} − salidas)`);
      if (Math.abs(Number(fila.difference) - descuadre) > 0.004)
        anotar(dia, 'La diferencia del corte no es la que se contó', `${$(fila.difference)} ≠ ${$(descuadre)}`);
      if (Number(vendido.n) !== delDia.tickets || Math.abs(Number(vendido.total) - delDia.total) > 0.004)
        anotar(dia, 'Las ventas del turno no son las del día', `${vendido.n} tickets ${$(vendido.total)} ≠ ${delDia.tickets} ${$(delDia.total)}`);
      cortes.push({ dia, tickets: delDia.tickets, ventas: c2(delDia.total), esperado, wybix: Number(fila.cash_expected), diferencia: Number(fila.difference) });

      mover(DIAS - i);
      console.log(`   ${dia}  ${String(delDia.tickets).padStart(3)} tickets  ${$(delDia.total).padStart(10)}  corte ${$(fila.cash_expected).padStart(10)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }

    // ================================================ AUDITORÍA FINAL
    console.log('\n== Auditoría del mes');

    // 1. Inventario y kárdex de cada insumo
    const stockFinal = Object.fromEntries(sql(`SELECT id, stock FROM dbo.products;`).map((r) => [Number(r.id), Number(r.stock)]));
    const kardex = Object.fromEntries(sql(`SELECT product_id, SUM(CASE WHEN typee = 'entrada' THEN quantity WHEN typee = 'salida' THEN -quantity ELSE quantity END) neto FROM dbo.inventory_movements GROUP BY product_id;`)
      .map((r) => [Number(r.product_id), Number(r.neto)]));
    const inventario = [];
    for (const k of [...Object.keys(INSUMOS), 'refresco']) {
      const p = productoDe(k);
      const real = modelo.stock[k], wybix = stockFinal[p.id], kx = kardex[p.id];
      inventario.push({ insumo: p.nombre, uom: p.uom ?? 'pza', esperado: Number(real.toFixed(4)), wybix, kardex: kx });
      if (Math.abs(wybix - real) > 0.015)
        anotar('mes', `La existencia de ${p.nombre} no es la que debería`, `Wybix ${wybix} ${p.uom ?? 'pza'} · compras − recetas − conteos = ${real.toFixed(3)} (${(wybix - real).toFixed(3)})`);
      if (kx != null && Math.abs(kx - wybix) > 0.015)
        anotar('mes', `El kárdex de ${p.nombre} no suma su existencia`, `movimientos ${kx.toFixed(3)} ≠ existencia ${wybix}`);
    }
    for (const [k, filas_] of Object.entries(modelo.deriva))
      anotar('mes', `${INSUMOS[k].nombre}: el inventario se aparta de la receta semana a semana`, filas_.map((x) => `${x.dia}: ${x.diferencia > 0 ? '+' : ''}${x.diferencia}`).join(', '));

    // 2. Estado de resultados del mes
    const er = exigir(await api('estadoResultados', { desde: primerDia, hasta: ultimoDia }), 'estado de resultados');
    const R = er.data?.actual ?? null;
    const neto = modelo.cobrado - modelo.devuelto;
    const ivaEsperado = neto - neto / 1.16;
    const esperadoER = {
      tickets: modelo.tickets, ventas_cobradas: modelo.cobrado, devoluciones_cobradas: modelo.devuelto,
      iva_trasladado: ivaEsperado, ventas_netas: neto - ivaEsperado, costo_ventas: modelo.costoVentas,
      mermas: modelo.mermas, ajustes_inventario: -modelo.ajustes, egresos_generales: modelo.egresos, pagos_personal: modelo.personal,
    };
    esperadoER.utilidad_operacion = esperadoER.ventas_netas - esperadoER.costo_ventas - esperadoER.mermas - esperadoER.ajustes_inventario
      - esperadoER.egresos_generales - esperadoER.pagos_personal;
    const tolerancia = { tickets: 0, iva_trasladado: 0.01 * modelo.tickets, ventas_netas: 0.01 * modelo.tickets, costo_ventas: 1, utilidad_operacion: 0.01 * modelo.tickets + 1, ajustes_inventario: 1, mermas: 0.5 };
    const er_ = {};
    if (!R) anotar('mes', 'El estado de resultados no regresó el periodo', JSON.stringify(er).slice(0, 300));
    else for (const [campo, esp] of Object.entries(esperadoER)) {
      const w = Number(R[campo]);
      er_[campo] = { wybix: w, esperado: c2(esp) };
      if (!Number.isFinite(w) || Math.abs(w - esp) > (tolerancia[campo] ?? 0.01))
        anotar('mes', `Estado de resultados: «${campo}» no cuadra`, `Wybix ${w} · esperado ${c2(esp)}`);
    }

    // 3. Lo vendido por platillo
    const porProducto = er.data?.productos ?? [];
    for (const [k, p] of Object.entries(PLATOS)) {
      const f = porProducto.find((x) => Number(x.id) === p.id);
      const devueltos = k === 'refresco' && devolucionHecha ? 1 : 0;
      const w = Number(f?.cantidad ?? 0);
      if (Math.abs(w - (modelo.vendidos[k] - devueltos)) > 0.001 && Math.abs(w - modelo.vendidos[k]) > 0.001)
        anotar('mes', `Se vendieron ${modelo.vendidos[k]} «${p.nombre}» y el reporte dice ${w}`);
    }

    // 4. Proveedor a crédito
    const cuentaProv = sql(`SELECT ISNULL(SUM(balance), 0) saldo FROM dbo.purchase WHERE supplier_id = ${prov.carnes};`)[0];
    if (Math.abs(Number(cuentaProv.saldo) - modelo.deudaCarnes) > 0.01)
      anotar('mes', 'Lo que se le debe al proveedor de carnes no cuadra', `Wybix ${$(cuentaProv.saldo)} · compras a crédito ${$(modelo.deudaCarnes)}`);

    // 5. Nada abierto
    const abierto = sql(`SELECT (SELECT COUNT(*) FROM dbo.cash_closures WHERE closed_at IS NULL) turnos,
                                (SELECT COUNT(*) FROM dbo.hosp_cuentas WHERE estado NOT IN ('COBRADA', 'LIBERADA', 'CANCELADA')) cuentas;`)[0];
    if (Number(abierto.turnos)) anotar('mes', `Quedaron ${abierto.turnos} turno(s) abiertos`);
    if (Number(abierto.cuentas)) anotar('mes', `Quedaron ${abierto.cuentas} cuenta(s) de mesa sin cerrar`);

    // 6. Cortes contra ventas del periodo
    const ventasPeriodo = sql(`SELECT COUNT(*) n, ISNULL(SUM(total), 0) t, MIN(CAST(datee AS DATE)) desde, MAX(CAST(datee AS DATE)) hasta FROM dbo.sales;`)[0];
    if (Number(ventasPeriodo.n) !== modelo.tickets) anotar('mes', 'Hay ventas de más o de menos en la base', `${ventasPeriodo.n} ≠ ${modelo.tickets}`);

    if (modelo.prestamos) nota(`se cubrieron ${$(modelo.prestamos)} con préstamos cuando el cajón no alcanzaba`);
    const reporte = { dias: DIAS, desde: primerDia, hasta: ultimoDia, tickets: modelo.tickets, cobrado: c2(modelo.cobrado), prestamos: c2(modelo.prestamos || 0),
      estadoResultados: er_, inventario, cortes, deriva: modelo.deriva, notas, hallazgos };
    fs.writeFileSync(path.join(SALIDA, 'reporte.json'), JSON.stringify(reporte, null, 2));
    console.log(`\n   ${modelo.tickets} tickets · ${$(modelo.cobrado)} cobrados · ${hallazgos.length} hallazgo(s)`);
    console.log(`   Reporte: ${path.join(SALIDA, 'reporte.json')}`);
    expect(hallazgos, JSON.stringify(hallazgos, null, 2)).toEqual([]);
  } finally {
    await sesion.cerrar();
    if (!process.env.TAQUERIA_CONSERVAR) { try { temporal.eliminar(DB); } catch { /* noop */ } }
  }
});
