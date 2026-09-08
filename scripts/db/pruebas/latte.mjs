/**
 * El escenario del Latte, exactamente como se probó en la VM.
 *
 *     node scripts/db/pruebas/latte.mjs [--conservar]
 *
 * QUE SE ROMPIO
 * -------------
 * En la prueba real no se pudo crear un producto Hospitality desde Inventario:
 * el formulario sólo mandaba marca, categoria, numero de parte, nombre, precio
 * y stock, asi que TODO producto nacia DIRECT / vendible / pza. Hubo que
 * convertirlo a RECIPE con un UPDATE a mano, y en el camino el formulario
 * permitio capturar "Stock = 3" para un producto que no puede tener
 * existencias propias.
 *
 * QUE COMPRUEBA
 * -------------
 * Que la cadena completa -alta de productos, receta, venta- se sostiene contra
 * SQL de verdad, con las cifras del caso real:
 *
 *   Cafe molido   1000 g      Latte = 18 g cafe + 250 ml leche + 1 vaso + 1 tapa
 *   Leche         5000 ml     precio 55, inventory_mode RECIPE
 *   Vaso 12 oz      50 pza
 *   Tapa            50 pza
 *
 *   vender 1 Latte  ->  982 / 4750 / 49 / 49
 *   vender 2 mas    ->  946 / 4250 / 47 / 47
 *
 * Y que el Latte NO descuenta un stock propio, porque no lo tiene: su
 * disponibilidad sale del ingrediente que primero se acaba.
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
const DB = 'Wybix_TmpLatte';
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
/**
 * El conjunto que contiene una columna dada.
 *
 * `sp_get_menu_catalog` devuelve CINCO: categorias, productos y tres mas que
 * vienen vacios cuando no hay modificadores. Ni el primero ni el ultimo sirven,
 * y elegir por posicion es exactamente como esta prueba se dio por buena sin
 * mirar nada. Se busca por columna.
 */
const conjuntoCon = (sql, columna) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  const s = r.sets.find(x => x.length && Object.prototype.hasOwnProperty.call(x[0], columna));
  return s ?? [];
};
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};
const stock = (id) => Number(escalar(`SELECT stock FROM dbo.products WHERE id = ${id};`));
const cerca = (a, b, eps = 0.001) => Math.abs(Number(a) - Number(b)) < eps;

