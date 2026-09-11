/**
 * COMO SE ESCRIBE UN SERVIDOR DE SQL SERVER.
 *
 *     node scripts/pruebas/servidor-sql.mjs
 *
 * EL FALLO QUE ORIGINA ESTA PRUEBA
 * --------------------------------
 * En una laptop secundaria de QA, con la red, el firewall, el puerto 1433, el
 * SQL Browser, la cuenta `ocus_app` y la contrasena ya comprobados A MANO con
 * sqlcmd, el asistente de Wybix no conseguia conectar. El archivo que habia
 * escrito el propio asistente decia:
 *
 *     "server": "192.168.100.211\\SQLEXPRESS\\SQLEXPRESS"
 *
 * La causa era una sola linea del asistente:
 *
 *     server: serverIp + '\\SQLEXPRESS'
 *
 * Concatenaba la instancia sin mirar si ya estaba. Quien escribia solo la IP
 * tenia suerte; quien escribia lo mismo que acababa de probar con sqlcmd
 * -`192.168.100.211\SQLEXPRESS`, que es lo natural- se llevaba una cadena
 * imposible. Y como nadie validaba antes de conectar, la aplicacion entraba en
 * su bucle de 20 reintentos de 3 segundos para terminar diciendo "verifica la
 * IP y el Firewall", con la IP y el firewall perfectos.
 *
 * QUE SE COMPRUEBA
 * ----------------
 * La gramatica entera, forma por forma, incluidas las seis prohibiciones; que
 * los tres sitios que antes troceaban la cadena por su cuenta usan ahora la
 * misma regla; y el valor EXACTO que acabaria en `db-config.json` para cada
 * forma admitida.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../electron/lib/servidor-sql.js');
const { servidorEsLocal } = require('../../electron/lib/host.js');
const { instanciaDe } = require('../../electron/lib/red-principal.js');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

/** Lo que Wybix guardaria en db-config.json con esa entrada. */
const norm = (t) => S.normalizarServidor(t);
const igual = (entrada, esperado) => {
  const r = norm(entrada);
  check(r.ok && r.server === esperado,
    `${JSON.stringify(entrada)}  ->  ${JSON.stringify(esperado)}`,
    r.ok ? (r.server === esperado ? '' : `dio ${JSON.stringify(r.server)}`) : r.error);
  return r;
};
const rechaza = (entrada, fragmento) => {
  const r = norm(entrada);
  const ok = !r.ok && (!fragmento || String(r.error).includes(fragmento));
  check(ok, `rechaza ${JSON.stringify(entrada)}`, r.ok ? `la acepto como ${r.server}` : r.error);
};

console.log('\nLA DIRECCION DEL SERVIDOR DE SQL SERVER');

// ===========================================================================
seccion('1. Las seis formas que una persona puede escribir');

// 1. Solo IP  -> se completa con la instancia que instala Wybix.
igual('192.168.100.211', '192.168.100.211\\SQLEXPRESS');
// 2. IP + instancia -> NO se vuelve a anadir. Este era EL fallo.
igual('192.168.100.211\\SQLEXPRESS', '192.168.100.211\\SQLEXPRESS');
// 3. IP + puerto -> ni instancia ni puerto duplicado.
igual('192.168.100.211,1433', '192.168.100.211,1433');
// 4. tcp: -> se respeta el prefijo.
igual('tcp:192.168.100.211,1433', 'tcp:192.168.100.211,1433');
// 5. hostname solo.
igual('SERVIDOR-CAJA', 'SERVIDOR-CAJA\\SQLEXPRESS');
// 6. hostname + instancia.
igual('SERVIDOR-CAJA\\SQLEXPRESS', 'SERVIDOR-CAJA\\SQLEXPRESS');

seccion('2. Variantes que aparecen en la vida real');
igual('  192.168.100.211  ', '192.168.100.211\\SQLEXPRESS');   // copiado con espacios
igual('localhost', 'localhost\\SQLEXPRESS');
igual('192.168.100.211\\SQLEXPRESS,1433', '192.168.100.211\\SQLEXPRESS,1433');
igual('tcp:192.168.100.211', 'tcp:192.168.100.211\\SQLEXPRESS');
igual('TCP:192.168.100.211,1433', 'tcp:192.168.100.211,1433');  // el protocolo se normaliza a minusculas
igual('mi-servidor.local\\SQLEXPRESS', 'mi-servidor.local\\SQLEXPRESS');
igual('192.168.100.211\\WYBIX', '192.168.100.211\\WYBIX');      // otra instancia: se respeta

