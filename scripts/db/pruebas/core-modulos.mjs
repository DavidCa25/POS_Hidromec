/**
 * LAS MIGRACIONES 0028 Y 0029 SOBRE UNA BASE DE VERDAD.
 *
 *     node scripts/db/pruebas/core-modulos.mjs
 *
 * Restaura el template oficial en una base temporal, aplica TODAS las
 * migraciones en orden y comprueba lo que de verdad importa de la Fase Core 0.
 *
 * DOS MIGRACIONES, NO UNA
 * -----------------------
 * `0028_core-modulos` registra que capacidades tiene encendidas la empresa.
 * `0029_core-seguridad` pone las dos marcas que necesita la sesion. Van
 * separadas para que cada subsistema se pueda evaluar, revertir y entender por
 * su cuenta: un problema con los modulos no obliga a tocar la seguridad.
 *
 * LO QUE SE COMPRUEBA
 * -------------------
 *   - una instalacion Hospitality sigue siendo Hospitality;
 *   - quien tenia Fidelizacion la conserva;
 *   - apagar un modulo no borra nada;
 *   - la revision de seguridad sube de una en una;
 *   - `users.rol` NO recibe un CHECK que pueda romper la base de un cliente;
 *   - no queda ni rastro de excepciones de permiso por usuario;
 *   - y nada de lo que ya existia se rompio.
 *
 * Nunca toca una base existente: crea la suya y la borra al terminar.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal, ZONA_COMUN } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';

/* El patron `Wybix_Tmp*` es el que `exigirTemporal` reconoce como desechable.
   No se afloja esa guarda para esta prueba: es la que impide que una
   herramienta borre por error la base de un cliente. */
const DB = 'Wybix_TmpCore0';
let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

/** Una consulta que devuelve un solo valor. */
function escalar(sql) {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(r.error);
  const fila = (r.sets?.[0] ?? [])[0] ?? {};
  return Object.values(fila)[0];
}
function filas(sql) {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(r.error);
  return r.sets?.[0] ?? [];
}
function conjuntos(sql) {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(r.error);
  return r.sets ?? [];
}

/**
 * Los lotes de un archivo .sql, separados por GO igual que hace el runner.
 *
 * Se separan aqui y se ejecutan juntos. Abrir una conexion por lote convertia
 * las veintinueve migraciones en varios centenares de procesos de PowerShell,
 * y la prueba tardaba mas de diez minutos en llegar a la primera comprobacion.
 */
function lotesDe(ruta) {
  return readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
    .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);
}

/** Aplica una lista de lotes en una sola conexion, y falla nombrando el lote. */
function aplicarLotes(lotes, origen) {
  const r = ejecutarVarios(DB, lotes);
  const malo = r.map((x, i) => ({ ...x, i })).find(x => !x.ok);
  if (malo) {
    throw new Error(`${origen} · lote ${malo.i + 1}/${lotes.length}: ${malo.error}\n----\n`
      + lotes[malo.i].slice(0, 400));
  }
}

function aplicarArchivo(ruta) { aplicarLotes(lotesDe(ruta), ruta); }

exigirTemporal(DB);
console.log(`Base temporal ${DB}  ·  zona comun ${ZONA_COMUN}`);

