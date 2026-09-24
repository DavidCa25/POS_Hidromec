/**
 * LAS BASES DE LAS PRUEBAS DE EXTREMO A EXTREMO.
 *
 *     node e2e/preparar-bases.mjs [Core|Servicios|todas]
 *
 * Deja `Wybix_E2E_Core` (y `Wybix_E2E_Servicios`) recien hechas desde la
 * plantilla oficial, con TODAS las migraciones aplicadas y el negocio dado de
 * alta. Electron las abre despues por su archivo de configuracion, que la
 * prueba escribe en un `userData` aislado.
 *
 * POR QUE UN NOMBRE FIJO Y NO UNO AL AZAR
 * ---------------------------------------
 * Porque la aplicacion no recibe la base por parametro: la lee de su
 * configuracion. Un nombre estable permite prepararla antes de arrancar y
 * mirarla despues, cuando algo falla, sin adivinar cual de veinte bases era.
 *
 * LAS GUARDAS
 * -----------
 * `exigirTemporal` rechaza cualquier nombre que no sea claramente desechable y,
 * antes que eso, rechaza por nombre exacto `Wybix_POS`, `Wybix_Production`,
 * `Wybix_Template` y las del sistema. Esta herramienta crea y borra bases: la
 * unica forma aceptable de tenerla cerca de una instalacion real es que le sea
 * imposible tocarla.
 *
 * Y el usuario del negocio se da de alta con el mismo procedimiento que usa la
 * instalacion real. Nada de INSERT a mano: si manana cambia el alta, estas
 * pruebas cambian con ella o se rompen, que es lo que se quiere.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutarVarios, restaurar, eliminar, exigirTemporal } from '../scripts/db/lib/temporal.mjs';

/** Las credenciales del negocio de prueba. Sin valor fuera de estas bases. */
export const CUENTAS = {
  admin:      { usuario: 'e2e_admin',    password: 'e2e-admin-1234',    rol: 'admin' },
  encargado:  { usuario: 'e2e_encargado', password: 'e2e-encargado-1234', rol: 'supervisor' },
  operador:   { usuario: 'e2e_operador',  password: 'e2e-operador-1234',  rol: 'cajero' },
  /* Un rol que este binario no conoce. Existe para poder comprobar que quien
     lo tenga entra y no puede hacer nada, en vez de heredar el rol mas bajo. */
  heredado:   { usuario: 'e2e_heredado',  password: 'e2e-heredado-1234',  rol: 'consulta' },
};

export const BASES = {
  Core: 'Wybix_E2E_Core',
  Servicios: 'Wybix_E2E_Servicios',
  /* La levanta y la borra e2e/primer-uso.spec.js. Figura aqui para que
     'npm run e2e:limpiar' se la lleve si una ejecucion se corto en medio. */
  PrimerUso: 'Wybix_E2E_PrimerUso',
  /* La levanta y la borra e2e/giro.spec.js: es la unica con Servicios
     APAGADO, que es de donde parte un cliente recien instalado. */
  Giro: 'Wybix_E2E_Giro',
  /* Una por giro: el giro se guarda por NEGOCIO, asi que dos no caben en
     la misma instalacion. Las levanta y las borra giros-recorridos.spec.js;
     figuran aqui para que 'e2e:limpiar' se las lleve si algo se corta. */
  GiroTaller: 'Wybix_E2E_GiroTaller',
  GiroBelleza: 'Wybix_E2E_GiroBelleza',
  GiroElectronica: 'Wybix_E2E_GiroElectronica',
  GiroMantenimiento: 'Wybix_E2E_GiroMantenimiento',
  GiroOtro: 'Wybix_E2E_GiroOtro',
};

function lotesDe(ruta) {
  return readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
    .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);
}

function aplicar(db, lotes, origen) {
  const r = ejecutarVarios(db, lotes);
  const malo = r.map((x, i) => ({ ...x, i })).find(x => !x.ok);
  if (malo) {
    throw new Error(`${origen} · lote ${malo.i + 1}/${lotes.length}: ${malo.error}\n----\n`
      + lotes[malo.i].slice(0, 400));
  }
}

/** Escapa una cadena para un literal de SQL Server. */
const lit = (s) => `N'${String(s).replace(/'/g, "''")}'`;