// ===========================================================================
seccion('3. Las seis cosas que NUNCA se pueden generar');

const nunca = [
  '192.168.100.211', '192.168.100.211\\SQLEXPRESS', '192.168.100.211,1433',
  'tcp:192.168.100.211,1433', 'SERVIDOR-CAJA', 'SERVIDOR-CAJA\\SQLEXPRESS',
  'localhost', 'tcp:192.168.100.211', '192.168.100.211\\SQLEXPRESS,1433',
];
const salidas = nunca.map(e => norm(e)).filter(r => r.ok).map(r => r.server);
check(salidas.every(s => !/SQLEXPRESS\\SQLEXPRESS/i.test(s)),
  'ninguna salida contiene \\SQLEXPRESS\\SQLEXPRESS',
  'esto es lo que habia en la laptop de QA');
check(salidas.every(s => !/,\d+,/.test(s) && (s.match(/,/g) || []).length <= 1),
  'ninguna salida duplica el puerto');
check(salidas.every(s => (s.match(/\\/g) || []).length <= 1),
  'ninguna salida tiene dos barras');

// El fallo original, reproducido tal cual: la entrada YA corrupta se rechaza
// en vez de intentar conectarse a ella.
rechaza('192.168.100.211\\SQLEXPRESS\\SQLEXPRESS', 'instancia dos veces');
check(!norm('192.168.100.211\\SQLEXPRESS\\SQLEXPRESS').ok,
  'la cadena exacta de la laptop de QA se rechaza',
  '192.168.100.211\\SQLEXPRESS\\SQLEXPRESS');

// Y la idempotencia, que es lo que impedia el fallo: normalizar dos veces no
// puede anadir nada. Es la propiedad que el `+ \\SQLEXPRESS` no tenia.
const dosVeces = nunca.every(e => {
  const a = norm(e); if (!a.ok) return false;
  const b = norm(a.server);
  return b.ok && b.server === a.server;
});
check(dosVeces, 'normalizar dos veces da el mismo resultado (idempotente)',
  'la concatenacion a ciegas no lo era: ahi nacio el bug');

// ===========================================================================
seccion('4. Entradas invalidas: fallan rapido y dicen por que');

rechaza('', 'Falta la direccion');
rechaza('   ', 'Falta la direccion');
rechaza('192.168.100.211\\', 'sin nombre de instancia');
rechaza('192.168.100.211,', 'no es un puerto valido');
rechaza('192.168.100.211,abc', 'no es un puerto valido');
rechaza('192.168.100.211,99999', 'fuera de rango');
rechaza('192.168.100.211,1433,1433', 'puerto repetido');
rechaza('192.168.100 .211', 'espacios');
rechaza('np:192.168.100.211', 'no es un protocolo admitido');
rechaza('tcp:', 'falta la direccion');
rechaza('\\SQLEXPRESS', 'no dice a que equipo');

// El mensaje tiene que servirle a quien lo lee, no solo existir.
const malo = norm('192.168.100.211\\SQLEXPRESS\\SQLEXPRESS');
check(String(malo.error).includes('192.168.100.211\\SQLEXPRESS'),
  'el mensaje incluye lo que se escribio', malo.error);
check(/192\.168\.1\.10/.test(String(malo.error)),
  'y ensena como se escribe bien', malo.error);

// ===========================================================================
seccion('5. Una sola gramatica: los tres sitios que la troceaban');

// `instanciaDe` (diagnostico de Red MultiCaja) y `servidorEsLocal` (frontera
// host/secundaria) tenian cada uno su propio split. Ahora comparten regla.
check(instanciaDe('192.168.100.211\\SQLEXPRESS') === 'SQLEXPRESS', 'instanciaDe lee la instancia');
check(instanciaDe('192.168.100.211\\SQLEXPRESS,1433') === 'SQLEXPRESS', 'instanciaDe descarta el puerto');
check(instanciaDe('192.168.100.211') === '', 'instanciaDe no inventa instancia');
check(instanciaDe('192.168.100.211\\SQLEXPRESS\\SQLEXPRESS') === '',
  'instanciaDe no se traga una cadena corrupta',
  'antes devolvia "SQLEXPRESS" y daba por buena una cadena imposible');

check(servidorEsLocal('localhost\\SQLEXPRESS') === true, 'servidorEsLocal con instancia');
check(servidorEsLocal('127.0.0.1,1433') === true, 'servidorEsLocal con puerto');
check(servidorEsLocal('.') === true && servidorEsLocal('(local)') === true,
  'servidorEsLocal admite las formas cortas de Windows');
