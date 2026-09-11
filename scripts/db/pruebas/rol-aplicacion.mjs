/**
 * EL ROL CON EL QUE OPERA UNA CAJA SECUNDARIA.
 *
 *     node scripts/db/pruebas/rol-aplicacion.mjs [--conservar]
 *
 * QUE SE ESTABA ROMPIENDO
 * -----------------------
 * `ocus_app_full_role` vivia UNICAMENTE dentro del `template.bak` hecho a
 * mano. `sql/permissions/ocus_app_full_role.sql` se escribio como su
 * definicion canonica -"si manana hay que reconstruir la base desde Git, los
 * permisos vienen con ella"- pero NADIE lo ejecutaba: ni el constructor del
 * baseline, ni el setup, ni una migracion.
 *
 * Mientras el template siguio siendo el artefacto heredado nadie lo noto. En
 * cuanto se reconstruyo desde Git, el rol desaparecio.
 *
 * Y lo peor no es que desapareciera, sino que NADA fallaba de forma visible:
 *
 *   - la caja principal entra por autenticacion de Windows y opera igual;
 *   - `ensureLogin` creaba el login y el usuario sin protestar, porque su
 *     `ALTER ROLE ADD MEMBER` iba dentro de un `IF EXISTS (rol)` que
 *     simplemente no hacia nada;
 *   - el problema aparecia semanas despues, en casa del cliente, el dia que
 *     conectaba la segunda caja: entraba y no podia leer ni escribir nada.
 *
 * QUE SE COMPRUEBA
 * ----------------
 * Los dos caminos, contra SQL de verdad:
 *
 *   INSTALACION LIMPIA   el baseline trae el rol con sus permisos y NO trae
 *                        la cuenta de red (esa la crea ensureLogin).
 *   UPGRADE              sobre una base que ya perdio el rol -el estado exacto
 *                        que reporto QA: `ocus_app` existe, el rol no- aplicar
 *                        el archivo canonico lo repara sin tocar nada mas.
 *
 * Y que los permisos son EFECTIVOS, no solo que las filas estan: se comprueba
 * con `EXECUTE AS USER`, que es lo unico que responde la pregunta real -"¿esta
 * cuenta podria vender?"- en vez de leer un catalogo y suponer.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const ARCHIVO_ROL = join('sql', 'permissions', 'ocus_app_full_role.sql');
const DB = 'Wybix_TmpRolApp';
const ROL = 'ocus_app_full_role';
const CUENTA = 'ocus_app';
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
const escalar = (sql) => { const f = q(sql)[0]; return f ? f[Object.keys(f)[0]] : null; };

/** Los 12 permisos que hacen util al rol. REFERENCES es el que rompio Hospitality. */
const ESPERADOS = [
  'SELECT@SCHEMA', 'INSERT@SCHEMA', 'UPDATE@SCHEMA', 'DELETE@SCHEMA',
  'EXECUTE@SCHEMA', 'ALTER@SCHEMA', 'REFERENCES@SCHEMA',
  'CREATE TABLE@DATABASE', 'CREATE VIEW@DATABASE', 'CREATE PROCEDURE@DATABASE',
  'CREATE FUNCTION@DATABASE', 'CREATE TYPE@DATABASE',
];

const existeRol = () => Number(escalar(
  `SELECT COUNT(*) FROM sys.database_principals WHERE name = '${ROL}' AND type = 'R';`)) > 0;
const existeCuenta = () => Number(escalar(
  `SELECT COUNT(*) FROM sys.database_principals WHERE name = '${CUENTA}';`)) > 0;
const esMiembro = () => Number(escalar(`
  SELECT COUNT(*) FROM sys.database_role_members rm
    JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
    JOIN sys.database_principals u ON u.principal_id = rm.member_principal_id
   WHERE r.name = '${ROL}' AND u.name = '${CUENTA}';`)) > 0;
const permisosDe = () => new Set(q(`
  SELECT p.permission_name + '@' + p.class_desc AS permiso
    FROM sys.database_permissions p
    JOIN sys.database_principals g ON g.principal_id = p.grantee_principal_id
   WHERE g.name = '${ROL}' AND p.state_desc = 'GRANT';`).map(r => r.permiso));
const faltantes = () => { const t = permisosDe(); return ESPERADOS.filter(p => !t.has(p)); };

/** Lo que hace `ensureRole`: ejecutar el ARCHIVO canonico, no una copia. */
const aplicarRolCanonico = () => {
  for (const lote of readFileSync(ARCHIVO_ROL, 'utf8')
      .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n?/gi)) {
    if (lote.trim()) q(lote);
  }
};

/**
 * Lo que de verdad importa: ¿podria esta cuenta operar?
 *
 * Leer `sys.database_permissions` dice que se concedio; `HAS_PERMS_BY_NAME`
 * bajo `EXECUTE AS USER` dice que se puede hacer. Son dos preguntas distintas
 * y solo la segunda es la que vive el cajero.
 */
const puedeLaCuenta = (permiso, clase = 'SCHEMA', objeto = 'dbo') => {
  const f = q(`
    EXECUTE AS USER = '${CUENTA}';
    SELECT HAS_PERMS_BY_NAME('${objeto}', '${clase}', '${permiso}') AS puede;
    REVERT;`)[0];
  return Number(f?.puede) === 1;
};

