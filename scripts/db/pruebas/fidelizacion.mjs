/**
 * Fidelizacion contra SQL Server real: campanas, recompensas, cupones,
 * dinamicas y rifas.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/fidelizacion.mjs
 *
 * No se comprueba que los procedures "existan": se cobran ventas de verdad y
 * se mira que reparten, que NO reparten, y que no se puede cobrar dos veces
 * el mismo premio.
 *
 * Lo que se demuestra:
 *   1. La capacidad apagada no otorga nada. Encenderla no reescribe el pasado.
 *   2. Una campana entrega su recompensa, con codigo, a la venta que cumple.
 *   3. Volver a evaluar la misma venta NO duplica premios (idempotencia).
 *   4. Las condiciones excluyen de verdad: minimo, producto y dia de semana.
 *   5. `per_amount` reparte por escalones, no una vez.
 *   6. Una dinamica se juega UNA vez: el segundo envio no premia otra vez.
 *   7. El acierto y el fallo los decide SQL segun objetivo y margen.
 *   8. El sorteo congela los boletos, deja semilla, y no se puede repetir.
 *   9. Un boleto que entra DESPUES del sorteo no participa en el ya hecho.
 */
import { q, rows, row, scalar, check, seccion, resumen, fails, fixtureCafe, DB } from './lib.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

console.log(`Base de pruebas: ${DB}  (servidor ${SERVIDOR})`);
const f = fixtureCafe();

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

/** Venta de contado. Devuelve el sale_id. */
function vender({ producto = f.coca, cantidad = 1, precio = 20, customer = null } = {}) {
  const r = row(`
    DECLARE @d dbo.SaleDetailType;
    INSERT INTO @d (product_id, quantity, unit_price) VALUES (${producto}, ${cantidad}, ${precio});
    EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d,
      @customer_id=${customer ?? 'NULL'}, @due_date=NULL, @register_id=1;`);
  return r.sale_id;
}

/** Evalua una venta y devuelve la lista de premios tal cual la ve la app. */
function evaluar(saleId) {
  return rows(`EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${saleId}, @machine_id=N'PRUEBA';`);
}

const cuenta = (tabla, saleId) => Number(scalar(`SELECT COUNT(*) FROM dbo.${tabla} WHERE sale_id = ${saleId}`));

// Existencias de sobra: aqui se mide fidelizacion, no inventario.
q(`UPDATE dbo.products SET stock = 100000 WHERE id = ${f.coca}`);

/**
 * Enciende o apaga Fidelizacion, y comprueba que quedo asi.
 *
 * La base de migraciones nace SIN fila en business_config, asi que un
 * `UPDATE` suelto no afecta a nada y la prueba entera pasaria en vacio:
 * "apagada no reparte" se cumpliria porque el procedure sale antes por otro
 * motivo. Se crea la fila y se verifica el valor.
 */
function fidelizacion(encendida) {
  q(`IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
       INSERT INTO dbo.business_config (business_name, business_profile, invoicing_enabled, updated_at)
       VALUES (N'Negocio de prueba', N'RETAIL', 0, GETDATE());
     UPDATE dbo.business_config SET loyalty_enabled = ${encendida ? 1 : 0};`);
  const real = Number(scalar(`SELECT TOP 1 CAST(loyalty_enabled AS INT) FROM dbo.business_config`));
  if (real !== (encendida ? 1 : 0)) {
    throw new Error(`no se pudo dejar loyalty_enabled en ${encendida ? 1 : 0} (quedo ${real})`);
  }
}

// ===================================================================
seccion('1. La capacidad apagada no reparte nada');

fidelizacion(false);
check(Number(scalar(`SELECT COUNT(*) FROM dbo.business_config`)) === 1,
  'hay configuracion de negocio y Fidelizacion esta apagada',
  'sin esta fila la prueba pasaria en vacio');

