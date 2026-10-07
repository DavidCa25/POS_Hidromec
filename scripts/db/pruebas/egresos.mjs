/**
 * CONTROL DE CAJA Y EGRESOS (migracion 0049).
 *
 *     node scripts/db/pruebas/egresos.mjs [--conservar]
 *
 * QUE SE ESTABA ROMPIENDO
 * -----------------------
 *   · Un abono de cliente con TARJETA o TRANSFERENCIA entraba a la caja: el
 *     corte esperaba dinero que nunca estuvo en el cajon.
 *   · Devoluciones y ajustes de venta buscaban el turno de QUIEN LO ABRIO, no
 *     el de la caja, e insertaban sin caja (register_id = 1 por omision). En
 *     MultiCaja el dinero salia del corte de otra caja.
 *   · Pagar a un proveedor tenia tres caminos; uno era un INSERT desde
 *     JavaScript, fuera de toda transaccion.
 *   · No habia donde registrar renta, luz, un Uber o el pago al personal.
 *
 * QUE SE COMPRUEBA, contra SQL de verdad, sobre una restauracion del baseline
 * con TODAS las migraciones (incluida la 0049):
 *
 *    1  gasto en EFECTIVO   -> egreso + movimiento EXPENSE, baja el esperado,
 *                              en la caja correcta
 *    2  gasto por TRANSFERENCIA -> egreso sin movimiento; el corte no cambia
 *    3  pago al personal EFECTIVO en la Caja 2 -> persona + egreso + movimiento
 *    4  pago al personal TRANSFERENCIA -> historial, sin caja
 *    5  pago a proveedor: una sola logica; efectivo toca caja, transferencia no
 *    6  REFUND y SALE_ADJ respetan MultiCaja
 *    7  PAYMENT: solo el efectivo toca el cajon
 *    8  corte: esperado, contado, diferencia y un desglose que suma al neto
 *    9  conceptos propios (Uber, Didi) en egresos y en reportes
 *   10  compatibilidad: la migracion es idempotente y adopta valores viejos
 *   11  cancelar un egreso (y no reescribir un corte ya entregado)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const MIG = '0049_caja-y-egresos.sql';
const DB = 'Wybix_TmpEgresos';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle !== '' ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle !== '' ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const sets = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets;
};
const q = (sql) => { const s = sets(sql); return s.length ? s[0] : []; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const n = (v) => Number(v ?? 0);
/** { ok: true } si FALLA con un mensaje que contiene `frag`. */
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.toLowerCase().includes(frag.toLowerCase()) : true, error: msg };
};
const lotes = (archivo) => readFileSync(join(DIR_MIG, archivo), 'utf8')
  .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).filter(l => l.trim());

