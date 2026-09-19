/**
 * LOS GIROS DE SERVICIOS, CONTRA SQL SERVER DE VERDAD.
 *
 *     node scripts/db/pruebas/servicios-giros.mjs [GIRO]
 *
 * Crea `Wybix_Demo_Servicios` una vez por giro —plantilla oficial,
 * migraciones, semilla común y semilla del giro—, mira lo que quedó dentro y
 * la borra. Después comprueba lo que de verdad importa de tener UNA sola demo
 * de Servicios: que restablecer conserva el giro, y que crear otra con un giro
 * distinto no deja nada del anterior.
 *
 * POR QUÉ NO SE COMPRUEBA LEYENDO LOS ARCHIVOS
 * --------------------------------------------
 * Porque lo que se quiere saber es si el giro quedó ENCENDIDO y SEMBRADO, y
 * eso solo lo dice la base. Un `seed.sql` puede llamar al procedimiento
 * correcto y fallar a la mitad, y leer el archivo diría que está bien.
 *
 * SECUENCIAL A PROPÓSITO. Cada giro restaura una base entera.
 *
 * SOLO TOCA `Wybix_Demo_Servicios`. El nombre lo compone `guardas.js` a partir
 * del identificador del perfil, igual que el gestor, y antes de cada borrado
 * pasa por las mismas cuatro guardas.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const G = require('../../../electron/demo/guardas.js');
const GESTOR = require('../../../electron/demo/gestor.js');
const PRESETS = require('../../../electron/servicios/presets.js');

const SERVIDOR = process.env.WYBIX_DB_SERVER || 'localhost';
const PERFIL = 'servicios';
const BASE = G.nombreDeBase(PERFIL);
const SOLO = (process.argv[2] || '').toUpperCase() || null;

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle) => {
  if (cond) { ok++; console.log(`   ok     ${titulo}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

// ===========================================================================
//  LO MISMO QUE HACE demo-entornos.mjs PARA HABLAR CON SQL SERVER
// ===========================================================================

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

function sql(base, texto) {
  const dir = mkdtempSync(join(tmpdir(), 'wx-giro-'));
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
 * Un script ENTERO, troceado por GO dentro de PowerShell.
 *
 * La diferencia no es cosmetica. Un proceso por lote son cientos de procesos
 * solo para aplicar las migraciones, y aplicarlas cinco veces -una por giro-
 * convierte esta prueba en algo que nadie va a ejecutar. Asi es un proceso por
 * archivo.
 */
