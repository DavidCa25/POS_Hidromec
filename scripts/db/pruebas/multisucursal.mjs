/**
 * MULTISUCURSAL en SQL Server, con DOS bases temporales: una matriz y una sucursal.
 *
 *     node scripts/db/pruebas/multisucursal.mjs
 *
 *   1. La 0055 se aplica dos veces sin romper nada.
 *   2. La matriz exporta su catálogo corporativo (con recetas, modificadores y
 *      usuarios de empresa).
 *   3. La sucursal lo aplica: adopta su producto igual, respeta los propios,
 *      precio especial, «no se vende aquí», usuarios con su PIN.
 *   4. Reaplicar no duplica; una baja en la matriz es una baja aquí; las reglas
 *      de precio se respetan.
 *   5. Traspasos: enviar baja existencia, recibir sube lo que llegó, cerrar y
 *      cancelar devuelven lo que corresponde; reintentos sin duplicar.
 *
 * Nunca toca una base de trabajo: solo Wybix_Tmp*.
 */
import { readFileSync } from 'node:fs';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

const M = 'Wybix_TmpMultiMatriz', N = 'Wybix_TmpMultiNorte';
let fallos = 0, total = 0;
const check = (ok, msg, det = '') => { total++; if (!ok) fallos++; console.log(`   ${ok ? 'ok   ' : 'FALLA'}  ${msg}${det ? '  · ' + det : ''}`); };
const seccion = (t) => console.log(`\n-- ${t}`);
const q = (db, s) => { const r = consultarTemporal(db, s); if (!r.ok) throw new Error(r.error); return r.sets; };
const uno = (db, s) => q(db, s)[0]?.[0] ?? {};
const falla = (db, s) => { const r = consultarTemporal(db, s); return r.ok ? null : r.error; };
const lit = (t) => `N'${String(t).replace(/'/g, "''")}'`;

const LOC_N = '6f1d1a2b-0000-4000-8000-00000000000a';
const LOC_M = '6f1d1a2b-0000-4000-8000-00000000000b';
const migracion = readFileSync('electron/migrations/0055_multisucursal.sql', 'utf8').split(/^\s*GO\s*$/im).filter((b) => b.trim());

