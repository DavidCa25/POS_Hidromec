/**
 * Vigencia de campanas: bordes de fecha, dia de semana y horario.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/fidelizacion-horarios.mjs
 *
 * Esta prueba existe por un fallo concreto y medido: la vigencia se comparaba
 * contra SYSUTCDATETIME mientras el dia y la hora salian de `sales.datee`, que
 * se sella con GETDATE(). Con el servidor a UTC-6, una campana con fecha de
 * fin dejaba de aplicar a las 18:00 hora local del dia anterior al elegido.
 *
 * Nadie lo habria visto leyendo el codigo: las dos lineas estan a veinte
 * lineas de distancia y las dos parecen razonables por separado.
 *
 * COMO SE CONTROLA EL TIEMPO
 * --------------------------
 * La venta se cobra normal y DESPUES se le fija `datee` al instante que se
 * quiere probar. Es lo unico que se toca: la campana, el procedure y el reloj
 * del servidor siguen siendo los de verdad.
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

const desfase = Number(scalar(`SELECT DATEDIFF(HOUR, SYSDATETIME(), SYSUTCDATETIME())`));
console.log(`   El servidor va ${desfase} h por detras de UTC.`);
check(true, `desfase local/UTC detectado: ${desfase} h`,
  desfase === 0 ? 'servidor en UTC: los bordes se prueban igual' : 'es el desfase que provocaba el fallo');

const recompensa = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'REWARD', @name=N'Premio horario',
    @kind=N'AMOUNT', @amount=10, @uses_allowed=1, @active=1;`).id;

/** Apaga todas las campanas: cada escenario prueba UNA sola. */
const soloUna = () => q(`UPDATE dbo.campaigns SET active = 0`);

/** Crea una campana activa con las condiciones dadas. */
function campana(nombre, cond = {}) {
  soloUna();
  const p = [
    `@name=N'${nombre}'`, `@outcome=N'REWARD'`,
    `@reward_definition_id=${recompensa}`, `@quantity=1`, `@active=1`,
  ];
  if (cond.startsAt) p.push(`@starts_at='${cond.startsAt}'`);
  if (cond.endsAt) p.push(`@ends_at='${cond.endsAt}'`);
  if (cond.weekdayMask != null) p.push(`@weekday_mask=${cond.weekdayMask}`);
  if (cond.timeFrom) p.push(`@time_from='${cond.timeFrom}'`);
  if (cond.timeTo) p.push(`@time_to='${cond.timeTo}'`);
  return row(`EXEC dbo.sp_loyalty_save_campaign ${p.join(', ')};`).id;
}

/**
 * Cobra una venta, le fija el instante local pedido, y pregunta que gano.
 * Devuelve cuantas recompensas se otorgaron.
 */
