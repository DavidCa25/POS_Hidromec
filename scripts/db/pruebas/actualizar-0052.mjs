/**
 * 0052 SOBRE UNA SUCURSAL QUE YA EXISTE.
 *
 *     node scripts/db/pruebas/actualizar-0052.mjs [--desde <template anterior.bak>]
 *
 * Una sucursal instalada antes de la 0052 tiene ventas, turnos, outbox e
 * identidad de nube (instance_uuid, empresa, ubicación, huella del servidor).
 * Al actualizar el POS, el arranque aplica las migraciones pendientes. Aquí se
 * demuestra con SQL Server real, en una base TEMPORAL, que:
 *
 *   - no se pierde ni cambia ninguna fila de lo que ya había;
 *   - la identidad y la configuración de sincronización quedan intactas;
 *   - cada producto existente recibe su uuid (único, no nulo);
 *   - reaplicar la 0052 no falla ni cambia nada (idempotente);
 *   - enviar y recibir mercancía de un evento funciona sobre el esquema nuevo.
 *
 * `--desde` es el template ANTERIOR a la 0052 (sin él se usa el del
 * instalador; si ese ya trae la 0052, solo se prueba la reaplicación).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const DB = 'Wybix_TmpAct0052';
const iD = process.argv.indexOf('--desde');
const BAK = resolve(iD > 0 ? process.argv[iD + 1] : join('installer', 'template.bak'));
const DIR = join('electron', 'migrations');
const M52 = '0052_fase2-transferencias-catalogo.sql';

let fallos = 0, pasos = 0;
const check = (ok, t, d = '') => { pasos++; if (!ok) fallos++; console.log(`   ${ok ? 'ok    ' : 'FALLA '} ${t}${d ? '  · ' + d : ''}`); };
const q = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets.length ? r.sets[0] : []; };
const uno = (sql) => { const f = q(sql)[0]; return f ? f[Object.keys(f)[0]] : null; };
const lotes = (f) => readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).filter((l) => l.trim());

/** Huella de TODAS las tablas de usuario: filas y checksum del contenido (sin columnas nuevas de la 0052). */
function huella() {
  const tablas = q(`SELECT t.name FROM sys.tables t WHERE t.is_ms_shipped = 0 AND t.name NOT IN ('schema_migrations') ORDER BY t.name`).map((r) => r.name);
  const out = {};
  for (const t of tablas) {
    const cols = q(`SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(N'dbo.${t}')
                     AND c.name <> 'uuid' AND TYPE_NAME(c.user_type_id) NOT IN ('timestamp','rowversion','xml','image','text','ntext','geography','geometry','hierarchyid','sql_variant')
                     ORDER BY c.column_id`).map((r) => `[${r.name}]`);
    out[t] = uno(`SELECT CONCAT(COUNT(*), ':', ISNULL(CHECKSUM_AGG(BINARY_CHECKSUM(${cols.join(',') || '1'})), 0)) FROM dbo.[${t}]`);
  }
  return out;
}

