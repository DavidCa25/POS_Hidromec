/**
 * FASE 1 · CORTES, OUTBOX, PIN Y CONTRASEÑAS CONTRA SQL SERVER DE VERDAD.
 *
 *     node scripts/db/pruebas/fase1-cortes-outbox.mjs [--conservar]
 *
 * Sobre una restauración del baseline + TODAS las migraciones (0051 incluida):
 *
 *   CORTES   el turno sabe caja, equipo, quién abrió y quién cerró; cerrar el
 *            turno de OTRA persona exige un encargado; ya no hay "cierra el
 *            que esté abierto" sin closure_id; el corte a ciegas queda marcado.
 *   OUTBOX   ventas, turnos y movimientos de caja se capturan como hechos con
 *            UUID; capturar dos veces no duplica; el acuse los da por enviados.
 *   PIN      se guarda con scrypt (nunca el valor), cinco fallos bloquean y la
 *            respuesta es uniforme. Lo prueba electron/seguridad/pin.js REAL.
 *   CLAVES   el SHA-256 que guardaba SQL (UTF-16) lo reconoce contrasenas.js
 *            para migrarlo sin forzar a nadie a cambiar su contraseña.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const require = createRequire(import.meta.url);
const { crearPin } = require('../../../electron/seguridad/pin.js');
const contrasenas = require('../../../electron/seguridad/contrasenas.js');

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpFase1Cortes';
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
  return r.sets.length ? r.sets[0] : [];
};
const sets = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const error = (sql) => { const r = consultarTemporal(DB, sql); return r.ok ? null : limpiar(r.error); };

/* El pool de mssql que espera pin.js, sobre la misma base temporal. Los
   parámetros se declaran como variables T-SQL (mismo tipo que el driver). */
const sqlTipos = { Int: 'INT', VarChar: (n) => `VARCHAR(${n})` };
const fecha = (v) => (typeof v === 'string' && /^\/Date\((-?\d+)\)\/$/.test(v) ? new Date(Number(v.match(/-?\d+/)[0])) : v);
const poolFalso = {
  request() {
    const ps = [];
    return {
      input(n, t, v) { ps.push({ n, t, v }); return this; },
      async query(texto) {
        const dec = ps.map(p => `DECLARE @${p.n} ${p.t} = ${p.v == null ? 'NULL' : typeof p.v === 'number' ? p.v : `'${String(p.v).replace(/'/g, "''")}'`};`).join('\n');
        const filas = q(`${dec}\n${texto}`).map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fecha(v)])));
        return { recordset: filas };
      },
    };
  },
};

