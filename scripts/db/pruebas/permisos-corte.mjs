/**
 * Permisos por persona y lo que se queda en caja (0056); cierre del dia (0057).
 *
 *     node scripts/db/pruebas/permisos-corte.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. Lo que se queda en caja: no negativo, no mas de lo entregado; se guarda
 *      con las notas del cierre y sale en el comprobante del corte.
 *   2. Cerrar el turno de OTRA persona: sin autorizador no; con un Operador
 *      sin permiso tampoco; con un Operador al que se le dio CAJA_CORTES, si.
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
const DB = 'Wybix_TmpPermisos';
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
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};

try {
  console.log(`\nPERMISOS POR PERSONA Y CORTE   (${DB})`);

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

  const alta = (usuario, rol) => {
    q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
       VALUES (N'${usuario}', N'x', N'${rol}', 1, GETDATE());`);
    return Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'${usuario}';`));
  };
  const ana = alta('qa_ana', 'cajero');
  const migue = alta('qa_migue', 'cajero');
  const luis = alta('qa_luis', 'cajero');

  const abrir = (userId, fondo) => Number(uno(`
    EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=${fondo}, @register_id=1;`)?.closure_id);
  const cerrar = (id, userId, extra = '') => `
    EXEC dbo.sp_close_shift @closure_id=${id}, @user_id=${userId}, @register_id=1${extra};`;

  // =============================================================== 1
  seccion('1. Lo que se queda en caja');
  const t1 = abrir(ana, 500);
  check(t1 > 0, `turno de Ana abierto (#${t1})`);
  let r = falla(cerrar(t1, ana, ', @cash_delivered=500, @cash_left=600'));
  check(r.ok, 'no puede quedarse mas de lo que se entrego', r.error?.slice(0, 80));
  r = falla(cerrar(t1, ana, ', @cash_delivered=500, @cash_left=-1'));
  check(r.ok, 'ni una cantidad negativa', r.error?.slice(0, 80));
  const fila = uno(cerrar(t1, ana, ", @cash_delivered=500, @cash_left=200, @closing_note=N'  Billete de 500 roto  '"));
  check(Number(fila?.cash_left) === 200, 'el cierre devuelve lo que se queda', String(fila?.cash_left));
  const guardado = uno(`SELECT cash_left, closing_note FROM dbo.cash_closures WHERE id = ${t1};`);
  check(Number(guardado.cash_left) === 200 && guardado.closing_note === 'Billete de 500 roto',
    'se guarda con la nota (sin espacios de sobra)', JSON.stringify(guardado));
  const doc = JSON.parse(escalar(`EXEC dbo.sp_cash_closure_ticket @closure_id=${t1};`));
  check(Number(doc.cash_left) === 200 && doc.closing_note === 'Billete de 500 roto',
    'y sale en el comprobante del corte');
  const t1b = abrir(ana, 100);
  uno(cerrar(t1b, ana, ', @cash_delivered=100'));
  check(escalar(`SELECT cash_left FROM dbo.cash_closures WHERE id = ${t1b};`) == null,
    'sin capturarlo, queda vacio (cierres de antes de la 0056)');

  // =============================================================== 2
  seccion('2. Cerrar el turno de otra persona');
  const t2 = abrir(ana, 300);
  r = falla(cerrar(t2, migue, ', @cash_delivered=300'), 'REQUIERE_AUTORIZACION');
  check(r.ok, 'un Operador sin autorizador no puede', r.error?.slice(0, 60));
  // 0059: un rol que no trae CAJA_CORTES (aqui, uno desconocido) no autoriza.
  q(`UPDATE dbo.users SET rol = N'invitado' WHERE id = ${luis};`);
  r = falla(cerrar(t2, migue, `, @cash_delivered=300, @authorized_by=${luis}`), 'REQUIERE_AUTORIZACION');
  check(r.ok, 'ni autorizado por alguien sin CAJA_CORTES', r.error?.slice(0, 60));
  q(`UPDATE dbo.users SET rol = N'cajero' WHERE id = ${luis};`);

  // Roles v2: el Operador (cajero) ya trae CAJA_CORTES por su rol.
  const fin = uno(cerrar(t2, migue, `, @cash_delivered=300, @cash_left=150, @authorized_by=${migue}`));
  check(fin && escalar(`SELECT CASE WHEN closed_at IS NULL THEN 0 ELSE 1 END FROM dbo.cash_closures WHERE id = ${t2};`) === 1,
    'un Operador (CAJA_CORTES por su rol) cierra el turno de Ana');
  const quien = uno(`SELECT closed_by_user_id, close_authorized_by FROM dbo.cash_closures WHERE id = ${t2};`);
  check(Number(quien.closed_by_user_id) === migue && Number(quien.close_authorized_by) === migue,
    'y queda dicho quien cerro y quien autorizo', JSON.stringify(quien));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.security_events WHERE event_type = N'SHIFT_CLOSED_BY_OTHER';`)) === 1,
    'el cierre ajeno deja su evento de seguridad');

  q(`UPDATE dbo.users SET active = 0 WHERE id = ${migue};`);
  const t3 = abrir(ana, 50);
  r = falla(cerrar(t3, luis, `, @cash_delivered=50, @authorized_by=${migue}`), 'REQUIERE_AUTORIZACION');
  check(r.ok, 'desactivado, su permiso ya no autoriza', r.error?.slice(0, 60));

  // =============================================================== 3
  seccion('3. La tabla');
  r = falla(`INSERT INTO dbo.user_permissions (user_id, permiso) VALUES (999999, 'CAJA_CORTES');`);
  check(r.ok, 'no acepta permisos de un usuario que no existe');
  q(`INSERT INTO dbo.user_permissions (user_id, permiso, granted_by) VALUES (${migue}, 'CAJA_CORTES', NULL);`);
  r = falla(`INSERT INTO dbo.user_permissions (user_id, permiso) VALUES (${migue}, 'CAJA_CORTES');`);
  check(r.ok, 'ni el mismo permiso dos veces');

  // =============================================================== 4
  seccion('4. Cierre del día (0057)');
  q(`INSERT INTO dbo.security_events (datee, user_id, authorized_by, event_type, amount, detail)
     VALUES (SYSDATETIME(), ${ana}, ${migue}, N'CASH_OUT_AUTHORIZED', 300, N'prueba');`);
  const rc = consultarTemporal(DB, 'EXEC dbo.sp_day_close_report;');
  check(rc.ok && rc.sets.length === 7, 'devuelve los siete resultados', rc.ok ? String(rc.sets.length) : limpiar(rc.error));
  if (rc.ok) {
    const [res, , cortes, , , eventos] = rc.sets;
    check(res?.[0] && Number(res[0].tickets) === 0, 'resumen del día sin ventas', JSON.stringify(res?.[0]));
    check(cortes.length >= 3 && cortes.some(c => Number(c.cash_left) === 200 && c.closing_note === 'Billete de 500 roto'),
      'trae los cortes del día con lo que se quedó y la nota', String(cortes.length));
    check(cortes.some(c => c.cerro === 'qa_migue' && c.autorizo === 'qa_migue'), 'dice quién cerró y quién autorizó');
    check(eventos.some(e => e.event_type === 'CASH_OUT_AUTHORIZED' && e.autorizo === 'qa_migue'), 'y las autorizaciones del día con las dos identidades');
  }
  const ayer = consultarTemporal(DB, "EXEC dbo.sp_day_close_report @fecha = '2000-01-01';");
  check(ayer.ok && ayer.sets[2].length === 0, 'un día sin actividad sale vacío');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
