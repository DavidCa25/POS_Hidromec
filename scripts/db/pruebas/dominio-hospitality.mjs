/**
 * Pruebas funcionales del dominio Hospitality (migracion 0002).
 *
 *     npm run db:test-migration -- --conservar     (deja Wybix_MigTest lista)
 *     node scripts/db/pruebas/dominio-hospitality.mjs
 *
 * Cubre: unidades, productos DIRECT/RECIPE/NONE, recetas base y por
 * variante con conversion de unidades, modificadores con semantica explicita,
 * presentaciones de compra y compra con conversion a unidad base, y las
 * guardas de un solo nivel (sin ciclos).
 */
import { q, rows, row, scalar, fails, check, seccion, resumen, cerca, fixtureCafe, DB } from './lib.mjs';

console.log(`Base de pruebas: ${DB}`);

seccion('Unidades de medida');
const uoms = rows(`EXEC dbo.sp_get_uoms;`);
check(uoms.length >= 14, `sp_get_uoms devuelve ${uoms.length} unidades`);
check(uoms.filter(u => u.is_base).map(u => u.code).sort().join(',') === 'cm,g,ml,pza', 'una unidad base por dimension (pza, g, ml, cm)');
check(cerca(uoms.find(u => u.code === 'kg').factor_to_base, 1000), 'kg = 1000 g');

seccion('Productos');
const f = fixtureCafe();
const latte = row(`SELECT inventory_mode, sellable, base_uom, stock, cost FROM dbo.products WHERE id = ${f.latte}`);
check(latte.inventory_mode === 'RECIPE' && Number(latte.stock) === 0, 'producto RECIPE nace con stock 0');
const cafe = row(`SELECT inventory_mode, sellable, base_uom, stock, cost FROM dbo.products WHERE id = ${f.cafe}`);
check(cafe.base_uom === 'g' && Number(cafe.sellable) === 0 && cerca(cafe.cost, 0.30), 'ingrediente en gramos, no vendible, costo 0.3000 por g (DECIMAL 14,4)');
check(fails(`EXEC dbo.sp_add_product @brand=${f.brand}, @part_number=N'X-BAD-UOM', @name=N'x', @price=1, @stock=0, @category=${f.catIng}, @base_uom='kg';`, 'unidad base').ok,
  'rechaza kg como unidad base (solo pza, g, ml, cm)');
check(fails(`EXEC dbo.sp_add_product @brand=${f.brand}, @part_number=N'X-BAD-MODE', @name=N'x', @price=1, @stock=0, @category=${f.catIng}, @inventory_mode='HYBRID';`, 'inventory_mode').ok,
  'rechaza inventory_mode invalido');
const retail = row(`SELECT inventory_mode, sellable, base_uom, allow_decimal_qty FROM dbo.products WHERE id = ${f.coca}`);
check(retail.inventory_mode === 'DIRECT' && Number(retail.sellable) === 1 && retail.base_uom === 'pza' && Number(retail.allow_decimal_qty) === 0,
  'un producto Retail sin parametros nuevos queda DIRECT / vendible / pza / sin decimales');

seccion('Modificadores');
// Tamano: SIZE con SCALE (Grande = 1.5x) y Chico sin efecto
let r = row(`
  DECLARE @o dbo.ModifierOptionType;
  INSERT INTO @o (name, price_delta, effect, qty_factor, sort_order) VALUES (N'Chico', 0, 'NONE', NULL, 1), (N'Grande', 10, 'SCALE', 1.5, 2);
  EXEC dbo.sp_save_modifier_group @name=N'Tamano', @role='SIZE', @min_select=1, @max_select=1, @required=1, @Options=@o;`);
const gSize = r.group_id;
check(gSize > 0, `grupo SIZE creado (#${gSize})`);
r = row(`
  DECLARE @o dbo.ModifierOptionType;
  INSERT INTO @o (name, price_delta, effect, ingredient_product_id, qty_base) VALUES (N'Extra shot', 12, 'ADD', ${f.cafe}, 9);
  EXEC dbo.sp_save_modifier_group @name=N'Extras', @role='ADDON', @min_select=0, @max_select=3, @Options=@o;`);