try {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));

  // =================================================================
  seccion('1. Las migraciones se aplican en orden, las dos nuevas incluidas');

  const dir = join(process.cwd(), 'electron', 'migrations');
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  /* Todos los lotes de todas las migraciones, en una sola conexion. */
  const todos = [];
  for (const f of archivos) for (const l of lotesDe(join(dir, f))) todos.push(l);
  aplicarLotes(todos, 'migraciones');

  check(archivos.includes('0028_core-modulos.sql'), 'se aplico 0028 — modulos del negocio');
  check(archivos.includes('0029_core-seguridad.sql'), 'se aplico 0029 — marcas de seguridad');
  check(!archivos.some(f => /0028_core-seguridad/.test(f)),
    'no queda la migracion mezclada que unia las dos cosas');
  console.log(`          (${archivos.length} migraciones en total)`);

  /* El template NO trae negocio ni usuarios: nace vacio y el asistente lo da
     de alta. Se usa el mismo procedimiento que usa la instalacion real, no
     INSERTs a mano: si manana cambia el alta, esta prueba cambia con ella. */
  ejecutar(DB, `EXEC dbo.sp_setup_inicial
      @usuario = N'core', @password = N'core1234',
      @business_name = N'Negocio de prueba', @address = N'Calle 1',
      @phone = N'0000000000', @business_profile = N'RETAIL'`);
  check(Number(escalar('SELECT COUNT(*) FROM business_config')) >= 1,
    'el alta deja el negocio configurado');
  check(Number(escalar('SELECT COUNT(*) FROM users')) >= 1, 'y un usuario para trabajar');

  /* La siembra de la 0028 corre sobre `business_config`, que hasta ahora
     estaba vacia. Se vuelve a aplicar su bloque para que lea el alta: es
     idempotente justamente para poder hacer esto. */
  const DDL_MODULOS = join(process.cwd(), 'sql', 'schema', 'changes', '0028_core-modulos.sql');
  aplicarArchivo(DDL_MODULOS);

  check(Number(escalar("SELECT COUNT(*) FROM sys.tables WHERE name='business_modules'")) === 1,
    'existe business_modules');
  check(Number(escalar("SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.business_modules') AND name='config'")) === 0,
    'y NO tiene columna config',
    'un JSON generico acaba siendo el cajon donde cae lo que nadie modelo');

  // =================================================================
  seccion('2. Las marcas de seguridad');

  const estado = filas('EXEC dbo.sp_get_security_state')[0] ?? {};
  check(Number(estado.security_model_version) >= 1, 'security_model_version queda sembrada',
    String(estado.security_model_version));
  check(Number(estado.security_revision) >= 1, 'security_revision queda sembrada',
    String(estado.security_revision));

  const antes = Number(escalar("SELECT valor FROM database_metadata WHERE clave='security_revision'"));
  ejecutar(DB, 'EXEC dbo.sp_bump_security_revision');
  const despues = Number(escalar("SELECT valor FROM database_metadata WHERE clave='security_revision'"));
  check(despues === antes + 1, 'y sube de una en una', `${antes} -> ${despues}`);

  /* La 0029 no crea tablas: los permisos viven en el binario porque son parte
     del producto, no un dato del negocio. Si algun dia aparece una tabla de
     permisos en SQL, esta comprobacion lo dira. */
  check(Number(escalar("SELECT COUNT(*) FROM sys.tables WHERE name IN ('permissions','role_permissions','user_permissions')")) === 0,
    'la 0029 no mete el catalogo de permisos en la base');

  // =================================================================
  seccion('2b. Una base que NO tiene `database_metadata` tambien migra');

  /* EL CASO REAL QUE ESTA PRUEBA NO CUBRIA.
   *
   * `database_metadata` la crea el BASELINE, asi que toda base restaurada del
   * template la tiene -incluida la de esta prueba-. Pero una instalacion que
   * lleva anos migrando nacio ANTES del baseline y nunca paso por el.
   *
   * La 0029 daba la tabla por hecha y el arranque moria con «Invalid object
   * name 'dbo.database_metadata'» ANTES de abrir ninguna ventana: la
   * aplicacion no arrancaba. La prueba pasaba igual porque partia del
   * template, que es justo el unico sitio donde el problema no existe.
   *
   * Aqui se reproduce a proposito: se tira la tabla y se vuelve a aplicar la
   * migracion, que es lo que le pasa a la base de un cliente.
   */
  ejecutar(DB, 'DROP TABLE dbo.database_metadata');
  check(Number(escalar("SELECT COUNT(*) FROM sys.tables WHERE name='database_metadata'")) === 0,
    'se simula una base anterior al baseline: sin database_metadata');

  aplicarArchivo(join(process.cwd(), 'sql', 'schema', 'changes', '0029_core-seguridad.sql'));

  check(Number(escalar("SELECT COUNT(*) FROM sys.tables WHERE name='database_metadata'")) === 1,
    'la migracion la crea en vez de suponerla',
    'una migracion no puede dar por hecho el estado previo de la base de un cliente');
  check(Number(escalar("SELECT COUNT(*) FROM database_metadata WHERE clave='security_revision'")) === 1,
    'y siembra sus marcas igual que si hubiera estado');

  const estadoTras = filas('EXEC dbo.sp_get_security_state')[0] ?? {};
  check(Number(estadoTras.security_revision) >= 1,
    'el procedimiento de sesion vuelve a responder');

  // =================================================================
  seccion('3. `users.rol` sigue sin CHECK, a proposito');

  /* Anadir un CHECK habria sido lo "limpio". Tambien habria sido una migracion
     capaz de fallar sobre la base de un cliente por un valor que alguien
     escribio hace dos anos. El binario ya trata lo desconocido como "sin rol
     asignado", con cero paquetes, asi que el CHECK no compraba seguridad:
     compraba una instalacion rota. */
  const checks = filas(`SELECT cc.name, cc.definition
                          FROM sys.check_constraints cc
                          JOIN sys.columns c ON c.object_id = cc.parent_object_id
                                            AND c.column_id = cc.parent_column_id
                         WHERE cc.parent_object_id = OBJECT_ID('dbo.users')
                           AND c.name = 'rol'`);
  check(checks.length === 0, 'no hay CHECK sobre users.rol',
    checks.map(c => c.name).join(', ') || 'ninguno');

  /* Y se demuestra: una base con un rol que este binario no conoce sigue
     aceptando escrituras. Quien tenga ese rol entra y no puede hacer nada,
     que es exactamente lo que se decidio. */
  ejecutar(DB, `INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
                VALUES (N'heredado', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x123456'), 2),
                        N'consulta', 1, GETDATE())`);
  check(Number(escalar("SELECT COUNT(*) FROM users WHERE rol='consulta'")) === 1,
    'una base con un rol heredado desconocido sigue funcionando',
    'el binario le da cero paquetes; la base no se rompe');

  // =================================================================
  seccion('4. Una instalacion Retail se migra sin cambiar de perfil');

  /* El template nace Retail. Lo que no puede pasar es que la migracion
     encienda modulos que el negocio no tenia. */
  const modsRetail = filas('EXEC dbo.sp_get_business_modules');
  const encendidos = modsRetail.filter(m => Number(m.enabled) === 1).map(m => m.module_key);
  check(!encendidos.includes('hospitality'),
    'Hospitality NO se enciende sola en una base Retail', encendidos.join(', ') || '(ninguno)');
  check(String(escalar('SELECT TOP 1 business_profile FROM business_config ORDER BY id')).toUpperCase() === 'RETAIL',
    'y business_profile se conserva tal cual');

  // =================================================================
  seccion('5. Una instalacion Hospitality conserva Hospitality');

  /* Se simula el caso real: un negocio que YA era Hospitality antes de la
     migracion. Se deshace la siembra y se vuelve a aplicar el bloque. */
  ejecutar(DB, "UPDATE business_config SET business_profile='HOSPITALITY', loyalty_enabled=1");
  ejecutar(DB, 'DELETE FROM business_modules');
  aplicarArchivo(DDL_MODULOS);

  const mods = filas('EXEC dbo.sp_get_business_modules');
  const activos = new Set(mods.filter(m => Number(m.enabled) === 1).map(m => m.module_key));
  check(activos.has('hospitality'), 'Hospitality queda encendida en el registro');
  check(activos.has('loyalty'), 'y Fidelizacion conserva su estado');

  // =================================================================
  seccion('6. Encender y apagar no destruye nada');

  ejecutar(DB, "EXEC dbo.sp_set_business_module @module_key='hospitality', @enabled=0");
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='hospitality'")) === 0,
    'apagar Hospitality deja el BIT en cero');
  check(Number(escalar("SELECT COUNT(*) FROM sys.tables WHERE name='recipes'")) === 1,
    'y la tabla de recetas sigue ahi',
    'apagar un modulo nunca puede ser un DROP');
  check(Number(escalar("SELECT COUNT(*) FROM business_modules WHERE module_key='hospitality'")) === 1,
    'la fila del modulo se conserva, con su historia');

  /* El dual-write: mientras haya cajas que leen las columnas antiguas, el
     espejo tiene que estar al dia. */
  check(String(escalar('SELECT TOP 1 business_profile FROM business_config ORDER BY id')).toUpperCase() === 'RETAIL',
    'y la columna antigua business_profile queda en espejo', 'dual-write');

  ejecutar(DB, "EXEC dbo.sp_set_business_module @module_key='hospitality', @enabled=1");
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='hospitality'")) === 1,
    'volver a encenderlo devuelve todo a su sitio');
  check(String(escalar('SELECT TOP 1 business_profile FROM business_config ORDER BY id')).toUpperCase() === 'HOSPITALITY',
    'y el espejo tambien');

  ejecutar(DB, "EXEC dbo.sp_set_business_module @module_key='loyalty', @enabled=0");
  check(Number(escalar('SELECT TOP 1 CONVERT(INT, loyalty_enabled) FROM business_config ORDER BY id')) === 0,
    'Fidelizacion tambien mantiene su espejo');
  ejecutar(DB, "EXEC dbo.sp_set_business_module @module_key='loyalty', @enabled=1");

  // =================================================================
  seccion('7. Un modulo que no existia se enciende sin migracion');

  ejecutar(DB, "EXEC dbo.sp_set_business_module @module_key='servicios', @enabled=1");
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='servicios'")) === 1,
    'anadir un modulo futuro es una fila, no una columna',
    'esto es lo que el registro compra frente a los BIT');
  check(String(escalar('SELECT TOP 1 business_profile FROM business_config ORDER BY id')).toUpperCase() === 'HOSPITALITY',
    'y encender Servicios no cambia el perfil con el que nacio el negocio',
    'Hospitality + Servicios conviven: el perfil ya no gobierna');

  // =================================================================
  seccion('8. MultiCaja con versiones mezcladas: la caja vieja no queda sola');

  /* La caja que todavia no se actualizo no conoce `business_modules`: cambia
     Hospitality escribiendo `business_profile`, como siempre se hizo. Si el
     registro no se enterara, la caja nueva de al lado veria el modulo apagado
     y las dos mostrarian pantallas distintas del mismo negocio. */
  ejecutar(DB, `EXEC dbo.sp_update_business_config
      @business_name = N'Negocio de prueba', @business_profile = N'RETAIL'`);
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='hospitality'")) === 0,
    'la caja vieja apaga Hospitality y el registro se entera');

  ejecutar(DB, `EXEC dbo.sp_update_business_config
      @business_name = N'Negocio de prueba', @business_profile = N'HOSPITALITY'`);
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='hospitality'")) === 1,
    'y cuando la enciende, tambien');

  /* Y lo que NO puede pasar: el panel de datos del negocio guarda el telefono
     sin mencionar el perfil ni la fidelizacion. Con NULL no se toca nada. */
  ejecutar(DB, "EXEC dbo.sp_set_business_module @module_key='loyalty', @enabled=1");
  ejecutar(DB, `EXEC dbo.sp_update_business_config
      @business_name = N'Negocio de prueba', @phone = N'3331112233'`);
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='loyalty'")) === 1,
    'cambiar el telefono no apaga Fidelizacion',
    'el parametro llega NULL y el espejo no se toca');
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='hospitality'")) === 1,
    'ni Hospitality');
  check(Number(escalar("SELECT enabled FROM business_modules WHERE module_key='servicios'")) === 1,
    'ni toca un modulo que la caja vieja ni siquiera sabe que existe',
    'el espejo cubre lo que la version vieja entiende, no mas');

  // =================================================================
  seccion('9. No quedan excepciones de permiso por usuario');

  /* Se descartaron: el unico caso real que resolvian -"este cajero de
     confianza si puede devolver"- se cubre subiendolo a Encargado, y a cambio
     traian una tabla, una pantalla, una regla de precedencia y estados que
     nadie sabe nombrar. Aqui se comprueba que no volvieron por la puerta de
     atras. */
  check(Number(escalar("SELECT COUNT(*) FROM sys.tables WHERE name='user_permission_overrides'")) === 0,
    'la tabla de excepciones no existe');
  check(Number(escalar("SELECT COUNT(*) FROM sys.procedures WHERE name IN ('sp_get_user_overrides','sp_set_user_override')")) === 0,
    'ni sus procedimientos');

  // =================================================================
  seccion('10. La autorizacion presencial ya no depende del rol');

  const cols = filas(`SELECT p.name FROM sys.parameters p
                      WHERE p.object_id = OBJECT_ID('dbo.sp_authorize_supervisor')`);
  check(cols.length === 2, 'sp_authorize_supervisor sigue recibiendo usuario y contrasena',
    cols.map(c => c.name).join(', '));

  const def = String(escalar("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_authorize_supervisor'))"));
  /* Sin los comentarios: la cabecera del procedimiento explica que ANTES
     filtraba por `rol IN (...)`, y esa frase encajaba con la busqueda. */
  const codigo = def.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  check(!/rol\s+IN\s*\(/i.test(codigo), 'y ya no filtra por nombre de rol',
    (codigo.match(/rol\s+IN\s*\([^)]*\)/i) || [])[0] || '');
  check(!/user_permission_overrides/i.test(codigo),
    'ni devuelve excepciones que ya no existen');

  /* Devuelve UN solo conjunto: quien es. Quien puede autorizar lo decide el
     proceso principal con el catalogo, que viaja en el binario. */
  const sets = conjuntos(`EXEC dbo.sp_authorize_supervisor @usuario=N'core', @password=N'core1234'`);
  const conFilas = sets.filter(s => Array.isArray(s) && s.length > 0);
  check(conFilas.length === 1, 'y responde con un unico conjunto: la identidad',
    `${conFilas.length} conjunto(s)`);
  check(String(conFilas[0]?.[0]?.usuario ?? '') === 'core', 'con el usuario que valido');

  const malas = conjuntos(`EXEC dbo.sp_authorize_supervisor @usuario=N'core', @password=N'incorrecta'`);
  check(malas.every(s => !Array.isArray(s) || s.length === 0),
    'una contrasena incorrecta no devuelve nada');

  // =================================================================
  seccion('11. Nada de lo anterior se rompio');

  check(Number(escalar("SELECT COUNT(*) FROM sys.procedures WHERE name='sp_register_sale'")) === 1,
    'sp_register_sale sigue existiendo');
  check(Number(escalar('SELECT COUNT(*) FROM sys.tables')) >= 55,
    'el esquema conserva sus tablas', String(escalar('SELECT COUNT(*) FROM sys.tables')));
  check(Number(escalar('SELECT COUNT(*) FROM sys.procedures')) >= 144,
    'y sus procedimientos', String(escalar('SELECT COUNT(*) FROM sys.procedures')));

} finally {
  try { eliminar(DB); console.log(`\n${DB} eliminada.`); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