const recompensaId = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'REWARD', @name=N'Refresco gratis',
    @kind=N'FREE_PRODUCT', @product_id=${f.coca}, @uses_allowed=1, @valid_days=30, @active=1;`).id;
check(recompensaId > 0, `recompensa creada (#${recompensaId})`);

const campanaId = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Compra grande', @outcome=N'REWARD',
    @reward_definition_id=${recompensaId}, @quantity=1, @min_total=100, @priority=10, @active=1;`).id;
check(campanaId > 0, `campana creada (#${campanaId})`);

const ventaApagada = vender({ cantidad: 10, precio: 20 });   // $200: cumple el minimo
const nadaApagada = evaluar(ventaApagada);
check(cuenta('reward_instances', ventaApagada) === 0,
  'con Fidelizacion apagada, una venta que cumple no gana nada');
check(nadaApagada.length === 0,
  'y devuelve CERO filas, con la misma forma que el resultado normal',
  'quien llama recorre una lista y no distingue "no gano" de "esta apagado"');

// Encenderla no debe repartir hacia atras: el premio se gana en el momento.
fidelizacion(true);
check(cuenta('reward_instances', ventaApagada) === 0,
  'encenderla no reescribe el pasado', 'la venta anterior sigue sin premio');

// ===================================================================
seccion('2. Una venta que cumple gana su recompensa');

const venta1 = vender({ cantidad: 10, precio: 20 });         // $200
const premios1 = evaluar(venta1);
check(premios1.length === 1, `la venta de $200 gano 1 premio`, `devolvio ${premios1.length}`);
check(premios1[0]?.tipo === 'REWARD', `y es una recompensa`, `tipo ${premios1[0]?.tipo}`);
check(!!premios1[0]?.codigo, 'con codigo para dictarlo o leerlo del ticket',
  `codigo: ${premios1[0]?.codigo}`);

const inst = row(`SELECT TOP 1 * FROM dbo.reward_instances WHERE sale_id = ${venta1}`);
check(inst.definition_id === recompensaId, 'apunta a la definicion correcta');
check(inst.campaign_id === campanaId, 'y deja constancia de que campana la dio');
check(inst.machine_id === 'PRUEBA', 'y de que equipo cobro');
check(inst.expires_at !== null, 'con caducidad, porque la definicion dice 30 dias');

// ===================================================================
seccion('3. Evaluar dos veces NO duplica premios');

// Es el caso real: el IPC reintenta, o dos pantallas piden lo mismo.
const segunda = evaluar(venta1);
check(cuenta('reward_instances', venta1) === 1,
  'la misma venta evaluada de nuevo sigue con UNA recompensa',
  `hay ${cuenta('reward_instances', venta1)}`);
// Antes esta comprobacion pasaba por el motivo equivocado: el procedure
// devolvia `SELECT 0 AS otorgados`, que tambien es UNA fila. La pantalla
// habria pintado un premio fantasma sin tipo ni nombre. Ahora se exige que
// sea el premio de verdad.
check(segunda.length === 1 && segunda[0].tipo === 'REWARD' && segunda[0].codigo === premios1[0].codigo,
  'y devuelve EL MISMO premio, no un conteo',
  `tipo ${segunda[0]?.tipo}, codigo ${segunda[0]?.codigo}`);

const tercera = evaluar(venta1);
check(cuenta('reward_instances', venta1) === 1, 'ni una tercera llamada anade nada');

// ===================================================================
seccion('4. Las condiciones excluyen de verdad');

const ventaChica = vender({ cantidad: 2, precio: 20 });      // $40: NO llega a 100
evaluar(ventaChica);
check(cuenta('reward_instances', ventaChica) === 0,
  'una venta por debajo del minimo no gana nada');

// --- producto concreto
const campProd = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Solo con Latte', @outcome=N'REWARD',
    @reward_definition_id=${recompensaId}, @product_id=${f.latte}, @quantity=1, @priority=20, @active=1;`).id;
q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campanaId}`);

const ventaSinLatte = vender({ cantidad: 10, precio: 20 });  // Coca, no Latte
evaluar(ventaSinLatte);
check(cuenta('reward_instances', ventaSinLatte) === 0,
  'una campana atada a un producto no aplica si la venta no lo lleva');

// --- dia de la semana: LUNES = bit 0, como lo pinta la pantalla
q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campProd}`);
const hoyBit = Number(scalar(
  `SELECT POWER(2, (DATEPART(WEEKDAY, GETDATE()) + @@DATEFIRST - 2) % 7)`));
const campHoy = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Solo hoy', @outcome=N'REWARD',
    @reward_definition_id=${recompensaId}, @quantity=1, @weekday_mask=${hoyBit}, @priority=30, @active=1;`).id;
const ventaHoy = vender({ cantidad: 1, precio: 20 });
evaluar(ventaHoy);
check(cuenta('reward_instances', ventaHoy) === 1,
  'una campana del dia de hoy SI aplica hoy',
  'la mascara la calcula la pantalla con lunes = bit 0');

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campHoy}`);
const otroBit = (hoyBit * 2) > 64 ? 1 : hoyBit * 2;          // manana (o lunes)
const campOtroDia = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Otro dia', @outcome=N'REWARD',
    @reward_definition_id=${recompensaId}, @quantity=1, @weekday_mask=${otroBit}, @priority=31, @active=1;`).id;