function sqlScript(base, texto) {
  const dir = mkdtempSync(join(tmpdir(), 'wx-giro-'));
  const f = join(dir, 's.sql');
  writeFileSync(f, texto, 'utf8');
  const ruta = f.replace(/\\/g, '\\\\');
  const script = [
    "$ErrorActionPreference='Stop'",
    `$cs='Server=${SERVIDOR};Database=${base};Integrated Security=True;TrustServerCertificate=True'`,
    '$c=New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()',
    `$txt=[System.IO.File]::ReadAllText('${ruta}') -replace "\`r\`n", "\`n"`,
    '$lotes=[regex]::Split($txt, "(?im)^[ \t]*GO[ \t]*$")',
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

/** Las demas demos que haya en la maquina. Ninguna operacion puede tocarlas. */
const otrasDemos = () =>
  sql('master', "SELECT name FROM sys.databases WHERE name LIKE 'Wybix[_]Demo[_]%'")
    .map(f => f.name).filter(n => n !== BASE).sort();

const meta = (base, clave) =>
  sql(base, `SELECT valor FROM dbo.database_metadata WHERE clave = '${clave}'`)[0]?.valor ?? null;

/** El registro local del gestor, simulado: perfil -> identificador anotado. */
const REGISTRO = new Map();

function restaurarYMigrar() {
  const bakOrigen = join(process.cwd(), 'installer', 'template.bak');
  const zona = process.env.WYBIX_BACKUP_DIR || 'C:\\POS_Backups';
  execFileSync('powershell', ['-NoProfile', '-Command',
    `New-Item -ItemType Directory -Force '${zona}' | Out-Null;` +
    `Copy-Item -Force '${bakOrigen}' '${zona}\\_giros_test.bak'`], { encoding: 'utf8' });
  const copia = `${zona}\\_giros_test.bak`.replace(/\\/g, '\\\\');

  const dataDir = sql('master',
    "SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(400)) AS p")[0].p;
  const lista = sql('master', `RESTORE FILELISTONLY FROM DISK = N'${copia}'`);
  const mueve = lista.map(f =>
    `MOVE N'${f.LogicalName}' TO N'${dataDir}${BASE}_${f.LogicalName}.${f.Type === 'L' ? 'ldf' : 'mdf'}'`).join(', ');
  sql('master', `RESTORE DATABASE [${BASE}] FROM DISK = N'${copia}' WITH ${mueve}, REPLACE, RECOVERY;`);

  const dir = join(process.cwd(), 'electron', 'migrations');
  for (const f of readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
    sqlScript(BASE, readFileSync(join(dir, f), 'utf8'));
  }
}

/** El perfil leido de disco, igual que lo lee el gestor. */
function perfilDeDisco() {
  const falsaApp = { getPath: () => '' };
  const p = GESTOR.leerPerfiles(falsaApp).find(x => x.id === PERFIL);
  if (!p) throw new Error(`No hay perfil de demostracion "${PERFIL}" en demo-profiles/.`);
  return p;
}

/**
 * Sembrar con las MISMAS semillas que elegiria el gestor.
 *
 * Se llama a `semillasDe` en vez de componer la ruta aqui: si manana el gestor
 * cambia donde busca las semillas, esta prueba cambia con el o se rompe, que
 * es lo que se quiere. Una prueba que compone la ruta por su cuenta seguiria
 * verde mientras el producto ya no encuentra nada.
 */
function sembrar(perfil, presetId) {
  for (const archivo of GESTOR.semillasDe(perfil, presetId)) {
    sqlScript(BASE, readFileSync(archivo, 'utf8'));
  }
  REGISTRO.set(PERFIL, meta(BASE, 'demo_instance_id'));
}

function crear(perfil, presetId) {
  restaurarYMigrar();
  sembrar(perfil, presetId);
}

/** Igual que el gestor: con las cuatro guardas delante. */
function eliminar(instanciaLocal) {
  if (!existe(BASE)) return { ok: true, borrada: false };
  const m = {};
  for (const f of sql(BASE, 'SELECT clave, valor FROM dbo.database_metadata')) m[f.clave] = f.valor;
  const v = G.sePuedeDestruir({
    perfilId: PERFIL, nombre: BASE,
    perfilesInstalados: [{ id: 'retail' }, { id: 'hospitality' }, { id: 'servicios' }],
    metadatos: m,
    instanciaLocal: instanciaLocal === undefined ? REGISTRO.get(PERFIL) : instanciaLocal,
  });
  if (!v.ok) return { ok: false, motivo: v.motivo };
  sql('master', `ALTER DATABASE [${BASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${BASE}];`);
  REGISTRO.delete(PERFIL);
  return { ok: true, borrada: true };
}

// ===========================================================================
//  LO QUE TIENE QUE QUEDAR DENTRO DE CADA GIRO
//
//  Se describe aqui y no dentro de cada caso porque asi se lee de un vistazo
//  en que se diferencian, que es lo unico que un giro tiene que hacer: que la
//  demo de una barberia NO se parezca a la de un taller.
// ===========================================================================
const ESPERADO = {
  TALLER_AUTOMOTRIZ: {
    negocio: 'Taller Demo Wybix',
    servicios: ['Afinación mayor', 'Cambio de aceite', 'Diagnóstico con escáner'],
    profesionales: ['Carlos Ramírez'],
    activos: { minimo: 1, clase: 'VEHICULO', identificador: 'ABC-123' },
    productos: ['ACEITE-5W30', 'FILTRO-ACE', 'FILTRO-AIRE', 'BUJIA-IR'],
  },
  BELLEZA: {
    negocio: 'Estética Demo Wybix',
    servicios: ['Corte de cabello', 'Arreglo de barba', 'Manicure', 'Tinte'],
    profesionales: ['Luis Martínez', 'Ana Torres'],
    /* Sin activos, y eso es LA diferencia: en una barberia no entra nada que
       registrar aparte de la persona que viene. */
    activos: { minimo: 0, exactamente: 0 },
    productos: ['CERA-100', 'SHAM-300'],
  },
  REPARACION_ELECTRONICA: {
    negocio: 'Servicio Técnico Demo Wybix',
    servicios: ['Diagnóstico', 'Cambio de pantalla', 'Mantenimiento y limpieza'],
    profesionales: ['Iván Estrada'],
    activos: { minimo: 2, clase: 'EQUIPO', identificador: 'F2LX9K3QJC' },
    productos: ['PANT-IP13', 'BAT-IP13', 'PASTA-TER'],
  },
  MANTENIMIENTO: {
    negocio: 'Mantenimiento Demo Wybix',
    servicios: ['Mantenimiento preventivo', 'Visita de diagnóstico', 'Instalación de equipo'],
    profesionales: ['Raúl Medina', 'Sofía Cruz'],
    activos: { minimo: 2, clase: 'EQUIPO', identificador: 'MS-0042' },
    productos: ['GAS-410A', 'FILTRO-AC', 'CAPAC-35'],
  },
  OTRO: {
    /* El generico NO renombra el negocio: no hay un nombre neutro mejor que
       el que ya puso la semilla comun. */
    negocio: 'Demo Servicios',
    servicios: ['Revisión inicial', 'Hora de trabajo', 'Servicio a precio cerrado'],
    profesionales: ['Alex Rivera'],
    activos: { minimo: 0, exactamente: 0 },
    productos: ['MAT-001'],
  },
};

const texto = (v) => String(v ?? '').replace(/'/g, "''");

function comprobarGiro(id) {
  const e = ESPERADO[id];
  const perfil = perfilDeDisco();

  seccion(`${id} · se crea desde la plantilla oficial`);
  crear(perfil, id);
  check(existe(BASE), `${BASE} existe`);

  // --- el giro, donde lo lee el producto y donde lo lee el gestor ---------
  const enTabla = sql(BASE, 'SELECT preset FROM dbo.services_config WHERE id = 1')[0]?.preset ?? null;
  check(enTabla === id, 'el giro quedo guardado en services_config', `quedo ${enTabla}`);
  check(meta(BASE, 'demo_preset') === id,
    'y anotado en los metadatos, que es lo que lee Restablecer',
    `quedo ${meta(BASE, 'demo_preset')}`);

  const modulo = sql(BASE,
    "SELECT enabled FROM dbo.business_modules WHERE module_key = 'servicios'")[0]?.enabled;
  check(String(modulo) === '1' || String(modulo).toLowerCase() === 'true',
    'y el modulo Servicios quedo encendido en el mismo movimiento', `enabled = ${modulo}`);

  check(meta(BASE, 'is_demo') === 'true', 'lleva el marcador is_demo');

  // --- el negocio ---------------------------------------------------------
  /* La comparacion la hace SQL SERVER, no JavaScript.
     Leer el nombre de vuelta significa cruzar la salida de PowerShell, que
     sale en la pagina de codigos de la consola y se come los acentos:
     «Estetica» volvia con un rombo donde iba la e. El valor guardado estaba
     bien y la prueba decia que no, que es la peor forma de fallar. Mandando
     el literal hacia SQL Server -como hacen las demas comprobaciones de este
     archivo- el texto viaja por el mismo camino que lo escribio. */
  const bienLlamado = contar(BASE, 'business_config',
    `business_name = N'${texto(e.negocio)}'`);
  check(bienLlamado === 1, `el negocio se llama ${e.negocio}`,
    `no hay ninguna fila con ese nombre`);

  // --- catalogo, gente y material ----------------------------------------
  const faltanServicios = e.servicios.filter(n =>
    contar(BASE, 'products p JOIN dbo.services s ON s.product_id = p.id',
      `p.nombre = N'${texto(n)}'`) === 0);
  check(faltanServicios.length === 0, `los ${e.servicios.length} servicios del giro existen`,
    faltanServicios.join(' · '));

  const faltanPros = e.profesionales.filter(n =>
    contar(BASE, 'professionals', `full_name = N'${texto(n)}'`) === 0);
  check(faltanPros.length === 0, `y ${e.profesionales.length === 1 ? 'la persona que trabaja' : 'las personas que trabajan'}`,
    faltanPros.join(' · '));

  const conHorario = contar(BASE, 'professional_schedules');
  check(conHorario > 0, 'con horario, para que la agenda tenga columnas', `${conHorario} franjas`);

  const faltanProd = e.productos.filter(p =>
    contar(BASE, 'products', `part_number = N'${texto(p)}'`) === 0);
  check(faltanProd.length === 0, `y el material que se cobra aparte (${e.productos.length})`,
    faltanProd.join(' · '));

  // --- lo que entra a trabajarse -----------------------------------------
  const activos = contar(BASE, 'customer_assets');
  if (e.activos.exactamente !== undefined) {
    check(activos === e.activos.exactamente,
      'no se siembra nada sobre lo que trabajar, que es lo propio de este giro',
      `hay ${activos}`);
  } else {
    check(activos >= e.activos.minimo, `hay ${e.activos.minimo} o mas cosas registradas`, `hay ${activos}`);
    const clase = sql(BASE,
      `SELECT kind FROM dbo.customer_assets WHERE identifier = N'${texto(e.activos.identificador)}'`)[0]?.kind;
    check(clase === e.activos.clase,
      `y ${e.activos.identificador} es de clase ${e.activos.clase}`, `es ${clase}`);
  }

  // --- ninguna orden hecha ------------------------------------------------
  check(contar(BASE, 'service_orders') === 0,
    'no se deja ninguna orden hecha: el recorrido se hace en vivo');
}

// ===========================================================================
console.log(`Servidor ${SERVIDOR}  ·  base ${BASE}`);

/*
 * Una corrida anterior interrumpida deja la base viva y sin nadie que la
 * reclame: el identificador de instancia esta en la base, pero el «registro
 * local» de esta prueba nace vacio en cada proceso, asi que las guardas se
 * negarian a tocarla y la prueba no podria ni empezar.
 *
 * Se adopta, y se dice en voz alta. Esto es legitimo AQUI y no lo seria en el
 * gestor: el gestor se niega a adoptar porque no sabe de donde salio la base;
 * esta prueba sabe perfectamente de donde salio, porque la unica cosa que
 * crea `Wybix_Demo_Servicios` con este nombre es ella misma o el gestor, y en
 * los dos casos es desechable. La guarda que de verdad protege -que no sea
 * una base del producto- sigue delante y no se afloja.
 */
if (existe(BASE)) {
  const marcador = meta(BASE, 'is_demo');
  const instancia = meta(BASE, 'demo_instance_id');
  if (marcador === 'true' && instancia) {
    REGISTRO.set(PERFIL, instancia);
    console.log(`   …      ${BASE} quedo de una corrida anterior: se adopta para limpiarla`);
  } else {
    console.error(`${BASE} existe y NO lleva el marcador de demo. No se toca. ` +
                  'Miradla a mano antes de volver a ejecutar esto.');
    process.exit(1);
  }
}
const giros = SOLO ? [SOLO] : PRESETS.IDS;
if (SOLO && !PRESETS.IDS.includes(SOLO)) {
  console.error(`No existe el giro ${SOLO}. Los que hay: ${PRESETS.IDS.join(', ')}`);
  process.exit(1);
}

try {
  for (const id of giros) {
    const previo = eliminar();
    if (!previo.ok) throw new Error(`No se pudo limpiar antes de ${id}: ${previo.motivo}`);
    comprobarGiro(id);

    // ------------------------------------------------- restablecer
    seccion(`${id} · restablecer conserva el giro`);
    const antes = meta(BASE, 'demo_preset');
    const instanciaVieja = meta(BASE, 'demo_instance_id');
    /* Exactamente lo que hace el gestor: lee el giro ANTES de tirar la base y
       rehace con ese mismo, sin volver a preguntar. */
    const r = eliminar();
    check(r.ok && r.borrada, 'la base se pudo tirar pasando por las cuatro guardas', r.motivo);
    crear(perfilDeDisco(), antes);
    check(meta(BASE, 'demo_preset') === id, 'y vuelve con el mismo giro');
    check(meta(BASE, 'demo_instance_id') !== instanciaVieja,
      'con un identificador de instancia NUEVO: es otra base, no la de antes');
    check(contar(BASE, 'service_orders') === 0, 'y sin nada de la sesion anterior');

    /* Eliminar tiene que llevarse ESTA base y nada mas. Si la maquina tiene
       otras demos -Retail, Hospitality-, siguen ahi despues. */
    const vecinasAntes = otrasDemos();
    const ultimo = eliminar();
    check(ultimo.ok, `${BASE} eliminada al terminar ${id}`, ultimo.motivo);
    check(!existe(BASE), 'y ya no existe');
    const vecinasDespues = otrasDemos();
    check(vecinasAntes.join('|') === vecinasDespues.join('|'),
      'y no se llevo por delante ninguna otra demo',
      `antes: ${vecinasAntes.join(', ') || '(ninguna)'} · despues: ${vecinasDespues.join(', ') || '(ninguna)'}`);
  }

  // ---------------------------------------------------------------------
  if (!SOLO) {
    seccion('Cambiar de giro no deja nada del anterior');
    const perfil = perfilDeDisco();
    crear(perfil, 'TALLER_AUTOMOTRIZ');
    check(contar(BASE, 'customer_assets', "identifier = N'ABC-123'") === 1,
      'el taller tiene su Mazda con placa ABC-123');

    const r = eliminar();
    check(r.ok && r.borrada, 'se elimina la demo del taller', r.motivo);

    crear(perfil, 'BELLEZA');
    check(contar(BASE, 'customer_assets') === 0,
      'la barberia NO hereda el coche del taller',
      'una demo que arrastra datos del giro anterior es peor que no tener demo');
    check(contar(BASE, 'products', "part_number = N'ACEITE-5W30'") === 0,
      'ni su aceite');
    check(contar(BASE, 'professionals', "full_name = N'Carlos Ramírez'") === 0,
      'ni su mecanico');
    check(sql(BASE, 'SELECT preset FROM dbo.services_config WHERE id = 1')[0]?.preset === 'BELLEZA',
      'y el giro guardado es el nuevo');

    const fin = eliminar();
    check(fin.ok, 'y se limpia al terminar', fin.motivo);
  }
} finally {
  /* Pase lo que pase, la base de pruebas no se queda ocupando disco. Si las
     guardas se negaran a borrarla, se dice: es informacion, no un fallo
     silencioso. */
  try {
    const r = eliminar();
    if (!r.ok) console.log(`   …      quedo ${BASE} sin borrar: ${r.motivo}`);
  } catch { /* noop */ }
}

console.log(`\n${fallos.length === 0 ? 'TODO BIEN' : 'HAY FALLOS'} · ${ok}/${ok + fallos.length}`);
process.exit(fallos.length === 0 ? 0 : 1);
