/**
 * EL CICLO DE VIDA DE LA CONEXION.
 *
 *     node scripts/pruebas/pool-ciclo-vida.mjs
 *
 * EL FALLO QUE ORIGINA ESTA PRUEBA
 * --------------------------------
 * En la laptop secundaria de QA, con la red y las credenciales ya comprobadas
 * a mano y el `db-config.json` ya correcto, el registro decia dos cosas
 * seguidas que no pueden ser ciertas a la vez:
 *
 *     [DB] Conectado. Server: 192.168.100.211\SQLEXPRESS DB: Wybix_POS Auth: sql
 *     setup-run: Error: No hay base de datos configurada (database vacio)
 *
 * Y la traza senalaba `main.js:4:9`, que es esta linea:
 *
 *     const { poolPromise, sql } = require('./db');
 *
 * `poolPromise` era una propiedad con getter que devolvia `getPool()`.
 * DESESTRUCTURAR lee la propiedad, y leerla se conectaba. Es decir: Wybix se
 * conectaba a la base al CARGAR el modulo, antes de que existiera
 * `db-config.json` y antes del asistente. Como `database` venia vacio, ese
 * intento rechazaba al instante, y la promesa RECHAZADA quedaba guardada en la
 * constante para toda la vida del proceso. Los 104 `await poolPromise` de
 * main.js volvian a lanzar ese error viejo aunque la conexion real ya
 * estuviera hecha.
 *
 * Tres modulos la desestructuraban al cargarse: main.js, backupManager.js y
 * cloudSync.js.
 *
 * COMO SE PRUEBA
 * --------------
 * Con `electron` y `mssql` sustituidos por dobles. Lo que se comprueba aqui es
 * el CICLO DE VIDA -cuando se conecta, cuantas veces, que pasa al cambiar la
 * configuracion-, no SQL Server. Con dobles se puede afirmar "se creo
 * exactamente un pool" y "hubo un solo bucle de reintentos", que contra una
 * base de verdad solo se podria suponer.
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

// ===========================================================================
//  DOBLES
// ===========================================================================

let carpetaDatos = null;

const electronDoble = {
  app: { getPath: () => carpetaDatos, isPackaged: false },
  // Sin cifrado real: la prueba no va de secretos, y asi `db.js` toma su
  // camino de respaldo sin depender del almacen del sistema operativo.
  safeStorage: { isEncryptionAvailable: () => false },
};

/** Pool falso: cuenta cuantos se crearon y cuantas veces se intento conectar. */
class PoolFalso {
  constructor(cfg) {
    this.config = cfg;
    this.connected = false;
    PoolFalso.creados.push(this);
  }
  on() { /* el pool real emite 'error'; aqui no hace falta */ }
  async connect() {
    PoolFalso.intentos++;
    // Un tick de espera: sin el, conectar seria sincrono y ninguna carrera
    // entre llamadas concurrentes llegaria a darse.
    await new Promise(r => setImmediate(r));
    if (PoolFalso.falla) throw new Error('servidor no disponible (simulado)');
    this.connected = true;
    return this;
  }
  async close() { this.connected = false; PoolFalso.cerrados++; }
  request() { throw new Error('no se usa en esta prueba'); }
}
PoolFalso.reiniciar = () => {
  PoolFalso.creados = [];
  PoolFalso.intentos = 0;
  PoolFalso.cerrados = 0;
  PoolFalso.falla = false;
};
PoolFalso.reiniciar();

const mssqlDoble = new Proxy({ ConnectionPool: PoolFalso }, {
  // `db.js` solo usa `ConnectionPool`; el resto (tipos, etc.) se devuelve como
  // marcador para que cualquier acceso accidental no reviente sin explicacion.
  get(destino, prop) {
    if (prop in destino) return destino[prop];
    return `<doble:${String(prop)}>`;
  },
});

const cargarOriginal = Module._load;
Module._load = function (peticion, ...resto) {
  if (peticion === 'electron') return electronDoble;
  if (peticion === 'mssql/msnodesqlv8') return mssqlDoble;
  return cargarOriginal.call(this, peticion, ...resto);
};

// ===========================================================================
//  UTILIDADES
// ===========================================================================

const RUTA_DB = () => join(carpetaDatos, 'db-config.json');

/** Una instalacion desde cero: carpeta nueva y `db.js` recien cargado. */
function entornoLimpio() {
  carpetaDatos = mkdtempSync(join(tmpdir(), 'wx-pool-'));
  PoolFalso.reiniciar();
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`electron${require('path').sep}db.js`)) delete require.cache[k];
  }
  return require('../../electron/db.js');
}

function escribirConfig(cfg) {
  writeFileSync(RUTA_DB(), JSON.stringify({
    database: 'Wybix_POS',
    auth: 'sql',
    user: 'ocus_app',
    // Reintentos cortos: lo que se mide es cuantos, no cuanto se tarda.
    retry: { maxAttempts: 3, delayMs: 10 },
    ...cfg,
  }, null, 2), 'utf8');
}

