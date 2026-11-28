/**
 * LA BOLSA DEL MESERO (0097), CONTRA UNA BASE DE VERDAD.
 *
 *     npm run db:test-bolsa-mesero
 *
 * Dos meseros cobran mesas desde su tablet; el efectivo lo traen ellos hasta
 * entregarlo en caja:
 *
 *   1  un cobro en efectivo con propina en efectivo va entero a la bolsa
 *      (MESERO_BOLSA −) y el cajón no lo espera;
 *   2  con tarjeta, la bolsa no cambia; registrar dos veces no duplica;
 *   3  la cuenta del mesero: mesas, por método, propinas, en bolsa;
 *   4  entregar menos de lo debido: la diferencia queda en la entrega y el
 *      cajón cuadra con lo entregado; entregar en dos partes;
 *   5  el resumen para la caja y el corte con lo que de verdad entró.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

const DB = 'Wybix_TmpBolsaMesero';
let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const sets = (s) => { const r = consultarTemporal(DB, s); if (!r.ok) throw new Error(r.error); return r.sets ?? []; };
const q = (s) => { const x = sets(s); return x.length ? x[x.length - 1] : []; };
const uno = (s) => q(s)[0] ?? {};
const escalar = (s) => Object.values(uno(s))[0];
const falla = (s) => { const r = consultarTemporal(DB, s); return r.ok ? null : String(r.error); };
const n = Number;
const lotesDe = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map((x) => x.trim()).filter(Boolean);

exigirTemporal(DB);
try {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));
  const dir = join(process.cwd(), 'electron', 'migrations');
  const lotes = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().flatMap((f) => lotesDe(join(dir, f)));
  const r = ejecutarVarios(DB, lotes);
  const malo = r.findIndex((x) => !x.ok);
  if (malo >= 0) throw new Error(`migraciones, lote ${malo + 1}: ${r[malo].error}`);
  ejecutar(DB, `EXEC dbo.sp_setup_inicial @usuario = N'cajera', @password = N'cajera1234', @business_name = N'Taquería', @business_profile = N'HOSPITALITY';
                EXEC dbo.sp_set_business_module @module_key = N'propinas', @enabled = 1;`);
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES
       (N'ana', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x'), 2), N'cajero', 1, GETDATE()),
       (N'beto', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x'), 2), N'cajero', 1, GETDATE());
     INSERT INTO dbo.CAT_categories (namee) VALUES (N'Tacos'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');`);
  const cajera = n(escalar(`SELECT id FROM dbo.users WHERE usuario = N'cajera'`));
  const ana = n(escalar(`SELECT id FROM dbo.users WHERE usuario = N'ana'`));
  const beto = n(escalar(`SELECT id FROM dbo.users WHERE usuario = N'beto'`));
  q(`EXEC dbo.sp_add_product @brand=1, @category=1, @part_number=N'TAC', @name=N'Taco al pastor', @price=25, @stock=0, @inventory_mode=N'NONE', @sellable=1;`);
  const taco = n(escalar(`SELECT id FROM dbo.products WHERE part_number = N'TAC'`));
  const turno = n(uno(`EXEC dbo.sp_open_shift @user_id=${cajera}, @opening_cash=500, @register_id=1;`).closure_id);

  const vender = (mesero, qty, metodo) => n(uno(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${taco}, ${qty}, 25);
    EXEC dbo.sp_register_sale @user_id=${mesero}, @payment_method=N'${metodo}', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`).sale_id);
  const propina = (venta, monto, metodo) => q(`EXEC dbo.sp_propina_registrar @sale_id=${venta}, @monto=${monto}, @metodo='${metodo}', @user_id=NULL;`);
  const cobro = (venta, mesero) => uno(`EXEC dbo.sp_mesero_cobro_registrar @sale_id=${venta}, @mesero_id=${mesero}, @cuenta_id=NULL;`);
  const cuenta = (mesero) => sets(`EXEC dbo.sp_mesero_cuenta @mesero_id=${mesero}`);
  const esperadoCajon = () => n(escalar(`SELECT 500 + ISNULL(SUM(CASE WHEN typee = 'OPENING' THEN 0 ELSE amount END), 0) FROM dbo.cash_movements WHERE closure_id = ${turno}`));

  seccion('1. Efectivo con propina: a la bolsa de Ana');
  const v1 = vender(ana, 12, 'EFECTIVO');        // $300
  propina(v1, 30, 'EFECTIVO');
  const c1 = cobro(v1, ana);
  check(n(c1.efectivo) === 330 && n(c1.propina) === 30, 'en la bolsa: $300 de la mesa y $30 de propina', `${c1.efectivo} · propina ${c1.propina}`);
  check(n(escalar(`SELECT amount FROM dbo.cash_movements WHERE reference_id = ${v1} AND typee = 'MESERO_BOLSA'`)) === -330, 'MESERO_BOLSA −330 en el turno');
  check(esperadoCajon() === 500, 'el cajón sigue esperando solo el fondo', String(esperadoCajon()));

  seccion('2. Con tarjeta, y registrar dos veces');
  const v2 = vender(beto, 8, 'TARJETA');          // $200
  propina(v2, 20, 'TARJETA');
  const c2 = cobro(v2, beto);
  check(n(c2.efectivo) === 0, 'Beto cobró con tarjeta: su bolsa no cambia');
  cobro(v1, ana);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE reference_id = ${v1} AND typee = 'MESERO_BOLSA'`)) === 1, 'registrar otra vez no duplica');
  const v3 = vender(ana, 4, 'EFECTIVO');          // $100
  cobro(v3, ana);

  seccion('3. La cuenta de Ana');
  const [ra] = cuenta(ana);
  const a = ra[0];
  check(n(a.mesas) === 2 && n(a.cobrado) === 400 && n(a.en_efectivo) === 400, 'dos mesas, $400 en efectivo', JSON.stringify(a));
  check(n(a.propinas) === 30 && n(a.propinas_efectivo) === 30, '$30 de propina en efectivo');
  check(n(a.en_bolsa) === 430 && n(a.por_entregar) === 430, 'trae $430 y los debe entregar');
  const [rb] = cuenta(beto);
  check(n(rb[0].con_tarjeta) === 200 && n(rb[0].en_bolsa) === 0 && n(rb[0].propinas) === 20, 'Beto: $200 con tarjeta y $20 de propina, nada en bolsa');

  seccion('4. Entregas');
  const e1 = uno(`EXEC dbo.sp_mesero_entregar @mesero_id=${ana}, @entregado=200, @register_id=1, @user_id=${cajera}, @nota=N'a media noche'`);
  check(n(e1.esperado) === 430 && n(e1.diferencia) === -230, 'la primera entrega se compara contra todo lo que traía', JSON.stringify(e1));
  const tras1 = cuenta(ana)[0][0];
  check(n(tras1.por_entregar) === 0 && n(tras1.diferencia) === -230, 'lo que no entregó queda como diferencia, no como pendiente', JSON.stringify(tras1));
  check(esperadoCajon() === 700, 'el cajón espera el fondo más lo entregado', String(esperadoCajon()));
  const v4 = vender(ana, 2, 'EFECTIVO');          // $50 más tarde
  cobro(v4, ana);
  const e2 = uno(`EXEC dbo.sp_mesero_entregar @mesero_id=${ana}, @entregado=50, @register_id=1, @user_id=${cajera}`);
  check(n(e2.esperado) === 50 && n(e2.diferencia) === 0, 'la segunda entrega solo cuenta lo nuevo', JSON.stringify(e2));
  check(/por entregar/.test(falla(`EXEC dbo.sp_mesero_entregar @mesero_id=${beto}, @entregado=0, @register_id=1`) || ''), 'Beto no tiene efectivo por entregar');
  check(/0 en adelante/.test(falla(`EXEC dbo.sp_mesero_entregar @mesero_id=${ana}, @entregado=-1, @register_id=1`) || ''), 'entregar menos de $0 se rechaza');

  seccion('5. La caja');
  const res = q(`EXEC dbo.sp_meseros_resumen`);
  const ra2 = res.find((x) => n(x.mesero_id) === ana), rb2 = res.find((x) => n(x.mesero_id) === beto);
  check(res.length === 2 && n(ra2.entregado) === 250 && n(ra2.por_entregar) === 0 && n(ra2.diferencia) === -230, 'Ana entregó $250, le faltaron $230', JSON.stringify(ra2));
  check(n(rb2.cobrado) === 200 && n(rb2.por_entregar) === 0, 'Beto no debe efectivo');
  const corte = uno(`EXEC dbo.sp_close_shift @closure_id=${turno}, @user_id=${cajera}, @cash_delivered=750, @register_id=1;`);
  const cierre = uno(`SELECT cash_expected, difference FROM dbo.cash_closures WHERE id = ${turno}`);
  check(n(cierre.cash_expected) === 750 && n(cierre.difference) === 0, 'el corte espera fondo + lo entregado ($750) y cuadra', JSON.stringify(cierre));
  check(q(`EXEC dbo.sp_meseros_resumen`).length === 0, 'cerrado el turno, ya no hay bolsas abiertas');
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.message}`);
} finally {
  try { eliminar(DB); } catch { /* noop */ }
}
console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
