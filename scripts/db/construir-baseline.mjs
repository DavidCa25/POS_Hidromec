/**
 * Construye WYBIX DATABASE BASELINE V1 desde Git.
 *
 *     node scripts/db/construir-baseline.mjs [--conservar] [--salida <ruta.bak>]
 *
 * Levanta una base temporal VACIA y la llena unicamente con lo que hay en el
 * repositorio, en este orden:
 *
 *     sql/schema/tables/          tablas -> CHECK -> FK -> indices
 *     sql/types/                  tipos de tabla
 *     sql/procedures/             procedures desplegables (current + incierto)
 *     sql/baseline/v1/00_*.sql    schema_migrations + database_metadata
 *     sql/baseline/v1/01_seed.sql seed estructural
 *     sql/permissions/            el rol con el que opera la aplicacion
 *
 * y solo si todo verifica, saca un `.bak`.
 *
 * El baseline NUNCA se genera copiando una base existente. `Wybix_Production`,
 * `Hidromec_DataBase` y `Wybix_Template` arrastran historial de desarrollo:
 * filas en `schema_migrations`, procedures de pruebas y objetos que ya nadie
 * invoca. Partir de una base vacia es lo que hace que el `.bak` resultante sea
 * un derivado de Git, y no al reves.
 *
 * `lib/temporal.mjs` rechaza cualquier nombre que no sea claramente temporal,
 * asi que este script no puede escribir sobre una base viva ni por error.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { crearVacia, eliminar, ejecutarVarios, respaldar } from './lib/temporal.mjs';
import { consultar } from './lib/sql.mjs';
import { leerEsquema, huellaTabla } from './lib/esquema.mjs';
import { checksum, desenvolver } from './lib/canonico.mjs';
import { fases, ORDEN } from './lib/fases.mjs';
import { repartirPorClase, lineasDeClase } from './lib/catalogo.mjs';

const VERSION = 1;
const TMP = 'Wybix_TmpBaseline';
const CONSERVAR = process.argv.includes('--conservar');
const iSal = process.argv.indexOf('--salida');
// Escribe directamente sobre el template oficial. Solo puede haber UNO: es
// el unico archivo que `setupServer.js` consume y el unico que viaja en el
// instalador (package.json -> extraResources). Dos artefactos equivalentes
// solo sirven para divergir. El BACKUP se ejecuta al final y unicamente si
// la verificacion paso, asi que un fallo nunca deja el template a medias.
const SALIDA = iSal > 0 ? process.argv[iSal + 1] : join('installer', 'template.bak');
const DIR_BASELINE = join('sql', 'baseline', `v${VERSION}`);
const DIR_MIGRACIONES = join('electron', 'migrations');

let fallos = 0;
const mal = (t) => { console.log(`   FALLA  ${t}`); fallos++; };
const bien = (t) => console.log(`   ok     ${t}`);
const paso = (t) => console.log(`\n-- ${t}`);
const corto = (e) => String(e).split('\n')[0].replace(/^Excepci.n al llamar a "\w+" con los argumentos "\d+": /, '').slice(0, 120);

/** Rutas siempre con `/`: el manifiesto las guarda asi y Windows usa `\`. */
const barras = (p) => String(p).split('\\').join('/');

const manifiesto = JSON.parse(readFileSync('sql/manifest.json', 'utf8'));
const procesos = manifiesto.objetos.filter(o => o.tipo === 'SQL_STORED_PROCEDURE');

/** Parte un archivo `.sql` en los lotes que separa GO. */
const lotesDe = (texto) =>
  texto.replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n?/gi).map(s => s.trim()).filter(Boolean);

/** Aplica un archivo y devuelve el primer error, si lo hubo. */
function aplicarArchivo(ruta) {
  const r = ejecutarVarios(TMP, lotesDe(readFileSync(ruta, 'utf8')));
  const primerFallo = r.find(x => !x.ok);
  return primerFallo ? { ok: false, error: corto(primerFallo.error) } : { ok: true };
}

