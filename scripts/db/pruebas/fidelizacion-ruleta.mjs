/**
 * La ruleta: sectores, sorteo del servidor y premios que entrega.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/fidelizacion-ruleta.mjs
 *
 * Lo que se demuestra:
 *   1. Los sectores se crean, se pesan y devuelven su probabilidad real.
 *   2. Un sector que promete algo no se puede guardar sin decir QUE promete.
 *   3. El SERVIDOR elige el sector: el valor que manda la pantalla se ignora.
 *   4. Con un solo sector posible, sale ese SIEMPRE.
 *   5. Con pesos desiguales, la distribucion sigue los pesos.
 *   6. Un sector de recompensa entrega una recompensa real.
 *   7. Un sector de rifa entrega el numero de boletos que dice.
 *   8. Un sector sin premio no entrega nada, y no es un error.
 *   9. Quitar un sector lo saca del sorteo sin borrar lo ya entregado.
 */
import { q, rows, row, scalar, check, seccion, resumen, fails, fixtureCafe, DB } from './lib.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

console.log(`Base de pruebas: ${DB}  (servidor ${SERVIDOR})`);
const f = fixtureCafe();

q(`IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = 1)
   BEGIN
     SET IDENTITY_INSERT dbo.registers ON;
     INSERT INTO dbo.registers (id, code, name, is_active) VALUES (1, N'C1', N'Caja 1', 1);
     SET IDENTITY_INSERT dbo.registers OFF;
   END`);
if (!scalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = 1 AND closed_at IS NULL ORDER BY id DESC`)) {
  row(`EXEC dbo.sp_open_shift @user_id=${f.userId}, @opening_cash=0, @register_id=1;`);
}
q(`UPDATE dbo.products SET stock = 100000 WHERE id = ${f.coca}`);
q(`IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
     INSERT INTO dbo.business_config (business_name, business_profile, invoicing_enabled, updated_at)
     VALUES (N'Negocio de prueba', N'RETAIL', 0, GETDATE());
   UPDATE dbo.business_config SET loyalty_enabled = 1;`);

const recompensa = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'REWARD', @name=N'Bebida gratis',
    @kind=N'AMOUNT', @amount=30, @uses_allowed=1, @active=1;`).id;

const ruleta = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'DYNAMIC', @name=N'Ruleta viernes',
    @type=N'WHEEL', @attempts_allowed=1, @reward_definition_id=${recompensa}, @active=1;`).id;

const rifa = row(`
  EXEC dbo.sp_raffle_save @name=N'Rifa de la ruleta', @prize=N'Una moto', @code_prefix=N'RUL';`).id;
row(`EXEC dbo.sp_raffle_save @id=${rifa}, @name=N'Rifa de la ruleta', @status=N'OPEN';`);

const camp = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Gira al pagar', @outcome=N'DYNAMIC',
    @dynamic_definition_id=${ruleta}, @quantity=1, @priority=10, @active=1;`).id;

const sector = (p) => rows(`EXEC dbo.sp_dynamic_save_segment ${p};`);

/** Cobra, evalua y gira. Devuelve la fila de resultado. */
function girar() {
  const saleId = row(`
    DECLARE @d dbo.SaleDetailType;
    INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 20);
    EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO',
      @SaleDetails=@d, @customer_id=NULL, @due_date=NULL, @register_id=1;`).sale_id;
  rows(`EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${saleId}, @machine_id=N'PRUEBA';`);
  const p = row(`EXEC dbo.sp_dynamic_pending @sale_id=${saleId};`);
  if (!p || !p.token) return { saleId, resultado: 'SIN_INTENTO' };
  // Se manda un valor cualquiera: la ruleta NO debe hacerle caso.
  const r = row(`EXEC dbo.sp_dynamic_play @token=N'${p.token}', @input_value=999, @machine_id=N'PRUEBA';`);
  return { ...r, saleId };
}

// ===================================================================
seccion('1 y 2. Sectores: se crean, se pesan, y no admiten promesas vacias');

const sinPremio = sector(`@definition_id=${ruleta}, @label=N'Sigue intentando', @outcome=N'NONE', @weight=3`);
check(sinPremio.length === 1, 'se crea un sector sin premio');

const conPremio = sector(`@definition_id=${ruleta}, @label=N'Bebida gratis', @outcome=N'REWARD', @reward_definition_id=${recompensa}, @weight=1`);
check(conPremio.length === 2, 'y uno con recompensa');

const conBoletos = sector(`@definition_id=${ruleta}, @label=N'5 boletos', @outcome=N'RAFFLE_ENTRY', @raffle_id=${rifa}, @quantity=5, @weight=1`);
check(conBoletos.length === 3, 'y uno con boletos de rifa');

const suma = conBoletos.reduce((a, s) => a + Number(s.probabilidad), 0);
check(Math.abs(suma - 100) < 0.5,
  'las probabilidades suman 100 %', `suman ${suma.toFixed(1)}`);
const tresQuintos = conBoletos.find(s => s.label === 'Sigue intentando');
check(Math.abs(Number(tresQuintos.probabilidad) - 60) < 0.5,
  'un peso de 3 sobre 5 son el 60 %', `${tresQuintos.probabilidad}%`);