const gExtras = r.group_id;
r = row(`
  DECLARE @o dbo.ModifierOptionType;
  INSERT INTO @o (name, price_delta, effect, ingredient_product_id, replaces_product_id) VALUES (N'Leche de almendra', 8, 'SUBSTITUTE', ${f.almendra}, ${f.leche});
  INSERT INTO @o (name, price_delta, effect, replaces_product_id) VALUES (N'Sin azucar', 0, 'REMOVE', ${f.azucar});
  EXEC dbo.sp_save_modifier_group @name=N'Leche y endulzante', @role='SUBSTITUTION', @min_select=0, @max_select=2, @Options=@o;`);
const gSub = r.group_id;
check(gExtras > 0 && gSub > 0, 'grupos ADDON y SUBSTITUTION creados');
check(fails(`DECLARE @o dbo.ModifierOptionType; INSERT INTO @o (name, effect) VALUES (N'x', 'ADD'); EXEC dbo.sp_save_modifier_group @name=N'Malo', @role='ADDON', @Options=@o;`, 'ADD necesita').ok,
  'rechaza ADD sin ingrediente/cantidad');
check(fails(`DECLARE @o dbo.ModifierOptionType; INSERT INTO @o (name, effect, ingredient_product_id, qty_base) VALUES (N'x', 'ADD', ${f.latte}, 1); EXEC dbo.sp_save_modifier_group @name=N'Malo', @role='ADDON', @Options=@o;`, 'inventario directo').ok,
  'rechaza una RECETA como ingrediente de un modificador (un solo nivel)');
check(fails(`DECLARE @o dbo.ModifierOptionType; INSERT INTO @o (name, effect, qty_factor) VALUES (N'x', 'SCALE', 2); EXEC dbo.sp_save_modifier_group @name=N'Nota', @role='NOTE', @Options=@o;`, 'NOTE').ok,
  'un grupo NOTE solo admite effect NONE');

r = row(`EXEC dbo.sp_set_product_modifier_groups @product_id=${f.latte}, @group_ids_json='[${gSize},${gSub},${gExtras}]';`);
check(Number(r.groups_count) === 3, 'grupos ligados al Latte en orden');
const grupos = q(`EXEC dbo.sp_get_modifier_groups @product_id=${f.latte};`);
check(grupos[0].map(g => g.name).join('|') === 'Tamano|Leche y endulzante|Extras', 'sp_get_modifier_groups respeta el orden del producto', grupos[0].map(g => g.name).join('|'));
const opts = grupos[1] || [];
check(opts.length === 5 && opts.find(o => o.name === 'Leche de almendra').replaces_name === 'Leche entera', 'opciones con nombres de ingrediente/sustituido resueltos');
const optGrande = opts.find(o => o.name === 'Grande').id;
const optChico = opts.find(o => o.name === 'Chico').id;
const optShot = opts.find(o => o.name === 'Extra shot').id;
const optAlm = opts.find(o => o.name === 'Leche de almendra').id;
const optSinAz = opts.find(o => o.name === 'Sin azucar').id;

seccion('Recetas');
// Base: 18 g cafe, 0.2 L leche (-> 200 ml), 8 g azucar, 1 vaso, 1 tapa (merma 0)
r = row(`
  DECLARE @l dbo.RecipeLineType;
  INSERT INTO @l (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order) VALUES
    (${f.cafe}, 18, 'g', 0, 1), (${f.leche}, 0.2, 'L', 0, 2), (${f.azucar}, 8, 'g', 0, 3), (${f.vaso}, 1, 'pza', 0, 4), (${f.tapa}, 1, 'pza', 0, 5);
  EXEC dbo.sp_save_recipe @product_id=${f.latte}, @Lines=@l;`);