const ventaOtroDia = vender({ cantidad: 1, precio: 20 });
evaluar(ventaOtroDia);
check(cuenta('reward_instances', ventaOtroDia) === 0,
  'y una de OTRO dia no aplica hoy',
  'sin esto, "solo los martes" se entregaria toda la semana');
q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campOtroDia}`);

// ===================================================================
seccion('5. per_amount reparte por escalones');

const rifaId = row(`
  EXEC dbo.sp_raffle_save @name=N'Rifa de prueba', @prize=N'Una pantalla',
    @winners_count=1, @code_prefix=N'RIF', @status=N'OPEN';`).id;
check(rifaId > 0, `rifa creada (#${rifaId})`);

const campBoletos = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Un boleto por cada 200', @outcome=N'RAFFLE_ENTRY',
    @raffle_id=${rifaId}, @quantity=1, @per_amount=200, @priority=40, @active=1;`).id;

const ventaEscalon = vender({ cantidad: 33, precio: 20 });   // $660 -> 3 boletos
evaluar(ventaEscalon);
check(cuenta('raffle_entries', ventaEscalon) === 3,
  'con $660 y un boleto por cada $200 salen 3 boletos',
  `salieron ${cuenta('raffle_entries', ventaEscalon)}`);

const ventaCorta = vender({ cantidad: 5, precio: 20 });      // $100: no llega al escalon
evaluar(ventaCorta);
check(cuenta('raffle_entries', ventaCorta) === 0,
  'y con $100 no sale ninguno, en vez de salir uno de regalo');

const numeros = rows(`SELECT entry_number FROM dbo.raffle_entries WHERE raffle_id = ${rifaId} ORDER BY entry_number`);
check(new Set(numeros.map(n => n.entry_number)).size === numeros.length,
  'los numeros de boleto no se repiten');

// ===================================================================
seccion('6 y 7. La dinamica la decide SQL, y solo una vez');

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campBoletos}`);

const dinamicaId = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'DYNAMIC', @name=N'Para en 10',
    @type=N'TIMING', @target_value=10, @tolerance=0.20, @attempts_allowed=1,
    @reward_definition_id=${recompensaId}, @active=1;`).id;
const campDin = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Juega al pagar', @outcome=N'DYNAMIC',
    @dynamic_definition_id=${dinamicaId}, @quantity=1, @priority=50, @active=1;`).id;

// --- un acierto
const ventaJuego = vender({ cantidad: 1, precio: 20 });
const premiosJuego = evaluar(ventaJuego);
check(premiosJuego.some(p => p.tipo === 'DYNAMIC' && p.token),
  'la venta deja una dinamica PENDIENTE, con su token');

const pend = row(`EXEC dbo.sp_dynamic_pending @sale_id=${ventaJuego};`);
check(pend && pend.token, 'sp_dynamic_pending la encuentra');
check(Number(pend.target_value) === 10 && Number(pend.tolerance) === 0.2,
  'y trae el objetivo y el margen, para poder anunciarlos antes de jugar');

const gana = row(`EXEC dbo.sp_dynamic_play @token=N'${pend.token}', @input_value=10.05, @machine_id=N'PRUEBA';`);
check(gana.resultado === 'WIN', 'parar en 10.05 con margen 0.20 es ganar',
  `devolvio ${gana.resultado}`);
check(!!gana.premio, 'y dice que premio se llevo', `premio: ${gana.premio}`);
check(Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances WHERE definition_id = ${recompensaId} AND id = (
        SELECT reward_instance_id FROM dbo.dynamic_attempts WHERE token = N'${pend.token}')`)) === 1,
  'la recompensa ganada existe de verdad y queda ligada al intento');

// --- el mismo token, otra vez: el doble clic
const repetido = row(`EXEC dbo.sp_dynamic_play @token=N'${pend.token}', @input_value=10.00, @machine_id=N'PRUEBA';`);
check(repetido.ok === false || repetido.resultado === null,
  'jugar el MISMO token otra vez se rechaza',
  'un doble clic no puede premiar dos veces');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances
        WHERE id IN (SELECT reward_instance_id FROM dbo.dynamic_attempts WHERE token = N'${pend.token}')`)) === 1,
  'y sigue habiendo UNA sola recompensa por ese intento');

// --- un fallo
const ventaFallo = vender({ cantidad: 1, precio: 20 });
evaluar(ventaFallo);
const pend2 = row(`EXEC dbo.sp_dynamic_pending @sale_id=${ventaFallo};`);
const pierde = row(`EXEC dbo.sp_dynamic_play @token=N'${pend2.token}', @input_value=12.50, @machine_id=N'PRUEBA';`);
check(pierde.resultado === 'LOSE', 'parar en 12.50 con objetivo 10 y margen 0.20 es perder',
  `devolvio ${pierde.resultado}`);