try {
  console.log(`\nFASE 1 · CORTES, OUTBOX, PIN   (${DB})`);
  if (!existsSync(BAK)) { console.log(`   ----   falta ${BAK} (npm run db:baseline).`); process.exit(0); }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG).filter(n => n.toLowerCase().endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en')).filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES
      (N'ana',   CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'Ana#2026'), 2), N'cajero', 1, GETDATE()),
      (N'beto',  CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'Beto#2026'), 2), N'cajero', 1, GETDATE()),
      (N'marta', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'Marta#2026'), 2), N'supervisor', 1, GETDATE()),
      (N'baja',  CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'Baja#2026'), 2), N'supervisor', 0, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'General');`);
  const id = (u) => Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'${u}';`));
  const [ana, beto, marta, baja] = ['ana', 'beto', 'marta', 'baja'].map(id);
  const prod = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${escalar('SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC')}, @part_number=N'QA-F1', @name=N'Dona',
      @price=50, @stock=100, @category=${escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'General'`)}, @cost=20;`));
  const abrir = (u) => Number(uno(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=500, @register_id=1, @machine_id=N'PC-CENTRO-1', @machine_name=N'CAJA-CENTRO-1';`)?.closure_id);
  const vender = (u) => q(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${prod}, 1, 50);
    EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`);

  // ================================================================ CORTES
  seccion('Cortes: quién abre, quién cierra, con qué caja y qué equipo');
  const t1 = abrir(ana);
  vender(ana);
  const c1 = uno(`SELECT opened_by_user_id = userId, opening_user_id, register_id, opened_machine_name, uuid FROM dbo.cash_closures WHERE id = ${t1};`);
  check(c1 && Number(c1.opened_by_user_id) === ana && Number(c1.register_id) === 1 && c1.opened_machine_name === 'CAJA-CENTRO-1' && !!c1.uuid,
    'el turno sabe quién lo abrió, en qué caja y desde qué equipo, y tiene UUID');
  check((error(`EXEC dbo.sp_close_shift @closure_id=NULL, @user_id=${ana}, @cash_delivered=0, @register_id=1;`) || '').includes('Indica el turno'),
    'sin closure_id ya no se cierra "el que esté abierto"');
  const e1 = error(`EXEC dbo.sp_close_shift @closure_id=${t1}, @user_id=${beto}, @cash_delivered=550, @register_id=1;`);
  check((e1 || '').includes('REQUIERE_AUTORIZACION') && escalar(`SELECT closed_at FROM dbo.cash_closures WHERE id = ${t1}`) == null,
    'el cajero B NO puede cerrar el turno de A sin autorización');
  const e2 = error(`EXEC dbo.sp_close_shift @closure_id=${t1}, @user_id=${beto}, @authorized_by=${beto}, @cash_delivered=550, @register_id=1;`);
  check((e2 || '').includes('REQUIERE_AUTORIZACION'), 'ni "autorizándose" a sí mismo siendo cajero');
  const e3 = error(`EXEC dbo.sp_close_shift @closure_id=${t1}, @user_id=${beto}, @authorized_by=${baja}, @cash_delivered=550, @register_id=1;`);
  check((e3 || '').includes('REQUIERE_AUTORIZACION'), 'ni con un encargado dado de baja');
  const e4 = error(`EXEC dbo.sp_close_shift @closure_id=${t1}, @user_id=${beto}, @authorized_by=${marta}, @cash_delivered=540, @register_id=1,
       @blind_count=1, @machine_id=N'PC-CENTRO-2', @machine_name=N'CAJA-CENTRO-2';`);
  check((e4 || '').includes('Dos equipos no pueden operar la misma caja'), 'ni desde OTRO equipo: la caja tiene arriendo');
  q(`EXEC dbo.sp_close_shift @closure_id=${t1}, @user_id=${beto}, @authorized_by=${marta}, @cash_delivered=540, @register_id=1,
       @blind_count=1, @machine_id=N'PC-CENTRO-1', @machine_name=N'CAJA-CENTRO-1';`);
  const c2 = uno(`SELECT closed_by_user_id, close_authorized_by, closed_machine_name, blind_count, difference FROM dbo.cash_closures WHERE id = ${t1};`);
  check(Number(c2.closed_by_user_id) === beto && Number(c2.close_authorized_by) === marta,
    'con la encargada: queda quién cerró (B) y quién autorizó (encargada)');
  check(c2.closed_machine_name === 'CAJA-CENTRO-1' && (c2.blind_count === true || Number(c2.blind_count) === 1),
    'y desde qué equipo, marcado como corte a ciegas');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.security_events WHERE event_type = N'SHIFT_CLOSED_BY_OTHER' AND user_id = ${beto} AND authorized_by = ${marta};`)) === 1,
    'cerrar el turno de otra persona deja rastro en la bitácora');
  const t2 = abrir(ana);
  q(`EXEC dbo.sp_close_shift @closure_id=${t2}, @user_id=${ana}, @authorized_by=${marta}, @cash_delivered=500, @register_id=1;`);
  const c3 = uno(`SELECT closed_by_user_id, close_authorized_by FROM dbo.cash_closures WHERE id = ${t2};`);
  check(Number(c3.closed_by_user_id) === ana && c3.close_authorized_by == null,
    'cerrar el PROPIO turno no necesita autorizador (y no se registra uno inventado)');

  // ================================================================ OUTBOX
  seccion('Outbox: hechos con UUID, idempotentes');
  abrir(ana);  // turno abierto: un retiro de efectivo necesita turno
  q(`EXEC dbo.sp_register_cash_out @user_id=${ana}, @amount=20, @note=N'cambio', @register_id=1, @machine_id=N'PC-CENTRO-1', @machine_name=N'CAJA-CENTRO-1';`);
  const cap1 = uno('EXEC dbo.sp_sync_capture;');
  const tipos = q(`SELECT aggregate_type, COUNT(*) n FROM dbo.sync_outbox GROUP BY aggregate_type;`);
  const n = (t) => Number(tipos.find(x => x.aggregate_type === t)?.n ?? 0);
  check(n('SALE') === 1 && n('SHIFT') === 3 && n('CASH_MOVEMENT') >= 1, 'se capturan ventas, turnos y movimientos de caja', JSON.stringify(tipos));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.sync_outbox o JOIN dbo.cash_movements m ON m.uuid = o.aggregate_uuid WHERE m.typee = 'SALE'`)) === 0,
    'el movimiento de caja de una venta no se duplica (la venta ya es el hecho)');
  const total0 = Number(escalar('SELECT COUNT(*) FROM dbo.sync_outbox;'));
  const cap2 = uno('EXEC dbo.sp_sync_capture;');
  check(Number(cap2.capturados) === 0 && Number(escalar('SELECT COUNT(*) FROM dbo.sync_outbox;')) === total0,
    'capturar otra vez sin cambios no agrega nada', `primera: ${cap1.capturados}`);
  const turno = JSON.parse(escalar(`SELECT payload FROM dbo.sync_outbox WHERE aggregate_type = 'SHIFT' AND event_type = 'SHIFT_CLOSED' AND aggregate_uuid = (SELECT uuid FROM dbo.cash_closures WHERE id = ${t1});`));
  check(turno.status === 'CLOSED' && turno.closed_by?.name === 'beto' && turno.authorized_by?.name === 'marta' && !!turno.register?.uuid && turno.blind_count === true,
    'el hecho del corte lleva caja, quién cerró, quién autorizó y si fue a ciegas');
  check(!JSON.stringify(turno).includes('password') && !JSON.stringify(turno).toLowerCase().includes('pin'), 'y ningún dato de contraseña o PIN');
  q(`UPDATE dbo.sales SET total = total WHERE id = (SELECT MAX(id) FROM dbo.sales);`);
  q('EXEC dbo.sp_sync_capture;');
  const vs = q(`SELECT event_type, aggregate_version FROM dbo.sync_outbox WHERE aggregate_type = 'SALE' ORDER BY id;`);
  check(vs.length === 2 && vs[1].event_type === 'SALE_UPDATED' && Number(vs[1].aggregate_version) > Number(vs[0].aggregate_version),
    'editar una venta produce SALE_UPDATED con versión mayor (no pisa saldos: la nube aplica la mayor)');
  const lote = sets('EXEC dbo.sp_sync_outbox_next @max_rows = 100;');
  check(lote[0].length === Number(escalar(`SELECT COUNT(*) FROM dbo.sync_outbox WHERE status = 'PENDING'`)) && !!lote[1][0].instance_uuid,
    'el lote sale en orden y con la identidad de la base (instance_uuid)');
  const [a, b, c] = lote[0];
  q(`EXEC dbo.sp_sync_outbox_ack @acuses = N'${JSON.stringify([
    { event_uuid: a.event_uuid, result: 'APPLIED' }, { event_uuid: b.event_uuid, result: 'DUPLICATE' }, { event_uuid: c.event_uuid, result: 'ERROR', error: 'red' }])}';`);
  const est = (u) => uno(`SELECT status, attempts FROM dbo.sync_outbox WHERE event_uuid = '${u}';`);
  check(est(a.event_uuid).status === 'SENT' && est(b.event_uuid).status === 'SENT', 'APPLIED y DUPLICATE cuentan como enviados');
  check(est(c.event_uuid).status === 'PENDING' && Number(est(c.event_uuid).attempts) === 1, 'un ERROR se queda pendiente para reintentar');
  q(`EXEC dbo.sp_sync_outbox_ack @acuses = N'${JSON.stringify([{ event_uuid: a.event_uuid, result: 'REJECTED' }])}';`);
  check(est(a.event_uuid).status === 'SENT', 'un acuse repetido o tardío no cambia lo ya enviado');

  // ================================================================ PIN
  seccion('PIN personal (electron/seguridad/pin.js sobre esta base)');
  const pin = crearPin({ sql: sqlTipos, pool: async () => poolFalso });
  check(!(await pin.fijar(marta, '12a4', ana)).ok && !(await pin.fijar(marta, '12', ana)).ok, 'un PIN que no son 4-8 dígitos se rechaza');
  check((await pin.fijar(marta, '4821', ana)).ok && await pin.tienePin(marta), 'se fija el PIN de la encargada');
  const fila = uno(`SELECT pin_hash, pin_sal FROM dbo.trabajadores_acceso WHERE user_id = ${marta};`);
  check(fila.pin_hash && !fila.pin_hash.includes('4821') && fila.pin_hash !== '4821' && !!fila.pin_sal, 'en la base solo hay hash + sal (scrypt), nunca el PIN');
  check((await pin.verificar(marta, '4821')).ok, 'el PIN correcto autoriza');
  const r1 = await pin.verificar(marta, '0000');
  const r2 = await pin.verificar(9999, '4821');
  check(!r1.ok && r1.error === r2.error, 'PIN equivocado y usuario inexistente responden igual', r1.error);
  for (let i = 0; i < 4; i++) await pin.verificar(marta, '1111');
  const bloqueo = await pin.verificar(marta, '4821');
  check(!bloqueo.ok && bloqueo.bloqueado, 'tras cinco intentos fallidos se bloquea, incluso con el PIN correcto');
  await pin.fijar(baja, '7777', marta);
  check(!(await pin.verificar(baja, '7777')).ok, 'un usuario dado de baja no autoriza aunque su PIN sea correcto');

  // ================================================================ CLAVES
  seccion('Contraseñas: lo que guardaba SQL se reconoce y se migra');
  const hashSql = escalar(`SELECT password_hash FROM dbo.users WHERE id = ${ana};`);
  const v = contrasenas.verificar('Ana#2026', hashSql);
  check(v.ok && v.rehash, 'el SHA-256 de SQL (HASHBYTES sobre NVARCHAR) lo valida contrasenas.js y pide migrarlo');
  check(!contrasenas.verificar('ana#2026', hashSql).ok, 'y distingue mayúsculas: una contraseña parecida no entra');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}
console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
