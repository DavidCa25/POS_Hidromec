/**
 * Respaldo y restauracion de verdad.
 *
 *     npm run db:test-backup
 *
 * Un respaldo que nunca se ha restaurado no es un respaldo. Esta prueba
 * recorre el camino completo sobre bases TEMPORALES:
 *
 *     crear base -> meter datos -> BACKUP -> el archivo existe
 *       -> RESTORE VERIFYONLY -> RESTORE a otra base -> los datos estan
 *
 * y ademas comprueba que los casos que rompen en casa de un cliente -una
 * carpeta con espacios, una carpeta que no existe, una ruta a la que el
 * servicio de SQL Server no puede escribir- fallan de forma controlada y con
 * un mensaje que se pueda accionar.
 *
 * NUNCA toca Hidromec_DataBase ni ninguna base real: solo crea y borra las
 * suyas, con nombre reservado.
 */
import { existsSync, mkdirSync, statSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { consultar, SERVIDOR } from './lib/sql.mjs';
import { ejecutar, crearVacia, eliminar, respaldar, restaurar, ZONA_COMUN } from './lib/temporal.mjs';

const ORIGEN = 'Wybix_TmpBackup';
const DESTINO = 'Wybix_TmpRestore';

const paso = (t) => console.log(`\n── ${t}`);
let ok = 0, fallos = [];
const comprobar = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok    ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};

function limpiar() {
  for (const db of [ORIGEN, DESTINO]) { try { eliminar(db); } catch { /* no existia */ } }
}

console.log(`Servidor: ${SERVIDOR}`);
console.log(`Carpeta de respaldos: ${ZONA_COMUN}`);
limpiar();

