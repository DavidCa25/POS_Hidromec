/**
 * Cinco bebidas: compra, receta, merma, disponibilidad, venta y margen.
 *
 *     node scripts/db/pruebas/bebidas.mjs [--conservar]
 *
 * PARA QUE SIRVE
 * --------------
 * Una cafeteria de verdad encadena cuatro calculos, y cada uno se alimenta
 * del anterior:
 *
 *     compra  ->  costo por unidad base  ->  costo de la receta  ->  margen
 *                        |                          |
 *                        |                          +-> disponibilidad
 *                        +-> stock en unidad base       (que ingrediente limita)
 *                                   |
 *                                   +-> lo que descuenta cada venta
 *
 * Si uno se desvia, los tres siguientes mienten sin avisar. Esta prueba fija
 * las cifras de punta a punta, todas calculadas a mano en los comentarios,
 * para que un cambio que las mueva se vea aqui y no en la caja del cliente.
 *
 * LAS CINCO BEBIDAS, Y QUE ROMPE CADA UNA
 * ---------------------------------------
 *   Latte        el caso base: dos dimensiones (peso y volumen) y un
 *                desechable, sin merma.
 *   Capuchino    MERMA del 15% en la leche. La merma tiene que subir el
 *                costo, bajar la disponibilidad Y descontar de mas al vender;
 *                si solo hace lo primero, el inventario se descuadra solo.
 *   Americano    comparte el cafe con las otras dos: dos recetas compitiendo
 *                por el mismo insumo.
 *   Frappe       la receta se captura en LITROS y el ingrediente vive en
 *                mililitros. La conversion pasa en `sp_save_recipe`, una sola
 *                vez, al configurar; la venta nunca convierte.
 *   Chocolate    merma sobre un ingrediente caro (el polvo) y un tercer
 *                insumo de bajo consumo (el jarabe), para que el que limita
 *                NO sea el mas barato ni el mas usado.
 *
 * Corre sobre una restauracion del baseline, no sobre ninguna base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpBebidas';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const q = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets.length ? r.sets[0] : [];
};
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
/** El conjunto que contiene una columna dada: elegir por posicion engana. */
const conjuntoCon = (sql, columna) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets.find(s => s.length && Object.prototype.hasOwnProperty.call(s[0], columna)) ?? [];
};
const cerca = (a, b, eps = 0.0005) => Math.abs(Number(a) - Number(b)) < eps;
const pesos = (n) => `$${Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;

try {
  console.log(`\nCINCO BEBIDAS, DE LA COMPRA AL MARGEN   (${DB})`);

  if (!existsSync(BAK)) {
    console.log(`   ----   falta ${BAK}: es un artefacto derivado (npm run db:baseline).`);
    process.exit(0);
  }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en'))
      .filter(f => !aplicadas.has(f))) {
    // MISMA regla que electron/migrationsRunner.js: con un separador mas
    // permisivo, un archivo que el runner rechaza pasaria aqui.
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8')
        .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(lote);
    }
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // --------------------------------------------------------------- base
  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secreta1'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Insumos');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');
    INSERT INTO dbo.CAT_suppliers (nombre, activo) VALUES (N'Abarrotes del Centro', 1);`);
  const userId = Number(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id;`));
  const brand  = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const catIns = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Insumos';`));
  const catBeb = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Bebidas';`));
  const prov   = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_suppliers ORDER BY id DESC;`));

  const alta = (o) => Number(escalar(`
    EXEC dbo.sp_add_product
      @brand=${brand}, @part_number=N'${o.pn}', @name=N'${o.name}',
      @price=${o.price ?? 0}, @stock=0, @category=${o.cat},
      @inventory_mode='${o.mode ?? 'DIRECT'}', @sellable=${o.sellable ?? 1},
      @base_uom='${o.uom ?? 'pza'}', @allow_decimal_qty=${o.dec ?? 0},
      @cost=NULL;`));

  const presentacion = (productId, nombre, factor) => Number(escalar(`
    EXEC dbo.sp_save_product_presentation
      @product_id=${productId}, @name=N'${nombre}', @factor_to_base=${factor}, @is_default=1;
    SELECT TOP 1 id FROM dbo.product_presentations
    WHERE product_id = ${productId} AND name = N'${nombre}' ORDER BY id DESC;`));

  const guardarReceta = (productId, lineas) => {
    const filas = lineas.map((l, i) =>
      `(${l.ing}, ${l.qty}, N'${l.uom}', ${l.merma ?? 0}, ${i + 1})`).join(', ');
    const r = consultarTemporal(DB, `
      DECLARE @L dbo.RecipeLineType;
      INSERT INTO @L (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order)
      VALUES ${filas};
      EXEC dbo.sp_save_recipe @product_id=${productId}, @Lines=@L;`);
    return r.ok ? { ok: true } : { ok: false, error: limpiar(r.error) };
  };

  const producto = (id) => uno(`SELECT stock, cost, price, sellable FROM dbo.products WHERE id = ${id};`);
  const costoReceta = (id) => Number(
    (conjuntoCon(`EXEC dbo.sp_get_recipe @product_id=${id};`, 'unit_cost')[0] ?? {}).unit_cost);
  const catalogo = () => conjuntoCon('EXEC dbo.sp_get_menu_catalog;', 'available_units');

  // ============================================== insumos y presentaciones
  //
  // Nacen SIN costo y SIN existencias: el costo tiene que llegar de la
  // compra. Si se sembrara aqui, la prueba nunca comprobaria la compra.
  const cafe   = alta({ pn: 'INS-CAFE',   name: 'Cafe molido',        cat: catIns, uom: 'g',   dec: 1, sellable: 0 });
  const leche  = alta({ pn: 'INS-LECHE',  name: 'Leche entera',       cat: catIns, uom: 'ml',  dec: 1, sellable: 0 });
  const choco  = alta({ pn: 'INS-CHOCO',  name: 'Chocolate en polvo', cat: catIns, uom: 'g',   dec: 1, sellable: 0 });
  const hielo  = alta({ pn: 'INS-HIELO',  name: 'Hielo',              cat: catIns, uom: 'g',   dec: 1, sellable: 0 });
  const vaso   = alta({ pn: 'INS-VASO',   name: 'Vaso 12 oz',         cat: catIns, uom: 'pza', dec: 0, sellable: 0 });
  const jarabe = alta({ pn: 'INS-JARABE', name: 'Jarabe de vainilla', cat: catIns, uom: 'ml',  dec: 1, sellable: 0 });

  const pBolsa   = presentacion(cafe,   'Bolsa 400 g',   400);
  const pCaja    = presentacion(leche,  'Caja 1 L',      1000);
  const pBote    = presentacion(choco,  'Bote 500 g',    500);
  const pCostal  = presentacion(hielo,  'Bolsa 5 kg',    5000);
  const pPaquete = presentacion(vaso,   'Paquete 50',    50);
  const pBotella = presentacion(jarabe, 'Botella 750 ml', 750);

  // ================================================== bebidas (con receta)
  const latte     = alta({ pn: 'BEB-LATTE', name: 'Latte',              cat: catBeb, mode: 'RECIPE', price: 85 });
  const capuchino = alta({ pn: 'BEB-CAPU',  name: 'Capuchino',          cat: catBeb, mode: 'RECIPE', price: 90 });
  const americano = alta({ pn: 'BEB-AMER',  name: 'Americano',          cat: catBeb, mode: 'RECIPE', price: 55 });
  const frappe    = alta({ pn: 'BEB-FRAP',  name: 'Frappe de chocolate',cat: catBeb, mode: 'RECIPE', price: 110 });
  const chocolate = alta({ pn: 'BEB-CHOC',  name: 'Chocolate caliente', cat: catBeb, mode: 'RECIPE', price: 75 });

  // =============================================================== 1
  seccion('1. La compra fija el costo POR UNIDAD BASE');

  // Una sola compra con los seis insumos, cada uno en su presentacion.
  //   4 bolsas x  95 = 380      12 cajas   x  22 = 264
  //   2 botes  x  85 = 170       1 costal  x  35 =  35
  //   2 paq.   x  60 = 120       1 botella x 180 = 180
  //   subtotal 1149 · IVA 16% 183.84 · total 1332.84
  const compra = (() => {
    const r = consultarTemporal(DB, `
      DECLARE @d1 dbo.PurchaseDetailType; DECLARE @d2 dbo.PurchaseDetailType2;
      INSERT INTO @d2 (product_id, quantity, unit_price, profit_percent, presentation_id) VALUES
        (${cafe},    4, 95,  0, ${pBolsa}),
        (${leche},  12, 22,  0, ${pCaja}),
        (${choco},   2, 85,  0, ${pBote}),
        (${hielo},   1, 35,  0, ${pCostal}),
        (${vaso},    2, 60,  0, ${pPaquete}),
        (${jarabe},  1, 180, 0, ${pBotella});
      EXEC dbo.sp_register_purchase
        @user_id=${userId}, @supplier_id=${prov}, @subtotal=1149, @tax_rate=0.16,
        @tax_amount=183.84, @total=1332.84, @PurchaseDetails=@d1, @PurchaseDetails2=@d2,
        @payment_method=N'CREDITO', @register_id=1;`);
    if (!r.ok) return { ok: false, error: limpiar(r.error) };
    return { ok: true, ...((r.sets.find(s => s.length && 'purchase_id' in s[0]) ?? [])[0] ?? {}) };
  })();
  check(compra.ok, 'la compra de los seis insumos se registra', compra.error ?? `folio ${compra.purchase_id}`);

  //  insumo   presentacion   precio / factor  =  costo por unidad base   stock
  const esperadoInsumos = [
    { id: cafe,   nombre: 'Cafe molido',        costo: 0.2375, stock: 1600,  uom: 'g',   como: '95 / 400' },
    { id: leche,  nombre: 'Leche entera',       costo: 0.0220, stock: 12000, uom: 'ml',  como: '22 / 1000' },
    { id: choco,  nombre: 'Chocolate en polvo', costo: 0.1700, stock: 1000,  uom: 'g',   como: '85 / 500' },
    { id: hielo,  nombre: 'Hielo',              costo: 0.0070, stock: 5000,  uom: 'g',   como: '35 / 5000' },
    { id: vaso,   nombre: 'Vaso 12 oz',         costo: 1.2000, stock: 100,   uom: 'pza', como: '60 / 50' },
    { id: jarabe, nombre: 'Jarabe de vainilla', costo: 0.2400, stock: 750,   uom: 'ml',  como: '180 / 750' },
  ];
  for (const i of esperadoInsumos) {
    const p = producto(i.id);
    check(cerca(p.cost, i.costo, 0.00005),
      `${i.nombre}: ${i.como} = ${pesos(i.costo)} por ${i.uom}`, `cost = ${p.cost}`);
    check(Number(p.stock) === i.stock,
      `${i.nombre}: entran ${i.stock} ${i.uom}`, `stock = ${p.stock}`);
  }

  seccion('2. Y no le inventa precio de venta a ningun insumo');
  const conPrecio = esperadoInsumos.filter(i => Number(producto(i.id).price) !== 0);
  check(conPrecio.length === 0,
    'los seis siguen en 0: un insumo no se cobra en caja',
    conPrecio.length ? conPrecio.map(i => i.nombre).join(', ') : '6 de 6');

  // =============================================================== 3
  seccion('3. Las recetas: unidades y merma');

  const recetas = [
    { id: latte, nombre: 'Latte', lineas: [
      { ing: cafe,  qty: 12,  uom: 'g'  },
      { ing: leche, qty: 250, uom: 'ml' },
      { ing: vaso,  qty: 1,   uom: 'pza' },
    ]},
    // La leche se espuma y se tira parte: 180 ml capturados consumen 207.
    { id: capuchino, nombre: 'Capuchino', lineas: [
      { ing: cafe,  qty: 12,  uom: 'g'  },
      { ing: leche, qty: 180, uom: 'ml', merma: 15 },
      { ing: vaso,  qty: 1,   uom: 'pza' },
    ]},
    { id: americano, nombre: 'Americano', lineas: [
      { ing: cafe, qty: 18, uom: 'g' },
      { ing: vaso, qty: 1,  uom: 'pza' },
    ]},
    // Capturada en LITROS sobre un ingrediente que vive en mililitros.
    { id: frappe, nombre: 'Frappe de chocolate', lineas: [
      { ing: leche, qty: 0.2, uom: 'L' },
      { ing: choco, qty: 20,  uom: 'g' },
      { ing: hielo, qty: 150, uom: 'g' },
      { ing: vaso,  qty: 1,   uom: 'pza' },
    ]},
    // El polvo se apelmaza: 25 g capturados consumen 27.
    { id: chocolate, nombre: 'Chocolate caliente', lineas: [
      { ing: choco,  qty: 25,  uom: 'g', merma: 8 },
      { ing: leche,  qty: 200, uom: 'ml' },
      { ing: jarabe, qty: 10,  uom: 'ml' },
      { ing: vaso,   qty: 1,   uom: 'pza' },
    ]},
  ];
  for (const r of recetas) {
    const g = guardarReceta(r.id, r.lineas);
    check(g.ok, `${r.nombre}: receta guardada`, g.error ?? `${r.lineas.length} ingredientes`);
  }

  // 0.2 L sobre un ingrediente en ml -> 200 ml. La conversion la hace
  // sp_save_recipe UNA vez, al guardar; la venta nunca convierte.
  const lineaFrappeLeche = uno(`
    SELECT rl.input_qty, rl.input_uom, rl.qty_base
    FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id = rl.recipe_id
    WHERE r.product_id = ${frappe} AND rl.ingredient_product_id = ${leche};`);
  check(lineaFrappeLeche && Number(lineaFrappeLeche.qty_base) === 200,
    'Frappe: 0.2 L capturados quedan como 200 ml en la unidad base',
    lineaFrappeLeche ? `${lineaFrappeLeche.input_qty} ${lineaFrappeLeche.input_uom} -> ${lineaFrappeLeche.qty_base} ml` : 'sin linea');

  // La merma NO se guarda multiplicada: se guarda aparte y se aplica al
  // calcular. Guardarla ya aplicada haria imposible editarla despues.
  const lineaCapuLeche = uno(`
    SELECT rl.qty_base, rl.waste_pct
    FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id = rl.recipe_id
    WHERE r.product_id = ${capuchino} AND rl.ingredient_product_id = ${leche};`);
  check(lineaCapuLeche && Number(lineaCapuLeche.qty_base) === 180 && Number(lineaCapuLeche.waste_pct) === 15,
    'Capuchino: se guardan 180 ml y 15% por separado, no 207 ya multiplicados',
    lineaCapuLeche ? `qty_base ${lineaCapuLeche.qty_base}, merma ${lineaCapuLeche.waste_pct}%` : 'sin linea');

  const rechazoUnidad = consultarTemporal(DB, `
    DECLARE @L dbo.RecipeLineType;
    INSERT INTO @L (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order)
    VALUES (${leche}, 5, N'g', 0, 1);
    EXEC dbo.sp_save_recipe @product_id=${latte}, @Lines=@L;`);
  check(!rechazoUnidad.ok && /unidad/i.test(limpiar(rechazoUnidad.error)),
    'y pedir leche en gramos se rechaza: volumen no es peso',
    rechazoUnidad.ok ? 'paso' : limpiar(rechazoUnidad.error).slice(0, 60));

  // =============================================================== 4
  seccion('4. Costo de cada bebida');

  //  bebida      cuenta a mano                                              = costo
  const esperadoCosto = [
    { id: latte,     nombre: 'Latte',
      cuenta: '12x0.2375 + 250x0.022 + 1.20', costo: 2.85 + 5.50 + 1.20 },              //  9.550
    { id: capuchino, nombre: 'Capuchino',
      cuenta: '12x0.2375 + (180x1.15)x0.022 + 1.20', costo: 2.85 + 4.554 + 1.20 },      //  8.604
    { id: americano, nombre: 'Americano',
      cuenta: '18x0.2375 + 1.20', costo: 4.275 + 1.20 },                                //  5.475
    { id: frappe,    nombre: 'Frappe de chocolate',
      cuenta: '200x0.022 + 20x0.17 + 150x0.007 + 1.20', costo: 4.40 + 3.40 + 1.05 + 1.20 }, // 10.050
    { id: chocolate, nombre: 'Chocolate caliente',
      cuenta: '(25x1.08)x0.17 + 200x0.022 + 10x0.24 + 1.20', costo: 4.59 + 4.40 + 2.40 + 1.20 }, // 12.590
  ];
  for (const b of esperadoCosto) {
    const real = costoReceta(b.id);
    check(cerca(real, b.costo),
      `${b.nombre}: ${b.cuenta} = ${pesos(b.costo)}`, `unit_cost = ${Number(real).toFixed(4)}`);
  }

  // La merma no es decorativa: son 27 centavos por capuchino.
  const capuSinMerma = 2.85 + (180 * 0.022) + 1.20;
  check(cerca(costoReceta(capuchino) - capuSinMerma, 0.594),
    'la merma del 15% le cuesta 59.4 centavos a cada capuchino',
    `${pesos(capuSinMerma)} sin merma vs ${pesos(costoReceta(capuchino))} con merma`);

  // =============================================================== 5
  seccion('5. El precio de venta NO sale de la receta');

  //  La duda de la VM: "el costo de la leche es 0.05, pero ese es el costo,
  //  no el precio". Exacto: son dos numeros distintos y ninguno toca al otro.
  const preciosPuestos = [
    { id: latte, nombre: 'Latte', precio: 85 },
    { id: capuchino, nombre: 'Capuchino', precio: 90 },
    { id: americano, nombre: 'Americano', precio: 55 },
    { id: frappe, nombre: 'Frappe de chocolate', precio: 110 },
    { id: chocolate, nombre: 'Chocolate caliente', precio: 75 },
  ];
  const movidos = preciosPuestos.filter(b => Number(producto(b.id).price) !== b.precio);
  check(movidos.length === 0,
    'las cinco conservan el precio que se les escribio, tras compra y recetas',
    movidos.length ? movidos.map(b => b.nombre).join(', ') : '85 · 90 · 55 · 110 · 75');

  const conStock = preciosPuestos.filter(b => Number(producto(b.id).stock) !== 0);
  check(conStock.length === 0,
    'y ninguna tiene existencias propias: una receta no las tiene',
    conStock.length ? conStock.map(b => b.nombre).join(', ') : '5 en cero');

  // =============================================================== 6
  seccion('6. Disponibilidad: quien se acaba primero');

  //  bebida       cafe 1600  leche 12000  choco 1000  hielo 5000  vaso 100  jarabe 750
  //  Latte          133          48                                 100      -> 48  leche
  //  Capuchino      133          57 (/207)                          100      -> 57  leche
  //  Americano       88           -                                 100      -> 88  cafe
  //  Frappe          -            60          50          33        100      -> 33  hielo
  //  Chocolate       -            60          37 (/27)              100  75  -> 37  choco
  const esperadoLimite = [
    { id: latte,     nombre: 'Latte',              unidades: 48, limita: 'Leche entera',       necesita: 250 },
    { id: capuchino, nombre: 'Capuchino',          unidades: 57, limita: 'Leche entera',       necesita: 207 },
    { id: americano, nombre: 'Americano',          unidades: 88, limita: 'Cafe molido',        necesita: 18 },
    { id: frappe,    nombre: 'Frappe de chocolate',unidades: 33, limita: 'Hielo',              necesita: 150 },
    { id: chocolate, nombre: 'Chocolate caliente', unidades: 37, limita: 'Chocolate en polvo', necesita: 27 },
  ];
  const cat = catalogo();
  for (const b of esperadoLimite) {
    const f = cat.find(x => Number(x.id) === b.id);
    check(f && Number(f.available_units) === b.unidades,
      `${b.nombre}: alcanzan ${b.unidades}`, f ? `available_units = ${f.available_units}` : 'no esta en el catalogo');
    check(f && f.limita_nombre === b.limita && cerca(f.limita_necesita, b.necesita, 0.01),
      `  y el que limita es ${b.limita} (${b.necesita} por unidad)`,
      f ? `${f.limita_nombre}: hay ${f.limita_stock} ${f.limita_uom}, pide ${Number(f.limita_necesita).toFixed(2)}` : '');
  }
  const insumosEnMenu = cat.filter(x => [cafe, leche, choco, hielo, vaso, jarabe].includes(Number(x.id)));
  check(insumosEnMenu.length === 0, 'y ningun insumo aparece en el menu de venta');

  // =============================================================== 7
  seccion('7. La venta descuenta lo que la receta pide, merma incluida');

  const turno = Number(uno(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=500, @register_id=1;`)?.closure_id);
  check(turno > 0, `turno abierto (#${turno})`);

  // 2 Capuchinos + 1 Frappe + 1 Americano = 2x90 + 110 + 55 = 345
  const venta = consultarTemporal(DB, `
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES
      (1, ${capuchino}, 2, 90), (2, ${frappe}, 1, 110), (3, ${americano}, 1, 55);
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO',
      @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);
  check(venta.ok, 'la venta pasa', venta.ok ? '2 capuchinos, 1 frappe, 1 americano' : limpiar(venta.error));

  //  insumo   antes    consumo                                 despues
  //  cafe      1600    2x12 + 1x18            =  42             1558
  //  leche    12000    2x207 + 1x200          = 614            11386   <- con merma
  //  choco     1000    1x20                   =  20              980
  //  hielo     5000    1x150                  = 150             4850
  //  vaso       100    2 + 1 + 1              =   4               96
  //  jarabe     750    nadie lo usa           =   0              750
  const esperadoTrasVenta = [
    { id: cafe,   nombre: 'Cafe molido',        queda: 1558,  uom: 'g',   consumo: '2x12 + 18' },
    { id: leche,  nombre: 'Leche entera',       queda: 11386, uom: 'ml',  consumo: '2x207 + 200' },
    { id: choco,  nombre: 'Chocolate en polvo', queda: 980,   uom: 'g',   consumo: '20' },
    { id: hielo,  nombre: 'Hielo',              queda: 4850,  uom: 'g',   consumo: '150' },
    { id: vaso,   nombre: 'Vaso 12 oz',         queda: 96,    uom: 'pza', consumo: '4' },
    { id: jarabe, nombre: 'Jarabe de vainilla', queda: 750,   uom: 'ml',  consumo: 'ninguno' },
  ];
  for (const i of esperadoTrasVenta) {
    check(Number(producto(i.id).stock) === i.queda,
      `${i.nombre}: quedan ${i.queda} ${i.uom}`, `consumo ${i.consumo}`);
  }

  // Lo que hace visible la merma: 414 ml de leche por dos capuchinos de 180.
  const lecheEnVenta = Number(escalar(`
    SELECT ISNULL(SUM(quantity), 0) FROM dbo.inventory_movements
    WHERE product_id = ${leche} AND typee = 'salida';`));
  check(cerca(lecheEnVenta, 614, 0.01),
    'el movimiento de inventario registra 614 ml, no 560',
    `2 capuchinos consumen 414 (no 360) y el frappe 200`);

  const bebidasConMovimiento = Number(escalar(`
    SELECT COUNT(*) FROM dbo.inventory_movements
    WHERE product_id IN (${latte}, ${capuchino}, ${americano}, ${frappe}, ${chocolate});`));
  check(bebidasConMovimiento === 0,
    'y las bebidas no mueven stock propio: se descuentan sus ingredientes');

  // =============================================================== 8
  seccion('8. Cada linea guarda precio y costo por separado');

  //  El precio es lo que pago el cliente. El costo es lo que costo hacerlo,
  //  a los costos de ESE momento. Guardar solo uno obliga a recalcular la
  //  utilidad despues, y para entonces los costos ya cambiaron.
  const esperadoLinea = [
    { id: capuchino, nombre: 'Capuchino', cant: 2, precio: 90,  costo: 8.604 },
    { id: frappe,    nombre: 'Frappe de chocolate', cant: 1, precio: 110, costo: 10.05 },
    { id: americano, nombre: 'Americano', cant: 1, precio: 55,  costo: 5.475 },
  ];
  for (const l of esperadoLinea) {
    const d = uno(`
      SELECT quantity, unitary_price, unit_cost, inventory_mode
      FROM dbo.sale_detail WHERE product_id = ${l.id};`);
    check(d && Number(d.quantity) === l.cant && cerca(d.unitary_price, l.precio, 0.005),
      `${l.nombre}: ${l.cant} a ${pesos(l.precio)}`, d ? `unitary_price = ${d.unitary_price}` : 'sin linea');
    check(d && cerca(d.unit_cost, l.costo),
      `  con su costo de ${pesos(l.costo)} congelado en la linea`, d ? `unit_cost = ${d.unit_cost}` : '');
  }

  const totalVenta = Number(escalar(`SELECT SUM(quantity * unitary_price) FROM dbo.sale_detail;`));
  const costoVenta = Number(escalar(`SELECT SUM(quantity * unit_cost) FROM dbo.sale_detail;`));
  //  345 cobrado · 2x8.604 + 10.05 + 5.475 = 32.733 de costo
  check(cerca(totalVenta, 345, 0.01), 'la venta suma 345', `${pesos(totalVenta)}`);
  check(cerca(costoVenta, 32.733, 0.01), 'y costo 32.733', `${pesos(costoVenta)}`);

  // =============================================================== 9
  seccion('9. Disponibilidad despues de vender');

  //  Latte      leche 11386/250 = 45      Capuchino  11386/207 = 55
  //  Americano  cafe  1558/18   = 86      Frappe     hielo 4850/150 = 32
  //  Chocolate  choco  980/27   = 36
  const cat2 = catalogo();
  for (const b of [
    { id: latte,     nombre: 'Latte',              unidades: 45 },
    { id: capuchino, nombre: 'Capuchino',          unidades: 55 },
    { id: americano, nombre: 'Americano',          unidades: 86 },
    { id: frappe,    nombre: 'Frappe de chocolate',unidades: 32 },
    { id: chocolate, nombre: 'Chocolate caliente', unidades: 36 },
  ]) {
    const f = cat2.find(x => Number(x.id) === b.id);
    check(f && Number(f.available_units) === b.unidades,
      `${b.nombre}: ahora alcanzan ${b.unidades}`, f ? String(f.available_units) : 'no esta');
  }

  // =============================================================== 10
  seccion('10. Margen: contra el precio SIN IVA');

  //  `price` es de mostrador, con IVA. `cost` viene de la compra y no lo
  //  lleva: el IVA de una compra es acreditable. Compararlos directo infla
  //  el margen con dinero que es del SAT. Misma formula que la pantalla.
  const esperadoMargen = [
    { id: latte,     nombre: 'Latte',               precio: 85,  costo: 9.550,  margen: 86.97 },
    { id: capuchino, nombre: 'Capuchino',           precio: 90,  costo: 8.604,  margen: 88.91 },
    { id: americano, nombre: 'Americano',           precio: 55,  costo: 5.475,  margen: 88.45 },
    { id: frappe,    nombre: 'Frappe de chocolate', precio: 110, costo: 10.050, margen: 89.40 },
    { id: chocolate, nombre: 'Chocolate caliente',  precio: 75,  costo: 12.590, margen: 80.53 },
  ];
  for (const b of esperadoMargen) {
    const p = uno(`SELECT price, tasa_iva, objeto_impuesto FROM dbo.products WHERE id = ${b.id};`);
    const tasa = p.objeto_impuesto !== '02' ? 0 : Number(p.tasa_iva);
    const sinIva = Number(p.price) / (1 + tasa);
    const margen = ((sinIva - b.costo) / sinIva) * 100;
    check(cerca(margen, b.margen, 0.01),
      `${b.nombre}: ${b.margen}% sobre ${pesos(sinIva.toFixed(2))} sin IVA`,
      `${margen.toFixed(2)}%`);
  }

  // Por que importa: el margen ingenuo -contra el precio con IVA- siempre
  // sale mas alto. Aqui son 2.7 puntos; con costos altos son muchos mas.
  const ingenuo = ((75 - 12.59) / 75) * 100;
  check(ingenuo - 80.53 > 2.5,
    'el calculo ingenuo (contra el precio con IVA) exagera el margen',
    `Chocolate: ${ingenuo.toFixed(2)}% ingenuo vs 80.53% real`);

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
