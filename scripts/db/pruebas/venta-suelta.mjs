/**
 * Venta suelta (0073).
 *
 *     node scripts/db/pruebas/venta-suelta.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   · que sin activar no se liga nada, y las reglas al ligar (un nivel,
 *     existencias propias, piezas de 2 en adelante);
 *   · que el suelto sin costo toma el del paquete entre sus piezas;
 *   · que vender sueltos abre los paquetes justos -paquete -N, suelto +N x
 *     piezas- con movimientos APERTURA, y que no abre si alcanzan las piezas;
 *   · que sin paquetes para abrir la venta se rechaza y no deja nada escrito;
 *   · que el paquete vendido entero en la misma venta cuenta antes de abrir;
 *   · que con el modulo apagado no se abre nada.
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
const DB = 'Wybix_TmpVentaSuelta';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const todo = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets;
};
const q = (sql) => { const s = todo(sql); return s.length ? s[0] : []; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: '(no fallo)' };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};

try {
  console.log(`\nVENTA SUELTA   (${DB})`);
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
    // MISMA regla que electron/migrationsRunner.js.
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
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Abarrotes');`);
  const userId = Number(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id;`));
  const brand = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Abarrotes';`));
  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=500, @register_id=1;`);

  const alta = (o) => Number(escalar(`
    EXEC dbo.sp_add_product
      @brand=${brand}, @part_number=N'${o.pn}', @name=N'${o.name}',
      @price=${o.price ?? 0}, @stock=${o.stock ?? 0}, @category=${cat},
      @inventory_mode='${o.mode ?? 'DIRECT'}', @sellable=1,
      @base_uom='pza', @allow_decimal_qty=0, @cost=${o.cost ?? 'NULL'};`));
  const stock = (id) => Number(escalar(`SELECT stock FROM dbo.products WHERE id = ${id};`));
  const fijar = (id, s) => q(`UPDATE dbo.products SET stock = ${s} WHERE id = ${id};`);
  const venta = (lineas) => `
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES
      ${lineas.map(([id, qty, precio], i) => `(${i + 1}, ${id}, ${qty}, ${precio})`).join(', ')};
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`;
  const vender = (lineas) => uno(venta(lineas));
  const ligar = (hijo, padre, piezas) => `EXEC dbo.sp_venta_suelta_guardar @product_id=${hijo},
    @parent_product_id=${padre ?? 'NULL'}, @piezas=${piezas ?? 'NULL'}, @user_id=${userId};`;
  const aperturas = (saleId) => q(`SELECT product_id, typee, quantity, unit_cost FROM dbo.inventory_movements
    WHERE source = 'APERTURA' AND reference = N'${saleId}' ORDER BY typee DESC;`);

  const cajetilla = alta({ pn: 'CIG-20', name: 'Cajetilla 20', price: 95, stock: 3, cost: 80 });
  const cigarro = alta({ pn: 'CIG-1', name: 'Cigarro suelto', price: 6, stock: 0 });
  const chicle = alta({ pn: 'CHI-1', name: 'Chicle', price: 2, stock: 10, cost: 1 });
  const receta = alta({ pn: 'REC-1', name: 'Combo', price: 10, mode: 'RECIPE' });

  // ================================================================
  seccion('1. Sin activar no se liga nada');
  let f = falla(ligar(cigarro, cajetilla, 20), 'activada');
  check(f.ok, 'ligar sin activar se rechaza', f.error);
  q(`EXEC dbo.sp_set_business_module @module_key = N'venta-suelta', @enabled = 1, @user_id = ${userId};`);

  seccion('2. Reglas al ligar');
  for (const [sql, frag, titulo] of [
    [ligar(cigarro, cigarro, 20), 'su propio paquete', 'un producto no es su propio paquete'],
    [ligar(cigarro, cajetilla, 1), 'piezas', 'un paquete de 1 pieza no es paquete'],
    [ligar(cigarro, receta, 20), 'existencias propias', 'una receta no se abre'],
  ]) {
    f = falla(sql, frag);
    check(f.ok, titulo, f.error);
  }
  const r = todo(ligar(cigarro, cajetilla, 20));
  check(Number(r[0]?.[0]?.piezas) === 20 && Number(r[0]?.[0]?.parent_product_id) === cajetilla,
    'el cigarro queda ligado a la cajetilla de 20', JSON.stringify(r[0]?.[0]));
  check(Number(escalar(`SELECT cost FROM dbo.products WHERE id = ${cigarro};`)) === 4,
    'sin costo propio, el cigarro toma 80 / 20 = 4');
  f = falla(ligar(chicle, cigarro, 5), 'ya se vende suelto');
  check(f.ok, 'un suelto no es paquete de otro (un solo nivel)', f.error);
  f = falla(ligar(cajetilla, chicle, 5), 'ya es el paquete');
  check(f.ok, 'un paquete no cuelga de otro', f.error);
  const g = todo(`EXEC dbo.sp_venta_suelta_get @product_id = ${cajetilla};`);
  check(g[0].length === 0 && g[1].length === 1 && Number(g[1][0].product_id) === cigarro,
    'consultar el paquete dice que sueltos salen de el');

  // ================================================================
  seccion('3. La caja ve las piezas de los paquetes cerrados');
  const disp = uno(`DECLARE @mo dbo.SaleModifierType; EXEC dbo.sp_check_availability @product_id=${cigarro}, @SaleModifiers=@mo;`);
  check(Number(disp.disponible) === 60 && disp.motivo == null,
    'sin piezas sueltas, alcanzan 3 cajetillas x 20 = 60 cigarros', JSON.stringify(disp));
  const fila = q(`EXEC dbo.sp_get_active_products;`).find(p => Number(p.id) === cigarro);
  check(Number(fila?.available_units) === 60 && Number(fila?.stock) === 0,
    'el catalogo dice 60 disponibles con stock propio 0', `${fila?.available_units}/${fila?.stock}`);
  const menu = todo(`EXEC dbo.sp_get_menu_catalog;`)[1].find(p => Number(p.id) === cigarro);
  check(Number(menu?.available_units) === 60, 'y la caja tactil tambien', String(menu?.available_units));

  seccion('4. Vender sueltos abre los paquetes justos');
  let v = vender([[cigarro, 3, 6]]);
  check(stock(cajetilla) === 2 && stock(cigarro) === 17, '3 cigarros sin piezas: abre 1 cajetilla',
    `cajetilla ${stock(cajetilla)}, cigarro ${stock(cigarro)}`);
  const mov = aperturas(v.sale_id);
  check(mov.length === 2
      && mov[0].typee === 'salida' && Number(mov[0].product_id) === cajetilla && Number(mov[0].quantity) === 1
      && mov[1].typee === 'entrada' && Number(mov[1].product_id) === cigarro && Number(mov[1].quantity) === 20
      && Number(mov[1].unit_cost) === 4,
    'queda la apertura: salida de 1 cajetilla y entrada de 20 cigarros a 4', JSON.stringify(mov));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.inventory_movements WHERE reference = N'${v.sale_id}' AND source = 'SALE';`)) === 1,
    'y la venta sale del cigarro, como cualquier producto');

  v = vender([[cigarro, 17, 6]]);
  check(stock(cajetilla) === 2 && stock(cigarro) === 0 && aperturas(v.sale_id).length === 0,
    'si alcanzan las piezas, no abre nada');

  v = vender([[cigarro, 25, 6]]);
  check(stock(cajetilla) === 0 && stock(cigarro) === 15, '25 cigarros sin piezas: abre 2 cajetillas',
    `cajetilla ${stock(cajetilla)}, cigarro ${stock(cigarro)}`);

  // ================================================================
  seccion('5. Sin paquetes para abrir');
  const ventas = Number(escalar(`SELECT COUNT(*) FROM dbo.sales;`));
  f = falla(venta([[cigarro, 16, 6]]), 'No alcanzan las piezas');
  check(f.ok, 'pedir 16 con 15 sueltos y ninguna cajetilla se rechaza', f.error);
  check(stock(cigarro) === 15 && Number(escalar(`SELECT COUNT(*) FROM dbo.sales;`)) === ventas,
    'y no queda nada escrito');

  fijar(cajetilla, 1); fijar(cigarro, 0);
  f = falla(venta([[cajetilla, 1, 95], [cigarro, 1, 6]]), 'para abrir');
  check(f.ok, 'la cajetilla vendida entera en la misma venta ya no se abre', f.error);
  check(stock(cajetilla) === 1 && stock(cigarro) === 0, 'y el stock sigue igual');
  vender([[cajetilla, 1, 95]]);
  check(stock(cajetilla) === 0, 'la cajetilla entera se sigue vendiendo como siempre');

  // ================================================================
  seccion('6. Apagado y desligar');
  fijar(cajetilla, 5); fijar(cigarro, 0);
  q(`EXEC dbo.sp_set_business_module @module_key = N'venta-suelta', @enabled = 0;`);
  f = falla(venta([[cigarro, 1, 6]]), 'No hay stock suficiente');
  check(f.ok && stock(cajetilla) === 5, 'con el modulo apagado no se abre nada', f.error);
  const apagado = uno(`DECLARE @mo dbo.SaleModifierType; EXEC dbo.sp_check_availability @product_id=${cigarro}, @SaleModifiers=@mo;`);
  check(Number(apagado.disponible) === 0, 'y la caja ya no cuenta las cajetillas como cigarros');
  q(`EXEC dbo.sp_set_business_module @module_key = N'venta-suelta', @enabled = 1;`);
  q(ligar(cigarro, null, null));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.venta_suelta;`)) === 0, 'desligar borra la fila');
  check(stock(cigarro) === 0 && stock(cajetilla) === 5, 'y no toca el stock de ninguno');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) try { eliminar(DB); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
