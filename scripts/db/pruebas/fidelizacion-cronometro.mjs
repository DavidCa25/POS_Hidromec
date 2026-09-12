/**
 * El cronometro exacto: gana quien pare en la centesima que la pantalla dice.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/fidelizacion-cronometro.mjs
 *
 * La regla es "detenlo en 10.00", no "detenlo cerca de 10". Eso tiene una
 * trampa tecnica: comparar segundos en coma flotante habria hecho que la
 * pantalla mostrara 10.00 y el servidor juzgara 9.99, que es exactamente el
 * caso que un cliente reclamaria y nadie podria explicarle.
 *
 * La caja cuenta en CENTESIMAS ENTERAS -de ahi sale tanto lo que pinta como
 * lo que envia- y SQL multiplica por 100 en DECIMAL, que es aritmetica
 * exacta. Esta prueba comprueba las dos mitades de esa promesa.
 */
import { q, rows, row, scalar, check, seccion, resumen, fixtureCafe, DB } from './lib.mjs';
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

// ===================================================================
seccion('1. Se puede guardar una dinamica SIN margen');

/*
 * Este era el bloqueo: el procedure exigia tolerancia mayor que cero, asi que
 * la dinamica que se queria -"exactamente 10.00"- era justo la unica que no
 * se podia guardar.
 */
const recompensa = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'REWARD', @name=N'Premio cronometro',
    @kind=N'AMOUNT', @amount=25, @uses_allowed=1, @active=1;`).id;

const dinamica = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'DYNAMIC', @name=N'Detenlo en 10.00',
    @type=N'TIMING', @target_value=10, @attempts_allowed=1,
    @reward_definition_id=${recompensa}, @active=1;`).id;
check(dinamica > 0, `dinamica creada sin pasar tolerancia (#${dinamica})`,
  'antes esto fallaba con "necesita objetivo y tolerancia mayores que cero"');

const guardada = row(`SELECT target_value, tolerance FROM dbo.dynamic_definitions WHERE id = ${dinamica}`);
check(Number(guardada.target_value) === 10, 'con su segundo objetivo');
check(guardada.tolerance === null || Number(guardada.tolerance) === 0,
  'y sin margen guardado', `tolerance = ${guardada.tolerance}`);

const camp = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Juega al pagar', @outcome=N'DYNAMIC',
    @dynamic_definition_id=${dinamica}, @quantity=1, @priority=10, @active=1;`).id;

// ===================================================================
seccion('2. Gana SOLO la centesima exacta');

/** Cobra, evalua y juega el valor dado. Devuelve WIN / LOSE. */
function jugar(segundos) {
  const saleId = row(`
    DECLARE @d dbo.SaleDetailType;
    INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 20);
    EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO',
      @SaleDetails=@d, @customer_id=NULL, @due_date=NULL, @register_id=1;`).sale_id;
  rows(`EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${saleId}, @machine_id=N'PRUEBA';`);
  const p = row(`EXEC dbo.sp_dynamic_pending @sale_id=${saleId};`);
  if (!p || !p.token) return { resultado: 'SIN_INTENTO', saleId };
  const r = row(`EXEC dbo.sp_dynamic_play @token=N'${p.token}', @input_value=${segundos}, @machine_id=N'PRUEBA';`);
  return { resultado: r.resultado, premio: r.premio, saleId };
}

check(jugar(10.00).resultado === 'WIN', '10.00 gana');
check(jugar(9.99).resultado === 'LOSE', '9.99 pierde', 'una centesima antes ya no es exacto');
check(jugar(10.01).resultado === 'LOSE', '10.01 pierde');
check(jugar(9.00).resultado === 'LOSE', '9.00 pierde');
check(jugar(10.50).resultado === 'LOSE', '10.50 pierde');

// ===================================================================
seccion('3. El premio solo aparece cuando se gana');

const gana = jugar(10.00);
check(Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances WHERE sale_id = ${gana.saleId}`)) === 1,
  'ganar deja UNA recompensa real');
check(!!gana.premio, 'y la nombra', `premio: ${gana.premio}`);

const pierde = jugar(9.99);
check(Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances WHERE sale_id = ${pierde.saleId}`)) === 0,
  'perder no deja ninguna');

// ===================================================================
seccion('4. Los bordes tecnicos: lo juzgado es lo mostrado');

/*
 * La caja NUNCA manda un valor con mas de dos decimales: cuenta en centesimas
 * enteras y envia `centesimas / 100`. Aqui se comprueba que esa cuantizacion
 * -la misma que hace `toFixed(2)` sobre el mismo entero- lleva al veredicto
 * que el cliente espera al leer la pantalla.
 *
 * El caso 9.995 es el que rompia: en coma flotante 9.995 * 100 da
 * 999.4999999999999, asi que redondear en el renderer y redondear en SQL
 * podian discrepar. Contando en centesimas no hay nada que discrepar, porque
 * el valor que viaja YA es el que se pinto.
 */
const casosBorde = [
  { ms: 9995, esperado: 'WIN',  por: '9995 ms -> 1000 centesimas -> la pantalla dice 10.00' },
  { ms: 9994, esperado: 'LOSE', por: '9994 ms -> 999 centesimas -> la pantalla dice 9.99' },
  { ms: 10004, esperado: 'WIN', por: '10004 ms -> 1000 centesimas -> la pantalla dice 10.00' },
  { ms: 10005, esperado: 'LOSE', por: '10005 ms -> 1001 centesimas -> la pantalla dice 10.01' },
];

for (const c of casosBorde) {
  // Exactamente lo que hace la caja: Math.round(ms / 10), y se envia /100.
  const centesimas = Math.round(c.ms / 10);
  const mostrado = (centesimas / 100).toFixed(2);
  const enviado = centesimas / 100;
  const r = jugar(enviado);
  check(r.resultado === c.esperado,
    `${c.ms} ms -> la pantalla muestra ${mostrado} -> ${c.esperado}`,
    r.resultado === c.esperado ? c.por : `devolvio ${r.resultado}`);
}

// ===================================================================
seccion('5. No hay forma de ganar mandando "gane"');

/*
 * El renderer manda CUANDO paro, no SI gano. Un valor fuera de la centesima
 * exacta pierde por mucho que se insista, y un token inventado no juega.
 */
const falso = row(`EXEC dbo.sp_dynamic_play @token=N'NOEXISTE0000000000000000000000', @input_value=10, @machine_id=N'PRUEBA';`);
check(falso.ok === false, 'un token inventado no gana nada');

const dosVeces = jugar(10.00);
check(dosVeces.resultado === 'WIN', 'una jugada valida gana');
const repetida = row(`
  SELECT TOP 1 token FROM dbo.dynamic_attempts WHERE sale_id = ${dosVeces.saleId}`);
const otra = row(`EXEC dbo.sp_dynamic_play @token=N'${repetida.token}', @input_value=10, @machine_id=N'PRUEBA';`);
check(otra.ok === false || otra.resultado === null,
  'y repetir el mismo token no vuelve a premiar');

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${camp}`);
resumen();
