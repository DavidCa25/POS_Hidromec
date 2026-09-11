/**
 * UNA CAJA, UN EQUIPO.
 *
 *     node scripts/db/pruebas/cajas.mjs [--conservar]
 *
 * QUE SE ESTABA ROMPIENDO
 * -----------------------
 * "Esta maquina es la Caja 2" vivia SOLO en el `device-config.json` local de
 * cada equipo. Nadie mas lo sabia, asi que nada impedia que dos maquinas se
 * declararan la misma caja. Y no es cosmetico: el turno es de la CAJA
 * (`cash_closures.register_id`), de modo que dos equipos en C1 comparten
 * turno y comparten corte. Las ventas de ambos caen en el mismo arqueo y
 * cerrar en uno cierra para el otro.
 *
 * QUE SE COMPRUEBA
 * ----------------
 * El arriendo (lease) completo, contra SQL de verdad, incluida una carrera
 * REAL: cuatro procesos distintos, cuatro conexiones distintas, disparando a
 * la misma hora de reloj con WAITFOR TIME. Encadenar llamadas desde un solo
 * proceso solo demostraria que lo secuencial funciona.
 *
 * Y sobre todo: que la proteccion esta en SQL, no en la pantalla. Vender y
 * abrir turno se rechazan aunque quien llame se salte toda la interfaz.
 *
 * Corre sobre una restauracion del baseline, nunca sobre una base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal, enParalelo } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpCajas';
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

// ------------------------------------------------------------------ atajos
const M1 = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';   // huella del equipo 1
const M2 = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';   // huella del equipo 2

/* Cada equipo se presenta SIEMPRE con el mismo nombre, como hace la app: el
   nombre viene del hostname. Renovar con otro nombre lo actualiza -es lo
   correcto, un equipo renombrado debe verse renombrado-, pero dentro de una
   prueba cambiarlo solo serviria para confundir de que equipo habla cada
   mensaje. */
const NOMBRE = { [M1]: 'CAJA-MOSTRADOR', [M2]: 'LAPTOP-BARRA' };

const sqlClaim = (caja, maquina, nombre, seg = 300) =>
  `EXEC dbo.sp_register_claim @register_id=${caja}, @machine_id=N'${maquina}', ` +
  `@machine_name=N'${nombre}', @lease_seconds=${seg};`;

const claim = (caja, maquina, nombre, seg = 300) => uno(sqlClaim(caja, maquina, nombre, seg));
const soltar = (caja, maquina, por = 'EQUIPO') => uno(
  `EXEC dbo.sp_register_release @register_id=${caja}, ` +
  `@machine_id=${maquina ? `N'${maquina}'` : 'NULL'}, @por=N'${por}';`);
const estado = (caja, maquina) => q(
  `EXEC dbo.sp_get_register_assignments @machine_id=${maquina ? `N'${maquina}'` : 'NULL'};`)
  .find(r => r.id === caja);

/** Deja el arriendo de una caja CADUCADO sin esperar: retrasa lease_until. */
const caducar = (caja) => q(
  `UPDATE dbo.register_assignments SET lease_until = DATEADD(MINUTE, -1, SYSUTCDATETIME())
   WHERE register_id = ${caja};`);

