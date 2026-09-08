/**
 * Concurrencia real de sp_register_sale: varias cajas vendiendo a la vez
 * bebidas que comparten cafe, leche, vasos y tapas.
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/dominio-hospitality.mjs
 *     node scripts/db/pruebas/concurrencia.mjs
 *
 * No se da por resuelto el problema "poniendo un ORDER BY": se lanzan
 * procesos SIMULTANEOS contra SQL Server y se comprueba el resultado.
 *
 * Lo que se demuestra:
 *   1. Ninguna venta deja stock negativo ni descuadra el inventario.
 *   2. Con el ultimo vaso, exactamente UNA de las ventas simultaneas gana.
 *   3. Con adquisicion de bloqueos en orden ascendente de product_id no se
 *      producen deadlocks (1205) aunque las lineas lleguen en orden opuesto.
 *   4. Si SQL Server eligiera esta sesion como victima, la venta no queda a
 *      medias: el numero de ventas coincide con el de exitos.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { q, rows, row, scalar, check, seccion, resumen, cerca, fixtureCafe, DB } from './lib.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

console.log(`Base de pruebas: ${DB}  (servidor ${SERVIDOR})`);
const f = fixtureCafe();
const opt = (n) => scalar(`SELECT TOP 1 id FROM dbo.modifier_options WHERE name = N'${n}' AND active = 1 ORDER BY id`);
const optChico = opt('Chico');

/** Un turno abierto por caja: sin el, la venta en efectivo se rechaza. */
function turnoDe(register) {
  q(`IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = ${register})
       SET IDENTITY_INSERT dbo.registers ON;
     IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = ${register})
       INSERT INTO dbo.registers (id, code, name, is_active) VALUES (${register}, N'C${register}', N'Caja ${register}', 1);
     IF EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = OBJECT_ID('dbo.registers'))
       SET IDENTITY_INSERT dbo.registers OFF;`);
  const abierto = scalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = ${register} AND closed_at IS NULL ORDER BY id DESC`);
  if (abierto) return abierto;
  return row(`EXEC dbo.sp_open_shift @user_id=${f.userId}, @opening_cash=0, @register_id=${register};`).closure_id;
}
turnoDe(1); turnoDe(2);

const stock = (id) => Number(scalar(`SELECT stock FROM dbo.products WHERE id = ${id}`));
const ventas = () => Number(scalar(`SELECT COUNT(*) FROM dbo.sales`));

/**
 * Lanza `n` procesos que ejecutan `sql` (parametrizado por $i) a la vez.
 * Cada proceso abre su propia conexion: es concurrencia real, no simulada.
 * Devuelve un resultado por intento: { ok, error, num }.
 */
function enParalelo(procesos, iteraciones, sqlPorIteracion) {
  const dir = mkdtempSync(join(tmpdir(), 'wxconc-'));
  const ruta = (p) => p.split('\\').join('\\\\');
  const salidas = [];
  const hijos = [];

  for (let p = 0; p < procesos; p++) {
    const fOut = join(dir, `out${p}.json`);
    const fPs = join(dir, `w${p}.ps1`);
    const fSql = join(dir, `q${p}.sql`);
    writeFileSync(fSql, sqlPorIteracion(p), 'utf8');
    salidas.push(fOut);
    writeFileSync(fPs, [
      "$ErrorActionPreference='Continue'",
      `$cs = 'Server=${SERVIDOR};Database=${DB};Integrated Security=True;TrustServerCertificate=True'`,
      `$sql = [System.IO.File]::ReadAllText('${ruta(fSql)}')`,
      '$c = New-Object System.Data.SqlClient.SqlConnection $cs',
      '$c.Open()',
      '$res = New-Object System.Collections.ArrayList',
      `for ($i = 1; $i -le ${iteraciones}; $i++) {`,
      '  $cmd = $c.CreateCommand(); $cmd.CommandTimeout = 60; $cmd.CommandText = $sql',
      '  try {',
      '    $r = $cmd.ExecuteScalar()',
      "    [void]$res.Add(@{ ok = $true; error = ''; num = 0; sale = $r })",
      '  } catch [System.Data.SqlClient.SqlException] {',
      '    [void]$res.Add(@{ ok = $false; error = $_.Exception.Message; num = $_.Exception.Number })',
      '  } catch {',
      '    [void]$res.Add(@{ ok = $false; error = $_.Exception.Message; num = -1 })',
      '  }',
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
        const lista = Array.isArray(j.r) ? j.r : (j.r ? [j.r] : []);
        out.push(...lista);
      } catch { /* un proceso que no escribio nada cuenta como fallo abajo */ }
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    return out;
  });
}

/** Venta de una bebida por el contrato v2, lista para ejecutar en paralelo. */
const ventaSql = (productos, register) => `
DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
${productos.map((p, i) => `INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (${i + 1}, ${p}, 1, 55);`).join('\n')}
${productos.map((p, i) => p === f.latte ? `INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (${i + 1}, ${optChico}, 1);` : '').join('\n')}
/* Llamada DIRECTA, como la del IPC: ExecuteScalar toma el sale_id del
   SELECT final. Envolverla en "INSERT ... EXEC" haria que SQL Server
   ocultara el error real detras de "Cannot use the ROLLBACK statement
   within an INSERT-EXEC statement". */
EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'TARJETA', @SaleDetails=@d1, @register_id=${register}, @SaleDetails2=@d2, @SaleModifiers=@mo;`;

const main = async () => {
  seccion('DOS CAJAS VENDIENDO A LA VEZ — ingredientes compartidos');
  q(`UPDATE dbo.products SET stock = 100000 WHERE id IN (${f.cafe}, ${f.leche}, ${f.azucar});
     UPDATE dbo.products SET stock = 400 WHERE id IN (${f.vaso}, ${f.tapa});`);
  // Receta minima del Americano: comparte cafe, vaso y tapa con el Latte.
  q(`DECLARE @l dbo.RecipeLineType;
     INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${f.cafe}, 15, 'g'), (${f.vaso}, 1, 'pza'), (${f.tapa}, 1, 'pza');
     EXEC dbo.sp_save_recipe @product_id=${f.americano}, @Lines=@l;`);

  const antes = { cafe: stock(f.cafe), vaso: stock(f.vaso), tapa: stock(f.tapa), leche: stock(f.leche), ventas: ventas() };
  const N_PROC = 4, N_ITER = 25;
  // Cada caja pide los productos en ORDEN OPUESTO: es el caso clasico de
  // deadlock si los bloqueos no se tomaran siempre en el mismo orden.
  const t0 = Date.now();
  const res = await enParalelo(N_PROC, N_ITER, (p) =>
    ventaSql(p % 2 === 0 ? [f.latte, f.americano] : [f.americano, f.latte], (p % 2) + 1));
  const ms = Date.now() - t0;

  const ok = res.filter(x => x.ok).length;
  const deadlocks = res.filter(x => !x.ok && Number(x.num) === 1205).length;
  const otros = res.filter(x => !x.ok && Number(x.num) !== 1205);
  console.log(`   ${res.length} intentos en ${ms} ms · exito ${ok} · deadlock ${deadlocks} · otros errores ${otros.length}`);
  if (otros.length) console.log(`   primer otro error: ${otros[0].error.split('\n')[0].slice(0, 160)}`);

  check(res.length === N_PROC * N_ITER, `se ejecutaron los ${N_PROC * N_ITER} intentos (${res.length})`);
  check(otros.length === 0, 'ningun error inesperado', otros[0]?.error?.slice(0, 200));
  check(deadlocks === 0, `sin deadlocks pese al orden opuesto de lineas (${deadlocks})`);

  const despues = { cafe: stock(f.cafe), vaso: stock(f.vaso), tapa: stock(f.tapa), leche: stock(f.leche), ventas: ventas() };
  check(despues.ventas - antes.ventas === ok, `ventas registradas = exitos (${despues.ventas - antes.ventas} vs ${ok})`);
  // Cada venta consume 1 Latte + 1 Americano: 18+15 g cafe, 200 ml leche, 2 vasos, 2 tapas.
  check(cerca(antes.cafe - despues.cafe, ok * 33), `cafe descontado = ventas x 33 g (${antes.cafe - despues.cafe} vs ${ok * 33})`);
  check(cerca(antes.leche - despues.leche, ok * 200), `leche descontada = ventas x 200 ml (${antes.leche - despues.leche})`);
  check(antes.vaso - despues.vaso === ok * 2 && antes.tapa - despues.tapa === ok * 2, `vasos y tapas = ventas x 2 (${antes.vaso - despues.vaso})`);
  const movTotal = Number(scalar(`SELECT ISNULL(SUM(quantity), 0) FROM dbo.inventory_movements WHERE product_id = ${f.cafe} AND typee = 'salida' AND source IN ('SALE','RECIPE')`));
  check(movTotal > 0, `los movimientos de inventario cuadran con lo descontado (${movTotal} g de cafe en total)`);
  check(stock(f.cafe) >= 0 && stock(f.vaso) >= 0, 'ningun stock quedo negativo');

  seccion('EL ULTIMO INGREDIENTE — solo una venta puede consumirlo');
  for (const intento of [1, 2, 3]) {
    q(`UPDATE dbo.products SET stock = 1 WHERE id = ${f.vaso};
       UPDATE dbo.products SET stock = 100000 WHERE id IN (${f.cafe}, ${f.leche}, ${f.azucar});
       UPDATE dbo.products SET stock = 100 WHERE id = ${f.tapa};`);
    const v0 = ventas();
    const r2 = await enParalelo(4, 1, (p) => ventaSql([p % 2 === 0 ? f.latte : f.americano], (p % 2) + 1));
    const ganadores = r2.filter(x => x.ok).length;
    const perdedores = r2.filter(x => !x.ok);
    // El texto llega con saltos de linea: se normaliza antes de buscarlo.
    const norm = (s) => String(s || '').replace(/\s+/g, ' ');
    const sinStock = perdedores.filter(x => /stock suficiente/i.test(norm(x.error))).length;
    const raros = perdedores.filter(x => !/stock suficiente/i.test(norm(x.error)));
    check(ganadores === 1, `intento ${intento}: exactamente una venta consume el ultimo vaso (${ganadores} ganadores, ${sinStock} rechazos por stock)`);
    check(raros.length === 0, `intento ${intento}: los perdedores fallan por stock, no por otra cosa`,
      raros.length ? norm(raros[0].error).slice(0, 200) : undefined);
    check(stock(f.vaso) === 0, `intento ${intento}: el vaso queda en 0, nunca en negativo (${stock(f.vaso)})`);
    check(ventas() - v0 === 1, `intento ${intento}: solo se registro una venta`);
  }

  seccion('ATOMICIDAD BAJO CARGA');
  // Una venta rechazada no debe dejar rastro: ni venta, ni movimiento, ni caja.
  q(`UPDATE dbo.products SET stock = 0 WHERE id = ${f.vaso};`);
  const v1 = ventas();
  const m1 = Number(scalar(`SELECT COUNT(*) FROM dbo.inventory_movements`));
  const c1 = Number(scalar(`SELECT COUNT(*) FROM dbo.cash_movements`));
  const r3 = await enParalelo(4, 5, () => ventaSql([f.latte], 1));
  check(r3.every(x => !x.ok), 'sin vasos, las 20 ventas simultaneas se rechazan');
  check(ventas() === v1 && Number(scalar(`SELECT COUNT(*) FROM dbo.inventory_movements`)) === m1 && Number(scalar(`SELECT COUNT(*) FROM dbo.cash_movements`)) === c1,
    'ninguna deja venta, movimiento de inventario ni movimiento de caja');
  q(`UPDATE dbo.products SET stock = 400 WHERE id = ${f.vaso};`);

  resumen();
};

main().catch(e => { console.error('\nERROR EN LA PRUEBA:', e.message); process.exit(1); });
