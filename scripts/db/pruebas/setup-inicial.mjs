/**
 * El giro elegido en la instalacion llega hasta la base.
 *
 *     node scripts/db/pruebas/setup-inicial.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * En la prueba sobre maquina limpia, un negocio de alimentos y bebidas
 * terminaba la instalacion como RETAIL: sin recetas, sin ingredientes y sin
 * modificadores, y sin ninguna senal de que se hubiera elegido otra cosa. La
 * cadena estaba rota en sus tres eslabones -componente, canal IPC y
 * procedimiento-, y el DEFAULT de la columna disimulaba el fallo.
 *
 * Un valor por defecto correcto es justo lo que hace invisible un dato
 * perdido. Por eso esta prueba no comprueba que la columna tenga "algo":
 * comprueba que tenga LO QUE SE ELIGIO, y lo hace con los dos giros.
 *
 * Corre sobre una restauracion del baseline -el mismo .bak que recibe un
 * cliente-, con las migraciones aplicadas encima. Cada escenario vive dentro
 * de una transaccion que se deshace, asi que los cuatro parten de una base sin
 * configurar, que es la unica situacion en la que sp_setup_inicial actua.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpSetup';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n── ${t}`);

const q = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets.length ? r.sets[0] : [];
};

/**
 * Ejecuta el alta y devuelve lo que quedo escrito, sin dejar rastro: la
 * transaccion externa envuelve la interna del procedimiento y se deshace.
 */
function altaYDeshacer(params) {
  const r = consultarTemporal(DB, `
    BEGIN TRAN;
    EXEC dbo.sp_setup_inicial
         @usuario = N'admin', @password = N'secreta1',
         @business_name = N'Prueba'${params};
    SELECT business_name, business_profile FROM dbo.business_config;
    ROLLBACK;`);
  if (!r.ok) throw new Error(limpiar(r.error));
  // El procedimiento devuelve su propio SELECT (user_id) antes que el nuestro:
  // hay que leer el ULTIMO conjunto, no el primero.
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

try {
  console.log(`\nEL GIRO ELEGIDO LLEGA A LA BASE   (${DB})`);

  seccion('1. Base recien instalada');
  if (!existsSync(BAK)) {
    console.log(`   ----   falta ${BAK}: es un artefacto derivado (npm run db:baseline).`);
    process.exit(0);
  }
  restaurar(DB, BAK);
  check(true, 'baseline restaurado', BAK);

  // Las migraciones productivas van encima, igual que al abrir la aplicacion.
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  const pendientes = readdirSync(DIR_MIG, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
    .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en'))
    .filter(f => !aplicadas.has(f));
  for (const f of pendientes) {
    // Cada lote por separado: CREATE OR ALTER PROCEDURE tiene que ser la
    // primera sentencia de su lote, asi que no se pueden pegar con `;`.
    // MISMA regla que electron/migrationsRunner.js. Con un separador mas
    // permisivo, un archivo que el runner rechaza pasaria aqui: la prueba
    // seria mas indulgente que produccion, que es la peor clase de verde.
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8')
        .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(lote);
    }
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }
  console.log(`   ${aplicadas.size} migraciones ya en el baseline, ${pendientes.length} aplicadas ahora`);

  seccion('2. El procedimiento acepta el giro');
  const par = q(`
    SELECT p.name, TYPE_NAME(p.user_type_id) AS tipo, p.has_default_value
    FROM sys.parameters p
    WHERE p.object_id = OBJECT_ID('dbo.sp_setup_inicial') AND p.name = '@business_profile';`);
  check(par.length === 1, 'sp_setup_inicial recibe @business_profile');
  check(par[0]?.tipo === 'nvarchar', 'declarado como nvarchar', par[0]?.tipo);

  seccion('3. Alimentos y bebidas');
  let r = altaYDeshacer(`, @business_profile = N'HOSPITALITY'`);
  check(r[0]?.business_profile === 'HOSPITALITY',
    'un negocio HOSPITALITY nace HOSPITALITY', `quedo: ${r[0]?.business_profile}`);

  seccion('4. Tienda o comercio');
  r = altaYDeshacer(`, @business_profile = N'RETAIL'`);
  check(r[0]?.business_profile === 'RETAIL',
    'un negocio RETAIL nace RETAIL', `quedo: ${r[0]?.business_profile}`);

  seccion('5. Sin el parametro: nada cambia para quien ya llamaba');
  r = altaYDeshacer('');
  check(r[0]?.business_profile === 'RETAIL',
    'omitirlo se comporta como antes (RETAIL)', `quedo: ${r[0]?.business_profile}`);

  seccion('6. Un valor que no existe se rechaza');
  const mal = consultarTemporal(DB, `
    EXEC dbo.sp_setup_inicial @usuario = N'admin', @password = N'secreta1',
         @business_name = N'Prueba', @business_profile = N'RESTAURANTE';`);
  check(!mal.ok, 'se rechaza en vez de escribirlo');
  check(/RETAIL o HOSPITALITY/.test(limpiar(mal.error || '')),
    'y el mensaje dice que valores se esperaban');
  const tras = q('SELECT COUNT(*) AS n FROM dbo.users;');
  check(Number(tras[0]?.n) === 0, 'y no deja ni el usuario a medias', `users: ${tras[0]?.n}`);

  seccion('7. Lo que leera la aplicacion');
  // caps.hospitality sale de getConfig -> sp_get_business_config -> esta misma
  // columna. Si el SELECT no la trajera, la pantalla seguiria sin Hospitality
  // aunque la base estuviera bien.
  const cols = q(`
    SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.business_config');`).map(c => c.name);
  check(cols.includes('business_profile'), 'business_config expone business_profile');
  const cuerpo = q(`SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_get_business_config')) AS d;`)[0]?.d || '';
  check(/SELECT\s+TOP\s+1\s+\*/i.test(cuerpo) || /business_profile/i.test(cuerpo),
    'sp_get_business_config devuelve la columna al renderer');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