try {
  console.log(`\nUNA CAJA, UN EQUIPO   (${DB})`);

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

  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secreta1'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'General');`);
  const userId = Number(escalar('SELECT TOP 1 id FROM dbo.users ORDER BY id;'));
  const brand = Number(escalar('SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;'));
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'General';`));
  const prod = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-CAJA', @name=N'Producto QA',
      @price=50, @stock=1000, @category=${cat}, @cost=20;`));

  const abrirTurno = (caja, maquina) => falla(
    `EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=100, @register_id=${caja}` +
    (maquina ? `, @machine_id=N'${maquina}', @machine_name=N'${NOMBRE[maquina]}'` : '') + ';');
  const vender = (caja, maquina) => falla(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${prod}, 1, 50);
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1,
      @register_id=${caja}, @SaleDetails2=@d2, @SaleModifiers=@mo` +
    (maquina ? `, @machine_id=N'${maquina}', @machine_name=N'${NOMBRE[maquina]}'` : '') + ';');
  const ventas = () => Number(escalar('SELECT COUNT(*) FROM dbo.sales;'));

  // =============================================================== 1
  seccion('1. La migracion siembra lo que ya existia, y no toca nada mas');
  const cajas = q('SELECT id, code, name FROM dbo.registers ORDER BY id;');
  check(cajas.length >= 1, `el catalogo trae ${cajas.length} caja(s)`, cajas.map(c => c.code).join(', '));
  check(Number(escalar(`
    SELECT COUNT(*) FROM dbo.registers r
    WHERE NOT EXISTS (SELECT 1 FROM dbo.register_assignments a WHERE a.register_id = r.id);`)) === 0,
    'toda caja existente tiene su fila de asignacion');
  check(estado(1, M1)?.estado === 'LIBRE', 'y todas nacen LIBRES: nadie hereda una caja tomada');

  // Segunda caja, para el resto de la prueba. La crea el procedimiento real.
  const c2 = Number(uno(`EXEC dbo.sp_add_register @name=N'Caja 2';`)?.id);
  check(c2 > 1, `sp_add_register crea la Caja 2 (#${c2})`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.register_assignments WHERE register_id = ${c2};`)) === 1,
    'y le crea su fila de asignacion en la misma transaccion');

  // =============================================================== 2
  seccion('2. Reclamar una caja libre');
  const r1 = claim(1, M1, 'CAJA-MOSTRADOR');
  check(r1?.ok === 1 && r1.resultado === 'RECLAMADA', 'el equipo 1 toma C1', r1?.resultado);
  check(Number(r1?.segundos_restantes) > 250, 'con un arriendo de ~5 minutos', `${r1?.segundos_restantes}s`);
  check(estado(1, M1)?.estado === 'MIA', 'y para ese equipo C1 aparece como suya');
  check(estado(1, M2)?.estado === 'OCUPADA', 'mientras que para el otro aparece OCUPADA');

  // =============================================================== 3
  seccion('3. Otro equipo NO puede tomarla, y se le dice quien la tiene');
  const r2 = claim(1, M2, 'LAPTOP-BARRA');
  check(r2?.ok === 0 && r2.resultado === 'OCUPADA', 'el equipo 2 es rechazado', r2?.resultado);
  check(String(r2?.mensaje || '').includes('CAJA-MOSTRADOR'),
    'y el mensaje nombra al equipo que la tiene', r2?.mensaje);
  check(String(r2?.mensaje || '').includes('está'),
    'el mensaje conserva los acentos (viaja como dato, no como error)');
  check(escalar('SELECT machine_id FROM dbo.register_assignments WHERE register_id = 1;') === M1,
    'y el rechazo no movio ni un byte de la asignacion');

  // =============================================================== 4
  seccion('4. Renovar (el latido de cada minuto)');
  const antes = String(uno('SELECT lease_until FROM dbo.register_assignments WHERE register_id = 1;').lease_until);
  const desde = String(uno('SELECT claimed_at FROM dbo.register_assignments WHERE register_id = 1;').claimed_at);
  const r3 = claim(1, M1, 'CAJA-MOSTRADOR', 600);
  check(r3?.resultado === 'RENOVADA', 'renovar la propia caja dice RENOVADA', r3?.resultado);
  check(String(uno('SELECT lease_until FROM dbo.register_assignments WHERE register_id = 1;').lease_until) !== antes,
    'el arriendo se extiende');
  check(String(uno('SELECT claimed_at FROM dbo.register_assignments WHERE register_id = 1;').claimed_at) === desde,
    'pero `claimed_at` NO se mueve: sigue siendo la misma posesion, sin huecos');

  // =============================================================== 5
  seccion('5. Un arriendo caducado deja la caja libre sola');
  caducar(1);
  check(estado(1, M2)?.estado === 'LIBRE', 'caducado, C1 vuelve a estar libre');
  const r4 = claim(1, M2, 'LAPTOP-BARRA');
  check(r4?.ok === 1 && r4.resultado === 'RECLAMADA', 'y ahora el equipo 2 si la toma', r4?.resultado);
  check(estado(1, M1)?.estado === 'OCUPADA', 'la que era del equipo 1 ahora es del 2');

  // Y el caso simetrico: caduca, nadie la toma, y el dueno vuelve.
  caducar(1);
  const r5 = claim(1, M2, 'LAPTOP-BARRA');
  check(r5?.resultado === 'RECUPERADA',
    'si nadie la tomo entre medias, su dueno la RECUPERA en el siguiente latido', r5?.resultado);

  // =============================================================== 6
  seccion('6. Soltar la caja al cerrar Wybix');
  const s1 = soltar(1, M2, 'EQUIPO');
  check(s1?.ok === 1 && s1.resultado === 'LIBERADA', 'el equipo suelta SU caja', s1?.resultado);
  check(estado(1, M1)?.estado === 'LIBRE', 'y queda libre al instante, sin esperar a que caduque');
  const s2 = soltar(1, M2, 'EQUIPO');
  check(s2?.ok === 1 && s2.resultado === 'YA_LIBRE', 'soltar dos veces no es un error (idempotente)', s2?.resultado);

  claim(1, M1, 'CAJA-MOSTRADOR');
  const s3 = soltar(1, M2, 'EQUIPO');
  check(s3?.ok === 0 && s3.resultado === 'NO_ES_TUYA',
    'un equipo NO puede soltar la caja de otro', s3?.resultado);
  check(estado(1, M1)?.estado === 'MIA', 'la caja sigue siendo de su dueno');

  // =============================================================== 7
  seccion('7. La escotilla del administrador');
  const s4 = soltar(1, null, 'ADMIN');
  check(s4?.ok === 1 && s4.resultado === 'LIBERADA_ADMIN',
    'un administrador libera una caja que tiene un equipo muerto', s4?.resultado);
  check(escalar('SELECT released_by FROM dbo.register_assignments WHERE register_id = 1;') === 'ADMIN',
    'y queda registrado que fue el administrador, no el equipo');
  check(claim(1, M2, 'LAPTOP-BARRA')?.resultado === 'RECLAMADA', 'otra maquina puede tomarla enseguida');
  soltar(1, M2, 'EQUIPO');

  // =============================================================== 8
  seccion('8. La proteccion esta en SQL, no en la pantalla');
  claim(1, M1, 'CAJA-MOSTRADOR');

  const t2 = abrirTurno(1, M2);
  check(t2.ok, 'abrir turno en una caja ajena: RECHAZADO', t2.error?.slice(0, 80));
  check(Number(escalar('SELECT COUNT(*) FROM dbo.cash_closures;')) === 0, 'y no quedo ningun turno abierto');

  const t1 = abrirTurno(1, M1);
  check(t1.error === null, 'el dueno de la caja si abre turno', t1.error ?? 'sin error');

  const v2 = vender(1, M2);
  check(v2.ok, 'vender en una caja ajena: RECHAZADO', v2.error?.slice(0, 80));
  check(String(v2.error || '').includes('CAJA-MOSTRADOR'), 'y el error nombra al equipo que la tiene');
  check(ventas() === 0, 'no se colo ninguna venta');

  const v1 = vender(1, M1);
  check(v1.error === null, 'el dueno de la caja si vende', v1.error ?? 'sin error');

  // =============================================================== 9
  seccion('9. Vender renueva el arriendo (la senal de vida mas fuerte)');
  caducar(1);
  const v3 = vender(1, M1);
  check(v3.error === null, 'con el arriendo caducado y nadie mas en la caja, la venta NO se interrumpe',
    v3.error ?? 'sin error');
  check(estado(1, M1)?.estado === 'MIA', 'y la venta recupero el arriendo por si misma');

  // =============================================================== 10
  seccion('10. MonoCaja no gana ni una friccion');
  // Sin @machine_id no se exige nada: es el contrato de siempre.
  const v4 = vender(1, null);
  check(v4.error === null, 'una llamada sin identidad de equipo vende igual que antes', v4.error ?? 'sin error');
  const t3 = abrirTurno(c2, null);
  check(t3.error === null, 'y abre turno igual que antes', t3.error ?? 'sin error');

  // =============================================================== 11
  seccion('11. Dos cajas, dos equipos: cada uno con lo suyo');
  q('DELETE FROM dbo.cash_movements; DELETE FROM dbo.sale_detail; DELETE FROM dbo.sales; DELETE FROM dbo.cash_closures;');
  soltar(1, null, 'ADMIN');
  soltar(c2, null, 'ADMIN');
  check(claim(1, M1, 'CAJA-MOSTRADOR')?.ok === 1, 'equipo 1 toma C1');
  check(claim(c2, M2, 'LAPTOP-BARRA')?.ok === 1, 'equipo 2 toma C2');
  check(abrirTurno(1, M1).error === null, 'cada uno abre SU turno (C1)');
  check(abrirTurno(c2, M2).error === null, 'cada uno abre SU turno (C2)');
  check(vender(1, M1).error === null && vender(c2, M2).error === null, 'y los dos venden a la vez');
  check(Number(escalar(
    'SELECT COUNT(DISTINCT register_id) FROM dbo.cash_closures WHERE closed_at IS NULL;')) === 2,
    'hay DOS turnos abiertos, uno por caja: ni comparten turno ni comparten corte');
  check(Number(escalar('SELECT COUNT(*) FROM dbo.sales WHERE register_id = 1;')) === 1 &&
        Number(escalar(`SELECT COUNT(*) FROM dbo.sales WHERE register_id = ${c2};`)) === 1,
    'y cada venta quedo en la caja que la cobro');

  // =============================================================== 12
  seccion('12. Cerrar el turno tambien valida el arriendo');
  const cerrarAjeno = falla(
    `EXEC dbo.sp_close_shift @user_id=${userId}, @cash_delivered=0, @register_id=1, ` +
    `@machine_id=N'${M2}', @machine_name=N'LAPTOP-BARRA';`);
  check(cerrarAjeno.ok, 'cerrar el corte de una caja ajena: RECHAZADO', cerrarAjeno.error?.slice(0, 70));
  check(Number(escalar(
    'SELECT COUNT(*) FROM dbo.cash_closures WHERE register_id = 1 AND closed_at IS NULL;')) === 1,
    'el turno del otro equipo sigue abierto: nadie le cerro el corte por detras');
  const cerrarPropio = falla(
    `EXEC dbo.sp_close_shift @user_id=${userId}, @cash_delivered=0, @register_id=1, ` +
    `@machine_id=N'${M1}', @machine_name=N'CAJA-MOSTRADOR';`);
  check(cerrarPropio.error === null, 'y el dueno si lo cierra', cerrarPropio.error ?? 'sin error');

  // =============================================================== 13
  seccion('13. Carrera REAL: cuatro equipos reclaman C1 a la vez');
  soltar(1, null, 'ADMIN');
  // Todos esperan a la MISMA hora de reloj del servidor antes de disparar.
  // Arrancar cuatro procesos de PowerShell nunca es simultaneo: cada uno tarda
  // unos cientos de milisegundos distintos en levantar, asi que sin esta
  // puerta comun la "carrera" seria una fila india.
  const arranque = new Date(Date.now() + 12000);
  const hhmmss = [arranque.getHours(), arranque.getMinutes(), arranque.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
  const aspirantes = ['c3c3', 'd4d4', 'e5e5', 'f6f6'].map(p => p.repeat(8));
  const respuestas = await enParalelo(DB, aspirantes.map((m, i) =>
    `WAITFOR TIME '${hhmmss}';\n` + sqlClaim(1, m, `EQUIPO-${i + 1}`)));

  const filas = respuestas.map(r => (r.ok && r.sets[0]?.[0]) || null);
  const errores = respuestas.filter(r => !r.ok).map(r => limpiar(r.error).slice(0, 90));
  check(errores.length === 0, 'los cuatro intentos llegaron a SQL', errores[0] || '');
  const ganadores = filas.filter(f => f && f.ok === 1);
  check(ganadores.length === 1, 'gana exactamente UNO de los cuatro',
    `ganadores: ${ganadores.length}; resultados: ${filas.map(f => f?.resultado ?? 'error').join(', ')}`);
  check(filas.filter(f => f && f.resultado === 'OCUPADA').length === 3,
    'y los otros tres reciben OCUPADA, no un error crudo');
  const dueno = escalar('SELECT machine_id FROM dbo.register_assignments WHERE register_id = 1;');
  check(ganadores.length === 1 && dueno === ganadores[0].holder_machine_id,
    'la fila quedo a nombre del que gano, y de nadie mas', String(dueno).slice(0, 8));
  check(filas.every(f => !f || !f.mensaje || f.mensaje.includes('EQUIPO-')),
    'cada perdedor sabe a que equipo perdio');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