try {
  console.log(`\nEL LATTE, DE PRINCIPIO A FIN   (${DB})`);

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
    // MISMA regla que electron/migrationsRunner.js. Con un separador mas
    // permisivo, un archivo que el runner rechaza pasaria aqui: la prueba
    // seria mas indulgente que produccion, que es la peor clase de verde.
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
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Cafeteria');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Insumos');`);
  const userId = Number(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id;`));
  const brand = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const catBebida = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Cafeteria';`));
  const catIns = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Insumos';`));

  /** Alta por el MISMO procedimiento que ahora invoca el formulario. */
  const alta = (o) => Number(escalar(`
    EXEC dbo.sp_add_product
      @brand=${brand}, @part_number=N'${o.pn}', @name=N'${o.name}',
      @price=${o.price ?? 0}, @stock=${o.stock ?? 0}, @category=${o.cat},
      @inventory_mode='${o.mode ?? 'DIRECT'}', @sellable=${o.sellable ?? 1},
      @base_uom='${o.uom ?? 'pza'}', @allow_decimal_qty=${o.dec ?? 0},
      @cost=${o.cost ?? 'NULL'};`));

  // La venta en efectivo exige turno abierto, igual que en la caja real.
  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=500, @register_id=1;`);

  seccion('1. Los ingredientes son productos, no otra entidad');
  const cafe  = alta({ pn: 'ING-CAFE',  name: 'Cafe molido', cat: catIns, uom: 'g',   stock: 1000, dec: 1, sellable: 0, cost: 0.30 });
  const leche = alta({ pn: 'ING-LECHE', name: 'Leche',       cat: catIns, uom: 'ml',  stock: 5000, dec: 1, sellable: 0, cost: 0.02 });
  const vaso  = alta({ pn: 'ING-VASO',  name: 'Vaso 12 oz',  cat: catIns, uom: 'pza', stock: 50,   dec: 0, sellable: 0, cost: 1.50 });
  const tapa  = alta({ pn: 'ING-TAPA',  name: 'Tapa',        cat: catIns, uom: 'pza', stock: 50,   dec: 0, sellable: 0, cost: 0.50 });
  check([cafe, leche, vaso, tapa].every(id => id > 0), 'los cuatro insumos se crean con sp_add_product');

  const c = uno(`SELECT base_uom, allow_decimal_qty, sellable, inventory_mode, stock FROM dbo.products WHERE id = ${cafe};`);
  check(c.base_uom === 'g' && Number(c.allow_decimal_qty) === 1 && Number(c.sellable) === 0
        && c.inventory_mode === 'DIRECT' && Number(c.stock) === 1000,
    'el cafe queda en gramos, con decimales, no vendible y con 1000 de existencia');

  const ings = q(`EXEC dbo.sp_get_ingredients;`).map(i => i.product_name);
  check(['Cafe molido', 'Leche', 'Vaso 12 oz', 'Tapa'].every(n => ings.includes(n)),
    'los cuatro aparecen como ingredientes disponibles', `${ings.length} en la lista`);

  seccion('1b. Un alta Retail no cambia');
  // El canal manda NULL en los cinco campos cuando el negocio no es de
  // alimentos y bebidas. Es exactamente esta llamada: sin nada de Hospitality.
  const tornillo = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'RET-TORNILLO', @name=N'Tornillo',
      @price=12, @stock=25, @category=${catBebida};`));
  const t = uno(`SELECT inventory_mode, sellable, base_uom, allow_decimal_qty, stock
                 FROM dbo.products WHERE id = ${tornillo};`);
  check(t.inventory_mode === 'DIRECT' && Number(t.sellable) === 1 && t.base_uom === 'pza'
        && Number(t.allow_decimal_qty) === 0 && Number(t.stock) === 25,
    'sin decir nada nace DIRECT / vendible / pza / sin decimales, con su stock',
    `${t.inventory_mode} / ${t.base_uom} / stock ${t.stock}`);

  seccion('2. Un producto por receta no tiene existencias propias');
  const latte = alta({ pn: 'BEB-LATTE', name: 'Latte', cat: catBebida, price: 55, stock: 3, mode: 'RECIPE' });
  check(stock(latte) === 0,
    'aunque el alta mande stock 3, el Latte nace en 0', `stock = ${stock(latte)}`);

  const malaUnidad = falla(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'X-KG', @name=N'x', @price=1, @stock=0,
      @category=${catIns}, @base_uom='kg';`, 'unidad base');
  check(malaUnidad.ok, 'y una unidad que no es base se rechaza (kg no, g si)');

  seccion('3. La receta');
  q(`
    DECLARE @l dbo.RecipeLineType;
    INSERT INTO @l (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order) VALUES
      (${cafe}, 18, 'g', 0, 1), (${leche}, 250, 'ml', 0, 2),
      (${vaso}, 1, 'pza', 0, 3), (${tapa}, 1, 'pza', 0, 4);
    EXEC dbo.sp_save_recipe @product_id=${latte}, @variant_option_id=NULL, @Lines=@l;`);
  const lineas = q(`
    SELECT rl.ingredient_product_id AS id, rl.qty_base
    FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id = rl.recipe_id
    WHERE r.product_id = ${latte} AND r.variant_option_id IS NULL;`);
  check(lineas.length === 4, 'la receta guarda sus cuatro lineas');
  const qtyDe = (id) => Number(lineas.find(l => l.id === id)?.qty_base ?? -1);
  check(qtyDe(cafe) === 18 && qtyDe(leche) === 250 && qtyDe(vaso) === 1 && qtyDe(tapa) === 1,
    'y en unidad base: 18 g, 250 ml, 1 pza, 1 pza');

  seccion('4. Costo y margen');
  // 18 g x 0.30 + 250 ml x 0.02 + 1 x 1.50 + 1 x 0.50 = 5.40 + 5.00 + 2.00 = 12.40
  const esperado = 18 * 0.30 + 250 * 0.02 + 1.50 + 0.50;
  const vendida = () => uno(`
    SELECT TOP 1 sd.unit_cost FROM dbo.sale_detail sd
    WHERE sd.product_id = ${latte} ORDER BY sd.id DESC;`);

  /** Venta por el mismo procedimiento que usa la caja. */
  const vender = (qty) => uno(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${latte}, ${qty}, 55);
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);

  seccion('5. Vender un Latte');
  vender(1);
  check(stock(cafe) === 982 && stock(leche) === 4750 && stock(vaso) === 49 && stock(tapa) === 49,
    'los ingredientes bajan a 982 / 4750 / 49 / 49',
    `${stock(cafe)} / ${stock(leche)} / ${stock(vaso)} / ${stock(tapa)}`);
  check(stock(latte) === 0, 'y el Latte sigue en 0: no descuenta un stock propio');

  const costo = Number(vendida()?.unit_cost);
  check(cerca(costo, esperado, 0.0051), 'el costo de la linea es la suma de sus ingredientes',
    `${costo} (esperado ${esperado.toFixed(4)})`);
  const margen = (55 - costo) / 55 * 100;
  check(margen > 0 && margen < 100, 'y el margen sale del precio de venta',
    `${margen.toFixed(1)} % sobre 55`);

  seccion('6. Vender dos mas: acumulado de tres');
  vender(2);
  check(stock(cafe) === 946 && stock(leche) === 4250 && stock(vaso) === 47 && stock(tapa) === 47,
    'los ingredientes bajan a 946 / 4250 / 47 / 47',
    `${stock(cafe)} / ${stock(leche)} / ${stock(vaso)} / ${stock(tapa)}`);
  check(stock(latte) === 0, 'el Latte sigue sin existencias propias');

  seccion('7. El ingrediente que primero se acaba manda');
  q(`UPDATE dbo.products SET stock = 100 WHERE id = ${leche};`);
  const antes = { cafe: stock(cafe), vaso: stock(vaso) };
  const sinLeche = falla(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${latte}, 1, 55);
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`, 'stock');
  check(sinLeche.ok, 'con 100 ml de leche el Latte no se vende', sinLeche.error?.slice(0, 90));
  check(stock(cafe) === antes.cafe && stock(vaso) === antes.vaso,
    'y no se descuenta ningun ingrediente: la venta entera se deshace');

  seccion('7b. Las alertas no confunden un tipo con otro');
  // Un producto por receta tiene stock 0 SIEMPRE: no puede salir en "agotados".
  // Un ingrediente no aparece nunca en sale_detail -se consume, no se vende-,
  // asi que tampoco puede salir como "sin rotacion" si se esta gastando.
  const sinRotacion = q(`EXEC dbo.sp_dead_products @limit = 50;`).map(r => r.nombre);
  check(!sinRotacion.includes('Latte'),
    'el Latte no figura como producto sin rotacion', sinRotacion.join(', ') || '(lista vacia)');
  check(!sinRotacion.includes('Cafe molido') && !sinRotacion.includes('Leche'),
    'ni los ingredientes que ya se consumieron');

  // El nuevo, que no se ha tocado nunca, si debe salir.
  const olvidado = alta({ pn: 'DIR-OLVIDADO', name: 'Producto olvidado', cat: catBebida, price: 10, stock: 7 });
  check(q(`EXEC dbo.sp_dead_products @limit = 50;`).some(r => r.nombre === 'Producto olvidado'),
    'y uno que de verdad nunca se movio si aparece', `id ${olvidado}`);

  const agotados = q(`
    SELECT nombre FROM dbo.products
    WHERE active = 1 AND inventory_mode = 'DIRECT' AND stock <= 0;`).map(r => r.nombre);
  check(!agotados.includes('Latte'),
    'y el criterio de agotados deja fuera lo que no se cuenta por unidades',
    agotados.join(', ') || '(ninguno agotado)');

  seccion('7c. Comprar por presentacion sube el inventario convertido');
  // "Tengo 12 cajas de un litro": la presentacion dice cuantas unidades base
  // trae cada una, y la compra las multiplica. Es lo que ya hacia el
  // procedimiento; lo que faltaba era poder definirlas y mandarlas.
  const presLeche = Number(escalar(`
    EXEC dbo.sp_save_product_presentation @product_id=${leche}, @name=N'Caja 1 L',
      @factor_to_base=1000, @is_default=1;`));
  check(presLeche > 0, `presentacion "Caja 1 L" creada (#${presLeche})`);

  const antesLeche = stock(leche);
  const prov = Number(escalar(`
    INSERT INTO dbo.CAT_suppliers (nombre, activo) VALUES (N'Proveedor QA', 1);
    SELECT SCOPE_IDENTITY() AS id;`));
  q(`
    DECLARE @p1 dbo.PurchaseDetailType; DECLARE @p2 dbo.PurchaseDetailType2;
    INSERT INTO @p2 (product_id, quantity, unit_price, profit_percent, presentation_id)
    VALUES (${leche}, 12, 300, 0, ${presLeche});
    EXEC dbo.sp_register_purchase @user_id=${userId}, @supplier_id=${prov},
      @subtotal=3600, @tax_rate=16, @tax_amount=576, @total=4176,
      @PurchaseDetails=@p1, @PurchaseDetails2=@p2;`);
  check(stock(leche) === antesLeche + 12000,
    '12 cajas de 1 L suben 12000 ml, no 12',
    `${antesLeche} -> ${stock(leche)}`);

  // Y sin presentacion, el comportamiento de siempre: 1 a 1.
  const antesVaso = stock(vaso);
  q(`
    DECLARE @p1 dbo.PurchaseDetailType; DECLARE @p2 dbo.PurchaseDetailType2;
    INSERT INTO @p2 (product_id, quantity, unit_price, profit_percent, presentation_id)
    VALUES (${vaso}, 25, 2, 0, NULL);
    EXEC dbo.sp_register_purchase @user_id=${userId}, @supplier_id=${prov},
      @subtotal=50, @tax_rate=16, @tax_amount=8, @total=58,
      @PurchaseDetails=@p1, @PurchaseDetails2=@p2;`);
  check(stock(vaso) === antesVaso + 25,
    'sin presentacion, 25 piezas suben 25', `${antesVaso} -> ${stock(vaso)}`);

  seccion('7d. El catalogo dice QUE falta, no solo que falta algo');
  // Se deja la leche corta a proposito: es el caso de la VM, donde se
  // capturaron 12 -pensando en cajas- sobre una receta que pide 250 ml.
  q(`UPDATE dbo.products SET stock = 12 WHERE id = ${leche};`);
  const menu = conjuntoCon(`EXEC dbo.sp_get_menu_catalog;`, 'product_name');
  const fila = menu.find(p => p.product_name === 'Latte');
  check(!!fila, 'el Latte aparece en el catalogo Touch');
  check(Number(fila?.available_units) === 0, 'con 12 ml de leche no se puede armar ninguno',
    `available_units = ${fila?.available_units}`);
  check(fila?.limita_nombre === 'Leche',
    'y el catalogo NOMBRA al ingrediente que lo limita', String(fila?.limita_nombre));
  check(Number(fila?.limita_stock) === 12 && Number(fila?.limita_necesita) === 250 && fila?.limita_uom === 'ml',
    'con las dos cifras: lo que hay y lo que pide cada unidad',
    `hay ${fila?.limita_stock} ${fila?.limita_uom}, pide ${fila?.limita_necesita}`);

  // Repuesta la leche EN UNIDAD BASE, vuelve a poderse vender.
  q(`UPDATE dbo.products SET stock = 12000 WHERE id = ${leche};`);
  const menu2 = conjuntoCon(`EXEC dbo.sp_get_menu_catalog;`, 'product_name');
  const fila2 = menu2.find(p => p.product_name === 'Latte');
  check(Number(fila2?.available_units) > 0,
    'con 12000 ml -las mismas 12 cajas, bien capturadas- vuelve a haber',
    `available_units = ${fila2?.available_units}`);

  // Un producto DIRECT no debe traer nada de esto.
  const directo = menu2.find(p => p.product_name === 'Tornillo');
  check(!!directo && directo.limita_nombre === null,
    'y un producto normal no arrastra el dato: solo aplica a recetas',
    directo ? `limita_nombre = ${directo.limita_nombre}` : 'NO se encontro la fila');

  seccion('8. Convertir un producto con existencias en receta');
  const galleta = alta({ pn: 'DIR-GALLETA', name: 'Galleta', cat: catBebida, price: 20, stock: 12, cost: 5 });
  check(stock(galleta) === 12, 'un producto directo si conserva sus existencias');
  q(`EXEC dbo.sp_update_product @product_id=${galleta}, @nombre=N'Galleta', @precio=20, @stock=12,
       @numero_parte=N'DIR-GALLETA', @inventory_mode='RECIPE';`);
  check(stock(galleta) === 0,
    'al pasarla a receta el procedimiento pone su stock en 0', `stock = ${stock(galleta)}`);
  const movs = Number(escalar(`SELECT COUNT(*) FROM dbo.inventory_movements WHERE product_id = ${galleta};`));
  check(movs === 0,
    'sin registrar movimiento de inventario: es un cambio de tipo, no un ajuste contado',
    'la UI avisa y pide confirmacion antes de llegar aqui');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
