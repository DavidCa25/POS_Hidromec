/**
 * CREAR, RESTABLECER Y ELIMINAR UNA DEMO, CONTRA SQL SERVER DE VERDAD.
 *
 *     node scripts/db/pruebas/demo-entornos.mjs [retail|hospitality]
 *
 * No comprueba que los procedimientos "existan": crea la base desde la
 * plantilla oficial, le aplica las migraciones, la siembra y despues mira que
 * hay dentro. Si el template o una migracion se rompen, esto falla, y ese es
 * medio el objetivo: crear una demo es tambien una prueba del instalador.
 *
 * SECUENCIAL A PROPOSITO. Cada perfil restaura una base entera; dos a la vez
 * se pelean por el disco y por el propio motor.
 *
 * SOLO TOCA BASES Wybix_Demo_*. Antes de borrar nada pasa por las mismas
 * guardas que usa el gestor, que se prueban aparte en
 * scripts/pruebas/demo-guardas.mjs.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const G = require('../../../electron/demo/guardas.js');

const SERVIDOR = process.env.WYBIX_DB_SERVER || 'localhost';
const SOLO = process.argv[2] || null;

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

/**
 * Ejecuta SQL y devuelve filas. Escritura permitida: aqui se crea y se borra.
 *
 * El texto va por ARCHIVO y no incrustado en el comando: un here-string de
 * PowerShell interpola `$` y comillas, y las migraciones vienen llenas de las
 * dos cosas. Es el mismo metodo que usa scripts/db/probar-migracion.mjs.
 */