try {
  seccion('1. La migración, dos veces, en las dos bases');
  for (const db of [M, N]) {
    restaurar(db, 'installer/template.bak');
    for (let i = 0; i < 2; i++) for (const b of migracion) q(db, b);
  }
  check(uno(M, "SELECT COL_LENGTH('dbo.products','corporate_override') AS c").c != null, 'columnas nuevas en products');
  check(!falla(M, "INSERT dbo.users(usuario,password_hash,rol,corporate_scope) VALUES(N'qa-x',N'x',N'admin',N'no es json')") === false, 'corporate_scope exige JSON');

  seccion('2. La matriz exporta');
  q(M, `INSERT dbo.CAT_categories(namee) VALUES(N'Donas'),(N'Insumos');INSERT dbo.CAT_brands(namee) VALUES(N'I Do Nut');`);
  const cat = uno(M, "SELECT id FROM dbo.CAT_categories WHERE namee=N'Donas'").id, catI = uno(M, "SELECT id FROM dbo.CAT_categories WHERE namee=N'Insumos'").id;
  const brand = uno(M, "SELECT id FROM dbo.CAT_brands WHERE namee=N'I Do Nut'").id;
  const add = (pn, nombre, precio, stock, c, modo = 'DIRECT', vende = 1) => uno(M,
    `EXEC dbo.sp_add_product @brand=${brand},@part_number=${lit(pn)},@name=${lit(nombre)},@price=${precio},@stock=${stock},@category=${c},@inventory_mode=N'${modo}',@sellable=${vende}`).id;
  const glaseada = add('DON-GLA', 'Dona glaseada', 25, 50, cat);
  const rellena = add('DON-REL', 'Dona rellena', 39, 30, cat);
  const caja = add('DON-CAJ', 'Caja de 6', 135, 0, cat, 'NONE');
  const harina = add('INS-HAR', 'Harina', 0, 10, catI, 'DIRECT', 0);
  q(M, `INSERT dbo.modifier_groups(name,role,min_select,max_select) VALUES(N'Glaseado extra',N'ADDON',0,1);
        DECLARE @g INT = SCOPE_IDENTITY();
        INSERT dbo.modifier_options(group_id,name,price_delta,effect,ingredient_product_id,qty_base) VALUES(@g,N'Más glaseado',5,N'ADD',${harina},10);
        INSERT dbo.product_modifier_groups(product_id,group_id,sort_order) VALUES(${glaseada},@g,0);
        INSERT dbo.recipes(product_id) VALUES(${caja});
        INSERT dbo.recipe_lines(recipe_id,ingredient_product_id,qty_base,input_qty,input_uom) VALUES(SCOPE_IDENTITY(),${harina},120,120,N'pza');
        INSERT dbo.users(usuario,password_hash,rol,corporate_scope) VALUES(N'lupita',N'scrypt$hash-lupita',N'cajero',N'["*"]'),(N'solo-matriz',N'scrypt$x',N'cajero',NULL),
                                                                          (N'solo-sur',N'scrypt$y',N'cajero',N'["${'9'.repeat(8)}-0000-4000-8000-000000000000"]');
        INSERT dbo.trabajadores_acceso(user_id,pin_hash,pin_sal,pin_creado_en) SELECT id,'pinhash-lupita','sal',SYSUTCDATETIME() FROM dbo.users WHERE usuario=N'lupita';`);
  const exportar = (db) => JSON.parse(uno(db, 'EXEC dbo.sp_corporate_catalog_export').catalog_json);
  let catalogo = exportar(M);
  const uuidDe = (id) => String(uno(M, `SELECT LOWER(CONVERT(VARCHAR(36),uuid)) AS u FROM dbo.products WHERE id=${id}`).u);
  check(catalogo.products.some((p) => p.uuid === uuidDe(glaseada) && p.price === '25.00'), 'productos con uuid y precio como texto');
  check(catalogo.recipes.length >= 1 && catalogo.modifier_groups.some((g) => g.name === 'Glaseado extra'), 'recetas y modificadores');
  check(catalogo.users.map((u) => u.usuario).sort().join(',') === 'lupita,solo-sur', 'solo los usuarios de empresa', catalogo.users.map((u) => u.usuario).join(','));
  check(!('stock' in catalogo.products[0]) && !('cost' in catalogo.products[0]), 'ni existencia ni costo: son de cada sucursal');

  seccion('3. La sucursal aplica');
  q(N, `INSERT dbo.CAT_categories(namee) VALUES(N'Varios');`);
  const catN = uno(N, "SELECT id FROM dbo.CAT_categories WHERE namee=N'Varios'").id;
  // Ya tenía la glaseada (mismo código, otro uuid) y un producto propio.
  q(N, `EXEC dbo.sp_add_product @brand=NULL,@part_number=N'DON-GLA',@name=N'glaseada vieja',@price=20,@stock=7,@category=${catN};
        EXEC dbo.sp_add_product @brand=NULL,@part_number=N'CAFE-LOC',@name=N'Café de la casa',@price=30,@stock=5,@category=${catN};`);
  const aplicar = (cat, over, reglas = { precios_sucursal: false, productos_locales: true }, version = 1, rev = 1) => uno(N,
    `EXEC dbo.sp_corporate_catalog_apply @catalog=${cat ? lit(JSON.stringify(cat)) : 'NULL'}, @overrides=${over ? lit(JSON.stringify(over)) : 'NULL'},
       @reglas=${lit(JSON.stringify(reglas))}, @location_id=N'${LOC_N}', @version=${version}, @overrides_revision=${rev}`);
  const over = [{ product_uuid: uuidDe(rellena), price: 42, available: true }, { product_uuid: uuidDe(caja), price: null, available: false }];
  const r1 = aplicar(catalogo, over);
  check(r1.nuevos === 3 && r1.actualizados === 1, 'tres nuevos y uno adoptado', JSON.stringify(r1));
  const pN = (pn) => uno(N, `SELECT nombre, price, stock, CAST(sellable AS INT) AS sellable, CAST(corporate AS INT) AS corporate, LOWER(CONVERT(VARCHAR(36),uuid)) AS uuid, CAST(ISNULL(active,1) AS INT) AS active FROM dbo.products WHERE part_number=N'${pn}'`);
  const gla = pN('DON-GLA');
  check(gla.uuid === uuidDe(glaseada) && gla.nombre === 'Dona glaseada' && Number(gla.stock) === 7 && gla.corporate === 1, 'la glaseada adopta el uuid y el nombre de la matriz y conserva su existencia');
  check(uno(N, "SELECT COUNT(*) AS n FROM dbo.products WHERE part_number LIKE N'DON-GLA%'").n === 1, 'sin duplicar');
  check(Number(pN('DON-REL').price) === 42 && Number(pN('DON-REL').stock) === 0, 'precio especial de la sucursal; existencia nueva en cero');
  check(pN('DON-CAJ').sellable === 0, '«no se vende aquí» la quita de la caja');
  check(pN('CAFE-LOC').corporate === 0 && Number(pN('CAFE-LOC').price) === 30, 'el producto propio no se toca');
  check(uno(N, `SELECT COUNT(*) AS n FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id=rl.recipe_id JOIN dbo.products p ON p.id=r.product_id WHERE p.part_number=N'DON-CAJ'`).n === 1, 'la receta llega con su insumo');
  check(uno(N, `SELECT COUNT(*) AS n FROM dbo.product_modifier_groups pmg JOIN dbo.products p ON p.id=pmg.product_id WHERE p.part_number=N'DON-GLA'`).n === 1, 'y el modificador de la glaseada');
  const lupita = uno(N, "SELECT CAST(u.corporate AS INT) AS c, u.password_hash, a.pin_hash FROM dbo.users u LEFT JOIN dbo.trabajadores_acceso a ON a.user_id=u.id WHERE u.usuario=N'lupita'");
  check(lupita.c === 1 && lupita.password_hash === 'scrypt$hash-lupita' && lupita.pin_hash === 'pinhash-lupita', 'lupita entra con su contraseña y su PIN');
  check(!uno(N, "SELECT COUNT(*) AS n FROM dbo.users WHERE usuario IN (N'solo-matriz',N'solo-sur')").n, 'los que no son de esta sucursal no llegan');
  check(uno(N, "SELECT valor FROM dbo.database_metadata WHERE clave='multi_version'").valor === '1', 'la sucursal recuerda su versión');

  seccion('4. Reaplicar, bajas y reglas de precio');
  const r2 = aplicar(catalogo, over);
  check(r2.nuevos === 0 && uno(N, "SELECT COUNT(*) AS n FROM dbo.products WHERE corporate=1").n === 4, 'reaplicar no duplica');
  // La sucursal sube el precio de la glaseada a mano; con la regla apagada, la matriz manda.
  q(N, "UPDATE dbo.products SET price = 30 WHERE part_number=N'DON-GLA'");
  aplicar(null, null, { precios_sucursal: false }, 1, 1);
  check(Number(pN('DON-GLA').price) === 25, 'sin permiso, el precio vuelve al de la matriz');
  q(N, "UPDATE dbo.products SET price = 30 WHERE part_number=N'DON-GLA'");
  aplicar(null, null, { precios_sucursal: true }, 1, 1);
  check(Number(pN('DON-GLA').price) === 30, 'con permiso, el precio de la sucursal se respeta');
  // La matriz da de baja la rellena.
  q(M, `UPDATE dbo.products SET active = 0 WHERE id=${rellena}`);
  catalogo = exportar(M);
  aplicar(catalogo, null, { precios_sucursal: false }, 2, 1);
  check(pN('DON-REL').active === 0, 'una baja en la matriz es una baja aquí (sin borrar)');
  // La matriz quita el precio especial: llega solo la lista de excepciones.
  aplicar(null, [], { precios_sucursal: false }, 2, 2);
  check(pN('DON-CAJ').sellable === 1, 'sin excepciones: la caja de 6 vuelve a venderse');
  check(falla(N, `EXEC dbo.sp_corporate_catalog_apply @catalog=N'{"no":"products"}'`)?.includes('incompleto'), 'un catálogo roto no se aplica a medias');

  seccion('5. Traspasos');
  const hU = uno(M, "SELECT LOWER(CONVERT(VARCHAR(36),uuid)) AS u FROM dbo.products WHERE part_number=N'INS-HAR'").u;
  const userM = uno(M, "SELECT TOP 1 id FROM dbo.users WHERE usuario=N'lupita'").id;
  const userN = uno(N, "SELECT TOP 1 id FROM dbo.users WHERE usuario=N'lupita'").id;
  const T1 = 'a1000000-0000-4000-8000-000000000001', T2 = 'a1000000-0000-4000-8000-000000000002';
  const enviar = (t, qty) => q(M, `EXEC dbo.sp_branch_transfer_send @user_id=${userM}, @to_location_uuid='${LOC_N}', @to_name=N'Norte',
       @lines=N'[{"product_uuid":"${hU}","qty":${qty}}]', @transfer_uuid='${t}'`);
  const s1 = enviar(T1, 4);
  check(Number(uno(M, `SELECT stock FROM dbo.products WHERE id=${harina}`).stock) === 6 && s1[1]?.[0]?.product_uuid === hU, 'enviar baja la existencia de la matriz y devuelve las líneas por uuid');
  enviar(T1, 4);
  check(Number(uno(M, `SELECT stock FROM dbo.products WHERE id=${harina}`).stock) === 6, 'reintentar el mismo envío no descuenta dos veces');
  check(falla(M, `EXEC dbo.sp_branch_transfer_send @user_id=${userM}, @to_location_uuid='${LOC_N}', @to_name=N'Norte', @lines=N'[{"product_uuid":"${hU}","qty":99}]'`)?.includes('existencia suficiente'), 'no se manda lo que no hay');
  check(falla(M, `EXEC dbo.sp_branch_transfer_send @user_id=${userM}, @to_location_uuid='${LOC_N}', @to_name=N'Norte', @lines=N'[{"product_uuid":"${uuidDe(caja)}","qty":1}]'`)?.includes('existencia propia'), 'un producto de menú no se traspasa');

  const recibir = () => q(N, `EXEC dbo.sp_branch_transfer_receive @transfer_uuid='${T1}', @user_id=${userN}, @from_location_uuid='${LOC_M}', @from_name=N'Matriz',
       @lines=N'[{"product_uuid":"${hU}","nombre":"Harina","qty_sent":4,"qty":3}]'`);
  recibir(); recibir();
  check(Number(pN('INS-HAR').stock) === 3, 'la sucursal suma solo lo que llegó, una sola vez');
  check(falla(N, `EXEC dbo.sp_branch_transfer_receive @transfer_uuid='${T2}', @user_id=${userN}, @from_location_uuid='${LOC_M}', @from_name=N'Matriz',
       @lines=N'[{"product_uuid":"00000000-0000-4000-8000-000000000999","nombre":"Pan de muerto","qty":1}]'`)?.includes('Pan de muerto'), 'lo que la sucursal no tiene se nombra y no entra nada');

  q(M, `EXEC dbo.sp_branch_transfer_settle @transfer_uuid='${T1}', @status='RECEIVED', @received_lines=N'[{"product_uuid":"${hU}","qty":3}]'`);
  const l1 = uno(M, `SELECT t.status, l.qty_sent, l.qty_received FROM dbo.stock_transfers t JOIN dbo.stock_transfer_lines l ON l.transfer_id=t.id WHERE t.uuid='${T1}'`);
  check(l1.status === 'RECEIVED' && Number(l1.qty_received) === 3 && Number(l1.qty_sent) === 4, 'la matriz ve que llegaron 3 de 4');

  enviar(T2, 2);
  q(M, `EXEC dbo.sp_branch_transfer_settle @transfer_uuid='${T2}', @status='CANCELLED'`);
  q(M, `EXEC dbo.sp_branch_transfer_settle @transfer_uuid='${T2}', @status='CANCELLED'`);
  check(Number(uno(M, `SELECT stock FROM dbo.products WHERE id=${harina}`).stock) === 6, 'cancelar devuelve la mercancía, una sola vez');

  const lista = q(M, "EXEC dbo.sp_transfer_list @scope='BRANCH'")[0];
  check(lista.length === 2 && lista.every((t) => t.kind === 'BRANCH_OUT'), 'el historial de traspasos', lista.map((t) => `${t.kind}:${t.status}`).join(', '));
  check(q(M, 'EXEC dbo.sp_transfer_list')[0].length === 0, 'y la pantalla de eventos no los mezcla');
} catch (e) {
  fallos++; console.log(`   FALLA  ${e.message}`);
} finally {
  eliminar(M); eliminar(N);
}
console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLO(S)' : 'TODO BIEN'} · ${total - Math.min(fallos, total)}/${total}`);
process.exit(fallos ? 1 : 0);