try {
  // ------------------------------------------------------------ preparar
  paso('Base de origen con datos reconocibles');
  crearVacia(ORIGEN);
  ejecutar(ORIGEN, `
    CREATE TABLE dbo.prueba_respaldo (
      id INT IDENTITY(1,1) PRIMARY KEY,
      etiqueta NVARCHAR(80) NOT NULL,
      creado_en DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
    INSERT INTO dbo.prueba_respaldo (etiqueta) VALUES
      (N'venta de ayer'), (N'producto con acentos: cafe molido'), (N'tercera fila');
  `);
  const filasOrigen = Number(consultar(ORIGEN, 'SELECT COUNT(*) AS n FROM dbo.prueba_respaldo')[0].n);
  comprobar(filasOrigen === 3, 'la base de origen tiene datos', `${filasOrigen} filas`);

  // ------------------------------------------------------------- backup
  paso('BACKUP');
  if (!existsSync(ZONA_COMUN)) mkdirSync(ZONA_COMUN, { recursive: true });
  const bak = join(ZONA_COMUN, `${ORIGEN}_prueba.bak`);
  if (existsSync(bak)) unlinkSync(bak);

  respaldar(ORIGEN, bak);
  comprobar(existsSync(bak), 'el archivo de respaldo existe', bak);
  const tam = existsSync(bak) ? statSync(bak).size : 0;
  comprobar(tam > 100 * 1024, 'el respaldo tiene contenido', `${(tam / 1048576).toFixed(2)} MB`);

  // --------------------------------------------------------- verifyonly
  paso('RESTORE VERIFYONLY');
  // VERIFYONLY no escribe nada, pero el helper de lectura rechaza cualquier
  // sentencia que no sea SELECT: se usa el de escritura, que es lo correcto
  // para una sentencia RESTORE aunque solo verifique.
  let verificado = false;
  try {
    ejecutar('master', `RESTORE VERIFYONLY FROM DISK = N'${bak.replace(/'/g, "''")}'`);
    verificado = true;
  } catch (e) {
    console.log('   detalle: ' + e.message.split('\n')[0]);
  }
  comprobar(verificado, 'SQL Server declara el respaldo legible');

  // ------------------------------------------------------------ restore
  paso('RESTORE a una base distinta');
  restaurar(DESTINO, bak);
  const existeDestino = consultar('master',
    `SELECT COUNT(*) AS n FROM sys.databases WHERE name = '${DESTINO}'`)[0].n;
  comprobar(Number(existeDestino) === 1, 'la base restaurada existe');

  const filasDestino = Number(consultar(DESTINO, 'SELECT COUNT(*) AS n FROM dbo.prueba_respaldo')[0].n);
  comprobar(filasDestino === filasOrigen, 'los datos sobrevivieron', `${filasDestino} filas`);

  const acentos = consultar(DESTINO,
    "SELECT etiqueta FROM dbo.prueba_respaldo WHERE etiqueta LIKE '%cafe molido%'");
  comprobar(acentos.length === 1, 'el texto con acentos se conserva');

  // -------------------------------------------------- caminos dificiles
  paso('Casos que rompen en casa del cliente');

  // Carpeta con espacios: es lo normal en Windows.
  const conEspacios = join(ZONA_COMUN, 'Respaldos de Wybix');
  mkdirSync(conEspacios, { recursive: true });
  const bakEspacios = join(conEspacios, `${ORIGEN} respaldo de prueba.bak`);
  if (existsSync(bakEspacios)) unlinkSync(bakEspacios);
  let okEspacios = false, errEspacios = '';
  try { respaldar(ORIGEN, bakEspacios); okEspacios = existsSync(bakEspacios); }
  catch (e) { errEspacios = e.message.split('\n')[0]; }
  comprobar(okEspacios, 'ruta con espacios en carpeta y archivo', errEspacios);

  // Carpeta inexistente: la aplicacion la crea antes de pedir el respaldo.
  const nueva = join(ZONA_COMUN, `carpeta-nueva-${Date.now()}`);
  comprobar(!existsSync(nueva), 'la carpeta de destino no existia');
  mkdirSync(nueva, { recursive: true });
  const bakNueva = join(nueva, 'respaldo.bak');
  let okNueva = false;
  try { respaldar(ORIGEN, bakNueva); okNueva = existsSync(bakNueva); } catch { /* se reporta abajo */ }
  comprobar(okNueva, 'respaldo en una carpeta recien creada');

  // Ruta a la que el servicio de SQL Server no puede escribir: debe fallar
  // con un error, no dejar un archivo a medias ni colgarse.
  const prohibida = 'C:\\Windows\\System32\\config\\wybix-no-deberia.bak';
  let falloControlado = false, mensaje = '';
  try {
    respaldar(ORIGEN, prohibida);
  } catch (e) {
    falloControlado = true;
    mensaje = e.message.split('\n').find(l => /error|denied|denegado|BACKUP/i.test(l)) || e.message.split('\n')[0];
  }
  comprobar(falloControlado, 'una ruta prohibida falla de forma controlada', mensaje.slice(0, 90));
  comprobar(!existsSync(prohibida), 'no queda un archivo a medias en la ruta prohibida');

  // ---------------------------------------------------------- app-ready
  paso('La base restaurada acepta trabajo');
  ejecutar(DESTINO, `INSERT INTO dbo.prueba_respaldo (etiqueta) VALUES (N'escrito despues de restaurar');`);
  const tras = Number(consultar(DESTINO, 'SELECT COUNT(*) AS n FROM dbo.prueba_respaldo')[0].n);
  comprobar(tras === filasOrigen + 1, 'se puede escribir en la base restaurada', `${tras} filas`);

  // ------------------------------------------------------------ limpiar
  paso('Limpieza');
  for (const f of [bak, bakEspacios, bakNueva]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* noop */ } }
  try { rmSync(conEspacios, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(nueva, { recursive: true, force: true }); } catch { /* noop */ }
  limpiar();
  const quedan = consultar('master',
    `SELECT COUNT(*) AS n FROM sys.databases WHERE name IN ('${ORIGEN}','${DESTINO}')`)[0].n;
  comprobar(Number(quedan) === 0, 'no quedan bases de prueba');

} catch (e) {
  console.error('\nERROR NO CONTROLADO:', e.message);
  fallos.push('error no controlado: ' + e.message.split('\n')[0]);
  limpiar();
}

console.log(`\nRESULTADO: ${ok} ok · ${fallos.length} fallas`);
if (fallos.length) { fallos.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('El respaldo se puede crear, verificar y restaurar.');
