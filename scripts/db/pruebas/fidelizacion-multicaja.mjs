/**
 * Fidelizacion con VARIAS CAJAS cobrando a la vez.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/fidelizacion-multicaja.mjs
 *
 * El numero de boleto de una rifa se calcula con `MAX(entry_number) + 1`.
 * Eso es una carrera de libro: dos cajas que cobran en el mismo instante leen
 * el mismo maximo y reparten el mismo boleto. Y un boleto repetido en una
 * rifa no es un detalle tecnico -es dos personas con el mismo numero cuando
 * salga el premio.
 *
 * No se da por buena la solucion "porque lleva UPDLOCK": se lanzan procesos
 * SIMULTANEOS de verdad contra SQL Server, cada uno con su conexion, y se
 * cuentan los boletos.
 *
 * Lo que se demuestra:
 *   1. N cajas cobrando a la vez no repiten ni un solo numero de boleto.
 *   2. No se pierde ninguno: salen exactamente los que corresponden.
 *   3. Cada boleto sabe de que caja y de que equipo salio.
 *   4. Una venta evaluada a la vez por dos procesos -el reintento del IPC-
 *      no otorga premios por duplicado.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { q, rows, row, scalar, check, seccion, resumen, fixtureCafe, DB } from './lib.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

console.log(`Base de pruebas: ${DB}  (servidor ${SERVIDOR})`);
const f = fixtureCafe();

const CAJAS = 4;          // cuatro equipos cobrando
const VENTAS_POR_CAJA = 5;

/** Deja una caja dada de alta y con turno abierto. */
function caja(id) {
  q(`IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = ${id})
     BEGIN
       SET IDENTITY_INSERT dbo.registers ON;
       INSERT INTO dbo.registers (id, code, name, is_active) VALUES (${id}, N'C${id}', N'Caja ${id}', 1);
       SET IDENTITY_INSERT dbo.registers OFF;
     END`);
  const abierto = scalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = ${id} AND closed_at IS NULL ORDER BY id DESC`);
  if (!abierto) row(`EXEC dbo.sp_open_shift @user_id=${f.userId}, @opening_cash=0, @register_id=${id};`);
}
for (let i = 1; i <= CAJAS; i++) caja(i);

q(`UPDATE dbo.products SET stock = 100000 WHERE id = ${f.coca}`);
q(`IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
     INSERT INTO dbo.business_config (business_name, business_profile, invoicing_enabled, updated_at)
     VALUES (N'Negocio de prueba', N'RETAIL', 0, GETDATE());
   UPDATE dbo.business_config SET loyalty_enabled = 1;`);

/**
 * Lanza `procesos` procesos que ejecutan su lote a la vez.
 *
 * Cada uno abre su propia conexion: es concurrencia real, no un bucle que
 * finge serlo. Mismo mecanismo que scripts/db/pruebas/concurrencia.mjs.
 */
function enParalelo(procesos, sqlPorProceso) {
  const dir = mkdtempSync(join(tmpdir(), 'wxloy-'));
  const ruta = (p) => p.split('\\').join('\\\\');
  const salidas = [];
  const hijos = [];

  for (let p = 0; p < procesos; p++) {
    const fOut = join(dir, `out${p}.json`);
    const fPs = join(dir, `w${p}.ps1`);
    const fSql = join(dir, `q${p}.sql`);
    writeFileSync(fSql, sqlPorProceso(p), 'utf8');
    salidas.push(fOut);
    writeFileSync(fPs, [
      "$ErrorActionPreference='Continue'",
      `$cs = 'Server=${SERVIDOR};Database=${DB};Integrated Security=True;TrustServerCertificate=True'`,
      `$sql = [System.IO.File]::ReadAllText('${ruta(fSql)}')`,
      '$c = New-Object System.Data.SqlClient.SqlConnection $cs',
      '$c.Open()',
      '$res = New-Object System.Collections.ArrayList',
      'try {',
      '  $cmd = $c.CreateCommand()',
      '  $cmd.CommandText = $sql',
      '  $cmd.CommandTimeout = 120',
      '  [void]$cmd.ExecuteNonQuery()',
      '  [void]$res.Add(@{ ok = $true; error = $null })',
      '} catch {',
      '  [void]$res.Add(@{ ok = $false; error = $_.Exception.Message })',
      '}',
      '$c.Close()',
      '$json = ConvertTo-Json -InputObject @{ r = $res.ToArray() } -Depth 5 -Compress',
      `[System.IO.File]::WriteAllText('${ruta(fOut)}', $json, (New-Object System.Text.UTF8Encoding $false))`,
    ].join('\n'), 'utf8');
    hijos.push(new Promise((resolve) => {
      const ch = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fPs],
        { stdio: 'ignore' });
      ch.on('exit', () => resolve());
      ch.on('error', () => resolve());
    }));
  }

  return Promise.all(hijos).then(() => {
    const out = [];
    for (const fOut of salidas) {
      try {
        const j = JSON.parse(readFileSync(fOut, 'utf8'));
        out.push(...(Array.isArray(j.r) ? j.r : [j.r]));
      } catch { out.push({ ok: false, error: 'el proceso no escribio resultado' }); }
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    return out;
  });
}

// ===================================================================
seccion('1. Cuatro cajas repartiendo boletos de la misma rifa, a la vez');

const rifaId = row(`
  EXEC dbo.sp_raffle_save @name=N'Rifa concurrente', @prize=N'Una moto',
    @winners_count=1, @code_prefix=N'CNC', @status=N'OPEN';`).id;
const campId = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Un boleto por venta', @outcome=N'RAFFLE_ENTRY',
    @raffle_id=${rifaId}, @quantity=1, @priority=10, @active=1;`).id;