check(servidorEsLocal('192.168.100.211\\SQLEXPRESS') === false, 'y una IP ajena no es local');
check(servidorEsLocal('192.168.100.211\\SQLEXPRESS\\SQLEXPRESS') === false,
  'una cadena corrupta NO se da por local',
  'darla por local mandaria a la secundaria a prepararse a si misma como servidor');

check(S.componerServidor('EQUIPO', 'SQLEXPRESS') === 'EQUIPO\\SQLEXPRESS', 'componerServidor arma la cadena');
check(S.componerServidor('EQUIPO', '') === 'EQUIPO', 'y sin instancia no deja la barra suelta');

// ===========================================================================
seccion('6. El valor exacto que acaba en db-config.json');

/* Se reproduce lo que hace `setup-run`: normaliza y arma el objeto. Si esto
   cambia, cambia el archivo que se escribe en la laptop del cliente. */
const comoSeGuarda = (entrada) => {
  const r = S.normalizarServidor(entrada);
  if (!r.ok) return { error: r.error };
  return { server: r.server, database: 'Wybix_POS', auth: 'sql', user: 'ocus_app' };
};

const ESPERADO = [
  ['192.168.100.211', '192.168.100.211\\SQLEXPRESS'],
  ['192.168.100.211\\SQLEXPRESS', '192.168.100.211\\SQLEXPRESS'],
  ['192.168.100.211,1433', '192.168.100.211,1433'],
  ['tcp:192.168.100.211,1433', 'tcp:192.168.100.211,1433'],
  ['SERVIDOR-CAJA', 'SERVIDOR-CAJA\\SQLEXPRESS'],
  ['SERVIDOR-CAJA\\SQLEXPRESS', 'SERVIDOR-CAJA\\SQLEXPRESS'],
];
for (const [entrada, esperado] of ESPERADO) {
  const cfg = comoSeGuarda(entrada);
  check(cfg.server === esperado && cfg.auth === 'sql' && cfg.user === 'ocus_app',
    `db-config.json para ${JSON.stringify(entrada)}`,
    JSON.stringify(cfg.server ?? cfg.error));
}

// Tal y como se serializa de verdad: en JSON la barra va escapada, y es como
// se vio el fallo en el archivo de la laptop.
const json = JSON.stringify(comoSeGuarda('192.168.100.211\\SQLEXPRESS'));
check(json.includes('"192.168.100.211\\\\SQLEXPRESS"'), 'y en el JSON queda con UNA sola barra escapada', json);
check(!json.includes('SQLEXPRESS\\\\SQLEXPRESS'), 'nunca con dos');

const invalido = comoSeGuarda('192.168.100.211\\SQLEXPRESS\\SQLEXPRESS');
check(!!invalido.error && !invalido.server,
  'una entrada corrupta NO produce archivo: no hay nada que guardar', invalido.error);

// ===========================================================================
seccion('7. Los sitios que construian la cadena a mano ya no lo hacen');

/* Se comprueba el CODIGO, no el texto: los comentarios de estos archivos citan
   a proposito la linea que causo el fallo, y una prueba que se dispara con un
   comentario no esta comprobando nada. */
const sinComentarios = (txt) => txt
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const wizard = readFileSync(join('electron', 'setup', 'setup-wizard.html'), 'utf8');
check(!/serverIp\s*\+\s*['"]\\\\SQLEXPRESS/.test(sinComentarios(wizard)),
  'el asistente ya NO concatena \\SQLEXPRESS a ciegas',
  'era la linea exacta que produjo el archivo corrupto');
check(wizard.includes('api.normalizarServidor'),
  'y consulta la regla en vez de reimplementarla');

const principal = readFileSync(join('electron', 'main.js'), 'utf8');
check(/normalizarServidor\(payload\.server\)/.test(principal),
  'setup-run normaliza antes de escribir db-config.json',
  'es el unico sitio que escribe ese archivo');

const base = readFileSync(join('electron', 'db.js'), 'utf8');
check(/validarServidor\(poolConfig\.server\)/.test(base),
  'db.js valida ANTES del bucle de reintentos',
  'sin esto son 20 intentos de 3 segundos para una cadena que ya se sabe rota');
check(/validarServidor\(merged\.server\)/.test(base),
  'y valida antes de guardar una configuracion nueva');

const contador = (txt, re) => (txt.match(re) || []).length;
check(contador(base, /split\(['"]\\\\\\\\['"]\)/g) === 0,
  'db.js ya no trocea la cadena por su cuenta');

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