try {
  console.log(`\nEL ROL DE LA APLICACION   (${DB})`);

  if (!existsSync(BAK)) {
    console.log(`   ----   falta ${BAK}: es un artefacto derivado (npm run db:baseline).`);
    process.exit(0);
  }
  check(existsSync(ARCHIVO_ROL), `${ARCHIVO_ROL.split('\\').join('/')} existe`);
  restaurar(DB, BAK);

  // =============================================================== 1
  seccion('1. Instalacion limpia: el baseline trae el rol');
  check(existeRol(), `${ROL} viaja dentro del template`,
    'vivia solo en el .bak hecho a mano; ahora sale de Git');
  const fal = faltantes();
  check(fal.length === 0, `con sus ${ESPERADOS.length} permisos`, fal.length ? 'faltan: ' + fal.join(', ') : '');
  check(permisosDe().has('REFERENCES@SCHEMA'), 'incluido REFERENCES',
    'sin el, cualquier clave foranea de una migracion falla con un 1750 que no menciona permisos');
  check(!existeCuenta(), `${CUENTA} NO viaja en el template`,
    'el instalador no entrega credenciales: la cuenta la crea ensureLogin con la contrasena de red');

  // =============================================================== 2
  seccion('2. Alta de la caja secundaria (lo que hace ensureLogin)');
  // Sin login de servidor: aqui se comprueba la parte de BASE, que es la que
  // fallaba. `CREATE USER ... WITHOUT LOGIN` deja el mismo principal de base.
  q(`CREATE USER [${CUENTA}] WITHOUT LOGIN;`);
  q(`ALTER ROLE [${ROL}] ADD MEMBER [${CUENTA}];`);
  check(esMiembro(), `${CUENTA} queda dentro de ${ROL}`);

  for (const [permiso, etiqueta] of [['SELECT', 'leer'], ['INSERT', 'escribir'], ['EXECUTE', 'ejecutar procedures']]) {
    check(puedeLaCuenta(permiso), `y puede ${etiqueta} de verdad (EXECUTE AS USER)`, permiso);
  }
  check(puedeLaCuenta('REFERENCES'), 'y puede crear claves foraneas al migrarse', 'REFERENCES');

  // =============================================================== 3
  seccion('3. El estado que reporto QA: la cuenta existe y el rol NO');
  // Se reproduce exactamente: se saca la cuenta del rol y se borra el rol.
  q(`ALTER ROLE [${ROL}] DROP MEMBER [${CUENTA}];`);
  q(`DROP ROLE [${ROL}];`);
  check(existeCuenta() && !existeRol(), 'reproducido: ocus_app SQL_USER, sin ocus_app_full_role');
  check(!puedeLaCuenta('SELECT'), 'la cuenta no puede leer ni una fila',
    'este era el sintoma en el cliente: "la otra caja no ve nada"');

  // Y la razon por la que nadie se enteraba: el guardia viejo.
  const antes = existeCuenta();
  q(`IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${ROL}')
       ALTER ROLE [${ROL}] ADD MEMBER [${CUENTA}];`);
  check(!esMiembro() && existeCuenta() === antes,
    'el `IF EXISTS (rol) ALTER ROLE ADD MEMBER` viejo no hace NADA y no falla',
    'por eso el alta de la caja secundaria terminaba "bien" y la caja no servia');

  // =============================================================== 4
  seccion('4. Upgrade: aplicar el archivo canonico lo repara');
  aplicarRolCanonico();
  check(existeRol(), `${ROL} recreado desde ${ARCHIVO_ROL.split('\\').join('/')}`);
  const fal2 = faltantes();
  check(fal2.length === 0, `con los ${ESPERADOS.length} permisos completos`, fal2.length ? 'faltan: ' + fal2.join(', ') : '');

  q(`ALTER ROLE [${ROL}] ADD MEMBER [${CUENTA}];`);
  check(esMiembro(), `${CUENTA} vuelve a ser miembro`);
  check(puedeLaCuenta('SELECT') && puedeLaCuenta('EXECUTE'), 'y vuelve a poder operar');

  // =============================================================== 5
  seccion('5. Idempotente: se puede reejecutar');
  const permisosAntes = [...permisosDe()].sort().join(',');
  aplicarRolCanonico();
  aplicarRolCanonico();
  check([...permisosDe()].sort().join(',') === permisosAntes,
    'dos pasadas mas no cambian ni anaden nada');
  check(esMiembro(), 'y la membresia se conserva',
    'recrear el rol no puede echar a la cuenta que ya estaba dentro');
  check(Number(escalar(`
    SELECT COUNT(*) FROM sys.database_principals WHERE name = '${ROL}';`)) === 1,
    'sigue habiendo exactamente un rol, no dos');

  // =============================================================== 6
  seccion('6. El codigo ya no supone que el rol existe');
  const fuente = readFileSync(join('electron', 'setupServer.js'), 'utf8');
  check(/async function ensureRole\s*\(/.test(fuente),
    'setupServer expone ensureRole()', 'garantizarlo es un paso propio, no un efecto colateral');
  check(!/IF EXISTS \(SELECT 1 FROM sys\.database_principals WHERE name = 'ocus_app_full_role'\)\s*\n\s*ALTER ROLE/.test(fuente),
    'ensureLogin ya NO lleva el `IF EXISTS (rol)` que callaba el fallo');
  check(fuente.includes('permisos') && /ensureRole\(server, dbName\)/.test(fuente),
    'y ejecuta el archivo canonico en vez de repetir los GRANT en JavaScript',
    'dos listas de permisos en dos lenguajes divergen');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
