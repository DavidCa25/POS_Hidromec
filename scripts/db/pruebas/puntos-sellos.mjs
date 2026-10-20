/**
 * Puntos y sellos (0064).
 *
 *     node scripts/db/pruebas/puntos-sellos.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. Configuración y tarjetas: no se enciende sin decir cómo se gana; una
 *      tarjeta pide productos.
 *   2. Ganar: puntos por lo pagado y por la visita (una al día), un sello por
 *      unidad cobrada; una venta no gana dos veces; sin cliente no gana; un
 *      regalo en $0 no sella.
 *   3. Canjear puntos DENTRO de la venta: solo el dueño, solo si alcanza, y
 *      si la recompensa cambió entre cotizar y cobrar, la venta no queda.
 *   4. Sellos: ajuste manual con motivo obligatorio y canje de la tarjeta.
 *   5. Devoluciones: puntos en proporción, sellos por unidad, canjes de
 *      vuelta, y cupones de campaña sin usar anulados; acumulativo.
 *   6. Caducidad por inactividad.
 *   7. Cupones de $ y %: se consumen en la venta.
 *   8. Administración e historial.
 *   9. La nube: se capturan configuración, tarjetas y movimientos de esta
 *      caja; lo que baja de otras sucursales suma al mismo cliente (por
 *      teléfono), una sola vez.
 *
 * Corre sobre una restauracion del baseline, no sobre ninguna base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpPuntos';
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
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
};
const sets = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};

try {
  console.log(`\nPUNTOS Y SELLOS   (${DB})`);
  if (!existsSync(BAK)) { console.log(`   ----   falta ${BAK}`); process.exit(0); }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true }).filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en')).filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  /* ---------------------------------------------------- el mundo */
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES (N'qa_karla', N'x', N'admin', 1, GETDATE());
     INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA Puntos'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
     IF NOT EXISTS (SELECT 1 FROM dbo.business_config) INSERT INTO dbo.business_config (business_name) VALUES (N'QA Puntos');
     UPDATE dbo.business_config SET loyalty_enabled = 1;`);
  const u = Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_karla'`));
  const prod = (pn, nombre, precio) => {
    q(`INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, brand_id, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode)
       VALUES (N'${pn}', N'${nombre}', ${precio}, 0, (SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Puntos'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'QA'),
               9, '02', 0.16, 1, GETDATE(), 'NONE');`);
    return Number(escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`));
  };
  const cafe = prod('QA-AME', 'Americano 12 oz', 45);
  const capu = prod('QA-CAP', 'Capuchino 12 oz', 55);
  const dona = prod('QA-DON', 'Dona glaseada', 28);
  q(`INSERT INTO dbo.customers (customerName, phone, active) VALUES (N'Mariana López', N'477 312 4588', 1), (N'Jorge Ramírez', N'4771183302', 1);`);
  const mariana = Number(escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Mariana López'`));
  const jorge = Number(escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Jorge Ramírez'`));
  q(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=0, @register_id=1;`);

  /* Una venta como la arma la caja. `canje` = lo que la cotización mandaría. */
  const vender = (lineas, { cliente = null, canje = null } = {}) => {
    const valores = lineas.map((l, i) => `(${i + 1}, ${l.p}, ${l.q ?? 1}, ${l.precio}, NULL)`).join(',');
    let quote = 'NULL';
    if (canje) {
      const id = randomUUID();
      const payload = JSON.stringify({ ...canje, lines: lineas.map((l, i) => ({
        line_no: i + 1, productId: l.p, qty: l.q ?? 1, unitPrice: l.precio, options: [],
        audit: l.regla ? { rule: l.regla, discount: String(l.lista) } : {} })) });
      q(`INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at)
         VALUES('${id}', ${u}, 1, (SELECT version FROM dbo.commercial_policy WHERE id = 1), N'${payload.replace(/'/g, "''")}', DATEADD(minute,5,SYSUTCDATETIME()))`);
      quote = `'${id}'`;
    }
    return `DECLARE @a dbo.SaleDetailType, @b dbo.SaleDetailType2, @m dbo.SaleModifierType;
      INSERT @b VALUES ${valores};
      EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'TARJETA', @register_id=1, @SaleDetails=@a, @SaleDetails2=@b,
        @SaleModifiers=@m, @customer_id=${cliente ?? 'NULL'}, @commercial_quote=${quote};`;
  };
  const venta = (lineas, opts) => Number(uno(vender(lineas, opts)).sale_id);
  const evaluar = (id) => q(`EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${id};`);
  const estado = (cli) => sets(`EXEC dbo.sp_loyalty_customer_status @customer_id=${cli};`);
  const puntos = (cli) => Number(estado(cli)[0][0].puntos);
  const sellos = (cli, card) => Number(estado(cli)[1].find(c => Number(c.id) === card)?.sellos ?? 0);
  const devolver = (sale, p, qty, precio) => q(`DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${p}, ${qty}, ${precio});
     EXEC dbo.sp_refund_sale @reason=N'Prueba', @sale_id=${sale}, @user_id=${u}, @payment_method=N'TARJETA', @RefundDetails=@r, @apply_net_update=0, @register_id=1;`);

  // =============================================================== 1
  seccion('1. Configuración y tarjetas');
  let r = falla(`EXEC dbo.sp_loyalty_points_config_save @enabled=1;`, 'se ganan: por cada');
  check(r.ok, 'encender sin decir cómo se gana se rechaza', r.error?.slice(0, 60));
  q(`EXEC dbo.sp_loyalty_points_config_save @enabled=1, @per_amount=10, @points_per=1, @visit_points=5, @expiry_months=12;`);
  check(Number(uno(`SELECT enabled FROM dbo.loyalty_points_config`).enabled) === 1, '1 punto por cada $10, 5 por visita, caducan a los 12 meses');
  r = falla(`EXEC dbo.sp_loyalty_stamp_card_save @name=N'Café', @stamps_required=5, @products_json=N'[]';`, 'al menos un producto');
  check(r.ok, 'una tarjeta sin productos se rechaza');
  const card = Number(uno(`EXEC dbo.sp_loyalty_stamp_card_save @name=N'Café 5+1', @stamps_required=5, @products_json=N'[${cafe},${capu}]';`).id);
  check(card > 0, `tarjeta #${card}: 5 cafés y el siguiente gratis`);

  // =============================================================== 2
  seccion('2. Ganar');
  const v1 = venta([{ p: cafe, precio: 45 }, { p: dona, precio: 28 }], { cliente: mariana });
  const premios = evaluar(v1);
  check(puntos(mariana) === 12, '$73: 7 por compra + 5 por visita = 12', String(puntos(mariana)));
  check(sellos(mariana, card) === 1, 'un sello por el Americano (la dona no sella)');
  check(premios.some(p => p.tipo === 'POINTS' && Number(p.numero) === 12) && premios.some(p => p.tipo === 'STAMPS'),
    'la caja recibe "+12 puntos" y el sello para enseñarlos', JSON.stringify(premios.map(p => p.nombre)));
  evaluar(v1);
  check(puntos(mariana) === 12 && sellos(mariana, card) === 1, 'evaluar otra vez no suma de nuevo');
  const v2 = venta([{ p: cafe, q: 2, precio: 45 }], { cliente: mariana });
  evaluar(v2);
  check(puntos(mariana) === 21 && sellos(mariana, card) === 3, 'segunda visita del día: 9 por compra, sin visita; 2 sellos', `${puntos(mariana)} · ${sellos(mariana, card)}`);
  const v0 = venta([{ p: cafe, precio: 45 }]);
  evaluar(v0);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.loyalty_ledger WHERE sale_id = ${v0}`)) === 0, 'sin cliente no se gana nada');

  // =============================================================== 3
  seccion('3. Canjear puntos');
  const premio = Number(uno(`EXEC dbo.sp_loyalty_save_definition @kind_of='REWARD', @name=N'Dona gratis', @kind='FREE_PRODUCT', @product_id=${dona};`)?.id
    ?? escalar(`SELECT TOP 1 id FROM dbo.reward_definitions ORDER BY id DESC`));
  q(`EXEC dbo.sp_loyalty_points_manage @accion='COSTO', @id=${premio}, @valor=15;`);
  const st = estado(mariana);
  check(st[3].some(x => Number(x.id) === premio && Number(x.points_cost) === 15), 'la dona por 15 puntos está en el catálogo de canje');
  const canjeDona = (cli, costo = 15) => ({ loyaltyCustomerId: cli, points: { rewardId: premio, cost: costo, amountApplied: '28.00' } });
  r = falla(vender([{ p: dona, precio: 0, regla: 'points', lista: 28 }], { cliente: jorge, canje: canjeDona(mariana) }), 'otro cliente');
  check(r.ok, 'los puntos de Mariana no se canjean en la venta de Jorge', r.error?.slice(0, 60));
  r = falla(vender([{ p: dona, precio: 0, regla: 'points', lista: 28 }], { cliente: mariana, canje: canjeDona(mariana, 10) }), 'vuelve a elegir el canje');
  check(r.ok, 'si el costo cambió entre cotizar y cobrar, la venta no queda', r.error?.slice(0, 60));
  const v3 = venta([{ p: dona, precio: 0, regla: 'points', lista: 28 }], { cliente: mariana, canje: canjeDona(mariana) });
  check(puntos(mariana) === 6, 'canjear la dona descuenta 15: quedan 6', String(puntos(mariana)));
  const red = uno(`SELECT * FROM dbo.loyalty_ledger WHERE sale_id = ${v3} AND kind = 'REDEEM'`);
  check(!!red && red.sale_detail_id != null && Number(red.amount) === 28, 'el canje queda atado al renglón de la dona ($28)');
  r = falla(vender([{ p: dona, precio: 0, regla: 'points', lista: 28 }], { cliente: mariana, canje: canjeDona(mariana) }), 'no le alcanzan');
  check(r.ok, 'con 6 puntos ya no alcanza y la venta no queda', r.error?.slice(0, 60));

  // =============================================================== 4
  seccion('4. Sellos');
  r = falla(`EXEC dbo.sp_loyalty_points_manage @accion='AJUSTE', @id=${mariana}, @valor=2, @card_id=${card};`, 'motivo');
  check(r.ok, 'un ajuste sin motivo se rechaza');
  q(`EXEC dbo.sp_loyalty_points_manage @accion='AJUSTE', @id=${mariana}, @valor=2, @card_id=${card}, @nota=N'Tarjeta de papel', @user_id=${u};`);
  check(sellos(mariana, card) === 5, 'ajuste de +2 sellos con motivo: tarjeta llena (5/5)');
  const canjeTarjeta = { loyaltyCustomerId: mariana, stamps: { cardId: card, cost: 5, amountApplied: '55.00' } };
  const v4 = venta([{ p: capu, precio: 0, regla: 'stamps', lista: 55 }, { p: cafe, precio: 45 }], { cliente: mariana, canje: canjeTarjeta });
  evaluar(v4);
  check(sellos(mariana, card) === 1, 'canjear vacía la tarjeta; el Capuchino regalado no sella y el Americano pagado sí', String(sellos(mariana, card)));

  // =============================================================== 5
  seccion('5. Devoluciones');
  const antes = puntos(mariana);
  devolver(v2, cafe, 1, 45);
  check(puntos(mariana) === antes - 4 && sellos(mariana, card) === 0, 'devolver 1 de 2 cafés: -4 puntos (9 × 45/90) y -1 sello', `${antes} -> ${puntos(mariana)}`);
  devolver(v2, cafe, 1, 45);
  check(puntos(mariana) === antes - 9, 'devolver el otro completa la reversa (-9), sin pasarse', String(puntos(mariana)));
  check(sellos(mariana, card) === -1, 'el saldo de sellos puede quedar negativo: ya lo había gastado', String(sellos(mariana, card)));
  const p5 = puntos(mariana);
  devolver(v3, dona, 1, 0);
  check(puntos(mariana) === p5 + 15, 'devolver la dona canjeada le regresa sus 15 puntos', `${p5} -> ${puntos(mariana)}`);
  q(`INSERT INTO dbo.coupon_definitions (name, kind, amount, uses_allowed, code_prefix, active) VALUES (N'$20 próxima visita', N'AMOUNT', 20, 1, N'VUELVE', 1);`);
  const cdef = Number(escalar(`SELECT id FROM dbo.coupon_definitions WHERE name = N'$20 próxima visita'`));
  const v5 = venta([{ p: capu, precio: 55 }], { cliente: jorge });
  q(`INSERT INTO dbo.coupon_instances (definition_id, customer_id, code, sale_id, status) VALUES (${cdef}, ${jorge}, N'VUELVE-T1', ${v5}, 'ISSUED');`);
  devolver(v5, capu, 1, 55);
  check(escalar(`SELECT status FROM dbo.coupon_instances WHERE code = N'VUELVE-T1'`) === 'VOID', 'devolver la venta completa anula el cupón que ganó y no se usó');

  // =============================================================== 6
  seccion('6. Caducidad');
  q(`UPDATE dbo.loyalty_ledger SET created_at = DATEADD(MONTH, -13, created_at) WHERE customer_id = ${mariana} AND program = 'POINTS';`);
  const saldo = Number(escalar(`SELECT SUM(delta) FROM dbo.loyalty_ledger WHERE customer_id = ${mariana} AND program = 'POINTS'`));
  check(puntos(mariana) === 0 && saldo > 0, `13 meses sin movimiento: sus ${saldo} puntos caducan al consultarlos`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.loyalty_ledger WHERE customer_id = ${mariana} AND kind = 'EXPIRE'`)) === 1, 'una sola vez, como movimiento EXPIRE');
  estado(mariana);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.loyalty_ledger WHERE customer_id = ${mariana} AND kind = 'EXPIRE'`)) === 1, 'consultar otra vez no vuelve a caducar');

  // =============================================================== 7
  seccion('7. Cupones de $ y %');
  q(`INSERT INTO dbo.coupon_instances (definition_id, customer_id, code, status) VALUES (${cdef}, ${jorge}, N'VUELVE-T2', 'ISSUED');`);
  const inst = Number(escalar(`SELECT id FROM dbo.coupon_instances WHERE code = N'VUELVE-T2'`));
  const cup = (monto) => ({ coupon: { code: 'VUELVE-T2', instanceId: inst, productId: null, amountApplied: monto } });
  r = falla(vender([{ p: capu, precio: 55 }], { cliente: jorge, canje: cup('0.00') }), 'ning');
  check(r.ok, 'un cupón de $ que no descontó nada no se consume');
  const v7 = venta([{ p: capu, precio: 35, regla: 'coupon', lista: 20 }], { cliente: jorge, canje: cup('20.00') });
  check(escalar(`SELECT status FROM dbo.coupon_instances WHERE id = ${inst}`) === 'REDEEMED'
     && Number(escalar(`SELECT amount_applied FROM dbo.loyalty_redemptions WHERE sale_id = ${v7}`)) === 20, 'el cupón de $20 se consume en la venta');

  // =============================================================== 8
  seccion('8. Administración');
  const adm = sets(`EXEC dbo.sp_loyalty_points_admin;`);
  check(adm.length === 5, 'devuelve configuración, indicadores, tarjetas, recompensas y clientes');
  /* Los puntos de Mariana se fecharon 13 meses atrás para caducarlos: este mes solo cuenta la tarjeta. */
  check(Number(adm[1][0].tarjetas_mes) === 1 && Number(adm[1][0].descuento_mes) >= 55 && Number(adm[1][0].vigentes) === 0,
    'indicadores: 1 tarjeta canjeada ($55) y 0 puntos vigentes tras caducar', JSON.stringify({ t: adm[1][0].tarjetas_mes, d: adm[1][0].descuento_mes, v: adm[1][0].vigentes }));
  check(sets(`EXEC dbo.sp_loyalty_points_admin @buscar=N'312 4588';`)[4].length === 1, 'se busca a un cliente por teléfono con espacios');
  const hist = q(`EXEC dbo.sp_loyalty_points_ledger @customer_id=${mariana};`);
  check(hist.length >= 10 && hist.some(h => h.kind === 'ADJUST' && h.usuario === 'qa_karla'), 'el historial dice quién ajustó', String(hist.length));

  // =============================================================== 9
  seccion('9. La nube');
  q('EXEC dbo.sp_sync_capture @max_rows = 500;');
  const tipos = q(`SELECT aggregate_type, COUNT(*) n FROM dbo.sync_outbox WHERE aggregate_type IN ('POINTS_CONFIG','STAMP_CARD','LOYALTY_LEDGER') GROUP BY aggregate_type`);
  const n = (t) => Number(tipos.find(x => x.aggregate_type === t)?.n ?? 0);
  const locales = Number(escalar(`SELECT COUNT(*) FROM dbo.loyalty_ledger WHERE origin = 'LOCAL'`));
  check(n('POINTS_CONFIG') === 1 && n('STAMP_CARD') === 1 && n('LOYALTY_LEDGER') === locales,
    'se capturan configuración, tarjeta y cada movimiento', JSON.stringify(tipos));
  const ev = JSON.parse(uno(`SELECT TOP 1 payload FROM dbo.sync_outbox WHERE aggregate_type = 'LOYALTY_LEDGER' AND event_type = 'LOYALTY_MOVEMENT' ORDER BY id`).payload);
  check(ev.phone && ev.program && ev.delta && ev.created_local, 'el movimiento viaja con teléfono, programa, delta y hora');

  const cardUuid = escalar(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.loyalty_stamp_cards WHERE id = ${card}`);
  const capuUuid = escalar(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.products WHERE id = ${capu}`);
  const tarjetaNube = randomUUID(), m1 = randomUUID(), m2 = randomUUID(), m3 = randomUUID();
  const bajada = JSON.stringify({
    points_config: { enabled: true, per_amount: '20.00', points_per: 2, visit_points: 0, expiry_months: 6, updated_local: '2099-01-01T00:00:00' },
    stamp_cards: [{ uuid: tarjetaNube, name: 'Dona 6+1', stamps_required: 6, reward_product_uuid: null, active: true, products: [capuUuid] }],
    ledger: [
      { uuid: m1, customer_name: 'Jorge Ramírez', phone: '+52 (477) 118-3302', program: 'POINTS', delta: 40, kind: 'EARN', reason: 'PURCHASE', created_local: '2026-10-18T10:00:00', location_name: 'Sucursal Centro' },
      { uuid: m2, customer_name: 'Jorge Ramírez', phone: '4771183302', program: 'STAMPS', card_uuid: cardUuid, delta: 2, kind: 'EARN', reason: 'PURCHASE', created_local: '2026-10-18T10:00:00', location_name: 'Sucursal Centro' },
      { uuid: m3, customer_name: 'Luisa Nueva', phone: '477 999 0000', program: 'POINTS', delta: 15, kind: 'ADJUST', note: 'Bienvenida', created_local: '2026-10-18T11:00:00', location_name: 'Sucursal Centro' },
    ],
  });
  const aplicar = () => q(`EXEC dbo.sp_loyalty_points_apply_remote @payload = N'${bajada.replace(/'/g, "''")}';`);
  const pJorge = puntos(jorge);
  aplicar();
  check(puntos(jorge) === pJorge + 40 && sellos(jorge, card) === 2, 'los 40 puntos y 2 sellos de Jorge en otra sucursal se suman aquí', `${pJorge} -> ${puntos(jorge)}`);
  const luisa = Number(escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Luisa Nueva'`));
  check(luisa > 0 && puntos(luisa) === 15, 'una clienta que aquí no existía se da de alta con sus 15 puntos');
  check(Number(escalar(`SELECT points_per FROM dbo.loyalty_points_config`)) === 2, 'la configuración más reciente de la nube gana');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.loyalty_stamp_cards WHERE uuid = '${tarjetaNube}' AND origin = 'REMOTE'`)) === 1, 'baja la tarjeta «Dona 6+1»');
  aplicar();
  check(puntos(jorge) === pJorge + 40, 'aplicar el mismo lote otra vez no suma de nuevo');
  q('EXEC dbo.sp_sync_capture @max_rows = 500;');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.sync_outbox WHERE aggregate_uuid IN ('${m1}','${m2}','${m3}')`)) === 0, 'lo bajado no se vuelve a subir');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}
console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
