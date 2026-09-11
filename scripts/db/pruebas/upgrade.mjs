/**
 * UPGRADE TEST — una instalacion Wybix REAL se actualiza sin perder nada.
 *
 *     node scripts/db/pruebas/upgrade.mjs [--conservar]
 *
 * `db:test-migration` prueba instalacion LIMPIA: template.bak + migraciones.
 * Esta prueba cubre el otro caso, que es el que rompio de verdad:
 *
 *     base con DATOS  +  la cuenta limitada de la aplicacion
 *         ↓ todas las migraciones de electron/migrations/, en orden
 *     datos intactos  +  Retail sigue vendiendo  +  Hospitality disponible
 *
 * Dos cosas la distinguen y las dos importan:
 *
 *   1. HAY DATOS. Una restriccion nueva puede pasar sobre tablas vacias y
 *      fallar sobre filas reales.
 *   2. SE EJECUTA COMO LA APLICACION. Las demas pruebas usan la conexion de
 *      Windows del desarrollador (sysadmin). La aplicacion entra como
 *      `ocus_app`, miembro de `ocus_app_full_role`, y ese rol NO tenia
 *      REFERENCES: cualquier clave foranea fallaba con 1750/1088. Una
 *      migracion que pasa como sysadmin puede romper en la caja del cliente.
 *      Aqui se crea un login con EXACTAMENTE ese rol y se migra con el.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crearVacia, eliminar, restaurar, ejecutar } from '../lib/temporal.mjs';
import { consultar, SERVIDOR } from '../lib/sql.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

const TMP = 'Wybix_TmpUpgrade';
const LOGIN = 'wybix_upg_app';
const PASS = 'Upg#2026$test';
const CONSERVAR = process.argv.includes('--conservar');
const DIR = join('electron', 'migrations');

let fallos = 0, pasos = 0;
const bien = (t) => { pasos++; console.log(`   ok     ${t}`); };
const mal = (t, d) => { pasos++; fallos++; console.log(`   FALLA  ${t}${d ? '\n            ' + d : ''}`); };
const check = (c, t, d) => (c ? bien(t) : mal(t, d));
const paso = (t) => console.log(`\n── ${t}`);

/** Ejecuta SQL en la base temporal CON LA CUENTA LIMITADA de la aplicacion. */
function comoApp(sentencias) {
  const dir = mkdtempSync(join(tmpdir(), 'wxupg-'));
  const fIn = join(dir, 'in.json');
  const fOut = join(dir, 'out.json');
  const fPs = join(dir, 'r.ps1');
  writeFileSync(fIn, JSON.stringify(sentencias), 'utf8');
  const ruta = (f) => f.split('\\').join('\\\\');
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$cs = 'Server=${SERVIDOR};Database=${TMP};User ID=${LOGIN};Password=${PASS};TrustServerCertificate=True'`,
    `$stmts = [System.IO.File]::ReadAllText('${ruta(fIn)}') | ConvertFrom-Json`,
    '$c = New-Object System.Data.SqlClient.SqlConnection $cs',
    '$c.Open()',
    '$res = New-Object System.Collections.ArrayList',
    'foreach ($s in $stmts) {',
    '  $cmd = $c.CreateCommand(); $cmd.CommandTimeout = 300; $cmd.CommandText = $s',
    "  try { [void]$cmd.ExecuteNonQuery(); [void]$res.Add(@{ ok=$true; error=''; num=0 }) }",
    '  catch [System.Data.SqlClient.SqlException] {',
    '    $inner = @(); foreach ($e in $_.Exception.Errors) { $inner += \"[$($e.Number)] $($e.Message)\" }',
    '    [void]$res.Add(@{ ok=$false; error=($inner -join \" | \"); num=$_.Exception.Number })',
    '  }',
    '  catch { [void]$res.Add(@{ ok=$false; error=$_.Exception.Message; num=-1 }) }',
    '}',
    '$c.Close()',
    `[System.IO.File]::WriteAllText('${ruta(fOut)}', (ConvertTo-Json -InputObject @{ r = $res.ToArray() } -Depth 4 -Compress), (New-Object System.Text.UTF8Encoding $false))`,
  ].join('\n');
  writeFileSync(fPs, ps, 'utf8');
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fPs],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    const j = JSON.parse(readFileSync(fOut, 'utf8'));
    const l = Array.isArray(j.r) ? j.r : (j.r ? [j.r] : []);
    return l;
  } catch (e) {
    const msg = (e.stderr?.toString() || e.message).split('\n').slice(0, 5).join(' ');
    return sentencias.map(() => ({ ok: false, error: msg, num: -1 }));
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

const lotesDe = (t) => t.replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map(s => s.trim()).filter(Boolean);
const uno = (sql) => consultarTemporal(TMP, sql).sets[0]?.[0] ?? null;
const escalar = (sql) => { const r = uno(sql); return r ? r[Object.keys(r)[0]] : null; };

try {
  console.log('\nWYBIX UPGRADE TEST — instalacion existente con datos y cuenta limitada');

  paso('1. Base que simula una instalacion Wybix ya entregada');
  restaurar(TMP, join('installer', 'template.bak'));
  bien(`${TMP} restaurada desde template.bak (Baseline V1)`);

  paso('2. Datos representativos de un negocio en marcha');
  // Retail puro: lo que tendria un cliente antes de conocer Hospitality.
  ejecutar(TMP, `
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'cajero1', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.business_config (business_name, address, phone, rfc, invoicing_enabled, updated_at)
    VALUES (N'Refaccionaria Rios', N'Av. Hidalgo 100', N'3312345678', N'XAXX010101000', 0, GETDATE());
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Filtros'), (N'Lubricantes');
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'Castrol'), (N'SIN MARCA');
    INSERT INTO dbo.CAT_suppliers (nombre) VALUES (N'Distribuidora del Centro');
    INSERT INTO dbo.customers (code, customerName, credit_limit, terms_days, active)
    VALUES (N'C1', N'Taller Mecanico Lopez', 10000, 30, 1);

    DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    DECLARE @mar INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, brand_id, cost, bar_code, objeto_impuesto, tasa_iva, active, registrated_date)
    VALUES (N'F-101', N'Filtro de aceite', 180.00, 25, @cat, @mar, 110.00, N'7501111111111', '02', 0.16, 1, GETDATE()),
           (N'L-202', N'Aceite 20W50 1L', 95.00, 60, @cat, @mar, 58.00, N'7502222222222', '02', 0.16, 1, GETDATE()),
           (N'F-303', N'Filtro de aire', 240.00, 8, @cat, @mar, 150.00, N'7503333333333', '02', 0.16, 1, GETDATE());`);

  ejecutar(TMP, `
    DECLARE @u INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
    DECLARE @p1 INT = (SELECT id FROM dbo.products WHERE part_number = N'F-101');
    DECLARE @p2 INT = (SELECT id FROM dbo.products WHERE part_number = N'L-202');
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.customers ORDER BY id);
    DECLARE @s INT = (SELECT TOP 1 id FROM dbo.CAT_suppliers ORDER BY id);

    /* Turno, ventas de contado y a credito, con su detalle y sus movimientos. */
    INSERT INTO dbo.cash_closures (userId, create_date, opened_at, closed_at, opening_cash, cash_expected, cash_delivered, difference, register_id)
    VALUES (@u, CAST(GETDATE() AS DATE), SYSDATETIME(), NULL, 500, 0, 0, 0, 1);
    DECLARE @cl INT = SCOPE_IDENTITY();

    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, register_id)
    VALUES (GETDATE(), @u, 360.00, N'EFECTIVO', NULL, 360.00, 0, 1);
    DECLARE @v1 INT = SCOPE_IDENTITY();
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price) VALUES (@v1, @p1, 2, 180.00);
    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn)
    VALUES (@p1, 'salida', CAST(@v1 AS NVARCHAR(50)), 2, GETDATE(), 'Venta');
    INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, closure_id, register_id)
    VALUES (GETDATE(), @u, 'SALE', @v1, CONCAT('Venta ', @v1), 360.00, @cl, 1);

    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id)
    VALUES (GETDATE(), @u, 190.00, N'CREDITO', @c, 0, 190.00, DATEADD(day, 30, GETDATE()), 1);
    DECLARE @v2 INT = SCOPE_IDENTITY();
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price) VALUES (@v2, @p2, 2, 95.00);
    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn)
    VALUES (@p2, 'salida', CAST(@v2 AS NVARCHAR(50)), 2, GETDATE(), 'Venta');

    /* Una compra con su detalle. */
    INSERT INTO dbo.purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
    VALUES (GETDATE(), @u, 1160.00, 0.16, 160.00, @s, 1160.00, N'PENDIENTE');
    DECLARE @co INT = SCOPE_IDENTITY();
    INSERT INTO dbo.purchase_detail (puchase_id, product_id, supplier_id, quantity, unitary_price, profit_percent)
    VALUES (@co, @p1, @s, 10, 110.00, 40);
    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn)
    VALUES (@p1, 'entrada', CAST(@co AS NVARCHAR(50)), 10, GETDATE(), 'Compra');

    /* Una segunda caja: multicaja en uso. */
    INSERT INTO dbo.registers (code, name, is_active) VALUES (N'C2', N'Caja 2', 1);`);

  const antes = {
    productos: escalar('SELECT COUNT(*) AS n FROM dbo.products'),
    ventas: escalar('SELECT COUNT(*) AS n FROM dbo.sales'),
    detalle: escalar('SELECT COUNT(*) AS n FROM dbo.sale_detail'),
    movs: escalar('SELECT COUNT(*) AS n FROM dbo.inventory_movements'),
    compras: escalar('SELECT COUNT(*) AS n FROM dbo.purchase'),
    clientes: escalar('SELECT COUNT(*) AS n FROM dbo.customers'),
    cajas: escalar('SELECT COUNT(*) AS n FROM dbo.registers'),
    usuarios: escalar('SELECT COUNT(*) AS n FROM dbo.users'),
    caja: escalar('SELECT COUNT(*) AS n FROM dbo.cash_movements'),
    negocio: escalar("SELECT business_name AS n FROM dbo.business_config"),
    stockF101: escalar("SELECT stock AS n FROM dbo.products WHERE part_number = 'F-101'"),
    totalVentas: escalar('SELECT SUM(total) AS n FROM dbo.sales'),
  };
  bien(`datos sembrados: ${antes.productos} productos, ${antes.ventas} ventas, ${antes.detalle} lineas, ${antes.compras} compra, ${antes.cajas} cajas`);

  paso('3. La cuenta con la que entra la aplicacion');
  // El rol NO viaja dentro de template.bak: existe en las bases vivas, donde
  // lo creo el instalador. Su definicion canonica esta en Git desde este
  // arreglo, y es la que se aplica aqui: asi la prueba valida tambien ese
  // archivo, no solo las migraciones.
  for (const lote of lotesDe(readFileSync(join('sql', 'permissions', 'ocus_app_full_role.sql'), 'utf8'))) {
    ejecutar(TMP, lote);
  }
  ejecutar('master', `
    IF SUSER_ID('${LOGIN}') IS NULL
      CREATE LOGIN [${LOGIN}] WITH PASSWORD = N'${PASS}', CHECK_POLICY = OFF;`);
  ejecutar(TMP, `
    IF USER_ID('${LOGIN}') IS NULL CREATE USER [${LOGIN}] FOR LOGIN [${LOGIN}];
    ALTER ROLE [ocus_app_full_role] ADD MEMBER [${LOGIN}];`);
  const rol = escalar(`SELECT COUNT(*) AS n FROM sys.database_role_members m
    JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
    JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
    WHERE r.name = 'ocus_app_full_role' AND u.name = '${LOGIN}'`);
  check(rol > 0, `${LOGIN} creado dentro de ocus_app_full_role (los permisos reales de una caja)`);

  const tieneRef = () => escalar(`SELECT COUNT(*) AS n FROM sys.database_permissions p
    JOIN sys.database_principals g ON g.principal_id = p.grantee_principal_id
    WHERE g.name = 'ocus_app_full_role' AND p.class_desc = 'SCHEMA'
      AND p.major_id = SCHEMA_ID('dbo') AND p.permission_name = 'REFERENCES' AND p.state_desc = 'GRANT'`);

  paso('4. Sin el permiso REFERENCES, la actualizacion DEBE fallar');
  // Se comprueba el fallo a proposito: es la regresion que rompio la
  // actualizacion real, y esta prueba existe para que no vuelva a colarse.
  ejecutar(TMP, `REVOKE REFERENCES ON SCHEMA::dbo FROM [ocus_app_full_role];`, { permitirFallo: true });
  check(tieneRef() === 0, 'el rol no tiene REFERENCES (estado de una instalacion anterior)');
  {
    const archivos = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
    let fallo = null;
    for (const f of archivos) {
      const r = comoApp(lotesDe(readFileSync(join(DIR, f), 'utf8')));
      const primero = r.find(x => !x.ok);
      if (primero) { fallo = { f, error: primero.error }; break; }
    }
    // Sin REFERENCES sobre el esquema, la actualizacion se topa con el primer
    // objeto que lo necesite. Puede ser una clave foranea (1750/1088) o un
    // tipo de tabla (15151): el numero depende de con que se cruce antes, la
    // causa es la misma y el remedio tambien -el GRANT del paso 5-. Lo que la
    // prueba tiene que exigir es que FALLE, no que falle con un codigo exacto.
    const porPermisos = !!fallo && /\b(1088|1750|15151)\b|permission|permiso/i.test(fallo.error);
    check(porPermisos,
      `la actualizacion se detiene en ${fallo ? fallo.f : '(ninguna)'} por falta de permisos`,
      fallo ? fallo.error.slice(0, 150) : 'no fallo: la prueba ya no cubre la regresion');
  }

  paso('5. Con el permiso concedido, la actualizacion completa');
  // Es lo que hace setupServer.ensureSchemaPermissions() al arrancar.
  ejecutar(TMP, `GRANT REFERENCES ON SCHEMA::dbo TO [ocus_app_full_role];`);
  check(tieneRef() > 0, 'REFERENCES concedido al rol (lo hace el arranque de la aplicacion)');

  const archivos = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    const lotes = lotesDe(readFileSync(join(DIR, f), 'utf8'));
    const r = comoApp(lotes);
    const i = r.findIndex(x => !x.ok);
    if (i < 0) {
      comoApp([`INSERT INTO dbo.schema_migrations(filename) VALUES (N'${f}');`]);
      bien(`${f} (${lotes.length} lotes)`);
    } else {
      mal(`${f}: falla en el lote ${i + 1} de ${lotes.length}`, r[i].error.slice(0, 220));
      break;
    }
  }

  paso('6. Los datos siguen ahi');
  const despues = {
    productos: escalar('SELECT COUNT(*) AS n FROM dbo.products'),
    ventas: escalar('SELECT COUNT(*) AS n FROM dbo.sales'),
    detalle: escalar('SELECT COUNT(*) AS n FROM dbo.sale_detail'),
    movs: escalar('SELECT COUNT(*) AS n FROM dbo.inventory_movements'),
    compras: escalar('SELECT COUNT(*) AS n FROM dbo.purchase'),
    clientes: escalar('SELECT COUNT(*) AS n FROM dbo.customers'),
    cajas: escalar('SELECT COUNT(*) AS n FROM dbo.registers'),
    usuarios: escalar('SELECT COUNT(*) AS n FROM dbo.users'),
    caja: escalar('SELECT COUNT(*) AS n FROM dbo.cash_movements'),
    negocio: escalar('SELECT business_name AS n FROM dbo.business_config'),
    stockF101: escalar("SELECT stock AS n FROM dbo.products WHERE part_number = 'F-101'"),
    totalVentas: escalar('SELECT SUM(total) AS n FROM dbo.sales'),
  };
  for (const k of Object.keys(antes)) {
    check(String(antes[k]) === String(despues[k]), `${k}: ${antes[k]} -> ${despues[k]}`);
  }

  paso('7. Los datos existentes reciben los valores por defecto correctos');
  const p = uno("SELECT inventory_mode, sellable, base_uom, allow_decimal_qty, image_version FROM dbo.products WHERE part_number = 'F-101'");
  check(p && p.inventory_mode === 'DIRECT' && Number(p.sellable) === 1 && p.base_uom === 'pza' && Number(p.allow_decimal_qty) === 0,
    `un producto Retail queda DIRECT / vendible / pza (${p ? JSON.stringify(p) : 'sin fila'})`);
  check(escalar("SELECT business_profile AS n FROM dbo.business_config") === 'RETAIL',
    'el negocio queda como RETAIL: sin cambio observable para el cliente');
  check(escalar('SELECT COUNT(*) AS n FROM dbo.products WHERE inventory_mode <> \'DIRECT\'') === 0,
    'ningun producto historico cambia de modo de inventario');
  check(escalar('SELECT COUNT(*) AS n FROM dbo.sale_detail WHERE unit_cost IS NOT NULL') === 0,
    'las ventas historicas no inventan un costo que no se registro');
  check(escalar('SELECT COUNT(*) AS n FROM dbo.uoms') >= 14, 'catalogo de unidades sembrado');

  paso('8. Retail sigue vendiendo con el contrato de siempre');
  {
    const p1 = escalar("SELECT id AS n FROM dbo.products WHERE part_number = 'F-101'");
    const u = escalar('SELECT TOP 1 id AS n FROM dbo.users ORDER BY id');
    const stockAntes = Number(escalar(`SELECT stock AS n FROM dbo.products WHERE id = ${p1}`));
    const r = consultarTemporal(TMP, `
      DECLARE @d dbo.SaleDetailType;
      INSERT INTO @d (product_id, quantity, unit_price) VALUES (${p1}, 1, 180);
      EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'EFECTIVO', @SaleDetails=@d, @register_id=1;`);
    const venta = r.ok ? r.sets[0]?.[0] : null;
    check(r.ok && venta && venta.sale_id > 0, `venta Retail registrada tras migrar (folio ${venta?.sale_id})`, r.ok ? undefined : r.error.split('\n')[0]);
    check(Number(escalar(`SELECT stock AS n FROM dbo.products WHERE id = ${p1}`)) === stockAntes - 1,
      `stock descontado: ${stockAntes} -> ${escalar(`SELECT stock AS n FROM dbo.products WHERE id = ${p1}`)}`);
    const det = uno(`SELECT TOP 1 unit_cost, inventory_mode FROM dbo.sale_detail WHERE sale_id = ${venta?.sale_id}`);
    check(det && det.inventory_mode === 'DIRECT' && Number(det.unit_cost) === 110,
      `la venta nueva si congela costo e inventory_mode (${det ? JSON.stringify(det) : 'sin fila'})`);
  }

  paso('9. Hospitality queda disponible en la misma base');
  check(escalar("SELECT COUNT(*) AS n FROM sys.objects WHERE name IN ('recipes','recipe_lines','modifier_groups','modifier_options','product_presentations','sale_detail_modifiers','product_images','uoms')") === 8,
    'las 8 tablas de Hospitality existen');
  check(escalar("SELECT COUNT(*) AS n FROM sys.objects WHERE type = 'P' AND name IN ('sp_get_menu_catalog','sp_save_recipe','sp_get_recipe','sp_save_modifier_group')") === 4,
    'los procedures de Hospitality existen');
  {
    const r = consultarTemporal(TMP, 'EXEC dbo.sp_get_menu_catalog;');
    check(r.ok, 'sp_get_menu_catalog responde sobre una base recien migrada', r.ok ? undefined : r.error.split('\n')[0]);
  }

  paso('10. Reejecutar las migraciones no rompe nada (idempotencia)');
  {
    let ok = true, detalle = '';
    for (const f of archivos) {
      const r = comoApp(lotesDe(readFileSync(join(DIR, f), 'utf8')));
      const i = r.findIndex(x => !x.ok);
      if (i >= 0) { ok = false; detalle = `${f} lote ${i + 1}: ${r[i].error.slice(0, 160)}`; break; }
    }
    check(ok, `las ${archivos.length} migraciones se pueden reaplicar sin error`, detalle);
    check(String(escalar('SELECT COUNT(*) AS n FROM dbo.products')) === String(antes.productos), 'y los datos siguen intactos');
  }

} catch (e) {
  mal('error inesperado en la prueba', e.message.split('\n').slice(0, 3).join(' '));
} finally {
  try { ejecutar(TMP, `IF USER_ID('${LOGIN}') IS NOT NULL DROP USER [${LOGIN}];`, { permitirFallo: true }); } catch { /* noop */ }
  if (!CONSERVAR) {
    try { eliminar(TMP); console.log(`\nBase temporal ${TMP} eliminada.`); } catch (e) { console.log(`\nNo se pudo eliminar ${TMP}: ${e.message}`); }
    try { ejecutar('master', `IF SUSER_ID('${LOGIN}') IS NOT NULL DROP LOGIN [${LOGIN}];`, { permitirFallo: true }); } catch { /* noop */ }
  } else {
    console.log(`\nBase temporal ${TMP} conservada (--conservar).`);
  }
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