try {
  console.log(`\n0052 SOBRE UNA SUCURSAL EXISTENTE   (${DB})\n   desde: ${BAK}`);
  restaurar(DB, BAK);
  const tenia52 = Number(uno(`SELECT COUNT(*) FROM dbo.schema_migrations WHERE filename = N'${M52}'`)) > 0;

  // ------------------------------------------------------- la sucursal de antes
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
       VALUES (N'ana', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x'), 2), N'admin', 1, GETDATE());
     INSERT INTO dbo.CAT_brands (namee) VALUES (N'I Do Nut'); INSERT INTO dbo.CAT_categories (namee) VALUES (N'Donas');`);
  const ana = Number(uno(`SELECT id FROM dbo.users WHERE usuario = N'ana'`));
  const marca = uno('SELECT TOP 1 id FROM dbo.CAT_brands'), cat = uno('SELECT TOP 1 id FROM dbo.CAT_categories');
  const prod = (pn, n, precio, stock) => Number(uno(`EXEC dbo.sp_add_product @brand=${marca}, @part_number=N'${pn}', @name=N'${n}', @price=${precio}, @stock=${stock}, @category=${cat}, @cost=6.5;`));
  const A = prod('ACT-A', 'Dona glaseada', 25, 100);
  prod('ACT-B', 'Vaso', 0, 50);
  q(`EXEC dbo.sp_open_shift @user_id=${ana}, @opening_cash=200, @register_id=1;`);
  for (let i = 0; i < 3; i++) {
    q(`DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
       INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${A}, 2, 25);
       EXEC dbo.sp_register_sale @user_id=${ana}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);
  }
  // Identidad de nube y configuración de sincronización, como las deja la Fase 1.
  q(`DELETE FROM dbo.database_metadata WHERE clave IN ('instance_uuid','company_uuid','location_uuid','server_fingerprint','install_secret');
     INSERT INTO dbo.database_metadata (clave, valor) VALUES
       ('instance_uuid', '11111111-2222-4333-8444-555555555555'), ('company_uuid', 'aaaaaaaa-0000-4000-8000-00000000c0de'),
       ('location_uuid', 'bbbbbbbb-0000-4000-8000-0000000ce47e'), ('server_fingerprint', 'f1f2f3f4f5'),
       ('install_secret', 'secreto-de-prueba-no-real');`);
  if (!tenia52) q('EXEC dbo.sp_sync_capture;');
  const antes = huella();
  const metaAntes = JSON.stringify(q(`SELECT clave, valor FROM dbo.database_metadata ORDER BY clave`));
  const ventas = Number(uno('SELECT COUNT(*) FROM dbo.sales'));
  check(ventas === 3 && Number(uno('SELECT COUNT(*) FROM dbo.products')) >= 2, `sucursal sembrada: ${ventas} ventas, turno abierto, outbox e identidad`);

  // ------------------------------------------------------- el arranque aplica lo pendiente
  const ya = new Set(q('SELECT filename FROM dbo.schema_migrations;').map((r) => r.filename));
  const pendientes = readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en')).filter((f) => !ya.has(f));
  for (const f of pendientes) {
    for (const l of lotes(f)) q(l);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }
  check(tenia52 || pendientes.includes(M52), tenia52 ? 'el template ya traía la 0052 (solo se prueba reaplicarla)' : `migraciones aplicadas: ${pendientes.join(', ')}`);

  const despues = huella();
  const cambiadas = Object.keys(antes).filter((t) => antes[t] !== despues[t]);
  check(cambiadas.length === 0, 'ninguna tabla existente pierde ni cambia filas', cambiadas.map((t) => `${t} ${antes[t]} -> ${despues[t]}`).join('; '));
  check(JSON.stringify(q(`SELECT clave, valor FROM dbo.database_metadata ORDER BY clave`)) === metaAntes, 'identidad de nube y configuración de sincronización intactas');
  check(Number(uno(`SELECT COUNT(*) FROM dbo.products WHERE uuid IS NULL`)) === 0
        && Number(uno(`SELECT COUNT(DISTINCT uuid) FROM dbo.products`)) === Number(uno(`SELECT COUNT(*) FROM dbo.products`)),
    'cada producto existente tiene uuid único');
  check(Number(uno(`SELECT COUNT(*) FROM dbo.schema_migrations WHERE filename = N'${M52}'`)) === 1, 'schema_migrations registra la 0052 una sola vez');

  // ------------------------------------------------------- idempotente
  const h2 = huella();
  let error = null;
  try { for (const l of lotes(M52)) q(l); } catch (e) { error = e.message; }
  check(!error, 'reaplicar la 0052 completa no falla', error ?? '');
  check(JSON.stringify(huella()) === JSON.stringify(h2), 'y no cambia ningún dato');

  // ------------------------------------------------------- envíos con el esquema nuevo
  const ua = String(uno(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) FROM dbo.products WHERE id = ${A}`));
  const stock0 = Number(uno(`SELECT stock FROM dbo.products WHERE id = ${A}`));
  const ev = 'cccccccc-0000-4000-8000-0000000fe71a';
  const t = q(`EXEC dbo.sp_transfer_send @user_id=${ana}, @event_location_uuid='${ev}', @event_name=N'Feria', @lines=N'[{"product_uuid":"${ua}","qty":10}]';`)[0];
  check(Number(uno(`SELECT stock FROM dbo.products WHERE id = ${A}`)) === stock0 - 10 && t.status === 'SENT', 'enviar 10 a un evento: sale del inventario (TRANSFER_OUT)');
  const ret = 'dddddddd-0000-4000-8000-000000000ae7';
  q(`EXEC dbo.sp_transfer_receive_return @user_id=${ana}, @transfer_uuid='${ret}', @event_location_uuid='${ev}', @event_name=N'Feria',
       @lines=N'[{"product_uuid":"${ua}","qty_sent":4,"qty_received":4}]';`);
  q(`EXEC dbo.sp_transfer_receive_return @user_id=${ana}, @transfer_uuid='${ret}', @event_location_uuid='${ev}', @event_name=N'Feria', @lines=N'[]';`);
  check(Number(uno(`SELECT stock FROM dbo.products WHERE id = ${A}`)) === stock0 - 6, 'recibir el retorno de 4 suma una sola vez (idempotente)');
  q('EXEC dbo.sp_sync_capture;');
  check(Number(uno(`SELECT COUNT(*) FROM dbo.sync_outbox WHERE aggregate_type = 'TRANSFER'`)) >= 2, 'los envíos y retornos salen en el outbox para la nube');
  const pub = JSON.parse(uno('EXEC dbo.sp_catalog_publication;'));
  check(pub.products.some((p) => p.uuid === ua), 'la publicación del catálogo incluye los productos existentes con su uuid');
} catch (e) {
  fallos++;
  console.log(`\nERROR: ${e?.message || e}`);
} finally {
  try { eliminar(DB); } catch { /* noop */ }
}
console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