const recipeBase = r.recipe_id;
check(recipeBase > 0, `receta base del Latte (#${recipeBase})`);
let rec = q(`EXEC dbo.sp_get_recipe @product_id=${f.latte};`);
const lineas = rec[1] || [];
const lLeche = lineas.find(l => l.ingredient_product_id === f.leche);
check(lLeche && cerca(lLeche.qty_base, 200) && Number(lLeche.input_qty) === 0.2 && lLeche.input_uom === 'L', '0.2 L de leche se guarda como 200 ml base y conserva la captura');
// costo: 18*0.30 + 200*0.02 + 8*0.02 + 1.5 + 0.5 = 5.4 + 4 + 0.16 + 2 = 11.56
check(cerca(rec[0][0].unit_cost, 11.56, 0.001), `unit_cost de la receta = 11.56 (${rec[0][0].unit_cost})`);

// Variante Grande: receta propia (24 g cafe, 300 ml leche, vaso, tapa)
r = row(`
  DECLARE @l dbo.RecipeLineType;
  INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${f.cafe}, 24, 'g'), (${f.leche}, 300, 'ml'), (${f.azucar}, 8, 'g'), (${f.vaso}, 1, 'pza'), (${f.tapa}, 1, 'pza');
  EXEC dbo.sp_save_recipe @product_id=${f.latte}, @variant_option_id=${optGrande}, @Lines=@l;`);
const recipeGrande = r.recipe_id;
check(recipeGrande > 0 && recipeGrande !== recipeBase, 'receta por variante Grande creada aparte');
rec = q(`EXEC dbo.sp_get_recipe @product_id=${f.latte}, @variant_option_id=${optGrande};`);
check(rec[0][0].recipe_id === recipeGrande && Number(rec[0][0].is_fallback) === 0, 'sp_get_recipe devuelve la receta de la variante');
rec = q(`EXEC dbo.sp_get_recipe @product_id=${f.latte}, @variant_option_id=${optChico};`);
check(rec[0][0].recipe_id === recipeBase && Number(rec[0][0].is_fallback) === 1, 'variante sin receta propia cae a la base con is_fallback = 1');

check(fails(`DECLARE @l dbo.RecipeLineType; INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${f.cafe}, 1, 'ml'); EXEC dbo.sp_save_recipe @product_id=${f.americano}, @Lines=@l;`, 'unidad').ok,
  'rechaza ml para un ingrediente en gramos (dimension distinta)');
check(fails(`DECLARE @l dbo.RecipeLineType; INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${f.latte}, 1, 'pza'); EXEC dbo.sp_save_recipe @product_id=${f.americano}, @Lines=@l;`, 'inventario directo').ok,
  'rechaza una receta como ingrediente de otra (un solo nivel, sin ciclos)');
check(fails(`DECLARE @l dbo.RecipeLineType; INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${f.cafe}, 1, 'g'); EXEC dbo.sp_save_recipe @product_id=${f.coca}, @Lines=@l;`, 'RECETA').ok,
  'rechaza receta sobre un producto DIRECT');
check(fails(`EXEC dbo.sp_update_product @product_id=${f.cafe}, @nombre=N'Cafe molido', @precio=0, @stock=1000, @numero_parte=N'ING-CAFE', @inventory_mode='RECIPE';`, 'ingrediente').ok,
  'un ingrediente en uso no puede convertirse en RECIPE');
check(fails(`EXEC dbo.sp_update_product @product_id=${f.cafe}, @nombre=N'Cafe molido', @precio=0, @stock=1000, @numero_parte=N'ING-CAFE', @base_uom='ml';`, 'unidad base').ok,
  'un ingrediente en uso no puede cambiar de unidad base');
check(fails(`EXEC dbo.sp_update_product @product_id=${f.latte}, @nombre=N'Latte', @precio=55, @stock=0, @numero_parte=N'BEB-LATTE', @inventory_mode='DIRECT';`, 'recetas').ok,
  'una RECIPE con recetas no puede cambiar de tipo');
check(fails(`EXEC dbo.sp_set_product_modifier_groups @product_id=${f.latte}, @group_ids_json='[${gSub}]';`, 'recetas por tamano').ok,
  'no se puede desligar el grupo de tamano mientras haya recetas por variante');