try {
  console.log(`\nCONTROL DE CAJA Y EGRESOS   (${DB})`);
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
    for (const lote of lotes(f)) q(lote);  // MISMA regla que electron/migrationsRunner.js
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // ------------------------------------------------------------- datos base
  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES
      (N'dueno',   N'x', N'admin',      1, GETDATE()),
      (N'cajera2', N'x', N'cajero',     1, GETDATE()),
      (N'mesero',  N'x', N'cajero',     1, GETDATE()),
      (N'sinturno',N'x', N'supervisor', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'General');
    IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = 2)
      INSERT INTO dbo.registers (code, name) VALUES (N'C2', N'Caja 2');
    INSERT INTO dbo.CAT_suppliers (nombre) VALUES (N'Proveedor QA');
    INSERT INTO dbo.customers (customerName, credit_limit, terms_days) VALUES (N'Cliente QA', 100000, 30);`);
  const U = Object.fromEntries(q(`SELECT usuario, id FROM dbo.users;`).map(r => [r.usuario, Number(r.id)]));
  const dueno = U.dueno, cajera2 = U.cajera2, mesero = U.mesero, sinTurno = U.sinturno;
  const brand = n(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const cat = n(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'General';`));
  const prov = n(escalar(`SELECT id FROM dbo.CAT_suppliers WHERE nombre = N'Proveedor QA';`));
  const cliente = n(escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Cliente QA';`));
  const caja2 = n(escalar(`SELECT id FROM dbo.registers WHERE code = N'C2';`));
  const prod = n(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-EGR', @name=N'Producto QA',
      @price=50, @stock=1000, @category=${cat}, @cost=20;`));
  const concepto = (nombre) => n(escalar(`SELECT id FROM dbo.expense_categories WHERE name = N'${nombre}';`));
  const PERSONAL = n(escalar(`SELECT id FROM dbo.expense_categories WHERE kind = 'PERSONAL';`));

  const abrir = (caja, fondo, user) => n(uno(`
    EXEC dbo.sp_open_shift @user_id=${user}, @opening_cash=${fondo}, @register_id=${caja};`)?.closure_id);
  /** Lo que el Corte muestra ANTES de cerrar: resumen y desglose. */
  const corte = (turno) => {
    const s = sets(`EXEC dbo.sp_get_cash_movements @closure_id=${turno};`);
    return { filas: s[0], resumen: s[1][0], desglose: s[2] };
  };
  const esperado = (turno) => n(corte(turno).resumen.cash_expected);
  const movs = (turno) => n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE closure_id = ${turno};`));
  const vender = (metodo, caja, user, extra = '') => {
    q(`
      DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
      INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${prod}, 1, 50);
      EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'${metodo}', @SaleDetails=@d1,
        @register_id=${caja}, @SaleDetails2=@d2, @SaleModifiers=@mo ${extra};`);
    return n(escalar(`SELECT MAX(id) FROM dbo.sales;`));
  };
  const egreso = (args) => uno(`EXEC dbo.sp_register_expense ${args};`);

  // ================================================================ 0
  seccion('0. La migracion 0049');
  check(n(escalar(`SELECT COUNT(*) FROM dbo.cash_movement_types WHERE code IN
      ('OPENING','SALE','SALE_ADJ','PAYMENT','DEPOSIT','REFUND','WITHDRAW','SUPPLIER_PAYMENT','EXPENSE');`)) === 9,
    'catalogo de tipos de movimiento con los 9 tipos');
  check(!!escalar(`SELECT OBJECT_ID(N'dbo.FK_cash_movements_type', 'F');`), 'cash_movements.typee tiene llave foranea al catalogo');
  check(n(escalar(`SELECT COUNT(*) FROM dbo.expense_categories;`)) === 10
      && n(escalar(`SELECT COUNT(*) FROM dbo.expense_categories WHERE kind = 'PERSONAL' AND is_system = 1;`)) === 1,
    'conceptos iniciales: 10, uno de ellos "Pago al personal" del sistema');
  const tipoMal = falla(`INSERT INTO dbo.cash_movements (userId, typee, amount) VALUES (${dueno}, 'RETIRO_TYPO', -1);`, 'FOREIGN KEY');
  check(tipoMal.ok, 'un tipo inventado ya no entra (la deuda no crece)', tipoMal.error?.slice(0, 60));

  // ================================================================ 1
  seccion('1. Gasto en EFECTIVO');
  const t1 = abrir(1, 1000, dueno);
  check(t1 > 0, `turno de la Caja 1 abierto con $1,000 (#${t1})`);
  const luz = egreso(`@user_id=${dueno}, @category_id=${concepto('Luz')}, @amount=150,
      @payment_method='EFECTIVO', @note=N'Recibo CFE', @register_id=1`);
  const eLuz = uno(`SELECT * FROM dbo.expenses WHERE id = ${n(luz?.expense_id)};`);
  const mLuz = uno(`SELECT * FROM dbo.cash_movements WHERE id = ${n(eLuz?.cash_movement_id)};`);
  check(!!eLuz, 'queda el egreso', `#${luz?.expense_id}`);
  check(!!mLuz && mLuz.typee === 'EXPENSE' && n(mLuz.amount) === -150, 'con su movimiento EXPENSE de -$150', mLuz ? `${mLuz.typee} ${mLuz.amount}` : 'sin movimiento');
  check(!!mLuz && n(mLuz.closure_id) === t1 && n(mLuz.register_id) === 1 && n(eLuz.register_id) === 1,
    'en el turno y la caja correctos (Caja 1)');
  check(n(mLuz?.reference_id) === n(luz?.expense_id), 'el movimiento apunta a su egreso');
  check(esperado(t1) === 850, 'el efectivo esperado baja a $850', String(esperado(t1)));

  const sinCaja = falla(`EXEC dbo.sp_register_expense @user_id=${sinTurno}, @category_id=${concepto('Gas')},
      @amount=10, @payment_method='EFECTIVO';`, 'caja');
  check(sinCaja.ok, 'MultiCaja: sin caja, sin equipo y sin turno propio, NO se adivina la caja', sinCaja.error?.slice(0, 80));
  const ayer = falla(`EXEC dbo.sp_register_expense @user_id=${dueno}, @category_id=${concepto('Gas')},
      @amount=10, @payment_method='EFECTIVO', @register_id=1, @expense_date='2020-01-01';`, 'hoy');
  check(ayer.ok, 'un egreso en efectivo no puede fecharse otro dia', ayer.error?.slice(0, 60));

  // ================================================================ 2
  seccion('2. Gasto por TRANSFERENCIA');
  const antes2 = movs(t1);
  const renta = egreso(`@user_id=${dueno}, @category_id=${concepto('Renta')}, @amount=8000,
      @payment_method='TRANSFERENCIA', @beneficiary=N'Arrendador'`);
  const eRenta = uno(`SELECT * FROM dbo.expenses WHERE id = ${n(renta?.expense_id)};`);
  check(!!eRenta && eRenta.cash_movement_id == null && eRenta.closure_id == null, 'queda el egreso, sin movimiento de caja');
  check(movs(t1) === antes2, 'no se agrego ningun movimiento al turno');
  check(esperado(t1) === 850, 'el corte no cambia ($850)', String(esperado(t1)));
  const directo = falla(`INSERT INTO dbo.expenses (expense_date, category_id, amount, payment_method, user_id)
      VALUES (GETDATE(), ${concepto('Luz')}, 5, 'EFECTIVO', ${dueno});`, 'CK_expenses_cash');
  check(directo.ok, 'la tabla rechaza un egreso en efectivo sin su salida del cajon', directo.error?.slice(0, 60));

  // ================================================================ 3
  seccion('3. Pago al personal en EFECTIVO, desde la Caja 2');
  const t2 = abrir(caja2, 500, cajera2);
  check(t2 > 0, `turno de la Caja 2 abierto con $500 (#${t2})`);
  const pago1 = egreso(`@user_id=${cajera2}, @category_id=${PERSONAL}, @amount=300,
      @payment_method='EFECTIVO', @staff_user_id=${mesero}, @period_kind='SEMANA', @register_id=${caja2}`);
  const eP1 = uno(`SELECT * FROM dbo.expenses WHERE id = ${n(pago1?.expense_id)};`);
  const mP1 = uno(`SELECT * FROM dbo.cash_movements WHERE id = ${n(eP1?.cash_movement_id)};`);
  check(!!eP1 && n(eP1.staff_user_id) === mesero, 'ligado a la persona (users)', eP1 ? `staff ${eP1.staff_user_id}` : '');
  check(!!mP1 && n(mP1.closure_id) === t2 && n(mP1.register_id) === caja2, 'su salida es de la Caja 2, no de la 1');
  // La consulta temporal devuelve fechas como texto 'AAAA-MM-DD' (o Date): se normaliza.
  // Puede llegar como Date, como 'AAAA-MM-DD' o en formato .NET '/Date(ms)/'.
  const dia = (v) => {
    const net = /\/Date\((-?\d+)/.exec(String(v ?? ''));
    const d = v instanceof Date ? v : net ? new Date(Number(net[1])) : null;
    if (!d) return String(v ?? '').slice(0, 10);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const lunes = new Date(`${dia(eP1?.period_from)}T00:00:00Z`), domingo = new Date(`${dia(eP1?.period_to)}T00:00:00Z`);
  check(eP1?.period_kind === 'SEMANA' && lunes.getUTCDay() === 1 && (domingo - lunes) === 6 * 864e5,
    'semana calculada de lunes a domingo', `${dia(eP1?.period_from)} a ${dia(eP1?.period_to)}`);
  check(esperado(t2) === 200, 'la Caja 2 espera $200', String(esperado(t2)));
  check(esperado(t1) === 850, 'y la Caja 1 no se movio ($850)', String(esperado(t1)));
  check(falla(`EXEC dbo.sp_register_expense @user_id=${dueno}, @category_id=${PERSONAL}, @amount=10,
      @payment_method='TRANSFERENCIA', @period_kind='DIA';`, 'a quien').ok, 'un pago al personal sin persona se rechaza');
  check(falla(`EXEC dbo.sp_register_expense @user_id=${dueno}, @category_id=${concepto('Gas')}, @amount=10,
      @payment_method='TRANSFERENCIA', @staff_user_id=${mesero};`, 'personal').ok, 'un gasto comun no admite persona');
  check(falla(`EXEC dbo.sp_register_expense @user_id=${dueno}, @category_id=${PERSONAL}, @amount=10,
      @payment_method='TRANSFERENCIA', @staff_user_id=${mesero}, @period_kind='OTRO';`, 'hasta').ok,
    'periodo "otro" sin fechas se rechaza');

  // ================================================================ 4
  seccion('4. Pago al personal por TRANSFERENCIA');
  const antes4 = n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`));
  egreso(`@user_id=${dueno}, @category_id=${PERSONAL}, @amount=400, @payment_method='TRANSFERENCIA',
      @staff_user_id=${mesero}, @period_kind='DIA'`);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`)) === antes4, 'no toca ninguna caja');
  const hist = sets(`EXEC dbo.sp_get_expenses @only_staff=1, @staff_user_id=${mesero};`);
  check(hist[0].length === 2, 'el historial del mesero tiene sus dos pagos', String(hist[0].length));
  check(n(hist[2][0]?.total) === 700, 'total pagado al mesero: $700', String(hist[2][0]?.total));
  check(hist[0].every(r => r.category_kind === 'PERSONAL'), 'la vista de personal solo trae pagos al personal');
  check(new Set(hist[0].map(r => r.payment_method)).size === 2, 'y dice como se pago cada uno (efectivo y transferencia)');

  // ================================================================ 5
  seccion('5. Pago a proveedor: una sola logica');
  const pp = uno(`EXEC dbo.sp_register_supplier_payment @user_id=${dueno}, @supplier_id=${prov},
      @amount=200, @payment_method=N'EFECTIVO', @register_id=1;`);
  const mPP = uno(`SELECT * FROM dbo.cash_movements WHERE id = ${n(pp?.cash_movement_id)};`);
  check(!!mPP && mPP.typee === 'SUPPLIER_PAYMENT' && n(mPP.amount) === -200 && n(mPP.closure_id) === t1,
    'efectivo: SUPPLIER_PAYMENT de -$200 en el turno de la Caja 1');
  check(n(escalar(`SELECT cash_movement_id FROM dbo.supplier_payments WHERE id = ${n(pp?.payment_id)};`)) === n(pp?.cash_movement_id),
    'el pago queda ligado a su salida del cajon');
  const antes5 = movs(t1);
  const pt = uno(`EXEC dbo.sp_register_supplier_payment @user_id=${dueno}, @supplier_id=${prov},
      @amount=500, @payment_method=N'TRANSFERENCIA';`);
  check(pt?.cash_movement_id == null && movs(t1) === antes5, 'transferencia: queda el pago, sin movimiento de caja');
  check(esperado(t1) === 650, 'el esperado baja solo por el efectivo ($650)', String(esperado(t1)));
  check(falla(`EXEC dbo.sp_register_supplier_payment @user_id=${dueno}, @supplier_id=${prov},
      @amount=0, @payment_method=N'EFECTIVO', @register_id=1;`, 'mayor a cero').ok, 'un pago de $0 se rechaza');
  // Una sola logica: nadie mas escribe supplier_payments en los procedures.
  const escritores = readdirSync(join('sql', 'procedures'), { recursive: true })
    .filter(f => String(f).endsWith('.sql') && !String(f).includes('_cuarentena'))
    .filter(f => /INSERT\s+INTO\s+(dbo\.)?supplier_payments/i.test(readFileSync(join('sql', 'procedures', String(f)), 'utf8')));
  check(escritores.length === 1 && /sp_supplier_payment_apply/.test(String(escritores[0])),
    'solo sp_supplier_payment_apply escribe supplier_payments', escritores.map(String).join(', '));
  const js = readFileSync(join('electron', 'main.js'), 'utf8');
  check(!/INSERT INTO supplier_payments/i.test(js) && !/'sp-pay-supplier'/.test(js),
    'y ya no hay INSERT desde JavaScript (sp-pay-supplier retirado)');

  // ================================================================ 6
  seccion('6. REFUND y SALE_ADJ respetan MultiCaja');
  const venta2 = vender('EFECTIVO', caja2, cajera2);
  check(esperado(t2) === 250, 'venta de $50 en la Caja 2 (espera $250)', String(esperado(t2)));
  // Devuelve el DUENO, que tiene su propio turno abierto en la Caja 1.
  q(`DECLARE @r dbo.SaleDetailType; INSERT INTO @r (product_id, quantity, unit_price) VALUES (${prod}, 1, 50);
     EXEC dbo.sp_refund_sale @sale_id=${venta2}, @user_id=${dueno}, @payment_method=N'EFECTIVO',
       @RefundDetails=@r, @note=N'QA', @apply_net_update=0, @register_id=${caja2};`);
  const mRef = uno(`SELECT TOP 1 * FROM dbo.cash_movements WHERE typee = 'REFUND' ORDER BY id DESC;`);
  check(!!mRef && n(mRef.closure_id) === t2 && n(mRef.register_id) === caja2,
    'la devolucion sale de la Caja 2 aunque la haga alguien con turno en la Caja 1',
    mRef ? `turno ${mRef.closure_id}, caja ${mRef.register_id}` : 'sin movimiento');
  check(esperado(t1) === 650 && esperado(t2) === 200, 'Caja 1 intacta ($650); Caja 2 vuelve a $200', `${esperado(t1)} / ${esperado(t2)}`);
  // Sin caja: la cajera2 tiene UN turno abierto (Caja 2) -> compatibilidad.
  const venta3 = vender('EFECTIVO', caja2, cajera2);
  q(`DECLARE @r dbo.SaleDetailType; INSERT INTO @r (product_id, quantity, unit_price) VALUES (${prod}, 1, 50);
     EXEC dbo.sp_refund_sale @sale_id=${venta3}, @user_id=${cajera2}, @payment_method=N'EFECTIVO',
       @RefundDetails=@r, @note=N'QA', @apply_net_update=0;`);
  const mRef2 = uno(`SELECT TOP 1 * FROM dbo.cash_movements WHERE typee = 'REFUND' ORDER BY id DESC;`);
  check(n(mRef2?.register_id) === caja2 && n(mRef2?.closure_id) === t2,
    'una app vieja (sin caja) resuelve por el unico turno de quien devuelve');
  const venta5 = vender('EFECTIVO', caja2, cajera2);
  const ref3 = falla(`DECLARE @r dbo.SaleDetailType; INSERT INTO @r (product_id, quantity, unit_price) VALUES (${prod}, 1, 50);
     EXEC dbo.sp_refund_sale @sale_id=${venta5}, @user_id=${sinTurno}, @payment_method=N'EFECTIVO',
       @RefundDetails=@r, @note=N'QA', @apply_net_update=0;`, 'caja');
  check(ref3.ok, 'y si no hay de donde saberlo, falla en vez de usar la Caja 1', ref3.error?.slice(0, 70));

  const venta4 = vender('EFECTIVO', caja2, cajera2);
  const antesAdj = esperado(t2);
  q(`DECLARE @d dbo.SaleDetailType; INSERT INTO @d (product_id, quantity, unit_price) VALUES (${prod}, 2, 50);
     EXEC dbo.sp_update_sale @sale_id=${venta4}, @user_id=${dueno}, @SaleDetails=@d, @note=N'QA', @register_id=${caja2};`);
  const mAdj = uno(`SELECT TOP 1 * FROM dbo.cash_movements WHERE typee = 'SALE_ADJ' ORDER BY id DESC;`);
  check(!!mAdj && n(mAdj.closure_id) === t2 && n(mAdj.register_id) === caja2 && n(mAdj.amount) === 50,
    'el ajuste (+$50) va a la Caja 2 aunque lo haga el dueno', mAdj ? `turno ${mAdj.closure_id}, caja ${mAdj.register_id}, ${mAdj.amount}` : 'sin movimiento');
  check(esperado(t2) === antesAdj + 50 && esperado(t1) === 650, 'y solo la Caja 2 cambia');

  // ================================================================ 7
  seccion('7. PAYMENT: solo el efectivo toca el cajon');
  const credito = vender('CREDITO', 1, dueno, `, @customer_id=${cliente}`);
  const antes7 = n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`));
  q(`EXEC dbo.sp_register_customer_payment @customer_id=${cliente}, @sale_id=${credito}, @amount=10,
       @user_id=${dueno}, @payment_method=N'TARJETA';`);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`)) === antes7, 'abono con TARJETA: sin movimiento de caja');
  q(`EXEC dbo.sp_register_customer_payment @customer_id=${cliente}, @sale_id=${credito}, @amount=10,
       @user_id=${dueno}, @payment_method=N'TRANSFERENCIA';`);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`)) === antes7, 'abono por TRANSFERENCIA: sin movimiento de caja');
  q(`EXEC dbo.sp_register_customer_payment @customer_id=${cliente}, @sale_id=${credito}, @amount=20,
       @user_id=${cajera2}, @payment_method=N'EFECTIVO', @register_id=1;`);
  const mPay = uno(`SELECT TOP 1 * FROM dbo.cash_movements WHERE typee = 'PAYMENT' ORDER BY id DESC;`);
  check(!!mPay && n(mPay.amount) === 20 && n(mPay.closure_id) === t1 && n(mPay.register_id) === 1,
    'abono en EFECTIVO: +$20 en el turno de la caja que lo recibe (Caja 1)');
  check(esperado(t1) === 670, 'la Caja 1 espera $670', String(esperado(t1)));
  check(n(escalar(`SELECT balance FROM dbo.sales WHERE id = ${credito};`)) === 10, 'y el saldo de la venta baja con los tres abonos ($50 - $40)');

  // ================================================================ 8
  seccion('8. El corte explica todo lo que suma');
  q(`EXEC dbo.sp_register_cash_out @user_id=${dueno}, @amount=100, @note=N'Retiro al banco', @register_id=1;`);
  const c8 = corte(t1);
  const neto = n(c8.resumen.neto);
  const sumaDesglose = c8.desglose.reduce((a, r) => a + n(r.total), 0);
  check(Math.abs(sumaDesglose - neto) < 0.005, 'la suma del desglose es exactamente el neto', `${sumaDesglose} = ${neto}`);
  check(n(c8.resumen.opening_cash) + neto === n(c8.resumen.cash_expected) && n(c8.resumen.cash_expected) === 570,
    'fondo + neto = esperado ($1,000 - 150 - 200 + 20 - 100 = $570)', String(c8.resumen.cash_expected));
  const grupos = new Set(c8.desglose.map(r => r.grupo));
  for (const g of ['EGRESOS', 'PROVEEDORES', 'ABONOS', 'RETIROS'])
    check(grupos.has(g), `el desglose muestra ${g}`);
  check(c8.desglose.some(r => r.grupo === 'EGRESOS' && r.concepto === 'Luz' && n(r.total) === -150),
    'los egresos salen por concepto (Luz -$150), no mezclados con el retiro');
  check(c8.desglose.some(r => r.grupo === 'RETIROS' && n(r.total) === -100), 'el retiro va aparte (-$100)');
  check(c8.filas.every(r => r.grupo && r.concepto), 'cada movimiento del detalle trae su grupo y su concepto');
  // Fase 1: el cierre registra quién cierra (closed_by): sale de la sesión.
  const cierre = uno(`EXEC dbo.sp_close_shift @closure_id=${t1}, @user_id=${dueno}, @cash_delivered=560, @register_id=1;`);
  check(n(cierre?.cash_expected) === 570, 'el cierre guarda el MISMO esperado que mostro el corte', String(cierre?.cash_expected));
  check(n(cierre?.cash_delivered) === 560 && n(cierre?.difference) === -10, 'contado $560, diferencia -$10');

  // ================================================================ 9
  seccion('9. Conceptos propios');
  const uber = n(uno(`EXEC dbo.sp_expense_category_save @name=N'Uber';`)?.id);
  const didi = n(uno(`EXEC dbo.sp_expense_category_save @name=N'Didi';`)?.id);
  check(uber > 0 && didi > 0, 'se crean "Uber" y "Didi"');
  check(falla(`EXEC dbo.sp_expense_category_save @name=N'Gas';`, 'ya existe').ok, 'no se duplica "Gas"');
  check(escalar(`SELECT kind FROM dbo.expense_categories WHERE id = ${uber};`) === 'GENERAL', 'un concepto creado es GENERAL');
  const t3 = abrir(1, 300, dueno);
  egreso(`@user_id=${dueno}, @category_id=${uber}, @amount=120, @payment_method='TARJETA'`);
  egreso(`@user_id=${dueno}, @category_id=${didi}, @amount=80, @payment_method='EFECTIVO', @register_id=1`);
  const rep = sets(`EXEC dbo.sp_get_expenses;`);
  const por = Object.fromEntries(rep[1].map(r => [r.category_name, n(r.total)]));
  check(por.Uber === 120 && por.Didi === 80, 'aparecen en el reporte por concepto', JSON.stringify({ Uber: por.Uber, Didi: por.Didi }));
  check(por['Pago al personal'] === 700 && por.Renta === 8000, 'junto a los demas (Personal $700, Renta $8,000)');
  check(corte(t3).desglose.some(r => r.concepto === 'Didi' && n(r.total) === -80), 'y en el corte, con su nombre');
  uno(`EXEC dbo.sp_expense_category_save @id=${didi}, @name=N'Didi', @active=0;`);
  check(falla(`EXEC dbo.sp_register_expense @user_id=${dueno}, @category_id=${didi}, @amount=1, @payment_method='TARJETA';`, 'desactivado').ok,
    'un concepto desactivado ya no se puede usar');
  check(sets(`EXEC dbo.sp_expense_category_list;`)[0].every(r => r.id !== didi), 'ni aparece al registrar');
  check(sets(`EXEC dbo.sp_get_expenses;`)[1].some(r => r.category_name === 'Didi'), 'pero su historial sigue en el reporte');
  check(falla(`EXEC dbo.sp_expense_category_save @id=${PERSONAL}, @name=N'Pago al personal', @active=0;`, 'sistema').ok,
    '"Pago al personal" no se puede desactivar');
  const ordenAntes = sets(`EXEC dbo.sp_expense_category_list @include_inactive=1;`)[0].map(r => r.id);
  q(`EXEC dbo.sp_expense_category_move @id=${uber}, @direction=-1;`);
  const ordenDespues = sets(`EXEC dbo.sp_expense_category_list @include_inactive=1;`)[0].map(r => r.id);
  check(ordenDespues.indexOf(uber) === ordenAntes.indexOf(uber) - 1, 'se puede reordenar (Uber sube un lugar)');

  // ================================================================ 10
  seccion('10. Compatibilidad');
  const cats = n(escalar(`SELECT COUNT(*) FROM dbo.expense_categories;`));
  const tipos = n(escalar(`SELECT COUNT(*) FROM dbo.cash_movement_types;`));
  const filas = n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`));
  for (const lote of lotes(MIG)) q(lote);
  check(n(escalar(`SELECT COUNT(*) FROM dbo.expense_categories;`)) === cats
     && n(escalar(`SELECT COUNT(*) FROM dbo.cash_movement_types;`)) === tipos
     && n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`)) === filas,
    'reaplicar la 0049 no duplica ni cambia nada');
  // Una base con un tipo viejo que nadie documento: se adopta, no se borra.
  q(`ALTER TABLE dbo.cash_movements DROP CONSTRAINT FK_cash_movements_type;
     INSERT INTO dbo.cash_movements (userId, typee, amount, register_id) VALUES (${dueno}, 'salida', -5, 1);`);
  for (const lote of lotes(MIG)) q(lote);
  check(escalar(`SELECT grupo FROM dbo.cash_movement_types WHERE code = 'salida';`) === 'OTROS'
     && n(escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE typee = 'salida';`)) === 1
     && !!escalar(`SELECT OBJECT_ID(N'dbo.FK_cash_movements_type', 'F');`),
    'un tipo viejo ("salida") se adopta en OTROS, su fila queda y la llave vuelve');

  // ================================================================ 11
  seccion('11. Cancelar un egreso');
  const esperado3 = esperado(t3);
  const gas = egreso(`@user_id=${dueno}, @category_id=${concepto('Gas')}, @amount=60, @payment_method='EFECTIVO', @register_id=1`);
  check(esperado(t3) === esperado3 - 60, 'gas en efectivo: el turno baja $60');
  q(`EXEC dbo.sp_void_expense @expense_id=${n(gas?.expense_id)}, @user_id=${dueno}, @reason=N'Capturado dos veces';`);
  check(esperado(t3) === esperado3, 'al cancelarlo, el dinero vuelve al cajon del mismo turno');
  check(!!escalar(`SELECT voided_at FROM dbo.expenses WHERE id = ${n(gas?.expense_id)};`), 'y queda marcado (no se borra)');
  check(!sets(`EXEC dbo.sp_get_expenses;`)[0].some(r => n(r.id) === n(gas?.expense_id)), 'ya no cuenta en el reporte');
  check(falla(`EXEC dbo.sp_void_expense @expense_id=${n(luz?.expense_id)}, @user_id=${dueno}, @reason=N'x';`, 'se cerro').ok,
    'un egreso de un turno ya cerrado no se cancela: el corte entregado no se reescribe');

  // ------------------------------------------------------------ resumen
  seccion('12. Estadisticas');
  const cs = uno(`EXEC dbo.sp_cash_summary @days = 30;`);
  check(n(cs?.egresos) === 150 + 8000 + 300 + 400 + 120 + 80, 'egresos de 30 dias (todas las formas de pago, sin cancelados)', String(cs?.egresos));
  check(n(cs?.salidas) > 0 && n(cs?.entradas) > 0, 'entradas y salidas del cajon en positivo, sin el fondo');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
