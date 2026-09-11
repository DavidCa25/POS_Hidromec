/**
 * Alertas de reposicion: cada tipo de producto se mide como lo que es.
 *
 *     node scripts/db/pruebas/alertas.mjs [--conservar]
 *
 * QUE SE ROMPIO
 * -------------
 * En la VM, un producto RECIPE aparecio en Alertas diciendo algo equivalente a
 * "se acabara en menos de 0 dias".
 *
 * `sp_reorder_suggestions` medía TODO contra `products.stock` y contra
 * `sale_detail`:
 *
 *   - Un RECIPE tiene stock 0 POR DISENO. La division daba 0, el filtro
 *     `0 <= @dias_alerta` lo dejaba pasar, y cada bebida vendida salia con
 *     cero dias restantes aunque hubiera ingredientes de sobra.
 *   - Un NONE -un servicio- tampoco tiene existencias: mismo caso.
 *   - Un INGREDIENTE nunca aparece en `sale_detail` -se vende el latte, no la
 *     leche-, asi que justo lo que hay que reponer no alertaba NUNCA.
 *
 * QUE COMPRUEBA
 * -------------
 * Los cuatro tipos, con datos controlados y cifras calculadas a mano:
 *
 *   DIRECT vendido en caja   alerta con los dias que le quedan
 *   DIRECT ingrediente       alerta por lo que consumen las recetas
 *   RECIPE                   dias segun sus INGREDIENTES, y dice cual limita
 *   NONE                     nunca alerta
 *   inactivo                 nunca alerta
 *
 * Y que ningun renglon puede salir con dias negativos, nulos o absurdos.
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
const DB = 'Wybix_TmpAlertas';
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
const cerca = (a, b, eps = 0.01) => Math.abs(Number(a) - Number(b)) < eps;

try {
  console.log(`\nALERTAS: CADA PRODUCTO SE MIDE COMO LO QUE ES   (${DB})`);

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

  // --------------------------------------------------------------- base
  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secreta1'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'General');`);
  const userId = Number(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id;`));
  const brand  = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const cat    = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'General';`));

  const alta = (o) => Number(escalar(`
    EXEC dbo.sp_add_product
      @brand=${brand}, @part_number=N'${o.pn}', @name=N'${o.name}',
      @price=${o.price ?? 0}, @stock=${o.stock ?? 0}, @category=${cat},
      @inventory_mode='${o.mode ?? 'DIRECT'}', @sellable=${o.sellable ?? 1},
      @base_uom='${o.uom ?? 'pza'}', @allow_decimal_qty=${o.dec ?? 0},
      @cost=${o.cost ?? 'NULL'};`));

  //  Refresco  DIRECT vendible: 40 pza, se venden 2 al dia -> 20 dias
  //  Cafe      DIRECT insumo:  600 g, cada bebida lleva 20 g
  //  Leche     DIRECT insumo: 1000 ml, cada bebida lleva 200 ml
  //  Latte     RECIPE
  //  Servicio  NONE
  //  Retirado  DIRECT dado de baja
  // Nacen con holgura para que las 30 ventas quepan; el stock FINAL se fija
  // despues, que es el que hace las cuentas legibles.
  const refresco = alta({ pn: 'AL-REF',  name: 'Refresco',     stock: 1000,   price: 20, cost: 8 });
  const cafe     = alta({ pn: 'AL-CAFE', name: 'Cafe molido',  stock: 100000, uom: 'g',  dec: 1, sellable: 0, cost: 0.25 });
  const leche    = alta({ pn: 'AL-LEC',  name: 'Leche',        stock: 100000, uom: 'ml', dec: 1, sellable: 0, cost: 0.02 });
  const latte    = alta({ pn: 'AL-LAT',  name: 'Latte',        mode: 'RECIPE', price: 60 });
  const servicio = alta({ pn: 'AL-SRV',  name: 'Servicio',     mode: 'NONE',   price: 150 });
  const retirado = alta({ pn: 'AL-OLD',  name: 'Descontinuado', stock: 2,      price: 10, cost: 4 });

  q(`
    DECLARE @L dbo.RecipeLineType;
    INSERT INTO @L (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order)
    VALUES (${cafe}, 20, N'g', 0, 1), (${leche}, 200, N'ml', 0, 2);
    EXEC dbo.sp_save_recipe @product_id=${latte}, @Lines=@L;`);

  // Ventas repartidas en la ventana de 30 dias: 60 refrescos y 30 lattes.
  //   refresco -> 2/dia · quedan 40 -> 20 dias
  //   cafe     -> 30 lattes x 20 g = 600 g consumidos = 20 g/dia
  //               quedan 600 -> 30 dias
  //   leche    -> 30 x 200 = 6000 ml = 200 ml/dia · quedan 1000 -> 5 dias
  //   latte    -> 1/dia · disponibilidad = min(600/20, 1000/200) = min(30, 5) = 5
  //               -> 5 dias, limitado por la Leche
  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=0, @register_id=1;`);
  for (let d = 1; d <= 30; d++) {
    q(`
      DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
      INSERT INTO @d2 (line_no, product_id, quantity, unit_price)
      VALUES (1, ${refresco}, 2, 20), (2, ${latte}, 1, 60);
      EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO',
        @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);
  }
  // Las ventas quedaron todas hoy; se reparten hacia atras para que la
  // ventana de 30 dias mida un ritmo y no un pico.
  q(`
    WITH n AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS k FROM dbo.sales)
    UPDATE s SET datee = DATEADD(DAY, -(n.k - 1), GETDATE())
    FROM dbo.sales s JOIN n ON n.id = s.id;
    WITH n AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS k FROM dbo.inventory_movements WHERE typee = 'salida')
    UPDATE m SET datee = DATEADD(DAY, -((n.k - 1) / 3), GETDATE())
    FROM dbo.inventory_movements m JOIN n ON n.id = m.id;`);

  // El stock quedo consumido por las ventas: se deja en las cifras del guion.
  q(`
    UPDATE dbo.products SET stock = 40   WHERE id = ${refresco};
    UPDATE dbo.products SET stock = 600  WHERE id = ${cafe};
    UPDATE dbo.products SET stock = 1000 WHERE id = ${leche};
    UPDATE dbo.products SET active = 0   WHERE id = ${retirado};`);

  const alertas = (dias = 30) => {
    const r = consultarTemporal(DB, `EXEC dbo.sp_reorder_suggestions @dias_ventana=30, @dias_alerta=${dias}, @dias_objetivo=30;`);
    if (!r.ok) throw new Error(limpiar(r.error));
    return r.sets[0] ?? [];
  };
  const filas = alertas(30);
  const de = (id) => filas.find(f => Number(f.id) === id);

  // =============================================================== 1
  seccion('1. DIRECT vendido en caja: su propio stock');
  const fRef = de(refresco);
  check(!!fRef, 'el refresco alerta');
  check(fRef && Number(fRef.stock) === 40, 'con su stock propio', fRef ? `stock ${fRef.stock}` : '');
  check(fRef && Number(fRef.dias_restantes) === 20,
    '40 unidades a 2 por dia = 20 dias', fRef ? `${fRef.dias_restantes} dias` : '');
  check(fRef && Number(fRef.sugerido) > 0,
    'y sugiere cuanto comprar para cubrir 30 dias', fRef ? `sugerido ${fRef.sugerido}` : '');

  // =============================================================== 2
  seccion('2. DIRECT ingrediente: lo consumen las recetas, no las ventas');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.sale_detail WHERE product_id = ${leche};`)) === 0,
    'la leche no aparece en ninguna venta: se vende el latte, no la leche');
  const fLec = de(leche);
  check(!!fLec, 'y aun asi alerta', fLec ? `${fLec.dias_restantes} dias` : 'NO ALERTA');
  check(fLec && Number(fLec.dias_restantes) === 5,
    '1000 ml a 200 ml por dia = 5 dias', fLec ? `${fLec.dias_restantes}` : '');
  const fCaf = de(cafe);
  check(fCaf && Number(fCaf.dias_restantes) === 30,
    'y el cafe, con mas holgura, sale a 30 dias', fCaf ? `${fCaf.dias_restantes}` : 'no alerta');

  // =============================================================== 3
  seccion('3. RECIPE: existencia calculada, y dice quien la limita');
  const fLat = de(latte);
  check(!!fLat, 'el latte alerta');
  check(fLat && Number(fLat.stock) === 5,
    'su existencia son 5 unidades, no el 0 de products.stock',
    fLat ? `${fLat.stock}` : '');
  check(Number(escalar(`SELECT stock FROM dbo.products WHERE id = ${latte};`)) === 0,
    'y en la tabla su stock propio sigue siendo 0, como debe ser');
  check(fLat && Number(fLat.dias_restantes) === 5,
    '5 unidades a 1 por dia = 5 dias', fLat ? `${fLat.dias_restantes}` : '');
  check(fLat && fLat.limita_nombre === 'Leche' && cerca(fLat.limita_necesita, 200),
    'y nombra al ingrediente que la limita',
    fLat ? `${fLat.limita_nombre}: hay ${fLat.limita_stock} ${fLat.limita_uom}, pide ${fLat.limita_necesita}` : '');
  check(fLat && fLat.sugerido === null,
    'sin cantidad sugerida: una receta no se compra, se compra su ingrediente');

  // =============================================================== 4
  seccion('4. NONE e inactivos no alertan nunca');
  check(!de(servicio), 'un servicio sin inventario no aparece');
  check(!de(retirado), 'un producto dado de baja tampoco');
  check(filas.every(f => f.inventory_mode !== 'NONE'), 'ningun NONE se colo en la lista');

  // =============================================================== 5
  seccion('5. Ninguna cifra absurda');
  const malas = filas.filter(f => {
    const d = Number(f.dias_restantes);
    return !Number.isFinite(d) || d < 0 || f.dias_restantes === null;
  });
  check(malas.length === 0,
    'ningun renglon con dias negativos, nulos ni infinitos',
    malas.length ? malas.map(f => `${f.nombre}=${f.dias_restantes}`).join(', ') : `${filas.length} renglones`);
  check(filas.every(f => Number(f.prom_diario) > 0),
    'y todos tienen un ritmo de consumo real');

  // Sin existencias la cifra es 0, nunca negativa.
  q(`UPDATE dbo.products SET stock = 0 WHERE id = ${leche};`);
  const sinLeche = alertas(30);
  const latteSinLeche = sinLeche.find(f => Number(f.id) === latte);
  check(latteSinLeche && Number(latteSinLeche.dias_restantes) === 0 && Number(latteSinLeche.stock) === 0,
    'con el ingrediente en cero, la receta sale en 0 dias -no en -1-',
    latteSinLeche ? `${latteSinLeche.dias_restantes} dias, ${latteSinLeche.stock} disponibles` : 'no aparece');
  check(latteSinLeche && latteSinLeche.limita_nombre === 'Leche',
    'y sigue diciendo que falta la Leche');

  // =============================================================== 6
  seccion('6. El umbral de dias filtra de verdad');
  const cortas = alertas(6).map(f => Number(f.dias_restantes));
  check(cortas.length > 0 && cortas.every(d => d <= 6),
    'con umbral de 6 dias no entra nada por encima', `${cortas.length} renglones: ${cortas.join(', ')}`);

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
