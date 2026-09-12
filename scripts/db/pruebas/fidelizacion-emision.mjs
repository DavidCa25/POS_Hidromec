/**
 * Emitir cupones a mano y rifas con un numero de boletos.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/fidelizacion-emision.mjs
 *
 * POR QUE EXISTEN ESTAS DOS COSAS
 * -------------------------------
 * Un cupon solo nacia dentro de la evaluacion de una venta: habia que
 * montar una campana y esperar a que alguien comprase. Definir el cupon y
 * quedarse ahi no producia ni un solo codigo usable, asi que el flujo no
 * se podia terminar desde la pantalla.
 *
 * Y una rifa repartia boletos sin fin: no habia forma de decir "son
 * quinientos", ni de ver cuantos quedaban.
 *
 * Aqui se comprueban las dos caras de cada una: que hacen lo que dicen, y
 * que se niegan cuando toca.
 */
import { q, rows, row, scalar, check, seccion, resumen, fails, fixtureCafe, DB } from './lib.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

console.log(`Base de pruebas: ${DB}  (servidor ${SERVIDOR})`);
const f = fixtureCafe();

const marca = Date.now().toString().slice(-6);

/** Un turno abierto: sin el, la venta en efectivo se rechaza. */
function turno(register = 1) {
  q(`IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = ${register})
     BEGIN
       SET IDENTITY_INSERT dbo.registers ON;
       INSERT INTO dbo.registers (id, code, name, is_active) VALUES (${register}, N'C${register}', N'Caja ${register}', 1);
       SET IDENTITY_INSERT dbo.registers OFF;
     END`);
  const abierto = scalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = ${register} AND closed_at IS NULL ORDER BY id DESC`);
  if (abierto) return abierto;
  return row(`EXEC dbo.sp_open_shift @user_id=${f.userId}, @opening_cash=0, @register_id=${register};`).closure_id;
}
turno(1);

// ===================================================================
seccion('1. Un cupon apagado no se puede emitir');

const cupon = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'COUPON', @name=N'QA emision ${marca}',
    @kind=N'PERCENT', @discount_pct=10, @uses_allowed=1, @valid_days=30,
    @code_prefix=N'QE${marca.slice(-2)}', @active=0;`).id;
check(cupon > 0, `cupon creado y apagado (#${cupon})`);