function sql(base, texto) {
  const dir = mkdtempSync(join(tmpdir(), 'wx-demo-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, texto, 'utf8');
  const ruta = f.replace(/\\/g, '\\\\');
  const script = [
    "$ErrorActionPreference='Stop'",
    `$cs='Server=${SERVIDOR};Database=${base};Integrated Security=True;TrustServerCertificate=True'`,
    '$c=New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()',
    '$cmd=$c.CreateCommand(); $cmd.CommandTimeout=600',
    `$cmd.CommandText=[System.IO.File]::ReadAllText('${ruta}')`,
    '$da=New-Object System.Data.SqlClient.SqlDataAdapter $cmd; $dt=New-Object System.Data.DataTable',
    '[void]$da.Fill($dt); $c.Close()',
    '$r=@(); foreach($x in $dt.Rows){ $h=@{}; foreach($c2 in $dt.Columns){ $h[$c2.ColumnName]=[string]$x[$c2] }; $r+=$h }',
    'ConvertTo-Json -InputObject @($r) -Compress',
  ].join('\n');
  try {
    return JSON.parse(powershell(script) || '[]');
  } catch {
    return [];
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

/**
 * Lanza PowerShell, y lo reintenta UNA vez si lo matan.
 *
 * En esta maquina los procesos de powershell mueren de vez en cuando con
 * codigo 143 y sin escribir un solo caracter en el error: no es el SQL, es el
 * proceso. Ya esta documentado en scripts/db/probar-migracion.mjs, que lleva
 * el mismo reintento y por el mismo motivo.
 *
 * Solo se repite ese caso. Un error de SQL SI se propaga: repetirlo daria el
 * mismo error y ocultaria cuantas veces pasa.
 */
function powershell(script) {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      const dijoAlgo = String(e.stderr || '').trim();
      if (dijoAlgo || intento === 2) {
        throw new Error(dijoAlgo || `powershell murio con codigo ${e.status} sin decir nada.`);
      }
      console.log(`   …      proceso repetido (codigo ${e.status}), no fue el SQL`);
    }
  }
  return '';
}

/**
 * Un script entero, troceado por GO DENTRO de PowerShell.
 *
 * Un proceso por lote eran cientos de procesos para aplicar las migraciones:
 * lento, y justo lo que dispara las muertes del 143. Asi es uno por archivo.
 */
function sqlScript(base, texto) {
  const dir = mkdtempSync(join(tmpdir(), 'wx-demo-'));
  const f = join(dir, 's.sql');
  writeFileSync(f, texto, 'utf8');
  const ruta = f.replace(/\\/g, '\\\\');
  const script = [
    "$ErrorActionPreference='Stop'",
    `$cs='Server=${SERVIDOR};Database=${base};Integrated Security=True;TrustServerCertificate=True'`,
    '$c=New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()',
    `$txt=[System.IO.File]::ReadAllText('${ruta}') -replace "\`r\`n", "\`n"`,
    '$lotes=[regex]::Split($txt, "(?im)^[ \\t]*GO[ \\t]*$")',
    'foreach($l in $lotes){',
    '  if([string]::IsNullOrWhiteSpace($l)){ continue }',
    '  $cmd=$c.CreateCommand(); $cmd.CommandTimeout=600; $cmd.CommandText=$l',
    '  [void]$cmd.ExecuteNonQuery()',
    '}',
    '$c.Close()',
  ].join('\n');
  try {
    powershell(script);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

const existe = (base) =>
  Number(sql('master', `SELECT CASE WHEN DB_ID('${base}') IS NULL THEN 0 ELSE 1 END AS n`)[0]?.n) === 1;

const contar = (base, tabla, donde = '1=1') =>
  Number(sql(base, `SELECT COUNT(*) AS n FROM dbo.${tabla} WHERE ${donde}`)[0]?.n ?? 0);

const meta = (base, clave) =>
  sql(base, `SELECT valor FROM dbo.database_metadata WHERE clave = '${clave}'`)[0]?.valor ?? null;

/** Igual que hace el gestor: plantilla, migraciones y semilla. */
function crear(perfil) {
  const nombre = G.nombreDeBase(perfil);
  const bak = join(process.cwd(), 'installer', 'template.bak').replace(/\\/g, '\\\\');

  const dataDir = sql('master',
    "SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(400)) AS p")[0].p;
  const zona = process.env.WYBIX_BACKUP_DIR || 'C:\\POS_Backups';
  execFileSync('powershell', ['-NoProfile', '-Command',
    `New-Item -ItemType Directory -Force '${zona}' | Out-Null;` +
    `Copy-Item -Force '${join(process.cwd(), 'installer', 'template.bak')}' '${zona}\\_demo_test.bak'`],
    { encoding: 'utf8' });
  const copia = `${zona}\\_demo_test.bak`.replace(/\\/g, '\\\\');

  const lista = sql('master', `RESTORE FILELISTONLY FROM DISK = N'${copia}'`);
  const mueve = lista.map(f =>
    `MOVE N'${f.LogicalName}' TO N'${dataDir}${nombre}_${f.LogicalName}.${f.Type === 'L' ? 'ldf' : 'mdf'}'`).join(', ');
  sql('master', `RESTORE DATABASE [${nombre}] FROM DISK = N'${copia}' WITH ${mueve}, REPLACE, RECOVERY;`);

  // Migraciones, en orden y con el mismo troceado que el arranque.
  const dir = join(process.cwd(), 'electron', 'migrations');
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    const crudo = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    for (const lote of crudo.split(/\n\s*GO\s*\n/gi).map(s => s.trim()).filter(Boolean)) {
      sql(nombre, lote);
    }
  }

  sembrar(perfil, nombre);
  return nombre;
}

/**
 * La semilla del perfil, troceada igual que en el gestor.
 *
 * Al terminar anota el identificador de instancia, que es lo que el gestor
 * guarda en su configuracion local. Sin ese apunte de su lado, las guardas se
 * niegan a tocar la base despues, y con razon: seria una demo que no creo el.
 */
function sembrar(perfil, nombre) {
  const semilla = readFileSync(join(process.cwd(), 'demo-profiles', perfil, 'seed.sql'), 'utf8')
    .replace(/\r\n/g, '\n');
  for (const lote of semilla.split(/\n\s*GO\s*\n/gi).map(s => s.trim()).filter(Boolean)) {
    sql(nombre, lote);
  }
  REGISTRO.set(perfil, meta(nombre, 'demo_instance_id'));
}

/** El registro local del gestor, simulado: perfil -> identificador anotado. */
const REGISTRO = new Map();

/** Igual que hace el gestor: con las guardas delante. */
function eliminar(perfil, instanciaLocal) {
  const nombre = G.nombreDeBase(perfil);
  if (!existe(nombre)) return { ok: true, borrada: false };
  const m = {};
  for (const f of sql(nombre, 'SELECT clave, valor FROM dbo.database_metadata')) m[f.clave] = f.valor;
  const v = G.sePuedeDestruir({
    perfilId: perfil, nombre,
    perfilesInstalados: [{ id: 'retail' }, { id: 'hospitality' }],
    metadatos: m,
    instanciaLocal: instanciaLocal === undefined ? REGISTRO.get(perfil) : instanciaLocal,
  });
  if (!v.ok) return { ok: false, motivo: v.motivo };
  sql('master', `ALTER DATABASE [${nombre}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${nombre}];`);
  REGISTRO.delete(perfil);
  return { ok: true, borrada: true };
}

const PERFILES = SOLO ? [SOLO] : ['retail', 'hospitality'];
console.log(`Servidor ${SERVIDOR}  ·  perfiles: ${PERFILES.join(', ')}`);

for (const perfil of PERFILES) {
  const nombre = G.nombreDeBase(perfil);

  // Se parte de limpio, sin suponer en que estado quedo la ejecucion anterior.
  eliminar(perfil);

  // =================================================================
  seccion(`${perfil} · 1. Crear la demo`);

  crear(perfil);
  check(existe(nombre), `${nombre} existe`);
  check(meta(nombre, 'is_demo') === 'true', 'lleva el marcador is_demo',
    'sin el no se podria restablecer ni eliminar despues');
  check(meta(nombre, 'demo_profile') === perfil, `y dice que es del perfil ${perfil}`);
  check(!!meta(nombre, 'demo_created_at'), 'con la fecha en que se creo');

  const instancia = meta(nombre, 'demo_instance_id');
  check(G.PATRON_INSTANCIA.test(String(instancia || '')),
    'y con un identificador de instancia con forma de UUID', `demo_instance_id = ${instancia}`);
  check(REGISTRO.get(perfil) === instancia,
    'que es el mismo que quedo anotado del lado del gestor');

  // =================================================================
  seccion(`${perfil} · 1b. Sin coincidir con el registro local, no se toca`);

  /* Las dos formas en que esto pasa de verdad: una demo creada por otra
     instalacion, y un registro local perdido. En los dos casos la base sigue
     ahi despues de intentarlo. */
  const ajena = eliminar(perfil, '11111111-2222-3333-4444-555555555555');
  check(ajena.ok === false, 'con otro identificador el gestor se niega', ajena.motivo || 'LA BORRO');
  check(existe(nombre), 'y la base sigue ahi');

  const sinRegistro = eliminar(perfil, null);
  check(sinRegistro.ok === false, 'sin registro local tampoco', sinRegistro.motivo || 'LA BORRO');
  check(existe(nombre), 'y la base sigue ahi');

  /* Volver a correr la semilla sobre la misma base NO regenera el
     identificador: si lo hiciera, el gestor dejaria de reconocer su propia
     demo cada vez que se resembrara. */
  sembrar(perfil, nombre);
  check(meta(nombre, 'demo_instance_id') === instancia,
    'resembrar la misma base conserva su identificador',
    `antes ${instancia} · ahora ${meta(nombre, 'demo_instance_id')}`);

  // =================================================================
  seccion(`${perfil} · 2. Nacio del esquema oficial`);

  /* Que la base venga del template y no de un script propio es lo que hace
     que crear una demo pruebe tambien el instalador. */
  check(!!meta(nombre, 'baseline_version'), 'conserva baseline_version del template',
    'si esto falta, la base no nacio de template.bak');
  const migs = contar(nombre, 'schema_migrations');
  check(migs > 20, `tiene ${migs} migraciones registradas`);
  const tablas = Number(sql(nombre,
    "SELECT COUNT(*) AS n FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')")[0].n);
  check(tablas > 40, `y ${tablas} tablas, como una instalacion real`);
  const procs = Number(sql(nombre, 'SELECT COUNT(*) AS n FROM sys.procedures')[0].n);
  check(procs > 100, `con sus ${procs} procedimientos`);

  // =================================================================
  seccion(`${perfil} · 3. La semilla deja lo minimo, y nada mas`);

  check(contar(nombre, 'users') >= 1, 'hay un usuario para entrar');
  check(contar(nombre, 'business_config') === 1, 'y el negocio configurado');
  check(contar(nombre, 'registers', 'is_active = 1') >= 1, 'con su Caja 1');

  /* Lo que NO tiene es tan importante como lo que tiene: una demo sirve para
     probar Wybix, no para aparentar meses de operacion. */
  check(contar(nombre, 'sales') === 0, 'el panel arranca en cero: ninguna venta inventada');

  if (perfil === 'retail') {
    const vendibles = contar(nombre, 'products', 'sellable = 1 AND active = 1');
    check(vendibles >= 1 && vendibles <= 5, `${vendibles} productos vendibles, sin inflar`);
    check(contar(nombre, 'products', "stock > 0") >= 1, 'con existencias para poder vender');
    check(contar(nombre, 'CAT_categories') >= 1, 'y una categoria');
  }

  if (perfil === 'hospitality') {
    check(contar(nombre, 'products', "inventory_mode = 'RECIPE'") >= 1,
      'hay un producto que se prepara por receta');
    check(contar(nombre, 'products', 'sellable = 0') >= 2, 'y sus ingredientes, que no se venden sueltos');
    check(contar(nombre, 'recipes') >= 2, 'con una receta por tamano');
    check(contar(nombre, 'modifier_groups', "role = 'SIZE'") >= 1, 'un grupo de tamano');
    check(contar(nombre, 'modifier_options', "effect = 'SUBSTITUTE'") >= 1, 'una sustitucion');
    check(contar(nombre, 'modifier_options', "effect = 'ADD'") >= 1, 'y un extra que suma consumo');
    check(contar(nombre, 'product_modifier_groups') >= 3, 'los tres grupos, asignados al producto');
    const tope = Number(sql(nombre,
      "SELECT TOP 1 max_select AS n FROM dbo.modifier_groups WHERE name = 'Extras'")[0]?.n ?? 0);
    check(tope === 3, 'y el grupo de extras admite 3 unidades', `max_select = ${tope}`);
  }

  // =================================================================
  seccion(`${perfil} · 4. Restablecer la devuelve a su estado inicial`);

  /* Se ensucia a proposito y se comprueba que restablecer lo deshace. */
  sql(nombre, "INSERT INTO dbo.CAT_categories (namee) VALUES (N'Basura de la demo')");
  const sucias = contar(nombre, 'CAT_categories', "namee = 'Basura de la demo'");
  check(sucias === 1, 'se ensucia la demo a proposito');

  const borrada = eliminar(perfil);
  check(borrada.ok && borrada.borrada, 'restablecer empieza tirando la base', borrada.motivo || '');
  crear(perfil);
  check(existe(nombre), 'y la vuelve a crear');
  check(contar(nombre, 'CAT_categories', "namee = 'Basura de la demo'") === 0,
    'la basura ya no esta',
    'regenerar entera es lo unico que garantiza volver al estado inicial');
  check(meta(nombre, 'is_demo') === 'true', 'y el marcador vuelve a estar puesto');

  /* Y es OTRA base, con otro identificador: el gestor lo reanota al crearla.
     Si se quedara el viejo, una copia de seguridad de la demo anterior
     seguiria pareciendo la demo actual. */
  const reciente = meta(nombre, 'demo_instance_id');
  check(G.PATRON_INSTANCIA.test(String(reciente || '')), 'con un identificador nuevo valido');
  check(reciente !== instancia, 'y distinto del que tenia antes de restablecer',
    `antes ${instancia} · ahora ${reciente}`);
  check(REGISTRO.get(perfil) === reciente, 'que es el que el gestor tiene anotado ahora');

  // =================================================================
  seccion(`${perfil} · 5. Eliminar no deja la base`);

  const fin = eliminar(perfil);
  check(fin.ok && fin.borrada, 'se elimina', fin.motivo || '');
  check(!existe(nombre), `${nombre} ya no existe`);
}

// ===================================================================
seccion('Ninguna base de demo queda por ahi');

const restos = sql('master',
  "SELECT name FROM sys.databases WHERE name LIKE 'Wybix[_]Demo[_]%'").map(x => x.name);
check(restos.length === 0, 'no quedan bases Wybix_Demo_*', restos.join(', '));

// ===================================================================
seccion('Y las de verdad siguen intactas');

/* La comprobacion que de verdad importa: despues de crear, restablecer y
   eliminar dos demos, las bases reales siguen donde estaban. */
for (const real of ['Wybix_Production', 'Wybix_Template']) {
  if (existe(real)) check(true, `${real} sigue existiendo`);
  else console.log(`   —      ${real} no esta en este servidor`);
}

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `OK (${ok} comprobaciones)`}`);
process.exit(fallos.length ? 1 : 0);
