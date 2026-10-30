/**
 * Asistencia (0071).
 *
 *     node scripts/db/pruebas/asistencia.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   · que sin activar no se marca nada, y que activar guarda las reglas Y
 *     enciende el modulo en una sola operacion;
 *   · el horario: validaciones, reemplazo completo y turno que cruza la
 *     medianoche;
 *   · la secuencia de marcas (entrada, descanso, salida) y sus rechazos, y
 *     que el olvido de salida deja la jornada en "Revisar" sin adivinar;
 *   · el calculo, con jornadas de una semana conocida: horas trabajadas con y
 *     sin descanso pagado, extra SOLO por la hora de salida y con tolerancia,
 *     retardos, dia de descanso, persona sin horario y turno nocturno; y que
 *     cada regla, al cambiarla, cambia justo lo suyo;
 *   · corregir: motivo, nadie corrige lo suyo, sin encimar, sin futuro, y
 *     que queda la huella de lo que habia antes.
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
const DB = 'Wybix_TmpAsistencia';
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
  if (r.ok) return { ok: false, error: '(no fallo)' };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};
const json = (v) => JSON.stringify(v).replace(/'/g, "''");
/* Las fechas llegan como /Date(ms)/ desde PowerShell (medianoche y horas
   locales). Se convierten una vez, a como se leen: YYYY-MM-DD y HH:MM. */
const fecha = (v) => {
  if (v == null) return null;
  const m = /^\/Date\((-?\d+)\)\/$/.exec(String(v));
  return m ? new Date(Number(m[1])) : new Date(String(v));
};
const p2 = (n) => String(n).padStart(2, '0');
const dia = (v) => { const d = fecha(v); return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : ''; };
const hhmm = (v) => { const d = fecha(v); return d ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : ''; };
const reglas = (r, activar = 0, user = 'NULL') => `EXEC dbo.sp_asistencia_reglas_guardar
  @cuenta_extra=${r.extra ?? 1}, @tolerancia=${r.tol ?? 1}, @descanso_pagado=${r.pagado ?? 0},
  @dia_libre_extra=${r.libre ?? 1}, @marca_retardos=${r.retardos ?? 1}, @entrada_para_vender=${r.vender ?? 0},
  @activar=${activar}, @user_id=${user};`;
const jornada = (u, entrada, salida, estado = 'CERRADA') => escalar(`
  INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, salida_en, estado)
  VALUES (${u}, CAST('${entrada}' AS DATE), '${entrada}', ${salida ? `'${salida}'` : 'NULL'}, '${estado}');
  SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`);
const resumen = (u) => {
  const filas = q(`EXEC dbo.sp_asistencia_resumen @desde='2026-10-05', @hasta='2026-10-11', @persona_id=${u};`);
  return new Map(filas.map(f => [dia(f.dia), f]));
};

