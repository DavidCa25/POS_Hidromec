/**
 * Tarjeta del Club en Wallet (0066).
 *
 *     node scripts/db/pruebas/club-wallet.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. Los pases que llegan (emitidos aquí o bajados por club_pull) se
 *      guardan una vez; un serial o teléfono mal formado se descarta.
 *   2. Resolver `WXC-<serial>`: el cliente por teléfono (mobile o phone,
 *      últimos 10 dígitos); un serial desconocido dice pase = 0.
 *   3. Pase de otra sucursal y cliente que aquí no existe: se da de alta.
 *   4. Para emitir: nombre, teléfono normalizado y serial si ya tiene.
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
const DB = 'Wybix_TmpClubWallet';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const q = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
};
const uno = (sql) => q(sql)[0] ?? null;
const aplicar = (pases) => uno(`EXEC dbo.sp_club_wallet_apply @payload = N'${JSON.stringify(pases).replace(/'/g, "''")}';`);
const resolver = (serial) => uno(`EXEC dbo.sp_club_wallet_resolve @serial = '${serial}';`);

const A = 'a1b2c3d4e5f60718293a4b5c', B = 'bbbbbbbbbbbbbbbbbbbbbbbb', C = 'cccccccccccccccccccccccc';

try {
  console.log(`\nCLUB EN WALLET   (${DB})`);
  if (!existsSync(BAK)) { console.log(`   ----   falta ${BAK}`); process.exit(0); }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true }).filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en')).filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }
  // Dos veces: la migración es idempotente.
  for (const lote of readFileSync(join(DIR_MIG, '0066_club-wallet.sql'), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);

  q(`INSERT INTO dbo.customers (customerName, phone, mobile, active) VALUES (N'Mariana López', N'477 312 4588', NULL, 1), (N'Jorge Ramírez', NULL, N'+52 (477) 118-3302', 1);`);
  const mariana = Number(uno(`SELECT id FROM dbo.customers WHERE customerName = N'Mariana López'`).id);
  const jorge = Number(uno(`SELECT id FROM dbo.customers WHERE customerName = N'Jorge Ramírez'`).id);

  console.log('\n-- 1. llegan los pases');
  aplicar([{ serial: A, phone: '4773124588', customer_name: 'Mariana López' }, { serial: B.toUpperCase(), phone: '477-118-3302', customer_name: null },
           { serial: 'corto', phone: '4770000000' }, { serial: C, phone: '123' }]);
  aplicar([{ serial: A, phone: '4773124588', customer_name: 'Otro nombre' }, { serial: B, phone: '4771183302', customer_name: 'Jorge R.' }]);
  const filas = q(`SELECT serial, phone_key, customer_name FROM dbo.club_wallet_passes ORDER BY serial`);
  check(filas.length === 2, 'solo los dos pases bien formados, una vez cada uno', JSON.stringify(filas.map(f => f.serial)));
  check(filas[0].customer_name === 'Mariana López' && filas[1].customer_name === 'Jorge R.', 'el nombre solo se completa, no se pisa');

  console.log('\n-- 2. resolver');
  const r1 = resolver(`  ${A.toUpperCase()} `);
  check(Number(r1.customer_id) === mariana && r1.pase === true, 'el pase de Mariana la encuentra por phone', JSON.stringify(r1));
  check(Number(resolver(B).customer_id) === jorge, 'el de Jorge, por mobile con formato');
  const r0 = resolver(C);
  check(r0.pase === false && r0.customer_id === null, 'serial desconocido: pase = 0 (la caja pregunta a la nube)');

  console.log('\n-- 3. cliente de otra sucursal');
  aplicar([{ serial: C, phone: '4775550101', customer_name: 'Lucía Herrera' }]);
  const r3 = resolver(C);
  const lucia = uno(`SELECT id, customerName, phone FROM dbo.customers WHERE id = ${Number(r3.customer_id) || 0}`);
  check(lucia?.customerName === 'Lucía Herrera' && lucia?.phone === '4775550101', 'se da de alta con su nombre y teléfono', JSON.stringify(lucia));
  check(Number(resolver(C).customer_id) === Number(r3.customer_id), 'resolver otra vez no la duplica');

  console.log('\n-- 4. para emitir');
  const e1 = uno(`EXEC dbo.sp_club_wallet_customer @customer_id = ${jorge};`);
  check(e1.phone_key === '4771183302' && e1.serial === B, 'Jorge: teléfono normalizado y su serial', JSON.stringify(e1));
  q(`INSERT INTO dbo.customers (customerName, phone, active) VALUES (N'Sin teléfono', N'123', 1);`);
  const sinTel = Number(uno(`SELECT MAX(id) AS m FROM dbo.customers`).m);
  const e2 = uno(`EXEC dbo.sp_club_wallet_customer @customer_id = ${sinTel};`);
  check(e2.phone_key === null && e2.serial === null, 'sin teléfono de 10 dígitos: phone_key NULL');
} catch (e) {
  check(false, 'la prueba se interrumpió', e.message);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* ya no está */ } }
}
console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas${fallos ? ` · ${fallos} FALLAS` : ''}`);
process.exit(fallos ? 1 : 0);