const sueltas = [];
process.on('unhandledRejection', (m) => sueltas.push(m));
/** Deja correr los microtask y timers pendientes para cazar rechazos sueltos. */
const respirar = () => new Promise(r => setTimeout(r, 60));

try {
  console.log('\nEL CICLO DE VIDA DE LA CONEXION');

  // =========================================================================
  seccion('1. Cargar el modulo NO conecta');

  {
    const db = entornoLimpio();
    check(PoolFalso.creados.length === 0, 'require("./db") no crea ningun pool');

    // La linea exacta de main.js:4, que es la que aparecia en la traza.
    const { poolPromise, sql } = db;
    check(PoolFalso.creados.length === 0,
      'desestructurar { poolPromise } tampoco', 'era el getter que se disparaba al leerlo');
    check(!!poolPromise && typeof poolPromise.then === 'function',
      'poolPromise sigue siendo esperable (thenable)');
    check(!!sql, 'y `sql` se sigue exportando igual');
    check(!existsSync(RUTA_DB()), 'ni siquiera se crea db-config.json');
  }

  // =========================================================================
  seccion('2. Sin configuracion no se intenta conectar');

  {
    const db = entornoLimpio();
    check(db.hayConfiguracion() === false, 'hayConfiguracion() dice que no, sin conectarse');
    check(PoolFalso.creados.length === 0, 'y preguntarlo no crea ningun pool',
      'es lo que main.js consulta antes de abrir el asistente');

    escribirConfig({ database: '', server: 'localhost\\SQLEXPRESS' });
    check(db.hayConfiguracion() === false, 'una base vacia tampoco cuenta como configuracion');

    escribirConfig({ server: '192.168.100.211\\SQLEXPRESS\\SQLEXPRESS' });
    check(db.hayConfiguracion() === false, 'ni un servidor con la instancia duplicada');

    escribirConfig({ server: '192.168.100.211\\SQLEXPRESS' });
    check(db.hayConfiguracion() === true, 'con configuracion buena, si');
    check(PoolFalso.creados.length === 0, 'y en todo esto no se creo ni un pool');
  }

  // =========================================================================
  seccion('3. LA REGRESION: un intento fallido NO queda cacheado');

  {
    const db = entornoLimpio();
    const { poolPromise } = db;            // igual que main.js:4

    // Arranque sin configuracion: exactamente el estado del primer arranque.
    let error1 = null;
    try { await poolPromise; } catch (e) { error1 = e; }
    check(!!error1 && /No hay base de datos configurada/.test(error1.message),
      'con la configuracion vacia, el primer intento falla', error1?.message);

    // El asistente guarda la configuracion buena...
    escribirConfig({ server: '192.168.100.211\\SQLEXPRESS' });

    // ...y el MISMO `poolPromise` que capturo main.js tiene que funcionar.
    let pool2 = null, error2 = null;
    try { pool2 = await poolPromise; } catch (e) { error2 = e; }
    check(!!pool2 && !error2,
      'y el MISMO poolPromise conecta despues, sin volver a lanzar el error viejo',
      error2 ? error2.message : 'conectado');
    check(pool2 && pool2.config.database === 'Wybix_POS',
      'con la configuracion NUEVA, no con la de hace un rato',
      pool2 ? `${pool2.config.server} / ${pool2.config.database}` : '');

    // El sintoma exacto del QA: conectar y acto seguido leer el error viejo.
    let error3 = null;
    try { await poolPromise; } catch (e) { error3 = e; }
    check(!error3, 'y esperarlo otra vez sigue devolviendo la conexion, no el error',
      'este era el "[DB] Conectado" seguido de "database vacio"');
  }

  // =========================================================================
  seccion('4. Exactamente UN pool, aunque se pida a la vez');

  {
    const db = entornoLimpio();
    escribirConfig({ server: '192.168.100.211\\SQLEXPRESS' });

    const todos = await Promise.all(Array.from({ length: 25 }, () => db.poolPromise));
    check(PoolFalso.creados.length === 1, 'veinticinco peticiones simultaneas crean UN pool',
      `${PoolFalso.creados.length} creado(s)`);
    check(todos.every(p => p === todos[0]), 'y todas reciben la misma conexion');

    // Y una vez conectada, pedirla otra vez no abre nada nuevo.
    await db.poolPromise;
    await db.poolPromise;
    check(PoolFalso.creados.length === 1, 'pedirla de nuevo reutiliza la que ya hay');
  }

  // =========================================================================
  seccion('5. Un solo bucle de reintentos');

  {
    const db = entornoLimpio();
    escribirConfig({ server: '192.168.100.211\\SQLEXPRESS' });
    PoolFalso.falla = true;

    // Diez peticiones a la vez contra un servidor que no responde. Si cada una
    // arrancara su bucle, se verian 30 intentos y los "Intento 1/20" e
    // "Intento 7/20" intercalados que reporto QA.
    const resultados = await Promise.allSettled(Array.from({ length: 10 }, () => db.poolPromise));
    check(resultados.every(r => r.status === 'rejected'), 'todas fallan');
    check(PoolFalso.intentos === 3, 'hubo UN bucle de 3 intentos, no diez bucles',
      `${PoolFalso.intentos} intentos en total`);
    check(new Set(resultados.map(r => r.reason?.message)).size === 1,
      'y todas reciben el mismo error');

    // Y despues del fallo, no queda nada cacheado: se puede volver a intentar.
    PoolFalso.falla = false;
    const p = await db.poolPromise;
    check(!!p && p.connected, 'tras el fallo se puede reintentar y conectar',
      'no queda ninguna promesa rechazada guardada');
  }

  // =========================================================================
  seccion('6. Cambiar de configuracion cierra la anterior y abre UNA nueva');

  {
    const db = entornoLimpio();
    escribirConfig({ server: '192.168.100.211\\SQLEXPRESS' });
    const viejo = await db.poolPromise;
    check(PoolFalso.creados.length === 1 && viejo.connected, 'conectado con la primera configuracion');

    escribirConfig({ server: '192.168.100.99\\SQLEXPRESS' });
    const nuevo = await db.reconnect();
    check(PoolFalso.creados.length === 2, 'reconnect() abre exactamente uno nuevo',
      `${PoolFalso.creados.length} en total`);
    check(viejo.connected === false && PoolFalso.cerrados >= 1, 'y cierra el anterior');
    check(nuevo !== viejo && nuevo.config.server === '192.168.100.99\\SQLEXPRESS',
      'la conexion nueva usa la configuracion nueva', nuevo.config.server);
    check((await db.poolPromise) === nuevo, 'y a partir de ahi todos reciben la nueva');
  }

  // =========================================================================
  seccion('7. Un bucle atado a la configuracion VIEJA no se reparte');

  {
    const db = entornoLimpio();
    escribirConfig({ server: '192.168.100.211\\SQLEXPRESS', retry: { maxAttempts: 8, delayMs: 40 } });
    PoolFalso.falla = true;

    // Arranca un bucle contra un servidor que no responde -lo que le pasaba a
    // la laptop- y, sin esperarlo, el asistente guarda la configuracion buena.
    const enVuelo = db.poolPromise.then(() => 'conectado', () => 'fallo');
    await new Promise(r => setTimeout(r, 60));   // que el bucle arranque

    escribirConfig({ server: '192.168.100.50\\SQLEXPRESS', retry: { maxAttempts: 8, delayMs: 40 } });
    PoolFalso.falla = false;
    const bueno = await db.reconnect();

    check(bueno.config.server === '192.168.100.50\\SQLEXPRESS',
      'reconnect() conecta con la configuracion nueva', bueno.config.server);
    check(bueno.connected === true, 'y queda conectada de verdad');
    check((await db.poolPromise) === bueno,
      'sin devolver el bucle viejo a quien pregunte',
      'antes reconnect() entregaba el intento en vuelo, con la configuracion anterior');

    await enVuelo;   // el bucle viejo termina por su cuenta; no debe estorbar
    check((await db.poolPromise) === bueno,
      'y cuando el bucle viejo termina, no descarta la conexion buena');
  }

  // =========================================================================
  seccion('8. Ningun rechazo suelto');

  await respirar();
  check(sueltas.length === 0,
    'no hubo ninguna promesa rechazada sin manejar en toda la prueba',
    sueltas.length ? String(sueltas[0]?.message ?? sueltas[0]) : 'cero');

  // =========================================================================
  seccion('9. El codigo ya no expone la trampa');

  {
    /* Se mira el CODIGO, no el texto: estos archivos citan a proposito la
       linea que causo el fallo, y una prueba que se dispara con un comentario
       no esta comprobando nada. */
    const sinComentarios = (txt) => txt
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

    const fuente = sinComentarios(readFileSync(join('electron', 'db.js'), 'utf8'));
    check(!/defineProperty\([^)]*poolPromise/.test(fuente) &&
          !/get\(\)\s*\{\s*return getPool\(\);\s*\}/.test(fuente),
      'db.js ya no tiene el getter que conectaba al leer la propiedad',
      'era lo que disparaba la conexion al desestructurar');
    check(/api\.poolPromise\s*=\s*Object\.freeze/.test(fuente),
      'poolPromise es un thenable congelado');

    const principal = readFileSync(join('electron', 'main.js'), 'utf8');
    check(/db\.hayConfiguracion\(\)/.test(principal),
      'main.js decide si hay configuracion ANTES de tocar la base');
    check(/process\.on\('unhandledRejection'/.test(principal),
      'y una promesa suelta ya no puede tumbar el proceso');
  }

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.stack || e.message}`);
} finally {
  Module._load = cargarOriginal;
  try { if (carpetaDatos) rmSync(carpetaDatos, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