try {
  console.log(`\nASISTENCIA   (${DB})`);
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

  const alta = (u, rol) => escalar(`INSERT INTO dbo.users (usuario, password_hash, rol, active)
    VALUES (N'${u}', N'x', N'${rol}', 1); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`);
  const ANA = alta('ana.asis', 'cajero');
  const LUIS = alta('luis.asis', 'cajero');
  const SIN = alta('sin.horario', 'cajero');
  const ENC = alta('encargado.asis', 'supervisor');
  const OLVI = alta('olvidadiza', 'cajero');

  // ================================================================
  seccion('1. Sin activar no se marca nada');
  check(q('EXEC dbo.sp_asistencia_reglas_get;').length === 0, 'una base sin la aplicacion no tiene reglas');
  let f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${ANA}, @tipo='ENTRADA';`, 'activada');
  check(f.ok, 'marcar sin activar se rechaza', f.error);
  f = falla(reglas({}, 0), 'activada');
  check(f.ok, 'cambiar reglas sin activar se rechaza', f.error);
  f = falla(`EXEC dbo.sp_asistencia_reglas_guardar @cuenta_extra=1, @tolerancia=NULL, @descanso_pagado=0,
    @dia_libre_extra=1, @marca_retardos=1, @entrada_para_vender=0, @activar=1;`, 'Contesta');
  check(f.ok, 'una pregunta sin contestar no activa', f.error);
  check(!escalar(`SELECT COUNT(*) FROM dbo.business_modules WHERE module_key = N'asistencia' AND enabled = 1;`),
    'y el modulo sigue apagado');

  const r = uno(reglas({}, 1, ENC));
  check(r && r.activa === true && Number(r.tolerancia_min) === 10 && r.cuenta_extra === true,
    'activar guarda las reglas y enciende el modulo en una sola llamada', JSON.stringify(r));
  check(Number(escalar(`SELECT enabled_by FROM dbo.business_modules WHERE module_key = N'asistencia';`)) === ENC,
    'queda dicho quien lo activo');

  // ================================================================
  seccion('2. Horario');
  const semana = [1, 2, 3, 4, 5].map(w => ({ weekday: w, entrada: '08:00', salida: '16:00', descanso_min: 30 }));
  q(`EXEC dbo.sp_asistencia_horario_guardar @persona_id=${ANA}, @dias=N'${json(semana)}', @user_id=${ENC};`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.asistencia_horarios WHERE user_id=${ANA};`)) === 5, 'lunes a viernes 08:00-16:00');
  q(`EXEC dbo.sp_asistencia_horario_guardar @persona_id=${ANA}, @dias=N'${json(semana)}', @user_id=${ENC};`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.asistencia_horarios WHERE user_id=${ANA};`)) === 5, 'guardar otra vez reemplaza, no duplica');
  const h = q(`EXEC dbo.sp_asistencia_horario_get @persona_id=${ANA};`);
  check(h[0]?.entrada === '08:00' && h[0]?.salida === '16:00', 'las horas salen como texto HH:mm', JSON.stringify(h[0]));
  for (const [dias, frag, titulo] of [
    [[{ weekday: 1, entrada: '08:00', salida: '08:00' }], 'misma hora', 'entrada igual a salida'],
    [[{ weekday: 8, entrada: '08:00', salida: '16:00' }], 'de la semana', 'dia 8'],
    [[{ weekday: 1, entrada: '08:00', salida: '16:00' }, { weekday: 1, entrada: '09:00', salida: '17:00' }], 'dos veces', 'un dia repetido'],
    [[{ weekday: 1, entrada: 'xx:yy', salida: '16:00' }], 'hora de entrada', 'una hora que no es hora'],
    [[{ weekday: 1, entrada: '08:00', salida: '16:00', descanso_min: 300 }], 'descanso', 'descanso de 5 horas'],
  ]) {
    f = falla(`EXEC dbo.sp_asistencia_horario_guardar @persona_id=${ANA}, @dias=N'${json(dias)}';`, frag);
    check(f.ok, `rechaza ${titulo}`, f.error);
  }
  f = falla(`EXEC dbo.sp_asistencia_horario_guardar @persona_id=${ANA}, @dias=N'no es json';`, 'horario no es');
  check(f.ok, 'rechaza un horario que no es JSON', f.error);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.asistencia_horarios WHERE user_id=${ANA};`)) === 5, 'un horario rechazado no borra el que habia');
  q(`EXEC dbo.sp_asistencia_horario_guardar @persona_id=${LUIS}, @dias=N'${json([{ weekday: 1, entrada: '22:00', salida: '06:00', descanso_min: 0 }])}';`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.asistencia_horarios WHERE user_id=${LUIS};`)) === 1, 'un turno de 22:00 a 06:00 es valido');

  // ================================================================
  seccion('3. Marcas: solo lo que toca');
  const marcar = (u, tipo) => uno(`EXEC dbo.sp_asistencia_marcar @user_id=${u}, @tipo='${tipo}', @register_id=1;`);
  let e = uno(`EXEC dbo.sp_asistencia_estado @user_id=${SIN};`);
  check(e.puede_entrada === true && e.puede_salida === false && e.jornada_id == null, 'sin entrada solo se ofrece la entrada');
  f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${SIN}, @tipo='SALIDA';`, 'No tienes una entrada');
  check(f.ok, 'no hay salida sin entrada', f.error);
  f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${SIN}, @tipo='INICIO_DESCANSO';`, 'Primero registra');
  check(f.ok, 'no hay descanso sin entrada', f.error);
  e = marcar(SIN, 'ENTRADA');
  check(e.jornada_id && e.puede_entrada === false && e.puede_descanso === true && e.puede_salida === true,
    'tras la entrada: descanso o salida');
  f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${SIN}, @tipo='ENTRADA';`, 'Ya registraste');
  check(f.ok, 'dos entradas el mismo dia se rechazan', f.error);
  f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${SIN}, @tipo='FIN_DESCANSO';`, 'en descanso');
  check(f.ok, 'no se termina un descanso que no empezo', f.error);
  e = marcar(SIN, 'INICIO_DESCANSO');
  check(e.en_descanso === true && e.puede_fin_descanso === true && e.puede_salida === false, 'en descanso solo se ofrece volver');
  f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${SIN}, @tipo='INICIO_DESCANSO';`, 'Ya est');
  check(f.ok, 'dos descansos a la vez se rechazan', f.error);
  e = marcar(SIN, 'SALIDA');
  check(e.puede_entrada === true && e.jornada_id == null, 'salir en pleno descanso cierra la jornada');
  check(!escalar(`SELECT COUNT(*) FROM dbo.asistencia_descansos d JOIN dbo.asistencia_jornadas j ON j.id = d.jornada_id
    WHERE j.user_id = ${SIN} AND d.fin_en IS NULL;`), 'y cierra el descanso a la misma hora');
  f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${SIN}, @tipo='SIESTA';`, 'Marca no');
  check(f.ok, 'una marca inventada se rechaza', f.error);
  f = falla(`INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, estado) VALUES (${SIN}, '2026-10-01', '2026-10-01T08:00:00', 'ABIERTA');
             INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, estado) VALUES (${SIN}, '2026-10-02', '2026-10-02T08:00:00', 'ABIERTA');`, 'UX_asistencia_jornadas_abierta');
  check(f.ok, 'la base no admite dos jornadas abiertas de la misma persona', f.error);
  q(`DELETE FROM dbo.asistencia_jornadas WHERE user_id = ${SIN} AND dia IN ('2026-10-01', '2026-10-02');`);

  const vieja = jornada(OLVI, '2026-10-01T08:00:00', null, 'ABIERTA');
  e = marcar(OLVI, 'ENTRADA');
  check(escalar(`SELECT estado FROM dbo.asistencia_jornadas WHERE id = ${vieja};`) === 'SIN_SALIDA' && e.jornada_id && e.jornada_id !== vieja,
    'olvido la salida de otro dia: esa queda SIN_SALIDA y empieza la de hoy');
  check(escalar(`SELECT salida_en FROM dbo.asistencia_jornadas WHERE id = ${vieja};`) == null, 'y no se adivina a que hora salio');

  // ================================================================
  seccion('4. El calculo, con una semana conocida (5 al 11 de octubre)');
  /* Ana, L-V 08:00-16:00, descanso de 30 min. */
  const lun = jornada(ANA, '2026-10-05T07:58:00', '2026-10-05T16:42:00');
  q(`INSERT INTO dbo.asistencia_descansos (jornada_id, inicio_en, fin_en) VALUES (${lun}, '2026-10-05T12:00:00', '2026-10-05T12:30:00');`);
  jornada(ANA, '2026-10-06T08:12:00', '2026-10-06T16:08:00');
  const jue = jornada(ANA, '2026-10-08T08:00:00', null, 'SIN_SALIDA');
  jornada(ANA, '2026-10-10T10:00:00', '2026-10-10T13:00:00');
  /* Luis, lunes 22:00-06:00: sale el martes. */
  jornada(LUIS, '2026-10-05T22:00:00', '2026-10-06T06:30:00');
  /* Sin horario. */
  jornada(SIN, '2026-10-05T08:00:00', '2026-10-05T19:00:00');

  let a = resumen(ANA);
  let x = a.get('2026-10-05');
  check(Number(x.trabajado_min) === 494, 'lunes: 07:58 a 16:42 menos 30 de descanso = 8:14', `${x.trabajado_min} min`);
  check(Number(x.extra_min) === 42, 'salio 16:42 con salida a las 16:00: 42 min de extra', `${x.extra_min}`);
  check(Number(x.retardo_min) === 0, 'llegar antes no es retardo ni extra');
  x = a.get('2026-10-06');
  check(Number(x.retardo_min) === 12 && Number(x.extra_min) === 0, 'martes: 12 de retardo; salir 16:08 entra en la tolerancia',
    `retardo ${x.retardo_min} · extra ${x.extra_min}`);
  check(!a.has('2026-10-07'), 'miercoles sin jornada: no aparece');
  x = a.get('2026-10-08');
  check(x.revisar === true && Number(x.trabajado_min) === 0 && Number(x.extra_min) === 0, 'jueves sin salida: 0 horas y "Revisar"');
  x = a.get('2026-10-10');
  check(x.dia_libre === true && Number(x.extra_min) === 180, 'sabado es su descanso: las 3 horas son extra', `${x.extra_min}`);
  x = resumen(LUIS).get('2026-10-05');
  check(x && Number(x.extra_min) === 30 && Number(x.trabajado_min) === 510,
    'turno nocturno: la jornada es del lunes y la salida programada es el martes 06:00', JSON.stringify({ t: x?.trabajado_min, e: x?.extra_min }));
  x = resumen(SIN).get('2026-10-05');
  check(x && x.tiene_horario === false && Number(x.extra_min) === 0 && Number(x.trabajado_min) === 660,
    'sin horario asignado: cuenta las horas, no la extra');

  q(reglas({ pagado: 1 }));
  check(Number(resumen(ANA).get('2026-10-05').trabajado_min) === 524, 'con descanso pagado el lunes son 8:44');
  q(reglas({ tol: 0 }));
  a = resumen(ANA);
  check(Number(a.get('2026-10-06').extra_min) === 8 && Number(a.get('2026-10-06').retardo_min) === 12,
    'sin tolerancia los 8 minutos del martes ya son extra');
  q(reglas({ libre: 0 }));
  check(Number(resumen(ANA).get('2026-10-10').extra_min) === 0, 'si el dia de descanso no es extra, el sabado no suma');
  q(reglas({ retardos: 0 }));
  check(Number(resumen(ANA).get('2026-10-06').retardo_min) === 0, 'sin retardos, no se marcan');
  q(reglas({ extra: 0 }));
  a = resumen(ANA);
  check([...a.values()].every(d => Number(d.extra_min) === 0), 'sin horas extra, ninguna');
  q(reglas({}));
  const todos = todo(`EXEC dbo.sp_asistencia_resumen @desde='2026-10-05', @hasta='2026-10-11';`);
  check(todos.length === 3 && todos[1].some(p => p.user_id === ANA) && todos[2].some(h => h.user_id === LUIS),
    'el resumen trae las personas y sus horarios para pintar la semana');
  f = falla(`EXEC dbo.sp_asistencia_resumen @desde='2026-10-11', @hasta='2026-10-05';`, 'rango');
  check(f.ok, 'un rango al reves se rechaza', f.error);

  // ================================================================
  seccion('5. Corregir');
  f = falla(`EXEC dbo.sp_asistencia_corregir @jornada_id=${jue}, @entrada='2026-10-08T08:00:00', @salida='2026-10-08T16:00:00', @motivo=N'olvide', @user_id=${ANA};`, 'propias');
  check(f.ok, 'nadie corrige sus propias horas', f.error);
  f = falla(`EXEC dbo.sp_asistencia_corregir @jornada_id=${jue}, @entrada='2026-10-08T08:00:00', @salida='2026-10-08T16:00:00', @motivo=N'', @user_id=${ENC};`, 'motivo');
  check(f.ok, 'sin motivo no hay correccion', f.error);
  f = falla(`EXEC dbo.sp_asistencia_corregir @jornada_id=${jue}, @entrada='2026-10-08T08:00:00', @salida='2026-10-08T07:00:00', @motivo=N'olvido su salida', @user_id=${ENC};`, 'de la entrada');
  check(f.ok, 'la salida antes de la entrada se rechaza', f.error);
  f = falla(`EXEC dbo.sp_asistencia_corregir @jornada_id=${jue}, @entrada='2026-10-08T08:00:00', @salida='2026-10-09T09:00:00', @motivo=N'olvido su salida', @user_id=${ENC};`, '24 horas');
  check(f.ok, 'mas de 24 horas se rechaza', f.error);
  f = falla(`EXEC dbo.sp_asistencia_corregir @persona_id=${ANA}, @entrada='2026-10-05T09:00:00', @salida='2026-10-05T10:00:00', @motivo=N'doble', @user_id=${ENC};`, 'Se encima');
  check(f.ok, 'una jornada que se encima con otra se rechaza', f.error);
  f = falla(`EXEC dbo.sp_asistencia_corregir @persona_id=${ANA}, @entrada='2099-01-01T08:00:00', @salida='2099-01-01T16:00:00', @motivo=N'futuro', @user_id=${ENC};`, 'futuro');
  check(f.ok, 'no se registran horas en el futuro', f.error);
  q(`EXEC dbo.sp_asistencia_corregir @jornada_id=${jue}, @entrada='2026-10-08T08:00:00', @salida='2026-10-08T16:00:00', @motivo=N'olvido checar su salida', @user_id=${ENC};`);
  const j = uno(`SELECT estado, corregida FROM dbo.asistencia_jornadas WHERE id = ${jue};`);
  check(j.estado === 'CERRADA' && j.corregida === true, 'la jornada sin salida queda cerrada y marcada como corregida');
  const c = uno(`SELECT salida_antes, salida_nueva, motivo, corregida_por FROM dbo.asistencia_correcciones WHERE jornada_id = ${jue};`);
  check(c && c.salida_antes == null && hhmm(c.salida_nueva) === '16:00' && Number(c.corregida_por) === ENC,
    'queda lo que habia antes, lo nuevo, el motivo y quien', JSON.stringify(c));
  x = resumen(ANA).get('2026-10-08');
  check(x.revisar === false && Number(x.trabajado_min) === 480, 'y ya cuenta: 8 horas el jueves', `${x.trabajado_min}`);
  const nueva = escalar(`EXEC dbo.sp_asistencia_corregir @persona_id=${ANA}, @entrada='2026-10-07T08:05:00', @salida='2026-10-07T16:00:00', @motivo=N'no checo el miercoles', @user_id=${ENC};`);
  check(Number(nueva) > 0 && resumen(ANA).has('2026-10-07'), 'se registra una jornada que no se marco');
  const det = todo(`EXEC dbo.sp_asistencia_jornadas @persona_id=${ANA}, @desde='2026-10-05', @hasta='2026-10-11';`);
  check(det[0].length === 5 && det[1].length === 1 && det[2].length === 2, 'el detalle trae jornadas, descansos y correcciones',
    `${det[0].length}/${det[1].length}/${det[2].length}`);

  // ================================================================
  seccion('6. Checar antes de cobrar, y apagar');
  q(reglas({ vender: 1 }));
  e = uno(`EXEC dbo.sp_asistencia_estado @user_id=${LUIS};`);
  check(e.activa === true && e.entrada_para_vender === true && e.jornada_id == null,
    'con la regla puesta, el estado dice que a esta persona le falta su entrada (el cobro la frena)');
  q(`EXEC dbo.sp_set_business_module @module_key = N'asistencia', @enabled = 0;`);
  f = falla(`EXEC dbo.sp_asistencia_marcar @user_id=${LUIS}, @tipo='ENTRADA';`, 'activada');
  check(f.ok, 'apagada la aplicacion, ya no se marca', f.error);
  e = uno(`EXEC dbo.sp_asistencia_estado @user_id=${LUIS};`);
  check(e.activa === false, 'y el estado lo dice: el cobro deja de frenar');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.asistencia_jornadas;`)) > 0, 'apagar no borra nada');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) try { eliminar(DB); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
