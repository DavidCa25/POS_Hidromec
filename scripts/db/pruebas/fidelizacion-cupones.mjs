/**
 * Cupones y ciclo de vida de rifas, contra SQL Server real.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/fidelizacion-cupones.mjs
 *
 * Lo que se demuestra:
 *   1. Un cupon se emite al cobrar, con codigo y vigencia.
 *   2. Validar no consume: mirar dos veces no gasta el papel.
 *   3. Vencido, agotado, anulado e inexistente dan motivos distintos.
 *   4. Canjear liga la redencion a la venta y consume un uso.
 *   5. Canjear dos veces el mismo cupon de un uso se rechaza.
 *   6. Reintentar el canje SOBRE LA MISMA VENTA no cobra un segundo uso.
 *   7. Un cupon de varios usos se agota exactamente a su numero.
 *   8. Una rifa activa admite boletos; cerrada NO.
 *   9. Cerrar congela el universo y no da ganador todavia.
 *  10. Se sortea desde CLOSED, sobre el universo congelado, aunque pase tiempo.
 *  11. Una rifa cerrada no se puede reabrir.
 */
import { q, rows, row, scalar, check, seccion, resumen, fails, fixtureCafe, DB } from './lib.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

console.log(`Base de pruebas: ${DB}  (servidor ${SERVIDOR})`);
const f = fixtureCafe();