seccion('Presentaciones de compra y compra con conversion');
r = row(`EXEC dbo.sp_save_product_presentation @product_id=${f.cafe}, @name=N'Bolsa 1 kg', @factor_to_base=1000, @is_default=1;`);
const presBolsa = r.id;
r = row(`EXEC dbo.sp_save_product_presentation @product_id=${f.coca}, @name=N'Caja 24 pz', @factor_to_base=24;`);
const presCaja = r.id;
check(presBolsa > 0 && presCaja > 0, 'presentaciones creadas');
check(fails(`EXEC dbo.sp_save_product_presentation @product_id=${f.cafe}, @name=N'Bolsa 1 kg', @factor_to_base=500;`, 'Ya existe').ok, 'nombre de presentacion unico por producto');

const stockAntes = row(`SELECT stock, cost, price FROM dbo.products WHERE id = ${f.cafe}`);
// 5 bolsas de 1 kg a $200 la bolsa -> +5000 g, costo 0.20/g
r = row(`
  DECLARE @d dbo.PurchaseDetailType; DECLARE @d2 dbo.PurchaseDetailType2;
  INSERT INTO @d2 (product_id, quantity, unit_price, profit_percent, presentation_id) VALUES (${f.cafe}, 5, 200, 0, ${presBolsa});
  INSERT INTO @d2 (product_id, quantity, unit_price, profit_percent, presentation_id) VALUES (${f.coca}, 2, 240, 50, ${presCaja});
  INSERT INTO @d  (product_id, quantity, unit_price, profit_percent) VALUES (${f.vaso}, 100, 1.20, 0);
  EXEC dbo.sp_register_purchase @user_id=${f.userId}, @supplier_id=${f.supplierId}, @subtotal=1600, @tax_rate=0.16, @tax_amount=256, @total=1856, @PurchaseDetails=@d, @PurchaseDetails2=@d2;`);
const purchaseId = r.purchase_id;
check(purchaseId > 0, `compra registrada (#${purchaseId}) mezclando tipo v1 y v2`);
const cafeDespues = row(`SELECT stock, cost, price FROM dbo.products WHERE id = ${f.cafe}`);
check(cerca(Number(cafeDespues.stock) - Number(stockAntes.stock), 5000), `5 bolsas x 1 kg suman 5000 g (${stockAntes.stock} -> ${cafeDespues.stock})`);
check(cerca(cafeDespues.cost, 0.2), `costo por gramo = 0.2000 (${cafeDespues.cost})`);
const cocaDespues = row(`SELECT stock, cost, price FROM dbo.products WHERE id = ${f.coca}`);
check(Number(cocaDespues.stock) === 24 + 48, `2 cajas x 24 suman 48 piezas (stock ${cocaDespues.stock})`);
check(cerca(cocaDespues.cost, 10), `costo por pieza = 240/24 = 10 (${cocaDespues.cost})`);
check(cerca(cocaDespues.price, 17.4), `precio = 10 x 1.16 x 1.5 = 17.40 (${cocaDespues.price})`);
const vasoDespues = row(`SELECT stock, cost FROM dbo.products WHERE id = ${f.vaso}`);
check(Number(vasoDespues.stock) === 200 && cerca(vasoDespues.cost, 1.2), 'linea v1 sin presentacion: factor 1, igual que antes');
const det = rows(`SELECT product_id, quantity, factor_to_base, base_quantity, presentation_id FROM dbo.purchase_detail WHERE puchase_id = ${purchaseId} ORDER BY id`);
const detCafe = det.find(d => d.product_id === f.cafe), detVaso = det.find(d => d.product_id === f.vaso);
check(det.length === 3 && detCafe && cerca(detCafe.base_quantity, 5000) && detCafe.presentation_id === presBolsa && detVaso.presentation_id === null,
  'purchase_detail conserva presentacion, factor y cantidad base');