export function prepararBase(db, { perfil = 'RETAIL', modulos = [], giroServicios = null } = {}) {
  exigirTemporal(db);   // por si alguien llama a esto con otro nombre
  console.log(`\n== ${db} (${perfil})`);

  eliminar(db);
  restaurar(db, join(process.cwd(), 'installer', 'template.bak'));

  const dir = join(process.cwd(), 'electron', 'migrations');
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const lotes = [];
  for (const f of archivos) for (const l of lotesDe(join(dir, f))) lotes.push(l);
  aplicar(db, lotes, 'migraciones');
  console.log(`   migraciones aplicadas: ${archivos.length}`);

  /* El alta real, con el procedimiento real. Crea el negocio y el primer
     administrador. */
  aplicar(db, [`EXEC dbo.sp_setup_inicial
      @usuario = ${lit(CUENTAS.admin.usuario)}, @password = ${lit(CUENTAS.admin.password)},
      @business_name = N'Negocio E2E', @address = N'Calle Falsa 123',
      @phone = N'3330000000', @business_profile = ${lit(perfil)}`], 'alta del negocio');

  /* La siembra de modulos lee `business_config`, que hasta el alta estaba
     vacia. Se vuelve a pasar: es idempotente justo para esto. */
  aplicar(db, lotesDe(join(process.cwd(), 'sql', 'schema', 'changes', '0028_core-modulos.sql')),
    'siembra de modulos');

  /* Las otras tres personas. Se insertan con el mismo hash que usa el login,
     porque no hay procedimiento de alta de usuarios: lo hace el canal
     `users:create`, y usarlo aqui exigiria tener la aplicacion ya arrancada. */
  const alta = (c) => `
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE usuario = ${lit(c.usuario)})
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (${lit(c.usuario)},
            CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', ${lit(c.password)}), 2),
            ${lit(c.rol)}, 1, GETDATE());`;
  aplicar(db, [CUENTAS.encargado, CUENTAS.operador, CUENTAS.heredado].map(alta), 'altas de usuarios');

  /* Los modulos que esta base necesita encendidos. Se usa el mismo
     procedimiento que usa Aplicaciones, no un UPDATE a mano: si manana cambia
     el encendido, estas pruebas cambian con el o se rompen. */
  for (const m of modulos) {
    aplicar(db, [`EXEC dbo.sp_set_business_module @module_key = ${lit(m)}, @enabled = 1`],
      `encender ${m}`);
  }
  if (modulos.length) console.log(`   modulos encendidos: ${modulos.join(', ')}`);

  /* El giro de Servicios, si esta base lo necesita. Se pone con el MISMO
     procedimiento que usa el onboarding real -el que tambien enciende el
     modulo- y no con un UPDATE: una base de pruebas montada por un camino
     propio deja de probar el camino de verdad. */
  if (giroServicios) {
    aplicar(db, [`EXEC dbo.sp_set_services_preset @preset = ${lit(giroServicios)}`],
      `giro de servicios ${giroServicios}`);
    console.log(`   giro de Servicios: ${giroServicios}`);
  }

  console.log(`   usuarios: ${Object.values(CUENTAS).map(c => `${c.usuario} (${c.rol})`).join(', ')}`);
  return db;
}

export function borrarBases() {
  for (const db of Object.values(BASES)) {
    try { eliminar(db); console.log(`   ${db} eliminada`); } catch { /* no existia */ }
  }
}

/* --------------------------------------------------- uso desde la consola */
const esPrincipal = process.argv[1] && process.argv[1].endsWith('preparar-bases.mjs');
if (esPrincipal) {
  const cual = (process.argv[2] || 'todas').toLowerCase();
  if (cual === 'limpiar') { borrarBases(); }
  else {
    if (cual === 'todas' || cual === 'core') prepararBase(BASES.Core, { perfil: 'RETAIL' });
    if (cual === 'todas' || cual === 'servicios')
      prepararBase(BASES.Servicios, {
        /* MANTENIMIENTO y no TALLER: es el unico giro que trae las dos cosas
           a la vez -agenda Y algo sobre lo que se trabaja-, asi que una sola
           base sirve para la prueba de la agenda y para la del ciclo
           completo. El taller y la barberia los recorre giro.spec.js, que
           levanta su propia base para eso. */
        perfil: 'RETAIL', modulos: ['servicios'], giroServicios: 'MANTENIMIENTO' });
  }
  console.log('\nlisto.');
}