const apagado = row(`EXEC dbo.sp_coupon_issue @definition_id=${cupon}, @quantity=3;`);
check(apagado.ok === false && apagado.motivo === 'APAGADO',
  'emitirlo apagado se rechaza',
  'unos codigos que nadie puede canjear son papeles en la calle y una discusion en el mostrador');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.coupon_instances WHERE definition_id = ${cupon}`)) === 0,
  'y no deja nada a medias');

// ===================================================================
seccion('2. Encendido, emite codigos usables');

q(`UPDATE dbo.coupon_definitions SET active = 1 WHERE id = ${cupon}`);
const emitidos = rows(`EXEC dbo.sp_coupon_issue @definition_id=${cupon}, @quantity=3, @machine_id=N'QA';`);
check(emitidos.length === 3, 'pedir tres devuelve tres', `devolvio ${emitidos.length}`);
check(emitidos.every(e => e.ok === true), 'y las tres dicen ok');
check(new Set(emitidos.map(e => e.code)).size === 3, 'con codigos distintos');
check(emitidos.every(e => /^QE\d{2}-\d{6}$/.test(e.code)),
  'y con el prefijo del cupon y numeracion legible',
  emitidos.map(e => e.code).join(', '));
check(emitidos.every(e => e.expires_at), 'con caducidad, porque la definicion dice 30 dias');

/* Lo importante: no es un cupon de otra clase. Lo valida el mismo
   procedimiento que valida los que reparte una campana. */
const v = row(`EXEC dbo.sp_coupon_validate @code=N'${emitidos[0].code}';`);
check(v.ok === true, 'el codigo emitido a mano lo acepta sp_coupon_validate',
  `motivo: ${v.motivo}`);

const sinVenta = row(`SELECT sale_id, campaign_id FROM dbo.coupon_instances WHERE code = N'${emitidos[0].code}'`);
check(sinVenta.sale_id === null && sinVenta.campaign_id === null,
  'y consta sin venta y sin campana, que es justo lo que es');

// ===================================================================
seccion('3. La cantidad tiene limites');

for (const [n, etiqueta] of [[0, 'cero'], [-5, 'negativa'], [501, 'quinientos uno']]) {
  const r = row(`EXEC dbo.sp_coupon_issue @definition_id=${cupon}, @quantity=${n};`);
  check(r.ok === false && r.motivo === 'CANTIDAD', `una cantidad ${etiqueta} se rechaza`);
}
check(Number(scalar(`SELECT COUNT(*) FROM dbo.coupon_instances WHERE definition_id = ${cupon}`)) === 3,
  'y ninguna de las tres emitio nada');

const fantasma = row(`EXEC dbo.sp_coupon_issue @definition_id=999999, @quantity=1;`);
check(fantasma.ok === false && fantasma.motivo === 'NO_EXISTE', 'un cupon que no existe se rechaza');

// ===================================================================
seccion('4. Una rifa puede tener un numero de boletos');

const rifa = row(`
  EXEC dbo.sp_raffle_save @name=N'QA boletos ${marca}', @prize=N'Un premio',
    @winners_count=1, @status=N'OPEN', @tickets_total=4;`).id;
check(rifa > 0, `rifa creada con tope de 4 (#${rifa})`);
check(Number(scalar(`SELECT tickets_total FROM dbo.raffle_definitions WHERE id = ${rifa}`)) === 4,
  'y el tope queda guardado');

const detalle = row(`EXEC dbo.sp_raffle_detail @raffle_id=${rifa};`);
check(Number(detalle.tickets_total) === 4, 'el detalle lo devuelve, para poder pintarlo');

/* Sin tope sigue significando sin tope: las rifas que ya existian no
   pueden quedarse limitadas por un valor por omision. */
const abierta = row(`
  EXEC dbo.sp_raffle_save @name=N'QA sin tope ${marca}', @prize=N'Otro',
    @winners_count=1, @status=N'OPEN';`).id;
check(scalar(`SELECT tickets_total FROM dbo.raffle_definitions WHERE id = ${abierta}`) === null,
  'una rifa sin tope lo guarda como NULL, no como cero');

const cero = row(`
  EXEC dbo.sp_raffle_save @id=${abierta}, @name=N'QA sin tope ${marca}', @prize=N'Otro',
    @winners_count=1, @tickets_total=0;`);
check(scalar(`SELECT tickets_total FROM dbo.raffle_definitions WHERE id = ${abierta}`) === null,
  'y un tope de cero se guarda como sin tope, no como una rifa de cero boletos');

// ===================================================================
seccion('5. El tope se respeta al repartir');

// Una campana que da 3 boletos por venta, contra una rifa de 4.
const camp = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'QA boletos ${marca}', @outcome=N'RAFFLE_ENTRY',
    @raffle_id=${rifa}, @quantity=3, @min_total=1, @priority=5, @active=1;`).id;
check(camp > 0, 'campana que reparte 3 boletos por venta');

q(`IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
     INSERT INTO dbo.business_config (business_name, business_profile, invoicing_enabled, updated_at)
     VALUES (N'Negocio de prueba', N'RETAIL', 0, GETDATE());
   UPDATE dbo.business_config SET loyalty_enabled = 1;`);
q(`UPDATE dbo.products SET stock = 100000 WHERE id = ${f.coca}`);

/** Una venta de contado que dispara la evaluacion. */
function venderYEvaluar() {
  const s = row(`
    DECLARE @d dbo.SaleDetailType;
    INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 50);
    EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d,
      @customer_id=NULL, @due_date=NULL, @register_id=1;`).sale_id;
  rows(`EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${s}, @machine_id=N'QA';`);
  return s;
}

const cuentaBoletos = () =>
  Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifa} AND status = 'VALID'`));

venderYEvaluar();
check(cuentaBoletos() === 3, 'la primera venta reparte sus 3 boletos', `hay ${cuentaBoletos()}`);

venderYEvaluar();
check(cuentaBoletos() === 4,
  'la segunda solo reparte el que cabia: la rifa se lleno en 4',
  `hay ${cuentaBoletos()}, y el tope era 4`);

venderYEvaluar();
check(cuentaBoletos() === 4, 'y a partir de ahi deja de repartir');

/* Llenarse no puede tumbar la venta ni el resto del reparto: el cliente ya
   pago y sus otros premios siguen siendo suyos. */
const ultima = venderYEvaluar();
check(Number(scalar(`SELECT COUNT(*) FROM dbo.sales WHERE id = ${ultima}`)) === 1,
  'la venta se cobra igual aunque la rifa este llena');

// ===================================================================
seccion('6. El tope no puede quedar por debajo de lo ya repartido');

const bajar = fails(
  `EXEC dbo.sp_raffle_save @id=${rifa}, @name=N'QA boletos ${marca}', @prize=N'Un premio',
    @winners_count=1, @tickets_total=2;`,
  'boletos repartidos');
check(bajar.ok, 'bajarlo de 4 a 2 con 4 repartidos se rechaza',
  `respondio: ${String(bajar.error).slice(0, 100)}`);
check(Number(scalar(`SELECT tickets_total FROM dbo.raffle_definitions WHERE id = ${rifa}`)) === 4,
  'y el tope se queda como estaba');

row(`EXEC dbo.sp_raffle_save @id=${rifa}, @name=N'QA boletos ${marca}', @prize=N'Un premio',
      @winners_count=1, @tickets_total=10;`);
check(Number(scalar(`SELECT tickets_total FROM dbo.raffle_definitions WHERE id = ${rifa}`)) === 10,
  'subirlo si se puede: ampliar una rifa no rompe nada');

venderYEvaluar();
check(cuentaBoletos() === 7, 'y vuelve a repartir hasta el nuevo tope', `hay ${cuentaBoletos()}`);

resumen();