function ventaEn(instanteLocal) {
  const saleId = row(`
    DECLARE @d dbo.SaleDetailType;
    INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 100);
    EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO',
      @SaleDetails=@d, @customer_id=NULL, @due_date=NULL, @register_id=1;`).sale_id;
  q(`UPDATE dbo.sales SET datee = '${instanteLocal}' WHERE id = ${saleId}`);
  rows(`EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${saleId}, @machine_id=N'PRUEBA';`);
  return Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances WHERE sale_id = ${saleId}`));
}

/** Fechas locales de hoy y alrededores, tal y como las escribe el negocio. */
const hoy = String(scalar(`SELECT CONVERT(NVARCHAR(10), CAST(SYSDATETIME() AS DATE), 23)`));
const ayer = String(scalar(`SELECT CONVERT(NVARCHAR(10), DATEADD(DAY, -1, CAST(SYSDATETIME() AS DATE)), 23)`));
const manana = String(scalar(`SELECT CONVERT(NVARCHAR(10), DATEADD(DAY, 1, CAST(SYSDATETIME() AS DATE)), 23)`));

// ===================================================================
seccion('1. El dia completo: de 00:00:00 a 23:59:59 en hora del negocio');

campana('Solo hoy', { startsAt: `${hoy} 00:00:00`, endsAt: `${hoy} 23:59:59` });

check(ventaEn(`${hoy} 00:00:00`) === 1,
  'una venta al PRIMER segundo del dia entra',
  'el borde inferior pertenece al dia elegido');

check(ventaEn(`${hoy} 12:00:00`) === 1, 'una a mediodia entra');

/*
 * Este es EL caso que fallaba. Con la vigencia en UTC y la venta en local,
 * las 23:00 de aqui son las 05:00 de manana alli: la campana ya habia
 * "terminado" seis horas antes de que acabara el dia del negocio.
 */
check(ventaEn(`${hoy} 23:00:00`) === 1,
  'una a las 23:00 TAMBIEN entra',
  desfase === 0 ? 'borde superior del dia' : `este es el caso que fallaba con ${desfase} h de desfase`);

check(ventaEn(`${hoy} 23:59:59`) === 1, 'y al ULTIMO segundo del dia, tambien');

// ===================================================================
seccion('2. Fuera del rango no entra');

check(ventaEn(`${ayer} 23:59:59`) === 0,
  'un segundo antes de empezar, no',
  'el borde inferior excluye lo anterior');
check(ventaEn(`${manana} 00:00:00`) === 0,
  'un segundo despues de terminar, tampoco');

// ===================================================================
seccion('3. Campana que termina HOY');

campana('Termina hoy', { endsAt: `${hoy} 23:59:59` });
check(ventaEn(`${hoy} 22:30:00`) === 1,
  'sigue aplicando a las 22:30 del ultimo dia',
  'es lo que el negocio entiende por "hasta hoy"');

campana('Termino ayer', { endsAt: `${ayer} 23:59:59` });
check(ventaEn(`${hoy} 00:00:01`) === 0, 'y una que termino ayer ya no aplica hoy');

// ===================================================================
seccion('4. Dia de la semana, con LUNES = bit 0');

/* Se busca el lunes de esta semana para no depender de que dia se ejecute. */
const lunes = String(scalar(`
  SELECT CONVERT(NVARCHAR(10), DATEADD(DAY, -((DATEPART(WEEKDAY, SYSDATETIME()) + @@DATEFIRST - 2) % 7),
                 CAST(SYSDATETIME() AS DATE)), 23)`));
const martes = String(scalar(`
  SELECT CONVERT(NVARCHAR(10), DATEADD(DAY, 1 - ((DATEPART(WEEKDAY, SYSDATETIME()) + @@DATEFIRST - 2) % 7),
                 CAST(SYSDATETIME() AS DATE)), 23)`));

campana('Solo lunes', { weekdayMask: 1 });      // bit 0
check(ventaEn(`${lunes} 12:00:00`) === 1, 'una campana de solo LUNES aplica en lunes');
check(ventaEn(`${martes} 12:00:00`) === 0, 'y no aplica en martes');

campana('Solo martes', { weekdayMask: 2 });     // bit 1
check(ventaEn(`${martes} 12:00:00`) === 1, 'una de solo MARTES aplica en martes');
check(ventaEn(`${lunes} 12:00:00`) === 0, 'y no en lunes');

/*
 * El borde del dia con la mascara es donde se veia el fallo original: a las
 * 23:00 del lunes, en UTC ya es martes.
 */
check(ventaEn(`${lunes} 23:30:00`) === 0,
  'a las 23:30 del LUNES, una campana de martes sigue sin aplicar',
  'la mascara usa el dia del NEGOCIO, no el de Greenwich');
campana('Solo lunes otra vez', { weekdayMask: 1 });
check(ventaEn(`${lunes} 23:30:00`) === 1,
  'y la de lunes SI aplica a las 23:30 del lunes');

// ===================================================================
seccion('5. Horario dentro del dia');

campana('De 2 a 4', { timeFrom: '14:00:00', timeTo: '16:00:00' });
check(ventaEn(`${hoy} 14:00:00`) === 1, 'a las 14:00 en punto entra');
check(ventaEn(`${hoy} 15:00:00`) === 1, 'a las 15:00 entra');
check(ventaEn(`${hoy} 16:00:00`) === 1, 'a las 16:00 en punto entra');
check(ventaEn(`${hoy} 13:59:59`) === 0, 'un segundo antes, no');
check(ventaEn(`${hoy} 16:00:01`) === 0, 'un segundo despues, tampoco');

// ===================================================================
seccion('6. Todas las condiciones a la vez');

campana('Martes de 2 a 4 esta semana', {
  startsAt: `${lunes} 00:00:00`, endsAt: `${martes} 23:59:59`,
  weekdayMask: 2, timeFrom: '14:00:00', timeTo: '16:00:00',
});
check(ventaEn(`${martes} 15:00:00`) === 1, 'martes a las 15:00: entra');
check(ventaEn(`${martes} 17:00:00`) === 0, 'martes a las 17:00: fuera de horario');
check(ventaEn(`${lunes} 15:00:00`) === 0, 'lunes a las 15:00: dia equivocado');

soloUna();
resumen();
