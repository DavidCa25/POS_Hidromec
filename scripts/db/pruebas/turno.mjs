/**
 * Sin turno abierto no se vende. Con turno, si.
 *
 *     node scripts/db/pruebas/turno.mjs [--conservar]
 *
 * QUE SE ROMPIO
 * -------------
 * En la VM se cerro el turno, se volvio a entrar a "Hacer venta" y la pantalla
 * abrio como si nada. La causa estaba en dos sitios:
 *
 *   ESTADO   La pantalla de Corte cerraba el turno y limpiaba SUS campos, pero
 *            no tocaba ShiftService, que es de donde leen las pantallas de
 *            venta. El servicio seguia diciendo "abierto" el resto de la
 *            sesion, y `ensureShiftOpen` corta en seco cuando eso pasa: no
 *            llegaba a preguntarle a SQL.
 *
 *   BACKEND  `sp_register_sale` solo exigia turno para el EFECTIVO, porque lo
 *            necesitaba para colgar el movimiento de caja. Una venta con
 *            tarjeta o a credito entraba sin turno y quedaba fuera del corte.
 *
 * QUE COMPRUEBA
 * -------------
 * La secuencia completa contra SQL de verdad:
 *
 *     abrir turno -> vender OK -> cerrar -> vender BLOQUEADO
 *                 -> abrir otro turno -> vender OK
 *
 * Y que el bloqueo vale para CUALQUIER forma de pago, no solo efectivo: es lo
 * que fallaba y lo que da sentido al arreglo.
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
const DB = 'Wybix_TmpTurno';
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
  console.log(`\nUNA VENTA PERTENECE A UN TURNO   (${DB})`);

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
  const userId = Number(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id;`));
  const brand = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'General';`));

  const prod = Number(escalar(`
    EXEC dbo.sp_add_product @brand=${brand}, @part_number=N'QA-TURNO', @name=N'Producto QA',
      @price=50, @stock=100, @category=${cat}, @cost=20;`));

  const turnoAbierto = () => uno(`
    SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = 1 AND closed_at IS NULL;`);
  const abrir = (fondo) => Number(uno(`
    EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=${fondo}, @register_id=1;`)?.closure_id);
  const cerrar = (id) => q(`
    EXEC dbo.sp_close_shift @closure_id=${id}, @user_id=${userId}, @cash_delivered=0, @register_id=1;`);
  const vender = (metodo) => falla(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${prod}, 1, 50);
    EXEC dbo.sp_register_sale @user_id=${userId}, @payment_method=N'${metodo}', @SaleDetails=@d1,
      @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`, 'turno');
  const ventas = () => Number(escalar(`SELECT COUNT(*) FROM dbo.sales;`));

  // =============================================================== 1
  seccion('1. Sin turno, no se vende');
  check(!turnoAbierto(), 'la caja parte sin turno abierto');
  for (const metodo of ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA']) {
    const r = vender(metodo);
    check(r.ok, `${metodo}: se rechaza`, r.error?.slice(0, 70));
  }
  check(ventas() === 0, 'y no quedo ninguna venta registrada');

  // =============================================================== 2
  seccion('2. Con turno abierto, se vende');
  const t1 = abrir(500);
  check(t1 > 0, `turno abierto (#${t1})`);
  for (const metodo of ['EFECTIVO', 'TARJETA']) {
    const r = vender(metodo);
    check(r.error === null, `${metodo}: la venta pasa`, r.error ?? 'sin error');
  }
  const trasVender = ventas();
  check(trasVender === 2, 'dos ventas registradas', String(trasVender));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE closure_id = ${t1};`)) === 1,
    'y solo el efectivo dejo movimiento de caja en el turno');

  // =============================================================== 3
  seccion('3. Al cerrar el turno, se vuelve a bloquear');
  cerrar(t1);
  check(!turnoAbierto(), 'la caja queda sin turno abierto');
  for (const metodo of ['EFECTIVO', 'TARJETA']) {
    const r = vender(metodo);
    check(r.ok, `${metodo}: se rechaza otra vez`, r.error?.slice(0, 70));
  }
  check(ventas() === trasVender, 'y no se colo ninguna venta mas', `${ventas()} en total`);

  // =============================================================== 4
  seccion('4. Con un turno nuevo, se vuelve a vender');
  const t2 = abrir(300);
  check(t2 > 0 && t2 !== t1, `turno nuevo abierto (#${t2}), distinto del anterior`);
  const r4 = vender('EFECTIVO');
  check(r4.error === null, 'la venta pasa de nuevo', r4.error ?? 'sin error');
  check(ventas() === trasVender + 1, 'tres ventas en total', String(ventas()));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE closure_id = ${t2};`)) === 1,
    'y su movimiento de caja cuelga del turno NUEVO, no del cerrado');

  // =============================================================== 5
  seccion('5. El turno es por caja');
  check(Number(escalar(`
    SELECT COUNT(*) FROM dbo.cash_movements m
    JOIN dbo.cash_closures c ON c.id = m.closure_id
    WHERE c.register_id <> 1;`)) === 0,
    'ningun movimiento quedo en una caja distinta');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
