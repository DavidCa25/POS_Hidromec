/**
 * Dar de baja un producto: que se permite, que se bloquea y que se conserva.
 *
 *     node scripts/db/pruebas/baja-producto.mjs [--conservar]
 *
 * QUE SE ROMPIO
 * -------------
 * El boton de papelera de Inventario no tenia handler, asi que no habia forma
 * de retirar un producto. Y el procedimiento que deberia respaldarlo,
 * `sp_delete_product`, hacia el UPDATE a `active = 0` sin mirar nada: con el
 * se podia retirar un ingrediente que una receta viva seguia necesitando.
 *
 * Por el otro lado, `sp_register_sale` no comprobaba `products.active`: las
 * pantallas ocultan los productos de baja, pero un catalogo cargado en memoria
 * antes de la baja llegaba igual hasta el registro de la venta.
 *
 * QUE COMPRUEBA
 * -------------
 * El contrato completo contra SQL de verdad. La baja es SIEMPRE logica: aqui
 * se verifica ademas que nada del historico desaparece, porque un ticket de
 * hace seis meses tiene que seguir siendo legible.
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
const DB = 'Wybix_TmpBaja';
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
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};
const activo = (id) => Number(escalar(`SELECT active FROM dbo.products WHERE id = ${id};`));
const baja = (id) => falla(`EXEC dbo.sp_delete_product @product_id = ${id};`);

try {
  console.log(`\nBAJA DE PRODUCTOS   (${DB})`);

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

  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secreta1'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Cafeteria');`);
  const userId = Number(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id;`));
  const brand = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Cafeteria';`));
  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=500, @register_id=1;`);

  const alta = (o) => Number(escalar(`
    EXEC dbo.sp_add_product
      @brand=${brand}, @part_number=N'${o.pn}', @name=N'${o.name}',
      @price=${o.price ?? 0}, @stock=${o.stock ?? 0}, @category=${cat},
      @inventory_mode='${o.mode ?? 'DIRECT'}', @sellable=${o.sellable ?? 1},
      @base_uom='${o.uom ?? 'pza'}', @allow_decimal_qty=${o.dec ?? 0},
      @cost=${o.cost ?? 'NULL'};`));

  const vender = (id, qty, precio) => uno(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${id}, ${qty}, ${precio});
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);

  // ================================================================ A
  seccion('A. Un producto sin dependencias se da de baja');
  const galleta = alta({ pn: 'DIR-GALLETA', name: 'Galleta', price: 20, stock: 10, cost: 5 });
  vender(galleta, 2, 20);
  const ventasAntes = Number(escalar(`SELECT COUNT(*) FROM dbo.sale_detail WHERE product_id = ${galleta};`));
  const movsAntes = Number(escalar(`SELECT COUNT(*) FROM dbo.inventory_movements WHERE product_id = ${galleta};`));
  check(ventasAntes > 0 && movsAntes > 0, 'parte con historial', `${ventasAntes} linea(s), ${movsAntes} movimiento(s)`);

  const r1 = baja(galleta);
  check(r1.error === null, 'la baja se acepta', r1.error ?? 'sin error');
  check(activo(galleta) === 0, 'active pasa a 0');
  const enActivos = q(`EXEC dbo.sp_get_active_products;`).some(p => Number(p.id) === galleta);
  check(!enActivos, 'y desaparece de los productos activos');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.products WHERE id = ${galleta};`)) === 1,
    'pero la fila sigue ahi: la baja es logica');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.sale_detail WHERE product_id = ${galleta};`)) === ventasAntes
     && Number(escalar(`SELECT COUNT(*) FROM dbo.inventory_movements WHERE product_id = ${galleta};`)) === movsAntes,
    'y el historico no se toca', 'ventas y movimientos intactos');

  seccion('A2. Un producto de baja ya no se vende');
  const noVende = falla(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${galleta}, 1, 20);
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`, 'dado de baja');
  check(noVende.ok, 'sp_register_sale lo rechaza aunque llegue al carrito', noVende.error?.slice(0, 80));

  check(baja(galleta).ok, 'y darlo de baja dos veces avisa en vez de repetir');

  // ================================================================ C
  seccion('C. Un ingrediente de una receta VIVA no se puede retirar');
  const cafe  = alta({ pn: 'ING-CAFE',  name: 'Cafe molido', uom: 'g',  stock: 1000, dec: 1, sellable: 0, cost: 0.30 });
  const leche = alta({ pn: 'ING-LECHE', name: 'Leche',       uom: 'ml', stock: 5000, dec: 1, sellable: 0, cost: 0.02 });
  const latte = alta({ pn: 'BEB-LATTE', name: 'Latte', price: 55, mode: 'RECIPE' });
  q(`
    DECLARE @l dbo.RecipeLineType;
    INSERT INTO @l (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order)
    VALUES (${cafe}, 18, 'g', 0, 1), (${leche}, 250, 'ml', 0, 2);
    EXEC dbo.sp_save_recipe @product_id=${latte}, @variant_option_id=NULL, @Lines=@l;`);

  const bloqueo = baja(cafe);
  check(bloqueo.ok, 'la baja se bloquea');
  check(/Latte/.test(bloqueo.error || ''), 'y el mensaje NOMBRA la receta que lo usa',
    bloqueo.error?.slice(0, 100));
  check(activo(cafe) === 1, 'el producto sigue activo: no se toco nada');

  // ================================================================ B
  seccion('B. El producto por receta si se puede dar de baja');
  const recetasAntes = Number(escalar(`SELECT COUNT(*) FROM dbo.recipes WHERE product_id = ${latte};`));
  const lineasAntes = Number(escalar(`
    SELECT COUNT(*) FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id = rl.recipe_id
    WHERE r.product_id = ${latte};`));
  const r2 = baja(latte);
  check(r2.error === null, 'la baja del Latte se acepta', r2.error ?? 'sin error');
  check(activo(latte) === 0, 'active pasa a 0');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.recipes WHERE product_id = ${latte};`)) === recetasAntes
     && Number(escalar(`SELECT COUNT(*) FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id = rl.recipe_id WHERE r.product_id = ${latte};`)) === lineasAntes,
    'y su receta y sus lineas siguen enteras', `${recetasAntes} receta(s), ${lineasAntes} linea(s)`);

  seccion('C2. Con la receta muerta, el ingrediente ya se puede retirar');
  const r3 = baja(cafe);
  check(r3.error === null,
    'el cafe se da de baja porque su unica receta era la del Latte, ya retirado',
    r3.error ?? 'sin error');
  check(activo(cafe) === 0, 'active pasa a 0');

  // ================================================================ E
  seccion('E. Modificadores');
  const almendra = alta({ pn: 'ING-ALM', name: 'Leche de almendra', uom: 'ml', stock: 2000, dec: 1, sellable: 0, cost: 0.06 });
  const grupo = Number(escalar(`
    DECLARE @o dbo.ModifierOptionType;
    INSERT INTO @o (name, price_delta, effect, ingredient_product_id, qty_base, sort_order)
    VALUES (N'Con almendra', 10, 'ADD', ${almendra}, 200, 1);
    EXEC dbo.sp_save_modifier_group @name=N'Leche', @role='ADDON', @min_select=0, @max_select=1,
      @required=0, @Options=@o;`));
  check(grupo > 0, `grupo de modificadores creado (#${grupo})`);

  const bloqueoMod = baja(almendra);
  check(bloqueoMod.ok, 'un producto que usa un modificador ACTIVO no se puede retirar');
  check(/Leche/.test(bloqueoMod.error || ''), 'y el mensaje nombra el modificador',
    bloqueoMod.error?.slice(0, 100));

  q(`UPDATE dbo.modifier_groups SET active = 0 WHERE id = ${grupo};`);
  const r4 = baja(almendra);
  check(r4.error === null, 'con el grupo desactivado, la baja se acepta', r4.error ?? 'sin error');

  seccion('Un producto que no existe');
  check(falla(`EXEC dbo.sp_delete_product @product_id = 999999;`, 'no existe').ok,
    'se rechaza con un mensaje claro');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