const vacio = fails(`EXEC dbo.sp_dynamic_save_segment @definition_id=${ruleta}, @label=N'Premio misterioso', @outcome=N'REWARD';`, null);
check(vacio.ok, 'un sector de recompensa SIN recompensa se rechaza',
  vacio.ok ? `motivo: ${vacio.error}` : 'se guardaria una promesa que no entrega nada');

// ===================================================================
seccion('3 y 4. El servidor elige; la pantalla no');

/* Se dejan activos SOLO los boletos: si el valor que manda la pantalla
   influyera, mandando 999 saldria cualquier cosa menos ese sector. */
const ids = conBoletos.reduce((m, s) => (m[s.label] = s.id, m), {});
q(`UPDATE dbo.dynamic_segments SET active = 0 WHERE definition_id = ${ruleta} AND id <> ${ids['5 boletos']}`);

const forzado = girar();
check(forzado.segmento === '5 boletos',
  'con un solo sector posible sale ese, pese al valor que mande la pantalla',
  `salio: ${forzado.segmento}`);
check(forzado.resultado === 'WIN', 'y cuenta como ganada');

const boletos = Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifa} AND sale_id = ${forzado.saleId}`));
check(boletos === 5, 'entrego los 5 boletos que dice el sector', `entrego ${boletos}`);
check(/boletos/i.test(String(forzado.premio || '')), 'y lo nombra', `premio: ${forzado.premio}`);

// ===================================================================
seccion('5. Un sector de recompensa entrega una recompensa real');

q(`UPDATE dbo.dynamic_segments SET active = 0 WHERE definition_id = ${ruleta};
   UPDATE dbo.dynamic_segments SET active = 1 WHERE id = ${ids['Bebida gratis']};`);

const conRecompensa = girar();
check(conRecompensa.segmento === 'Bebida gratis', 'sale el sector de recompensa');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances WHERE sale_id = ${conRecompensa.saleId}`)) === 1,
  'y deja UNA recompensa real');
check(!!conRecompensa.codigo, 'con su codigo', `codigo: ${conRecompensa.codigo}`);

// ===================================================================
seccion('6. Un sector sin premio no entrega nada, y no es un fallo');

q(`UPDATE dbo.dynamic_segments SET active = 0 WHERE definition_id = ${ruleta};
   UPDATE dbo.dynamic_segments SET active = 1 WHERE id = ${ids['Sigue intentando']};`);

const sinNada = girar();
check(sinNada.ok === true, 'la jugada es valida');
check(sinNada.segmento === 'Sigue intentando', 'sale el sector sin premio');
check(sinNada.resultado === 'LOSE', 'y cuenta como no premiada');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances WHERE sale_id = ${sinNada.saleId}`)) === 0,
  'sin recompensa');

// ===================================================================
seccion('7. Con pesos desiguales, la distribucion los sigue');

q(`UPDATE dbo.dynamic_segments SET active = 1 WHERE definition_id = ${ruleta};
   UPDATE dbo.dynamic_segments SET weight = 9 WHERE id = ${ids['Sigue intentando']};
   UPDATE dbo.dynamic_segments SET weight = 1 WHERE id = ${ids['Bebida gratis']};
   UPDATE dbo.dynamic_segments SET weight = 0 WHERE id = ${ids['5 boletos']};`);

const cuenta = {};
for (let i = 0; i < 60; i++) {
  const r = girar();
  cuenta[r.segmento] = (cuenta[r.segmento] || 0) + 1;
}
check(!cuenta['5 boletos'],
  'un sector de peso CERO no sale nunca',
  'se pinta, pero no participa');
check((cuenta['Sigue intentando'] || 0) > (cuenta['Bebida gratis'] || 0),
  'el sector de peso 9 sale mas que el de peso 1',
  JSON.stringify(cuenta));
check((cuenta['Sigue intentando'] || 0) + (cuenta['Bebida gratis'] || 0) === 60,
  'y las 60 tiradas salieron de los sectores activos');

// ===================================================================
seccion('8. Quitar un sector lo saca del sorteo, sin borrar lo entregado');

const antes = Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifa}`));
sector(`@id=${ids['5 boletos']}, @definition_id=${ruleta}, @label=N'5 boletos', @borrar=1`);
check(Number(scalar(`SELECT active FROM dbo.dynamic_segments WHERE id = ${ids['5 boletos']}`)) === 0,
  'el sector queda desactivado, no borrado');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifa}`)) === antes,
  'y los boletos que ya habia entregado siguen ahi',
  'un premio reclamado no puede desaparecer del historial');

// ===================================================================
seccion('9. Una ruleta sin sectores lo dice, no gira en vacio');

const otra = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'DYNAMIC', @name=N'Ruleta vacia',
    @type=N'WHEEL', @attempts_allowed=1, @reward_definition_id=${recompensa}, @active=1;`).id;
q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${camp}`);
const camp2 = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Gira vacia', @outcome=N'DYNAMIC',
    @dynamic_definition_id=${otra}, @quantity=1, @priority=11, @active=1;`).id;

const vacia = girar();
check(vacia.ok === false && vacia.motivo === 'SIN_SECTORES',
  'una ruleta sin sectores se rechaza con su motivo',
  `devolvio: ${vacia.motivo}`);
check(/sectores/i.test(String(vacia.mensaje || '')), 'y lo explica', vacia.mensaje);

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${camp2}`);
resumen();
