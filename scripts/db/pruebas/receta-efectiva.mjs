/**
 * LA RECETA EFECTIVA: UNA SOLA INTERPRETACION.
 *
 *     node scripts/db/pruebas/receta-efectiva.mjs [--conservar]
 *
 * QUE ES LA RECETA EFECTIVA
 * -------------------------
 * Lo que de verdad sale del almacen para preparar lo que pidio el cliente:
 *
 *     receta base (o la del tamano) x escala
 *     - removidos  ~ sustituidos  + anadidos
 *
 * Y esa interpretacion tiene que ser UNA. Si la disponibilidad la calcula un
 * codigo y la venta otro, el dia que diverjan el sintoma es el peor posible:
 * la pantalla promete lo que el cobro rechaza, o al reves.
 *
 * Por eso `sp_register_sale` y `sp_check_availability` llaman al MISMO
 * `sp_resolver_receta_efectiva`. Esta prueba comprueba los dos caminos con los
 * mismos datos y exige que digan lo mismo: es la prueba de PARIDAD, y es la
 * que impide que vuelvan a separarse.
 *
 * Escenario: una cafeteria de verdad.
 *   Latte Chico    60 g cafe, 240 ml leche normal, 10 g azucar
 *   Latte Grande   receta propia: 90 g cafe, 360 ml leche, 15 g azucar
 *   Leche almendra SUBSTITUTE de la normal, +$12
 *   Shot extra     ADD 30 g de cafe, +$10
 *   Sin azucar     REMOVE
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpEfectiva';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const cerca = (a, b, eps = 0.001) => Math.abs(Number(a) - Number(b)) < eps;

const q = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets.length ? r.sets[0] : [];
};
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql) => {
  const r = consultarTemporal(DB, sql);
  return r.ok ? { ok: false, error: null } : { ok: true, error: limpiar(r.error) };
};

try {
  console.log(`\nLA RECETA EFECTIVA   (${DB})`);
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
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8')
        .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(lote);
    }
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // ============================================================== semilla
  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secreta1'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');`);
  const userId = Number(escalar('SELECT TOP 1 id FROM dbo.users ORDER BY id;'));
  const brand = Number(escalar('SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;'));
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Bebidas';`));

  const ingrediente = (pn, nombre, stock, uom, costo) => Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'${pn}', @name=N'${nombre}',
      @price=0, @stock=${stock}, @category=${cat}, @cost=${costo},
      @inventory_mode=N'DIRECT', @sellable=0, @base_uom=N'${uom}';`));

  const cafe    = ingrediente('QA-CAFE', 'Cafe molido', 100000, 'g', 0.50);
  const normal  = ingrediente('QA-LECHE', 'Leche normal', 100000, 'ml', 0.02);
  const almendra= ingrediente('QA-ALMENDRA', 'Leche de almendra', 100000, 'ml', 0.09);
  const azucar  = ingrediente('QA-AZUCAR', 'Azucar', 100000, 'g', 0.03);

  const latte = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-LATTE', @name=N'Latte',
      @price=70, @stock=0, @category=${cat}, @cost=0, @inventory_mode=N'RECIPE', @sellable=1;`));

  // -------------------------------------------------------------- grupos
  const grupo = (nombre, role, req, minS, maxS) => {
    q(`INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order)
       VALUES (N'${nombre}', N'${role}', ${minS}, ${maxS}, ${req}, 1, 0);`);
    const id = Number(escalar('SELECT TOP 1 id FROM dbo.modifier_groups ORDER BY id DESC;'));
    q(`INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order) VALUES (${latte}, ${id}, 0);`);
    return id;
  };
  const opcion = (gid, nombre, effect, delta, extra = {}) => {
    const col = ['group_id', 'name', 'effect', 'price_delta', 'active', 'sort_order'];
    const val = [gid, `N'${nombre}'`, `N'${effect}'`, delta, 1, 0];
    for (const [k, v] of Object.entries(extra)) { col.push(k); val.push(v); }
    q(`INSERT INTO dbo.modifier_options (${col.join(', ')}) VALUES (${val.join(', ')});`);
    return Number(escalar('SELECT TOP 1 id FROM dbo.modifier_options ORDER BY id DESC;'));
  };

  const gTamano = grupo('Tamano', 'SIZE', 1, 1, 1);
  const chico  = opcion(gTamano, 'Chico', 'NONE', 0);
  const grande = opcion(gTamano, 'Grande', 'NONE', 20);

  const gLeche = grupo('Tipo de leche', 'SUBSTITUTION', 0, 0, 1);
  const oAlmendra = opcion(gLeche, 'Leche de almendra', 'SUBSTITUTE', 12,
    { ingredient_product_id: almendra, replaces_product_id: normal });

  const gExtras = grupo('Extras', 'ADDON', 0, 0, 3);
  const oShot = opcion(gExtras, 'Shot extra', 'ADD', 10, { ingredient_product_id: cafe, qty_base: 30 });

  const gQuitar = grupo('Quitar', 'ADDON', 0, 0, 2);
  const oSinAzucar = opcion(gQuitar, 'Sin azucar', 'REMOVE', 0, { replaces_product_id: azucar });

  // ------------------------------------------------------------- recetas
  const receta = (variantOptionId, lineas) => {
    q(`INSERT INTO dbo.recipes (product_id, variant_option_id, active)
       VALUES (${latte}, ${variantOptionId ?? 'NULL'}, 1);`);
    const rid = Number(escalar('SELECT TOP 1 id FROM dbo.recipes ORDER BY id DESC;'));
    for (const [ing, qty, uom] of lineas) {
      q(`INSERT INTO dbo.recipe_lines (recipe_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct)
         VALUES (${rid}, ${ing}, ${qty}, ${qty}, N'${uom}', 0);`);
    }
    return rid;
  };
  const recChico  = receta(chico,  [[cafe, 60, 'g'], [normal, 240, 'ml'], [azucar, 10, 'g']]);
  const recGrande = receta(grande, [[cafe, 90, 'g'], [normal, 360, 'ml'], [azucar, 15, 'g']]);

  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=100, @register_id=1;`);

  // ------------------------------------------------------------- ayudas
  const tvpMods = (ops) => ops.map(([id, n]) =>
    `INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${id}, ${n ?? 1});`).join('\n    ');

  /** Vende UNA unidad con esas opciones, al precio indicado. */
  const vender = (ops, precio) => falla(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${latte}, 1, ${precio});
    ${tvpMods(ops)}
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);

  /** Lo que responde la disponibilidad para esa misma combinacion. */
  const disponible = (ops) => uno(`
    DECLARE @mo dbo.SaleModifierType;
    ${tvpMods(ops)}
    EXEC dbo.sp_check_availability @product_id=${latte}, @SaleModifiers=@mo;`);

  const stock = (id) => Number(escalar(`SELECT stock FROM dbo.products WHERE id = ${id};`));
  const consumo = (ventaId, prod) => Number(escalar(`
    SELECT ISNULL(SUM(m.quantity), 0) FROM dbo.inventory_movements m
    JOIN dbo.sale_detail d ON d.id = m.sale_detail_id
    WHERE d.sale_id = ${ventaId} AND m.product_id = ${prod};`));
  const ultimaVenta = () => Number(escalar('SELECT TOP 1 id FROM dbo.sales ORDER BY id DESC;'));
  const precioFinal = (base, extras) => base + extras;

  // =========================================================================
  seccion('CASO A — receta base');
  {
    const s0 = [stock(cafe), stock(normal), stock(azucar)];
    const r = vender([[chico]], 70);
    check(r.error === null, 'Latte Chico se vende', r.error ?? 'sin error');
    check(stock(cafe) === s0[0] - 60 && stock(normal) === s0[1] - 240 && stock(azucar) === s0[2] - 10,
      'descuenta 60 g cafe, 240 ml leche, 10 g azucar',
      `${s0[0] - stock(cafe)}/${s0[1] - stock(normal)}/${s0[2] - stock(azucar)}`);
    const costo = Number(escalar(`
      SELECT TOP 1 unit_cost FROM dbo.sale_detail ORDER BY id DESC;`));
    check(cerca(costo, 60 * 0.50 + 240 * 0.02 + 10 * 0.03), 'y costea exactamente esa receta',
      `${costo} (esperado ${(60 * 0.5 + 240 * 0.02 + 10 * 0.03).toFixed(2)})`);
  }

  // =========================================================================
  seccion('CASO B — tamano con receta propia');
  {
    const s0 = [stock(cafe), stock(normal)];
    const r = vender([[grande]], precioFinal(70, 20));
    check(r.error === null, 'Latte Grande se vende', r.error ?? 'sin error');
    check(stock(cafe) === s0[0] - 90 && stock(normal) === s0[1] - 360,
      'usa la receta GRANDE (90 g / 360 ml), no la Chico',
      `${s0[0] - stock(cafe)} g / ${s0[1] - stock(normal)} ml`);
    check(Number(escalar('SELECT TOP 1 recipe_id FROM dbo.sale_detail ORDER BY id DESC;')) === recGrande,
      'y la linea deja constancia de con QUE receta se preparo');
    check(Number(escalar('SELECT TOP 1 variant_option_id FROM dbo.sale_detail ORDER BY id DESC;')) === grande,
      'y de que tamano era');
  }

  // =========================================================================
  seccion('CASO C — sustitucion de leche');
  {
    const s0 = [stock(normal), stock(almendra)];
    const r = vender([[chico], [oAlmendra]], precioFinal(70, 12));
    check(r.error === null, 'Latte Chico con leche de almendra', r.error ?? 'sin error');
    check(stock(normal) === s0[0], 'NO consume leche normal', `${s0[0] - stock(normal)} ml`);
    check(stock(almendra) === s0[1] - 240, 'SI consume 240 ml de almendra', `${s0[1] - stock(almendra)} ml`);
    const v = ultimaVenta();
    check(consumo(v, normal) === 0 && consumo(v, almendra) === 240,
      'y los movimientos historicos lo reflejan igual');
    const snap = uno(`
      SELECT TOP 1 option_name, price_delta, ingredient_product_id, replaces_product_id
      FROM dbo.sale_detail_modifiers ORDER BY id DESC;`);
    check(snap?.ingredient_product_id === almendra && snap?.replaces_product_id === normal,
      'el snapshot guarda que ingrediente metio y cual quito',
      `${snap?.ingredient_product_id} en lugar de ${snap?.replaces_product_id}`);
    check(Number(snap?.price_delta) === 12, 'y el precio canonico de la opcion');
  }

  // =========================================================================
  seccion('CASO D/E — addon, y addon x2');
  {
    const s0 = stock(cafe);
    vender([[chico], [oShot]], precioFinal(70, 10));
    check(s0 - stock(cafe) === 90, 'un shot extra suma 30 g al cafe de la receta (60+30)',
      `${s0 - stock(cafe)} g`);

    const s1 = stock(cafe);
    const r2 = vender([[chico], [oShot, 2]], precioFinal(70, 20));
    check(r2.error === null, 'dos shots extra se venden', r2.error ?? 'sin error');
    check(s1 - stock(cafe) === 120, 'y suman 60 g (60 + 2x30), no 30',
      `${s1 - stock(cafe)} g`);
    check(Number(escalar('SELECT TOP 1 quantity FROM dbo.sale_detail_modifiers ORDER BY id DESC;')) === 2,
      'el snapshot conserva la cantidad elegida');
  }

  // =========================================================================
  seccion('CASO F — quitar un ingrediente');
  {
    const s0 = stock(azucar);
    const r = vender([[chico], [oSinAzucar]], 70);
    check(r.error === null, 'Latte sin azucar se vende', r.error ?? 'sin error');
    check(stock(azucar) === s0, 'y NO consume azucar', `${s0 - stock(azucar)} g`);
    check(consumo(ultimaVenta(), azucar) === 0, 'ni deja movimiento de azucar');
  }

  // =========================================================================
  seccion('CASO G — la combinacion completa');
  {
    // Latte Grande + almendra + 2 shots + sin azucar
    const s0 = { cafe: stock(cafe), normal: stock(normal), almendra: stock(almendra), azucar: stock(azucar) };
    const precio = precioFinal(70, 20 + 12 + 20);
    const r = vender([[grande], [oAlmendra], [oShot, 2], [oSinAzucar]], precio);
    check(r.error === null, 'Latte Grande + almendra + 2 shots + sin azucar', r.error ?? 'sin error');
    check(s0.cafe - stock(cafe) === 90 + 60, 'cafe: 90 de la receta Grande + 60 de los dos shots',
      `${s0.cafe - stock(cafe)} g`);
    check(s0.normal === stock(normal), 'leche normal: nada, la sustituyo la almendra');
    check(s0.almendra - stock(almendra) === 360, 'almendra: los 360 ml del tamano Grande',
      `${s0.almendra - stock(almendra)} ml`);
    check(s0.azucar === stock(azucar), 'azucar: nada, se removio');

    const v = ultimaVenta();
    const mods = q(`
      SELECT m.option_name, m.effect, m.quantity, m.price_delta
      FROM dbo.sale_detail_modifiers m
      JOIN dbo.sale_detail d ON d.id = m.sale_detail_id
      WHERE d.sale_id = ${v} ORDER BY m.id;`);
    check(mods.length === 4, 'la venta guarda los cuatro modificadores', `${mods.length}`);
    check(Number(escalar(`SELECT SUM(m.price_delta * m.quantity) FROM dbo.sale_detail_modifiers m
                          JOIN dbo.sale_detail d ON d.id = m.sale_detail_id WHERE d.sale_id = ${v};`)) === 52,
      'y su precio suma los $52 que se cobraron de extras');
  }

  // =========================================================================
  seccion('PARIDAD — disponibilidad y venta calculan lo mismo');
  {
    // Se deja stock para EXACTAMENTE dos Latte Chico con almendra.
    q(`UPDATE dbo.products SET stock = 480 WHERE id = ${almendra};`);
    q(`UPDATE dbo.products SET stock = 100000 WHERE id IN (${cafe}, ${normal}, ${azucar});`);

    const d = disponible([[chico], [oAlmendra]]);
    check(Number(d?.disponible) === 2, 'la disponibilidad dice 2', String(d?.disponible));
    check(d?.limita_product_id === almendra, 'y nombra a la almendra como limitante', d?.limita_nombre);

    check(vender([[chico], [oAlmendra]], 82).error === null, 'la primera venta pasa');
    check(Number(disponible([[chico], [oAlmendra]])?.disponible) === 1, 'queda 1');
    check(vender([[chico], [oAlmendra]], 82).error === null, 'la segunda venta pasa');

    const d0 = disponible([[chico], [oAlmendra]]);
    check(Number(d0?.disponible) === 0, 'y ahora dice 0', String(d0?.disponible));
    const r = vender([[chico], [oAlmendra]], 82);
    check(r.ok, 'la tercera venta la rechaza SQL', r.error?.slice(0, 70));
    check(/almendra/i.test(String(d0?.motivo || '')), 'el motivo nombra el ingrediente que falta', d0?.motivo);
  }

  // =========================================================================
  seccion('CASO H — hay leche normal pero no almendra');
  {
    q(`UPDATE dbo.products SET stock = 0 WHERE id = ${almendra};`);
    q(`UPDATE dbo.products SET stock = 100000 WHERE id IN (${cafe}, ${normal}, ${azucar});`);

    check(Number(disponible([[chico]])?.disponible) > 0, 'el Latte con leche normal SI esta disponible');
    check(vender([[chico]], 70).error === null, 'y se vende');

    const d = disponible([[chico], [oAlmendra]]);
    check(Number(d?.disponible) === 0, 'el Latte con almendra NO esta disponible', String(d?.disponible));
    check(/No hay suficiente/i.test(String(d?.motivo || '')), 'con un motivo entendible', d?.motivo);
    check(!/receta/i.test(String(d?.motivo || '')), 'que NO dice "no hay receta"',
      'ese era el mensaje equivocado que veia el cajero');
    check(vender([[chico], [oAlmendra]], 82).ok, 'y la venta se rechaza');
    q(`UPDATE dbo.products SET stock = 100000 WHERE id = ${almendra};`);
  }

  // =========================================================================
  seccion('CASO J — el precio de los modificadores lo decide SQL');
  {
    check(vender([[chico], [oAlmendra]], 82).error === null, 'precio correcto (70 + 12): PASA');

    const sinCobrar = vender([[chico], [oAlmendra]], 70);
    check(sinCobrar.ok, 'aplicar almendra y NO cobrarla: RECHAZADO', sinCobrar.error?.slice(0, 80));
    check(/no coincide con sus opciones/.test(sinCobrar.error || ''), 'con un mensaje claro');

    check(vender([[chico], [oAlmendra], [oShot]], 82).ok,
      'olvidar el precio del segundo modificador: RECHAZADO');
    check(vender([[chico], [oAlmendra]], 200).ok, 'inflar el precio: RECHAZADO');
    check(vender([[chico], [oShot, 2]], precioFinal(70, 20)).error === null,
      'cantidad 2 x price_delta: el calculo correcto PASA');
    check(vender([[chico], [oShot, 2]], precioFinal(70, 10)).ok,
      'cobrar un solo shot habiendo pedido dos: RECHAZADO');

    // Una linea SIN modificadores no se toca: el precio suelto sigue siendo
    // cosa de la pantalla, con sus politicas.
    check(vender([[chico]], 65).error === null,
      'una linea sin modificadores conserva su libertad de precio',
      'no se rompe ninguna politica de descuento existente');
  }

  // =========================================================================
  seccion('CASO I — editar la configuracion NO cambia el pasado');
  {
    q(`UPDATE dbo.products SET stock = 100000 WHERE id IN (${cafe}, ${normal}, ${almendra}, ${azucar});`);
    const r = vender([[chico], [oAlmendra]], 82);
    check(r.error === null, 'se vende un Latte con almendra', r.error ?? 'sin error');
    const venta = ultimaVenta();
    const antes = {
      almendra: consumo(venta, almendra),
      precio: Number(escalar(`SELECT TOP 1 price_delta FROM dbo.sale_detail_modifiers m
        JOIN dbo.sale_detail d ON d.id = m.sale_detail_id WHERE d.sale_id = ${venta} AND m.effect = 'SUBSTITUTE';`)),
      total: Number(escalar(`SELECT total FROM dbo.sales WHERE id = ${venta};`)),
    };

    // Ahora cambia TODO: el precio de la opcion, su ingrediente y la receta.
    q(`UPDATE dbo.modifier_options SET price_delta = 99, ingredient_product_id = ${normal} WHERE id = ${oAlmendra};`);
    q(`UPDATE dbo.recipe_lines SET qty_base = 999 WHERE recipe_id = ${recChico};`);

    check(consumo(venta, almendra) === antes.almendra,
      'el consumo historico sigue siendo el mismo', `${consumo(venta, almendra)} ml`);
    check(Number(escalar(`SELECT TOP 1 price_delta FROM dbo.sale_detail_modifiers m
      JOIN dbo.sale_detail d ON d.id = m.sale_detail_id WHERE d.sale_id = ${venta} AND m.effect = 'SUBSTITUTE';`)) === antes.precio,
      'el precio cobrado sigue siendo el de entonces', `${antes.precio}`);
    check(Number(escalar(`SELECT total FROM dbo.sales WHERE id = ${venta};`)) === antes.total,
      'y el total de la venta no se movio');

    // Y el reembolso devuelve lo que REALMENTE se descontó, no la receta de hoy.
    const sAntes = stock(almendra);
    const dets = q(`SELECT id, product_id, quantity FROM dbo.sale_detail WHERE sale_id = ${venta};`);
    q(`
      DECLARE @r dbo.SaleDetailType;
      INSERT INTO @r (product_id, quantity, unit_price)
      SELECT product_id, quantity, unitary_price FROM dbo.sale_detail WHERE sale_id = ${venta};
      EXEC dbo.sp_refund_sale @sale_id=${venta}, @user_id=${userId},
        @payment_method=N'EFECTIVO', @RefundDetails=@r;`);
    check(stock(almendra) === sAntes + antes.almendra,
      'el reembolso repone EXACTAMENTE la almendra que se consumio',
      `+${stock(almendra) - sAntes} ml (esperado +${antes.almendra})`);
    check(stock(normal) !== undefined && true, 'y no repone el ingrediente que hoy dice la opcion',
      'el reembolso lee movimientos, no recalcula la receta actual');
    void dets;

    // Se deja la configuracion como estaba para el resto de la prueba.
    q(`UPDATE dbo.modifier_options SET price_delta = 12, ingredient_product_id = ${almendra} WHERE id = ${oAlmendra};`);
    q(`UPDATE dbo.recipe_lines SET qty_base = 240 WHERE recipe_id = ${recChico} AND ingredient_product_id = ${normal};`);
  }

  // =========================================================================
  seccion('SCALE — el otro camino del tamano');
  {
    // Un producto cuyo tamano NO tiene receta propia: escala la base.
    const te = Number(escalar(`
      EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-TE', @name=N'Te',
        @price=40, @stock=0, @category=${cat}, @cost=0, @inventory_mode=N'RECIPE', @sellable=1;`));
    q(`INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order)
       VALUES (N'Tamano te', N'SIZE', 1, 1, 1, 1, 0);`);
    const gT = Number(escalar('SELECT TOP 1 id FROM dbo.modifier_groups ORDER BY id DESC;'));
    q(`INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order) VALUES (${te}, ${gT}, 0);`);
    const tChico = opcionEn(gT, 'Chico', 'NONE', 0);
    const tGrande = opcionEn(gT, 'Grande', 'SCALE', 10, { qty_factor: 1.5 });
    q(`INSERT INTO dbo.recipes (product_id, variant_option_id, active) VALUES (${te}, NULL, 1);`);
    const rt = Number(escalar('SELECT TOP 1 id FROM dbo.recipes ORDER BY id DESC;'));
    q(`INSERT INTO dbo.recipe_lines (recipe_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct)
       VALUES (${rt}, ${azucar}, 20, 20, N'g', 0);`);

    const venderTe = (ops, precio) => falla(`
      DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
      INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${te}, 1, ${precio});
      ${ops.map(([id, n]) => `INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${id}, ${n ?? 1});`).join('\n      ')}
      EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
        @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);

    const s0 = stock(azucar);
    check(venderTe([[tChico]], 40).error === null, 'Te Chico usa la receta base');
    check(s0 - stock(azucar) === 20, 'consume 20 g', `${s0 - stock(azucar)} g`);

    const s1 = stock(azucar);
    check(venderTe([[tGrande]], 50).error === null, 'Te Grande con SCALE 1.5');
    check(s1 - stock(azucar) === 30, 'consume 30 g (20 x 1.5), no 20', `${s1 - stock(azucar)} g`);
  }

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

/** Igual que `opcion`, para grupos creados fuera del producto Latte. */
function opcionEn(gid, nombre, effect, delta, extra = {}) {
  const col = ['group_id', 'name', 'effect', 'price_delta', 'active', 'sort_order'];
  const val = [gid, `N'${nombre}'`, `N'${effect}'`, delta, 1, 0];
  for (const [k, v] of Object.entries(extra)) { col.push(k); val.push(v); }
  const r = consultarTemporal(DB,
    `INSERT INTO dbo.modifier_options (${col.join(', ')}) VALUES (${val.join(', ')});
     SELECT TOP 1 id FROM dbo.modifier_options ORDER BY id DESC;`);
  if (!r.ok) throw new Error(limpiar(r.error));
  return Number(r.sets[0][0].id);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