function turno(register = 1) {
  q(`IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = ${register})
     BEGIN
       SET IDENTITY_INSERT dbo.registers ON;
       INSERT INTO dbo.registers (id, code, name, is_active) VALUES (${register}, N'C${register}', N'Caja ${register}', 1);
       SET IDENTITY_INSERT dbo.registers OFF;
     END`);
  if (!scalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = ${register} AND closed_at IS NULL ORDER BY id DESC`)) {
    row(`EXEC dbo.sp_open_shift @user_id=${f.userId}, @opening_cash=0, @register_id=${register};`);
  }
}
turno(1); turno(2);

q(`UPDATE dbo.products SET stock = 100000 WHERE id IN (${f.coca}, ${f.latte})`);
q(`IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
     INSERT INTO dbo.business_config (business_name, business_profile, invoicing_enabled, updated_at)
     VALUES (N'Negocio de prueba', N'RETAIL', 0, GETDATE());
   UPDATE dbo.business_config SET loyalty_enabled = 1;`);

const vender = ({ producto = f.coca, cantidad = 1, precio = 20, register = 1 } = {}) => row(`
  DECLARE @d dbo.SaleDetailType;
  INSERT INTO @d (product_id, quantity, unit_price) VALUES (${producto}, ${cantidad}, ${precio});
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d,
    @customer_id=NULL, @due_date=NULL, @register_id=${register};`).sale_id;

const evaluar = (saleId) => rows(`EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${saleId}, @machine_id=N'PRUEBA';`);
const validar = (code) => row(`EXEC dbo.sp_coupon_validate @code=N'${code}';`);
const canjear = (code, saleId, reg = 1) =>
  row(`EXEC dbo.sp_coupon_redeem @code=N'${code}', @sale_id=${saleId}, @register_id=${reg}, @machine_id=N'EQ${reg}', @amount_applied=20;`);

// ===================================================================
seccion('1. Un cupon se emite al cobrar');

const cupDefId = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'COUPON', @name=N'Refresco gratis la proxima',
    @kind=N'FREE_PRODUCT', @product_id=${f.coca}, @uses_allowed=1, @valid_days=30,
    @code_prefix=N'CUP', @active=1;`).id;
const campCup = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Cupon por compra', @outcome=N'COUPON',
    @coupon_definition_id=${cupDefId}, @quantity=1, @priority=10, @active=1;`).id;
check(cupDefId > 0 && campCup > 0, `definicion #${cupDefId} y campana #${campCup} listas`);

const venta1 = vender();
const premios = evaluar(venta1);
const codigo = premios.find(p => p.tipo === 'COUPON')?.codigo;
check(!!codigo, `la venta emitio un cupon con codigo`, `codigo: ${codigo}`);
check(String(codigo).startsWith('CUP-'), 'con el prefijo de su definicion');

const inst = row(`SELECT * FROM dbo.coupon_instances WHERE code = N'${codigo}'`);
check(inst.expires_at !== null, 'y con vigencia, porque la definicion dice 30 dias');
check(Number(inst.uses_count) === 0, 'nace sin usos gastados');

// ===================================================================
seccion('2 y 3. Validar mira, no consume; y explica por que no sirve');

const v1 = validar(codigo);
check(v1.ok === true && v1.motivo === 'OK', 'el cupon recien emitido es valido');
check(v1.aplicable === true, 'y es aplicable: es de producto gratis');
check(v1.product_id === f.coca, 'dice que producto regala');

validar(codigo); validar(codigo);
check(Number(scalar(`SELECT uses_count FROM dbo.coupon_instances WHERE code = N'${codigo}'`)) === 0,
  'validar tres veces NO gasto ningun uso',
  'mirar un papel no lo consume');

const vNo = validar('NOEXISTE-000');
check(vNo.ok === false && vNo.motivo === 'NO_EXISTE',
  'un codigo inventado devuelve NO_EXISTE, no una lista vacia',
  'la pantalla siempre recibe una respuesta que puede ensenar');
check(!!vNo.mensaje, 'y un mensaje legible para el cliente', vNo.mensaje);

// --- vencido
const venta2 = vender();
evaluar(venta2);
const codVencido = rows(`SELECT code FROM dbo.coupon_instances WHERE sale_id = ${venta2}`)[0].code;
q(`UPDATE dbo.coupon_instances SET expires_at = DATEADD(DAY, -1, SYSDATETIME()) WHERE code = N'${codVencido}'`);
const vVenc = validar(codVencido);
check(vVenc.ok === false && vVenc.motivo === 'EXPIRADO', 'un cupon pasado de fecha da EXPIRADO');

// --- anulado
const venta3 = vender();
evaluar(venta3);
const codAnulado = rows(`SELECT code FROM dbo.coupon_instances WHERE sale_id = ${venta3}`)[0].code;
q(`UPDATE dbo.coupon_instances SET status = 'VOID' WHERE code = N'${codAnulado}'`);
check(validar(codAnulado).motivo === 'ANULADO', 'uno anulado da ANULADO');

// ===================================================================
seccion('4, 5 y 6. Canjear: una vez, ligado a la venta, sin duplicar');

// La venta donde SE GASTA es otra distinta de la que lo emitio.
const ventaGasto = vender({ producto: f.coca, cantidad: 1, precio: 20 });
const r1 = canjear(codigo, ventaGasto);
check(r1.ok === true, 'el cupon se canjea', r1.mensaje);

const red = row(`SELECT * FROM dbo.loyalty_redemptions WHERE coupon_instance_id = ${inst.id}`);
check(!!red, 'y queda registrada la redencion');
check(red.sale_id === ventaGasto, 'ligada a la venta que lo uso, no a la que lo emitio',
  `sale_id ${red.sale_id} = ${ventaGasto}`);
check(red.kind === 'COUPON', 'marcada como redencion de cupon');
check(Number(red.amount_applied) === 20, 'con el importe que rebajo');

const tras = row(`SELECT uses_count, status FROM dbo.coupon_instances WHERE code = N'${codigo}'`);
check(Number(tras.uses_count) === 1, 'consumio exactamente un uso');
check(tras.status === 'REDEEMED', 'y al agotarse queda marcado como usado');

// --- segunda vez, OTRA venta: rechazado
const ventaOtra = vender();
const r2 = canjear(codigo, ventaOtra);
check(r2.ok === false && r2.motivo === 'AGOTADO',
  'canjearlo otra vez en OTRA venta se rechaza', r2.mensaje);
check(Number(scalar(`SELECT COUNT(*) FROM dbo.loyalty_redemptions WHERE coupon_instance_id = ${inst.id}`)) === 1,
  'y sigue habiendo UNA sola redencion');

// --- reintento sobre LA MISMA venta: idempotente
const r3 = canjear(codigo, ventaGasto);
check(r3.ok === true && r3.motivo === 'YA_REGISTRADO',
  'reintentar sobre la MISMA venta no vuelve a cobrar uso',
  'un reintento del IPC no puede gastar el papel dos veces');
check(Number(scalar(`SELECT uses_count FROM dbo.coupon_instances WHERE code = N'${codigo}'`)) === 1,
  'el contador de usos sigue en 1');

// --- vencido no se canjea
const rVenc = canjear(codVencido, vender());
check(rVenc.ok === false && rVenc.motivo === 'EXPIRADO', 'un cupon vencido no se puede canjear');

// ===================================================================
seccion('7. Un cupon de varios usos se agota en su numero exacto');

const multiDef = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'COUPON', @name=N'Tres cafes',
    @kind=N'FREE_PRODUCT', @product_id=${f.coca}, @uses_allowed=3, @valid_days=30,
    @code_prefix=N'TRI', @active=1;`).id;
q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campCup}`);
const campMulti = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Cupon triple', @outcome=N'COUPON',
    @coupon_definition_id=${multiDef}, @quantity=1, @priority=11, @active=1;`).id;

const ventaMulti = vender();
evaluar(ventaMulti);
const codMulti = rows(`SELECT code FROM dbo.coupon_instances WHERE sale_id = ${ventaMulti}`)[0].code;

const resultados = [];
for (let i = 0; i < 4; i++) resultados.push(canjear(codMulti, vender()).ok);
check(resultados.filter(Boolean).length === 3,
  'de cuatro intentos, exactamente tres se canjean',
  `resultados: ${resultados.join(', ')}`);
check(scalar(`SELECT status FROM dbo.coupon_instances WHERE code = N'${codMulti}'`) === 'REDEEMED',
  'y al tercer uso queda agotado');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.loyalty_redemptions WHERE coupon_instance_id =
        (SELECT id FROM dbo.coupon_instances WHERE code = N'${codMulti}')`)) === 3,
  'con tres redenciones registradas, una por venta');
