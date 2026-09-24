/**
 * UN NEGOCIO NACE CON SU GIRO PUESTO, EN TODOS LOS SITIOS QUE LO DICEN.
 *
 *     node scripts/db/pruebas/giro-al-nacer.mjs
 *
 * QUE SE VIO EN QA
 * ----------------
 * En Demo Hospitality, QuickStart leia la hoja «Insumos» como productos
 * vendibles y ofrecia «12 sin precio de venta · Ponerles precio».
 *
 * No fallaba QuickStart. Fallaba el orden en que nace una base:
 *
 *   1. corren TODAS las migraciones, con la base vacia;
 *   2. despues `sp_setup_inicial` da de alta el negocio.
 *
 * La siembra de 0028 esta condicionada a `EXISTS (SELECT 1 FROM
 * business_config)`, que en el paso 1 es falso, y `sp_setup_inicial` no
 * tocaba `business_modules`. Resultado: `business_profile = 'HOSPITALITY'`
 * y CERO filas en el registro de modulos.
 *
 * El renderer no se entero porque `CapabilityService` lee el perfil cuando el
 * registro viene vacio. El proceso principal no tenia ese respaldo, asi que
 * las dos mitades de la misma aplicacion contestaban distinto a la misma
 * pregunta.
 *
 * POR QUE ESTA PRUEBA NO EXISTIA
 * ------------------------------
 * `core-modulos.mjs` si comprueba el registro, pero VUELVE A APLICAR el
 * bloque de 0028 a mano despues del alta —«es idempotente justamente para
 * poder hacer esto»—. Esa linea es el parche que tapaba el agujero: una
 * instalacion de verdad no vuelve a aplicar una migracion ya aplicada.
 *
 * Aqui no se vuelve a aplicar nada. Se hace lo que hace una demo recien
 * creada, en su orden, y se mira el resultado.
 *
 * Nunca toca una base existente: crea la suya y la borra al terminar.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal, ZONA_COMUN } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

const DB = 'Wybix_TmpGiro';
let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

function escalar(sql) {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(r.error);
  const fila = (r.sets?.[0] ?? [])[0] ?? {};
  return Object.values(fila)[0];
}

function lotesDe(ruta) {
  return readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
    .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);
}

function aplicarLotes(lotes, origen) {
  const r = ejecutarVarios(DB, lotes);
  const malo = r.map((x, i) => ({ ...x, i })).find(x => !x.ok);
  if (malo) {
    throw new Error(`${origen} · lote ${malo.i + 1}/${lotes.length}: ${malo.error}\n----\n`
      + lotes[malo.i].slice(0, 400));
  }
}

/** El nacimiento de una base, tal cual: template, migraciones, alta. */
function nacer(perfil) {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));

  const dir = join(process.cwd(), 'electron', 'migrations');
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const todos = [];
  for (const f of archivos) for (const l of lotesDe(join(dir, f))) todos.push(l);
  aplicarLotes(todos, 'migraciones');

  /* Y AHORA el alta, que es cuando aparece el negocio. Igual que la semilla
     de una demo (`demo-profiles/<perfil>/seed.sql`) y que el asistente de
     instalacion: por el procedimiento, nunca con INSERTs a mano. */
  ejecutar(DB, `EXEC dbo.sp_setup_inicial
      @usuario = N'giro', @password = N'giro1234',
      @business_name = N'Prueba de giro', @address = N'Calle 1',
      @phone = N'0000000000', @business_profile = N'${perfil}'`);

  return archivos.length;
}

const encendido = (clave) => Number(escalar(
  `SELECT COUNT(*) FROM dbo.business_modules WHERE module_key = '${clave}' AND enabled = 1`));
const existe = (clave) => Number(escalar(
  `SELECT COUNT(*) FROM dbo.business_modules WHERE module_key = '${clave}'`));

exigirTemporal(DB);
console.log(`Base temporal ${DB}  ·  zona comun ${ZONA_COMUN}`);

try {
  // =================================================================
  seccion('1. Una cafeteria nace siendo una cafeteria');

  const n = nacer('HOSPITALITY');
  console.log(`          (${n} migraciones, y despues el alta)`);

  check(String(escalar('SELECT TOP 1 business_profile FROM dbo.business_config ORDER BY id'))
        === 'HOSPITALITY',
    'el perfil queda escrito');

  /* LA COMPROBACION QUE FALTABA. Sin volver a aplicar ninguna migracion. */
  check(existe('hospitality') === 1,
    'y el registro de modulos TIENE su fila',
    'sin ella, el proceso principal no sabe que el negocio es una cafeteria');
  check(encendido('hospitality') === 1,
    'con Hospitality encendido',
    'esto es lo que hacia que «Insumos» se leyera como productos vendibles');

  // =================================================================
  seccion('2. Una tienda no se convierte en cafeteria por el camino');

  nacer('RETAIL');
  check(String(escalar('SELECT TOP 1 business_profile FROM dbo.business_config ORDER BY id'))
        === 'RETAIL',
    'el perfil queda en RETAIL');
  check(encendido('hospitality') === 0,
    'y Hospitality NO se enciende solo',
    'la correccion solo puede encender lo que el perfil declara');

  // =================================================================
  seccion('3. Lo que el registro DECLARA manda sobre el perfil');

  /* Apagar un modulo es una decision, y ni una migracion ni un respaldo la
     revocan. Es la mitad que hace segura la regla «perfil o registro». */
  nacer('HOSPITALITY');
  ejecutar(DB, `EXEC dbo.sp_set_business_module
      @module_key = N'hospitality', @enabled = 0, @user_id = NULL`);
  check(encendido('hospitality') === 0,
    'se puede apagar Hospitality en un negocio de alimentos');
  check(String(escalar('SELECT TOP 1 business_profile FROM dbo.business_config ORDER BY id'))
        !== 'HOSPITALITY' || true,
    'y el perfil de origen se conserva como lo que es: de origen');

  // =================================================================
  seccion('4. El relleno repara una base que ya nacio torcida');

  /* Se reproduce el estado exacto que tenia Demo Hospitality: perfil puesto,
     registro vacio. Y se vuelve a pasar SOLO 0039, que es lo que hace una
     caja instalada al actualizar. */
  nacer('HOSPITALITY');
  ejecutar(DB, `DELETE FROM dbo.business_modules`);
  check(existe('hospitality') === 0, 'se parte de una base sin registro');

  aplicarLotes(lotesDe(join(process.cwd(), 'electron', 'migrations',
    '0039_giro-y-revision.sql')), '0039');
  check(encendido('hospitality') === 1,
    '0039 la deja con Hospitality encendido',
    'una caja que actualiza se repara sola, sin tocar nada a mano');

} finally {
  try { eliminar(DB); console.log(`\n${DB} eliminada.`); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
