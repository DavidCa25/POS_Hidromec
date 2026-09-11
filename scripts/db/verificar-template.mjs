/**
 * Guarda de empaquetado: lo que va a viajar en el instalador es lo correcto.
 *
 *     npm run db:check-template
 *
 * Se ejecuta ANTES de construir el instalador. Empaquetar un `template.bak`
 * ausente, corrupto o de otra epoca produce un instalador que parece bueno y
 * deja al cliente con una base que no corresponde al producto. Es de los
 * fallos mas caros: no se ve hasta que alguien instala.
 *
 * Comprueba, sin restaurar nada:
 *   - que el archivo existe y tiene tamano razonable;
 *   - que SQL Server lo reconoce y puede leerlo (RESTORE VERIFYONLY);
 *   - que las migraciones del arbol coinciden con las que el .bak trae
 *     registradas (RESTORE ... FILELISTONLY no lo dice, asi que se restaura a
 *     una base temporal SOLO si se pide --a-fondo).
 *
 * Con `--a-fondo` restaura a una base temporal y verifica el contenido real.
 */
import { existsSync, statSync, readdirSync, readFileSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { consultar } from './lib/sql.mjs';
import { ejecutar, eliminar, restaurar, ZONA_COMUN } from './lib/temporal.mjs';

// Ruta ABSOLUTA: SQL Server resuelve las rutas relativas desde su propio
// directorio de trabajo, no desde el del repositorio.
const TEMPLATE = resolve('installer', 'template.bak');
const DIR_MIGRACIONES = join('electron', 'migrations');
const TMP = 'Wybix_TmpGuard';
const A_FONDO = process.argv.includes('--a-fondo');

let fallos = 0;
const mal = (t) => { console.log(`   FALLA  ${t}`); fallos++; };
const bien = (t) => console.log(`   ok     ${t}`);

console.log('\nGUARDA DE EMPAQUETADO');
console.log(`Template: ${TEMPLATE}`);

// ---------------------------------------------------------------- existe
if (!existsSync(TEMPLATE)) {
  mal('installer/template.bak NO EXISTE. Genera el release con: npm run db:prepare-release');
  console.log('\nRESULTADO: FALLO - no se puede empaquetar');
  process.exit(1);
}

const st = statSync(TEMPLATE);
const mb = st.size / 1048576;
bien(`existe (${mb.toFixed(2)} MB, ${st.mtime.toISOString().slice(0, 19).replace('T', ' ')})`);
if (mb < 1) mal(`el archivo es sospechosamente pequeno (${mb.toFixed(2)} MB): un baseline ronda los 5 MB`);
else bien('el tamano es coherente con un baseline completo');

// ------------------------------------------------------------- legible
// La cuenta de servicio de SQL Server no puede leer la carpeta del
// repositorio: se le acerca el archivo a la zona comun, igual que hace
// `restaurar()` en lib/temporal.mjs.
{
  const copia = join(ZONA_COMUN, '_template-guard.bak');
  try {
    if (!existsSync(ZONA_COMUN)) mkdirSync(ZONA_COMUN, { recursive: true });
    copyFileSync(TEMPLATE, copia);
    ejecutar('master', `RESTORE VERIFYONLY FROM DISK = N'${copia.replace(/'/g, "''")}'`);
    bien('SQL Server lo reconoce como respaldo integro');
  } catch (e) {
    mal(`SQL Server no puede leerlo: ${String(e.message).split('\n')[0]}`);
  } finally {
    try { if (existsSync(copia)) unlinkSync(copia); } catch { /* noop */ }
  }
}

// ----------------------------------------------------- contenido real
const migracionesEnGit = readdirSync(DIR_MIGRACIONES).filter(f => f.endsWith('.sql')).sort();
if (A_FONDO) {
  console.log('\n   -- a fondo: restaurando a una base temporal');
  try { eliminar(TMP); } catch { /* no existia */ }
  try {
    restaurar(TMP, TEMPLATE);

    const tablas = Number(consultar(TMP,
      `SELECT COUNT(*) AS n FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')`)[0].n);
    const procs = Number(consultar(TMP,
      `SELECT COUNT(*) AS n FROM sys.procedures WHERE schema_id = SCHEMA_ID('dbo')`)[0].n);
    const usuarios = Number(consultar(TMP, `SELECT COUNT(*) AS n FROM dbo.users`)[0].n);
    const productos = Number(consultar(TMP, `SELECT COUNT(*) AS n FROM dbo.products`)[0].n);
    const ventas = Number(consultar(TMP, `SELECT COUNT(*) AS n FROM dbo.sales`)[0].n);
    const baseline = consultar(TMP,
      `SELECT valor FROM dbo.database_metadata WHERE clave = 'baseline_version'`)[0]?.valor;
    const registradas = consultar(TMP, `SELECT filename FROM dbo.schema_migrations ORDER BY filename`)
      .map(r => r.filename);

    console.log(`   ${tablas} tablas · ${procs} procedures · baseline v${baseline}`);
    bien(`${tablas} tablas y ${procs} procedures`);

    if (usuarios === 0) bien('0 usuarios: el instalador no entrega credenciales');
    else mal(`el template trae ${usuarios} usuarios`);
    if (productos === 0 && ventas === 0) bien('0 productos y 0 ventas: sin datos de demo');
    else mal(`el template trae datos: ${productos} productos, ${ventas} ventas`);

    const faltan = migracionesEnGit.filter(f => !registradas.includes(f));
    const sobran = registradas.filter(f => !migracionesEnGit.includes(f));
    if (!faltan.length && !sobran.length) {
      bien(`declara exactamente las ${registradas.length} migraciones del arbol`);
    } else {
      if (faltan.length) mal(`el template no declara: ${faltan.join(', ')}`);
      if (sobran.length) mal(`el template declara migraciones que no estan en Git: ${sobran.join(', ')}`);
    }
  } catch (e) {
    mal(`no se pudo restaurar para inspeccionarlo: ${String(e.message).split('\n')[0]}`);
  } finally {
    try { eliminar(TMP); } catch { /* noop */ }
  }
} else {
  console.log(`\n   (${migracionesEnGit.length} migraciones en el arbol; usa --a-fondo para comprobar`);
  console.log('    que el template las declara restaurandolo en una base temporal)');
}

// ==========================================================================
// DEPENDENCIA EXTERNA: el medio de SQL Server Express
// ==========================================================================
// No es codigo de Wybix ni un artefacto que Wybix genere: es el instalador
// offline de Microsoft, que viaja dentro del paquete para que un cliente sin
// internet pueda instalar el motor. Vive fuera de Git a proposito (314 MB de
// binarios de terceros) y se consigue aparte, como explica installer/LEEME.md.
//
// Empaquetar sin el produce un instalador que falla en casa del cliente, en el
// peor momento: cuando ya lo esta instalando. Se comprueba antes.
console.log('\nDEPENDENCIA EXTERNA — SQL Server 2019 Express');

const SQLEXPRESS = resolve('installer', 'sqlexpress');
const COMO_CONSEGUIRLO =
  'Coloca el medio oficial de Microsoft SQL Server 2019 Express (ENU, x64,\n' +
  '           layout Core) en installer/sqlexpress/. Instrucciones completas en\n' +
  '           installer/LEEME.md.';

if (!existsSync(SQLEXPRESS)) {
  mal(`installer/sqlexpress/ NO EXISTE.\n           ${COMO_CONSEGUIRLO}`);
} else {
  // Lo minimo sin lo cual el medio no instala nada.
  const IMPRESCINDIBLES = [
    'SETUP.EXE',
    'MEDIAINFO.XML',
    join('x64', 'Setup', 'SQL_ENGINE_CORE_INST.MSI'),
    join('x64', 'Setup', 'SQL_ENGINE_CORE_SHARED.MSI'),
    join('x64', 'Setup', 'SQL_COMMON_CORE.MSI'),
  ];
  const ausentes = IMPRESCINDIBLES.filter(f => !existsSync(join(SQLEXPRESS, f)));
  if (ausentes.length) {
    mal(`al medio le faltan piezas: ${ausentes.join(', ')}\n           ${COMO_CONSEGUIRLO}`);
  } else {
    bien('SETUP.EXE y los paquetes del motor estan presentes');
  }

  // Version y layout, leidos del propio medio.
  const info = join(SQLEXPRESS, 'MEDIAINFO.XML');
  if (existsSync(info)) {
    const xml = readFileSync(info, 'utf8');
    const valor = (id) => (xml.match(new RegExp(`Id="${id}"\\s+Value="([^"]+)"`)) || [])[1];
    const version = valor('BaselineVersion');
    const layout = valor('MediaLayout');

    if (version && version.startsWith('15.0.')) bien(`SQL Server 2019 (build ${version})`);
    else mal(`el medio declara la version ${version || '(desconocida)'}, se esperaba 15.0.x (SQL Server 2019).\n           ${COMO_CONSEGUIRLO}`);

    if (layout === 'Core') bien(`layout ${layout}`);
    else mal(`layout ${layout || '(desconocido)'}, se esperaba Core`);
  }

  // La edicion no esta escrita en el medio: se deduce de lo que NO trae. Un
  // medio Developer o Standard incluye Analysis, Integration, Reporting,
  // Master Data o PolyBase; Express, solo el motor.
  const setupDir = join(SQLEXPRESS, 'x64', 'Setup');
  if (existsSync(setupDir)) {
    const AJENOS = /^(AS_|DTS_|RS_|MDS_|POLYBASE)/i;
    const deMasEdicion = readdirSync(setupDir).filter(f => AJENOS.test(f));
    if (deMasEdicion.length) {
      mal(`el medio trae componentes de una edicion superior (${deMasEdicion.slice(0, 4).join(', ')}): ` +
          'se esperaba Express');
    } else {
      bien('sin componentes de ediciones superiores: es el medio Express');
    }
  }
}

// ==========================================================================
// DEPENDENCIA EXTERNA: la actualizacion de seguridad del motor
// ==========================================================================
// El medio base es RTM de 2019. Toda instalacion nueva de Wybix debe quedar
// parcheada, asi que el paquete del GDR viaja en el instalador. Empaquetar
// sin el produciria instalaciones nuevas con un motor sin parches de
// seguridad, que es justo lo que esta politica existe para evitar.
console.log('\nDEPENDENCIA EXTERNA — actualizacion de seguridad del motor');

const CONTRATO = resolve('installer', 'sql-servicing.json');
if (!existsSync(CONTRATO)) {
  mal('falta installer/sql-servicing.json: sin el no se sabe que parche debe viajar');
} else {
  const contrato = JSON.parse(readFileSync(CONTRATO, 'utf8'));
  const ramaWybix = contrato.ramaQueInstalaWybix || 'GDR';
  const s = contrato.seguridad?.ramas?.[ramaWybix];

  if (!s) {
    mal(`el contrato no declara la rama ${ramaWybix} que Wybix instala`);
  } else if (!s.viajaEnElInstalador) {
    bien(`la rama ${ramaWybix} no viaja en el instalador: no hay parche que comprobar`);
  } else {
    const parche = resolve('installer', 'sqlupdates', s.paquete);
    console.log(`   rama ${ramaWybix} · ${s.kb} · build ${s.buildMinimo} · ${contrato.seguridad.fecha}`);

    if (!existsSync(parche)) {
      mal(`falta el paquete ${s.paquete}.\n` +
          `           Descarga ${s.kb} (SQL Server 2019 ${ramaWybix}, ${s.arquitectura}) de Microsoft\n` +
          `           y coloca el archivo en installer/sqlupdates/.\n` +
          `           Fuente: ${s.fuente}`);
    } else {
      const tam = statSync(parche).size;
      bien(`${s.paquete} presente (${(tam / 1048576).toFixed(1)} MB)`);

      // El hash es lo que distingue el paquete oficial de uno cualquiera con
      // el mismo nombre. Se compara con el publicado por Microsoft.
      const hash = createHash('sha256').update(readFileSync(parche)).digest('hex').toUpperCase();
      if (hash === String(s.sha256).toUpperCase()) {
        bien('SHA256 coincide con el publicado por Microsoft');
      } else {
        mal(`el SHA256 NO coincide con el oficial.\n` +
            `           esperado  ${s.sha256}\n` +
            `           encontrado ${hash}\n` +
            `           No se empaqueta un parche que no es el aprobado.`);
      }
    }
  }

  // Coherencia del contrato: cada rama declarada necesita su objetivo, y el
  // de la rama CU tiene que ser de la rama CU. Confundirlos daria por segura
  // una instancia que no lo esta.
  const ramas = contrato.seguridad?.ramas || {};
  const problemas = [];
  for (const [nombre, r] of Object.entries(ramas)) {
    if (!r.kb || !r.buildMinimo) { problemas.push(`${nombre} sin kb o buildMinimo`); continue; }
    const tercero = Number(String(r.buildMinimo).split('.')[2] || 0);
    const esperado = nombre === 'CU' ? tercero >= 4000 : tercero < 4000;
    if (!esperado) problemas.push(`${nombre} declara ${r.buildMinimo}, que no corresponde a esa rama`);
  }
  if (problemas.length) mal(`objetivos de seguridad incoherentes: ${problemas.join('; ')}`);
  else bien(`objetivos por rama coherentes: ${Object.entries(ramas).map(([n, r]) => `${n} ${r.buildMinimo}`).join(' · ')}`);
}

console.log(fallos
  ? `\nRESULTADO: ${fallos} FALLO(S) - NO empaquetar`
  : '\nRESULTADO: PASS - el paquete puede construirse');
process.exit(fallos ? 1 : 0);
