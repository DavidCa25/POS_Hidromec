/**
 * Corte de caja por correo (0061).
 *
 *     node scripts/db/pruebas/corte-correo.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. La bandera: un corte ENVIADO no se reserva otra vez; uno en curso
 *      (ENVIANDO, menos de 2 min) tampoco; uno con ERROR si.
 *   2. Un turno abierto no tiene correo.
 *   3. La lista: los cortes anteriores salen SIN_ENVIAR y "solo pendientes"
 *      nunca trae un ENVIADO.
 *   4. Los datos del correo: encabezado, productos, devoluciones y bitacora.
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
const DB = 'Wybix_TmpCorteCorreo';
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
  console.log(`\nCORTE DE CAJA POR CORREO   (${DB})`);

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

  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
     VALUES (N'qa_ana', N'x', N'cajero', 1, GETDATE());`);
  const ana = Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_ana';`));
  const abrir = (fondo) => Number(uno(`EXEC dbo.sp_open_shift @user_id=${ana}, @opening_cash=${fondo}, @register_id=1;`)?.closure_id);
  const cerrar = (id, entregado) => uno(`EXEC dbo.sp_close_shift @closure_id=${id}, @user_id=${ana}, @register_id=1, @cash_delivered=${entregado};`);
  const job = (id, accion, extra = '') => uno(`EXEC dbo.sp_cash_closure_email_job @closure_id=${id}, @accion='${accion}'${extra};`);

  // =============================================================== 1
  seccion('1. La bandera');
  const viejo = abrir(100); cerrar(viejo, 100);       // un corte "de antes": sin renglón
  const t1 = abrir(200); cerrar(t1, 150);
  let j = job(t1, 'RESERVAR', `, @user_id=${ana}`);
  check(j.resultado === 'RESERVADO' && j.status === 'ENVIANDO' && Number(j.attempts) === 1, 'el primer envío se reserva', JSON.stringify(j));
  j = job(t1, 'RESERVAR');
  check(j.resultado === 'OCUPADO', 'otro envío simultáneo del mismo corte no se duplica', j.resultado);
  job(t1, 'ERROR', ", @error=N'sin internet'");
  j = job(t1, 'RESERVAR');
  check(j.resultado === 'RESERVADO' && Number(j.attempts) === 2, 'tras un error se puede reintentar', JSON.stringify(j));
  j = job(t1, 'ENVIADO', ', @recipients=2');
  check(j.status === 'ENVIADO' && j.sent_at && Number(j.recipients) === 2 && j.last_error == null, 'confirmado: queda ENVIADO con sus destinatarios');
  j = job(t1, 'RESERVAR');
  check(j.resultado === 'YA_ENVIADO' && Number(j.attempts) === 2, 'un corte ENVIADO no se vuelve a reservar', JSON.stringify(j));
  job(t1, 'ERROR', ", @error=N'tarde'");
  check(escalar(`SELECT status FROM dbo.cash_closure_email_jobs WHERE closure_id=${t1};`) === 'ENVIADO', 'un error tardío no borra la bandera');
  const idAntes = escalar(`SELECT CONVERT(VARCHAR(36), id) FROM dbo.cash_closure_email_jobs WHERE closure_id=${t1};`);
  job(t1, 'RESERVAR');
  check(escalar(`SELECT CONVERT(VARCHAR(36), id) FROM dbo.cash_closure_email_jobs WHERE closure_id=${t1};`) === idAntes, 'la llave de idempotencia no cambia');

  // =============================================================== 2
  seccion('2. Un turno abierto');
  const abierto = abrir(50);
  let r = falla(`EXEC dbo.sp_cash_closure_email_job @closure_id=${abierto}, @accion='RESERVAR';`, 'sigue abierto');
  check(r.ok, 'no tiene correo hasta que se cierra', r.error?.slice(0, 60));
  r = falla(`EXEC dbo.sp_cash_closure_email_job @closure_id=${t1}, @accion='BORRAR';`, 'no valida');
  check(r.ok, 'una acción desconocida se rechaza');
  cerrar(abierto, 50);

  // =============================================================== 3
  seccion('3. La lista');
  const todos = q(`EXEC dbo.sp_cash_closure_email_list;`);
  check(todos.find(c => c.id === viejo)?.email_status === 'SIN_ENVIAR', 'un corte anterior sale SIN_ENVIAR');
  check(todos.find(c => c.id === t1)?.email_status === 'ENVIADO', 'el enviado sale ENVIADO');
  const pend = q(`EXEC dbo.sp_cash_closure_email_list @solo_pendientes=1;`);
  check(pend.length >= 2 && !pend.some(c => c.email_status === 'ENVIADO'), 'solo pendientes nunca trae un ENVIADO', String(pend.length));
  check(pend[0].id === viejo, 'y empieza por el más viejo', String(pend[0]?.id));
  check(q(`EXEC dbo.sp_cash_closure_email_list @desde='2000-01-01', @hasta='2000-01-02';`).length === 0, 'fuera del periodo no hay nada');

  // =============================================================== 4
  seccion('4. Los datos del correo');
  q(`INSERT INTO dbo.security_events (datee, user_id, register_id, event_type, amount, detail)
     VALUES (SYSDATETIME(), ${ana}, 1, N'DRAWER_NO_SALE', NULL, N'prueba');`);
  const t4 = abrir(100);
  q(`INSERT INTO dbo.security_events (datee, user_id, register_id, event_type, amount, detail)
     VALUES (SYSDATETIME(), ${ana}, 1, N'DRAWER_NO_SALE', NULL, N'prueba');`);
  cerrar(t4, 100);
  const d = consultarTemporal(DB, `EXEC dbo.sp_cash_closure_email_data @closure_id=${t4};`);
  check(d.ok && d.sets.length === 5, 'devuelve los cinco resultados', d.ok ? String(d.sets.length) : limpiar(d.error));
  if (d.ok) {
    const [cab, prods, tot, devs, bit] = d.sets;
    check(cab[0]?.opened_by === 'qa_ana' && cab[0]?.closed_by === 'qa_ana' && cab[0]?.uuid, 'encabezado con quién abrió y cerró', JSON.stringify(cab[0]));
    check(prods.length === 0 && Number(tot[0].piezas) === 0 && devs.length === 0, 'turno sin ventas: sin productos ni devoluciones');
    check(bit.some(b => b.event_type === 'DRAWER_NO_SALE' && Number(b.veces) >= 1), 'la bitácora del turno', JSON.stringify(bit));
  }
  r = falla(`EXEC dbo.sp_cash_closure_email_data @closure_id=999999;`, 'no existe');
  check(r.ok, 'un corte que no existe se rechaza');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
