/**
 * SPIKE 2.3 · PARIDAD POS WINDOWS (SQL Server) <-> POS MOBILE (@wybix/domain)
 *
 *     node scripts/db/pruebas/paridad-recetas.mjs [--mobile <ruta de wybix-mobile>]
 *
 * Una venta móvil tiene que congelar EXACTAMENTE lo mismo que `sp_register_sale`:
 * precio unitario, costo unitario, receta efectiva y cada consumo de inventario.
 *
 * Cómo se prueba (sin copiar reglas a mano):
 *   1. Se arma un catálogo con TODOS los casos de la receta efectiva en una
 *      base temporal (baseline + migraciones, 0052 incluida).
 *   2. El catálogo sale por `sp_catalog_publication` — el MISMO JSON que
 *      recibe la tablet.
 *   3. Cada venta se calcula con @wybix/domain y se registra con
 *      `sp_register_sale` (que valida el precio de las opciones).
 *   4. Se comparan línea por línea: precio, costo, receta, variante y cada
 *      movimiento de inventario. Cualquier diferencia, por pequeña que sea, falla.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const iM = process.argv.indexOf('--mobile');
const MOBILE = resolve(iM > 0 ? process.argv[iM + 1] : (process.env.WYBIX_MOBILE || join(RAIZ, '..', 'Documents', 'wybix-owner')));
const dom = await import(pathToFileURL(join(MOBILE, 'packages', 'domain', 'src', 'index.ts')).href);

const BAK = join(RAIZ, 'installer', 'template.bak');
const DIR_MIG = join(RAIZ, 'electron', 'migrations');
const DB = 'Wybix_TmpParidadRecetas';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const q = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets.length ? r.sets[0] : []; };
const sets = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets; };
const escalar = (sql) => { const f = q(sql)[0]; return f ? f[Object.keys(f)[0]] : null; };
const num = (v) => dom.D(String(v));

try {
  console.log(`\nSPIKE 2.3 · PARIDAD DE RECETAS   (${DB})\n   dominio: ${MOBILE}`);
  if (!existsSync(BAK)) { console.log(`   ----   falta ${BAK}`); process.exit(0); }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG).filter(n => n.endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en')).filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // ------------------------------------------------------------ catálogo
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
       VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x'), 2), N'admin', 1, GETDATE());
     INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
     INSERT INTO dbo.CAT_categories (namee) VALUES (N'General');`);
  const user = Number(escalar('SELECT TOP 1 id FROM dbo.users'));
  q(`EXEC dbo.sp_open_shift @user_id=${user}, @opening_cash=0, @register_id=1;`);
  const brand = Number(escalar('SELECT TOP 1 id FROM dbo.CAT_brands'));
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'General'`));
  const producto = (pn, nombre, price, cost, modo = 'DIRECT', sellable = 1, dec = 0) => {
    const id = Number(escalar(`EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'${pn}', @name=N'${nombre}', @price=${price}, @stock=100000, @category=${cat}, @cost=${cost};`));
    q(`UPDATE dbo.products SET inventory_mode = '${modo}', sellable = ${sellable}, allow_decimal_qty = ${dec} WHERE id = ${id};`);
    return id;
  };
  const P = {
    dona: producto('P-DONA', 'Dona', 25, 6.5),
    agua: producto('P-AGUA', 'Agua', 15, 4.2, 'NONE'),
    granel: producto('P-GRANEL', 'Granos a granel', 180, 97.3333, 'DIRECT', 1, 1),
    cafe: producto('P-CAFE', 'Cafe', 40, 0, 'RECIPE'),
    malteada: producto('P-MALT', 'Malteada', 65, 0, 'RECIPE'),
    grano: producto('I-GRANO', 'Grano', 0, 0.4123, 'DIRECT', 0),
    leche: producto('I-LECHE', 'Leche', 0, 0.0251, 'DIRECT', 0),
    almendra: producto('I-ALMEN', 'Almendra', 0, 0.0617, 'DIRECT', 0),
    avena: producto('I-AVENA', 'Avena', 0, 0.0333, 'DIRECT', 0),
    azucar: producto('I-AZUC', 'Azucar', 0, 0.0099, 'DIRECT', 0),
    chispas: producto('I-CHISP', 'Chispas', 0, 0.1501, 'DIRECT', 0),
    helado: producto('I-HELAD', 'Helado', 0, 0.0876, 'DIRECT', 0),
  };
  const grupo = (name, role, max, req = 0) => Number(escalar(`
    INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order) VALUES (N'${name}', N'${role}', 0, ${max}, ${req}, 1, 0);
    SELECT SCOPE_IDENTITY();`));
  const opcion = (g, name, delta, effect, ing = 'NULL', rep = 'NULL', qb = 'NULL', qf = 'NULL') => Number(escalar(`
    INSERT INTO dbo.modifier_options (group_id, name, price_delta, effect, ingredient_product_id, replaces_product_id, qty_base, qty_factor, active, sort_order)
    VALUES (${g}, N'${name}', ${delta}, N'${effect}', ${ing}, ${rep}, ${qb}, ${qf}, 1, 0);
    SELECT SCOPE_IDENTITY();`));
  const ligar = (prod, g) => q(`INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order) VALUES (${prod}, ${g}, 0);`);
  const gTam = grupo('Tamano', 'SIZE', 1), gLeche = grupo('Leche', 'SUBSTITUTION', 2), gExtra = grupo('Extras', 'ADDON', 3);
  const O = {
    grande: opcion(gTam, 'Grande', 10, 'NONE'),
    doble: opcion(gTam, 'Doble', 8.5, 'SCALE', 'NULL', 'NULL', 'NULL', 1.3333),
    almendra: opcion(gLeche, 'Almendra', 7.5, 'SUBSTITUTE', P.almendra, P.leche),
    avena: opcion(gLeche, 'Avena 200', 6, 'SUBSTITUTE', P.avena, P.leche, 200.0001),
    sinAzucar: opcion(gLeche, 'Sin azucar', 0, 'REMOVE', 'NULL', P.azucar),
    chispas: opcion(gExtra, 'Chispas', 5, 'ADD', P.chispas, 'NULL', 12.3456),
  };
  for (const g of [gTam, gLeche, gExtra]) ligar(P.cafe, g);
  ligar(P.malteada, gExtra); ligar(P.dona, gExtra);
  const receta = (prod, variante, lineas) => {
    const id = Number(escalar(`INSERT INTO dbo.recipes (product_id, variant_option_id, active) VALUES (${prod}, ${variante ?? 'NULL'}, 1); SELECT SCOPE_IDENTITY();`));
    for (const [ing, qb, merma] of lineas) q(`INSERT INTO dbo.recipe_lines (recipe_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct) VALUES (${id}, ${ing}, ${qb}, ${qb}, N'g', ${merma});`);
  };
  receta(P.cafe, null, [[P.grano, 18.3333, 2.5], [P.leche, 240, 0], [P.azucar, 10, 3.33]]);
  receta(P.cafe, O.grande, [[P.grano, 27.1234, 2.5], [P.leche, 359.9999, 0.75]]);
  receta(P.malteada, null, [[P.helado, 150.5555, 1.11], [P.leche, 120.3333, 0]]);

  const cj = JSON.parse(escalar('EXEC dbo.sp_catalog_publication;'));
  const catalogo = dom.indexar({ catalog_version: 1, ...cj });
  const uuid = Object.fromEntries(q('SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS u FROM dbo.products').map(r => [Number(r.id), r.u]));
  const ouuid = Object.fromEntries(q('SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS u FROM dbo.modifier_options').map(r => [Number(r.id), r.u]));
  console.log(`\n   catálogo publicado: ${cj.products.length} productos · ${cj.recipes.length} recetas · ${cj.modifier_groups.length} grupos`);
  check(cj.products.every(p => typeof p.price === 'string') && cj.recipes.every(r => r.lines.every(l => typeof l.qty_base === 'string')),
    'el catálogo publica los números como texto (sin pasar por flotante)');

  // ------------------------------------------------------------ ventas
  const casos = [
    ['DIRECT con extra ×2', [[P.dona, 3, [[O.chispas, 2]]]]],
    ['NONE (costo propio, sin consumo)', [[P.agua, 2, []]]],
    ['DIRECT con cantidad decimal', [[P.granel, 2.35, []]]],
    ['RECIPE base con merma 2.5% y 3.33%', [[P.cafe, 1, []]]],
    ['RECIPE de tamaño (gana a la base)', [[P.cafe, 2, [[O.grande, 1]]]]],
    ['RECIPE base con SCALE 1.3333', [[P.cafe, 3, [[O.doble, 1]]]]],
    ['SUBSTITUTE sin cantidad (base)', [[P.cafe, 1, [[O.almendra, 1]]]]],
    ['SUBSTITUTE sin cantidad (tamaño)', [[P.cafe, 1, [[O.grande, 1], [O.almendra, 1]]]]],
    ['SUBSTITUTE con cantidad propia + SCALE', [[P.cafe, 2, [[O.doble, 1], [O.avena, 1]]]]],
    ['REMOVE + ADD ×3', [[P.cafe, 1, [[O.sinAzucar, 1], [O.chispas, 3]]]]],
    ['todo junto en varias líneas', [[P.cafe, 2, [[O.grande, 1], [O.avena, 1], [O.chispas, 2]]], [P.malteada, 1, [[O.chispas, 1]]], [P.dona, 5, []], [P.agua, 1, []]]],
  ];

  for (const [titulo, lineas] of casos) {
    const congeladas = lineas.map(([prod, qty, ops], i) =>
      dom.congelarLinea(catalogo, { product_uuid: uuid[prod], quantity: qty, options: ops.map(([o, n]) => ({ option_uuid: ouuid[o], qty: n })) }, i + 1));
    const tv = sets(`
      DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
      ${congeladas.map((c, i) => `INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (${i + 1}, ${lineas[i][0]}, ${c.quantity}, ${c.unit_price});`).join('\n')}
      ${lineas.flatMap(([, , ops], i) => ops.map(([o, n]) => `INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (${i + 1}, ${o}, ${n});`)).join('\n')}
      EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'TARJETA', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);
    const saleId = Number(escalar('SELECT MAX(id) FROM dbo.sales'));
    const det = q(`SELECT id, product_id, unitary_price, unit_cost, recipe_id, variant_option_id FROM dbo.sale_detail WHERE sale_id = ${saleId} ORDER BY id;`);
    const movs = q(`SELECT m.sale_detail_id, LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid, m.quantity, m.source, m.unit_cost
                      FROM dbo.inventory_movements m JOIN dbo.products p ON p.id = m.product_id
                     WHERE m.reference = '${saleId}' ORDER BY m.sale_detail_id, p.id;`);
    const ruuid = Object.fromEntries(q('SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS u FROM dbo.recipes').map(r => [Number(r.id), r.u]));
    const difs = [];
    congeladas.forEach((c, i) => {
      const d = det[i];
      if (!d) { difs.push(`línea ${i + 1}: SQL no la registró`); return; }
      if (num(d.unitary_price).comparar(c.unit_price) !== 0) difs.push(`precio ${c.unit_price} vs ${d.unitary_price}`);
      if (num(d.unit_cost).comparar(c.unit_cost) !== 0) difs.push(`costo ${c.unit_cost} vs ${d.unit_cost}`);
      if ((d.recipe_id ? ruuid[Number(d.recipe_id)] : null) !== c.recipe_uuid) difs.push(`receta ${c.recipe_uuid} vs ${d.recipe_id}`);
      const sqlMovs = movs.filter(m => Number(m.sale_detail_id) === Number(d.id));
      const dm = Object.fromEntries(c.consumos.map(x => [x.product_uuid, x]));
      if (sqlMovs.length !== c.consumos.length) difs.push(`movimientos ${c.consumos.length} vs ${sqlMovs.length}`);
      for (const m of sqlMovs) {
        const x = dm[m.product_uuid];
        if (!x) { difs.push(`sobra movimiento ${m.product_uuid}`); continue; }
        if (num(m.quantity).comparar(x.quantity) !== 0) difs.push(`consumo ${x.quantity} vs ${m.quantity}`);
        if (m.source !== x.source) difs.push(`source ${x.source} vs ${m.source}`);
        if (num(m.unit_cost).comparar(x.unit_cost) !== 0) difs.push(`costo insumo ${x.unit_cost} vs ${m.unit_cost}`);
      }
    });
    const totalSql = escalar(`SELECT total FROM dbo.sales WHERE id = ${saleId}`);
    if (num(totalSql).comparar(dom.totalDe(congeladas)) !== 0) difs.push(`total ${dom.totalDe(congeladas)} vs ${totalSql}`);
    const resumen = congeladas.map(c => `${c.unit_price}/${c.unit_cost}/${c.consumos.map(x => x.quantity).join('+') || '-'}`).join(' · ');
    check(difs.length === 0 && tv, titulo, difs.length ? difs.join('; ') : resumen);
  }

  // ------------------------------------------------------------ validaciones
  const err = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
  const mDom = err(() => dom.congelarLinea(catalogo, { product_uuid: uuid[P.dona], quantity: 1, options: [{ option_uuid: ouuid[O.almendra] }] }, 1));
  const rSql = consultarTemporal(DB, `
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${P.dona}, 1, 32.5);
    INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${O.almendra}, 1);
    EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'TARJETA', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);
  check(!!mDom && !rSql.ok && limpiar(rSql.error).includes(mDom), 'una opción ajena al producto se rechaza en los dos con el mismo mensaje', mDom ?? '');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
}
console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