q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campMulti}`);

// ===================================================================
seccion('8 y 9. La rifa se cierra antes de sortear');

const rifaId = row(`
  EXEC dbo.sp_raffle_save @name=N'Rifa ciclo', @prize=N'Una bici',
    @winners_count=1, @code_prefix=N'CIC';`).id;
check(scalar(`SELECT status FROM dbo.raffle_definitions WHERE id = ${rifaId}`) === 'DRAFT',
  'una rifa nace en BORRADOR',
  'configurarla y activarla son decisiones distintas');

const campRifa = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Boleto por venta', @outcome=N'RAFFLE_ENTRY',
    @raffle_id=${rifaId}, @quantity=1, @priority=12, @active=1;`).id;

// En borrador no reparte
evaluar(vender());
check(Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`)) === 0,
  'en borrador NO reparte boletos');

// Activar
row(`EXEC dbo.sp_raffle_save @id=${rifaId}, @name=N'Rifa ciclo', @prize=N'Una bici',
      @winners_count=1, @code_prefix=N'CIC', @status=N'OPEN';`);
check(scalar(`SELECT status FROM dbo.raffle_definitions WHERE id = ${rifaId}`) === 'OPEN',
  'se activa y pasa a admitir boletos');

for (let i = 0; i < 5; i++) evaluar(vender());
const antesCierre = Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`));
check(antesCierre === 5, `activa reparte boletos (${antesCierre})`);

// No se puede sortear sin cerrar
const sinCerrar = fails(`EXEC dbo.sp_raffle_draw @raffle_id=${rifaId}, @user_id=${f.userId};`, null);
check(sinCerrar.ok, 'sortear una rifa ABIERTA se rechaza',
  sinCerrar.ok ? `motivo: ${sinCerrar.error}` : 'mientras siga abierta pueden entrar mas boletos');