check(!pierde.premio, 'y no entrega ningun premio');

const tokenInventado = 'NOEXISTE00000000000000000000';
const falso = row(`EXEC dbo.sp_dynamic_play @token=N'${tokenInventado}', @input_value=10, @machine_id=N'PRUEBA';`);
check(falso.ok === false, 'un token inventado no gana nada',
  'el resultado no lo decide quien llama');

// ===================================================================
seccion('8 y 9. El sorteo se congela, se firma y no se repite');

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campDin}`);

const boletosAntes = Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifaId} AND status = 'VALID'`));
check(boletosAntes >= 3, `la rifa llega al sorteo con ${boletosAntes} boletos`);

const ganadores = rows(`
  EXEC dbo.sp_raffle_draw @raffle_id=${rifaId}, @user_id=${f.userId}, @register_id=1,
    @machine_id=N'PRUEBA', @winners=1, @alternates=1;`);
check(ganadores.length >= 1, `el sorteo devolvio ${ganadores.length} fila(s)`);
check(!!ganadores[0]?.boleto, 'con el numero de boleto legible', `boleto: ${ganadores[0]?.boleto}`);

const sorteo = row(`SELECT TOP 1 * FROM dbo.raffle_draws WHERE raffle_id = ${rifaId} ORDER BY id DESC`);
check(sorteo.entries_count === boletosAntes,
  'y dejo escrito cuantos boletos participaban',
  `${sorteo.entries_count} = ${boletosAntes}`);
check(!!sorteo.seed && !!sorteo.algorithm && sorteo.algorithm_version !== null,
  'con algoritmo, version y semilla: el sorteo se puede comprobar meses despues',
  `${sorteo.algorithm} v${sorteo.algorithm_version}`);
check(sorteo.max_entry_id !== null, 'y con el universo congelado (max_entry_id)');

check(scalar(`SELECT status FROM dbo.raffle_definitions WHERE id = ${rifaId}`) === 'DRAWN',
  'la rifa queda sorteada, no abierta');

const repetir = fails(`EXEC dbo.sp_raffle_draw @raffle_id=${rifaId}, @user_id=${f.userId}, @register_id=1;`, null);
check(repetir.ok, 'y volver a sortearla se rechaza',
  repetir.ok
    ? `motivo: ${repetir.error}`
    : 'un segundo sorteo daria dos listas de ganadores para el mismo premio');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_draws WHERE raffle_id = ${rifaId}`)) === 1,
  'sigue habiendo UN solo sorteo registrado');

// Un boleto que entrara despues NO puede colarse en el sorteo ya hecho.
q(`INSERT INTO dbo.raffle_entries (raffle_id, entry_number, customer_id, sale_id, register_id, machine_id, status, created_at)
   SELECT ${rifaId}, MAX(entry_number) + 1, NULL, NULL, 1, N'PRUEBA', 'VALID', SYSUTCDATETIME()
   FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`);
const tardio = Number(scalar(`SELECT MAX(id) FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`));
check(tardio > sorteo.max_entry_id,
  'un boleto emitido despues queda fuera del universo congelado',
  `id ${tardio} > max_entry_id ${sorteo.max_entry_id}`);
check(Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_winners WHERE draw_id = ${sorteo.id} AND entry_id = ${tardio}`)) === 0,
  'y desde luego no aparece entre los ganadores de ese sorteo');

// ===================================================================
seccion('10. Entregar y descartar a un ganador');

// 'WINNER' es el estado con el que nace un ganador; 'ALTERNATE', el suplente.
const g = row(`SELECT TOP 1 * FROM dbo.raffle_winners WHERE draw_id = ${sorteo.id} AND status = 'WINNER' ORDER BY position`);
if (g) {
  row(`EXEC dbo.sp_raffle_winner_status @winner_id=${g.id}, @status=N'DELIVERED', @user_id=${f.userId};`);
  check(scalar(`SELECT status FROM dbo.raffle_winners WHERE id = ${g.id}`) === 'DELIVERED',
    'un ganador se marca como entregado');
  check(scalar(`SELECT delivered_at FROM dbo.raffle_winners WHERE id = ${g.id}`) !== null,
    'y queda la hora de la entrega');
  // El suplente sigue siendo suplente: entregar al primero no lo asciende.
  check(scalar(`SELECT status FROM dbo.raffle_winners WHERE draw_id = ${sorteo.id} AND position = 2`) === 'ALTERNATE',
    'y el suplente sigue en reserva, no se convierte en ganador');
} else {
  check(false, 'habia un ganador por entregar que marcar');
}

resumen();
