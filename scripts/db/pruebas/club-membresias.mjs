/**
 * Club: membresías (0063).
 *
 *     node scripts/db/pruebas/club-membresias.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. El plan: su producto de cobro debe ser sin inventario y no repetirse.
 *   2. Cobrar la membresía afilia y fija hasta cuándo está pagada; sin
 *      cliente no se puede; renovar suma desde el último día pagado.
 *   3. El café del día se registra DENTRO de la venta: solo para el dueño de
 *      la membresía, solo pagada, y no más del límite diario.
 *   4. Vencida: no hay café; renovar y tomarlo en la misma venta sí.
 *   5. Devolver el café lo regresa; devolver la membresía le quita sus días.
 *   6. La nube: se capturan los hechos de esta caja (no los bajados) y lo que
 *      baja de otras sucursales se aplica una sola vez, con su marca de doble.
 *   7. Administración: indicadores, socios y revisión de dobles.
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
const DB = 'Wybix_TmpClub';
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
const hoy = () => escalar(`SELECT CONVERT(VARCHAR(10), CAST(GETDATE() AS DATE), 23)`);
const masDias = (n) => escalar(`SELECT CONVERT(VARCHAR(10), DATEADD(DAY, ${n}, CAST(GETDATE() AS DATE)), 23)`);
const fecha = (v) => { const m = /Date\((-?\d+)\)/.exec(String(v)); const d = m ? new Date(Number(m[1])) : new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

try {
  console.log(`\nCLUB: MEMBRESIAS   (${DB})`);
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
     INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA Club'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');`);
  const u = Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_karla'`));
  const prod = (pn, nombre, precio, modo = 'NONE') => {
    q(`INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, brand_id, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode)
       VALUES (N'${pn}', N'${nombre}', ${precio}, 0, (SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Club'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'QA'),
               9, '02', 0.16, 1, GETDATE(), '${modo}');`);
    return Number(escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`));
  };
  const cafe = prod('QA-AME', 'Americano 12 oz', 45);
  const capu = prod('QA-CAP', 'Capuchino 12 oz', 55);
  const dona = prod('QA-DON', 'Dona glaseada', 28);
  const memb = prod('QA-MEM', 'Membresía Club Café', 399);
  const directo = prod('QA-DIR', 'Producto con existencia', 10, 'DIRECT');
  q(`INSERT INTO dbo.customers (customerName, phone, active) VALUES (N'Mariana López', N'477 312 4588', 1), (N'Jorge Ramírez', N'4771183302', 1);`);
  const mariana = Number(escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Mariana López'`));
  const jorge = Number(escalar(`SELECT id FROM dbo.customers WHERE customerName = N'Jorge Ramírez'`));
  q(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=0, @register_id=1;`);

  /* Una venta como la arma la caja: renglones y, si hay beneficio, una cotización. */
  const vender = (lineas, { cliente = null, membresia = null } = {}) => {
    const valores = lineas.map((l, i) => `(${i + 1}, ${l.p}, ${l.q ?? 1}, ${l.precio}, NULL)`).join(',');
    let quote = 'NULL';
    if (membresia) {
      const id = randomUUID();
      const payload = JSON.stringify({ membership: { membershipId: membresia }, lines: lineas.map((l, i) => ({
        line_no: i + 1, productId: l.p, qty: l.q ?? 1, unitPrice: l.precio, options: [],
        audit: l.club ? { rule: 'membership', discount: String(l.lista) } : {} })) });
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
  const estado = (cli) => sets(`EXEC dbo.sp_membership_status @customer_id=${cli};`);

  // =============================================================== 1
  seccion('1. El plan');
  let r = falla(`EXEC dbo.sp_membership_plan_save @name=N'Club', @sale_product_id=${directo}, @products_json=N'[${cafe}]';`, 'sin inventario');
  check(r.ok, 'el producto de cobro tiene que ser sin inventario', r.error?.slice(0, 60));
  r = falla(`EXEC dbo.sp_membership_plan_save @name=N'Club', @sale_product_id=${memb}, @products_json=N'[]';`, 'al menos un producto');
  check(r.ok, 'y pide qué productos se dan', r.error?.slice(0, 60));
  const plan = Number(uno(`EXEC dbo.sp_membership_plan_save @name=N'Club Café', @sale_product_id=${memb}, @period_days=30, @daily_limit=1, @grace_days=2, @products_json=N'[${cafe},${capu}]';`).id);
  check(plan > 0, `plan #${plan} con Americano y Capuchino`);
  r = falla(`EXEC dbo.sp_membership_plan_save @name=N'Otro', @sale_product_id=${memb}, @products_json=N'[${cafe}]';`, 'otro plan');
  check(r.ok, 'un producto de cobro no se repite entre planes');

  // =============================================================== 2
  seccion('2. Cobrar la membresía');
  r = falla(vender([{ p: memb, precio: 399 }]), 'Asigna el cliente');
  check(r.ok, 'sin cliente no se cobra una membresía', r.error?.slice(0, 60));
  check(Number(escalar('SELECT COUNT(*) FROM dbo.sales')) === 0, 'y la venta no quedó');
  const v1 = venta([{ p: memb, precio: 399 }], { cliente: mariana });
  let m = uno(`SELECT * FROM dbo.customer_memberships WHERE customer_id = ${mariana}`);
  check(!!m && fecha(m.paid_until) === masDias(29), 'afilia a Mariana, pagada 30 días (hoy + 29)', fecha(m?.paid_until));
  const mid = Number(m.id);
  venta([{ p: memb, q: 2, precio: 399 }], { cliente: mariana });
  m = uno(`SELECT * FROM dbo.customer_memberships WHERE id = ${mid}`);
  check(fecha(m.paid_until) === masDias(89), 'renovar 2 meses suma desde el último día pagado (hoy + 89)', fecha(m.paid_until));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.membership_payments WHERE membership_id = ${mid}`)) === 2, 'quedan sus dos pagos');

  // =============================================================== 3
  seccion('3. El café del día');
  let st = estado(mariana);
  check(st[0][0]?.estado === 'ACTIVA' && Number(st[0][0].disponibles_hoy) === 1, 'la caja ve: activa, 1 café hoy');
  check(st[1].length === 2 && st[2].length === 1, 'con sus 2 productos y el plan para afiliar a otros');
  const v3 = venta([{ p: dona, precio: 28 }, { p: cafe, precio: 0, club: true, lista: 45 }], { cliente: mariana, membresia: mid });
  const canje = uno(`SELECT * FROM dbo.membership_redemptions WHERE sale_id = ${v3}`);
  check(!!canje && Number(canje.units) === 1 && canje.product_name === 'Americano 12 oz' && Number(canje.amount) === 45,
    'la venta registró el canje del Americano ($45)', JSON.stringify(canje && { u: canje.units, p: canje.product_name, a: canje.amount }));
  st = estado(mariana);
  check(Number(st[0][0].disponibles_hoy) === 0, 'ya no le queda café hoy');
  r = falla(vender([{ p: capu, precio: 0, club: true, lista: 55 }], { cliente: mariana, membresia: mid }), 'ya uso su beneficio');
  check(r.ok, 'un segundo café el mismo día se rechaza y la venta no queda', r.error?.slice(0, 60));
  r = falla(vender([{ p: cafe, precio: 0, club: true, lista: 45 }], { cliente: jorge, membresia: mid }), 'no es del cliente');
  check(r.ok, 'la membresía de Mariana no sirve en la venta de Jorge', r.error?.slice(0, 60));

  // =============================================================== 4
  seccion('4. Vencida');
  const vj = venta([{ p: memb, precio: 399 }], { cliente: jorge });
  const mj = Number(escalar(`SELECT id FROM dbo.customer_memberships WHERE customer_id = ${jorge}`));
  q(`UPDATE dbo.customer_memberships SET paid_until = DATEADD(DAY, -5, CAST(GETDATE() AS DATE)) WHERE id = ${mj}`);
  check(estado(jorge)[0][0].estado === 'VENCIDA', 'vencida hace 5 días (gracia de 2): la caja la ve VENCIDA');
  r = falla(vender([{ p: cafe, precio: 0, club: true, lista: 45 }], { cliente: jorge, membresia: mj }), 'vencio');
  check(r.ok, 'vencida no da café', r.error?.slice(0, 60));
  const vr = venta([{ p: memb, precio: 399 }, { p: cafe, precio: 0, club: true, lista: 45 }], { cliente: jorge, membresia: mj });
  st = estado(jorge)[0][0];
  check(st.estado === 'ACTIVA' && Number(st.usados_hoy) === 1 && fecha(st.paid_until) === masDias(29),
    'renovar y tomar el café en la misma venta funciona; renueva desde hoy', fecha(st.paid_until));
  q(`UPDATE dbo.customer_memberships SET paid_until = DATEADD(DAY, -1, CAST(GETDATE() AS DATE)) WHERE id = ${mj}`);
  check(estado(jorge)[0][0].estado === 'ACTIVA', 'vencida ayer, con 2 días de gracia, sigue activa');
  q(`UPDATE dbo.customer_memberships SET paid_until = DATEADD(DAY, 29, CAST(GETDATE() AS DATE)) WHERE id = ${mj}`);

  // =============================================================== 5
  seccion('5. Devoluciones');
  q(`DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${cafe}, 1, 0);
     EXEC dbo.sp_refund_sale @reason=N'Prueba', @sale_id=${v3}, @user_id=${u}, @payment_method=N'TARJETA', @RefundDetails=@r, @apply_net_update=0, @register_id=1;`);
  check(uno(`SELECT voided_at FROM dbo.membership_redemptions WHERE sale_id = ${v3}`).voided_at != null, 'devolver el café anula su canje');
  check(Number(estado(mariana)[0][0].disponibles_hoy) === 1, 'y Mariana recupera su café de hoy');
  const antes = fecha(uno(`SELECT paid_until FROM dbo.customer_memberships WHERE id = ${mid}`).paid_until);
  q(`DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${memb}, 1, 399);
     EXEC dbo.sp_refund_sale @reason=N'Prueba', @sale_id=${v1}, @user_id=${u}, @payment_method=N'TARJETA', @RefundDetails=@r, @apply_net_update=0, @register_id=1;`);
  const despues = fecha(uno(`SELECT paid_until FROM dbo.customer_memberships WHERE id = ${mid}`).paid_until);
  check(despues === masDias(59) && antes === masDias(89), 'devolver un mes de membresía le quita 30 días', `${antes} -> ${despues}`);

  // =============================================================== 6
  seccion('6. La nube');
  q('EXEC dbo.sp_sync_capture @max_rows = 500;');
  const tipos = q(`SELECT aggregate_type, COUNT(*) n FROM dbo.sync_outbox WHERE aggregate_type LIKE 'MEMBERSHIP%' GROUP BY aggregate_type`);
  const n = (t) => Number(tipos.find(x => x.aggregate_type === t)?.n ?? 0);
  check(n('MEMBERSHIP_PLAN') === 1 && n('MEMBERSHIP') >= 2 && n('MEMBERSHIP_REDEMPTION') >= 2,
    'se capturan plan, membresías y canjes', JSON.stringify(tipos));
  const evCanje = uno(`SELECT TOP 1 payload FROM dbo.sync_outbox WHERE event_type = 'MEMBERSHIP_REDEMPTION_VOIDED'`);
  check(!!evCanje && JSON.parse(evCanje.payload).voided === true, 'el café devuelto viaja como anulado');

  const planUuid = escalar(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.membership_plans WHERE id = ${plan}`);
  const mUuid = escalar(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.customer_memberships WHERE id = ${mid}`);
  const cafeUuid = escalar(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.products WHERE id = ${cafe}`);
  const canjeLocal = escalar(`SELECT TOP 1 LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.membership_redemptions WHERE membership_id = ${mj} AND voided_at IS NULL`);
  const luis = randomUUID(), remotoCanje = randomUUID();
  const bajada = JSON.stringify({
    plans: [{ uuid: planUuid, name: 'Club Café', sale_product_uuid: null, period_days: 30, daily_limit: 1, grace_days: 2, active: true, products: [cafeUuid] }],
    memberships: [
      { uuid: luis, plan_uuid: planUuid, customer_name: 'Luis Aranda', phone: '+52 477-555-0101', status: 'ACTIVE', paid_until: masDias(20) },
      { uuid: mUuid, plan_uuid: planUuid, customer_name: 'Mariana López', phone: '4773124588', status: 'ACTIVE', paid_until: masDias(120) },
    ],
    redemptions: [
      { uuid: remotoCanje, membership_uuid: mUuid, redeem_date: hoy(), units: 1, product_uuid: cafeUuid, product_name: 'Americano 12 oz', location_name: 'Plaza Mayor', voided: false, doble: false },
      { uuid: canjeLocal, membership_uuid: escalar(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.customer_memberships WHERE id = ${mj}`), redeem_date: hoy(), units: 1, voided: false, doble: true },
    ],
  }).replace(/'/g, "''");
  const ap = uno(`EXEC dbo.sp_membership_apply_remote @payload = N'${bajada}';`);
  check(Number(ap.membresias) === 2 && Number(ap.canjes) === 2, 'se aplica la bajada', JSON.stringify(ap));
  const cLuis = uno(`SELECT c.customerName, m.origin FROM dbo.customer_memberships m JOIN dbo.customers c ON c.id = m.customer_id WHERE m.uuid = '${luis}'`);
  check(cLuis?.customerName === 'Luis Aranda' && cLuis.origin === 'REMOTE', 'un socio de otra sucursal se da de alta aquí como cliente');
  check(fecha(uno(`SELECT paid_until FROM dbo.customer_memberships WHERE id = ${mid}`).paid_until) === masDias(120), 'si renovó en otra sucursal, aquí se ve pagada hasta lo mayor');
  st = estado(mariana)[0][0];
  check(Number(st.disponibles_hoy) === 0 && st.ultimo_canje_en === 'Plaza Mayor', 'su café de hoy en Plaza Mayor cuenta aquí', `${st.disponibles_hoy} · ${st.ultimo_canje_en}`);
  check(Number(escalar(`SELECT doble FROM dbo.membership_redemptions WHERE uuid = '${canjeLocal}'`)) === 1, 'la marca de doble de la nube llega al canje de esta caja');
  uno(`EXEC dbo.sp_membership_apply_remote @payload = N'${bajada}';`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.membership_redemptions WHERE uuid = '${remotoCanje}'`)) === 1
    && Number(escalar(`SELECT COUNT(*) FROM dbo.customers WHERE customerName = N'Luis Aranda'`)) === 1, 'aplicar dos veces no duplica nada');
  const outboxAntes = Number(escalar(`SELECT COUNT(*) FROM dbo.sync_outbox WHERE aggregate_type = 'MEMBERSHIP_REDEMPTION'`));
  q('EXEC dbo.sp_sync_capture @max_rows = 500;');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.sync_outbox o WHERE o.aggregate_type = 'MEMBERSHIP_REDEMPTION' AND o.aggregate_uuid = '${remotoCanje}'`)) === 0,
    'un canje bajado de otra sucursal no se vuelve a subir', `outbox ${outboxAntes}`);

  // =============================================================== 7
  seccion('7. Administración');
  const adm = sets(`EXEC dbo.sp_membership_admin;`);
  check(adm.length === 4, 'devuelve indicadores, planes, socios y dobles');
  const k = adm[0][0];
  check(Number(k.activos) === 3 && Number(k.dobles_pendientes) === 1, 'indicadores: 3 socios activos, 1 doble por revisar', JSON.stringify({ a: k.activos, d: k.dobles_pendientes }));
  check(Number(k.ingreso_mes) === 399 * 4 - 399 + 399 && Number(k.beneficios_mes) >= 1, 'ingreso del mes (sin el pago devuelto) y beneficios', `${k.ingreso_mes} · ${k.beneficios_mes}`);
  const doble = adm[3][0];
  q(`EXEC dbo.sp_membership_manage @accion='REVISAR', @id=${doble.id}, @user_id=${u}, @nota=N'Se habló con la sucursal';`);
  check(Number(sets(`EXEC dbo.sp_membership_admin;`)[0][0].dobles_pendientes) === 0, 'revisado, ya no está pendiente');
  q(`EXEC dbo.sp_membership_manage @accion='CANCELAR', @id=${mj}, @user_id=${u};`);
  check(estado(jorge)[0][0].estado === 'CANCELADA', 'cancelar deja de dar el beneficio');
  check(sets(`EXEC dbo.sp_membership_admin @buscar=N'4773124588';`)[2].length === 1, 'se busca un socio por teléfono');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}
console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
