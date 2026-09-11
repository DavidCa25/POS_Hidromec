/**
 * LA RECETA DEPENDE DEL TAMANO, Y EL CIERRE DEPENDE DE SU CAJA.
 *
 *     node scripts/db/pruebas/receta-por-variante.mjs [--conservar]
 *
 * DOS FALLOS DE QA, LOS DOS POR "DAR ALGO POR SUPUESTO".
 *
 * A) RETAIL DECIA "NO HAY RECETA CONFIGURADA" Y ERA MENTIRA
 *    Los productos 5 y 7 tenian receta, pero solo la de la variante
 *    (`variant_option_id = 1`). `sp_register_sale` resuelve la receta contra
 *    las opciones de rol SIZE de la linea; Retail no mandaba ninguna, no
 *    encontraba receta, y culpaba a la configuracion. Quien leyera ese mensaje
 *    iria a revisar las recetas, que estaban perfectas.
 *
 * B) CERRAR LA CAJA 2 VALIDABA LA CAJA 1
 *    La pantalla de Corte no mandaba `register_id` al cerrar. El procedimiento
 *    caia a `TOP 1 ... ORDER BY id` -la Caja 1- y validaba SU arriendo. La
 *    laptop, cerrando su propia Caja 2, leia "Esta caja la esta usando
 *    DESKTOP-LNQIU8G": cierto de la Caja 1, que no era la suya.
 *
 * Se prueban contra SQL de verdad, sobre una restauracion del baseline.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpVariante';
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
const falla = (sql) => {
  const r = consultarTemporal(DB, sql);
  return r.ok ? { ok: false, error: null } : { ok: true, error: limpiar(r.error) };
};

const M1 = 'aa11aa11aa11aa11aa11aa11aa11aa11';   // la VM
const M2 = 'bb22bb22bb22bb22bb22bb22bb22bb22';   // la laptop
const NOMBRE = { [M1]: 'DESKTOP-LNQIU8G', [M2]: 'Casillas' };

try {
  console.log(`\nRECETA POR VARIANTE Y CIERRE POR CAJA   (${DB})`);
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

  // ---------------------------------------------------------------- semilla
  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secreta1'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');`);
  const userId = Number(escalar('SELECT TOP 1 id FROM dbo.users ORDER BY id;'));
  const brand = Number(escalar('SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;'));
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Bebidas';`));

  // Ingrediente y bebida, igual que el Caramel Macchiato del QA.
  const cafe = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-CAFE', @name=N'Cafe molido',
      @price=0, @stock=10000, @category=${cat}, @cost=0.05,
      @inventory_mode=N'DIRECT', @sellable=0, @base_uom=N'g';`));
  const bebida = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-MACCHIATO', @name=N'Caramel Macchiato',
      @price=75, @stock=0, @category=${cat}, @cost=0,
      @inventory_mode=N'RECIPE', @sellable=1;`));

  // Grupo de tamano con UNA sola opcion: la forma exacta de los productos 5 y 7.
  q(`
    INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order)
    VALUES (N'Tamano', N'SIZE', 1, 1, 1, 1, 0);`);
  const grupo = Number(escalar('SELECT TOP 1 id FROM dbo.modifier_groups ORDER BY id DESC;'));
  q(`
    INSERT INTO dbo.modifier_options (group_id, name, effect, price_delta, active, sort_order)
    VALUES (${grupo}, N'Chico', N'SCALE', 0, 1, 0);`);
  const chico = Number(escalar('SELECT TOP 1 id FROM dbo.modifier_options ORDER BY id DESC;'));
  q(`INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order) VALUES (${bebida}, ${grupo}, 0);`);

  // La receta SOLO existe para la variante. Ese es el caso del QA.
  q(`
    INSERT INTO dbo.recipes (product_id, variant_option_id, active)
    VALUES (${bebida}, ${chico}, 1);`);
  const receta = Number(escalar('SELECT TOP 1 id FROM dbo.recipes ORDER BY id DESC;'));
  q(`
    INSERT INTO dbo.recipe_lines (recipe_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct)
    VALUES (${receta}, ${cafe}, 60, 60, N'g', 0);`);

  const vender = (opcionId, machine, caja = 1) => falla(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${bebida}, 1, 75);
    ${opcionId ? `INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${opcionId}, 1);` : ''}
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=${caja}, @SaleDetails2=@d2, @SaleModifiers=@mo` +
    (machine ? `, @machine_id=N'${machine}', @machine_name=N'${NOMBRE[machine]}'` : '') + ';');

  // =========================================================================
  seccion('A1. La receta por variante se encuentra CON el tamano');

  check(Number(escalar(`
    SELECT COUNT(*) FROM dbo.recipes WHERE product_id = ${bebida} AND variant_option_id = ${chico} AND active = 1;`)) === 1,
    'el producto tiene receta solo para la variante', 'igual que product_id 5 y 7 del QA');
  check(Number(escalar(`
    SELECT COUNT(*) FROM dbo.recipes WHERE product_id = ${bebida} AND variant_option_id IS NULL;`)) === 0,
    'y NO tiene receta base');

  const conVar = q(`EXEC dbo.sp_get_recipe @product_id=${bebida}, @variant_option_id=${chico};`);
  check(conVar.length > 0, 'sp_get_recipe con la variante devuelve receta');
  const sinVar = q(`EXEC dbo.sp_get_recipe @product_id=${bebida}, @variant_option_id=NULL;`);
  check(sinVar.length === 0, 'y sin variante no devuelve nada',
    'esto es correcto: la receta depende de la variante y NO se toca');

  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=100, @register_id=1;`);

  const okVenta = vender(chico, null);
  check(okVenta.error === null, 'la venta CON el tamano pasa', okVenta.error ?? 'sin error');
  check(Number(escalar(`
    SELECT stock FROM dbo.products WHERE id = ${cafe};`)) === 9940,
    'y descuenta los 60 g de cafe de la receta de la variante',
    String(escalar(`SELECT stock FROM dbo.products WHERE id = ${cafe};`)));

  // =========================================================================
  seccion('A2. Sin tamano, el mensaje dice la VERDAD');

  const sinTamano = vender(null, null);
  check(sinTamano.ok, 'la venta sin tamano se rechaza');
  check(!/no tiene receta configurada/.test(sinTamano.error || ''),
    'y YA NO dice "no tiene receta configurada"',
    'era falso: la receta estaba, faltaba el tamano');
  check(/[Ff]alta elegir/.test(sinTamano.error || ''),
    'dice que falta elegir', sinTamano.error?.slice(0, 90));
  // Con el grupo marcado como obligatorio, quien caza el caso primero es la
  // validacion de grupos requeridos, con un mensaje igual de veraz. El mensaje
  // nuevo cubre el caso en que el grupo NO es obligatorio (o no esta ligado al
  // producto), que es donde antes se mentia.
  q(`UPDATE dbo.modifier_groups SET required = 0, min_select = 0 WHERE id = ${grupo};`);
  const noObligatorio = vender(null, null);
  check(/[Ff]alta elegir el tamano/.test(noObligatorio.error || ''),
    'y con el grupo NO obligatorio, el mensaje nuevo lo explica',
    noObligatorio.error?.slice(0, 100));
  check(/depende del tamano/.test(noObligatorio.error || ''),
    'diciendo que la receta depende del tamano', 'antes decia "no tiene receta configurada"');
  q(`UPDATE dbo.modifier_groups SET required = 1, min_select = 1 WHERE id = ${grupo};`);
  check(/Caramel Macchiato/.test(sinTamano.error || ''), 'y nombra el producto');

  // =========================================================================
  seccion('A3. Los otros dos casos siguen distinguiendose');

  // Producto RECIPE sin ninguna receta: ahi el mensaje original SI es correcto.
  const huerfano = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-SINRECETA', @name=N'Bebida sin receta',
      @price=50, @stock=0, @category=${cat}, @cost=0, @inventory_mode=N'RECIPE', @sellable=1;`));
  const rHuerfano = falla(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${huerfano}, 1, 50);
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);
  check(/no tiene receta configurada/.test(rHuerfano.error || ''),
    'un producto sin NINGUNA receta sigue diciendo "no tiene receta configurada"',
    rHuerfano.error?.slice(0, 80));

  // Tamano elegido que no tiene receta propia, y sin receta base.
  q(`INSERT INTO dbo.modifier_options (group_id, name, effect, price_delta, active, sort_order)
     VALUES (${grupo}, N'Grande', N'SCALE', 15, 1, 1);`);
  const grande = Number(escalar('SELECT TOP 1 id FROM dbo.modifier_options ORDER BY id DESC;'));
  const rGrande = vender(grande, null);
  check(/tamano elegido/i.test(rGrande.error || ''),
    'un tamano sin receta propia lo dice como tal', rGrande.error?.slice(0, 90));
  check(!/no tiene receta configurada/.test(rGrande.error || ''),
    'y no se confunde con "producto sin receta"');

  // =========================================================================
  seccion('A4. Falta de disponibilidad es OTRA cosa');

  q(`UPDATE dbo.products SET stock = 10 WHERE id = ${cafe};`);
  const sinStock = vender(chico, null);
  check(sinStock.ok && /[Ss]tock|suficiente|alcanza|insuficiente/.test(sinStock.error || ''),
    'con receta pero sin ingrediente, el error habla de existencias',
    sinStock.error?.slice(0, 90));
  q(`UPDATE dbo.products SET stock = 10000 WHERE id = ${cafe};`);

  // =========================================================================
  seccion('B1. Cada caja cierra la SUYA (el fallo de la laptop)');

  q('DELETE FROM dbo.cash_movements; DELETE FROM dbo.sale_detail; DELETE FROM dbo.sales; DELETE FROM dbo.cash_closures;');
  const c2 = Number(uno(`EXEC dbo.sp_add_register @name=N'Caja 2';`)?.id);
  q(`EXEC dbo.sp_register_release @register_id=1, @machine_id=NULL, @por=N'ADMIN';`);
  q(`EXEC dbo.sp_register_claim @register_id=1, @machine_id=N'${M1}', @machine_name=N'${NOMBRE[M1]}';`);
  q(`EXEC dbo.sp_register_claim @register_id=${c2}, @machine_id=N'${M2}', @machine_name=N'${NOMBRE[M2]}';`);
  check(escalar(`SELECT machine_name FROM dbo.register_assignments WHERE register_id = 1;`) === NOMBRE[M1] &&
        escalar(`SELECT machine_name FROM dbo.register_assignments WHERE register_id = ${c2};`) === NOMBRE[M2],
    'C1 es de la VM y C2 de la laptop', `1=${NOMBRE[M1]} · ${c2}=${NOMBRE[M2]}`);

  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=100, @register_id=1, @machine_id=N'${M1}', @machine_name=N'${NOMBRE[M1]}';`);
  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=100, @register_id=${c2}, @machine_id=N'${M2}', @machine_name=N'${NOMBRE[M2]}';`);
  check(Number(escalar('SELECT COUNT(*) FROM dbo.cash_closures WHERE closed_at IS NULL;')) === 2,
    'cada equipo abre su propio turno');

  check(vender(chico, M1, 1).error === null && vender(chico, M2, c2).error === null,
    'y cada uno vende en su caja');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.sales WHERE register_id = 1;`)) === 1 &&
        Number(escalar(`SELECT COUNT(*) FROM dbo.sales WHERE register_id = ${c2};`)) === 1,
    'el register_id de las ventas es el correcto en cada caja');

  // EL CASO EXACTO: la laptop cierra SU caja mandando su closure_id.
  const turnoC2 = Number(escalar(
    `SELECT id FROM dbo.cash_closures WHERE register_id = ${c2} AND closed_at IS NULL;`));
  const cierreC2 = falla(`
    EXEC dbo.sp_close_shift @closure_id=${turnoC2}, @user_id=${userId}, @cash_delivered=0,
      @register_id=${c2}, @machine_id=N'${M2}', @machine_name=N'${NOMBRE[M2]}';`);
  check(cierreC2.error === null, 'la laptop cierra su Caja 2', cierreC2.error ?? 'sin error');
  check(Number(escalar(
    `SELECT COUNT(*) FROM dbo.cash_closures WHERE register_id = ${c2} AND closed_at IS NULL;`)) === 0,
    'y el turno de C2 queda cerrado');
  check(Number(escalar(
    'SELECT COUNT(*) FROM dbo.cash_closures WHERE register_id = 1 AND closed_at IS NULL;')) === 1,
    'sin tocar el turno de C1');

  // =========================================================================
  seccion('B2. Sin register_id, la caja sale del TURNO, no de "la primera"');

  q(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=50, @register_id=${c2}, @machine_id=N'${M2}', @machine_name=N'${NOMBRE[M2]}';`);
  const turno2 = Number(escalar(
    `SELECT id FROM dbo.cash_closures WHERE register_id = ${c2} AND closed_at IS NULL;`));

  // Exactamente lo que mandaba la pantalla de Corte: closure_id, sin register_id.
  const sinCaja = falla(`
    EXEC dbo.sp_close_shift @closure_id=${turno2}, @user_id=${userId}, @cash_delivered=0,
      @machine_id=N'${M2}', @machine_name=N'${NOMBRE[M2]}';`);
  check(sinCaja.error === null,
    'cerrar sin mandar register_id YA NO valida la Caja 1', sinCaja.error ?? 'sin error');
  check(!/DESKTOP-LNQIU8G/.test(sinCaja.error || ''),
    'y no nombra al equipo de la otra caja', 'ese era el mensaje del QA');
  check(Number(escalar(
    `SELECT COUNT(*) FROM dbo.cash_closures WHERE register_id = ${c2} AND closed_at IS NULL;`)) === 0,
    'el turno correcto quedo cerrado');

  // =========================================================================
  seccion('B3. Una caja ajena SIGUE rechazandose');

  const turnoC1 = Number(escalar(
    'SELECT id FROM dbo.cash_closures WHERE register_id = 1 AND closed_at IS NULL;'));
  const ajena = falla(`
    EXEC dbo.sp_close_shift @closure_id=${turnoC1}, @user_id=${userId}, @cash_delivered=0,
      @register_id=1, @machine_id=N'${M2}', @machine_name=N'${NOMBRE[M2]}';`);
  check(ajena.ok, 'la laptop NO puede cerrar la Caja 1', ajena.error?.slice(0, 70));
  check(/DESKTOP-LNQIU8G/.test(ajena.error || ''),
    'y AHI si nombra al equipo que la tiene, que es el correcto', ajena.error?.slice(0, 80));
  check(Number(escalar(
    'SELECT COUNT(*) FROM dbo.cash_closures WHERE register_id = 1 AND closed_at IS NULL;')) === 1,
    'el turno de C1 sigue abierto');

  const ventaAjena = vender(chico, M2, 1);
  check(ventaAjena.ok && /DESKTOP-LNQIU8G/.test(ventaAjena.error || ''),
    'y vender en la caja ajena tambien se rechaza', 'el bloqueo no se relajo');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