try {
  console.log(`\nWYBIX DATABASE BASELINE V${VERSION}`);
  console.log(`Fuente: el arbol de Git.  Destino: ${SALIDA}`);

  paso('1. Base temporal limpia');
  crearVacia(TMP);
  bien(`${TMP} creada, vacia, con colacion Modern_Spanish_CI_AS`);

  paso('2. Esquema desde sql/schema/tables/');
  const dirT = join('sql', 'schema', 'tables');
  const todo = { tabla: [], check: [], fk: [], indice: [] };
  for (const f of readdirSync(dirT).filter(x => x.endsWith('.sql')).sort()) {
    const p = fases(readFileSync(join(dirT, f), 'utf8'));
    for (const k of ORDEN) todo[k].push(...p[k]);
  }
  for (const fase of ORDEN) {
    const r = ejecutarVarios(TMP, todo[fase]);
    const err = r.filter(x => !x.ok);
    if (err.length) {
      mal(`fase ${fase}: ${err.length} de ${todo[fase].length} fallaron`);
      console.log(`          ${corto(err[0].error)}`);
    } else bien(`fase ${fase}: ${todo[fase].length} sentencias`);
  }

  paso('3. Tipos de tabla desde sql/types/');
  const dirTy = join('sql', 'types');
  const tiposArch = readdirSync(dirTy).filter(x => x.endsWith('.sql')).sort();
  let errT = 0;
  for (const f of tiposArch) {
    const r = aplicarArchivo(join(dirTy, f));
    if (!r.ok) { errT++; console.log(`          ${f}: ${r.error}`); }
  }
  if (errT) mal(`${errT} tipos fallaron`); else bien(`${tiposArch.length} tipos creados`);

  paso('4. Procedures desplegables desde sql/procedures/');

  /* ------------------------------------------------------------------------
     EL ARBOL Y EL MANIFIESTO TIENEN QUE DECIR LO MISMO.

     Este paso dice "desde sql/procedures/", pero la lista real sale del
     MANIFIESTO. Mientras los dos coincidan da igual; cuando no coinciden, el
     baseline deja fuera el procedure en silencio y ademas marca su migracion
     como aplicada (paso 7). Una instalacion nueva se queda entonces sin el
     objeto y sin forma de repararlo: la migracion que lo crearia ya figura
     puesta.

     No es hipotetico. Paso dos veces seguidas:

       sp_get_product_dependencies   lo llama `sp-delete-product`
       sp_register_lease_touch       lo llaman `sp_register_sale` y
                                     `sp_open_shift` en CADA venta y turno

     Los dos tenian su archivo canonico y su migracion, y los dos faltaban en
     el `.bak`. El segundo solo salto porque es critico; el primero llevaba una
     ronda entera sin que nadie lo notara.

     La causa de fondo es que el manifiesto se genera desde una base de
     referencia (`db:extract`), asi que un objeto nuevo no entra en el hasta
     que esa base recibe la migracion. Eso es correcto y no se cambia: lo que
     no puede ser es que la diferencia salga barata. Aqui se detiene la
     construccion y se dice exactamente que ejecutar.
     ------------------------------------------------------------------------ */
  const enManifiesto = new Set(procesos.map(o => barras(o.archivo)));
  const enDisco = [];
  (function recorrer(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      // `_cuarentena` guarda a proposito lo que el baseline no despliega.
      if (e.isDirectory()) { if (e.name !== '_cuarentena') recorrer(ruta); }
      else if (e.name.toLowerCase().endsWith('.sql')) enDisco.push(barras(ruta));
    }
  })(join('sql', 'procedures'));

  const huerfanos = enDisco.filter(f => !enManifiesto.has(f));
  if (huerfanos.length) {
    mal(`${huerfanos.length} procedure(s) del arbol canonico NO estan en sql/manifest.json:`);
    for (const f of huerfanos) console.log(`          ${f}`);
    console.log('          El baseline los dejaria fuera del .bak EN SILENCIO, y el paso 7');
    console.log('          marcaria su migracion como aplicada: una instalacion nueva se');
    console.log('          quedaria sin el objeto y sin forma de repararlo.');
    console.log('          Regenera el manifiesto por su proceso normal:');
    console.log('            node scripts/db/aplicar-migraciones.mjs --base Wybix_Production --si');
    console.log('            npm run db:extract && npm run db:extract-schema');
  } else {
    bien(`los ${enDisco.length} procedures del arbol estan declarados en el manifiesto`);
  }

  const clases = repartirPorClase(procesos);
  console.log(lineasDeClase(clases));
  const desplegables = clases.desplegables;
  const fallidos = [];
  const plan = [];   // una entrada por lote, con su procedure de origen
  for (const o of desplegables) {
    if (!existsSync(o.archivo)) { fallidos.push([o.nombre, 'sin archivo']); continue; }
    for (const l of lotesDe(readFileSync(o.archivo, 'utf8'))) plan.push({ nombre: o.nombre, sql: l });
  }
  const res = ejecutarVarios(TMP, plan.map(x => x.sql));

  // Ocho procedures de Wybix estan creados por error en la base `master`. Por
  // la resolucion especial de nombres `sp_`, un CREATE OR ALTER sobre una base
  // donde aun no existen resuelve contra la copia de master y falla con el
  // error 208. `CREATE` a secas no sufre esa resolucion. Se reintenta el
  // archivo entero, no solo el lote roto: las opciones SET del primer lote son
  // las que quedan grabadas con el procedure.
  const porMaster = new Set();
  const rotos = new Map();
  res.forEach((r, i) => {
    if (r.ok) return;
    const { nombre, sql } = plan[i];
    if (/Invalid object name .dbo\.sp_/i.test(r.error) && /CREATE OR ALTER\s+PROCEDURE/i.test(sql)) porMaster.add(nombre);
    else if (!rotos.has(nombre)) rotos.set(nombre, corto(r.error));
  });

  const enMaster = [];
  for (const nombre of porMaster) {
    const o = desplegables.find(x => x.nombre === nombre);
    const lotes = lotesDe(readFileSync(o.archivo, 'utf8'))
      .map(l => l.replace(/CREATE OR ALTER(\s+)PROCEDURE/i, 'CREATE$1PROCEDURE'));
    const r2 = ejecutarVarios(TMP, lotes);
    const f2 = r2.find(x => !x.ok);
    if (f2) rotos.set(nombre, corto(f2.error)); else enMaster.push(nombre);
  }
  for (const [n, e] of rotos) fallidos.push([n, e]);

  if (fallidos.length) {
    mal(`${fallidos.length} de ${desplegables.length} procedures no compilaron`);
    for (const [n, e] of fallidos) console.log(`          ${n}: ${e}`);
  } else bien(`${desplegables.length} de ${procesos.length} procedures desplegados`);
  if (enMaster.length) {
    console.log(`          AVISO: ${enMaster.length} exigieron CREATE en vez de CREATE OR ALTER porque`);
    console.log(`          tambien existen en master: ${enMaster.sort().join(', ')}`);
  }

  paso('5. Infraestructura de versionado');
  for (const f of readdirSync(DIR_BASELINE).filter(x => /^00_/.test(x) && x.endsWith('.sql')).sort()) {
    const r = aplicarArchivo(join(DIR_BASELINE, f));
    if (r.ok) bien(f); else mal(`${f}: ${r.error}`);
  }

  paso('6. Seed estructural');
  const rs = aplicarArchivo(join(DIR_BASELINE, '01_seed.sql'));
  if (rs.ok) bien('01_seed.sql'); else mal(`01_seed.sql: ${rs.error}`);

  // El baseline se construye desde el arbol canonico, asi que su esquema YA
  // incluye todo lo que aportan las migraciones existentes. Registrarlas evita
  // dos cosas: que una instalacion nueva reejecute 89 lotes que no cambian
  // nada, y -sobre todo- que `schema_migrations` mienta. Un tecnico que abra
  // esa tabla tiene que ver el estado real del esquema que tiene delante.
  //
  // Las migraciones siguen en Git y se aplican igual sobre instalaciones
  // anteriores: esto solo declara lo que el template ya trae puesto.
  /* ------------------------------------------------------------------------
     EL ROL CON EL QUE OPERA LA APLICACION.

     `ocus_app_full_role` vivia UNICAMENTE dentro del template.bak hecho a
     mano. `sql/permissions/ocus_app_full_role.sql` se escribio como su
     definicion canonica -"si manana hay que reconstruir la base desde Git,
     los permisos vienen con ella"- pero NADIE lo ejecutaba: ni el baseline,
     ni el setup, ni una migracion.

     Mientras el template fue el artefacto heredado no se noto. En cuanto se
     reconstruyo desde Git, el rol desaparecio: una instalacion limpia nacia
     sin rol y sin permisos. La principal seguia funcionando -entra por
     autenticacion de Windows- pero `ensureLogin` creaba `ocus_app` y luego
     `IF EXISTS (rol) ALTER ROLE ADD MEMBER` no hacia nada, asi que la caja
     secundaria conectaba con una cuenta que solo podia hacer CONNECT. El
     sintoma habria sido "la secundaria no ve nada", en el cliente.

     El USUARIO no se siembra aqui a proposito: lo crea `ensureLogin` cuando
     hay una contrasena de red, que es el unico momento en que hace falta. Un
     usuario huerfano en el template obligaria ademas a remapear su SID, y
     `ALTER USER ... WITH LOGIN` no admite usuarios creados sin login.
     ------------------------------------------------------------------------ */
  paso('7. Rol de la aplicacion (sql/permissions/)');
  const ARCHIVO_ROL = join('sql', 'permissions', 'ocus_app_full_role.sql');
  if (!existsSync(ARCHIVO_ROL)) {
    mal(`no se encontro ${barras(ARCHIVO_ROL)}: el baseline nacería sin rol de aplicacion`);
  } else {
    const rRol = aplicarArchivo(ARCHIVO_ROL);
    if (rRol.ok) bien('ocus_app_full_role.sql');
    else mal(`ocus_app_full_role.sql: ${rRol.error}`);
  }

  paso('8. Migraciones que este baseline ya incluye');
  const migraciones = readdirSync(DIR_MIGRACIONES).filter(f => f.endsWith('.sql')).sort();
  if (!migraciones.length) {
    bien('no hay migraciones que registrar');
  } else {
    const valores = migraciones.map(f => `(N'${f.replace(/'/g, "''")}')`).join(', ');
    const r = ejecutarVarios(TMP, [`
      INSERT INTO dbo.schema_migrations (filename)
      SELECT v.filename FROM (VALUES ${valores}) AS v(filename)
      WHERE NOT EXISTS (SELECT 1 FROM dbo.schema_migrations m WHERE m.filename = v.filename);`]);
    if (r[0].ok) bien(`${migraciones.length} migraciones registradas: ${migraciones.join(', ')}`);
    else mal(`no se pudieron registrar las migraciones: ${corto(r[0].error)}`);
  }

  paso('9. Verificacion');
  const esqBase = new Map(leerEsquema(TMP).map(t => [t.nombre, t]));
  let tOk = 0;
  const tDif = [];
  const tFalta = [];
  for (const o of manifiesto.esquema.objetos) {
    const t = esqBase.get(o.nombre);
    if (!t) { tFalta.push(o.nombre); continue; }
    const h = createHash('sha256').update(huellaTabla(t), 'utf8').digest('hex').slice(0, 16);
    if (h === o.checksum) tOk++; else tDif.push(o.nombre);
  }
  if (tFalta.length) mal(`tablas ausentes: ${tFalta.join(', ')}`);
  if (tDif.length) mal(`tablas con estructura distinta: ${tDif.join(', ')}`);
  if (!tFalta.length && !tDif.length) bien(`${tOk} tablas identicas a Git`);

  const mods = new Map(consultar(TMP, `
    SELECT o.name, m.definition AS def FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.schema_id = SCHEMA_ID('dbo');`).map(r => [r.name, r.def]));
  let pOk = 0;
  const pDif = [];
  for (const o of desplegables) {
    const b = mods.get(o.nombre);
    if (!b) { pDif.push(o.nombre); continue; }
    const g = desenvolver(readFileSync(o.archivo, 'utf8'));
    if (g && checksum(g) === checksum(b)) pOk++; else pDif.push(o.nombre);
  }
  if (pDif.length) mal(`procedures que no coinciden con Git: ${pDif.join(', ')}`);
  else bien(`${pOk} procedures identicos a Git`);

  const noDeben = clases.noDesplegables.filter(o => mods.has(o.nombre)).map(o => o.nombre);
  if (noDeben.length) mal(`objetos no desplegables presentes en la base: ${noDeben.join(', ')}`);
  else bien('ningun objeto futuro ni legacy se colo en el baseline');

  /* El rol tiene que estar Y tener sus permisos. Existir vacio seria peor que
     no existir: `ensureLogin` metería a `ocus_app` dentro y la caja secundaria
     conectaria creyendo que puede operar. */
  const ROL = 'ocus_app_full_role';
  const hayRol = consultar(TMP, `
    SELECT name FROM sys.database_principals WHERE name = '${ROL}' AND type = 'R';`).length > 0;
  if (!hayRol) {
    mal(`el rol ${ROL} no existe: una instalacion limpia nacería sin permisos de aplicacion`);
  } else {
    const ESPERADOS = [
      'SELECT@SCHEMA', 'INSERT@SCHEMA', 'UPDATE@SCHEMA', 'DELETE@SCHEMA',
      'EXECUTE@SCHEMA', 'ALTER@SCHEMA', 'REFERENCES@SCHEMA',
      'CREATE TABLE@DATABASE', 'CREATE VIEW@DATABASE', 'CREATE PROCEDURE@DATABASE',
      'CREATE FUNCTION@DATABASE', 'CREATE TYPE@DATABASE',
    ];
    const tiene = new Set(consultar(TMP, `
      SELECT p.permission_name + '@' + p.class_desc AS permiso
        FROM sys.database_permissions p
        JOIN sys.database_principals g ON g.principal_id = p.grantee_principal_id
       WHERE g.name = '${ROL}' AND p.state_desc = 'GRANT';`).map(r => r.permiso));
    const faltan = ESPERADOS.filter(p => !tiene.has(p));
    if (faltan.length) mal(`a ${ROL} le faltan permisos: ${faltan.join(', ')}`);
    else bien(`${ROL} existe con sus ${ESPERADOS.length} permisos`);
  }

  const criticos = manifiesto.objetos.filter(o => o.critico).map(o => o.nombre);
  const tipos = consultar(TMP, `SELECT name FROM sys.table_types WHERE schema_id = SCHEMA_ID('dbo');`);
  const ausentes = criticos.filter(n => !mods.has(n) && !tipos.some(t => t.name === n));
  if (ausentes.length) mal(`criticos ausentes: ${ausentes.join(', ')}`);
  else bien(`los ${criticos.length} objetos criticos estan presentes`);

  // Ninguna tabla puede traer datos salvo las que el seed siembra a proposito.
  const conFilas = consultar(TMP, `
    SELECT t.name AS tabla, SUM(p.rows) AS filas
      FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
     WHERE t.schema_id = SCHEMA_ID('dbo')
     GROUP BY t.name HAVING SUM(p.rows) > 0 ORDER BY t.name;`);
  // Lo unico que puede traer filas es el seed estructural: cosas sin las que
  // el producto no arranca, nunca datos de un negocio.
  //   registers          la caja 1, que sp_register_sale necesita resolver
  //   register_assignments  su arriendo, LIBRE. El invariante del arriendo es
  //                      que toda caja tiene su fila; sin ella, la unica caja
  //                      de una instalacion nueva seria la unica sin arriendo.
  //   WA_Configuracion   la fila unica de configuracion de WhatsApp
  //   database_metadata  version del baseline
  //   uoms               catalogo de unidades (pieza, gramo, litro, metro...).
  //                      Es estructura: sin el no se puede escribir una receta.
  //   schema_migrations  las migraciones que este baseline ya trae aplicadas
  const SEMBRADAS = {
    registers: 1, register_assignments: 1, WA_Configuracion: 1, database_metadata: 1, uoms: 14,
    schema_migrations: migraciones.length,
  };
  for (const f of conFilas) console.log(`          ${String(f.filas).padStart(3)}  ${f.tabla}`);
  const sobra = conFilas.filter(f => SEMBRADAS[f.tabla] !== Number(f.filas));
  if (sobra.length) mal(`filas inesperadas: ${sobra.map(f => `${f.tabla}(${f.filas})`).join(', ')}`);
  else bien('solo hay seed estructural: 0 datos de demo, 0 datos de usuario');

  // La tabla tiene que describir el esquema que se esta entregando: ni una
  // migracion de menos (el runner la reaplicaria sin necesidad) ni una de mas
  // (declararia un cambio que este .bak no trae).
  const mig = Number(consultar(TMP, `SELECT COUNT(*) AS n FROM dbo.schema_migrations;`)[0].n);
  if (mig === migraciones.length) bien(`schema_migrations declara las ${mig} migraciones que este baseline ya trae puestas`);
  else mal(`schema_migrations trae ${mig} filas, se esperaban ${migraciones.length}`);

  const bv = consultar(TMP, `SELECT valor FROM dbo.database_metadata WHERE clave = 'baseline_version';`);
  if (bv[0] && bv[0].valor === String(VERSION)) bien(`database_metadata.baseline_version = ${VERSION}`);
  else mal(`baseline_version = ${bv[0] ? bv[0].valor : '(ausente)'}`);

  paso('10. Respaldo');
  if (fallos) {
    console.log('   omitido: la verificacion no paso, no se genera .bak');
  } else {
    respaldar(TMP, SALIDA, { nombreLogico: `Wybix Baseline V${VERSION}` });
    const kb = Math.round(readFileSync(SALIDA).length / 1024);
    bien(`${SALIDA} generado (${kb} KB)`);
  }
} finally {
  if (!CONSERVAR) {
    try { eliminar(TMP); console.log(`\nBase temporal ${TMP} eliminada.`); }
    catch (e) { console.log('\nNo se pudo eliminar:', e.message); }
  } else console.log(`\nBase temporal ${TMP} conservada.`);
}

console.log(fallos
  ? `\nRESULTADO: ${fallos} FALLO(S) - no hay baseline`
  : `\nRESULTADO: PASS - Baseline V${VERSION} construido solo desde Git`);
process.exit(fallos ? 1 : 0);