check(rifaId > 0 && campId > 0, `rifa #${rifaId} y campana #${campId} listas`);

/*
 * Cada proceso cobra sus ventas y evalua cada una en el acto, que es
 * exactamente lo que hace la caja: cobrar y, justo despues, preguntar que
 * gano. El unico ORDER BY del mundo no arregla esto: o el procedure toma el
 * bloqueo, o dos cajas se llevan el mismo numero.
 */
const loteDe = (p) => {
  const caja = p + 1;
  // Las variables se declaran UNA vez: todo el lote es un solo batch de
  // T-SQL, y repetir el DECLARE dentro del bucle lo rechaza entero.
  /*
   * `sp_register_sale` se llama DIRECTO, sin `INSERT ... EXEC`.
   *
   * Envolverlo haria que SQL Server tapara cualquier error real detras de
   * "Cannot use the ROLLBACK statement within an INSERT-EXEC statement",
   * porque el procedure hace ROLLBACK en su CATCH. Es la misma nota que ya
   * lleva scripts/db/pruebas/concurrencia.mjs.
   *
   * El sale_id se recupera por la ultima venta de ESTA caja: cada proceso
   * vende solo en la suya, asi que ahi no hay carrera. (IDENT_CURRENT si la
   * tendria: es global a la tabla.)
   */
  const repetido = Array.from({ length: VENTAS_POR_CAJA }, () => `
    DELETE FROM @d;
    INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 20);
    EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'TARJETA',
      @SaleDetails=@d, @register_id=${caja};
    SELECT TOP 1 @sid = id FROM dbo.sales WHERE register_id = ${caja} ORDER BY id DESC;
    EXEC dbo.sp_loyalty_evaluate_sale @sale_id=@sid, @machine_id=N'EQUIPO-${caja}';
  `).join('\n');
  return `
    DECLARE @d dbo.SaleDetailType;
    DECLARE @sid INT;
    ${repetido}`;
};

const r1 = await enParalelo(CAJAS, loteDe);
const fallos = r1.filter(x => !x.ok);
check(fallos.length === 0, `los ${CAJAS} procesos terminaron sin error`,
  fallos.length ? fallos[0].error : `${CAJAS * VENTAS_POR_CAJA} ventas cobradas y evaluadas`);

const boletos = rows(`SELECT entry_number, register_id, machine_id FROM dbo.raffle_entries WHERE raffle_id = ${rifaId}`);
const esperados = CAJAS * VENTAS_POR_CAJA;

check(boletos.length === esperados,
  `se repartieron los ${esperados} boletos que tocaban`,
  `salieron ${boletos.length}`);

const numeros = boletos.map(b => Number(b.entry_number));
const distintos = new Set(numeros);
check(distintos.size === numeros.length,
  'NINGUN numero de boleto se repitio',
  distintos.size === numeros.length
    ? `${distintos.size} numeros distintos`
    : `${numeros.length - distintos.size} repetidos: dos personas con el mismo numero`);

check(Math.min(...numeros) === 1 && Math.max(...numeros) === esperados,
  `y van del 1 al ${esperados} sin huecos`,
  `del ${Math.min(...numeros)} al ${Math.max(...numeros)}`);

const porCaja = new Map();
for (const b of boletos) porCaja.set(b.register_id, (porCaja.get(b.register_id) || 0) + 1);
check(porCaja.size === CAJAS,
  `cada boleto sabe de que caja salio (${[...porCaja.entries()].map(([c, n]) => `caja ${c}: ${n}`).join(', ')})`);
check(boletos.every(b => /^EQUIPO-\d+$/.test(String(b.machine_id || ''))),
  'y de que equipo, que es lo que permite reclamar despues');

// ===================================================================
seccion('2. La misma venta evaluada por dos procesos a la vez');

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campId}`);
const recompensaId = row(`
  EXEC dbo.sp_loyalty_save_definition @kind_of=N'REWARD', @name=N'Postre gratis',
    @kind=N'AMOUNT', @amount=50, @uses_allowed=1, @active=1;`).id;
const campRec = row(`
  EXEC dbo.sp_loyalty_save_campaign @name=N'Siempre', @outcome=N'REWARD',
    @reward_definition_id=${recompensaId}, @quantity=1, @priority=20, @active=1;`).id;

// Una venta SIN evaluar. Dos procesos van a pedirle premios a la vez: es el
// reintento del IPC, o dos pantallas abiertas sobre el mismo cobro.
const venta = row(`
  DECLARE @d dbo.SaleDetailType;
  INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 20);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'TARJETA',
    @SaleDetails=@d, @register_id=1;`).sale_id;

const r2 = await enParalelo(6, () =>
  `EXEC dbo.sp_loyalty_evaluate_sale @sale_id=${venta}, @machine_id=N'EQUIPO-1';`);
check(r2.filter(x => !x.ok).length === 0, 'las 6 evaluaciones simultaneas terminaron sin error');

const premios = Number(scalar(`SELECT COUNT(*) FROM dbo.reward_instances WHERE sale_id = ${venta}`));
check(premios === 1,
  'la venta tiene UNA sola recompensa, no seis',
  premios === 1 ? 'la idempotencia aguanta la concurrencia' : `tiene ${premios}`);

const codigos = rows(`SELECT code FROM dbo.reward_instances WHERE sale_id = ${venta}`);
check(new Set(codigos.map(c => c.code)).size === codigos.length, 'y su codigo es unico');

q(`UPDATE dbo.campaigns SET active = 0 WHERE id = ${campRec}`);

resumen();