const movs = rows(`SELECT product_id, typee, quantity, source, unit_cost FROM dbo.inventory_movements WHERE reference = '${purchaseId}' ORDER BY id`);
const movCafe = movs.find(m => m.product_id === f.cafe);
check(movs.length === 3 && movs.every(m => m.typee === 'entrada' && m.source === 'PURCHASE') && movCafe && cerca(movCafe.quantity, 5000) && cerca(movCafe.unit_cost, 0.2),
  'inventory_movements: entrada, source PURCHASE, cantidad en base y costo unitario');
check(fails(`
  DECLARE @d dbo.PurchaseDetailType; DECLARE @d2 dbo.PurchaseDetailType2;
  INSERT INTO @d2 (product_id, quantity, unit_price, presentation_id) VALUES (${f.coca}, 1, 10, ${presBolsa});
  EXEC dbo.sp_register_purchase @user_id=${f.userId}, @supplier_id=${f.supplierId}, @subtotal=10, @tax_rate=0.16, @tax_amount=1.6, @total=11.6, @PurchaseDetails=@d, @PurchaseDetails2=@d2;`, 'presentacion').ok,
  'rechaza una presentacion que no es del producto');

seccion('Imagenes');
r = row(`EXEC dbo.sp_set_product_image @product_id=${f.latte}, @thumb=0xFFD8FFE000104A464946, @mime='image/jpeg', @width=160, @height=160;`);
check(Number(r.has_image) === 1 && Number(r.image_version) >= 1, `miniatura guardada, image_version ${r.image_version}`);
const thumbs = rows(`EXEC dbo.sp_get_product_thumbs @ids_json='[${f.latte}]';`);
check(thumbs.length === 1 && thumbs[0].thumb === '/9j/4AAQSkZJRg==', 'sp_get_product_thumbs devuelve los bytes por id', String(thumbs[0]?.thumb));
check(fails(`DECLARE @b VARBINARY(MAX) = CAST(REPLICATE(CAST('x' AS VARCHAR(MAX)), 70000) AS VARBINARY(MAX)); EXEC dbo.sp_set_product_image @product_id=${f.latte}, @thumb=@b;`, '64 KB').ok, 'rechaza miniaturas de mas de 64 KB');
r = row(`EXEC dbo.sp_set_product_image @product_id=${f.latte}, @thumb=NULL;`);
check(Number(r.has_image) === 0 && rows(`EXEC dbo.sp_get_product_thumbs @ids_json='[${f.latte}]';`).length === 0, 'quitar imagen borra la miniatura y sube la version');

seccion('Catalogo de venta');
const act = rows(`EXEC dbo.sp_get_active_products;`);
const actLatte = act.find(p => p.id === f.latte);
check(actLatte && actLatte.inventory_mode === 'RECIPE' && Number(actLatte.has_modifiers) === 1 && Number(actLatte.sellable) === 1, 'sp_get_active_products expone inventory_mode, sellable y has_modifiers');
check(act.find(p => p.id === f.cafe) && Number(act.find(p => p.id === f.cafe).sellable) === 0, 'los ingredientes salen con sellable = 0 (la venta los filtra)');

seccion('Borrado');
r = row(`EXEC dbo.sp_delete_recipe @recipe_id=${recipeGrande};`);
check(Number(r.recipe_id) === recipeGrande && scalar(`SELECT COUNT(*) FROM dbo.recipe_lines WHERE recipe_id = ${recipeGrande}`) === 0, 'borrar receta borra sus lineas');
r = row(`DECLARE @l dbo.RecipeLineType; INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${f.cafe}, 24, 'g'), (${f.leche}, 300, 'ml'), (${f.azucar}, 8, 'g'), (${f.vaso}, 1, 'pza'), (${f.tapa}, 1, 'pza'); EXEC dbo.sp_save_recipe @product_id=${f.latte}, @variant_option_id=${optGrande}, @Lines=@l;`);
check(r.recipe_id > 0, 'receta Grande recreada para las pruebas de venta');
r = row(`EXEC dbo.sp_delete_product_presentation @id=${presBolsa};`);
check(r.result === 'DEACTIVATED', 'una presentacion usada en compras se desactiva, no se borra');

resumen();
