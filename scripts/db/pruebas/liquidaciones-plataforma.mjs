/**
 * Liquidaciones de plataforma (0069).
 *
 *     node scripts/db/pruebas/liquidaciones-plataforma.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 * Una semana de pedidos de Uber Eats contra la caja:
 *   · que canal es de que plataforma (y que Mostrador nunca lo es);
 *   · la conciliacion: por numero de pedido, por importe el mismo dia, por
 *     importe a un dia de distancia, iguales del mismo dia, faltantes en
 *     caja, sobrantes, importes distintos, cancelados y emparejado a mano;
 *   · que una venta de Didi, una en efectivo o una ya liquidada no entren;
 *   · el concepto de egreso de plataforma: no se ofrece ni se registra a
 *     mano, y su egreso solo lo cancela su liquidacion;
 *   · al confirmar: el reparto suma exacto, el egreso es la comision SIN IVA,
 *     y el estado de resultados baja la venta (promociones y reembolsos),
 *     resta la comision, NO resta retenciones, no cuenta el egreso dos veces
 *     y abre la utilidad por canal;
 *   · deposito real contra esperado, por cobrar y cancelar.
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
const DB = 'Wybix_TmpLiquidaciones';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const todo = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets;
};
const q = (sql) => { const s = todo(sql); return s.length ? s[0] : []; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};
const cerca = (a, b, tol = 0.005) => Math.abs(Number(a) - b) < tol;
const json = (v) => JSON.stringify(v).replace(/'/g, "''");

try {
  console.log(`\nLIQUIDACIONES DE PLATAFORMA   (${DB})`);

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
    // MISMA regla que electron/migrationsRunner.js.
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8')
        .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(lote);
    }
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // ------------------------------------------------------------ datos base
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES (N'qa_dueno', N'x', N'admin', 1, GETDATE());`);
  const u = Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_dueno';`));
  q(`UPDATE dbo.commercial_policy SET payload = N'${json({
    version: 1,
    channels: [
      { id: 'LOCAL', name: 'Mostrador', active: true, inheritBase: true },
      { id: 'UBER', name: 'Uber Eats QA', active: true, inheritBase: true },
      { id: 'DIDI', name: 'Didi QA', active: true, inheritBase: true },
    ],
    prices: [], promotions: [], combos: [],
  })}' WHERE id = 1;`);
  q(`INSERT INTO dbo.products (part_number, nombre, price, stock, cost, objeto_impuesto, tasa_iva, active, registrated_date)
     VALUES (N'QA-DONA', N'QA Dona', 116, 100, 40, '02', 0.16, 1, GETDATE());`);
  const A = Number(escalar(`SELECT id FROM dbo.products WHERE part_number = N'QA-DONA';`));

  /** Una venta de `piezas` donas a 116 (con IVA), pagada como diga `pago`. */
  const venta = (fecha, piezas, { canal = null, pago = 'PLATAFORMA', ref = null, total = null } = {}) => {
    const t = total ?? 116 * piezas;
    const snap = canal ? `N'${json({ channel: canal, channelName: canal === 'UBER' ? 'Uber Eats QA' : 'Didi QA', discount: '0.00' })}'` : 'NULL';
    q(`INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, commercial_snapshot)
       VALUES ('${fecha}', ${u}, ${t}, '${pago}', ${t}, 0, ${snap});`);
    const id = Number(escalar('SELECT MAX(id) FROM dbo.sales;'));
    q(`INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate)
       VALUES (${id}, ${A}, ${piezas}, ${t / piezas}, 40, '02', 0.16);`);
    if (pago === 'PLATAFORMA' && (ref || piezas))
      q(`INSERT INTO dbo.sale_payments (sale_id, payment_method, amount, reference) VALUES (${id}, 'PLATAFORMA', ${t}, ${ref ? `N'${ref}'` : 'NULL'});`);
    return id;
  };
  const s1 = venta('2026-09-02T12:00:00', 2, { canal: 'UBER', ref: '#4F2A1' });   // por referencia
  const s2 = venta('2026-09-03T13:00:00', 1, { canal: 'UBER' });                  // dos iguales el mismo dia
  const s3 = venta('2026-09-03T14:00:00', 1, { canal: 'UBER' });
  const s4 = venta('2026-09-04T23:50:00', 3, {});                                  // sin canal; el pedido es del dia siguiente
  const s5 = venta('2026-09-05T12:00:00', 1, { canal: 'UBER' });                  // sobrante
  const s6 = venta('2026-09-06T12:00:00', 1, { canal: 'DIDI' });                  // de otra plataforma
  const s7 = venta('2026-09-02T15:00:00', 1, { canal: 'UBER', pago: 'EFECTIVO' }); // no se pago en plataforma
  const s8 = venta('2026-09-07T12:00:00', 1, { canal: 'UBER', ref: 'ZZ99', total: 120 }); // importe distinto
  const s9 = venta('2026-09-20T12:00:00', 1, { canal: 'UBER' });                  // fuera del periodo

  // =============================================================== 1
  seccion('1. Que canal es de que plataforma');
  let ch = todo('EXEC dbo.sp_platform_channels_get;');
  check(ch[0].length === 2 && ch[0].every(c => !c.plataforma), 'lista los canales sin Mostrador, aun sin ligar', JSON.stringify(ch[0].map(c => [c.channel_id, c.plataforma])));
  q(`EXEC dbo.sp_platform_channel_set @channel_id = N'UBER', @platform = 'UBER_EATS', @user_id = ${u};`);
  q(`EXEC dbo.sp_platform_channel_set @channel_id = N'DIDI', @platform = 'DIDI_FOOD', @user_id = ${u};`);
  ch = todo('EXEC dbo.sp_platform_channels_get;');
  check(ch[0].find(c => c.channel_id === 'UBER')?.plataforma === 'UBER_EATS', 'UBER queda como Uber Eats');
  let m = falla(`EXEC dbo.sp_platform_channel_set @channel_id = N'LOCAL', @platform = 'RAPPI';`, 'Mostrador');
  check(m.ok, 'Mostrador no puede ser una plataforma', m.error?.slice(0, 60));
  m = falla(`EXEC dbo.sp_platform_channel_set @channel_id = N'NOEXISTE', @platform = 'RAPPI';`, 'no existe');
  check(m.ok, 'ni un canal que no existe', m.error?.slice(0, 60));

  // =============================================================== 2
  seccion('2. Conciliacion de una semana de Uber Eats');
  const pedidos = [
    { id: '4f2a1c3e-0001-4000-8000-000000000001', at: '2026-09-02T12:05:00', customer: 'Ana', fulfillment: 'Entrega', status: 'Completado', base: 200, tax: 32 },
    { id: 'b1000000-0002-4000-8000-000000000002', at: '2026-09-03T13:01:00', status: 'Completado', total: 116 },
    { id: 'b2000000-0003-4000-8000-000000000003', at: '2026-09-03T14:02:00', status: 'Completado', total: 116 },
    { id: 'c3000000-0004-4000-8000-000000000004', at: '2026-09-05T00:10:00', status: 'Completado', total: 348 },
    { id: 'd4000000-0005-4000-8000-000000000005', at: '2026-09-06T12:00:00', status: 'Completado', total: 174 },
    { id: 'e5000000-0006-4000-8000-000000000006', at: '2026-09-06T18:00:00', status: 'Cancelado', total: 116, cancelled: true },
    { id: 'ZZ99AAAA-0007-4000-8000-000000000007', at: '2026-09-07T12:01:00', status: 'Completado', total: 116 },
  ];
  // Con IVA, como lo ensena Uber: 116 de promociones, 232 de tasa de servicio,
  // 58 de reembolsos, 10 de ISR y 5 de IVA retenidos.
  const guardar = (extra = '') => Number(escalar(`EXEC dbo.sp_platform_settlement_save @user_id = ${u}, @platform = 'UBER_EATS',
      @period_from = '2026-09-01', @period_to = '2026-09-07', @source_file = N'uber-semana.csv',
      @gross_sales = 1218, @marketing = 116, @service_fees = 232, @refunds = 58, @isr_withheld = 10, @iva_withheld = 5,
      @orders_json = N'${json(pedidos)}' ${extra};`));
  const L = guardar();
  check(L > 0, 'se guarda el borrador', String(L));
  const ver = () => { const [h, o, s] = todo(`EXEC dbo.sp_platform_settlement_get @settlement_id = ${L};`); return { h: h[0], o, s }; };
  let v = ver();
  const de = (pid) => v.o.find(x => x.platform_order_id.startsWith(pid));
  check(de('4f2a1')?.sale_id === s1 && de('4f2a1')?.match_kind === 'REFERENCIA', 'por numero de pedido (el principio del id, con #)', JSON.stringify(de('4f2a1')));
  check(cerca(de('4f2a1')?.sales_total, 232), 'sin total, total = base + impuesto', String(de('4f2a1')?.sales_total));
  const iguales = [de('b1')?.sale_id, de('b2')?.sale_id].sort();
  check(JSON.stringify(iguales) === JSON.stringify([s2, s3].sort()) && de('b1')?.match_kind === 'IMPORTE', 'dos iguales del mismo dia, por importe', JSON.stringify(iguales));
  check(de('c3')?.sale_id === s4, 'a un dia de distancia y sin canal en la caja', String(de('c3')?.sale_id));
  check(de('d4')?.estado === 'FALTA_EN_CAJA', 'el que la caja no tiene', de('d4')?.estado);
  check(de('e5')?.estado === 'CANCELADO' && !de('e5')?.sale_id, 'el cancelado no se empareja', de('e5')?.estado);
  check(de('ZZ99')?.sale_id === s8 && de('ZZ99')?.estado === 'DIFERENCIA' && cerca(de('ZZ99')?.diferencia, 4), 'por referencia con importe distinto', JSON.stringify([de('ZZ99')?.estado, de('ZZ99')?.diferencia]));
  check(v.s.length === 1 && v.s[0].sale_id === s5, 'sobrante: venta de Uber sin pedido (no Didi, ni efectivo, ni fuera del periodo)', JSON.stringify(v.s.map(x => x.sale_id)));
  check(v.h.pedidos === 7 && v.h.pedidos_ok === 4 && v.h.pedidos_diferencia === 1 && v.h.pedidos_faltan === 1 && v.h.pedidos_cancelados === 1 && v.h.caja_sobrantes === 1,
    'conteos del encabezado', JSON.stringify([v.h.pedidos, v.h.pedidos_ok, v.h.pedidos_diferencia, v.h.pedidos_faltan, v.h.pedidos_cancelados, v.h.caja_sobrantes]));
  check(cerca(v.h.deposit_expected, 1218 - 116 - 232 - 58 - 10 - 5), 'deposito esperado', String(v.h.deposit_expected));
  check(cerca(v.h.fee_base, 200) && cerca(v.h.fee_iva, 32) && cerca(v.h.marketing_base, 100) && cerca(v.h.refunds_base, 50), 'comision y promociones sin IVA', JSON.stringify([v.h.fee_base, v.h.fee_iva, v.h.marketing_base, v.h.refunds_base]));

  // Emparejar dos veces da lo mismo.
  q(`EXEC dbo.sp_platform_settlement_match @settlement_id = ${L};`);
  const antes = JSON.stringify(v.o.map(x => [x.id, x.sale_id]));
  v = ver();
  check(JSON.stringify(v.o.map(x => [x.id, x.sale_id])) === antes, 'emparejar otra vez no cambia nada');

  // A mano: el faltante era la venta sobrante (la caja cobro 116 de un pedido de 174).
  q(`EXEC dbo.sp_platform_settlement_link @settlement_id = ${L}, @order_line_id = ${de('d4').id}, @sale_id = ${s5};`);
  m = falla(`EXEC dbo.sp_platform_settlement_link @settlement_id = ${L}, @order_line_id = ${de('e5').id}, @sale_id = ${s5};`, 'cancelo');
  check(m.ok, 'a un cancelado no se le pone venta', m.error?.slice(0, 60));
  m = falla(`EXEC dbo.sp_platform_settlement_link @settlement_id = ${L}, @order_line_id = ${de('d4').id}, @sale_id = ${s6};`, 'no se pago');
  check(m.ok, 'ni una venta de otra plataforma', m.error?.slice(0, 60));
  m = falla(`EXEC dbo.sp_platform_settlement_link @settlement_id = ${L}, @order_line_id = ${de('d4').id}, @sale_id = ${s7};`, 'no se pago');
  check(m.ok, 'ni una pagada en efectivo', m.error?.slice(0, 60));
  // Cambiar el desglose (sin archivo) respeta lo emparejado a mano.
  q(`EXEC dbo.sp_platform_settlement_save @id = ${L}, @user_id = ${u}, @platform = 'UBER_EATS', @period_from = '2026-09-01', @period_to = '2026-09-07',
       @gross_sales = 1218, @marketing = 116, @service_fees = 232, @refunds = 58, @isr_withheld = 10, @iva_withheld = 5;`);
  v = ver();
  check(de('d4')?.sale_id === s5 && de('d4')?.match_kind === 'MANUAL' && de('d4')?.estado === 'DIFERENCIA' && v.s.length === 0,
    'emparejado a mano: se respeta al volver a guardar', JSON.stringify([de('d4')?.match_kind, de('d4')?.estado, v.s.length]));
  check(v.o.length === 7 && v.h.source_file === 'uber-semana.csv', 'guardar sin archivo conserva pedidos y archivo');

  m = falla(`EXEC dbo.sp_platform_settlement_save @user_id = ${u}, @platform = 'UBER_EATS', @period_from = '2026-09-01', @period_to = '2026-09-07', @service_fees = -1;`, 'positivo');
  check(m.ok, 'rechaza descuentos en negativo', m.error?.slice(0, 60));
  m = falla(`EXEC dbo.sp_platform_settlement_save @user_id = ${u}, @platform = 'UBER_EATS', @period_from = '2026-09-01', @period_to = '2026-09-07',
       @orders_json = N'${json([{ id: 'x', total: 1 }, { id: 'x', total: 2 }])}';`, 'repite');
  check(m.ok, 'rechaza un archivo que repite pedidos', m.error?.slice(0, 60));

  // =============================================================== 3
  seccion('3. El concepto de egreso de plataforma');
  const cat = uno(`SELECT id, name, is_system FROM dbo.expense_categories WHERE kind = 'PLATAFORMA';`);
  check(cat && cat.is_system === true, 'existe y es del sistema', cat?.name);
  const lista = q('EXEC dbo.sp_expense_category_list @include_inactive = 0;');
  check(!lista.some(c => c.kind === 'PLATAFORMA'), 'no se ofrece para registrar un egreso');
  check(q('EXEC dbo.sp_expense_category_list @include_inactive = 1;').some(c => c.kind === 'PLATAFORMA'), 'si aparece en la administracion de conceptos');
  m = falla(`EXEC dbo.sp_register_expense @user_id = ${u}, @category_id = ${cat.id}, @amount = 10, @payment_method = 'OTRO';`, 'Liquidaciones');
  check(m.ok, 'no se registra a mano', m.error?.slice(0, 70));

  // =============================================================== 4
  seccion('4. Estado de resultados ANTES de confirmar');
  const er = () => todo(`EXEC dbo.sp_income_statement @desde = '2026-09-01', @hasta = '2026-09-30';`);
  const [r0] = er();
  const a0 = r0[0];
  check(cerca(a0.descuentos_plataforma, 0) && cerca(a0.comisiones_plataforma, 0), 'un borrador no cuenta', JSON.stringify([a0.descuentos_plataforma, a0.comisiones_plataforma]));

  // =============================================================== 5
  seccion('5. Confirmar');
  m = falla(`EXEC dbo.sp_platform_settlement_save @user_id = ${u}, @platform = 'UBER_EATS', @period_from = '2099-12-01', @period_to = '2099-12-07', @service_fees = 1;
             DECLARE @x INT = (SELECT MAX(id) FROM dbo.platform_settlements); EXEC dbo.sp_platform_settlement_confirm @settlement_id = @x, @user_id = ${u};`, 'no termina');
  check(m.ok, 'no confirma un periodo que no ha terminado', m.error?.slice(0, 60));
  q(`UPDATE dbo.platform_settlements SET status = 'CANCELADA', voided_at = SYSDATETIME(), voided_by = ${u}, void_reason = N'prueba' WHERE period_to = '2099-12-07';`);

  const c = uno(`EXEC dbo.sp_platform_settlement_confirm @settlement_id = ${L}, @user_id = ${u};`);
  check(c?.ventas_repartidas === 6, 'reparte entre las seis ventas emparejadas', String(c?.ventas_repartidas));
  const tot = uno(`SELECT SUM(discount_base) d, SUM(discount_iva) di, SUM(refund_base) r, SUM(refund_iva) ri, SUM(fee_base) f, SUM(fee_iva) fi, SUM(withheld) w
                     FROM dbo.platform_settlement_allocations WHERE settlement_id = ${L};`);
  check(cerca(tot.d, 100, 0.01) && cerca(tot.di, 16, 0.01) && cerca(tot.r, 50, 0.01) && cerca(tot.ri, 8, 0.01)
        && cerca(tot.f, 200, 0.01) && cerca(tot.fi, 32, 0.01) && cerca(tot.w, 15, 0.01), 'el reparto suma exacto', JSON.stringify(tot));
  const s1a = uno(`SELECT fee_base, alloc_date FROM dbo.platform_settlement_allocations WHERE settlement_id = ${L} AND sale_id = ${s1};`);
  check(cerca(s1a.fee_base, 200 * 232 / 1048, 0.0001), 'en proporcion a lo cobrado en plataforma', String(s1a.fee_base));
  const eg = uno(`SELECT e.id, e.amount, e.payment_method, e.expense_date, e.platform_settlement_id, e.cash_movement_id, c.kind
                    FROM dbo.expenses e JOIN dbo.expense_categories c ON c.id = e.category_id WHERE e.platform_settlement_id = ${L};`);
  check(eg && cerca(eg.amount, 200) && eg.payment_method === 'OTRO' && eg.kind === 'PLATAFORMA' && eg.cash_movement_id == null,
    'egreso: la comision SIN IVA, forma OTRO, sin tocar el cajon', JSON.stringify(eg));
  m = falla(`EXEC dbo.sp_void_expense @expense_id = ${eg.id}, @user_id = ${u}, @reason = N'x';`, 'liquidacion');
  check(m.ok, 'ese egreso solo lo cancela su liquidacion', m.error?.slice(0, 70));
  m = falla(`EXEC dbo.sp_platform_settlement_link @settlement_id = ${L}, @order_line_id = ${de('d4').id}, @sale_id = NULL;`, 'borrador');
  check(m.ok, 'confirmada ya no se empareja', m.error?.slice(0, 60));
  m = falla(`EXEC dbo.sp_platform_settlement_confirm @settlement_id = ${L}, @user_id = ${u};`, 'borrador');
  check(m.ok, 'no se confirma dos veces', m.error?.slice(0, 60));

  // =============================================================== 6
  seccion('6. Estado de resultados DESPUES de confirmar');
  const sets = er();
  const a1 = sets[0][0];
  check(sets.length === 7, 'siete resultados', String(sets.length));
  check(cerca(a1.descuentos_plataforma, 150), 'promociones y reembolsos sin IVA bajan la venta', String(a1.descuentos_plataforma));
  check(cerca(a1.ventas_netas, a0.ventas_netas - 150), 'venta neta = antes - 150', `${a0.ventas_netas} -> ${a1.ventas_netas}`);
  check(cerca(a1.iva_trasladado, a0.iva_trasladado - 24), 'y su IVA baja el IVA trasladado', `${a0.iva_trasladado} -> ${a1.iva_trasladado}`);
  check(cerca(a1.comisiones_plataforma, 200) && cerca(a1.iva_comisiones_plataforma, 32), 'comision 200 (gasto) y su IVA 32 (acreditable)', JSON.stringify([a1.comisiones_plataforma, a1.iva_comisiones_plataforma]));
  check(cerca(a1.egresos_generales, a0.egresos_generales), 'el egreso de comision NO se suma otra vez', `${a0.egresos_generales} -> ${a1.egresos_generales}`);
  check(cerca(a1.retenciones_plataforma, 15), 'retenciones informadas', String(a1.retenciones_plataforma));
  check(cerca(a1.utilidad_operacion, a0.utilidad_operacion - 350), 'utilidad = antes - 150 - 200 (las retenciones no son gasto)', `${a0.utilidad_operacion} -> ${a1.utilidad_operacion}`);
  check(!sets[1].some(e => e.kind === 'PLATAFORMA'), 'el desglose de egresos no repite la comision');
  const canales = sets[6];
  const uber = canales.find(x => x.canal === 'UBER'), local = canales.find(x => x.canal === 'LOCAL');
  check(uber?.plataforma === 'UBER_EATS' && uber?.nombre === 'Uber Eats QA', 'canal Uber con su plataforma', JSON.stringify(uber));
  check(cerca(Number(uber?.comisiones_plataforma) + Number(local?.comisiones_plataforma ?? 0), 200, 0.02), 'comisiones por canal suman 200 (la venta sin canal queda en Mostrador)', JSON.stringify(canales.map(x => [x.canal, x.comisiones_plataforma])));
  check(cerca(canales.reduce((s, x) => s + Number(x.utilidad), 0), Number(a1.utilidad_bruta) - 200, 0.05), 'la utilidad por canal cuadra con la del resumen', String(canales.reduce((s, x) => s + Number(x.utilidad), 0)));
  check(canales.find(x => x.canal === 'DIDI')?.sin_liquidar === true, 'Didi: ventas sin liquidar (su utilidad aun es la del ticket)');
  const cats = sets[2];
  check(cerca(cats.reduce((t, x) => t + Number(x.utilidad), 0), Number(a1.utilidad_bruta) - 200, 0.05)
        && cerca(cats.reduce((t, x) => t + Number(x.comisiones_plataforma), 0), 200, 0.05),
    'por categoria: ya con promociones y comision de plataforma', JSON.stringify(cats.map(x => [x.categoria, x.ventas_netas, x.comisiones_plataforma, x.utilidad])));
  // La nube recibe la utilidad de HOY: una venta de Uber de hoy, sin liquidar,
  // se estima al porcentaje de la ultima liquidacion confirmada.
  const hoyIso = escalar(`SELECT CONVERT(CHAR(19), DATEADD(MINUTE, -1, SYSDATETIME()), 126);`);
  venta(hoyIso, 1, { canal: 'UBER' });
  const nube = uno('EXEC dbo.sp_cloud_daily_profit;');
  const tasa = (100 + 50 + 200) / 1218;
  check(cerca(nube.plataformas_estimado, 116 * tasa, 0.01) && cerca(nube.utilidad, 100 - 40 - 116 * tasa, 0.01),
    'nube: la venta de hoy de Uber se estima con el % de la ultima liquidacion', JSON.stringify(nube));
  const ov = q(`EXEC dbo.sp_get_profit_overview @from_date = '2026-09-02', @to_date = '2026-09-02';`);
  // s1 (232) y s7 (116 en efectivo): 3 donas x (100 - 40) = 180, menos el reparto de s1.
  const s1all = uno(`SELECT discount_base + refund_base + fee_base AS x FROM dbo.platform_settlement_allocations WHERE sale_id = ${s1};`);
  check(cerca(ov[0]?.profit, 180 - Number(s1all.x), 0.01), 'Estadisticas: la utilidad del dia baja lo que desconto la plataforma', `${ov[0]?.profit}`);

  // =============================================================== 7
  seccion('7. Una venta liquidada no entra en otra liquidacion');
  const L2 = Number(escalar(`EXEC dbo.sp_platform_settlement_save @user_id = ${u}, @platform = 'UBER_EATS', @period_from = '2026-09-01', @period_to = '2026-09-30',
       @orders_json = N'${json([{ id: '4f2a1c3e-0001-4000-8000-000000000001', at: '2026-09-02T12:05:00', total: 232 }])}';`));
  let v2 = todo(`EXEC dbo.sp_platform_settlement_get @settlement_id = ${L2};`);
  check(!v2[1][0].sale_id && v2[2].length === 1 && v2[2][0].sale_id === s9, 'solo queda la venta del dia 20 como sobrante', JSON.stringify(v2[2].map(x => x.sale_id)));
  q(`EXEC dbo.sp_platform_settlement_void @settlement_id = ${L2}, @user_id = ${u}, @reason = N'prueba';`);

  // =============================================================== 8
  seccion('8. Deposito y por cobrar');
  let lst = todo(`EXEC dbo.sp_platform_settlement_list @desde = '2026-09-01', @hasta = '2026-09-30';`);
  let pc = lst[1].find(x => x.platform === 'UBER_EATS');
  check(lst[0].length === 1 && lst[0][0].id === L, 'lista la confirmada (no la cancelada)', JSON.stringify(lst[0].map(x => x.id)));
  check(pc.liquidaciones_sin_deposito === 1 && cerca(pc.importe_sin_deposito, 797), 'por cobrar: el deposito esperado que no llega', JSON.stringify(pc));
  check(pc.ventas_sin_liquidar === 2 && cerca(pc.importe_sin_liquidar, 232), 'por cobrar: la venta del dia 20 y la de hoy, sin liquidar', String(pc.ventas_sin_liquidar));
  check(cerca(pc.isr_retenido, 10) && cerca(pc.iva_retenido, 5) && cerca(pc.iva_comision, 32), 'acreditables del periodo', JSON.stringify([pc.isr_retenido, pc.iva_retenido, pc.iva_comision]));
  const dep = uno(`EXEC dbo.sp_platform_settlement_deposit @settlement_id = ${L}, @amount = 790, @deposit_date = '2026-09-09';`);
  check(cerca(dep.deposit_difference, -7), 'deposito real contra esperado: faltan 7', String(dep.deposit_difference));
  lst = todo(`EXEC dbo.sp_platform_settlement_list @desde = '2026-09-01', @hasta = '2026-09-30';`);
  pc = lst[1].find(x => x.platform === 'UBER_EATS');
  check(pc.liquidaciones_sin_deposito === 0, 'con deposito ya no esta por cobrar');
  check(lst[2][0].ventas === 0, 'la venta sin canal ya esta liquidada: no cuenta como sin plataforma', String(lst[2][0].ventas));

  // =============================================================== 9
  seccion('9. Cancelar');
  m = falla(`EXEC dbo.sp_platform_settlement_void @settlement_id = ${L}, @user_id = ${u}, @reason = N'';`, 'por que');
  check(m.ok, 'exige motivo', m.error?.slice(0, 60));
  q(`EXEC dbo.sp_platform_settlement_void @settlement_id = ${L}, @user_id = ${u}, @reason = N'Archivo equivocado';`);
  const a2 = er()[0][0];
  check(cerca(a2.utilidad_operacion, a0.utilidad_operacion) && cerca(a2.ventas_netas, a0.ventas_netas), 'resultados vuelven a como estaban', `${a2.utilidad_operacion}`);
  check(escalar(`SELECT CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END FROM dbo.expenses WHERE id = ${eg.id};`) === 1, 'su egreso queda cancelado');
  const L3 = guardar();
  v = (() => { const [h, o, s] = todo(`EXEC dbo.sp_platform_settlement_get @settlement_id = ${L3};`); return { h: h[0], o, s }; })();
  check(v.h.pedidos_ok === 4, 'sus ventas quedan libres para otra liquidacion', String(v.h.pedidos_ok));
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