// Cerrar
const cerrada = row(`EXEC dbo.sp_raffle_close @raffle_id=${rifaId}, @user_id=${f.userId};`);
check(cerrada.status === 'CLOSED', 'se cierra');
check(Number(cerrada.closed_entries_count) === 5,
  'congelando cuantos boletos participaban', `${cerrada.closed_entries_count} boletos`);
check(cerrada.closed_at !== null, 'y cuando se cerro');
check(Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_winners w
        JOIN dbo.raffle_draws d ON d.id = w.draw_id WHERE d.raffle_id = ${rifaId}`)) === 0,
  'CERRADA todavia NO tiene ganador',
  'cerrar y sortear son dos actos distintos');

// Cerrada no admite mas
evaluar(vender());
check(Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`)) === 5,
  'y cerrada ya NO admite boletos nuevos');

// Cerrar dos veces no recuenta
const recierre = row(`EXEC dbo.sp_raffle_close @raffle_id=${rifaId}, @user_id=${f.userId};`);
check(Number(recierre.closed_entries_count) === 5,
  'cerrar de nuevo devuelve la MISMA foto, no una nueva');

// ===================================================================
seccion('10 y 11. El sorteo usa el universo congelado, y no hay reapertura');

// Se cuela un boleto por un camino que no deberia existir, DESPUES del cierre.
q(`INSERT INTO dbo.raffle_entries (raffle_id, entry_number, register_id, machine_id, status, created_at)
   SELECT ${rifaId}, MAX(entry_number) + 1, 1, N'PRUEBA', 'VALID', SYSDATETIME()
   FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`);
check(Number(scalar(`SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`)) === 6,
  'hay 6 boletos en la tabla, uno posterior al cierre');

const ganadores = rows(`
  EXEC dbo.sp_raffle_draw @raffle_id=${rifaId}, @user_id=${f.userId}, @register_id=1,
    @machine_id=N'PRUEBA', @winners=1;`);
const sorteo = row(`SELECT TOP 1 * FROM dbo.raffle_draws WHERE raffle_id = ${rifaId} ORDER BY id DESC`);
check(Number(sorteo.entries_count) === 5,
  'el sorteo declara los 5 congelados, NO los 6 que hay ahora',
  `entries_count = ${sorteo.entries_count}`);
check(Number(sorteo.max_entry_id) === Number(cerrada.closed_max_entry_id),
  'y usa el ultimo boleto admitido al cerrar');
check(ganadores.length === 1 && !!ganadores[0].boleto, 'hay un ganador persistido',
  `boleto ${ganadores[0]?.boleto}`);
check(Number(ganadores[0].entry_number) <= 5,
  'y el ganador sale del universo congelado, no del boleto colado');

check(scalar(`SELECT status FROM dbo.raffle_definitions WHERE id = ${rifaId}`) === 'DRAWN',
  'la rifa queda SORTEADA');

const reabrir = fails(`EXEC dbo.sp_raffle_save @id=${rifaId}, @name=N'Rifa ciclo', @status=N'OPEN';`, null);
check(reabrir.ok, 'una rifa sorteada no se puede reabrir');

// Y una CERRADA tampoco
const rifa2 = row(`EXEC dbo.sp_raffle_save @name=N'Rifa dos', @prize=N'Algo', @code_prefix=N'DOS';`).id;
row(`EXEC dbo.sp_raffle_save @id=${rifa2}, @name=N'Rifa dos', @status=N'OPEN';`);
row(`EXEC dbo.sp_raffle_close @raffle_id=${rifa2};`);
const reabrir2 = fails(`EXEC dbo.sp_raffle_save @id=${rifa2}, @name=N'Rifa dos', @status=N'OPEN';`, null);
check(reabrir2.ok, 'y una cerrada tampoco',
  reabrir2.ok ? `motivo: ${reabrir2.error}` : 'reabrir cambiaria el universo que ya se anuncio');

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campRifa}`);

resumen();
